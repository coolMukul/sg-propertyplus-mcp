#!/usr/bin/env node

// SG-PropertyPlus MCP Server — Singapore land use and property exploration.
// Entry point: reads TRANSPORT env var and starts the appropriate transport.
//   TRANSPORT=stdio  (default) — one client via stdin/stdout
//   TRANSPORT=http             — multi-client via Streamable HTTP

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { SERVER_NAME, SERVER_VERSION, TRANSPORT, ONEMAP_TOKEN, ONEMAP_EMAIL } from "./config.js";
import { isOneMapConfigured } from "./api/onemap.js";
import { isUraDataConfigured } from "./api/ura-data.js";
import { isLtaConfigured } from "./api/lta.js";
import { server, stdioState } from "./server.js";
import { registerSearchTools } from "./tools/search.js";
import { registerAnalyzeTools } from "./tools/analyze.js";
import { registerExportTools } from "./tools/export.js";
import { registerUraTools } from "./tools/ura.js";
import { registerAmenityTools } from "./tools/amenities.js";
import { registerTransportTools } from "./tools/transport.js";
import { registerSchoolTools } from "./tools/schools.js";
import { registerCompareTools } from "./tools/compare.js";
import { registerStampDutyTools } from "./tools/stamp-duty.js";
import { registerDemographicsTools } from "./tools/demographics.js";
import { registerAttributionTools } from "./tools/attribution.js";
import { registerResources } from "./resources.js";
import { startHttpServer } from "./http-server.js";

// --- Start ---

async function main() {
  if (TRANSPORT === "http") {
    // HTTP mode — server factory creates per-session/per-request instances.
    // startHttpServer handles its own setup and listening.
    await startHttpServer();
  } else {
    // Stdio mode — single server, register tools/resources on the singleton.
    registerSearchTools(server, stdioState);
    registerAnalyzeTools(server, stdioState);
    registerExportTools(server, stdioState);
    registerUraTools(server, stdioState);
    registerAmenityTools(server, stdioState);
    registerTransportTools(server, stdioState);
    registerSchoolTools(server, stdioState);
    registerCompareTools(server);
    registerStampDutyTools(server);
    registerDemographicsTools(server, stdioState);
    registerAttributionTools(server);
    registerResources(server, stdioState);

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
    console.error(`[startup] OneMap configured: ${isOneMapConfigured()} (token: ${ONEMAP_TOKEN ? "yes" : "no"}, email: ${ONEMAP_EMAIL ? "yes" : "no"})`);
    console.error(`[startup] URA Data Service configured: ${isUraDataConfigured()}`);
    console.error(`[startup] LTA DataMall configured: ${isLtaConfigured()}`);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
