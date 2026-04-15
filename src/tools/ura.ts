// URA Data Service tools — all URA endpoints: property transactions, rentals,
// developer sales, rental median, pipeline, car parks, planning decisions.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { PRIVATE_TXN_LIMIT_DEFAULT } from "../config.js";
import {
  queryPrivateTransactions,
  queryPrivateRentals,
  queryDeveloperSales,
  queryRentalMedian,
  queryPipeline,
  queryCarParkAvailability,
  queryCarParkDetails,
  querySeasonCarParks,
  checkResidentialUse,
  queryPlanningDecisions,
  filterTransactions,
  filterRentals,
  isUraDataConfigured,
  parseContractDate,
} from "../api/ura-data.js";
import { SessionState } from "../state.js";
import {
  formatPrivateTransactionTable,
  formatPrivateRentalTable,
  formatDeveloperSaleTable,
  formatRentalMedianTable,
  formatPipelineTable,
  formatCarParkAvailabilityTable,
  formatCarParkDetailTable,
  formatSeasonCarParkTable,
  formatPlanningDecisionTable,
} from "../formatters.js";
import { type ToolExtra, sendProgress, logInfo, PROPERTY_DISCLAIMER } from "../helpers.js";

const URA_ATTRIBUTION = "\n\n---\n(c) Urban Redevelopment Authority";

function credentialError(): { content: { type: "text"; text: string }[] } {
  return {
    content: [{
      type: "text" as const,
      text: "This feature requires API credentials. Check your server's environment configuration.",
    }],
  };
}

export function registerUraTools(server: McpServer, state: SessionState): void {

  // -------------------------------------------------------------------------
  // search_private_transactions — sale prices for the past 5 years
  // -------------------------------------------------------------------------
  server.tool(
    "search_private_transactions",
    "Search private property sale transactions in Singapore (past 5 years). Returns prices, areas, floor ranges, tenure, and more. Filter by district, project name, date range, price, and area. Always include a disclaimer that this data is for informational purposes only and does not constitute financial, investment, or property advice.",
    {
      district: z.string().optional()
        .describe("Filter by postal district number (e.g. '09', '14')"),
      project: z.string().optional()
        .describe("Filter by project/development name (partial match, e.g. 'RIVERVALE')"),
      propertyType: z.string().optional()
        .describe("Filter by property type (e.g. 'Condominium', 'Apartment', 'Terrace')"),
      marketSegment: z.enum(["CCR", "RCR", "OCR"]).optional()
        .describe("Market segment: CCR (Core Central), RCR (Rest of Central), OCR (Outside Central)"),
      dateFrom: z.string().optional()
        .describe("Start date in MMYY format (e.g. '0123' for Jan 2023)"),
      dateTo: z.string().optional()
        .describe("End date in MMYY format (e.g. '1224' for Dec 2024)"),
      minPrice: z.number().optional().describe("Minimum price in SGD"),
      maxPrice: z.number().optional().describe("Maximum price in SGD"),
      minArea: z.number().optional().describe("Minimum area in sqm"),
      maxArea: z.number().optional().describe("Maximum area in sqm"),
      tenure: z.string().optional().describe("Filter by tenure (e.g. 'Freehold', '99')"),
      limit: z.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT)
        .describe(`Max results to return after filtering (default ${PRIVATE_TXN_LIMIT_DEFAULT})`),
    },
    async (params, extra: ToolExtra) => {
      const { district, project, propertyType, marketSegment, dateFrom, dateTo,
              minPrice, maxPrice, minArea, maxArea, tenure, limit } = params;

      await logInfo(extra, `search_private_transactions: district=${district ?? "any"}, project=${project ?? "any"}, limit=${limit}`);

      if (!isUraDataConfigured()) return credentialError();

      // Fetch all batches
      await sendProgress(extra, 0, 4, "Fetching property transaction data…");
      const waitCb = () => logInfo(extra, "search_private_transactions: waiting for data service…");
      const { records, error } = await queryPrivateTransactions(
        async (batch, count) => {
          await sendProgress(extra, 1, 4, `Fetching batch ${batch} (${count.toLocaleString()} transactions so far)…`);
        },
        waitCb,
      );

      if (error) {
        await logInfo(extra, `search_private_transactions: error — ${error}`);
        return { content: [{ type: "text" as const, text: `Failed to fetch data: ${error}` }] };
      }

      // Filter
      await sendProgress(extra, 2, 4, "Filtering results…");
      const filtered = filterTransactions(records, {
        district, project, propertyType, marketSegment, tenure,
        dateFrom, dateTo, minPrice, maxPrice, minArea, maxArea,
      });

      // Sort by contract date descending (most recent first)
      filtered.sort((a, b) => parseContractDate(b.contractDate) - parseContractDate(a.contractDate));
      const truncated = filtered.slice(0, limit);

      await logInfo(extra, `search_private_transactions: ${filtered.length} matched, returning ${truncated.length}`);

      state.setLastSearch({
        type: "private-transaction",
        query: { district, project, propertyType, marketSegment, dateFrom, dateTo,
                 minPrice, maxPrice, minArea, maxArea, tenure, limit },
        results: truncated,
        timestamp: new Date().toISOString(),
      });

      const table = formatPrivateTransactionTable(truncated);
      const summary = truncated.length > 0
        ? `Showing ${truncated.length} of ${filtered.length.toLocaleString()} matching transactions (${records.length.toLocaleString()} total).`
        : "";

      await sendProgress(extra, 4, 4, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `**Private Property Transactions**\n\n${summary}\n\n${table}${PROPERTY_DISCLAIMER}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_private_rentals — rental contracts by quarter
  // -------------------------------------------------------------------------
  server.tool(
    "search_private_rentals",
    "Search private property rental contracts in Singapore for a given quarter. Returns monthly rent, area, property type, and bedroom count. Always include a disclaimer that this data is for informational purposes only and does not constitute financial, investment, or property advice.",
    {
      refPeriod: z.string()
        .describe("Quarter to query in YYqN format (e.g. '24q1' for Q1 2024, '23q4' for Q4 2023)"),
      district: z.string().optional()
        .describe("Filter by postal district number (e.g. '09', '14')"),
      project: z.string().optional()
        .describe("Filter by project name (partial match)"),
      propertyType: z.string().optional()
        .describe("Filter by property type (e.g. 'Non-landed Properties', 'Terrace House')"),
      noOfBedRoom: z.string().optional()
        .describe("Filter by number of bedrooms (e.g. '3', '4', 'NA')"),
      minRent: z.number().optional().describe("Minimum monthly rent in SGD"),
      maxRent: z.number().optional().describe("Maximum monthly rent in SGD"),
      limit: z.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT)
        .describe(`Max results to return (default ${PRIVATE_TXN_LIMIT_DEFAULT})`),
    },
    async (params, extra: ToolExtra) => {
      const { refPeriod, district, project, propertyType, noOfBedRoom, minRent, maxRent, limit } = params;

      await logInfo(extra, `search_private_rentals: period=${refPeriod}, district=${district ?? "any"}`);

      if (!isUraDataConfigured()) return credentialError();

      await sendProgress(extra, 0, 3, "Fetching rental contract data…");
      const waitCb = () => logInfo(extra, "search_private_rentals: waiting for data service…");
      const { records, error } = await queryPrivateRentals(refPeriod, waitCb);

      if (error) {
        await logInfo(extra, `search_private_rentals: error — ${error}`);
        return { content: [{ type: "text" as const, text: `Failed to fetch data: ${error}` }] };
      }

      await sendProgress(extra, 1, 3, "Filtering results…");
      const filtered = filterRentals(records, { district, project, propertyType, noOfBedRoom, minRent, maxRent });

      // Sort by rent descending
      filtered.sort((a, b) => b.rent - a.rent);
      const truncated = filtered.slice(0, limit);

      await logInfo(extra, `search_private_rentals: ${filtered.length} matched, returning ${truncated.length}`);

      state.setLastSearch({
        type: "private-rental",
        query: { refPeriod, district, project, propertyType, noOfBedRoom, minRent, maxRent, limit },
        results: truncated,
        timestamp: new Date().toISOString(),
      });

      const table = formatPrivateRentalTable(truncated);
      const summary = truncated.length > 0
        ? `Showing ${truncated.length} of ${filtered.length.toLocaleString()} matching contracts for ${refPeriod.toUpperCase()}.`
        : "";

      await sendProgress(extra, 3, 3, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `**Private Rental Contracts — ${refPeriod.toUpperCase()}**\n\n${summary}\n\n${table}${PROPERTY_DISCLAIMER}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_developer_sales — new launches by developers
  // -------------------------------------------------------------------------
  server.tool(
    "search_developer_sales",
    "Search developer sales data for private residential properties in Singapore. Shows median/high/low prices, units sold, and availability for a given month. Always include a disclaimer that this data is for informational purposes only and does not constitute financial, investment, or property advice.",
    {
      refPeriod: z.string()
        .describe("Month to query in MMYY format (e.g. '0924' for Sep 2024)"),
      district: z.string().optional()
        .describe("Filter by postal district number"),
      project: z.string().optional()
        .describe("Filter by project name (partial match)"),
      marketSegment: z.enum(["CCR", "RCR", "OCR"]).optional()
        .describe("Market segment filter"),
      limit: z.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT)
        .describe(`Max results (default ${PRIVATE_TXN_LIMIT_DEFAULT})`),
    },
    async (params, extra: ToolExtra) => {
      const { refPeriod, district, project, marketSegment, limit } = params;

      await logInfo(extra, `search_developer_sales: period=${refPeriod}, district=${district ?? "any"}`);

      if (!isUraDataConfigured()) return credentialError();

      await sendProgress(extra, 0, 2, "Fetching developer sales data…");
      const waitCb = () => logInfo(extra, "search_developer_sales: waiting for data service…");
      const { records, error } = await queryDeveloperSales(refPeriod, waitCb);

      if (error) {
        await logInfo(extra, `search_developer_sales: error — ${error}`);
        return { content: [{ type: "text" as const, text: `Failed to fetch data: ${error}` }] };
      }

      // Client-side filter
      let filtered = records;
      if (district) filtered = filtered.filter((r) => r.district === district);
      if (project) filtered = filtered.filter((r) => r.project.toUpperCase().includes(project.toUpperCase()));
      if (marketSegment) filtered = filtered.filter((r) => r.marketSegment === marketSegment);

      // Sort by soldInMonth descending (most active first)
      filtered.sort((a, b) => b.soldInMonth - a.soldInMonth);
      const truncated = filtered.slice(0, limit);

      await logInfo(extra, `search_developer_sales: ${filtered.length} matched, returning ${truncated.length}`);

      state.setLastSearch({
        type: "developer-sales",
        query: { refPeriod, district, project, marketSegment, limit },
        results: truncated,
        timestamp: new Date().toISOString(),
      });

      const table = formatDeveloperSaleTable(truncated);
      const summary = truncated.length > 0
        ? `Showing ${truncated.length} of ${filtered.length} projects for period ${refPeriod}.`
        : "";

      await sendProgress(extra, 2, 2, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `**Developer Sales — ${refPeriod}**\n\n${summary}\n\n${table}${PROPERTY_DISCLAIMER}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_rental_median — median rental rates across projects
  // -------------------------------------------------------------------------
  server.tool(
    "search_rental_median",
    "Get median rental rates ($/psf/month) for private non-landed residential properties in Singapore (past 3 years). Shows 25th/75th percentile bands. Always include a disclaimer that this data is for informational purposes only and does not constitute financial, investment, or property advice.",
    {
      district: z.string().optional()
        .describe("Filter by postal district number"),
      project: z.string().optional()
        .describe("Filter by project name (partial match)"),
      limit: z.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT)
        .describe(`Max results (default ${PRIVATE_TXN_LIMIT_DEFAULT})`),
    },
    async (params, extra: ToolExtra) => {
      const { district, project, limit } = params;

      await logInfo(extra, `search_rental_median: district=${district ?? "any"}, project=${project ?? "any"}`);

      if (!isUraDataConfigured()) return credentialError();

      await sendProgress(extra, 0, 2, "Fetching rental median data…");
      const waitCb = () => logInfo(extra, "search_rental_median: waiting for data service…");
      const { records, error } = await queryRentalMedian(waitCb);

      if (error) {
        await logInfo(extra, `search_rental_median: error — ${error}`);
        return { content: [{ type: "text" as const, text: `Failed to fetch data: ${error}` }] };
      }

      let filtered = records;
      if (district) filtered = filtered.filter((r) => r.district === district);
      if (project) filtered = filtered.filter((r) => r.project.toUpperCase().includes(project.toUpperCase()));

      // Sort by median descending
      filtered.sort((a, b) => b.median - a.median);
      const truncated = filtered.slice(0, limit);

      await logInfo(extra, `search_rental_median: ${filtered.length} matched, returning ${truncated.length}`);

      state.setLastSearch({
        type: "rental-median",
        query: { district, project, limit },
        results: truncated,
        timestamp: new Date().toISOString(),
      });

      const table = formatRentalMedianTable(truncated);
      const summary = truncated.length > 0
        ? `Showing ${truncated.length} of ${filtered.length.toLocaleString()} projects.`
        : "";

      await sendProgress(extra, 2, 2, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `**Rental Median Rates**\n\n${summary}\n\n${table}${PROPERTY_DISCLAIMER}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_pipeline — upcoming residential developments
  // -------------------------------------------------------------------------
  server.tool(
    "search_pipeline",
    "Get the pipeline of upcoming private residential developments in Singapore. Shows total units, property type breakdown, expected completion year, and developer. Always include a disclaimer that this data is for informational purposes only and does not constitute financial, investment, or property advice.",
    {
      district: z.string().optional()
        .describe("Filter by postal district number"),
      project: z.string().optional()
        .describe("Filter by project name (partial match)"),
      limit: z.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT)
        .describe(`Max results (default ${PRIVATE_TXN_LIMIT_DEFAULT})`),
    },
    async (params, extra: ToolExtra) => {
      const { district, project, limit } = params;

      await logInfo(extra, `search_pipeline: district=${district ?? "any"}, project=${project ?? "any"}`);

      if (!isUraDataConfigured()) return credentialError();

      await sendProgress(extra, 0, 2, "Fetching pipeline data…");
      const waitCb = () => logInfo(extra, "search_pipeline: waiting for data service…");
      const { records, error } = await queryPipeline(waitCb);

      if (error) {
        await logInfo(extra, `search_pipeline: error — ${error}`);
        return { content: [{ type: "text" as const, text: `Failed to fetch data: ${error}` }] };
      }

      let filtered = records;
      if (district) filtered = filtered.filter((r) => r.district === district);
      if (project) filtered = filtered.filter((r) => r.project.toUpperCase().includes(project.toUpperCase()));

      // Sort by totalUnits descending
      filtered.sort((a, b) => b.totalUnits - a.totalUnits);
      const truncated = filtered.slice(0, limit);

      await logInfo(extra, `search_pipeline: ${filtered.length} matched, returning ${truncated.length}`);

      state.setLastSearch({
        type: "pipeline",
        query: { district, project, limit },
        results: truncated,
        timestamp: new Date().toISOString(),
      });

      const table = formatPipelineTable(truncated);
      const summary = truncated.length > 0
        ? `Showing ${truncated.length} of ${filtered.length} pipeline projects.`
        : "";

      await sendProgress(extra, 2, 2, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `**Residential Pipeline**\n\n${summary}\n\n${table}${PROPERTY_DISCLAIMER}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_carpark_availability — real-time parking lot counts
  // -------------------------------------------------------------------------
  server.tool(
    "search_carpark_availability",
    "Get real-time available parking lots across government-managed car parks in Singapore. Data updates every 3-5 minutes.",
    {
      carparkNo: z.string().optional()
        .describe("Filter by car park number (e.g. 'A0004')"),
      lotType: z.string().optional()
        .describe("Filter by lot type: 'C' (car), 'M' (motorcycle), 'H' (heavy vehicle)"),
      limit: z.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT)
        .describe(`Max results (default ${PRIVATE_TXN_LIMIT_DEFAULT})`),
    },
    async (params, extra: ToolExtra) => {
      const { carparkNo, lotType, limit } = params;

      await logInfo(extra, `search_carpark_availability: carparkNo=${carparkNo ?? "any"}, lotType=${lotType ?? "any"}`);

      if (!isUraDataConfigured()) return credentialError();

      await sendProgress(extra, 0, 2, "Fetching car park availability…");
      const waitCb = () => logInfo(extra, "search_carpark_availability: waiting for data service…");
      const { records, error } = await queryCarParkAvailability(waitCb);

      if (error) {
        await logInfo(extra, `search_carpark_availability: error — ${error}`);
        return { content: [{ type: "text" as const, text: `Failed to fetch data: ${error}` }] };
      }

      let filtered = records;
      if (carparkNo) filtered = filtered.filter((r) => r.carparkNo === carparkNo.toUpperCase());
      if (lotType) filtered = filtered.filter((r) => r.lotType === lotType.toUpperCase());

      const truncated = filtered.slice(0, limit);

      await logInfo(extra, `search_carpark_availability: ${filtered.length} matched, returning ${truncated.length}`);

      state.setLastSearch({
        type: "carpark-availability",
        query: { carparkNo, lotType, limit },
        results: truncated,
        timestamp: new Date().toISOString(),
      });

      const table = formatCarParkAvailabilityTable(truncated);
      const summary = truncated.length > 0
        ? `Showing ${truncated.length} of ${filtered.length.toLocaleString()} car parks.`
        : "";

      await sendProgress(extra, 2, 2, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `**Car Park Availability** (real-time)\n\n${summary}\n\n${table}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_carpark_rates — car park details and pricing
  // -------------------------------------------------------------------------
  server.tool(
    "search_carpark_rates",
    "Get car park details and parking rates for government-managed car parks in Singapore. Includes weekday, Saturday, and Sunday/public holiday rates.",
    {
      ppName: z.string().optional()
        .describe("Filter by car park name (partial match, e.g. 'ALIWAL')"),
      vehCat: z.string().optional()
        .describe("Filter by vehicle category (e.g. 'Car', 'Motorcycle')"),
      limit: z.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT)
        .describe(`Max results (default ${PRIVATE_TXN_LIMIT_DEFAULT})`),
    },
    async (params, extra: ToolExtra) => {
      const { ppName, vehCat, limit } = params;

      await logInfo(extra, `search_carpark_rates: name=${ppName ?? "any"}, vehicle=${vehCat ?? "any"}`);

      if (!isUraDataConfigured()) return credentialError();

      await sendProgress(extra, 0, 2, "Fetching car park details…");
      const waitCb = () => logInfo(extra, "search_carpark_rates: waiting for data service…");
      const { records, error } = await queryCarParkDetails(waitCb);

      if (error) {
        await logInfo(extra, `search_carpark_rates: error — ${error}`);
        return { content: [{ type: "text" as const, text: `Failed to fetch data: ${error}` }] };
      }

      let filtered = records;
      if (ppName) filtered = filtered.filter((r) => r.ppName.toUpperCase().includes(ppName.toUpperCase()));
      if (vehCat) filtered = filtered.filter((r) => r.vehCat.toUpperCase().includes(vehCat.toUpperCase()));

      const truncated = filtered.slice(0, limit);

      await logInfo(extra, `search_carpark_rates: ${filtered.length} matched, returning ${truncated.length}`);

      state.setLastSearch({
        type: "carpark-details",
        query: { ppName, vehCat, limit },
        results: truncated,
        timestamp: new Date().toISOString(),
      });

      const table = formatCarParkDetailTable(truncated);
      const summary = truncated.length > 0
        ? `Showing ${truncated.length} of ${filtered.length.toLocaleString()} car park entries.`
        : "";

      await sendProgress(extra, 2, 2, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `**Car Park Rates**\n\n${summary}\n\n${table}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_planning_decisions — written permission grants/rejections
  // -------------------------------------------------------------------------
  server.tool(
    "search_planning_decisions",
    "Search planning decisions (written permissions granted or rejected) in Singapore. Useful for finding nearby construction, development approvals, change of use applications, and subdivisions. Query by year or by recent changes since a date.",
    {
      year: z.string().optional()
        .describe("Year to query (e.g. '2024', '2025'). Only records after year 2000. Use this OR lastDnloadDate, not both."),
      lastDnloadDate: z.string().optional()
        .describe("Get records created/modified since this date (dd/mm/yyyy format, max 1 year ago). Use this OR year, not both."),
      address: z.string().optional()
        .describe("Filter by address (partial match, e.g. 'VICTORIA STREET')"),
      applType: z.string().optional()
        .describe("Filter by application type (e.g. 'Change of Use', 'Subdivision', 'Addition & Alteration')"),
      decisionType: z.string().optional()
        .describe("Filter by decision type (e.g. 'Written Permission')"),
      limit: z.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT)
        .describe(`Max results (default ${PRIVATE_TXN_LIMIT_DEFAULT})`),
    },
    async (params, extra: ToolExtra) => {
      const { year, lastDnloadDate, address, applType, decisionType, limit } = params;

      // Default to current year if neither param provided
      const queryYear = !year && !lastDnloadDate ? String(new Date().getFullYear()) : year;

      await logInfo(extra, `search_planning_decisions: year=${queryYear ?? "none"}, lastDnloadDate=${lastDnloadDate ?? "none"}, address=${address ?? "any"}`);

      if (!isUraDataConfigured()) return credentialError();

      await sendProgress(extra, 0, 2, "Fetching planning decisions…");
      const waitCb = () => logInfo(extra, "search_planning_decisions: waiting for data service…");
      const { records, error } = await queryPlanningDecisions(
        { year: queryYear, lastDnloadDate },
        waitCb,
      );

      if (error) {
        await logInfo(extra, `search_planning_decisions: error — ${error}`);
        return { content: [{ type: "text" as const, text: `Failed to fetch data: ${error}` }] };
      }

      let filtered = records;
      if (address) filtered = filtered.filter((r) => r.address.toUpperCase().includes(address.toUpperCase()));
      if (applType) filtered = filtered.filter((r) => r.applType.toUpperCase().includes(applType.toUpperCase()));
      if (decisionType) filtered = filtered.filter((r) => r.decisionType.toUpperCase().includes(decisionType.toUpperCase()));

      // Sort by decision date descending (most recent first)
      filtered.sort((a, b) => {
        const parseDate = (d: string) => {
          const [dd, mm, yyyy] = d.split("/");
          return parseInt(yyyy + mm + dd, 10);
        };
        return parseDate(b.decisionDate) - parseDate(a.decisionDate);
      });

      const truncated = filtered.slice(0, limit);

      await logInfo(extra, `search_planning_decisions: ${filtered.length} matched, returning ${truncated.length}`);

      state.setLastSearch({
        type: "planning-decision",
        query: { year: queryYear, lastDnloadDate, address, applType, decisionType, limit },
        results: truncated,
        timestamp: new Date().toISOString(),
      });

      const table = formatPlanningDecisionTable(truncated);
      const summary = truncated.length > 0
        ? `Showing ${truncated.length} of ${filtered.length.toLocaleString()} planning decisions.`
        : "";

      await sendProgress(extra, 2, 2, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `**Planning Decisions**\n\n${summary}\n\n${table}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_season_carpark — season parking rates
  // -------------------------------------------------------------------------
  server.tool(
    "search_season_carpark",
    "Get season car park details and monthly rates for government-managed car parks in Singapore. Shows monthly pricing, parking hours, and ticket types.",
    {
      ppName: z.string().optional()
        .describe("Filter by car park name (partial match)"),
      vehCat: z.string().optional()
        .describe("Filter by vehicle category (e.g. 'Car', 'Motorcycle')"),
      limit: z.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT)
        .describe(`Max results (default ${PRIVATE_TXN_LIMIT_DEFAULT})`),
    },
    async (params, extra: ToolExtra) => {
      const { ppName, vehCat, limit } = params;

      await logInfo(extra, `search_season_carpark: name=${ppName ?? "any"}, vehicle=${vehCat ?? "any"}`);

      if (!isUraDataConfigured()) return credentialError();

      await sendProgress(extra, 0, 2, "Fetching season car park data…");
      const waitCb = () => logInfo(extra, "search_season_carpark: waiting for data service…");
      const { records, error } = await querySeasonCarParks(waitCb);

      if (error) {
        await logInfo(extra, `search_season_carpark: error — ${error}`);
        return { content: [{ type: "text" as const, text: `Failed to fetch data: ${error}` }] };
      }

      let filtered = records;
      if (ppName) filtered = filtered.filter((r) => r.ppName.toUpperCase().includes(ppName.toUpperCase()));
      if (vehCat) filtered = filtered.filter((r) => r.vehCat.toUpperCase().includes(vehCat.toUpperCase()));

      const truncated = filtered.slice(0, limit);

      await logInfo(extra, `search_season_carpark: ${filtered.length} matched, returning ${truncated.length}`);

      state.setLastSearch({
        type: "season-carpark",
        query: { ppName, vehCat, limit },
        results: truncated,
        timestamp: new Date().toISOString(),
      });

      const table = formatSeasonCarParkTable(truncated);
      const summary = truncated.length > 0
        ? `Showing ${truncated.length} of ${filtered.length} season car parks.`
        : "";

      await sendProgress(extra, 2, 2, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `**Season Car Park Rates**\n\n${summary}\n\n${table}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // check_residential_use — verify if address is approved for residential use
  // -------------------------------------------------------------------------
  server.tool(
    "check_residential_use",
    "Check if a specific Singapore address is approved for residential use. Covers private residential units that have obtained TOP. Does not include HDB, state properties, or shophouses.",
    {
      blkHouseNo: z.string()
        .describe("Block or house number (e.g. '230', '15')"),
      street: z.string()
        .describe("Street name (e.g. 'VICTORIA STREET', 'NASSIM ROAD')"),
      storeyNo: z.string().optional()
        .describe("Storey number (optional)"),
      unitNo: z.string().optional()
        .describe("Unit number (optional)"),
    },
    async (params, extra: ToolExtra) => {
      const { blkHouseNo, street, storeyNo, unitNo } = params;

      await logInfo(extra, `check_residential_use: ${blkHouseNo} ${street}`);

      if (!isUraDataConfigured()) return credentialError();

      await sendProgress(extra, 0, 1, "Checking residential use approval…");
      const waitCb = () => logInfo(extra, "check_residential_use: waiting for data service…");
      const { isResiUse, error } = await checkResidentialUse(
        blkHouseNo, street, storeyNo, unitNo, waitCb,
      );

      if (error) {
        await logInfo(extra, `check_residential_use: error — ${error}`);
        return { content: [{ type: "text" as const, text: `Failed to check: ${error}` }] };
      }

      await logInfo(extra, `check_residential_use: result=${isResiUse}`);

      const addressParts = [blkHouseNo, street, storeyNo, unitNo].filter(Boolean).join(" ");
      const result = isResiUse === "Y"
        ? `**${addressParts}** is approved for residential use.`
        : `**${addressParts}** — residential use information is not available. This may mean the address is not approved for residential use, or the record is not in the database (HDB, state properties, and shophouses are excluded).`;

      await sendProgress(extra, 1, 1, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `${result}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );
}
