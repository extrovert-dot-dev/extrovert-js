import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

const DEFAULT_ISSUER = "https://api.extrovert.dev";
const DEFAULT_PUBLIC_URL = "https://mcp.extrovert.dev/mcp";
const DISCOVERY_TIMEOUT_MS = 10_000;
const AGENT_KEY_ATTESTATION_SECONDS = 300;

export interface HostedAuthConfig {
  issuer: URL;
  resourceUrl: URL;
  serviceDocumentationUrl: URL;
  scopesSupported: string[];
  exchangeSecret: string;
}

export interface ExtrovertTokenVerifierOptions {
  exchangeSecret: string;
  resourceUrl: URL;
  apiBaseUrl: string;
  fetch?: typeof fetch;
}

/** Verify explicit connection grants and existing scoped Extrovert agent keys. */
export class ExtrovertTokenVerifier implements OAuthTokenVerifier {
  private readonly exchangeSecret: string;
  private readonly resourceUrl: URL;
  private readonly apiBaseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(options: ExtrovertTokenVerifierOptions) {
    this.exchangeSecret = options.exchangeSecret;
    this.resourceUrl = options.resourceUrl;
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, "");
    this.doFetch = options.fetch ?? fetch;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (token.startsWith("pk_agent_")) return this.verifyAgentKey(token);
    if (!token.startsWith("ev_access_")) {
      throw invalidToken("Reconnect through your MCP host to choose explicit access. Legacy sign-ins and API-only credentials cannot authenticate this resource.");
    }
    if (this.exchangeSecret.length < 32) throw invalidToken("Connection verification is not configured");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
    try {
      const response = await this.doFetch(`${this.apiBaseUrl}/oauth/exchange`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`extrovert-mcp:${this.exchangeSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
          subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
          subject_token: token,
          resource: this.apiBaseUrl,
        }).toString(),
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) throw invalidToken("Connection access is invalid, expired, or revoked. Reconnect to choose access again.");
      const body = await response.json() as Record<string, unknown>;
      const apiToken = requiredString(body.access_token);
      const clientId = requiredString(body.client_id);
      const connectionId = requiredString(body.connection_id);
      const seconds = body.expires_in;
      if (!apiToken.startsWith("ev_access_") || !clientId || !connectionId ||
          body.token_type !== "Bearer" || body.resource !== this.apiBaseUrl ||
          typeof seconds !== "number" || !Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 600 ||
          typeof body.scope !== "string" || !body.scope.trim()) {
        throw invalidToken("Connection verification returned an invalid grant");
      }
      return {
        token, clientId,
        scopes: body.scope.trim().split(/\s+/),
        expiresAt: Math.floor(Date.now() / 1000) + seconds,
        resource: this.resourceUrl,
        // Private request context only. The MCP bearer is never forwarded to
        // business endpoints, and the exchanged bearer is never returned to the host.
        extra: { tokenType: "connection", connectionId, apiToken },
      };
    } catch (error) {
      if (OAuthError.isInstance(error)) throw error;
      throw invalidToken("Connection verification is unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async verifyAgentKey(token: string): Promise<AuthInfo> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
    try {
      const response = await this.doFetch(`${this.apiBaseUrl}/v1/auth/me`, {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok) throw invalidToken("Extrovert agent key is invalid or revoked");
      const body = (await response.json()) as Record<string, unknown>;
      const keyId = requiredString(body.key_id);
      const agentId = requiredString(body.agent_id);
      const scopes = stringArray(body.scopes);
      if (!keyId || !agentId) {
        throw invalidToken("Extrovert agent-key introspection returned an invalid principal");
      }
      return {
        token,
        clientId: `extrovert-agent:${agentId}`,
        scopes,
        // This is the lifetime of the successful introspection result. Because
        // HTTP is stateless, every later request validates the key again.
        expiresAt: Math.floor(Date.now() / 1000) + AGENT_KEY_ATTESTATION_SECONDS,
        resource: this.resourceUrl,
        extra: { tokenType: "agent_key", keyId, agentId },
      };
    } catch (error) {
      if (OAuthError.isInstance(error)) throw error;
      throw invalidToken("Extrovert agent-key verification failed");
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function loadHostedAuthConfig(env: NodeJS.ProcessEnv = process.env): HostedAuthConfig {
  const issuer = new URL((env.EXTROVERT_MCP_OAUTH_ISSUER ?? DEFAULT_ISSUER).trim());
  const resourceUrl = new URL((env.EXTROVERT_MCP_PUBLIC_URL ?? DEFAULT_PUBLIC_URL).trim());
  const serviceDocumentationUrl = new URL(
    (env.EXTROVERT_MCP_DOCUMENTATION_URL ?? "https://docs.extrovert.dev/mcp/overview/").trim(),
  );
  const exchangeSecret = (env.EXTROVERT_CONNECTION_EXCHANGE_SECRET ?? "").trim();
  if (exchangeSecret.length < 32) {
    throw new Error("hosted MCP OAuth requires EXTROVERT_CONNECTION_EXCHANGE_SECRET (at least 32 characters)");
  }
  if (issuer.protocol !== "https:" || resourceUrl.protocol !== "https:") {
    throw new Error("hosted MCP OAuth issuer and resource URL must use HTTPS");
  }
  const scopesSupported = (env.EXTROVERT_MCP_OAUTH_SCOPES ?? "extrovert:connect")
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return {
    issuer,
    resourceUrl,
    serviceDocumentationUrl,
    scopesSupported,
    exchangeSecret,
  };
}

export function createHostedTokenVerifier(
  config: HostedAuthConfig,
  apiBaseUrl: string,
): ExtrovertTokenVerifier {
  return new ExtrovertTokenVerifier({
    exchangeSecret: config.exchangeSecret,
    resourceUrl: config.resourceUrl,
    apiBaseUrl,
  });
}

export async function discoverOAuthMetadata(
  issuer: URL,
  doFetch: typeof fetch = fetch,
): Promise<OAuthMetadata> {
  const url = new URL("/.well-known/oauth-authorization-server", issuer);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);
  try {
    const response = await doFetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OAuth discovery returned HTTP ${response.status}`);
    const metadata = (await response.json()) as Record<string, unknown>;
    if (metadata.issuer !== issuer.toString().replace(/\/$/, "")) {
      throw new Error("OAuth discovery issuer does not match EXTROVERT_MCP_OAUTH_ISSUER");
    }
    for (const field of ["authorization_endpoint", "token_endpoint"]) {
      const value = metadata[field];
      if (typeof value !== "string" || new URL(value).protocol !== "https:") {
        throw new Error(`OAuth discovery is missing a secure ${field}`);
      }
    }
    return metadata as OAuthMetadata;
  } finally {
    clearTimeout(timeout);
  }
}

function requiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function invalidToken(message: string): OAuthError {
  return new OAuthError(OAuthErrorCode.InvalidToken, message);
}
