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
    "Search private property sale transactions in Singapore. By default, returns the last 12 months for performance. Returns prices, areas, floor ranges, tenure, and more. Filter by district, project, date range, price, and area. Always include a disclaimer.",
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
        .describe("Start date in MMYY format (e.g. '0123'). Defaults to last 12 months if omitted for performance."),
      dateTo: z.string().optional()
        .describe("End date in MMYY format (e.g. '1224')"),
      minPrice: z.coerce.number().optional().describe("Minimum price in SGD"),
      maxPrice: z.coerce.number().optional().describe("Maximum price in SGD"),
      minArea: z.coerce.number().optional().describe("Minimum area in sqm"),
      maxArea: z.coerce.number().optional().describe("Maximum area in sqm"),
      tenure: z.string().optional().describe("Filter by tenure (e.g. 'Freehold', '99')"),
      limit: z.coerce.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT)
        .describe(`Max results to return after filtering (default ${PRIVATE_TXN_LIMIT_DEFAULT})`),
    },
    async (params, extra: ToolExtra) => {
      let { district, project, propertyType, marketSegment, dateFrom, dateTo,
              minPrice, maxPrice, minArea, maxArea, tenure, limit } = params;

      // GUARD: Default to last 12 months if no dateFrom is provided to prevent 504 timeouts
      if (!dateFrom) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        dateFrom = `${month}${String(year - 1).slice(-2)}`;
        await logInfo(extra, `search_private_transactions: Defaulting to last 12 months (${dateFrom}) for performance.`);
      }

      await logInfo(extra, `search_private_transactions: district=${district ?? "any"}, project=${project ?? "any"}, limit=${limit}`);

      if (!isUraDataConfigured()) return credentialError();

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

      await sendProgress(extra, 2, 4, "Filtering results…");
      const filtered = filterTransactions(records, {
        district, project, propertyType, marketSegment, tenure,
        dateFrom, dateTo, minPrice, maxPrice, minArea, maxArea,
      });

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
        ? `Showing ${truncated.length} of ${filtered.length.toLocaleString()} matching transactions. Filtered from ${dateFrom}.`
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
    "Search private property rental contracts in Singapore for a given quarter. Returns monthly rent, area, property type, and bedroom count. Always include a disclaimer.",
    {
      refPeriod: z.string()
        .describe("Quarter to query in YYqN format (e.g. '24q1')"),
      district: z.string().optional()
        .describe("Filter by postal district number (e.g. '09')"),
      project: z.string().optional()
        .describe("Filter by project name (partial match)"),
      propertyType: z.string().optional()
        .describe("Filter by property type"),
      noOfBedRoom: z.string().optional()
        .describe("Filter by number of bedrooms"),
      minRent: z.coerce.number().optional().describe("Minimum monthly rent in SGD"),
      maxRent: z.coerce.number().optional().describe("Maximum monthly rent in SGD"),
      limit: z.coerce.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT)
        .describe(`Max results (default ${PRIVATE_TXN_LIMIT_DEFAULT})`),
    },
    async (params, extra: ToolExtra) => {
      const { refPeriod, district, project, propertyType, noOfBedRoom, minRent, maxRent, limit } = params;

      await logInfo(extra, `search_private_rentals: period=${refPeriod}, district=${district ?? "any"}`);

      if (!isUraDataConfigured()) return credentialError();

      await sendProgress(extra, 0, 3, "Fetching rental data…");
      const waitCb = () => logInfo(extra, "search_private_rentals: waiting for data service…");
      const { records, error } = await queryPrivateRentals(refPeriod, waitCb);

      if (error) {
        return { content: [{ type: "text" as const, text: `Failed to fetch data: ${error}` }] };
      }

      await sendProgress(extra, 1, 3, "Filtering results…");
      const filtered = filterRentals(records, { district, project, propertyType, noOfBedRoom, minRent, maxRent });
      filtered.sort((a, b) => b.rent - a.rent);
      const truncated = filtered.slice(0, limit);

      state.setLastSearch({
        type: "private-rental",
        query: { refPeriod, district, project, propertyType, noOfBedRoom, minRent, maxRent, limit },
        results: truncated,
        timestamp: new Date().toISOString(),
      });

      const table = formatPrivateRentalTable(truncated);
      const summary = truncated.length > 0 ? `Showing ${truncated.length} of ${filtered.length.toLocaleString()} matching contracts.` : "";

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
    "Search developer sales data for private residential properties in Singapore. Shows prices, units sold, and availability for a given month. Always include a disclaimer.",
    {
      refPeriod: z.string()
        .describe("Month to query in MMYY format (e.g. '0924')"),
      district: z.string().optional().describe("Filter by postal district number"),
      project: z.string().optional().describe("Filter by project name"),
      marketSegment: z.enum(["CCR", "RCR", "OCR"]).optional().describe("Market segment filter"),
      limit: z.coerce.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT)
        .describe(`Max results (default ${PRIVATE_TXN_LIMIT_DEFAULT})`),
    },
    async (params, extra: ToolExtra) => {
      const { refPeriod, district, project, marketSegment, limit } = params;

      if (!isUraDataConfigured()) return credentialError();

      await sendProgress(extra, 0, 2, "Fetching developer sales…");
      const waitCb = () => logInfo(extra, "search_developer_sales: waiting…");
      const { records, error } = await queryDeveloperSales(refPeriod, waitCb);

      if (error) return { content: [{ type: "text" as const, text: `Failed: ${error}` }] };

      let filtered = records;
      if (district) filtered = filtered.filter((r) => r.district === district);
      if (project) filtered = filtered.filter((r) => r.project?.toUpperCase().includes(project.toUpperCase()));
      if (marketSegment) filtered = filtered.filter((r) => r.marketSegment === marketSegment);

      filtered.sort((a, b) => b.soldInMonth - a.soldInMonth);
      const truncated = filtered.slice(0, limit);

      state.setLastSearch({
        type: "developer-sales",
        query: { refPeriod, district, project, marketSegment, limit },
        results: truncated,
        timestamp: new Date().toISOString(),
      });

      const table = formatDeveloperSaleTable(truncated);
      await sendProgress(extra, 2, 2, "Done");
      return {
        content: [{
          type: "text" as const,
          text: `**Developer Sales — ${refPeriod}**\n\n${table}${PROPERTY_DISCLAIMER}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_rental_median — median rental rates across projects
  // -------------------------------------------------------------------------
  server.tool(
    "search_rental_median",
    "Get median rental rates ($/psf/month) for private non-landed properties. Shows 25th/75th percentile bands. Always include a disclaimer.",
    {
      district: z.string().optional().describe("Filter by postal district number"),
      project: z.string().optional().describe("Filter by project name"),
      limit: z.coerce.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT).describe(`Max results`),
    },
    async (params, extra: ToolExtra) => {
      const { district, project, limit } = params;
      if (!isUraDataConfigured()) return credentialError();

      const { records, error } = await queryRentalMedian(() => {});
      if (error) return { content: [{ type: "text" as const, text: `Failed: ${error}` }] };

      let filtered = records;
      if (district) filtered = filtered.filter((r) => r.district === district);
      if (project) filtered = filtered.filter((r) => r.project?.toUpperCase().includes(project.toUpperCase()));

      filtered.sort((a, b) => b.median - a.median);
      const truncated = filtered.slice(0, limit);

      return {
        content: [{
          type: "text" as const,
          text: `**Rental Median Rates**\n\n${formatRentalMedianTable(truncated)}${PROPERTY_DISCLAIMER}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_pipeline — upcoming residential developments (SUPPLY RISK)
  // -------------------------------------------------------------------------
  server.tool(
    "search_pipeline",
    "Analyze the pipeline of upcoming private residential developments. CRITICAL: Use completion years to evaluate 'Supply Risk' for investors in specific districts.",
    {
      district: z.string().optional().describe("Filter by postal district number"),
      project: z.string().optional().describe("Filter by project name"),
      limit: z.coerce.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT).describe(`Max results`),
    },
    async (params, extra: ToolExtra) => {
      const { district, project, limit } = params;
      if (!isUraDataConfigured()) return credentialError();

      const { records, error } = await queryPipeline(() => {});
      if (error) return { content: [{ type: "text" as const, text: `Failed: ${error}` }] };

      let filtered = records;
      if (district) filtered = filtered.filter((r) => r.district === district);
      if (project) filtered = filtered.filter((r) => r.project?.toUpperCase().includes(project.toUpperCase()));

      filtered.sort((a, b) => b.totalUnits - a.totalUnits);
      const truncated = filtered.slice(0, limit);

      return {
        content: [{
          type: "text" as const,
          text: `**Residential Pipeline & Supply Analysis**\n\n${formatPipelineTable(truncated)}${PROPERTY_DISCLAIMER}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_carpark_availability — real-time parking lot counts
  // -------------------------------------------------------------------------
  server.tool(
    "search_carpark_availability",
    "Get real-time available parking lots across government-managed car parks in Singapore.",
    {
      carparkNo: z.string().optional().describe("Filter by car park number"),
      lotType: z.string().optional().describe("C (car), M (motorcycle), H (heavy)"),
      limit: z.coerce.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT).describe(`Max results`),
    },
    async (params, extra: ToolExtra) => {
      const { carparkNo, lotType, limit } = params;
      if (!isUraDataConfigured()) return credentialError();

      const { records, error } = await queryCarParkAvailability(() => {});
      if (error) return { content: [{ type: "text" as const, text: `Failed: ${error}` }] };

      let filtered = records;
      if (carparkNo) filtered = filtered.filter((r) => r.carparkNo === carparkNo.toUpperCase());
      if (lotType) filtered = filtered.filter((r) => r.lotType === lotType.toUpperCase());

      return {
        content: [{
          type: "text" as const,
          text: `**Car Park Availability**\n\n${formatCarParkAvailabilityTable(filtered.slice(0, limit))}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_carpark_rates — car park details and pricing
  // -------------------------------------------------------------------------
  server.tool(
    "search_carpark_rates",
    "Get car park details and rates for government-managed car parks.",
    {
      ppName: z.string().optional().describe("Filter by name"),
      vehCat: z.string().optional().describe("Vehicle category"),
      limit: z.coerce.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT).describe(`Max results`),
    },
    async (params, extra: ToolExtra) => {
      const { ppName, vehCat, limit } = params;
      if (!isUraDataConfigured()) return credentialError();

      const { records, error } = await queryCarParkDetails(() => {});
      if (error) return { content: [{ type: "text" as const, text: `Failed: ${error}` }] };

      let filtered = records;
      if (ppName) filtered = filtered.filter((r) => r.ppName?.toUpperCase().includes(ppName.toUpperCase()));
      if (vehCat) filtered = filtered.filter((r) => r.vehCat?.toUpperCase().includes(vehCat.toUpperCase()));

      return {
        content: [{
          type: "text" as const,
          text: `**Car Park Rates**\n\n${formatCarParkDetailTable(filtered.slice(0, limit))}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_planning_decisions — CHANGE OF USE PRIORITY
  // -------------------------------------------------------------------------
  server.tool(
    "search_planning_decisions",
    "Search planning decisions (granted/rejected) in Singapore. HIGH VALUE: Look for 'Change of Use' applications to identify shifting demographics or commercial value spikes.",
    {
      year: z.string().optional().describe("Year to query (e.g. '2024')"),
      lastDnloadDate: z.string().optional().describe("Records since this date (dd/mm/yyyy)"),
      address: z.string().optional().describe("Filter by address"),
      applType: z.string().optional().describe("e.g. 'Change of Use', 'Subdivision'"),
      decisionType: z.string().optional().describe("e.g. 'Written Permission'"),
      limit: z.coerce.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT).describe(`Max results`),
    },
    async (params, extra: ToolExtra) => {
      const { year, lastDnloadDate, address, applType, decisionType, limit } = params;
      const queryYear = !year && !lastDnloadDate ? String(new Date().getFullYear()) : year;

      if (!isUraDataConfigured()) return credentialError();

      const { records, error } = await queryPlanningDecisions({ year: queryYear, lastDnloadDate }, () => {});
      if (error) return { content: [{ type: "text" as const, text: `Failed: ${error}` }] };

      let filtered = records;
      if (address) filtered = filtered.filter((r) => r.address?.toUpperCase().includes(address.toUpperCase()));
      if (applType) filtered = filtered.filter((r) => r.applType?.toUpperCase().includes(applType.toUpperCase()));
      if (decisionType) filtered = filtered.filter((r) => r.decisionType?.toUpperCase().includes(decisionType.toUpperCase()));

      filtered.sort((a, b) => {
        const parse = (d: string | undefined) => d ? parseInt(d.split("/").reverse().join(""), 10) : 0;
        return parse(b.decisionDate) - parse(a.decisionDate);
      });

      return {
        content: [{
          type: "text" as const,
          text: `**Planning Decisions**\n\n${formatPlanningDecisionTable(filtered.slice(0, limit))}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // search_season_carpark — season parking rates
  // -------------------------------------------------------------------------
  server.tool(
    "search_season_carpark",
    "Get season car park details and monthly rates.",
    {
      ppName: z.string().optional().describe("Filter by name"),
      vehCat: z.string().optional().describe("Vehicle category"),
      limit: z.coerce.number().optional().default(PRIVATE_TXN_LIMIT_DEFAULT).describe(`Max results`),
    },
    async (params, extra: ToolExtra) => {
      const { ppName, vehCat, limit } = params;
      if (!isUraDataConfigured()) return credentialError();

      const { records, error } = await querySeasonCarParks(() => {});
      if (error) return { content: [{ type: "text" as const, text: `Failed: ${error}` }] };

      let filtered = records;
      if (ppName) filtered = filtered.filter((r) => r.ppName?.toUpperCase().includes(ppName.toUpperCase()));
      if (vehCat) filtered = filtered.filter((r) => r.vehCat?.toUpperCase().includes(vehCat.toUpperCase()));

      return {
        content: [{
          type: "text" as const,
          text: `**Season Car Park Rates**\n\n${formatSeasonCarParkTable(filtered.slice(0, limit))}${URA_ATTRIBUTION}`,
        }],
      };
    },
  );

  // -------------------------------------------------------------------------
  // check_residential_use — verify if address is approved for residential use
  // -------------------------------------------------------------------------
  server.tool(
    "check_residential_use",
    "Check if a specific address is approved for residential use. Covers private units with TOP.",
    {
      blkHouseNo: z.string().describe("Block/House number"),
      street: z.string().describe("Street name"),
      storeyNo: z.string().optional().describe("Storey number"),
      unitNo: z.string().optional().describe("Unit number"),
    },
    async (params, extra: ToolExtra) => {
      const { blkHouseNo, street, storeyNo, unitNo } = params;
      if (!isUraDataConfigured()) return credentialError();

      const { isResiUse, error } = await checkResidentialUse(blkHouseNo, street, storeyNo, unitNo, () => {});
      if (error) return { content: [{ type: "text" as const, text: `Failed: ${error}` }] };

      const addr = [blkHouseNo, street, storeyNo, unitNo].filter(Boolean).join(" ");
      const msg = isResiUse === "Y" ? `**${addr}** is approved.` : `**${addr}** — Info unavailable or not approved.`;

      return {
        content: [{ type: "text" as const, text: `${msg}${URA_ATTRIBUTION}` }],
      };
    },
  );
}