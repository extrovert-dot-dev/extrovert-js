import type { CredentialStore, OAuthCredentialInput, StoredCredential } from "./credentials.js";

export interface LocalCredentialProviderOptions {
  apiBaseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface LocalLogoutResult {
  status: "complete" | "not_connected" | "remote_unconfirmed";
  credential_removed: boolean;
  remote_revocation: "confirmed" | "unconfirmed" | "not_applicable";
}

/** Idempotent revocation only; never rotates or retries a bearer. No storage side effects. */
export async function revokeOAuthCredential(input: { issuer: string; client_id: string; refresh_token: string }, options: { fetch?: typeof fetch } = {}): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await (options.fetch ?? fetch)(`${input.issuer}/oauth/revoke`, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: input.refresh_token, client_id: input.client_id, token_type_hint: "refresh_token" }).toString(),
    });
    void response.body?.cancel().catch(() => {});
    return response.ok;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

/** Revoke only this explicitly persisted connection, without changing its independently created credentials. */
export async function logoutLocalCredential(store: CredentialStore, options: { fetch?: typeof fetch } = {}): Promise<LocalLogoutResult> {
  return store.withOAuthLock(async transaction => {
    const record = transaction.load();
    if (!record) return { status: "not_connected", credential_removed: false, remote_revocation: "not_applicable" };
    if (!record.oauth) return { status: "complete", credential_removed: transaction.clear(), remote_revocation: "not_applicable" };
    const confirmed = await revokeOAuthCredential(record.oauth, options);
    if (!confirmed) return { status: "remote_unconfirmed", credential_removed: false, remote_revocation: "unconfirmed" };
    try { return { status: "complete", credential_removed: transaction.clear(), remote_revocation: "confirmed" }; }
    catch { throw new Error("Extrovert authorization was revoked, but its local credential could not be removed. Remove it from this profile before signing in again."); }
  });
}

/** Only explicitly persisted local credentials; never imports an MCP host's OAuth cache. */
export function createLocalCredentialProvider(store: CredentialStore, options: LocalCredentialProviderOptions = {}): () => Promise<string> {
  const now = options.now ?? Date.now;
  const request = options.fetch ?? fetch;
  const read = (allowUncertain = false): StoredCredential => {
    const record = store.load();
    if (!record) throw new Error("Extrovert credentials were removed. Sign in again.");
    if (options.apiBaseUrl && options.apiBaseUrl.replace(/\/+$/, "") !== record.api_base_url) throw new Error("Stored Extrovert credential does not match the requested API. Select the correct profile.");
    if (record.oauth?.refresh_uncertain && !allowUncertain) throw new Error("The previous Extrovert OAuth refresh has an unknown outcome. Sign in again; do not retry its refresh token.");
    if (record.oauth?.grant_expires_at && Date.parse(record.oauth.grant_expires_at) <= now()) throw new Error("Extrovert authorization expired. Sign in again with explicit consent.");
    return record;
  };
  return async () => {
    const initial = read(true);
    if (!initial.oauth || (!initial.oauth.refresh_uncertain && Date.parse(initial.oauth.expires_at) > now() + 60_000)) return initial.agent_key;
    return store.withOAuthLock(async transaction => {
      const record = read();
      if (!record.oauth || Date.parse(record.oauth.expires_at) > now() + 60_000) return record.agent_key;
      const oauth = record.oauth;
      const input: OAuthCredentialInput = { access_token: record.agent_key, refresh_token: oauth.refresh_token,
        client_id: oauth.client_id, issuer: oauth.issuer, api_base_url: record.api_base_url,
        expires_at: oauth.expires_at, grant_expires_at: oauth.grant_expires_at };
      // Write before sending: timeout, crash or malformed response must never
      // cause another process to reuse a potentially consumed rotating token.
      transaction.save(input, true);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await request(`${oauth.issuer}/oauth/token`, {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: oauth.refresh_token,
            client_id: oauth.client_id, resource: record.api_base_url }).toString(),
        });
        if (!response.ok) throw new Error(response.status === 400 || response.status === 401
          ? "Extrovert authorization expired or was revoked. Sign in again."
          : "Extrovert OAuth refresh did not complete. Sign in again; its refresh token will not be retried.");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Empty OAuth response");
        let bytes = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 32_768) { await reader.cancel(); throw new Error("Oversized OAuth response"); }
          chunks.push(part.value);
        }
        const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
        if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string" || data.refresh_token === oauth.refresh_token
          || typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0
          || (data.token_type as string)?.toLowerCase() !== "bearer"
          || (data.resource !== undefined && data.resource !== record.api_base_url)) throw new Error("Invalid OAuth refresh response");
        const expiresAt = Math.min(now() + data.expires_in * 1000, oauth.grant_expires_at ? Date.parse(oauth.grant_expires_at) : Infinity);
        return transaction.save({ ...input, access_token: data.access_token, refresh_token: data.refresh_token,
          expires_at: new Date(expiresAt).toISOString() }).agent_key;
      } catch (error) {
        // Do not expose response bodies, token values, or potentially sensitive
        // transport diagnostics. API mutations are never attempted or retried here.
        if (error instanceof Error && error.message.startsWith("Extrovert authorization")) throw error;
        throw new Error("Extrovert OAuth refresh could not be confirmed. Sign in again; the previous refresh token will not be retried.");
      } finally { clearTimeout(timer); }
    });
  };
}
