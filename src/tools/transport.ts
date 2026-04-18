// Transport proximity tools — bus stops, bus arrival, taxi stands/availability.
// Uses LTA DataMall API (free registration, permanent AccountKey).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { RADIUS_DEFAULT } from "../config.js";
import {
  isLtaConfigured,
  queryNearbyBusStops,
  queryBusArrival,
  queryNearbyTaxiStands,
  queryNearbyTaxis,
} from "../api/lta.js";
import { SessionState } from "../state.js";
import {
  formatBusStopTable,
  formatBusArrivalTable,
  formatTaxiStandTable,
} from "../formatters.js";
import { type ToolExtra, sendProgress, logInfo, clampRadius } from "../helpers.js";

const LTA_ATTRIBUTION =
  "\n\n---\nContains information from LTA DataMall accessed under the Singapore Open Data Licence — https://datamall.lta.gov.sg";

function credentialError(): { content: { type: "text"; text: string }[] } {
  return {
    content: [{
      type: "text" as const,
      text: "This feature requires API credentials. Check your server's environment configuration.",
    }],
  };
}

export function registerTransportTools(server: McpServer, state: SessionState): void {

  // -------------------------------------------------------------------------
  // search_nearest_transport — bus stops + taxi stands near a coordinate
  // -------------------------------------------------------------------------
  server.tool(
    "search_nearest_transport",
    "Find the nearest bus stops and taxi stands around a coordinate in Singapore. Returns bus stop codes (for looking up live arrival times), road names, and taxi stand locations sorted by distance.",
    {
      latitude: z.coerce.number().min(-90).max(90)
        .describe("Latitude of the search center point"),
      longitude: z.coerce.number().min(-180).max(180)
        .describe("Longitude of the search center point"),
      radiusMeters: z.coerce.number().optional().default(RADIUS_DEFAULT)
        .describe(`Search radius in meters (default ${RADIUS_DEFAULT}, max 5000)`),
      limit: z.coerce.number().optional().default(20)
        .describe("Max results per category (default 20)"),
    },
    async (params, extra: ToolExtra) => {
      const { latitude, longitude, limit } = params;
      const radiusMeters = clampRadius(params.radiusMeters);

      await logInfo(extra, `search_nearest_transport: lat=${latitude}, lon=${longitude}, radius=${radiusMeters}m`);

      if (!isLtaConfigured()) return credentialError();

      // Fetch bus stops and taxi stands in parallel
      await sendProgress(extra, 0, 3, "Fetching transport data…");
      const waitCb = () => logInfo(extra, "search_nearest_transport: waiting for transport service…");
      const progressCb = (n: number) => logInfo(extra, `search_nearest_transport: loaded ${n} bus stops…`);

      const [busResult, taxiResult] = await Promise.all([
        queryNearbyBusStops(latitude, longitude, radiusMeters, progressCb, waitCb),
        queryNearbyTaxiStands(latitude, longitude, radiusMeters, waitCb),
      ]);

      await sendProgress(extra, 2, 3, "Formatting results…");

      const busStops = busResult.stops.slice(0, limit);
      const taxiStands = taxiResult.stands.slice(0, limit);

      await logInfo(extra, `search_nearest_transport: ${busResult.stops.length} bus stops, ${taxiResult.stands.length} taxi stands`);

      // Store bus stops as the main result (more useful for follow-up queries)
      state.setLastSearch({
        type: "nearest-transport",
        query: { latitude, longitude, radiusMeters, limit },
        results: busStops,
        timestamp: new Date().toISOString(),
      });

      const busTable = formatBusStopTable(busStops);
      const taxiTable = formatTaxiStandTable(taxiStands);

      const busSummary = busResult.stops.length > 0
        ? `${busResult.stops.length} bus stop${busResult.stops.length !== 1 ? "s" : ""} within ${radiusMeters}m` +
          (busResult.stops.length > busStops.length ? ` (showing ${busStops.length})` : "")
        : "No bus stops found";

      const taxiSummary = taxiResult.stands.length > 0
        ? `${taxiResult.stands.length} taxi stand${taxiResult.stands.length !== 1 ? "s" : ""} within ${radiusMeters}m` +
          (taxiResult.stands.length > taxiStands.length ? ` (showing ${taxiStands.length})` : "")
        : "No taxi stands found";

      const errors: string[] = [];
      if (busResult.error) errors.push(`Bus stops: ${busResult.error}`);
      if (taxiResult.error) errors.push(`Taxi stands: ${taxiResult.error}`);
      const errorText = errors.length > 0 ? `\n\n**Errors:** ${errors.join("; ")}` : "";

      await sendProgress(extra, 3, 3, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `**Nearest Transport**\n\n${busSummary}. ${taxiSummary}.\n\n### Bus Stops\n\n${busTable}\n\n### Taxi Stands\n\n${taxiTable}${errorText}${LTA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_bus_arrival — real-time arrival times at a specific bus stop
  // -------------------------------------------------------------------------
  server.tool(
    "search_bus_arrival",
    "Get real-time bus arrival times at a specific bus stop in Singapore. Shows estimated arrival in minutes, crowding level, and bus type for the next 3 buses of each service. Use search_nearest_transport first to find bus stop codes.",
    {
      busStopCode: z.string()
        .describe("5-digit bus stop code (e.g. '54241'). Use search_nearest_transport to find codes."),
    },
    async (params, extra: ToolExtra) => {
      const { busStopCode } = params;

      await logInfo(extra, `search_bus_arrival: stop=${busStopCode}`);

      if (!isLtaConfigured()) return credentialError();

      await sendProgress(extra, 0, 1, "Fetching arrival times…");
      const waitCb = () => logInfo(extra, "search_bus_arrival: waiting for transport service…");

      const { services, error } = await queryBusArrival(busStopCode, waitCb);

      if (error) {
        await logInfo(extra, `search_bus_arrival: error — ${error}`);
        return { content: [{ type: "text" as const, text: `Failed to fetch arrival data: ${error}` }] };
      }

      await logInfo(extra, `search_bus_arrival: ${services.length} services at stop ${busStopCode}`);

      state.setLastSearch({
        type: "bus-arrival",
        query: { busStopCode },
        results: services,
        timestamp: new Date().toISOString(),
      });

      const table = formatBusArrivalTable(services);
      const summary = services.length > 0
        ? `${services.length} bus service${services.length !== 1 ? "s" : ""} at stop ${busStopCode}.`
        : "";

      await sendProgress(extra, 1, 1, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `**Bus Arrival — Stop ${busStopCode}**\n\n${summary}\n\n${table}${LTA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_taxi_availability — real-time taxi count near a coordinate
  // -------------------------------------------------------------------------
  server.tool(
    "search_taxi_availability",
    "Check how many taxis are currently available for hire near a coordinate in Singapore. Shows real-time count and distance to the nearest available taxi.",
    {
      latitude: z.coerce.number().min(-90).max(90)
        .describe("Latitude of the search center point"),
      longitude: z.coerce.number().min(-180).max(180)
        .describe("Longitude of the search center point"),
      radiusMeters: z.coerce.number().optional().default(2000)
        .describe("Search radius in meters (default 2000, max 5000)"),
    },
    async (params, extra: ToolExtra) => {
      const { latitude, longitude } = params;
      const radiusMeters = clampRadius(params.radiusMeters);

      await logInfo(extra, `search_taxi_availability: lat=${latitude}, lon=${longitude}, radius=${radiusMeters}m`);

      if (!isLtaConfigured()) return credentialError();

      await sendProgress(extra, 0, 1, "Checking taxi availability…");
      const waitCb = () => logInfo(extra, "search_taxi_availability: waiting for transport service…");

      const { count, nearestMeters, error } = await queryNearbyTaxis(
        latitude, longitude, radiusMeters, waitCb,
      );

      if (error) {
        await logInfo(extra, `search_taxi_availability: error — ${error}`);
        return { content: [{ type: "text" as const, text: `Failed to check taxi availability: ${error}` }] };
      }

      await logInfo(extra, `search_taxi_availability: ${count} taxis within ${radiusMeters}m`);

      const nearestText = nearestMeters !== null
        ? `Nearest available taxi is approximately ${nearestMeters}m away.`
        : "";

      const text = count > 0
        ? `**${count} taxi${count !== 1 ? "s" : ""}** currently available within ${radiusMeters}m. ${nearestText}`
        : `**No taxis** currently available within ${radiusMeters}m. Try increasing the search radius.`;

      await sendProgress(extra, 1, 1, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `**Taxi Availability**\n\n${text}${LTA_ATTRIBUTION}`,
        }],
      };
    },
  );
}
