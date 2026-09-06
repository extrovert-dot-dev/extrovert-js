import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { revokeOAuthCredential } from "./local-oauth.js";

export const LOGIN_COMPLETION_PREFIX = "extrovert-login:v1:";
export const HOSTED_LOGIN_CALLBACK = "https://app.extrovert.dev/connect/complete";
export const LOGIN_LIFETIME_MS = 10 * 60_000;

export interface OAuthLoginRequest {
  client_id: string;
  issuer: string;
  api_base_url: string;
  redirect_uri: string;
  manual_redirect_uri?: string;
  code_verifier: string;
  state: string;
  expires_at: string;
}

export interface OAuthLoginTokens {
  access_token: string;
  refresh_token: string;
  client_id: string;
  issuer: string;
  api_base_url: string;
  expires_at: string;
}

export class OAuthLoginError extends Error {
  constructor(public readonly status: "denied" | "expired" | "cancelled" | "invalid_response" | "unavailable", message: string) {
    super(message);
    this.name = "OAuthLoginError";
  }
}

/** Endpoint overrides are operator configuration; redirects never select an issuer. */
export function loginIssuer(value = "https://api.extrovert.dev"): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new OAuthLoginError("invalid_response", "Login requires a valid API origin."); }
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new OAuthLoginError("invalid_response", "Login requires an HTTPS API origin (or a local development loopback origin).");
  }
  return url.origin;
}

function validateRedirect(value: string): void {
  if (value === HOSTED_LOGIN_CALLBACK) return;
  let url: URL;
  try { url = new URL(value); } catch { throw new OAuthLoginError("invalid_response", "Invalid login callback."); }
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname) || !url.port || url.pathname !== "/callback" || url.username || url.password || url.search || url.hash) {
    throw new OAuthLoginError("invalid_response", "Login callbacks must use the Extrovert completion page or the local loopback listener.");
  }
}

async function jsonRequest(url: string, init: RequestInit, fetcher: typeof fetch): Promise<Record<string, unknown>> {
  let response: Response;
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
  try {
    signal.throwIfAborted();
    response = await fetcher(url, { ...init, redirect: "error", signal });
  } catch {
    if (init.signal?.aborted) throw new OAuthLoginError("cancelled", "Login cancelled. A code exchange that may have started must not be retried.");
    throw new OAuthLoginError("unavailable", "The login service did not return a response. Do not retry an uncertain code exchange; start a new login.");
  }
  const reader = response.body?.getReader();
  let bytes = 0;
  const chunks: Buffer[] = [];
  if (reader) {
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 65_536) { await reader.cancel(); throw new Error("response limit"); }
        chunks.push(Buffer.from(part.value));
      }
    } catch {
      if (init.signal?.aborted) throw new OAuthLoginError("cancelled", "Login cancelled. A code exchange that may have started must not be retried.");
      throw new OAuthLoginError("unavailable", "The login service returned an incomplete or oversized response. Start a new login.");
    } finally { reader.releaseLock(); }
  }
  if (init.signal?.aborted) throw new OAuthLoginError("cancelled", "Login cancelled. A code exchange that may have started must not be retried.");
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {
    throw new OAuthLoginError("invalid_response", "The login service returned an invalid response.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OAuthLoginError("invalid_response", "The login service returned an invalid response.");
  const result = value as Record<string, unknown>;
  if (!response.ok) {
    if (result.error === "access_denied") throw new OAuthLoginError("denied", "Access was denied. Your existing profile was preserved.");
    if (result.error === "invalid_grant") throw new OAuthLoginError("expired", "This login code expired or was already used. Start a new login.");
    throw new OAuthLoginError("unavailable", `The login service could not complete this request (HTTP ${response.status}). Your existing profile was preserved.`);
  }
  return result;
}

export async function beginOAuthLogin(options: { issuer?: string; redirectUri: string; manualRedirectUri?: string; fetch?: typeof fetch; now?: number; signal?: AbortSignal }): Promise<{ request: OAuthLoginRequest; authorizationUrl: string; manualAuthorizationUrl: string }> {
  const issuer = loginIssuer(options.issuer);
  validateRedirect(options.redirectUri);
  if (options.manualRedirectUri !== undefined && options.manualRedirectUri !== HOSTED_LOGIN_CALLBACK) throw new OAuthLoginError("invalid_response", "Manual login must return to the Extrovert completion page.");
  const fetcher = options.fetch ?? fetch;
  const metadata = await jsonRequest(`${issuer}/.well-known/oauth-authorization-server`, { signal: options.signal }, fetcher);
  if (metadata.issuer !== issuer || metadata.authorization_endpoint !== `${issuer}/oauth/authorize` || metadata.token_endpoint !== `${issuer}/oauth/token` || metadata.registration_endpoint !== `${issuer}/oauth/register`) {
    throw new OAuthLoginError("invalid_response", "The login service identity or endpoints do not match the configured API.");
  }
  const registration = await jsonRequest(`${issuer}/oauth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" }, signal: options.signal,
    body: JSON.stringify({ client_name: "Extrovert CLI", redirect_uris: [...new Set([options.redirectUri, options.manualRedirectUri ?? options.redirectUri])], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
  }, fetcher);
  if (typeof registration.client_id !== "string" || !/^ev_client_[A-Za-z0-9_-]{8,128}$/.test(registration.client_id)) throw new OAuthLoginError("invalid_response", "The login service returned an invalid client registration.");
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const request: OAuthLoginRequest = { client_id: registration.client_id, issuer, api_base_url: issuer, redirect_uri: options.redirectUri, manual_redirect_uri: options.manualRedirectUri, code_verifier: verifier, state, expires_at: new Date((options.now ?? Date.now()) + LOGIN_LIFETIME_MS).toISOString() };
  return { request, authorizationUrl: loginAuthorizationUrl(request), manualAuthorizationUrl: loginAuthorizationUrl(request, true) };
}

export function loginAuthorizationUrl(request: OAuthLoginRequest, manual = false): string {
  const redirect = manual ? request.manual_redirect_uri ?? request.redirect_uri : request.redirect_uri;
  validateRedirect(redirect);
  if (request.api_base_url !== loginIssuer(request.issuer)) throw new OAuthLoginError("invalid_response", "The login resource does not match its issuer.");
  const url = new URL(`${loginIssuer(request.issuer)}/oauth/authorize`);
  url.search = new URLSearchParams({ response_type: "code", client_id: request.client_id, redirect_uri: redirect, resource: request.api_base_url, scope: "extrovert:connect", state: request.state, code_challenge: createHash("sha256").update(request.code_verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
  return url.toString();
}

function equal(a: string, b: string): boolean {
  const first = Buffer.from(a); const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

export function validateLoginResponse(value: unknown, request: OAuthLoginRequest, now = Date.now()): string {
  if (Date.parse(request.expires_at) <= now || !Number.isFinite(Date.parse(request.expires_at))) throw new OAuthLoginError("expired", "This login request expired. Start a new login.");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OAuthLoginError("invalid_response", "That is not a valid login completion code.");
  const response = value as Record<string, unknown>;
  if (typeof response.state !== "string" || !equal(response.state, request.state) || response.iss !== request.issuer) throw new OAuthLoginError("invalid_response", "The completion code belongs to a different login. Use the code from this request's Extrovert page.");
  if (Object.keys(response).some(key => !["code", "state", "iss", "error"].includes(key)) || (response.code !== undefined && response.error !== undefined)) throw new OAuthLoginError("invalid_response", "That is not a valid login completion code.");
  if (response.error === "access_denied") throw new OAuthLoginError("denied", "Access was denied. Your existing profile was preserved.");
  if (response.error !== undefined) throw new OAuthLoginError("invalid_response", "Browser sign-in could not complete. Start a new login.");
  if (typeof response.code !== "string" || !/^ev_code_[A-Za-z0-9_-]{8,256}$/.test(response.code)) throw new OAuthLoginError("invalid_response", "That is not a valid login completion code.");
  return response.code;
}

export function parseCompletionCode(text: string, request: OAuthLoginRequest, now = Date.now()): string {
  const value = text.trim();
  if (value.length > 4096 || !value.startsWith(LOGIN_COMPLETION_PREFIX) || !/^[A-Za-z0-9_-]+$/.test(value.slice(LOGIN_COMPLETION_PREFIX.length))) throw new OAuthLoginError("invalid_response", "Paste the completion code shown on the Extrovert page, not a URL or an API key.");
  let response: unknown;
  try { response = JSON.parse(Buffer.from(value.slice(LOGIN_COMPLETION_PREFIX.length), "base64url").toString("utf8")); } catch {
    throw new OAuthLoginError("invalid_response", "That is not a valid login completion code.");
  }
  return validateLoginResponse(response, request, now);
}

export async function exchangeLoginCode(request: OAuthLoginRequest, code: string, options: { fetch?: typeof fetch; now?: number; signal?: AbortSignal } = {}): Promise<OAuthLoginTokens> {
  validateRedirect(request.redirect_uri);
  if (request.api_base_url !== loginIssuer(request.issuer)) throw new OAuthLoginError("invalid_response", "The login resource does not match its issuer.");
  validateLoginResponse({ code, state: request.state, iss: request.issuer }, request, options.now);
  const requestedAt = options.now ?? Date.now();
  const result = await jsonRequest(`${loginIssuer(request.issuer)}/oauth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: options.signal,
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: request.client_id, redirect_uri: request.redirect_uri, code, code_verifier: request.code_verifier, resource: request.api_base_url }).toString(),
  }, options.fetch ?? fetch);
  if (typeof result.access_token !== "string" || !/^ev_access_[A-Za-z0-9_-]{8,256}$/.test(result.access_token) || typeof result.refresh_token !== "string" || !/^ev_refresh_[A-Za-z0-9_-]{8,256}$/.test(result.refresh_token) || typeof result.token_type !== "string" || result.token_type.toLowerCase() !== "bearer" || typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 0 || result.expires_in > 86400 || (result.client_id !== undefined && result.client_id !== request.client_id) || (result.resource !== undefined && result.resource !== request.api_base_url)) {
    throw new OAuthLoginError("invalid_response", "The login service returned invalid credentials. Start a new login.");
  }
  return { access_token: result.access_token, refresh_token: result.refresh_token, client_id: request.client_id, issuer: request.issuer, api_base_url: request.api_base_url, expires_at: new Date(requestedAt + result.expires_in * 1000).toISOString() };
}

/** Cleanup known issued credentials after a later verification/save/cancel failure. */
export async function revokeLoginTokens(tokens: OAuthLoginTokens, options: { fetch?: typeof fetch } = {}): Promise<boolean> {
  try {
    if (tokens.api_base_url !== loginIssuer(tokens.issuer)) return false;
    return await revokeOAuthCredential(tokens, options);
  } catch { return false; }
}

export interface LoopbackLogin {
  redirectUri: string;
  wait(request: OAuthLoginRequest, signal?: AbortSignal): Promise<string>;
  close(): Promise<void>;
}

export async function createLoopbackLogin(): Promise<LoopbackLogin> {
  let active: { request: OAuthLoginRequest; resolve: (code: string) => void; reject: (error: Error) => void } | undefined;
  const server: Server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if ((req.url?.length ?? 0) > 4096) { res.writeHead(414); res.end("Login response too large."); return; }
    let url: URL;
    try { url = new URL(req.url ?? "/", "http://127.0.0.1"); }
    catch { res.writeHead(400); res.end("Invalid login response."); return; }
    if (req.method !== "GET" || url.pathname !== "/callback" || !active) { res.writeHead(404); res.end("Login request not found."); return; }
    let code: string;
    try {
      if ([...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) throw new Error("duplicate");
      code = validateLoginResponse(Object.fromEntries(url.searchParams), active.request);
    } catch (error) {
      if (error instanceof OAuthLoginError && error.status === "denied") {
        const current = active; active = undefined;
        res.writeHead(200); res.end("<!doctype html><title>Extrovert — access declined</title><h1>Access declined</h1><p>Your existing connection is unchanged. You can return to the terminal.</p>", () => current.reject(error));
      } else { res.writeHead(400); res.end("This response does not match the waiting login. Return to the original sign-in page."); }
      return;
    }
    const current = active; active = undefined;
    res.writeHead(200); res.end("<!doctype html><title>Extrovert — return to terminal</title><h1>Sign-in received</h1><p>Return to your terminal to confirm the connection.</p>", () => current.resolve(code));
  });
  server.requestTimeout = 5_000; server.headersTimeout = 5_000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
  return {
    redirectUri,
    wait(request, signal) {
      if (active) return Promise.reject(new OAuthLoginError("invalid_response", "This listener already has a pending login."));
      return new Promise<string>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
        const abort = () => { active = undefined; cleanup(); reject(new OAuthLoginError("cancelled", "Login cancelled. Your existing profile was preserved.")); };
        const timer = setTimeout(() => { active = undefined; cleanup(); reject(new OAuthLoginError("expired", "Login timed out. Start a new login.")); }, Math.max(1, Date.parse(request.expires_at) - Date.now()));
        active = { request, resolve: code => { cleanup(); resolve(code); }, reject: error => { cleanup(); reject(error); } };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
    },
    async close() { active?.reject(new OAuthLoginError("cancelled", "Login cancelled.")); active = undefined; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

export function preferHeadlessLogin(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  return !isTTY || Boolean(env.SSH_CONNECTION || env.SSH_TTY || env.CI || (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY));
}

export async function openLoginBrowser(url: string): Promise<boolean> {
  const [command, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  return new Promise(resolve => {
    const child = spawn(command as string, args as string[], { stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 5_000);
    child.once("error", () => { clearTimeout(timer); resolve(false); });
    child.once("exit", code => { clearTimeout(timer); resolve(code === 0); });
  });
}
