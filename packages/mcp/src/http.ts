/**
 * Hosted MCP Streamable HTTP transport.
 *
 * MCP SDK v2 constructs a fresh server for every request. There is no in-memory
 * session map, so any cluster node can serve any request and a rolling deploy
 * cannot strand client sessions. Extrovert issues the consent-bound OAuth grants;
 * this process is only a protected resource server.
 */

import type { Server } from "node:http";
import { randomUUID } from "node:crypto";

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
import { buildAgentContext } from "./agent-context.js";
import { createExtrovertServer } from "./server.js";
import { ASSISTANT_INSTRUCTIONS, ASSISTANT_PROFILE, ASSISTANT_TOOL_NAMES, type CapabilityProfile } from "./profiles.js";
import { ASSISTANT_RELEASE } from "./assistant-release.generated.js";
import { handleTaskMessage, type TaskProtocolOptions } from "./agent-tasks.js";

export interface HttpServerOptions {
  port?: number;
  host?: string;
  env?: NodeJS.ProcessEnv;
}

export interface CreateHttpAppOptions extends HttpServerOptions {
  verifier?: OAuthTokenVerifier;
  assistantVerifier?: OAuthTokenVerifier;
  oauthMetadata?: OAuthMetadata;
  authConfig?: HostedAuthConfig;
  baseConfig?: ExtrovertConfig;
  /** Explicit offline test backend; live requests always use authenticated API access. */
  mockTaskClient?: TaskProtocolOptions["client"];
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
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    res.once("finish", () => {
      if (["/mcp", ASSISTANT_PROFILE.resource_path].includes(req.path) && res.statusCode >= 400) {
        // Never log headers, callback URLs, bearer tokens or request bodies.
        process.stderr.write(`${JSON.stringify({ event: "mcp_connection_failed", request_id: requestId, status: res.statusCode, method: req.method })}\n`);
      }
    });
    next();
  });

  const makeHandler = (profile: CapabilityProfile) => createMcpHandler(
    ({ authInfo, era }) => {
      const apiToken = authInfo?.extra?.apiToken;
      const config = configForRequest(baseConfig, typeof apiToken === "string" ? apiToken : authInfo?.token);
      const client = new ExtrovertClient(config);
      return createExtrovertServer({ config, client, profile, transport:"streamable-http", tasksEnabled: era === "modern" && (!config.mock || options.mockTaskClient !== undefined) }).server;
    },
    {
      legacy: "stateless",
      onerror: (error) => process.stderr.write(profile === "assistant" ? "extrovert-mcp: assistant protocol error\n" : `extrovert-mcp: protocol error: ${error.message}\n`),
    },
  );
  const handler = makeHandler("full");
  const assistantHandler = makeHandler("assistant");
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => process.stderr.write(`extrovert-mcp: HTTP adapter error: ${error.message}\n`),
  });
  const assistantNodeHandler = toNodeHandler(assistantHandler, {
    onerror: () => process.stderr.write("extrovert-mcp: assistant HTTP adapter error\n"),
  });
  const dispatch = (profile: CapabilityProfile, fallback: typeof nodeHandler) => async (req: Request, res: Response): Promise<void> => {
    if (req.method === "POST" && req.is("application/json")) {
      const apiToken = req.auth?.extra?.apiToken;
      const config = configForRequest(baseConfig, typeof apiToken === "string" ? apiToken : req.auth?.token);
      if (!config.mock || options.mockTaskClient) {
        // This handler is mounted AFTER the same bearer verification as MCP.
        const response = await handleTaskMessage(req.body, {
          client: config.mock && options.mockTaskClient ? options.mockTaskClient : new ExtrovertClient(config),
          profile,
          headers: {
            protocolVersion: req.get("MCP-Protocol-Version"),
            method: req.get("Mcp-Method"), name: req.get("Mcp-Name"),
          },
        });
        if (response) {
          res.setHeader("Cache-Control", "no-store");
          res.status(200).json(response);
          return;
        }
      }
    }
    await fallback(req, res, req.body);
  };
  const fullDispatch = dispatch("full", nodeHandler);
  const assistantDispatch = dispatch("assistant", assistantNodeHandler);

  const challenge = env.EXTROVERT_OPENAI_APPS_CHALLENGE;
  if (challenge !== undefined && challenge !== "" && (challenge.length > 4096 || /\s/.test(challenge))) {
    throw new Error("EXTROVERT_OPENAI_APPS_CHALLENGE must contain one non-whitespace token (at most 4096 characters)");
  }
  app.get("/.well-known/openai-apps-challenge", (_req, res) => {
    if (!challenge) { res.sendStatus(404); return; }
    res.setHeader("Cache-Control", "no-store");
    res.type("text/plain").send(challenge);
  });

  app.get("/.well-known/assistant-agent-contract.json", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...ASSISTANT_RELEASE, capability_profile: "assistant", tools: ASSISTANT_TOOL_NAMES, guidance: ASSISTANT_INSTRUCTIONS.split("\n") });
  });

  // Public, bounded discovery. Never include caller identity or credentials.
  app.get("/.well-known/agent-contract.json", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await buildAgentContext(baseConfig));
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
    const assistantResource = new URL(ASSISTANT_PROFILE.resource_path, authConfig.resourceUrl);
    const assistantAuthConfig = { ...authConfig, resourceUrl: assistantResource, scopesSupported: ["extrovert:connect"] };
    const assistantVerifier = options.assistantVerifier ?? createHostedTokenVerifier(assistantAuthConfig, baseConfig.apiBaseUrl, false);
    app.use(
      mcpAuthMetadataRouter({
        oauthMetadata,
        resourceServerUrl: authConfig.resourceUrl,
        serviceDocumentationUrl: authConfig.serviceDocumentationUrl,
        scopesSupported: authConfig.scopesSupported,
        resourceName: "Extrovert MCP",
      }),
    );
    app.use(mcpAuthMetadataRouter({
      oauthMetadata,
      resourceServerUrl: assistantResource,
      serviceDocumentationUrl: authConfig.serviceDocumentationUrl,
      scopesSupported: assistantAuthConfig.scopesSupported,
      resourceName: "Extrovert Assistant",
    }));
    app.all(
      ASSISTANT_PROFILE.resource_path,
      requireBearerAuth({
        verifier: assistantVerifier,
        resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(assistantResource),
      }),
      assistantDispatch,
    );
    app.all(
      "/mcp",
      requireBearerAuth({
        verifier,
        resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(authConfig.resourceUrl),
      }),
      fullDispatch,
    );
  } else {
    app.all("/mcp", fullDispatch);
  }

  return { app, handler, authEnabled, close: async () => { await Promise.all([handler.close(), assistantHandler.close()]); } };
}

export async function runHttp(options: HttpServerOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const port = options.port ?? Number.parseInt(env.PORT ?? "8787", 10);
  const host = options.host ?? env.HOST ?? "0.0.0.0";
  const runtime = await createHttpApp({ ...options, host, env });

  await new Promise<void>((resolve, reject) => {
    const httpServer = runtime.app.listen(port, host, () => {
      process.stderr.write(
        `extrovert-mcp: stateless HTTP listening on http://${host}:${port}/mcp - ${
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
