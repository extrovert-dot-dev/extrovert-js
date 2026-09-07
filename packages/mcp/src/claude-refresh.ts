import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isScalar, parseDocument } from "yaml";

const PACKAGE = "@extrovert.dev/mcp@next";
const LIMIT = 1024 * 1024;
type RecordValue = Record<string, unknown>;
export interface ClaudeRefreshResult {
  status: "restart_required" | "manual_required";
  host: "claude";
  runtime_verified: false;
  configuration_changed: boolean;
  reason?: string;
  scope?: "local" | "user";
  backup?: string;
  cleanup_required?: boolean;
  next_action: string;
}

class Refusal extends Error {}
function refuse(reason: string): never { throw new Refusal(reason); }
function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}
function hasEntry(value: unknown): boolean { return Object.hasOwn(record(value) ?? {}, "extrovert"); }

function readConfig(path: string): string | undefined {
  let fd: number;
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) refuse("unsupported_configuration_file");
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || (process.getuid && info.uid !== process.getuid())) refuse("unsupported_configuration_file");
    if (info.size > LIMIT) refuse("configuration_too_large");
    // Reading from the descriptor avoids following a replacement symlink.
    const bytes = Buffer.alloc(LIMIT + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > LIMIT) refuse("configuration_too_large");
    const source = bytes.subarray(0, length);
    const decoded = source.toString("utf8");
    if (!Buffer.from(decoded).equals(source)) refuse("invalid_configuration");
    return decoded;
  } finally { closeSync(fd); }
}

function parseConfig(source: string): { value: RecordValue; document: ReturnType<typeof parseDocument> } {
  let value: unknown;
  try { value = JSON.parse(source); } catch { return refuse("invalid_configuration"); }
  const document = parseDocument(source, { uniqueKeys: true });
  if (!record(value) || document.errors.length) refuse("invalid_configuration");
  return { value: value as RecordValue, document };
}

/** Only local/user files are writable. Claude 2.1.263 shares a mkdir lock for
 * .claude.json, but not project .mcp.json. Never remove an existing lock or infer
 * successful runtime activation from a saved entry. */
export function refreshClaude(env: NodeJS.ProcessEnv, cwd = process.cwd(), beforeCommit?: () => void): ClaudeRefreshResult {
  const base = { host: "claude" as const, runtime_verified: false as const, configuration_changed: false };
  try {
    if (process.platform === "win32") refuse("unsupported_platform");
    const home = env.HOME || homedir();
    const configRoot = env.CLAUDE_CONFIG_DIR;
    if (configRoot !== undefined && (!configRoot || !isAbsolute(configRoot))) refuse("ambiguous_configuration_directory");
    const path = configRoot ? join(configRoot, ".claude.json") : join(home, ".claude.json");
    if (existsSync(dirname(path)) && realpathSync(dirname(path)) !== resolve(dirname(path))) refuse("symbolic_configuration_directory");
    if (["/etc/claude-code/managed-mcp.json", "/Library/Application Support/ClaudeCode/managed-mcp.json"].some(existsSync)) refuse("managed_configuration");
    const project = realpathSync(cwd);
    if (project !== resolve(cwd)) refuse("ambiguous_project_directory");
    const git = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: project, env, encoding: "utf8", timeout: 2000, maxBuffer: 4096 });
    if (git.error || (git.status === 0 && realpathSync(git.stdout.trim()) !== project)) refuse("ambiguous_project_directory");
    const projectSource = readConfig(join(project, ".mcp.json"));
    const projectEntry = projectSource !== undefined && hasEntry(parseConfig(projectSource).value.mcpServers);
    const original = readConfig(path);
    if (original === undefined) refuse(projectEntry ? "project_scope_requires_manual_update" : "entry_not_found");
    const parsed = parseConfig(original);
    const localPath = ["projects", project, "mcpServers", "extrovert"];
    const localServers = record(record(parsed.value.projects)?.[project])?.mcpServers;
    const local = hasEntry(localServers);
    const user = hasEntry(parsed.value.mcpServers);
    if (Number(local) + Number(user) + Number(projectEntry) > 1) refuse("ambiguous_scope");
    if (projectEntry) refuse("project_scope_requires_manual_update");
    if (!local && !user) refuse("entry_not_found");
    const scope = local ? "local" as const : "user" as const;
    const entryPath = local ? localPath : ["mcpServers", "extrovert"];
    const entry = record(record(local ? localServers : parsed.value.mcpServers)?.extrovert);
    if (!entry || (entry.type !== undefined && entry.type !== "stdio") || entry.command !== "npx" || !Array.isArray(entry.args)) refuse("unsupported_launch");
    const args = entry.args;
    if (args.length > 256 || !args.every(arg => typeof arg === "string")) refuse("unsupported_launch");
    const index = args.findIndex(arg => !["-y", "--yes", "--prefer-online"].includes(arg));
    if (index < 0 || !["@extrovert.dev/mcp", "@extrovert.dev/mcp@latest", PACKAGE].includes(args[index]!)) refuse("pinned_or_unsupported_package");
    const selector = parsed.document.getIn([...entryPath, "args", index], true);
    if (!isScalar(selector) || !selector.range) refuse("invalid_configuration");
    const [start, end] = selector.range;
    if (JSON.parse(original.slice(start, end)) !== args[index]) refuse("invalid_configuration");
    const preferOnline = args.slice(0, index).includes("--prefer-online");
    const replacement = `${preferOnline ? "" : '"--prefer-online", '}${JSON.stringify(PACKAGE)}`;
    const updated = original.slice(0, start) + replacement + original.slice(end);
    const result = { ...base, status: "restart_required" as const, scope, next_action: "reload_extrovert_mcp_then_verify" };
    if (preferOnline && args[index] === PACKAGE) return result;

    const lock = `${path}.lock`;
    try { mkdirSync(lock, { mode: 0o700 }); } catch { return refuse("configuration_busy"); }
    const lockIdentity = lstatSync(lock);
    const temporary = `${path}.extrovert-${randomUUID()}.tmp`;
    let backup: string | undefined;
    let completed: ClaudeRefreshResult | undefined;
    try {
      const started = Date.now();
      const fileIdentity = lstatSync(path);
      if ((process.getuid && fileIdentity.uid !== process.getuid()) || !(fileIdentity.mode & 0o200)) refuse("configuration_not_owned_or_writable");
      if (readConfig(path) !== original || readConfig(join(project, ".mcp.json")) !== projectSource) refuse("configuration_changed");
      const fd = openSync(temporary, "wx", 0o600);
      try { writeFileSync(fd, updated, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
      beforeCommit?.();
      const currentLock = lstatSync(lock);
      // Bound the transaction and refuse observed changes while preparing it.
      if (Date.now() - started > 1000 || currentLock.ino !== lockIdentity.ino || currentLock.dev !== lockIdentity.dev || readConfig(path) !== original || readConfig(join(project, ".mcp.json")) !== projectSource) refuse("configuration_changed");
      backup = `${path}.before-extrovert-${randomUUID()}`;
      writeFileSync(backup, original, { flag: "wx", mode: 0o600 });
      if (readConfig(path) !== original) refuse("configuration_changed");
      renameSync(temporary, path);
      completed = { ...result, configuration_changed: true, backup };
      return completed;
    } finally {
      try {
        if (existsSync(temporary)) unlinkSync(temporary);
        // A replaced lock belongs to another writer, even on a failure path.
        if (existsSync(lock)) {
          const current = lstatSync(lock);
          if (current.ino === lockIdentity.ino && current.dev === lockIdentity.dev) rmdirSync(lock);
        }
      } catch (error) {
        // Cleanup failure must not falsely report that an already committed
        // configuration was unchanged. Never remove an unfamiliar lock.
        if (completed) completed.cleanup_required = true;
        else throw error;
      }
    }
  } catch (error) {
    return { ...base, status: "manual_required", reason: error instanceof Refusal ? error.message : "configuration_unavailable",
      next_action: "review_existing_claude_configuration_privately" };
  }
}
