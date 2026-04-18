/**
 * End-to-end test for search_population_demographics tool.
 * Spawns the server in stdio mode, connects as MCP client, and verifies
 * demographic data is returned for a known planning area.
 *
 * Hits the live SingStat Table Builder API. No API key required.
 *
 * Usage: npx tsx scripts/test-demographics.ts
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
  console.log("=== SG-PropertyPlus — Demographics Test ===\n");

  console.log("Building project...");
  const { execSync } = await import("node:child_process");
  execSync("npx tsc", { stdio: "inherit" });
  console.log("Build complete.\n");

  const transport = new StdioClientTransport({
    command: "node",
    args: ["--env-file=.env", "dist/index.js"],
  });

  const client = new Client(
    { name: "test-demographics-client", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  console.log("Connected to server via stdio.\n");

  try {
    await testToolRegistered(client);
    await testAngMoKioAllDimensions(client);
    await testSingleCategory(client);
    await testUnknownArea(client);

    console.log("\n=== All demographics tests passed! ===");
  } finally {
    await client.close();
  }
}

async function testToolRegistered(client: Client) {
  console.log("Test 1: search_population_demographics is registered...");
  const { tools } = await client.listTools();
  const found = tools.find((t) => t.name === "search_population_demographics");
  assert(!!found, "search_population_demographics not found in tool list");
  console.log("  PASS — tool registered\n");
}

async function testAngMoKioAllDimensions(client: Client) {
  console.log("Test 2: Ang Mo Kio — all four dimensions...");
  const result = await client.callTool({
    name: "search_population_demographics",
    arguments: { planningArea: "Ang Mo Kio" },
  });
  const text = extractText(result);

  // Header
  assert(
    text.includes("Demographic snapshot — Ang Mo Kio"),
    `Expected header with "Ang Mo Kio", got:\n${text.slice(0, 500)}`,
  );

  // All four dimensions present
  assert(text.includes("Type of Dwelling"), "Missing 'Type of Dwelling' section");
  assert(text.includes("Household Size"), "Missing 'Household Size' section");
  assert(text.includes("Monthly Household Income"), "Missing 'Monthly Household Income' section");
  assert(text.includes("Tenancy"), "Missing 'Tenancy' section");

  // Census 2020 source must appear (case-insensitive since tableType casing varies)
  assert(
    /census\s+of\s+population\s+2020/i.test(text),
    "Expected 'Census of Population 2020' source label",
  );

  // HDB nesting preserved (Ang Mo Kio is HDB-heavy)
  assert(text.includes("HDB Dwellings"), "Missing 'HDB Dwellings' metric");
  assert(text.includes("3-Room Flats"), "Missing nested '3-Room Flats' sub-metric");
  assert(text.includes("4-Room Flats"), "Missing nested '4-Room Flats' sub-metric");

  // Attribution
  assert(
    text.includes("Singapore Department of Statistics"),
    "Missing SingStat attribution line",
  );

  // Percentages rendered
  assert(/\d+\.\d%/.test(text), "Expected at least one percentage value like '84.1%'");

  console.log("  PASS — all four dimensions present with nested HDB breakdown and %-of-total\n");
}

async function testSingleCategory(client: Client) {
  console.log("Test 3: Bedok — dwelling only (single category)...");
  const result = await client.callTool({
    name: "search_population_demographics",
    arguments: { planningArea: "Bedok", categories: ["dwelling"] },
  });
  const text = extractText(result);

  assert(text.includes("Demographic snapshot — Bedok"), "Missing Bedok header");
  assert(text.includes("Type of Dwelling"), "Missing dwelling section");
  assert(!text.includes("Household Size"), "Household Size should NOT be present");
  assert(!text.includes("Monthly Household Income"), "Income should NOT be present");
  assert(!text.includes("Tenancy"), "Tenancy should NOT be present");

  console.log("  PASS — only requested dimension returned\n");
}

async function testUnknownArea(client: Client) {
  console.log("Test 4: Unknown planning area — returns friendly hint...");
  const result = await client.callTool({
    name: "search_population_demographics",
    arguments: { planningArea: "Nonexistentville" },
  });
  const text = extractText(result);

  // Should NOT be a hard error; the tool returns a text message
  assert(
    /no demographic data found/i.test(text),
    `Expected 'No demographic data found' message, got:\n${text.slice(0, 400)}`,
  );

  // Should include hint listing valid areas
  assert(
    /valid planning areas include/i.test(text),
    `Expected 'Valid planning areas include' hint, got:\n${text.slice(0, 400)}`,
  );

  // Hint should mention at least one known area
  const mentionsKnown =
    text.includes("Ang Mo Kio") ||
    text.includes("Bedok") ||
    text.includes("Tampines") ||
    text.includes("Bukit Merah");
  assert(mentionsKnown, `Hint should mention at least one known planning area, got:\n${text}`);

  // Should NOT leak the canonical section headers (no data was found)
  assert(!text.includes("Demographic snapshot —"), "Should not render a snapshot header when no data");
  assert(!text.includes("Census of Population 2020"), "Should not render source line when no data");

  console.log("  PASS — friendly hint returned with valid-area suggestions\n");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
