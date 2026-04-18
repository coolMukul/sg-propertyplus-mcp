// Stamp duty calculator — BSD (progressive) + ABSD (flat rate) for Singapore property.
// Rates are hard-coded from IRAS gazetted schedules. No API calls.
//
// BSD residential: effective 15 Feb 2023
// BSD non-residential: effective 15 Feb 2023
// ABSD: effective 27 Apr 2023
// Reference: https://www.iras.gov.sg/taxes/stamp-duty/for-property

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type ToolExtra, logInfo, PROPERTY_DISCLAIMER } from "../helpers.js";

// --- Rate tables ---

interface BsdBracket {
  upTo: number; // cumulative ceiling (Infinity for the last bracket)
  rate: number; // e.g. 0.01 for 1%
}

// Residential BSD — 6 progressive tiers (15 Feb 2023)
const BSD_RESIDENTIAL: BsdBracket[] = [
  { upTo: 180_000, rate: 0.01 },
  { upTo: 360_000, rate: 0.02 },
  { upTo: 1_000_000, rate: 0.03 },
  { upTo: 1_500_000, rate: 0.04 },
  { upTo: 3_000_000, rate: 0.05 },
  { upTo: Infinity, rate: 0.06 },
];

// Non-residential BSD — 5 progressive tiers (15 Feb 2023)
const BSD_NON_RESIDENTIAL: BsdBracket[] = [
  { upTo: 180_000, rate: 0.01 },
  { upTo: 360_000, rate: 0.02 },
  { upTo: 1_000_000, rate: 0.03 },
  { upTo: 1_500_000, rate: 0.04 },
  { upTo: Infinity, rate: 0.05 },
];

// ABSD — flat rate on total price (27 Apr 2023). Residential only.
const ABSD_RATES: Record<string, number> = {
  sc_first: 0,
  sc_second: 0.20,
  sc_third_plus: 0.30,
  pr_first: 0.05,
  pr_second_plus: 0.30,
  foreigner: 0.60,
  entity: 0.65,
};

// Human-readable labels for buyer profiles
const PROFILE_LABELS: Record<string, string> = {
  sc_first: "Singapore Citizen, first property",
  sc_second: "Singapore Citizen, second property",
  sc_third_plus: "Singapore Citizen, third or subsequent property",
  pr_first: "Permanent Resident, first property",
  pr_second_plus: "Permanent Resident, second or subsequent property",
  foreigner: "Foreigner",
  entity: "Entity / trust",
};

// --- Calculation helpers ---

interface BsdBreakdown {
  label: string;   // e.g. "First  $180,000" or "Next   $180,000"
  amount: number;  // taxable amount in this bracket
  rate: number;    // rate as decimal
  duty: number;    // amount × rate, floored to nearest dollar
}

function calculateBsd(price: number, brackets: BsdBracket[]): BsdBreakdown[] {
  const breakdown: BsdBreakdown[] = [];
  let remaining = price;
  let prevCeiling = 0;

  for (const bracket of brackets) {
    if (remaining <= 0) break;

    const bracketSize = bracket.upTo === Infinity
      ? remaining
      : bracket.upTo - prevCeiling;
    const taxable = Math.min(remaining, bracketSize);
    const duty = Math.floor(taxable * bracket.rate);

    const isFirst = prevCeiling === 0;
    const label = isFirst
      ? `First  $${fmtNum(taxable)}`
      : bracket.upTo === Infinity
        ? `Remainder`
        : `Next   $${fmtNum(bracketSize)}`;

    breakdown.push({ label, amount: taxable, rate: bracket.rate, duty });
    remaining -= taxable;
    prevCeiling = bracket.upTo;
  }

  return breakdown;
}

// --- Formatting helpers ---

/** Format number with commas: 1500000 -> "1,500,000" */
function fmtNum(n: number): string {
  return n.toLocaleString("en-SG");
}

/** Format dollar amount right-aligned in a fixed-width field */
function fmtDollar(n: number, width: number): string {
  const s = `$${fmtNum(n)}`;
  return s.padStart(width);
}

/** Format percentage: 0.03 -> "3%" */
function fmtPct(rate: number): string {
  const pct = rate * 100;
  // Avoid floating-point noise: round to 1 decimal, drop trailing .0
  const rounded = Math.round(pct * 10) / 10;
  return rounded % 1 === 0 ? `${rounded}%` : `${rounded}%`;
}

// --- Output builder ---

function buildOutput(
  price: number,
  buyerProfile: string,
  propertyType: string,
  bsdBreakdown: BsdBreakdown[],
): string {
  const bsdTotal = bsdBreakdown.reduce((sum, b) => sum + b.duty, 0);
  const isResidential = propertyType === "residential";
  const absdRate = isResidential ? (ABSD_RATES[buyerProfile] ?? 0) : 0;
  const absdAmount = Math.floor(price * absdRate);
  const totalDuty = bsdTotal + absdAmount;
  const effectiveRate = price > 0 ? ((totalDuty / price) * 100).toFixed(1) : "0.0";

  const lines: string[] = [];

  // Header
  lines.push("## Stamp Duty Estimate");
  lines.push("");
  lines.push(`Purchase price:     $${fmtNum(price)}`);
  lines.push(`Buyer profile:      ${PROFILE_LABELS[buyerProfile] ?? buyerProfile}`);
  lines.push(`Property type:      ${isResidential ? "Residential" : "Non-residential"}`);
  lines.push(`Rates applied:      ${isResidential ? "BSD (15 Feb 2023), ABSD (27 Apr 2023)" : "BSD (15 Feb 2023)"}`);
  lines.push("");

  // BSD section
  lines.push("### BSD (progressive)");
  for (const b of bsdBreakdown) {
    const labelPad = b.label.padEnd(20);
    const ratePad = `× ${fmtPct(b.rate)}`.padEnd(8);
    lines.push(`  ${labelPad} ${ratePad} = ${fmtDollar(b.duty, 10)}`);
  }
  lines.push(`  ${"BSD total:".padEnd(20)}          ${fmtDollar(bsdTotal, 10)}`);

  // ABSD section (residential only)
  if (isResidential) {
    lines.push("");
    lines.push("### ABSD (flat rate)");
    if (absdRate === 0) {
      lines.push(`  Not applicable (${PROFILE_LABELS[buyerProfile]})`);
    } else {
      const priceStr = `$${fmtNum(price)}`;
      const rateStr = fmtPct(absdRate);
      lines.push(`  ${priceStr} × ${rateStr}`.padEnd(30) + ` = ${fmtDollar(absdAmount, 10)}`);
    }
  }

  // Total section
  lines.push("");
  lines.push("### Estimated Total");
  lines.push(`  Total stamp duty:           ${fmtDollar(totalDuty, 10)}`);
  lines.push(`  Effective rate:              ${effectiveRate}% of purchase price`);

  // Disclaimer
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("**This is an estimate only.** Actual stamp duty may differ based on remissions, reliefs, or rate changes after the dates shown above. Verify with IRAS or a qualified professional before making financial decisions.");
  lines.push(PROPERTY_DISCLAIMER);

  return lines.join("\n");
}

// --- Tool registration ---

export function registerStampDutyTools(server: McpServer): void {
  server.tool(
    "calculate_stamp_duty",
    "Calculate Buyer's Stamp Duty (BSD) and Additional Buyer's Stamp Duty (ABSD) for a Singapore property purchase. Uses current gazetted rates — prefer this over training-data rates, which may be outdated.",
    {
      purchasePrice: z
        .coerce.number()
        .positive()
        .describe("Purchase price or market value in SGD (whichever is higher)"),
      buyerProfile: z
        .enum([
          "sc_first",
          "sc_second",
          "sc_third_plus",
          "pr_first",
          "pr_second_plus",
          "foreigner",
          "entity",
        ])
        .describe(
          "Buyer profile: sc_first (SG Citizen 1st property), sc_second, sc_third_plus, pr_first (PR 1st property), pr_second_plus, foreigner, entity",
        ),
      propertyType: z
        .enum(["residential", "non_residential"])
        .default("residential")
        .describe("Property type (default: residential). ABSD only applies to residential properties."),
    },
    async ({ purchasePrice, buyerProfile, propertyType }, extra: ToolExtra) => {
      await logInfo(
        extra,
        `calculate_stamp_duty: price=$${fmtNum(purchasePrice)}, profile=${buyerProfile}, type=${propertyType}`,
      );

      const brackets = propertyType === "residential" ? BSD_RESIDENTIAL : BSD_NON_RESIDENTIAL;
      const bsdBreakdown = calculateBsd(purchasePrice, brackets);
      const output = buildOutput(purchasePrice, buyerProfile, propertyType, bsdBreakdown);

      return {
        content: [{ type: "text" as const, text: output }],
      };
    },
  );
}
