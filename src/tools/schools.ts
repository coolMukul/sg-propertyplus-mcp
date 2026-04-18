// School directory tool — search_school_info.
// Queries MOE General Information of Schools from data.gov.sg.
// Same CKAN pattern as HDB resale. ~337 schools, fetched once and cached.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { querySchools } from "../api/schools.js";
import { SessionState } from "../state.js";
import { SchoolInfo } from "../types.js";
import { formatSchoolTable } from "../formatters.js";
import { type ToolExtra, logInfo, sendProgress } from "../helpers.js";

// Map user-friendly type filter to mainlevel_code patterns
const LEVEL_PATTERNS: Record<string, string[]> = {
  primary: ["PRIMARY"],
  secondary: ["SECONDARY"],
  jc: ["JUNIOR COLLEGE", "CENTRALISED INSTITUTE", "PRE-UNIVERSITY"],
  mixed: ["MIXED"],
};

const DATAGOV_ATTRIBUTION =
  "Contains information from data.gov.sg accessed under the Singapore Open Data Licence";

function matchesLevel(school: SchoolInfo, type: string): boolean {
  const patterns = LEVEL_PATTERNS[type];
  if (!patterns) return true;
  const level = school.level.toUpperCase();
  return patterns.some((p) => level.includes(p));
}

function matchesPrograms(school: SchoolInfo, programs: string[]): boolean {
  return programs.every((prog) => {
    switch (prog) {
      case "sap": return school.sap;
      case "ip": return school.ip;
      case "gifted": return school.gifted;
      case "autonomous": return school.autonomous;
      default: return true;
    }
  });
}

export function registerSchoolTools(server: McpServer, state: SessionState): void {
  server.tool(
    "search_school_info",
    "Search the Singapore school directory. Returns school details including level (primary/secondary/JC), zone, special programs (SAP/IP/GEP/Autonomous), and contact information.",
    {
      schoolName: z
        .string()
        .optional()
        .describe("Partial school name match (case-insensitive)"),
      zone: z
        .enum(["north", "south", "east", "west"])
        .optional()
        .describe("Zone filter: north, south, east, or west"),
      type: z
        .enum(["primary", "secondary", "jc", "mixed"])
        .optional()
        .describe("School level: primary, secondary, jc (junior college), or mixed"),
      specialPrograms: z
        .array(z.enum(["sap", "ip", "gifted", "autonomous"]))
        .optional()
        .describe("Filter by special programs: sap, ip, gifted, autonomous"),
      limit: z
        .coerce.number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum results to return (default 20, max 100)"),
    },
    async ({ schoolName, zone, type, specialPrograms, limit }, extra: ToolExtra) => {
      await logInfo(extra, `search_school_info: name=${schoolName ?? "any"}, zone=${zone ?? "any"}, type=${type ?? "any"}`);

      // 1. Fetch all schools (cached after first call)
      await sendProgress(extra, 0, 2, "Fetching school directory...");
      const { records, error } = await querySchools(
        (delay) => sendProgress(extra, 0, 2, `Waiting for data service (${Math.ceil(delay / 1000)}s)...`),
      );

      if (error) {
        return { content: [{ type: "text" as const, text: error }] };
      }

      // 2. Filter client-side
      await sendProgress(extra, 1, 2, "Filtering results...");
      let filtered = records;

      if (schoolName) {
        const query = schoolName.toUpperCase();
        filtered = filtered.filter((s) => s.schoolName.toUpperCase().includes(query));
      }

      if (zone) {
        const zoneUpper = zone.toUpperCase();
        filtered = filtered.filter((s) => s.zone.toUpperCase() === zoneUpper);
      }

      if (type) {
        filtered = filtered.filter((s) => matchesLevel(s, type));
      }

      if (specialPrograms && specialPrograms.length > 0) {
        filtered = filtered.filter((s) => matchesPrograms(s, specialPrograms));
      }

      // Sort alphabetically by school name
      filtered.sort((a, b) => a.schoolName.localeCompare(b.schoolName));

      // Truncate to limit
      const truncated = filtered.slice(0, limit);

      // 3. Store in state for export
      state.setLastSearch({
        type: "school-info",
        query: { schoolName, zone, type, specialPrograms, limit },
        results: truncated,
        timestamp: new Date().toISOString(),
      });

      await sendProgress(extra, 2, 2, "Done");

      // 4. Build output
      const table = formatSchoolTable(truncated);
      const countLine = filtered.length > limit
        ? `Showing ${truncated.length} of ${filtered.length} matching schools.`
        : `Found ${truncated.length} school${truncated.length === 1 ? "" : "s"}.`;

      const text = `${countLine}\n\n${table}\n\n${DATAGOV_ATTRIBUTION}`;

      return { content: [{ type: "text" as const, text }] };
    },
  );
}
