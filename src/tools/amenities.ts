// Nearby amenities tool — searches for schools, hospitals, parks, MRT stations,
// hawker centres, supermarkets, pharmacies, clinics, and bus stops near a coordinate.
// Uses the Overpass API (OpenStreetMap data under ODbL licence).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { RADIUS_DEFAULT } from "../config.js";
import { queryNearbyAmenities, SUPPORTED_CATEGORIES } from "../api/overpass.js";
import { SessionState } from "../state.js";
import { formatNearbyAmenityTable } from "../formatters.js";
import { type ToolExtra, sendProgress, logInfo, clampRadius } from "../helpers.js";

const OSM_ATTRIBUTION =
  "\n\n---\nData (c) OpenStreetMap contributors — https://www.openstreetmap.org/copyright";

const DEFAULT_AMENITY_LIMIT = 50;

export function registerAmenityTools(server: McpServer, state: SessionState): void {

  server.tool(
    "search_nearby_amenities",
    "Search for nearby amenities (schools, hospitals, clinics, hawker centres, parks, MRT stations, bus stops, supermarkets, pharmacies) around a coordinate in Singapore. Returns results sorted by distance. Requires coordinates — use search_area first to geocode an address if needed.",
    {
      latitude: z.number().min(-90).max(90)
        .describe("Latitude of the search center point"),
      longitude: z.number().min(-180).max(180)
        .describe("Longitude of the search center point"),
      radiusMeters: z.number().optional().default(RADIUS_DEFAULT)
        .describe(`Search radius in meters (default ${RADIUS_DEFAULT}, max 5000)`),
      categories: z.array(z.enum([
        "school", "hospital", "clinic", "food_court", "marketplace",
        "park", "mrt", "bus_stop", "supermarket", "pharmacy",
      ])).optional()
        .describe(
          "Filter by amenity categories. If omitted, searches all types. " +
          "Options: school, hospital, clinic, food_court, marketplace, park, mrt, bus_stop, supermarket, pharmacy",
        ),
      limit: z.number().optional().default(DEFAULT_AMENITY_LIMIT)
        .describe(`Max results to return (default ${DEFAULT_AMENITY_LIMIT})`),
    },
    async (params, extra: ToolExtra) => {
      const { latitude, longitude, limit } = params;
      const radiusMeters = clampRadius(params.radiusMeters);
      const categories = params.categories ?? SUPPORTED_CATEGORIES;

      await logInfo(extra, `search_nearby_amenities: lat=${latitude}, lon=${longitude}, radius=${radiusMeters}m, categories=${categories.join(",")}`);

      await sendProgress(extra, 0, 2, "Searching for nearby amenities…");
      const waitCb = () => logInfo(extra, "search_nearby_amenities: waiting for amenity service…");

      const { amenities, error } = await queryNearbyAmenities(
        latitude, longitude, radiusMeters, categories, waitCb,
      );

      if (error) {
        await logInfo(extra, `search_nearby_amenities: error — ${error}`);
        return { content: [{ type: "text" as const, text: `Failed to search amenities: ${error}` }] };
      }

      await sendProgress(extra, 1, 2, "Formatting results…");

      const truncated = amenities.slice(0, limit);

      await logInfo(extra, `search_nearby_amenities: ${amenities.length} found, returning ${truncated.length}`);

      state.setLastSearch({
        type: "nearby-amenities",
        query: { latitude, longitude, radiusMeters, categories, limit },
        results: truncated,
        timestamp: new Date().toISOString(),
      });

      const table = formatNearbyAmenityTable(truncated);

      // Summarize by category
      const byCat: Record<string, number> = {};
      for (const a of truncated) {
        byCat[a.category] = (byCat[a.category] ?? 0) + 1;
      }
      const catSummary = Object.entries(byCat)
        .map(([cat, count]) => `${count} ${cat.replace("_", " ")}`)
        .join(", ");

      const summary = truncated.length > 0
        ? `Found ${amenities.length} amenities within ${radiusMeters}m` +
          (amenities.length > truncated.length ? ` (showing ${truncated.length})` : "") +
          `. Breakdown: ${catSummary}.`
        : "";

      await sendProgress(extra, 2, 2, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `**Nearby Amenities**\n\n${summary}\n\n${table}${OSM_ATTRIBUTION}`,
        }],
      };
    },
  );
}
