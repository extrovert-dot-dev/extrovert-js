import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AGENT_RELEASE } from "./agent-release.generated.js";

export type SkillHost = "claude" | "codex" | "hermes";
export type SkillScope = "project" | "user";
type State = "current" | "different" | "missing" | "unreadable" | "unsafe" | "ambiguous" | "unavailable";
export interface SkillInspectionRequest { host: SkillHost; scope: SkillScope; names: string[] }
interface Location { base: string; parts: string[]; canonicalBase: string }
interface Copy { state: State; sha256?: string }
const MAX_FILES = 128;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DEPTH = 12;
class InspectionError extends Error { constructor(readonly state: State) { super(state); } }

/** Explicit opt-in only. Names come from our packaged public manifest, never paths. */
export function parseSkillInspection(args: string[], env: NodeJS.ProcessEnv): SkillInspectionRequest | undefined {
  if (!args.some(a => ["--skills", "--host", "--scope"].includes(a))) return undefined;
  const values = new Map<string, string>();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === "--json") continue;
    if (!["--skills", "--host", "--scope"].includes(flag) || values.has(flag) || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error("Use agent status --host auto|claude|codex|hermes --scope project|user --skills <comma-separated Extrovert names> [--json]");
    values.set(flag, args[++i]!);
  }
  let host = values.get("--host");
  if (host === "auto") {
    const detected = [env.CLAUDECODE === "1" ? "claude" : null, env.CODEX_THREAD_ID ? "codex" : null, env.HERMES_HOME ? "hermes" : null].filter(Boolean);
    if (detected.length !== 1) throw new Error("Host detection is ambiguous or unavailable; choose --host explicitly.");
    host = detected[0]!;
  }
  const scope = values.get("--scope");
  const names = (values.get("--skills") ?? "").split(",");
  if (!["claude", "codex", "hermes"].includes(host ?? "") || !["project", "user"].includes(scope ?? "") || names.length > 9 || new Set(names).size !== names.length || names.some(name => !Object.hasOwn(AGENT_RELEASE.skills, name))) throw new Error("Specify a supported host, project|user scope, and exact published Extrovert skill names.");
  return { host: host as SkillHost, scope: scope as SkillScope, names };
}

function stat(path: string) {
  try { return lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new InspectionError("unreadable");
  }
}
/** Only caller-selected home/cwd anchors may resolve symlinks. Native roots beneath them may not. */
function checkedPath(base: string, parts: string[]): string | undefined {
  let path: string;
  try { path = realpathSync(base); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new InspectionError("unreadable"); }
  for (const part of parts) {
    path = join(path, part);
    const info = stat(path);
    if (!info) return undefined;
    if (info.isSymbolicLink() || !info.isDirectory()) throw new InspectionError("unsafe");
  }
  return path;
}
function locations(request: SkillInspectionRequest, env: NodeJS.ProcessEnv, cwd: string): Location[] {
  if (request.host === "hermes") throw new InspectionError("unavailable"); // Effective profile, trust and quarantine require native inventory.
  const home = resolve(env.HOME || homedir());
  if (request.scope === "user") {
    if (request.host === "claude") return [{ base: env.CLAUDE_CONFIG_DIR ? resolve(env.CLAUDE_CONFIG_DIR) : home, parts: env.CLAUDE_CONFIG_DIR ? ["skills"] : [".claude", "skills"], canonicalBase: home }];
    return [{ base: home, parts: [".agents", "skills"], canonicalBase: home }, { base: env.CODEX_HOME ? resolve(env.CODEX_HOME) : home, parts: env.CODEX_HOME ? ["skills"] : [".codex", "skills"], canonicalBase: home }];
  }
  const ancestors: string[] = [];
  let cursor = realpathSync(cwd);
  // Stay inside the nearest repository. With no repository, inspect only the explicit working directory.
  for (let i = 0; i < 64; i++) {
    ancestors.push(cursor);
    if (stat(join(cursor, ".git"))) break;
    const parent = dirname(cursor);
    if (parent === cursor) { ancestors.splice(1); break; }
    cursor = parent;
    if (i === 63) throw new InspectionError("unavailable");
  }
  return ancestors.flatMap((base, index) => request.host === "claude"
    ? [{ base, parts: [".claude", "skills"], canonicalBase: base }]
    : [{ base, parts: [".agents", "skills"], canonicalBase: base }, ...(index === 0 ? [{ base, parts: [".codex", "skills"], canonicalBase: base }] : [])]);
}

function digestBundle(root: string): string {
  const files: string[] = [];
  let count = 0;
  function walk(dir: string, depth: number) {
    if (depth > MAX_DEPTH) throw new InspectionError("unsafe");
    for (const name of readdirSync(dir)) {
      if (++count > MAX_FILES) throw new InspectionError("unsafe");
      const path = join(dir, name); const info = stat(path);
      if (!info || info.isSymbolicLink()) throw new InspectionError("unsafe");
      if (info.isDirectory()) walk(path, depth + 1);
      else if (info.isFile() && info.nlink === 1) files.push(path);
      else throw new InspectionError("unsafe");
    }
  }
  walk(root, 0);
  if (!files.includes(join(root, "SKILL.md"))) throw new InspectionError("unreadable");
  const hash = createHash("sha256"); let total = 0;
  for (const path of files.sort()) {
    // No file symlinks/FIFOs. Recheck descriptor identity and size before and after bounded reads.
    const before = lstatSync(path);
    if (!before.isFile() || before.nlink !== 1 || !(before.mode & 0o444) || before.size > MAX_BYTES - total) throw new InspectionError(before.mode & 0o444 ? "unsafe" : "unreadable");
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size) throw new InspectionError("unsafe");
      const bytes = Buffer.alloc(opened.size); let offset = 0;
      while (offset < bytes.length) { const n = readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) throw new InspectionError("unreadable"); offset += n; }
      const after = fstatSync(fd);
      if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new InspectionError("unsafe");
      total += bytes.length;
      hash.update(relative(root, path).split(sep).join("/")).update("\0").update(bytes).update("\0");
    } finally { closeSync(fd); }
  }
  return hash.digest("hex");
}
function inspectCopy(location: Location, name: string): Copy {
  try {
    const root = checkedPath(location.base, location.parts);
    if (!root) return { state: "missing" };
    let target = join(root, name); const info = stat(target);
    if (!info) return { state: "missing" };
    if (info.isSymbolicLink()) {
      const link = readlinkSync(target);
      const intended = isAbsolute(link) ? resolve(link) : resolve(root, link);
      const canonicalRoot = checkedPath(location.canonicalBase, [".agents", "skills"]);
      if (!canonicalRoot || intended !== join(canonicalRoot, name)) throw new InspectionError("unsafe");
      target = intended;
      const canonical = stat(target);
      if (!canonical) return { state: "missing" };
      if (!canonical.isDirectory() || canonical.isSymbolicLink()) throw new InspectionError("unsafe");
    } else if (!info.isDirectory()) throw new InspectionError("unsafe");
    return { state: "current", sha256: digestBundle(target) };
  } catch (error) { return { state: error instanceof InspectionError ? error.state : "unreadable" }; }
}

export function inspectSkills(request: SkillInspectionRequest, expected: Record<string, { sha256: string }> | undefined, env: NodeJS.ProcessEnv, cwd = process.cwd()) {
  let roots: Location[] = []; let unavailable: State | undefined;
  try { roots = locations(request, env, cwd); } catch (error) { unavailable = error instanceof InspectionError ? error.state : "unavailable"; }
  const skills = request.names.map(name => {
    const copies = roots.map(root => inspectCopy(root, name));
    const present = copies.filter(copy => copy.state !== "missing");
    const bad = present.find(copy => copy.state !== "current");
    const digests = [...new Set(present.map(copy => copy.sha256).filter(Boolean))];
    const published = expected?.[name]?.sha256;
    const state: State = unavailable ?? bad?.state ?? (digests.length > 1 ? "ambiguous" : !present.length ? "missing" : !published ? "unavailable" : digests[0] === published ? "current" : "different");
    return { name, status: state, ...(digests.length === 1 ? { installed_sha256: digests[0] } : {}), ...(published ? { expected_sha256: published } : {}), inspected_copies: present.length };
  });
  const status = skills.every(skill => skill.status === "current") ? "files_ready" : !expected || skills.some(skill => skill.status === "unavailable") ? "unavailable" : "pending";
  return { status, host: request.host, scope: request.scope, skills, skill_reload_verified: false, mcp_runtime_verified: false, inventory_complete: false,
    next_action: status === "files_ready" ? "read_complete_skills_then_verify_in_host" : "review_requested_skill_installation",
    summary: "Only requested skill files in supported roots were inspected. Host enablement, custom/plugin roots, active instructions and MCP identity are not verified. No files were changed." };
}
