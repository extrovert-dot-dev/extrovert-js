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

const CURRENT_VERSION = 1 as const;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export interface StoredCredential {
  version: typeof CURRENT_VERSION;
  agent_key: string;
  api_base_url: string;
  saved_at: string;
}

export interface PendingSignup {
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
  return {
    paths,
    load: () => readCredential(paths.credential),
    save: (agentKey, apiBaseUrl) => {
      assertAgentKey(agentKey);
      const record: StoredCredential = {
        version: CURRENT_VERSION,
        agent_key: agentKey.trim(),
        api_base_url: normalizeBaseUrl(apiBaseUrl),
        saved_at: new Date().toISOString(),
      };
      writePrivateJson(paths.credential, record);
      return record;
    },
    clear: () => removeIfPresent(paths.credential),
    loadPendingSignup: () => readPendingSignup(paths.pendingSignup),
    savePendingSignup: (input) => {
      assertAgentKey(input.agent_key);
      const record: PendingSignup = {
        version: CURRENT_VERSION,
        agent_key: input.agent_key.trim(),
        human_email: requiredString(input.human_email, "human email"),
        address: requiredString(input.address, "signup inbox"),
        otp_expires_at: requiredString(input.otp_expires_at, "OTP expiry"),
        api_base_url: normalizeBaseUrl(input.api_base_url),
        saved_at: new Date().toISOString(),
      };
      writePrivateJson(paths.pendingSignup, record);
      return record;
    },
    clearPendingSignup: () => removeIfPresent(paths.pendingSignup),
  };
}

function readCredential(path: string): StoredCredential | undefined {
  const value = readPrivateJson(path);
  if (value === undefined) return undefined;
  const record = asRecord(value);
  if (record.version !== CURRENT_VERSION) throw invalidFile(path, "unsupported credential version");
  const agentKey = requiredRecordString(record, "agent_key", path);
  assertAgentKey(agentKey, path);
  return {
    version: CURRENT_VERSION,
    agent_key: agentKey,
    api_base_url: normalizeBaseUrl(requiredRecordString(record, "api_base_url", path)),
    saved_at: requiredRecordString(record, "saved_at", path),
  };
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
  if (process.platform === "win32") return;
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error(`Extrovert credential file ${path} must not be a symbolic link.`);
  }
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
