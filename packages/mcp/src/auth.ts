import { createClerkClient, type AuthObject } from "@clerk/backend";
import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from "@modelcontextprotocol/server";

const DEFAULT_ISSUER = "https://clerk.extrovert.dev";
const DEFAULT_PUBLIC_URL = "https://mcp.extrovert.dev/mcp";
const DISCOVERY_TIMEOUT_MS = 10_000;
const AGENT_KEY_ATTESTATION_SECONDS = 300;

type ClerkOAuthAuth = Extract<AuthObject, { tokenType: "oauth_token"; isAuthenticated: true }>;

interface ClerkRequestState {
  isAuthenticated: boolean;
  toAuth(): unknown;
}

interface ClerkOAuthClient {
  authenticateRequest(
    request: Request,
    options: { acceptsToken: "oauth_token" },
  ): Promise<ClerkRequestState>;
}

export interface HostedAuthConfig {
  issuer: URL;
  resourceUrl: URL;
  serviceDocumentationUrl: URL;
  scopesSupported: string[];
  clerkSecretKey: string;
  clerkPublishableKey: string;
}

export interface ExtrovertTokenVerifierOptions {
  clerk: ClerkOAuthClient;
  resourceUrl: URL;
  apiBaseUrl: string;
  fetch?: typeof fetch;
}

/** Verify Clerk OAuth tokens and existing scoped Extrovert agent keys. */
export class ExtrovertTokenVerifier implements OAuthTokenVerifier {
  private readonly clerk: ClerkOAuthClient;
  private readonly resourceUrl: URL;
  private readonly apiBaseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(options: ExtrovertTokenVerifierOptions) {
    this.clerk = options.clerk;
    this.resourceUrl = options.resourceUrl;
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, "");
    this.doFetch = options.fetch ?? fetch;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (token.startsWith("pk_agent_")) return this.verifyAgentKey(token);
    if (token.startsWith("pk_enroll_")) {
      throw invalidToken("Enrollment tokens cannot authenticate the hosted MCP endpoint");
    }

    const request = new Request(this.resourceUrl, {
      headers: { authorization: `Bearer ${token}` },
    });
    let state: ClerkRequestState;
    try {
      state = await this.clerk.authenticateRequest(request, {
        acceptsToken: "oauth_token",
      });
    } catch {
      throw invalidToken("OAuth access token verification failed");
    }
    if (!state.isAuthenticated) throw invalidToken("OAuth access token is invalid or expired");
    const auth = state.toAuth();
    if (!isClerkOAuthAuth(auth)) {
      throw invalidToken("Sign-in could not be connected to Extrovert. Run the connection check in your MCP host; if it persists, contact support with the response request ID.");
    }
    const expiresAt = jwtExpiry(token);
    if (expiresAt === undefined || expiresAt <= Math.floor(Date.now() / 1000)) {
      // Production is deliberately configured for Clerk JWT access tokens. The
      // MCP bearer gate requires a concrete expiry and must not invent one.
      throw invalidToken("This sign-in has expired or has no valid expiry. Reconnect using your MCP host's sign-in command.");
    }
    return {
      token,
      clientId: auth.clientId,
      scopes: auth.scopes,
      expiresAt,
      resource: this.resourceUrl,
      extra: {
        tokenType: "oauth_token",
        userId: auth.userId,
        subject: auth.subject,
      },
    };
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
  const clerkSecretKey = (env.CLERK_SECRET_KEY ?? "").trim();
  const clerkPublishableKey = (
    env.CLERK_PUBLISHABLE_KEY ??
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ??
    ""
  ).trim();
  if (!clerkSecretKey || !clerkPublishableKey) {
    throw new Error("hosted MCP OAuth requires CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY");
  }
  if (issuer.protocol !== "https:" || resourceUrl.protocol !== "https:") {
    throw new Error("hosted MCP OAuth issuer and resource URL must use HTTPS");
  }
  const scopesSupported = (env.EXTROVERT_MCP_OAUTH_SCOPES ?? "openid profile email")
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return {
    issuer,
    resourceUrl,
    serviceDocumentationUrl,
    scopesSupported,
    clerkSecretKey,
    clerkPublishableKey,
  };
}

export function createHostedTokenVerifier(
  config: HostedAuthConfig,
  apiBaseUrl: string,
): ExtrovertTokenVerifier {
  return new ExtrovertTokenVerifier({
    clerk: createClerkClient({
      secretKey: config.clerkSecretKey,
      publishableKey: config.clerkPublishableKey,
    }),
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

function isClerkOAuthAuth(value: unknown): value is ClerkOAuthAuth {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ClerkOAuthAuth>;
  return (
    candidate.isAuthenticated === true &&
    candidate.tokenType === "oauth_token" &&
    typeof candidate.subject === "string" &&
    Array.isArray(candidate.scopes) &&
    typeof candidate.userId === "string" && candidate.userId.length > 0 &&
    typeof candidate.clientId === "string" && candidate.clientId.length > 0
  );
}

function jwtExpiry(token: string): number | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof decoded.exp === "number" && Number.isSafeInteger(decoded.exp)
      ? decoded.exp
      : undefined;
  } catch {
    return undefined;
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
