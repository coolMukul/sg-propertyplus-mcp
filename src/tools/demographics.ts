// Demographics tool — search_population_demographics.
// Fetches Census-based demographic data for a Singapore planning area.
// Covers household count, household size, dwelling mix, income bands, and
// ownership/rental tenancy split. Data sourced from Census of Population 2020.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  queryDemographicDimension,
  listPlanningAreas,
  DEMOGRAPHIC_TABLES,
  type DemographicCategory,
} from "../api/singstat.js";
import { SessionState } from "../state.js";
import type { DemographicSnapshot, DemographicDimension } from "../types.js";
import { formatDemographicSnapshot } from "../formatters.js";
import { type ToolExtra, logInfo, sendProgress } from "../helpers.js";

const SINGSTAT_ATTRIBUTION =
  "Data from Singapore Department of Statistics — https://www.singstat.gov.sg";

const ALL_CATEGORIES: DemographicCategory[] = [
  "dwelling",
  "size",
  "income",
  "tenancy",
];

export function registerDemographicsTools(server: McpServer, state: SessionState): void {
  server.tool(
    "search_population_demographics",
    "Look up Census-based demographic data for a Singapore planning area (e.g. Ang Mo Kio, Bedok, Tampines). Returns household count, household size distribution, type-of-dwelling mix (HDB vs condo vs landed), monthly household income bands, and owner-occupied vs rented split. Useful for understanding the demographic profile of a neighbourhood when evaluating a property.",
    {
      planningArea: z
        .string()
        .min(2)
        .describe("Planning area name, e.g. 'Ang Mo Kio', 'Bedok', 'Tampines' (case-insensitive)"),
      categories: z
        .array(z.enum(["dwelling", "size", "income", "tenancy"]))
        .optional()
        .describe("Which demographic dimensions to fetch. Defaults to all four."),
    },
    async ({ planningArea, categories }, extra: ToolExtra) => {
      await logInfo(extra, `search_population_demographics: area="${planningArea}", categories=${(categories ?? ALL_CATEGORIES).join(",")}`);

      const cats = categories && categories.length > 0 ? categories : ALL_CATEGORIES;

      const dimensions: DemographicDimension[] = [];
      const unavailable: string[] = [];

      let step = 0;
      for (const cat of cats) {
        step += 1;
        await sendProgress(extra, step - 1, cats.length, `Fetching ${DEMOGRAPHIC_TABLES[cat].label}...`);
        const { dimension, error } = await queryDemographicDimension(cat, planningArea);
        if (dimension) {
          dimensions.push(dimension);
        } else {
          unavailable.push(DEMOGRAPHIC_TABLES[cat].label);
          if (error) console.error(`[demographics] ${cat}: ${error}`);
        }
      }

      await sendProgress(extra, cats.length, cats.length, "Done");

      // If nothing came back, offer a hint about valid planning area names.
      if (dimensions.length === 0) {
        const areas = await listPlanningAreas("dwelling");
        const hint = areas.length > 0
          ? `\n\nValid planning areas include: ${areas.slice(0, 15).join(", ")}${areas.length > 15 ? ", ..." : ""}.`
          : "";
        return {
          content: [{
            type: "text" as const,
            text: `No demographic data found for "${planningArea}". Check the spelling — planning area names must match URA/Census designations.${hint}`,
          }],
        };
      }

      // Canonicalise the planning area name using whatever the source returned.
      // The first dimension's row was matched against the user's input; re-read
      // the total row's planning-area label by listing areas and finding the
      // best match. Cheap since the table is cached.
      const allAreas = await listPlanningAreas("dwelling");
      const canonical = allAreas.find(
        (a) => a.toLowerCase() === planningArea.toLowerCase(),
      ) ?? allAreas.find(
        (a) => a.toLowerCase().includes(planningArea.toLowerCase()),
      ) ?? planningArea;

      const snapshot: DemographicSnapshot = {
        planningArea: canonical,
        dimensions,
        unavailable,
      };

      state.setLastSearch({
        type: "demographics",
        query: { planningArea: canonical, categories: cats },
        results: [snapshot],
        timestamp: new Date().toISOString(),
      });

      const body = formatDemographicSnapshot(snapshot);
      const text = `${body}\n\n${SINGSTAT_ATTRIBUTION}`;

      return { content: [{ type: "text" as const, text }] };
    },
  );
}
