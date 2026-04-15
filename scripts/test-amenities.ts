/**
 * End-to-end test for Phase 8 — Nearby Amenities (Overpass API).
 * Spawns the sg-propertyplus server in stdio mode, connects as an MCP client,
 * and verifies the search_nearby_amenities tool works correctly.
 *
 * No API key needed — Overpass is free/zero-key.
 *
 * Usage: npx tsx scripts/test-amenities.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function extractText(result: unknown): string {
  const r = result as { content: { type: string; text: string }[] };
  return r.content?.[0]?.text ?? "";
}

async function main() {
  console.log("=== SG-PropertyPlus — Nearby Amenities Test (Phase 8) ===\n");

  // Build
  console.log("Building project...");
  const { execSync } = await import("node:child_process");
  execSync("npx tsc", { stdio: "inherit" });
  console.log("Build complete.\n");

  // Spawn server in stdio mode
  const transport = new StdioClientTransport({
    command: "node",
    args: ["--env-file=.env", "dist/index.js"],
  });

  const client = new Client(
    { name: "test-amenities-client", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  console.log("Connected to server via stdio.\n");

  try {
    await testToolRegistered(client);
    await testAllCategories(client);
    await testFilteredCategories(client);
    await testLastSearchResource(client);

    console.log("\n=== All amenity tests passed! ===");
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Test 1: Verify search_nearby_amenities is registered
// ---------------------------------------------------------------------------
async function testToolRegistered(client: Client) {
  console.log("--- Test 1: Tool registration ---");
  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name);
  assert(toolNames.includes("search_nearby_amenities"), "search_nearby_amenities must be registered");

  const tool = tools.find((t) => t.name === "search_nearby_amenities")!;
  console.log(`  Description: ${tool.description?.slice(0, 100)}...`);
  console.log(`  Total tools registered: ${toolNames.length}`);
  console.log("  PASS: search_nearby_amenities is registered\n");
}

// ---------------------------------------------------------------------------
// Test 2: Search all categories near Ang Mo Kio Hub (1.3691, 103.8454)
// ---------------------------------------------------------------------------
async function testAllCategories(client: Client) {
  console.log("--- Test 2: Search all categories (Ang Mo Kio, 1km) ---");
  const result = await client.callTool({
    name: "search_nearby_amenities",
    arguments: {
      latitude: 1.3691,
      longitude: 103.8454,
      radiusMeters: 1000,
      limit: 20,
    },
  });
  const text = extractText(result);
  console.log(`  Result preview: ${text.slice(0, 200)}...`);

  assert(text.includes("Nearby Amenities"), "should include heading");
  assert(text.includes("OpenStreetMap contributors"), "should include OSM attribution");
  assert(text.includes("|"), "should contain a markdown table");
  // Ang Mo Kio is a well-populated area — we should find several categories
  assert(!text.includes("No nearby amenities found"), "should find amenities in Ang Mo Kio");
  console.log("  PASS: All-category search works\n");
}

// ---------------------------------------------------------------------------
// Test 3: Search only parks and MRT near Ang Mo Kio
// ---------------------------------------------------------------------------
async function testFilteredCategories(client: Client) {
  console.log("--- Test 3: Filtered categories (parks + MRT only) ---");
  const result = await client.callTool({
    name: "search_nearby_amenities",
    arguments: {
      latitude: 1.3691,
      longitude: 103.8454,
      radiusMeters: 1000,
      categories: ["park", "mrt"],
      limit: 10,
    },
  });
  const text = extractText(result);
  console.log(`  Result preview: ${text.slice(0, 200)}...`);

  assert(text.includes("Nearby Amenities"), "should include heading");
  assert(text.includes("OpenStreetMap contributors"), "should include OSM attribution");
  // Should NOT find schools, hospitals, etc. — only parks and MRT
  assert(!text.includes("School"), "should not include schools when filtered to park+mrt");
  assert(!text.includes("Supermarket"), "should not include supermarkets when filtered to park+mrt");
  console.log("  PASS: Category filtering works\n");
}

// ---------------------------------------------------------------------------
// Test 4: last-search resource reflects amenity search
// ---------------------------------------------------------------------------
async function testLastSearchResource(client: Client) {
  console.log("--- Test 4: last-search resource ---");
  const result = await client.readResource({ uri: "sg-propertyplus://last-search" });
  const text = (result.contents[0] as { text: string }).text;
  const data = JSON.parse(text);
  assert(data.type === "nearby-amenities", `last search type should be nearby-amenities, got: ${data.type}`);
  assert(Array.isArray(data.results), "results should be an array");
  assert(data.results.length > 0, "should have results");

  // Verify shape of a result
  const first = data.results[0];
  assert(typeof first.category === "string", "result should have category");
  assert(typeof first.name === "string", "result should have name");
  assert(typeof first.lat === "number", "result should have lat");
  assert(typeof first.lon === "number", "result should have lon");
  assert(typeof first.distanceMeters === "number", "result should have distanceMeters");
  console.log(`  Last search type: ${data.type}, results: ${data.results.length}`);
  console.log(`  First result: ${first.category} — ${first.name} (${first.distanceMeters}m)`);
  console.log("  PASS: last-search resource reflects amenity data\n");
}

main().catch((err) => {
  console.error("\nTEST FAILED:", err.message);
  process.exit(1);
});
