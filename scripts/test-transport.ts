/**
 * End-to-end test for Phase 9 — Transport Proximity (LTA DataMall).
 * Spawns the sg-propertyplus server in stdio mode, connects as an MCP client,
 * and verifies all 3 transport tools work correctly.
 *
 * Requires LTA_ACCOUNT_KEY in .env.
 *
 * Usage: npx tsx --env-file=.env scripts/test-transport.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const LTA_ACCOUNT_KEY = process.env.LTA_ACCOUNT_KEY || "";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function extractText(result: unknown): string {
  const r = result as { content: { type: string; text: string }[] };
  return r.content?.[0]?.text ?? "";
}

async function main() {
  console.log("=== SG-PropertyPlus — Transport Proximity Test (Phase 9) ===\n");

  if (!LTA_ACCOUNT_KEY) {
    console.log("SKIP: LTA_ACCOUNT_KEY not set in .env — cannot test transport tools.");
    process.exit(0);
  }

  // Build
  console.log("Building project...");
  const { execSync } = await import("node:child_process");
  execSync("npx tsc", { stdio: "inherit" });
  console.log("Build complete.\n");

  // Spawn server
  const transport = new StdioClientTransport({
    command: "node",
    args: ["--env-file=.env", "dist/index.js"],
  });

  const client = new Client(
    { name: "test-transport-client", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  console.log("Connected to server via stdio.\n");

  try {
    await testToolsRegistered(client);
    await testNearestTransport(client);
    await testBusArrival(client);
    await testTaxiAvailability(client);
    await testLastSearchResource(client);

    console.log("\n=== All transport tests passed! ===");
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Test 1: Verify all 3 transport tools are registered
// ---------------------------------------------------------------------------
async function testToolsRegistered(client: Client) {
  console.log("--- Test 1: Tool registration ---");
  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name);

  const transportTools = [
    "search_nearest_transport",
    "search_bus_arrival",
    "search_taxi_availability",
  ];
  for (const name of transportTools) {
    assert(toolNames.includes(name), `${name} must be registered`);
  }
  console.log(`  Total tools registered: ${toolNames.length}`);
  console.log("  PASS: All 3 transport tools registered\n");
}

// ---------------------------------------------------------------------------
// Test 2: search_nearest_transport near Ang Mo Kio Hub
// ---------------------------------------------------------------------------
async function testNearestTransport(client: Client) {
  console.log("--- Test 2: search_nearest_transport (Ang Mo Kio, 500m) ---");
  const result = await client.callTool({
    name: "search_nearest_transport",
    arguments: {
      latitude: 1.3691,
      longitude: 103.8454,
      radiusMeters: 500,
      limit: 10,
    },
  });
  const text = extractText(result);
  console.log(`  Result preview: ${text.slice(0, 250)}...`);

  assert(text.includes("Nearest Transport"), "should include heading");
  assert(text.includes("Bus Stops"), "should include bus stops section");
  assert(text.includes("Taxi Stands"), "should include taxi stands section");
  assert(text.includes("LTA DataMall"), "should include LTA attribution");
  assert(text.includes("bus stop"), "should find bus stops near Ang Mo Kio");
  console.log("  PASS: search_nearest_transport works\n");
}

// ---------------------------------------------------------------------------
// Test 3: search_bus_arrival at a known stop (Ang Mo Kio Int = 54009)
// ---------------------------------------------------------------------------
async function testBusArrival(client: Client) {
  console.log("--- Test 3: search_bus_arrival (stop 54009 — Ang Mo Kio Int) ---");
  const result = await client.callTool({
    name: "search_bus_arrival",
    arguments: { busStopCode: "54009" },
  });
  const text = extractText(result);
  console.log(`  Result preview: ${text.slice(0, 250)}...`);

  assert(text.includes("Bus Arrival"), "should include heading");
  assert(text.includes("54009"), "should reference the bus stop code");
  assert(text.includes("LTA DataMall"), "should include LTA attribution");
  // Ang Mo Kio Interchange has many services — should find at least some
  assert(!text.includes("No bus services found"), "should find services at AMK Int");
  console.log("  PASS: search_bus_arrival works\n");
}

// ---------------------------------------------------------------------------
// Test 4: search_taxi_availability near Ang Mo Kio
// ---------------------------------------------------------------------------
async function testTaxiAvailability(client: Client) {
  console.log("--- Test 4: search_taxi_availability (Ang Mo Kio, 2km) ---");
  const result = await client.callTool({
    name: "search_taxi_availability",
    arguments: {
      latitude: 1.3691,
      longitude: 103.8454,
      radiusMeters: 2000,
    },
  });
  const text = extractText(result);
  console.log(`  Result: ${text.slice(0, 200)}`);

  assert(text.includes("Taxi Availability"), "should include heading");
  assert(text.includes("LTA DataMall"), "should include LTA attribution");
  // Should find at least some taxis (it's Singapore, there are always taxis)
  assert(text.includes("taxi"), "should mention taxis");
  console.log("  PASS: search_taxi_availability works\n");
}

// ---------------------------------------------------------------------------
// Test 5: last-search resource reflects transport data
// ---------------------------------------------------------------------------
async function testLastSearchResource(client: Client) {
  console.log("--- Test 5: last-search resource ---");
  const result = await client.readResource({ uri: "sg-propertyplus://last-search" });
  const text = (result.contents[0] as { text: string }).text;
  const data = JSON.parse(text);
  // Last tool that stores state is taxi-availability — but it doesn't store results.
  // The bus-arrival stores services. Let's check for any transport type.
  const validTypes = ["nearest-transport", "bus-arrival", "taxi-availability"];
  assert(validTypes.includes(data.type), `last search should be a transport type, got: ${data.type}`);
  assert(data.results !== undefined, "should have results");
  console.log(`  Last search type: ${data.type}, results: ${data.results?.length ?? "N/A"}`);
  console.log("  PASS: last-search resource reflects transport data\n");
}

main().catch((err) => {
  console.error("\nTEST FAILED:", err.message);
  process.exit(1);
});
