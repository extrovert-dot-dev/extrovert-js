import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const CURRENT_VERSION = 1 as const;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export interface OAuthCredentialInput {
  access_token: string;
  refresh_token: string;
  client_id: string;
  issuer: string;
  api_base_url: string;
  expires_at: string;
  grant_expires_at?: string;
}

export interface StoredOAuthMetadata {
  refresh_token: string;
  client_id: string;
  issuer: string;
  expires_at: string;
  grant_expires_at?: string;
  refresh_uncertain?: boolean;
}

export interface PendingOAuth {
  version: typeof CURRENT_VERSION;
  client_id: string;
  issuer: string;
  api_base_url: string;
  redirect_uri: string;
  manual_redirect_uri?: string;
  credential_fingerprint?: string | null;
  code_verifier: string;
  state: string;
  expires_at: string;
  saved_at: string;
}

export interface OAuthCredentialTransaction {
  load(): StoredCredential | undefined;
  save(input: OAuthCredentialInput, uncertain?: boolean): StoredCredential;
  clear(): boolean;
}

export interface StoredCredential {
  version: typeof CURRENT_VERSION;
  agent_key: string;
  api_base_url: string;
  saved_at: string;
  oauth?: StoredOAuthMetadata;
}

export interface PendingSignup {
  activation_method?: "incoming_email";
  version: typeof CURRENT_VERSION;
  agent_key: string;
  human_email: string;
  address: string;
  otp_expires_at: string;
  api_base_url: string;
  saved_at: string;
}

export interface CredentialPaths {
  directory: string;
  credential: string;
  pendingSignup: string;
}

export interface CredentialStore {
  readonly paths: CredentialPaths;
  load(): StoredCredential | undefined;
  save(agentKey: string, apiBaseUrl: string): StoredCredential;
  clear(): boolean;
  loadPendingSignup(): PendingSignup | undefined;
  savePendingSignup(input: Omit<PendingSignup, "version" | "saved_at">): PendingSignup;
  clearPendingSignup(): boolean;
  saveOAuth(input: OAuthCredentialInput, options?: { expectedFingerprint?: string | null; signal?: AbortSignal }): Promise<StoredCredential>;
  withOAuthLock<T>(operation: (transaction: OAuthCredentialTransaction) => Promise<T>): Promise<T>;
  loadPendingOAuth(): PendingOAuth | undefined;
  savePendingOAuth(input: Omit<PendingOAuth, "version" | "saved_at">): PendingOAuth;
  clearPendingOAuth(): boolean;
  takePendingOAuth(expectedState: string): PendingOAuth | undefined;
}

/**
 * Resolve the local Extrovert state directory without creating it.
 *
 * EXTROVERT_CONFIG_DIR is intentionally supported for isolated tests and managed
 * hosts. On Unix we follow XDG; Windows uses APPDATA. No credential path is ever
 * accepted from a tool argument, so message content cannot redirect key writes.
 */
export function credentialPaths(env: NodeJS.ProcessEnv = process.env): CredentialPaths {
  const explicit = env.EXTROVERT_CONFIG_DIR?.trim();
  let directory: string;
  if (explicit) {
    directory = resolve(explicit);
  } else if (env.HERMES_HOME?.trim()) {
    directory = join(resolve(env.HERMES_HOME.trim()), "extrovert");
  } else if (process.platform === "win32") {
    const appData = env.APPDATA?.trim();
    directory = join(appData ? resolve(appData) : join(homedir(), "AppData", "Roaming"), "Extrovert");
  } else {
    const xdg = env.XDG_CONFIG_HOME?.trim();
    directory = join(xdg ? resolve(xdg) : join(homedir(), ".config"), "extrovert");
  }
  if (!explicit && env.EXTROVERT_PROFILE?.trim()) {
    const profile = env.EXTROVERT_PROFILE.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profile)) throw new Error("EXTROVERT_PROFILE must contain 1–64 letters, numbers, underscores or hyphens");
    directory = join(directory, "profiles", profile);
  }
  return {
    directory,
    credential: join(directory, "credentials.json"),
    pendingSignup: join(directory, "pending-signup.json"),
  };
}

export function createCredentialStore(env: NodeJS.ProcessEnv = process.env): CredentialStore {
  const paths = credentialPaths(env);
  const pendingOAuthPath = join(paths.directory, "pending-oauth.json");
  const loadPendingOAuth = (): PendingOAuth | undefined => {
    const value = readPrivateJson(pendingOAuthPath);
    if (value === undefined) return undefined;
    const record = asRecord(value);
    if (record.version !== CURRENT_VERSION) throw invalidFile(pendingOAuthPath, "unsupported pending OAuth version");
    const fields = ["client_id", "issuer", "api_base_url", "redirect_uri", "code_verifier", "state", "expires_at", "saved_at"] as const;
    const out = Object.fromEntries(fields.map(field => [field, requiredRecordString(record, field, pendingOAuthPath)]));
    return { version: CURRENT_VERSION, ...out,
      ...(record.credential_fingerprint === null ? { credential_fingerprint: null } : typeof record.credential_fingerprint === "string" ? { credential_fingerprint: record.credential_fingerprint } : {}),
      ...(record.manual_redirect_uri ? { manual_redirect_uri: requiredRecordString(record, "manual_redirect_uri", pendingOAuthPath) } : {}) } as unknown as PendingOAuth;
  };
  const transaction: OAuthCredentialTransaction = {
    load: () => readCredential(paths.credential),
    clear: () => removeIfPresent(paths.credential),
    save: (input, uncertain) => {
      const record = oauthRecord(input, uncertain);
      writePrivateJson(paths.credential, record);
      return record;
    },
  };
  return {
    paths,
    load: () => readCredential(paths.credential),
    save: (agentKey, apiBaseUrl) => withPendingLock(paths.credential, () => {
      assertStoredCredential(agentKey);
      const record: StoredCredential = {
        version: CURRENT_VERSION,
        agent_key: agentKey.trim(),
        api_base_url: normalizeBaseUrl(apiBaseUrl),
        saved_at: new Date().toISOString(),
      };
      writePrivateJson(paths.credential, record);
      return record;
    }),
    clear: () => withPendingLock(paths.credential, () => removeIfPresent(paths.credential)),
    saveOAuth: (input, options) => withOAuthLock(paths, () => {
      options?.signal?.throwIfAborted();
      if (options?.expectedFingerprint !== undefined && credentialFingerprint(transaction.load()) !== options.expectedFingerprint) throw new Error("This Extrovert profile changed while login was pending. Its current credentials were preserved. Start a new login.");
      return Promise.resolve(transaction.save(input));
    }),
    withOAuthLock: operation => withOAuthLock(paths, () => operation(transaction)),
    loadPendingOAuth,
    savePendingOAuth: input => withPendingLock(pendingOAuthPath, () => {
      const existing = loadPendingOAuth();
      if (existing && Date.parse(existing.expires_at) > Date.now()) throw new Error("Extrovert login is already pending. Complete or explicitly cancel it before starting another login.");
      if (!Number.isFinite(Date.parse(input.expires_at))) throw new Error("Invalid Extrovert pending OAuth expiry.");
      const record: PendingOAuth = { ...input, version: CURRENT_VERSION, saved_at: new Date().toISOString() };
      for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== null) requiredString(value, key);
      writePrivateJson(pendingOAuthPath, record);
      return record;
    }),
    clearPendingOAuth: () => withPendingLock(pendingOAuthPath, () => removeIfPresent(pendingOAuthPath)),
    takePendingOAuth: expectedState => withPendingLock(pendingOAuthPath, () => {
      const pending = loadPendingOAuth();
      if (!pending) return undefined;
      if (pending.state !== expectedState) throw new Error("Extrovert authorization state does not match the pending login.");
      removeIfPresent(pendingOAuthPath);
      return pending;
    }),
    loadPendingSignup: () => readPendingSignup(paths.pendingSignup),
    savePendingSignup: (input) => {
      assertAgentKey(input.agent_key);
      const record: PendingSignup = {
        version: CURRENT_VERSION,
        agent_key: input.agent_key.trim(),
        human_email: requiredString(input.human_email, "human email"),
        address: requiredString(input.address, "signup inbox"),
        otp_expires_at: requiredString(input.otp_expires_at, "OTP expiry"),
        activation_method: input.activation_method,
        api_base_url: normalizeBaseUrl(input.api_base_url),
        saved_at: new Date().toISOString(),
      };
      writePrivateJson(paths.pendingSignup, record);
      return record;
    },
    clearPendingSignup: () => removeIfPresent(paths.pendingSignup),
  };
}

/** A local compare-and-swap identity; never exposes token values in login state. */
export function credentialFingerprint(record: StoredCredential | undefined): string | null {
  return record ? createHash("sha256").update(JSON.stringify(record)).digest("hex") : null;
}

function readCredential(path: string): StoredCredential | undefined {
  const value = readPrivateJson(path);
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (record.version !== CURRENT_VERSION) throw invalidFile(path, "unsupported credential version");
  const agentKey = requiredRecordString(record, "agent_key", path);
  if (record.oauth !== undefined) {
    const oauth = asRecord(record.oauth);
    return oauthRecord({
      access_token: agentKey,
      refresh_token: requiredRecordString(oauth, "refresh_token", path),
      client_id: requiredRecordString(oauth, "client_id", path),
      issuer: requiredRecordString(oauth, "issuer", path),
      api_base_url: requiredRecordString(record, "api_base_url", path),
      expires_at: requiredRecordString(oauth, "expires_at", path),
      ...(oauth.grant_expires_at ? { grant_expires_at: requiredRecordString(oauth, "grant_expires_at", path) } : {}),
    }, oauth.refresh_uncertain === true, requiredRecordString(record, "saved_at", path));
  }
  assertStoredCredential(agentKey, path);
  return {
    version: CURRENT_VERSION,
    agent_key: agentKey,
    api_base_url: normalizeBaseUrl(requiredRecordString(record, "api_base_url", path)),
    saved_at: requiredRecordString(record, "saved_at", path),
  };
}

function oauthRecord(input: OAuthCredentialInput, uncertain = false, savedAt = new Date().toISOString()): StoredCredential {
  if (!input.access_token.startsWith("ev_access_") || !input.refresh_token.startsWith("ev_refresh_")) throw new Error("Extrovert OAuth credentials require access and refresh tokens from an explicit authorization.");
  for (const value of [input.expires_at, ...(input.grant_expires_at !== undefined ? [input.grant_expires_at] : [])]) if (!Number.isFinite(Date.parse(value))) throw new Error("Invalid Extrovert OAuth expiry.");
  const issuer = normalizeBaseUrl(input.issuer);
  const apiBase = normalizeBaseUrl(input.api_base_url);
  const parsed = new URL(issuer);
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname))) throw new Error("Extrovert OAuth requires HTTPS (or loopback HTTP for local development).");
  if (issuer !== apiBase) throw new Error("Extrovert OAuth issuer must match the authorized API resource.");
  return { version: CURRENT_VERSION, agent_key: input.access_token, api_base_url: apiBase, saved_at: savedAt,
    oauth: { refresh_token: input.refresh_token, client_id: requiredString(input.client_id, "OAuth client ID"), issuer,
      expires_at: input.expires_at, ...(input.grant_expires_at ? { grant_expires_at: input.grant_expires_at } : {}), ...(uncertain ? { refresh_uncertain: true } : {}) } };
}

function withPendingLock<T>(file: string, operation: () => T): T {
  mkdirSync(dirname(file), { recursive: true, mode: DIRECTORY_MODE });
  setMode(dirname(file), DIRECTORY_MODE);
  const lock = `${file}.lock`;
  try { mkdirSync(lock, { mode: DIRECTORY_MODE }); }
  catch { throw new Error("Extrovert credential state is busy; another process may be updating it."); }
  try { return operation(); } finally { rmSync(lock, { recursive: true, force: true }); }
}

async function withOAuthLock<T>(paths: CredentialPaths, operation: () => Promise<T>): Promise<T> {
  mkdirSync(paths.directory, { recursive: true, mode: DIRECTORY_MODE });
  setMode(paths.directory, DIRECTORY_MODE);
  const lock = `${paths.credential}.lock`;
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      mkdirSync(lock, { mode: DIRECTORY_MODE });
      writePrivateJson(join(lock, "owner.json"), { pid: process.pid });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Never steal a stale-looking lock: two processes stealing it can remove
      // each other's new lock and reuse a rotating token. Crash recovery is an
      // explicit local action after all profile users are stopped.
      if (Date.now() >= deadline) throw new Error("Extrovert credential is busy. If its process crashed, stop all processes using this profile, remove credentials.json.lock in this profile, then sign in again.");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  try { return await operation(); } finally { rmSync(lock, { recursive: true, force: true }); }
}

function readPendingSignup(path: string): PendingSignup | undefined {
  const value = readPrivateJson(path);
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (record.version !== CURRENT_VERSION) throw invalidFile(path, "unsupported pending-signup version");
  const agentKey = requiredRecordString(record, "agent_key", path);
  assertAgentKey(agentKey, path);
  return {
    version: CURRENT_VERSION,
    agent_key: agentKey,
    human_email: requiredRecordString(record, "human_email", path),
    address: requiredRecordString(record, "address", path),
    otp_expires_at: requiredRecordString(record, "otp_expires_at", path),
    activation_method: record.activation_method === "incoming_email" ? "incoming_email" : undefined,
    api_base_url: normalizeBaseUrl(requiredRecordString(record, "api_base_url", path)),
    saved_at: requiredRecordString(record, "saved_at", path),
  };
}

function readPrivateJson(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  assertPrivateFile(path);
  let source: string;
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    throw invalidFile(path, error instanceof Error ? error.message : String(error));
  }
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw invalidFile(path, "invalid JSON");
  }
}

function writePrivateJson(path: string, value: unknown): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE });
  setMode(directory, DIRECTORY_MODE);

  const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", FILE_MODE);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    closeSync(descriptor);
    descriptor = undefined;
    setMode(temporary, FILE_MODE);
    renameSync(temporary, path);
    setMode(path, FILE_MODE);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw new Error(`Could not save Extrovert credentials at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertPrivateFile(path: string): void {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink()) {
    throw new Error(`Extrovert credential file ${path} must not be a symbolic link.`);
  }
  if (!entry.isFile()) throw new Error(`Extrovert credential file ${path} must be a regular file.`);
  if (process.platform === "win32") return;
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`Extrovert credential file ${path} is accessible by other users (mode ${mode.toString(8)}); run chmod 600 on it.`);
  }
  const directoryMode = statSync(dirname(path)).mode & 0o777;
  if ((directoryMode & 0o022) !== 0) {
    throw new Error(`Extrovert credential directory ${dirname(path)} is writable by other users; run chmod 700 on it.`);
  }
}

function setMode(path: string, mode: number): void {
  if (process.platform !== "win32") chmodSync(path, mode);
}

function removeIfPresent(path: string): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { force: true });
  return true;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = requiredString(value, "API base URL").replace(/\/+$/, "");
  const parsed = new URL(trimmed);
  if (!new Set(["https:", "http:"]).has(parsed.protocol)) {
    throw new Error("Extrovert API base URL must use http or https");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function requiredString(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Extrovert ${label} cannot be empty`);
  return trimmed;
}

function assertAgentKey(value: string, path?: string): void {
  if (!value.trim().startsWith("pk_agent_")) {
    const suffix = path ? ` in ${path}` : "";
    throw new Error(`Extrovert credential${suffix} is not a scoped agent key`);
  }
}

export function isPersistentAPICredential(value: string): boolean {
  return value.trim().startsWith("pk_agent_") || value.trim().startsWith("ev_credential_");
}

function assertStoredCredential(value: string, path?: string): void {
  if (!isPersistentAPICredential(value)) throw new Error(`Extrovert credential${path ? ` in ${path}` : ""} must be a scoped agent key or independent connection credential`);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function requiredRecordString(record: Record<string, unknown>, field: string, path: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) throw invalidFile(path, `missing ${field}`);
  return value.trim();
}

function invalidFile(path: string, reason: string): Error {
  return new Error(`Invalid Extrovert credential file ${path}: ${reason}`);
}
