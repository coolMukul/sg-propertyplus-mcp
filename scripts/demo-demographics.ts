// One-shot demo: print the demographic snapshot for a planning area.
// Use to eyeball the markdown output quality.
//   npx tsx scripts/demo-demographics.ts "Ang Mo Kio"

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const area = process.argv[2] ?? "Ang Mo Kio";

  const { execSync } = await import("node:child_process");
  execSync("npx tsc", { stdio: "inherit" });

  const transport = new StdioClientTransport({
    command: "node",
    args: ["--env-file=.env", "dist/index.js"],
  });

  const client = new Client(
    { name: "demo-demographics", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  try {
    const result = await client.callTool({
      name: "search_population_demographics",
      arguments: { planningArea: area },
    });
    const text = (result as any).content?.[0]?.text ?? "";
    console.log("\n" + text);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
