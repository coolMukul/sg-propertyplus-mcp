/**
 * End-to-end test for MCP roots (Phase 4).
 * Spawns the sg-propertyplus server as a child process, connects as an MCP client
 * that supports roots, and verifies that export_csv respects root permissions.
 *
 * Usage: npx tsx scripts/test-roots.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function main() {
  console.log("=== SG-PropertyPlus — Roots Test ===\n");

  // Create a temp directory to serve as the allowed root
  const allowedDir = await mkdtemp(path.join(tmpdir(), "sg-propertyplus-test-"));
  console.log(`Temp allowed root: ${allowedDir}\n`);

  try {
    await runTests(allowedDir);
  } finally {
    // Cleanup temp directory
    await rm(allowedDir, { recursive: true, force: true });
    console.log("Cleaned up temp directory.");
  }
}

async function runTests(allowedDir: string) {
  // --- Connect to server ---

  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
    env: { ...process.env } as Record<string, string>,
  });

  const client = new Client(
    { name: "test-roots-client", version: "0.1.0" },
    { capabilities: { roots: { listChanged: true } } },
  );

  // --- Register roots/list handler ---
  // When the server calls listRoots(), we respond with our allowed directory.

  let rootsRequestCount = 0;

  client.setRequestHandler(ListRootsRequestSchema, async () => {
    rootsRequestCount++;
    console.log(`  [roots] Server requested roots/list (call #${rootsRequestCount})`);
    return {
      roots: [
        {
          uri: pathToFileURL(allowedDir).href,
          name: "Test export directory",
        },
      ],
    };
  });

  console.log("Connecting to server...");
  await client.connect(transport);
  console.log("Connected!\n");

  // --- Step 1: Verify export_csv tool is registered ---

  console.log("--- Step 1: Verify tools ---");
  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name);
  console.log(`  Tools: ${toolNames.join(", ")}`);
  assert(toolNames.includes("export_csv"), "export_csv tool must be registered");
  console.log("  PASS: export_csv is registered\n");

  // --- Step 2: Test export with no prior search ---

  console.log("--- Step 2: Export with no prior search ---");
  const noSearchResult = await client.callTool({
    name: "export_csv",
    arguments: { filePath: path.join(allowedDir, "empty.csv") },
  });
  const noSearchText = extractText(noSearchResult);
  console.log(`  Result: "${noSearchText}"`);
  assert(
    noSearchText.includes("No search results"),
    "should report no results to export",
  );
  console.log("  PASS: Correctly rejected (no search data)\n");

  // --- Step 3: Populate state via search_area_by_coords ---

  console.log("--- Step 3: Populate state ---");
  const searchResult = await client.callTool({
    name: "search_area_by_coords",
    arguments: { latitude: 1.3571922, longitude: 103.8503212, radiusMeters: 200 },
  });
  const searchText = extractText(searchResult);
  assert(searchText.includes("Land Use"), "search should return land parcel data");
  console.log("  PASS: State populated with land use data\n");

  // --- Step 4: Export to an ALLOWED path ---

  console.log("--- Step 4: Export to allowed path ---");
  rootsRequestCount = 0;
  const allowedPath = path.join(allowedDir, "results.csv");
  const exportResult = await client.callTool({
    name: "export_csv",
    arguments: { filePath: allowedPath },
  });
  const exportText = extractText(exportResult);
  console.log(`  Result: "${exportText.slice(0, 120)}..."`);
  assert(rootsRequestCount > 0, "server must have called listRoots()");
  assert(exportText.includes("Exported"), "should confirm successful export");
  assert(exportText.includes("land parcel"), "should identify data type");

  // Verify the file was actually written and contains CSV data
  const csvContent = await readFile(allowedPath, "utf-8");
  assert(csvContent.startsWith("Land Use,"), "CSV must start with header row");
  assert(csvContent.includes(","), "CSV must contain comma-separated data");
  const csvLines = csvContent.split("\n");
  assert(csvLines.length > 1, "CSV must have header + at least one data row");
  console.log(`  CSV file: ${csvLines.length} lines (1 header + ${csvLines.length - 1} data rows)`);
  console.log("  PASS: File written successfully to allowed directory\n");

  // --- Step 5: Export to a DENIED path ---

  console.log("--- Step 5: Export to denied path ---");
  const deniedPath = path.join(tmpdir(), "not-allowed", "results.csv");
  const deniedResult = await client.callTool({
    name: "export_csv",
    arguments: { filePath: deniedPath },
  });
  const deniedText = extractText(deniedResult);
  console.log(`  Result: "${deniedText.slice(0, 150)}..."`);
  assert(deniedText.includes("Cannot write"), "should deny the write");
  assert(deniedText.includes("not within any allowed"), "should explain why it was denied");
  assert(deniedText.includes("Allowed directories"), "should list allowed directories");
  console.log("  PASS: Correctly denied write to disallowed path\n");

  // --- Step 6: Export to a subdirectory of the allowed root ---

  console.log("--- Step 6: Export to subdirectory of allowed root ---");
  const subPath = path.join(allowedDir, "subdir", "nested.csv");
  const subResult = await client.callTool({
    name: "export_csv",
    arguments: { filePath: subPath },
  });
  const subText = extractText(subResult);
  console.log(`  Result: "${subText.slice(0, 120)}..."`);
  assert(subText.includes("Exported"), "subdirectory export should succeed");

  // Verify subdirectory was created and file written
  const subContent = await readFile(subPath, "utf-8");
  assert(subContent.startsWith("Land Use,"), "CSV in subdirectory must have correct header");
  console.log("  PASS: Subdirectory creation and export works\n");

  // --- Done ---

  console.log(`=== All roots tests passed! (${rootsRequestCount} total roots/list calls) ===`);
  await client.close();
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

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
