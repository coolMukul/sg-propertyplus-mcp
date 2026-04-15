/**
 * End-to-end test for URA Data Service tools (Phase 7).
 * Spawns the sg-propertyplus server in stdio mode, connects as an MCP client,
 * and verifies all 5 URA tools work correctly.
 *
 * Requires URA_ACCESS_KEY in .env.
 *
 * Usage: npx tsx --env-file=.env scripts/test-ura.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const URA_ACCESS_KEY = process.env.URA_ACCESS_KEY || "";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function extractText(result: unknown): string {
  const r = result as { content: { type: string; text: string }[] };
  return r.content?.[0]?.text ?? "";
}

async function main() {
  console.log("=== SG-PropertyPlus — URA Data Service Test ===\n");

  if (!URA_ACCESS_KEY) {
    console.log("SKIP: URA_ACCESS_KEY not set in .env — cannot test URA tools.");
    console.log("Set URA_ACCESS_KEY and re-run to test.");
    process.exit(0);
  }

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
    { name: "test-ura-client", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  console.log("Connected to server via stdio.\n");

  try {
    await testListTools(client);
    await testTransactions(client);
    await testRentals(client);
    await testDeveloperSales(client);
    await testRentalMedian(client);
    await testPipeline(client);
    await testCarParkAvailability(client);
    await testCarParkRates(client);
    await testSeasonCarParks(client);
    await testPlanningDecisions(client);
    await testResidentialUse(client);
    await testLastSearch(client);

    console.log("\n=== All URA tests passed! ===");
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Test 1: Verify all URA tools are registered
// ---------------------------------------------------------------------------
async function testListTools(client: Client) {
  console.log("--- Test 1: List tools (verify URA tools registered) ---");
  const { tools } = await client.listTools();
  const toolNames = tools.map((t) => t.name);
  console.log(`  Total tools: ${toolNames.length}`);

  const uraTools = [
    "search_private_transactions",
    "search_private_rentals",
    "search_developer_sales",
    "search_rental_median",
    "search_pipeline",
    "search_carpark_availability",
    "search_carpark_rates",
    "search_season_carpark",
    "search_planning_decisions",
    "check_residential_use",
  ];
  for (const name of uraTools) {
    assert(toolNames.includes(name), `${name} must be registered`);
  }
  console.log(`  PASS: All 10 URA tools registered\n`);
}

// ---------------------------------------------------------------------------
// Test 2: search_private_transactions
// ---------------------------------------------------------------------------
async function testTransactions(client: Client) {
  console.log("--- Test 2: search_private_transactions ---");
  const result = await client.callTool({
    name: "search_private_transactions",
    arguments: { district: "09", limit: 3 },
  });
  const text = extractText(result);
  console.log(`  Result: ${text.slice(0, 150)}...`);

  assert(text.includes("Private Property Transactions"), "should include heading");
  assert(text.includes("Urban Redevelopment Authority"), "should include URA attribution");
  console.log("  PASS: search_private_transactions works\n");
}

// ---------------------------------------------------------------------------
// Test 3: search_private_rentals
// ---------------------------------------------------------------------------
async function testRentals(client: Client) {
  console.log("--- Test 3: search_private_rentals ---");
  const result = await client.callTool({
    name: "search_private_rentals",
    arguments: { refPeriod: "24q1", district: "10", limit: 3 },
  });
  const text = extractText(result);
  console.log(`  Result: ${text.slice(0, 150)}...`);

  assert(text.includes("Private Rental Contracts"), "should include heading");
  assert(text.includes("Urban Redevelopment Authority"), "should include URA attribution");
  console.log("  PASS: search_private_rentals works\n");
}

// ---------------------------------------------------------------------------
// Test 4: search_developer_sales
// ---------------------------------------------------------------------------
async function testDeveloperSales(client: Client) {
  console.log("--- Test 4: search_developer_sales ---");
  const result = await client.callTool({
    name: "search_developer_sales",
    arguments: { refPeriod: "0924", limit: 3 },
  });
  const text = extractText(result);
  console.log(`  Result: ${text.slice(0, 150)}...`);

  assert(text.includes("Developer Sales"), "should include heading");
  assert(text.includes("Urban Redevelopment Authority"), "should include URA attribution");
  console.log("  PASS: search_developer_sales works\n");
}

// ---------------------------------------------------------------------------
// Test 5: search_rental_median
// ---------------------------------------------------------------------------
async function testRentalMedian(client: Client) {
  console.log("--- Test 5: search_rental_median ---");
  const result = await client.callTool({
    name: "search_rental_median",
    arguments: { district: "15", limit: 3 },
  });
  const text = extractText(result);
  console.log(`  Result: ${text.slice(0, 150)}...`);

  assert(text.includes("Rental Median"), "should include heading");
  assert(text.includes("Urban Redevelopment Authority"), "should include URA attribution");
  console.log("  PASS: search_rental_median works\n");
}

// ---------------------------------------------------------------------------
// Test 6: search_pipeline
// ---------------------------------------------------------------------------
async function testPipeline(client: Client) {
  console.log("--- Test 6: search_pipeline ---");
  const result = await client.callTool({
    name: "search_pipeline",
    arguments: { limit: 3 },
  });
  const text = extractText(result);
  console.log(`  Result: ${text.slice(0, 150)}...`);

  assert(text.includes("Pipeline"), "should include heading");
  assert(text.includes("Urban Redevelopment Authority"), "should include URA attribution");
  console.log("  PASS: search_pipeline works\n");
}

// ---------------------------------------------------------------------------
// Test 7: search_carpark_availability
// ---------------------------------------------------------------------------
async function testCarParkAvailability(client: Client) {
  console.log("--- Test 7: search_carpark_availability ---");
  const result = await client.callTool({
    name: "search_carpark_availability",
    arguments: { limit: 3 },
  });
  const text = extractText(result);
  console.log(`  Result: ${text.slice(0, 150)}...`);

  assert(text.includes("Car Park Availability"), "should include heading");
  assert(text.includes("Urban Redevelopment Authority"), "should include URA attribution");
  console.log("  PASS: search_carpark_availability works\n");
}

// ---------------------------------------------------------------------------
// Test 8: search_carpark_rates
// ---------------------------------------------------------------------------
async function testCarParkRates(client: Client) {
  console.log("--- Test 8: search_carpark_rates ---");
  const result = await client.callTool({
    name: "search_carpark_rates",
    arguments: { limit: 3 },
  });
  const text = extractText(result);
  console.log(`  Result: ${text.slice(0, 150)}...`);

  assert(text.includes("Car Park Rates"), "should include heading");
  assert(text.includes("Urban Redevelopment Authority"), "should include URA attribution");
  console.log("  PASS: search_carpark_rates works\n");
}

// ---------------------------------------------------------------------------
// Test 9: search_season_carpark
// ---------------------------------------------------------------------------
async function testSeasonCarParks(client: Client) {
  console.log("--- Test 9: search_season_carpark ---");
  const result = await client.callTool({
    name: "search_season_carpark",
    arguments: { limit: 3 },
  });
  const text = extractText(result);
  console.log(`  Result: ${text.slice(0, 150)}...`);

  assert(text.includes("Season Car Park"), "should include heading");
  assert(text.includes("Urban Redevelopment Authority"), "should include URA attribution");
  console.log("  PASS: search_season_carpark works\n");
}

// ---------------------------------------------------------------------------
// Test 10: search_planning_decisions
// ---------------------------------------------------------------------------
async function testPlanningDecisions(client: Client) {
  console.log("--- Test 10: search_planning_decisions (with year) ---");
  const result = await client.callTool({
    name: "search_planning_decisions",
    arguments: { year: "2024", limit: 3 },
  });
  const text = extractText(result);
  console.log(`  Result: ${text.slice(0, 150)}...`);

  assert(text.includes("Planning Decisions"), "should include heading");
  assert(text.includes("Urban Redevelopment Authority"), "should include URA attribution");
  console.log("  PASS: search_planning_decisions works\n");
}

// ---------------------------------------------------------------------------
// Test 11: check_residential_use
// ---------------------------------------------------------------------------
async function testResidentialUse(client: Client) {
  console.log("--- Test 11: check_residential_use ---");
  const result = await client.callTool({
    name: "check_residential_use",
    arguments: { blkHouseNo: "1", street: "COVE DRIVE" },
  });
  const text = extractText(result);
  console.log(`  Result: ${text.slice(0, 200)}`);

  assert(text.includes("Urban Redevelopment Authority"), "should include URA attribution");
  console.log("  PASS: check_residential_use works\n");
}

// ---------------------------------------------------------------------------
// Test 12: last-search resource reflects URA data
// ---------------------------------------------------------------------------
async function testLastSearch(client: Client) {
  console.log("--- Test 12: last-search resource ---");
  const result = await client.readResource({ uri: "sg-propertyplus://last-search" });
  const text = (result.contents[0] as { text: string }).text;
  const data = JSON.parse(text);
  // Last search tool that stores state is planning_decisions (check_residential_use doesn't store)
  assert(data.type === "planning-decision", "last search should be planning-decision");
  assert(Array.isArray(data.results), "results should be an array");
  console.log(`  Last search type: ${data.type}, results: ${data.results.length}`);
  console.log("  PASS: last-search resource reflects URA data\n");
}

main().catch((err) => {
  console.error("\nTEST FAILED:", err.message);
  process.exit(1);
});
