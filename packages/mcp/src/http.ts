/**
 * Hosted HTTP transport — MCP Streamable HTTP over Express.
 *
 * Serves the same toolset as stdio at `POST /mcp` (plus `GET`/`DELETE /mcp` for
 * the SSE stream and session teardown). A scoped agent key may be supplied per
 * request via `Authorization: Bearer …` (or `x-extrovert-api-key`) so one hosted
 * deployment can serve many agents, each with their own scoped key — never an
 * org-wide key (spec §14). Falls back to the env key when no header is present.
 *
 * Sessions are tracked by the `mcp-session-id` header the SDK assigns on
 * initialize, so each agent gets an isolated server + client instance.
 */

import { randomUUID } from "node:crypto";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express, { type Request, type Response } from "express";

import { ExtrovertClient } from "./client.js";
import { loadConfig, SERVER_NAME, SERVER_VERSION, type ExtrovertConfig } from "./config.js";
import { createExtrovertServer } from "./server.js";

interface Session {
  transport: StreamableHTTPServerTransport;
  close: () => Promise<void>;
}

export interface HttpServerOptions {
  port?: number;
  host?: string;
}

const SESSION_HEADER = "mcp-session-id";

/** Read a per-request scoped key from standard headers, if present. */
function keyFromRequest(req: Request): string | undefined {
  const auth = req.header("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const custom = req.header("x-extrovert-api-key");
  if (custom) return custom.trim();
  return undefined;
}

/** Build a per-session config, layering an optional request key over env. */
function configForRequest(base: ExtrovertConfig, req: Request): ExtrovertConfig {
  const key = keyFromRequest(req);
  if (key === undefined) return base;
  // A request key implies a live caller; honor it for this session.
  return { ...base, apiKey: key, mock: base.mock && key === "" };
}

export async function runHttp(options: HttpServerOptions = {}): Promise<void> {
  const baseConfig = loadConfig();
  const port = options.port ?? Number.parseInt(process.env.PORT ?? "8787", 10);
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";

  const app = express();
  app.use(express.json({ limit: "4mb" }));

  const sessions = new Map<string, Session>();

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      server: SERVER_NAME,
      version: SERVER_VERSION,
      mode: baseConfig.mock ? "mock" : "live",
      sessions: sessions.size,
    });
  });

  // Primary MCP endpoint: client→server messages (incl. initialize).
  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.header(SESSION_HEADER);

    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId)!.transport.handleRequest(req, res, req.body);
      return;
    }

    if (sessionId && !sessions.has(sessionId)) {
      res.status(404).json(jsonRpcError(-32001, "Unknown or expired session"));
      return;
    }

    if (!isInitializeRequest(req.body)) {
      res
        .status(400)
        .json(jsonRpcError(-32000, "First request must be an MCP initialize call"));
      return;
    }

    // New session: stand up a fresh server + client with the caller's key.
    const config = configForRequest(baseConfig, req);
    const client = new ExtrovertClient(config);
    const { server } = createExtrovertServer({ config, client });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, {
          transport,
          close: async () => {
            await server.close().catch(() => {});
          },
        });
      },
    });

    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) sessions.delete(id);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Server→client SSE stream + session teardown.
  const replay = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.header(SESSION_HEADER);
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(404).json(jsonRpcError(-32001, "Unknown or expired session"));
      return;
    }
    await sessions.get(sessionId)!.transport.handleRequest(req, res);
  };
  app.get("/mcp", replay);
  app.delete("/mcp", replay);

  await new Promise<void>((resolve) => {
    const httpServer = app.listen(port, host, () => {
      const mode = baseConfig.mock ? "offline fixtures" : `live API ${baseConfig.apiBaseUrl}`;
      process.stderr.write(
        `extrovert-mcp: HTTP transport listening on http://${host}:${port}/mcp — ${mode}\n`,
      );
      resolve();
    });

    const shutdown = (): void => {
      for (const session of sessions.values()) void session.close();
      httpServer.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

function jsonRpcError(code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}
