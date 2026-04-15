// Analyze tool — uses MCP sampling to ask the client's LLM for insights.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { SAMPLING_MAX_TOKENS } from "../config.js";
import { SessionState } from "../state.js";
import {
  LandParcel, HdbResaleRecord, PrivateTransaction, PrivateRental,
  DeveloperSale, RentalMedian, PipelineProject,
  CarParkAvailability, CarParkDetail, SeasonCarPark, PlanningDecision,
  NearbyAmenity, SearchState,
} from "../types.js";
import {
  formatLandParcelsTable, formatHdbTable,
  formatPrivateTransactionTable, formatPrivateRentalTable,
  formatDeveloperSaleTable, formatRentalMedianTable, formatPipelineTable,
  formatCarParkAvailabilityTable, formatCarParkDetailTable,
  formatSeasonCarParkTable, formatPlanningDecisionTable,
  formatNearbyAmenityTable,
} from "../formatters.js";
import { type ToolExtra, logInfo } from "../helpers.js";

/**
 * Build a system prompt and user message for the analyze_results tool.
 * Tailored to the search type (land-use vs HDB resale).
 */
function buildAnalysisPrompt(
  search: SearchState,
  question?: string,
): { systemPrompt: string; userMessage: string } {
  let dataTable: string;
  let systemPrompt: string;

  switch (search.type) {
    case "land-use":
      dataTable = formatLandParcelsTable(search.results as LandParcel[]);
      systemPrompt = [
        "You are a Singapore urban planning analyst. Analyze the provided land use data. Base all conclusions strictly on the data given — do not assume zoning rules or regulations not evident from the results.",
        "",
        "Cover:",
        "1. **Dominant uses** — what land use types appear most, and what this signals about the area's character",
        "2. **Development density** — interpret gross plot ratios (>2.5 = high-density, 1.4-2.5 = medium, <1.4 = low)",
        "3. **Zoning mix** — is this a single-use zone or mixed? What does the residential/commercial/industrial balance suggest?",
        "4. **Notable observations** — anything unusual (e.g. reserve sites, special use, white sites)",
        "",
        "Keep the analysis to 3-5 short paragraphs. Use the search parameters to contextualize (radius, location).",
      ].join("\n");
      break;
    case "private-transaction":
      dataTable = formatPrivateTransactionTable(search.results as PrivateTransaction[]);
      systemPrompt = [
        "You are a Singapore private property market analyst. Analyze the provided transaction data. Base all conclusions strictly on the data given.",
        "",
        "Cover:",
        "1. **Price range & PSF** — min, max, median prices; calculate $/psf (price / (area_sqm x 10.764)) to compare across unit sizes",
        "2. **Market segments** — CCR (Core Central, prime districts 9/10/11), RCR (Rest of Central), OCR (Outside Central suburbs). How do prices differ?",
        "3. **Price drivers** — how do floor level, district, property type, and tenure (freehold vs leasehold) affect price?",
        "4. **Sale types** — new sales vs resale vs sub-sales. What's the mix and does it signal market phase?",
        "5. **Key takeaway** — one sentence on what stands out",
        "",
        "Keep the analysis to 3-5 short paragraphs. This is informational analysis, not financial advice.",
      ].join("\n");
      break;
    case "private-rental":
      dataTable = formatPrivateRentalTable(search.results as PrivateRental[]);
      systemPrompt = [
        "You are a Singapore rental market analyst. Analyze the provided rental contract data. Base all conclusions strictly on the data given.",
        "",
        "Cover:",
        "1. **Rent levels** — range and median rents; note how rent varies by district and property type",
        "2. **Bedroom impact** — how does bedroom count affect rent? Calculate approximate rent-per-bedroom where possible",
        "3. **Area efficiency** — compare rent to area range (sqm) to identify value for money",
        "4. **District patterns** — which districts command premium rents and why (central vs suburban)",
        "5. **Key takeaway** — one sentence on what stands out",
        "",
        "Keep the analysis to 3-5 short paragraphs. This is informational analysis, not financial advice.",
      ].join("\n");
      break;
    case "developer-sales":
      dataTable = formatDeveloperSaleTable(search.results as DeveloperSale[]);
      systemPrompt = [
        "You are a Singapore new-launch property analyst. Analyze the provided developer sales data. Base all conclusions strictly on the data given.",
        "",
        "Cover:",
        "1. **Pricing** — median $/psf across projects; compare highest vs lowest and what drives the gap",
        "2. **Sales velocity** — sell-through rate (sold / (sold + available)). Above 70% = strong demand, below 30% = slow absorption",
        "3. **Market segments** — CCR (prime), RCR (city fringe), OCR (suburbs). Where is activity concentrated?",
        "4. **Project highlights** — best-selling projects and any that are struggling",
        "5. **Key takeaway** — one sentence on what stands out",
        "",
        "Keep the analysis to 3-5 short paragraphs. This is informational analysis, not financial advice.",
      ].join("\n");
      break;
    case "rental-median":
      dataTable = formatRentalMedianTable(search.results as RentalMedian[]);
      systemPrompt = [
        "You are a Singapore rental market analyst. Analyze the provided median rental rate data. Base all conclusions strictly on the data given.",
        "",
        "Cover:",
        "1. **Top performers** — which projects/districts command the highest median $/psf/month rents?",
        "2. **Percentile spread** — a narrow 25th-75th gap signals stable pricing; a wide gap signals volatility or mixed unit quality",
        "3. **District comparison** — how do central vs suburban districts compare?",
        "4. **Outliers** — any projects significantly above or below peers in the same district?",
        "5. **Key takeaway** — one sentence on what stands out",
        "",
        "Keep the analysis to 3-5 short paragraphs. This is informational analysis, not financial advice.",
      ].join("\n");
      break;
    case "pipeline":
      dataTable = formatPipelineTable(search.results as PipelineProject[]);
      systemPrompt = [
        "You are a Singapore property development analyst. Analyze the provided pipeline data. Base all conclusions strictly on the data given.",
        "",
        "Cover:",
        "1. **Upcoming supply** — total units in the pipeline; how are they distributed across districts?",
        "2. **Property type mix** — ratio of condos vs apartments vs landed (terrace/semi-D/detached). What does this signal about the target market?",
        "3. **Timeline** — when are projects expected to complete (TOP year)? Is supply front-loaded or spread out?",
        "4. **Developer concentration** — are a few developers dominating, or is it diversified?",
        "5. **Supply risk** — districts with very high upcoming units may face price pressure from oversupply",
        "",
        "Keep the analysis to 3-5 short paragraphs. This is informational analysis, not financial advice.",
      ].join("\n");
      break;
    case "nearby-amenities":
      dataTable = formatNearbyAmenityTable(search.results as NearbyAmenity[]);
      systemPrompt = [
        "You are a Singapore neighborhood analyst. Analyze the provided nearby amenities data. Base all conclusions strictly on the data given.",
        "",
        "Cover:",
        "1. **Transport access** — MRT/LRT stations within 500m are excellent, 500m-1km is acceptable; note bus stop coverage",
        "2. **Daily essentials** — supermarkets, food courts/hawker centres, clinics, pharmacies — are basics within walking distance (<500m)?",
        "3. **Family-friendliness** — schools, parks, hospitals nearby",
        "4. **Coverage gaps** — important amenity categories that are missing or far away",
        "5. **Overall livability verdict** — one sentence summary",
        "",
        "Distance matters: group observations by walkable (<500m), nearby (500m-1km), and distant (>1km). Keep the analysis to 3-5 short paragraphs.",
      ].join("\n");
      break;
    case "carpark-availability":
      dataTable = formatCarParkAvailabilityTable(search.results as CarParkAvailability[]);
      systemPrompt = [
        "You are a Singapore parking analyst. Analyze the provided car park availability data. Base all conclusions strictly on the data given.",
        "",
        "Cover: which car parks have lots available, lot type breakdown (C=car, M=motorcycle, H=heavy vehicle), and overall availability. Note any car parks that are full or nearly full.",
        "",
        "Keep the analysis to 2-3 short paragraphs.",
      ].join("\n");
      break;
    case "carpark-details":
      dataTable = formatCarParkDetailTable(search.results as CarParkDetail[]);
      systemPrompt = [
        "You are a Singapore parking analyst. Analyze the provided car park rate data. Base all conclusions strictly on the data given.",
        "",
        "Cover: rate comparisons (weekday vs weekend vs Sunday/PH), capacity, parking system types (C=coupon, B=electronic), and which car parks offer the best value. Note operating hours.",
        "",
        "Keep the analysis to 2-3 short paragraphs.",
      ].join("\n");
      break;
    case "season-carpark":
      dataTable = formatSeasonCarParkTable(search.results as SeasonCarPark[]);
      systemPrompt = [
        "You are a Singapore parking analyst. Analyze the provided season parking data. Base all conclusions strictly on the data given.",
        "",
        "Cover: monthly rate comparisons, parking hours, ticket types, and which car parks offer the best value for regular parkers.",
        "",
        "Keep the analysis to 2-3 short paragraphs.",
      ].join("\n");
      break;
    case "planning-decision":
      dataTable = formatPlanningDecisionTable(search.results as PlanningDecision[]);
      systemPrompt = [
        "You are a Singapore urban planning analyst. Analyze the provided planning decision data. Base all conclusions strictly on the data given.",
        "",
        "Cover:",
        "1. **Application types** — Change of Use signals neighborhood character shifts; Subdivision signals land fragmentation; Addition & Alteration signals upgrading activity",
        "2. **Activity hotspots** — which addresses or areas have the most applications?",
        "3. **Timeline** — any clustering of decisions around certain dates?",
        "4. **Notable projects** — any large or unusual submissions that stand out?",
        "",
        "Keep the analysis to 3-5 short paragraphs.",
      ].join("\n");
      break;
    default:
      dataTable = formatHdbTable(search.results as HdbResaleRecord[]);
      systemPrompt = [
        "You are a Singapore property market analyst. Analyze the provided HDB resale transaction data. Base all conclusions strictly on the data given.",
        "",
        "Cover:",
        "1. **Price range** — min, max, median prices; calculate and compare price per square foot (PSF = price / (area_sqm x 10.764)) where possible",
        "2. **Price drivers** — how do flat type, storey range, and floor area correlate with price?",
        "3. **Lease impact** — note remaining lease durations; leases below 60 years significantly affect financing eligibility in Singapore",
        "4. **Time patterns** — if multiple months are present, note any price movement",
        "5. **Key takeaway** — one sentence on what stands out",
        "",
        "Keep the analysis to 3-5 short paragraphs. This is informational analysis, not financial advice.",
      ].join("\n");
      break;
  }

  const queryLines = Object.entries(search.query)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  let userMessage = [
    `Search parameters:\n${queryLines}`,
    `Search performed: ${search.timestamp}`,
    `Total results: ${search.results.length}`,
    `\nData:\n${dataTable}`,
  ].join("\n");

  if (question) {
    userMessage += `\n\nUser's specific question: ${question}`;
  }

  return { systemPrompt, userMessage };
}

export function registerAnalyzeTools(server: McpServer, state: SessionState): void {
  // Guard against sampling cycles — if the client's LLM calls analyze_results
  // during a sampling request, we'd recurse infinitely. This flag prevents re-entry.
  let isSampling = false;

  server.tool(
    "analyze_results",
    "Analyze the last search results using AI. Provides insights, patterns, and summaries. Best used after a search returns results — works with all data types (land use, HDB resale, private transactions, rentals, amenities, and more).",
    {
      question: z
        .string()
        .optional()
        .describe(
          "Optional focus for the analysis (e.g. 'which areas are most dense?', 'what is the price trend?')",
        ),
    },
    async ({ question }, extra: ToolExtra) => {
      await logInfo(extra, `analyze_results: question=${question ?? "(general analysis)"}`);

      if (isSampling) {
        await logInfo(extra, "analyze_results: blocked re-entrant call (sampling cycle prevented)");
        return {
          content: [
            {
              type: "text" as const,
              text: "Analysis is already in progress. This tool cannot be called recursively.",
            },
          ],
        };
      }

      // 1. Check for previous search results
      const lastSearch = state.getLastSearch();
      if (!lastSearch) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No search results to analyze. Run a search tool first (e.g. search_area, search_hdb_resale, search_private_transactions).",
            },
          ],
        };
      }

      if (lastSearch.results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "The last search returned no results — nothing to analyze.",
            },
          ],
        };
      }

      // 2. Build the analysis prompt
      const { systemPrompt, userMessage } = buildAnalysisPrompt(lastSearch, question);
      await logInfo(
        extra,
        `analyze_results: requesting analysis for ${lastSearch.type} data (${lastSearch.results.length} results)`,
      );

      // 3. Ask the client's LLM via MCP sampling.
      //    server.server is the low-level Server instance — McpServer doesn't
      //    expose createMessage() directly, so we reach through to the protocol layer.
      isSampling = true;
      try {
        const result = await server.server.createMessage({
          messages: [
            {
              role: "user",
              content: { type: "text", text: userMessage },
            },
          ],
          systemPrompt,
          includeContext: "none",
          maxTokens: SAMPLING_MAX_TOKENS,
        });

        // 4. Extract text from the sampling response
        const analysisText =
          result.content.type === "text"
            ? result.content.text
            : "The analysis returned non-text content.";

        await logInfo(extra, "analyze_results: analysis complete");

        const headings: Record<string, string> = {
          "land-use": "Land Use", "hdb-resale": "HDB Resale",
          "private-transaction": "Private Transactions", "private-rental": "Private Rentals",
          "developer-sales": "Developer Sales", "rental-median": "Rental Medians",
          "pipeline": "Pipeline",
          "carpark-availability": "Car Park Availability",
          "carpark-details": "Car Park Details",
          "season-carpark": "Season Car Park",
          "planning-decision": "Planning Decisions",
          "nearby-amenities": "Nearby Amenities",
        };
        const heading = headings[lastSearch.type] ?? "Search";

        return {
          content: [
            {
              type: "text" as const,
              text: `**Analysis of ${heading} Results**\n\n${analysisText}`,
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logInfo(extra, `analyze_results: sampling failed — ${message}`);

        return {
          content: [
            {
              type: "text" as const,
              text: "Could not analyze results — the client may not support AI-assisted analysis. Try reviewing the raw data in the last search results instead.",
            },
          ],
        };
      } finally {
        isSampling = false;
      }
    },
  );
}
