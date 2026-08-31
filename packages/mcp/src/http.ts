/**
 * Hosted MCP Streamable HTTP transport.
 *
 * MCP SDK v2 constructs a fresh server for every request. There is no in-memory
 * session map, so any cluster node can serve any request and a rolling deploy
 * cannot strand client sessions. Clerk remains the OAuth authorization server;
 * this process is only a protected resource server.
 */

import type { Server } from "node:http";

import {
  createMcpHandler,
  type McpHttpHandler,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";
import {
  createMcpExpressApp,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
  requireBearerAuth,
} from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { Express, Request, Response } from "express";

import {
  createHostedTokenVerifier,
  discoverOAuthMetadata,
  loadHostedAuthConfig,
  type HostedAuthConfig,
} from "./auth.js";
import { ExtrovertClient } from "./client.js";
import { loadConfig, SERVER_NAME, SERVER_VERSION, type ExtrovertConfig } from "./config.js";
import { createExtrovertServer } from "./server.js";

export interface HttpServerOptions {
  port?: number;
  host?: string;
  env?: NodeJS.ProcessEnv;
}

export interface CreateHttpAppOptions extends HttpServerOptions {
  verifier?: OAuthTokenVerifier;
  oauthMetadata?: OAuthMetadata;
  authConfig?: HostedAuthConfig;
  baseConfig?: ExtrovertConfig;
}

export interface HttpApp {
  app: Express;
  handler: McpHttpHandler;
  authEnabled: boolean;
  close(): Promise<void>;
}

export async function createHttpApp(options: CreateHttpAppOptions = {}): Promise<HttpApp> {
  const env = options.env ?? process.env;
  const baseConfig = options.baseConfig ?? loadConfig(env);
  const host = options.host ?? env.HOST ?? "0.0.0.0";
  const productionAuth = parseBool(env.EXTROVERT_MCP_OAUTH_ENABLED);
  const injectedAuth = options.verifier !== undefined || options.oauthMetadata !== undefined;
  const authEnabled = productionAuth || injectedAuth;

  let authConfig = options.authConfig;
  let verifier = options.verifier;
  let oauthMetadata = options.oauthMetadata;
  if (authEnabled) {
    authConfig ??= loadHostedAuthConfig(env);
    verifier ??= createHostedTokenVerifier(authConfig, baseConfig.apiBaseUrl);
    oauthMetadata ??= await discoverOAuthMetadata(authConfig.issuer);
  } else if (!baseConfig.mock && baseConfig.apiKey === "") {
    throw new Error(
      "HTTP transport requires EXTROVERT_MCP_OAUTH_ENABLED=1, EXTROVERT_API_KEY, or EXTROVERT_MOCK=1",
    );
  }

  const allowedHosts = authConfig
    ? uniqueStrings([
        authConfig.resourceUrl.hostname,
        "127.0.0.1",
        "localhost",
        "[::1]",
        ...(env.EXTROVERT_MCP_ALLOWED_HOSTS ?? "").split(","),
      ])
    : undefined;
  const app = createMcpExpressApp({ host, allowedHosts, jsonLimit: "4mb" });

  const handler = createMcpHandler(
    ({ authInfo }) => {
      const config = configForRequest(baseConfig, authInfo?.token);
      const client = new ExtrovertClient(config);
      return createExtrovertServer({ config, client }).server;
    },
    {
      legacy: "stateless",
      onerror: (error) => process.stderr.write(`extrovert-mcp: protocol error: ${error.message}\n`),
    },
  );
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => process.stderr.write(`extrovert-mcp: HTTP adapter error: ${error.message}\n`),
  });

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      server: SERVER_NAME,
      version: SERVER_VERSION,
      transport: "streamable-http-stateless",
      auth: authEnabled
        ? "oauth-or-agent-key"
        : baseConfig.mock
          ? "offline-fixtures"
          : "environment-key",
    });
  });

  if (authEnabled && authConfig && verifier && oauthMetadata) {
    app.use(
      mcpAuthMetadataRouter({
        oauthMetadata,
        resourceServerUrl: authConfig.resourceUrl,
        serviceDocumentationUrl: authConfig.serviceDocumentationUrl,
        scopesSupported: authConfig.scopesSupported,
        resourceName: "Extrovert MCP",
      }),
    );
    app.all(
      "/mcp",
      requireBearerAuth({
        verifier,
        resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(authConfig.resourceUrl),
      }),
      (req: Request, res: Response) => {
        void nodeHandler(req, res, req.body);
      },
    );
  } else {
    app.all("/mcp", (req: Request, res: Response) => {
      void nodeHandler(req, res, req.body);
    });
  }

  return { app, handler, authEnabled, close: () => handler.close() };
}

export async function runHttp(options: HttpServerOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const port = options.port ?? Number.parseInt(env.PORT ?? "8787", 10);
  const host = options.host ?? env.HOST ?? "0.0.0.0";
  const runtime = await createHttpApp({ ...options, host, env });

  await new Promise<void>((resolve, reject) => {
    const httpServer = runtime.app.listen(port, host, () => {
      process.stderr.write(
        `extrovert-mcp: stateless HTTP listening on http://${host}:${port}/mcp — ${
          runtime.authEnabled ? "OAuth + scoped agent keys" : "local mode"
        }\n`,
      );
      resolve();
    });
    httpServer.once("error", reject);
    installShutdown(httpServer, runtime);
  });
}

function configForRequest(base: ExtrovertConfig, requestToken: string | undefined): ExtrovertConfig {
  if (!requestToken) return base;
  return { ...base, apiKey: requestToken, mock: false };
}

function installShutdown(server: Server, runtime: HttpApp): void {
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void runtime.close().finally(() => server.close(() => process.exit(0)));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function parseBool(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
