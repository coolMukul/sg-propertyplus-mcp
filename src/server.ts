// McpServer instance — created once, imported by tool/resource modules.
// Also exports a factory for HTTP transport where each session/request
// needs its own McpServer instance with tools and resources registered.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { SessionState } from "./state.js";
import { registerSearchTools } from "./tools/search.js";
import { registerAnalyzeTools } from "./tools/analyze.js";
import { registerExportTools } from "./tools/export.js";
import { registerUraTools } from "./tools/ura.js";
import { registerAmenityTools } from "./tools/amenities.js";
import { registerTransportTools } from "./tools/transport.js";
import { registerAttributionTools } from "./tools/attribution.js";
import { registerResources } from "./resources.js";

/** Singleton for stdio transport (one client, one server). */
export const server = new McpServer(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { logging: {} } },
);

/** Singleton state for stdio transport. */
export const stdioState = new SessionState();

/** Factory for HTTP transport — returns a fresh McpServer with its own SessionState. */
export function createConfiguredServer(): McpServer {
  const s = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { logging: {} } },
  );
  const state = new SessionState();
  registerSearchTools(s, state);
  registerAnalyzeTools(s, state);
  registerExportTools(s, state);
  registerUraTools(s, state);
  registerAmenityTools(s, state);
  registerTransportTools(s, state);
  registerAttributionTools(s);
  registerResources(s, state);
  return s;
}
