// Streamable HTTP transport — stateful and stateless modes.
// Stateful: one transport per session, stored in a Map, supports SSE + server-push.
// Stateless: fresh server + transport per request, no session tracking.

import { randomUUID } from "node:crypto";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import {
  SERVER_NAME,
  SERVER_VERSION,
  HTTP_PORT,
  HTTP_HOST,
  HTTP_MODE,
  HTTP_SESSION_TTL_SECONDS,
} from "./config.js";
import { createConfiguredServer } from "./server.js";

/**
 * Start the HTTP transport server.
 * Mode is read from HTTP_MODE env var: "stateful" (default) or "stateless".
 */
export async function startHttpServer(): Promise<void> {
  const app = express();
  app.use(express.json());

  // DNS rebinding protection — only accept requests addressed to the expected host.
  // Without this, a malicious webpage could reach the server via DNS rebinding.
  const allowedHosts = new Set([
    `${HTTP_HOST}:${HTTP_PORT}`,
    `localhost:${HTTP_PORT}`,
    `127.0.0.1:${HTTP_PORT}`,
    // Without port (some clients omit it)
    HTTP_HOST,
    "localhost",
    "127.0.0.1",
  ]);

  app.use((req, res, next) => {
    const host = req.headers.host;
    if (!host || !allowedHosts.has(host)) {
      console.error(`[http] Rejected request with unexpected Host header: ${host}`);
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Forbidden" },
        id: null,
      });
      return;
    }
    next();
  });

  if (HTTP_MODE === "stateless") {
    setupStateless(app);
  } else {
    setupStateful(app);
  }

  app.listen(HTTP_PORT, HTTP_HOST, () => {
    console.error(
      `${SERVER_NAME} v${SERVER_VERSION} running on http://${HTTP_HOST}:${HTTP_PORT}/mcp (${HTTP_MODE})`,
    );
  });
}

// ---------------------------------------------------------------------------
// Stateful mode
// ---------------------------------------------------------------------------
// Each client session gets its own McpServer + transport pair. The transport
// is created on the first request (initialize) and stored by session ID.
// Subsequent requests include the mcp-session-id header and route to the
// same transport. SSE GET streams and DELETE for cleanup are supported.

function setupStateful(app: express.Express): void {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const sessionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const ttlMs = HTTP_SESSION_TTL_SECONDS * 1000;

  /** Close a session and clear its TTL timer. */
  function expireSession(sid: string): void {
    const timer = sessionTimers.get(sid);
    if (timer) clearTimeout(timer);
    sessionTimers.delete(sid);

    const transport = transports.get(sid);
    if (transport) {
      console.error(`[stateful] Session expired (TTL ${HTTP_SESSION_TTL_SECONDS}s): ${sid}`);
      transport.close();
      // transport.onclose handler removes it from the transports Map
    }
  }

  // --- POST: client-to-server messages ---
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      // Existing session — route to stored transport
      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // New session — must be an initialize request
      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            console.error(`[stateful] Session created: ${sid} (TTL ${HTTP_SESSION_TTL_SECONDS}s)`);
            transports.set(sid, transport);
            // Start max-age timer — session auto-closes after TTL
            sessionTimers.set(sid, setTimeout(() => expireSession(sid), ttlMs));
          },
        });

        // Clean up on close (explicit DELETE or TTL expiry)
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            console.error(`[stateful] Session closed: ${sid}`);
            transports.delete(sid);
            const timer = sessionTimers.get(sid);
            if (timer) clearTimeout(timer);
            sessionTimers.delete(sid);
          }
        };

        // Connect a fresh server to this transport, then handle the request
        const server = createConfiguredServer();
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Neither valid session nor initialize — reject
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no valid session ID" },
        id: null,
      });
    } catch (error) {
      console.error("[stateful] Error handling POST:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // --- GET: SSE stream for server-to-client messages ---
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  // --- DELETE: session termination ---
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }
    console.error(`[stateful] Session termination requested: ${sessionId}`);
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
  });

  // Graceful shutdown — close all transports and clear timers
  process.on("SIGINT", async () => {
    console.error("[stateful] Shutting down, closing all sessions…");
    for (const timer of sessionTimers.values()) clearTimeout(timer);
    sessionTimers.clear();
    for (const [sid, transport] of transports) {
      try {
        await transport.close();
      } catch {
        console.error(`[stateful] Error closing session ${sid}`);
      }
    }
    transports.clear();
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Stateless mode
// ---------------------------------------------------------------------------
// Every request gets a brand-new McpServer + transport. No session tracking,
// no SSE GET streams, no DELETE. Simple request → response.

function setupStateless(app: express.Express): void {
  app.post("/mcp", async (req, res) => {
    try {
      const server = createConfiguredServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // no sessions
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      // Clean up after response finishes
      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error("[stateless] Error handling POST:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // GET and DELETE are not supported in stateless mode
  app.get("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless mode)" },
      id: null,
    });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless mode)" },
      id: null,
    });
  });

  process.on("SIGINT", () => {
    console.error("[stateless] Shutting down…");
    process.exit(0);
  });
}
