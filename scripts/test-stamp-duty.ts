/**
 * End-to-end test for calculate_stamp_duty tool.
 * Spawns the server in stdio mode, connects as MCP client,
 * and verifies BSD + ABSD calculations against known expected values.
 *
 * No API key needed — pure computation.
 *
 * Usage: npx tsx scripts/test-stamp-duty.ts
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
  console.log("=== SG-PropertyPlus — Stamp Duty Test ===\n");

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
    { name: "test-stamp-duty-client", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  console.log("Connected to server via stdio.\n");

  try {
    await testToolRegistered(client);
    await testResidentialPrSecond(client);
    await testResidentialScFirst(client);
    await testResidentialForeigner(client);
    await testNonResidential(client);
    await testSmallPurchase(client);
    await testLargePurchase(client);

    console.log("\n=== All stamp duty tests passed! ===");
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Test 1: Tool is registered
// ---------------------------------------------------------------------------
async function testToolRegistered(client: Client) {
  console.log("Test 1: calculate_stamp_duty is registered...");
  const { tools } = await client.listTools();
  const found = tools.find((t) => t.name === "calculate_stamp_duty");
  assert(!!found, "calculate_stamp_duty not found in tool list");
  console.log("  PASS — tool registered\n");
}

// ---------------------------------------------------------------------------
// Test 2: PR second property, $1,500,000 (matches the spec example)
// ---------------------------------------------------------------------------
async function testResidentialPrSecond(client: Client) {
  console.log("Test 2: PR second property, $1,500,000 residential...");
  const result = await client.callTool({
    name: "calculate_stamp_duty",
    arguments: {
      purchasePrice: 1_500_000,
      buyerProfile: "pr_second_plus",
      propertyType: "residential",
    },
  });
  const text = extractText(result);

  // BSD: 1800 + 3600 + 19200 + 20000 = 44600
  assert(text.includes("44,600"), `Expected BSD total $44,600, got:\n${text}`);
  // ABSD: 1,500,000 * 0.30 = 450,000
  assert(text.includes("450,000"), `Expected ABSD $450,000, got:\n${text}`);
  // Total: 44,600 + 450,000 = 494,600
  assert(text.includes("494,600"), `Expected total $494,600, got:\n${text}`);
  // Effective rate: 494600/1500000 = 33.0%
  assert(text.includes("33.0%"), `Expected effective rate 33.0%, got:\n${text}`);

  console.log("  PASS — BSD $44,600 + ABSD $450,000 = $494,600 (33.0%)\n");
}

// ---------------------------------------------------------------------------
// Test 3: SC first property — ABSD should be 0%
// ---------------------------------------------------------------------------
async function testResidentialScFirst(client: Client) {
  console.log("Test 3: SC first property, $800,000 residential...");
  const result = await client.callTool({
    name: "calculate_stamp_duty",
    arguments: {
      purchasePrice: 800_000,
      buyerProfile: "sc_first",
      propertyType: "residential",
    },
  });
  const text = extractText(result);

  // BSD: 1800 + 3600 + (440000 * 0.03) = 1800 + 3600 + 13200 = 18600
  assert(text.includes("18,600"), `Expected BSD total $18,600, got:\n${text}`);
  // ABSD: 0%
  assert(text.includes("Not applicable"), `Expected ABSD not applicable, got:\n${text}`);
  // Total = BSD only
  assert(text.includes("18,600"), `Expected total $18,600, got:\n${text}`);

  console.log("  PASS — BSD $18,600, ABSD not applicable\n");
}

// ---------------------------------------------------------------------------
// Test 4: Foreigner — 60% ABSD
// ---------------------------------------------------------------------------
async function testResidentialForeigner(client: Client) {
  console.log("Test 4: Foreigner, $2,000,000 residential...");
  const result = await client.callTool({
    name: "calculate_stamp_duty",
    arguments: {
      purchasePrice: 2_000_000,
      buyerProfile: "foreigner",
      propertyType: "residential",
    },
  });
  const text = extractText(result);

  // BSD: 1800 + 3600 + 19200 + 20000 + (500000 * 0.05) = 1800+3600+19200+20000+25000 = 69600
  assert(text.includes("69,600"), `Expected BSD total $69,600, got:\n${text}`);
  // ABSD: 2,000,000 * 0.60 = 1,200,000
  assert(text.includes("1,200,000"), `Expected ABSD $1,200,000, got:\n${text}`);
  // Total: 69600 + 1200000 = 1,269,600
  assert(text.includes("1,269,600"), `Expected total $1,269,600, got:\n${text}`);

  console.log("  PASS — BSD $69,600 + ABSD $1,200,000 = $1,269,600\n");
}

// ---------------------------------------------------------------------------
// Test 5: Non-residential — no ABSD, different BSD brackets
// ---------------------------------------------------------------------------
async function testNonResidential(client: Client) {
  console.log("Test 5: Non-residential, $2,000,000...");
  const result = await client.callTool({
    name: "calculate_stamp_duty",
    arguments: {
      purchasePrice: 2_000_000,
      buyerProfile: "sc_first",
      propertyType: "non_residential",
    },
  });
  const text = extractText(result);

  // Non-residential BSD: 1800 + 3600 + 19200 + 20000 + (500000 * 0.05) = 69600
  // Wait — non-residential tops out at 5%, so:
  // 1800 + 3600 + 19200 + 20000 + (500000 * 0.05) = 1800+3600+19200+20000+25000 = 69600
  assert(text.includes("69,600"), `Expected BSD total $69,600, got:\n${text}`);
  // No ABSD section for non-residential
  assert(!text.includes("### ABSD"), `Non-residential should not have ABSD section, got:\n${text}`);
  // Total = BSD only
  assert(text.includes("69,600"), `Expected total $69,600, got:\n${text}`);

  console.log("  PASS — BSD $69,600, no ABSD for non-residential\n");
}

// ---------------------------------------------------------------------------
// Test 6: Small purchase — only hits first bracket
// ---------------------------------------------------------------------------
async function testSmallPurchase(client: Client) {
  console.log("Test 6: Small purchase, $100,000 SC first...");
  const result = await client.callTool({
    name: "calculate_stamp_duty",
    arguments: {
      purchasePrice: 100_000,
      buyerProfile: "sc_first",
    },
  });
  const text = extractText(result);

  // BSD: 100,000 * 0.01 = 1,000
  assert(text.includes("1,000"), `Expected BSD total $1,000, got:\n${text}`);

  console.log("  PASS — BSD $1,000\n");
}

// ---------------------------------------------------------------------------
// Test 7: Large purchase — hits all 6 residential brackets
// ---------------------------------------------------------------------------
async function testLargePurchase(client: Client) {
  console.log("Test 7: Large purchase, $5,000,000 entity...");
  const result = await client.callTool({
    name: "calculate_stamp_duty",
    arguments: {
      purchasePrice: 5_000_000,
      buyerProfile: "entity",
      propertyType: "residential",
    },
  });
  const text = extractText(result);

  // BSD: 1800 + 3600 + 19200 + 20000 + 75000 + (2000000 * 0.06) = 1800+3600+19200+20000+75000+120000 = 239600
  assert(text.includes("239,600"), `Expected BSD total $239,600, got:\n${text}`);
  // ABSD: 5,000,000 * 0.65 = 3,250,000
  assert(text.includes("3,250,000"), `Expected ABSD $3,250,000, got:\n${text}`);
  // Total: 239600 + 3250000 = 3,489,600
  assert(text.includes("3,489,600"), `Expected total $3,489,600, got:\n${text}`);

  console.log("  PASS — BSD $239,600 + ABSD $3,250,000 = $3,489,600\n");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
