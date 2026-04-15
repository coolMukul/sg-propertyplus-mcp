// Export tools — export_csv and export_md. Write files to client-approved directories (roots).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { SessionState } from "../state.js";
import {
  LandParcel, HdbResaleRecord, PrivateTransaction, PrivateRental,
  DeveloperSale, RentalMedian, PipelineProject,
  CarParkAvailability, CarParkDetail, SeasonCarPark, PlanningDecision,
  NearbyAmenity,
  BusStopInfo,
  BusArrivalService,
  TaxiStandInfo,
} from "../types.js";
import {
  formatLandParcelsTable, formatHdbTable,
  formatLandParcelsCsv, formatHdbCsv,
  formatPrivateTransactionTable, formatPrivateTransactionCsv,
  formatPrivateRentalTable, formatPrivateRentalCsv,
  formatDeveloperSaleTable, formatDeveloperSaleCsv,
  formatRentalMedianTable, formatRentalMedianCsv,
  formatPipelineTable, formatPipelineCsv,
  formatCarParkAvailabilityTable, formatCarParkAvailabilityCsv,
  formatCarParkDetailTable, formatCarParkDetailCsv,
  formatSeasonCarParkTable, formatSeasonCarParkCsv,
  formatPlanningDecisionTable, formatPlanningDecisionCsv,
  formatNearbyAmenityTable, formatNearbyAmenityCsv,
  formatBusStopTable, formatBusStopCsv,
  formatBusArrivalTable, formatBusArrivalCsv,
  formatTaxiStandTable, formatTaxiStandCsv,
} from "../formatters.js";
import { isPathAllowed } from "../roots.js";
import { type ToolExtra, logInfo } from "../helpers.js";

export function registerExportTools(server: McpServer, state: SessionState): void {
  server.tool(
    "export_csv",
    "Export the last search results to a CSV file. The file must be saved within a directory approved by the client.",
    {
      filePath: z
        .string()
        .describe("Full path for the CSV file (e.g. '/home/user/exports/results.csv')"),
    },
    async ({ filePath }, extra: ToolExtra) => {
      await logInfo(extra, `export_csv: target="${filePath}"`);

      // 1. Check for results to export
      const lastSearch = state.getLastSearch();
      if (!lastSearch) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No search results to export. Run a search first.",
            },
          ],
        };
      }

      if (lastSearch.results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "The last search returned no results — nothing to export.",
            },
          ],
        };
      }

      // 2. Validate the path against client-approved roots
      const check = await isPathAllowed(server.server, filePath);
      if (!check.allowed) {
        await logInfo(extra, `export_csv: path denied — ${check.reason}`);

        const rootsList =
          check.roots.length > 0
            ? `\n\nAllowed directories:\n${check.roots.map((r) => `- ${r}`).join("\n")}`
            : "";

        return {
          content: [
            {
              type: "text" as const,
              text: `Cannot write to "${filePath}". ${check.reason}${rootsList}`,
            },
          ],
        };
      }

      await logInfo(extra, `export_csv: path allowed (root: ${check.root})`);

      // 3. Format CSV
      let csv: string;
      switch (lastSearch.type) {
        case "land-use":
          csv = formatLandParcelsCsv(lastSearch.results as LandParcel[]); break;
        case "private-transaction":
          csv = formatPrivateTransactionCsv(lastSearch.results as PrivateTransaction[]); break;
        case "private-rental":
          csv = formatPrivateRentalCsv(lastSearch.results as PrivateRental[]); break;
        case "developer-sales":
          csv = formatDeveloperSaleCsv(lastSearch.results as DeveloperSale[]); break;
        case "rental-median":
          csv = formatRentalMedianCsv(lastSearch.results as RentalMedian[]); break;
        case "pipeline":
          csv = formatPipelineCsv(lastSearch.results as PipelineProject[]); break;
        case "carpark-availability":
          csv = formatCarParkAvailabilityCsv(lastSearch.results as CarParkAvailability[]); break;
        case "carpark-details":
          csv = formatCarParkDetailCsv(lastSearch.results as CarParkDetail[]); break;
        case "season-carpark":
          csv = formatSeasonCarParkCsv(lastSearch.results as SeasonCarPark[]); break;
        case "planning-decision":
          csv = formatPlanningDecisionCsv(lastSearch.results as PlanningDecision[]); break;
        case "nearby-amenities":
          csv = formatNearbyAmenityCsv(lastSearch.results as NearbyAmenity[]); break;
        case "nearest-transport":
          csv = formatBusStopCsv(lastSearch.results as BusStopInfo[]); break;
        case "bus-arrival":
          csv = formatBusArrivalCsv(lastSearch.results as BusArrivalService[]); break;
        case "taxi-availability":
          csv = formatTaxiStandCsv(lastSearch.results as TaxiStandInfo[]); break;
        default:
          csv = formatHdbCsv(lastSearch.results as HdbResaleRecord[]); break;
      }

      // 4. Write file (create parent directory if needed)
      try {
        await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
        await writeFile(path.resolve(filePath), csv, "utf-8");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logInfo(extra, `export_csv: write failed — ${message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to write file: ${message}`,
            },
          ],
        };
      }

      const resolved = path.resolve(filePath);
      const rowCount = lastSearch.results.length;
      const dataTypeLabels: Record<string, string> = {
        "land-use": "land parcel", "hdb-resale": "HDB resale",
        "private-transaction": "private transaction", "private-rental": "private rental",
        "developer-sales": "developer sales", "rental-median": "rental median",
        "pipeline": "pipeline",
        "carpark-availability": "car park availability",
        "carpark-details": "car park details",
        "season-carpark": "season car park",
        "planning-decision": "planning decision",
        "nearby-amenities": "nearby amenity",
        "nearest-transport": "bus stop",
        "bus-arrival": "bus arrival",
        "taxi-availability": "taxi stand",
      };
      const dataType = dataTypeLabels[lastSearch.type] ?? lastSearch.type;
      await logInfo(extra, `export_csv: wrote ${rowCount} ${dataType} records to ${resolved}`);

      return {
        content: [
          {
            type: "text" as const,
            text: `Exported ${rowCount} ${dataType} records to:\n${resolved}`,
          },
        ],
      };
    },
  );

  server.tool(
    "export_md",
    "Export the last search results to a Markdown file. The file must be saved within a directory approved by the client.",
    {
      filePath: z
        .string()
        .describe("Full path for the Markdown file (e.g. '/home/user/exports/results.md')"),
    },
    async ({ filePath }, extra: ToolExtra) => {
      await logInfo(extra, `export_md: target="${filePath}"`);

      // 1. Check for results to export
      const lastSearch = state.getLastSearch();
      if (!lastSearch) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No search results to export. Run a search first.",
            },
          ],
        };
      }

      if (lastSearch.results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "The last search returned no results — nothing to export.",
            },
          ],
        };
      }

      // 2. Validate the path against client-approved roots
      const check = await isPathAllowed(server.server, filePath);
      if (!check.allowed) {
        await logInfo(extra, `export_md: path denied — ${check.reason}`);

        const rootsList =
          check.roots.length > 0
            ? `\n\nAllowed directories:\n${check.roots.map((r) => `- ${r}`).join("\n")}`
            : "";

        return {
          content: [
            {
              type: "text" as const,
              text: `Cannot write to "${filePath}". ${check.reason}${rootsList}`,
            },
          ],
        };
      }

      await logInfo(extra, `export_md: path allowed (root: ${check.root})`);

      // 3. Format Markdown
      let table: string;
      switch (lastSearch.type) {
        case "land-use":
          table = formatLandParcelsTable(lastSearch.results as LandParcel[]); break;
        case "private-transaction":
          table = formatPrivateTransactionTable(lastSearch.results as PrivateTransaction[]); break;
        case "private-rental":
          table = formatPrivateRentalTable(lastSearch.results as PrivateRental[]); break;
        case "developer-sales":
          table = formatDeveloperSaleTable(lastSearch.results as DeveloperSale[]); break;
        case "rental-median":
          table = formatRentalMedianTable(lastSearch.results as RentalMedian[]); break;
        case "pipeline":
          table = formatPipelineTable(lastSearch.results as PipelineProject[]); break;
        case "carpark-availability":
          table = formatCarParkAvailabilityTable(lastSearch.results as CarParkAvailability[]); break;
        case "carpark-details":
          table = formatCarParkDetailTable(lastSearch.results as CarParkDetail[]); break;
        case "season-carpark":
          table = formatSeasonCarParkTable(lastSearch.results as SeasonCarPark[]); break;
        case "planning-decision":
          table = formatPlanningDecisionTable(lastSearch.results as PlanningDecision[]); break;
        case "nearby-amenities":
          table = formatNearbyAmenityTable(lastSearch.results as NearbyAmenity[]); break;
        case "nearest-transport":
          table = formatBusStopTable(lastSearch.results as BusStopInfo[]); break;
        case "bus-arrival":
          table = formatBusArrivalTable(lastSearch.results as BusArrivalService[]); break;
        case "taxi-availability":
          table = formatTaxiStandTable(lastSearch.results as TaxiStandInfo[]); break;
        default:
          table = formatHdbTable(lastSearch.results as HdbResaleRecord[]); break;
      }

      const queryLines = Object.entries(lastSearch.query)
        .filter(([, v]) => v != null)
        .map(([k, v]) => `- **${k}:** ${v}`);
      const headingMap: Record<string, string> = {
        "land-use": "Land Use Results", "hdb-resale": "HDB Resale Results",
        "private-transaction": "Private Transaction Results",
        "private-rental": "Private Rental Results",
        "developer-sales": "Developer Sales Results",
        "rental-median": "Rental Median Results",
        "pipeline": "Pipeline Results",
        "carpark-availability": "Car Park Availability",
        "carpark-details": "Car Park Details",
        "season-carpark": "Season Car Park",
        "planning-decision": "Planning Decisions",
        "nearby-amenities": "Nearby Amenities",
        "nearest-transport": "Nearest Transport",
        "bus-arrival": "Bus Arrival Times",
        "taxi-availability": "Taxi Stands",
      };
      const heading = headingMap[lastSearch.type] ?? "Results";

      const uraAttribution = "(c) Urban Redevelopment Authority";
      const attributionMap: Record<string, string> = {
        "land-use": "Geocoding: Data (c) OpenStreetMap contributors\nLand use: (c) Urban Redevelopment Authority",
        "hdb-resale": "Contains information from data.gov.sg accessed under the Singapore Open Data Licence",
        "private-transaction": uraAttribution,
        "private-rental": uraAttribution,
        "developer-sales": uraAttribution,
        "rental-median": uraAttribution,
        "pipeline": uraAttribution,
        "carpark-availability": uraAttribution,
        "carpark-details": uraAttribution,
        "season-carpark": uraAttribution,
        "planning-decision": uraAttribution,
        "nearby-amenities": "Data (c) OpenStreetMap contributors",
        "nearest-transport": "Contains information from LTA DataMall",
        "bus-arrival": "Contains information from LTA DataMall",
        "taxi-availability": "Contains information from LTA DataMall",
      };
      const attribution = attributionMap[lastSearch.type] ?? uraAttribution;

      const exportedAt = new Date().toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      });

      const md = [
        `# ${heading}`,
        "",
        `**Exported:** ${exportedAt}`,
        "",
        "## Query Parameters",
        "",
        ...queryLines,
        "",
        "## Results",
        "",
        table,
        "",
        "---",
        attribution,
        "",
      ].join("\n");

      // 4. Write file (create parent directory if needed)
      try {
        await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
        await writeFile(path.resolve(filePath), md, "utf-8");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logInfo(extra, `export_md: write failed — ${message}`);
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to write file: ${message}`,
            },
          ],
        };
      }

      const resolved = path.resolve(filePath);
      const rowCount = lastSearch.results.length;
      const mdDataTypeLabels: Record<string, string> = {
        "land-use": "land parcel", "hdb-resale": "HDB resale",
        "private-transaction": "private transaction", "private-rental": "private rental",
        "developer-sales": "developer sales", "rental-median": "rental median",
        "pipeline": "pipeline",
        "carpark-availability": "car park availability",
        "carpark-details": "car park details",
        "season-carpark": "season car park",
        "planning-decision": "planning decision",
        "nearby-amenities": "nearby amenity",
        "nearest-transport": "bus stop",
        "bus-arrival": "bus arrival",
        "taxi-availability": "taxi stand",
      };
      const mdDataType = mdDataTypeLabels[lastSearch.type] ?? lastSearch.type;
      await logInfo(extra, `export_md: wrote ${rowCount} ${mdDataType} records to ${resolved}`);

      return {
        content: [
          {
            type: "text" as const,
            text: `Exported ${rowCount} ${mdDataType} records to:\n${resolved}`,
          },
        ],
      };
    },
  );
}
