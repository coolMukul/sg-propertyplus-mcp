/**
 * End-to-end test for Streamable HTTP transport (Phase 5).
 * Spawns the sg-propertyplus server in HTTP mode (both stateful and stateless),
 * connects as an MCP client via StreamableHTTPClientTransport, and verifies
 * tool calls work over HTTP.
 *
 * Usage: npx tsx scripts/test-http.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ChildProcess, spawn } from "node:child_process";

const HTTP_PORT = 4100; // Use a non-default port to avoid collisions
const BASE_URL = `http://127.0.0.1:${HTTP_PORT}/mcp`;

async function main() {
  console.log("=== SG-PropertyPlus — HTTP Transport Test ===\n");

  // Build first so dist/ is up to date
  console.log("Building project...");
  await runCommand("npx", ["tsc"]);
  console.log("Build complete.\n");

  // Test stateful mode
  await testMode("stateful");

  // Test stateless mode
  await testMode("stateless");

  console.log("\n=== All HTTP transport tests passed! ===");
}

async function testMode(mode: "stateful" | "stateless") {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`  Testing ${mode.toUpperCase()} mode`);
  console.log(`${"=".repeat(50)}\n`);

  const server = startServer(mode);

  try {
    // Wait for server to be ready
    await waitForServer(BASE_URL);
    console.log(`Server ready on port ${HTTP_PORT} (${mode})\n`);

    await runToolTests(mode);
    await runDnsRebindingTests();

    if (mode === "stateful") {
      await runSessionTests();
    }
  } finally {
    server.kill("SIGINT");
    // Give it a moment to shut down
    await sleep(500);
  }
}

// ---------------------------------------------------------------------------
// Tool tests — same for both modes
// ---------------------------------------------------------------------------

async function runToolTests(mode: string) {
  const { client, transport } = await createClient();

  try {
    // --- Test 1: List tools ---
    console.log("--- Test 1: List tools ---");
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);
    console.log(`  Tools: ${toolNames.join(", ")}`);
    assert(toolNames.includes("search_area"), "search_area must be registered");
    assert(toolNames.includes("search_area_by_coords"), "search_area_by_coords must be registered");
    assert(toolNames.includes("search_hdb_resale"), "search_hdb_resale must be registered");
    assert(toolNames.includes("analyze_results"), "analyze_results must be registered");
    assert(toolNames.includes("export_csv"), "export_csv must be registered");
    assert(toolNames.includes("export_md"), "export_md must be registered");
    console.log(`  PASS: All 6 tools registered (${mode})\n`);

    // --- Test 2: List resources ---
    console.log("--- Test 2: List resources ---");
    const { resources } = await client.listResources();
    const resourceUris = resources.map((r) => r.uri);
    console.log(`  Resources: ${resourceUris.join(", ")}`);
    assert(resourceUris.includes("sg-propertyplus://last-search"), "last-search resource");
    assert(resourceUris.includes("sg-propertyplus://status"), "status resource");
    console.log(`  PASS: Both resources registered (${mode})\n`);

    // --- Test 3: Read status resource ---
    console.log("--- Test 3: Read status resource ---");
    const statusResult = await client.readResource({ uri: "sg-propertyplus://status" });
    const statusText = (statusResult.contents[0] as { text: string }).text;
    const status = JSON.parse(statusText);
    assert(status.server === "sg-propertyplus", "server name should be sg-propertyplus");
    assert(typeof status.uptimeSeconds === "number", "uptime should be a number");
    console.log(`  Status: ${statusText.slice(0, 80)}...`);
    console.log(`  PASS: Status resource works (${mode})\n`);

    // --- Test 4: Call search_area_by_coords ---
    console.log("--- Test 4: Call search_area_by_coords ---");
    const searchResult = await client.callTool({
      name: "search_area_by_coords",
      arguments: { latitude: 1.3571922, longitude: 103.8503212, radiusMeters: 200 },
    });
    const searchText = extractText(searchResult);
    assert(searchText.includes("Land Use"), "should return land parcel data");
    console.log(`  Result: ${searchText.slice(0, 100)}...`);
    console.log(`  PASS: search_area_by_coords works over HTTP (${mode})\n`);

    // --- Test 5: Call search_hdb_resale ---
    // data.gov.sg rate-limits aggressively — wait 60s before calling to ensure a clean window.
    console.log("--- Test 5: Call search_hdb_resale ---");
    console.log("  Waiting 60s for rate limit cooldown…");
    await sleep(60_000);
    let hdbText = await callHdbWithRetry(client);
    console.log(`  Result: ${hdbText.slice(0, 150)}...`);
    assert(
      hdbText.includes("HDB Resale"),
      "should return HDB resale response (got: " + hdbText.slice(0, 80) + ")",
    );
    console.log(`  PASS: search_hdb_resale works over HTTP (${mode})\n`);
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Session tests — stateful only
// ---------------------------------------------------------------------------

async function runSessionTests() {
  // Test that stateful mode tracks sessions: two clients get different session IDs
  console.log("--- Test 6: Session isolation (stateful only) ---");
  const { client: client1, transport: transport1 } = await createClient();
  const { client: client2, transport: transport2 } = await createClient();

  try {
    const sid1 = transport1.sessionId;
    const sid2 = transport2.sessionId;
    console.log(`  Client 1 session: ${sid1}`);
    console.log(`  Client 2 session: ${sid2}`);
    assert(sid1 !== undefined, "client 1 should have a session ID");
    assert(sid2 !== undefined, "client 2 should have a session ID");
    assert(sid1 !== sid2, "session IDs should be different");
    console.log("  PASS: Each client gets a unique session\n");

    // Test that session termination works
    console.log("--- Test 7: Session termination (stateful only) ---");
    await transport1.terminateSession();
    console.log("  Session 1 terminated via DELETE");
    console.log("  PASS: Session termination accepted\n");
  } finally {
    await client1.close();
    await client2.close();
  }

  // Test that per-session state is isolated: client A's search should not
  // appear in client B's last-search resource.
  console.log("--- Test 8: Per-session state isolation (stateful only) ---");
  const { client: clientA } = await createClient();
  const { client: clientB } = await createClient();

  try {
    // Client A performs a search
    await clientA.callTool({
      name: "search_area_by_coords",
      arguments: { latitude: 1.3571922, longitude: 103.8503212, radiusMeters: 200 },
    });
    console.log("  Client A performed a search");

    // Client A should see results in last-search
    const lastSearchA = await clientA.readResource({ uri: "sg-propertyplus://last-search" });
    const textA = (lastSearchA.contents[0] as { text: string }).text;
    assert(!textA.includes("No searches"), "client A should have search results");
    console.log("  Client A sees its own results in last-search");

    // Client B should NOT see Client A's results
    const lastSearchB = await clientB.readResource({ uri: "sg-propertyplus://last-search" });
    const textB = (lastSearchB.contents[0] as { text: string }).text;
    assert(textB.includes("No searches"), "client B must NOT see client A's results");
    console.log("  Client B sees 'No searches performed yet' — state is isolated");
    console.log("  PASS: Per-session state isolation works\n");
  } finally {
    await clientA.close();
    await clientB.close();
  }
}

async function runDnsRebindingTests() {
  // Test that requests with unexpected Host headers are rejected.
  console.log("--- DNS Rebinding Protection ---");

  // Request with legitimate host should succeed (even if it returns a protocol error)
  const goodRes = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: `127.0.0.1:${HTTP_PORT}` },
    body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
  });
  assert(goodRes.status !== 403, "legitimate Host header should not be rejected");
  console.log(`  Good Host (127.0.0.1:${HTTP_PORT}): ${goodRes.status} — allowed`);

  // Request with a spoofed host should be rejected with 403
  const badRes = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "evil.attacker.com" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
  });
  assert(badRes.status === 403, "spoofed Host header should be rejected with 403");
  console.log("  Bad Host (evil.attacker.com): 403 — blocked");
  console.log("  PASS: DNS rebinding protection works\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function startServer(mode: string): ChildProcess {
  const child = spawn("node", ["dist/index.js"], {
    env: {
      ...process.env,
      TRANSPORT: "http",
      HTTP_MODE: mode,
      HTTP_PORT: String(HTTP_PORT),
      HTTP_HOST: "127.0.0.1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) console.log(`  [server] ${msg}`);
  });

  child.on("error", (err) => {
    console.error("Server process error:", err);
  });

  return child;
}

async function waitForServer(url: string, maxWaitMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      // Any response (even 400) means the server is up
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`Server did not start within ${maxWaitMs}ms`);
}

async function createClient(): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const transport = new StreamableHTTPClientTransport(new URL(BASE_URL));
  const client = new Client(
    { name: "test-http-client", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return { client, transport };
}

async function callHdbWithRetry(client: Client, retries = 2): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const result = await client.callTool({
      name: "search_hdb_resale",
      arguments: { town: "ANG MO KIO", limit: 3 },
    });
    const text = extractText(result);
    if (!text.includes("busy") || attempt === retries) return text;
    console.log(`  Rate limited, retrying in 30s… (attempt ${attempt}/${retries})`);
    await sleep(30_000);
  }
  return ""; // unreachable
}

function extractText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as { type: string; text: string }[])[0]?.text ?? "";
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    process.exit(1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: true });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
