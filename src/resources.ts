// MCP resources — last-search and status.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { SessionState } from "./state.js";

export function registerResources(server: McpServer, state: SessionState): void {
  server.resource(
    "last-search",
    "sgpropertyplus://last-search",
    { description: "Returns the last search results including query parameters, results, and timestamp" },
    async () => {
      const last = state.getLastSearch();
      if (!last) {
        return {
          contents: [
            {
              uri: "sgpropertyplus://last-search",
              text: "No searches performed yet.",
              mimeType: "text/plain",
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: "sgpropertyplus://last-search",
            text: JSON.stringify(last, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    }
  );

  server.resource(
    "status",
    "sgpropertyplus://status",
    { description: "Server status: name, version, uptime, search count, last search time" },
    async () => {
      const last = state.getLastSearch();
      const status = {
        server: SERVER_NAME,
        version: SERVER_VERSION,
        uptimeSeconds: state.getUptimeSeconds(),
        totalSearches: state.getSearchCount(),
        lastSearchTimestamp: last?.timestamp ?? null,
      };

      return {
        contents: [
          {
            uri: "sgpropertyplus://status",
            text: JSON.stringify(status, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    }
  );
}
