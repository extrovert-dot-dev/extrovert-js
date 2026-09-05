import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { isMap, parseDocument } from "yaml";

/** Hermes's add command prompts for tool selection even without a TTY and can
 * exit zero without saving. Write only our named entry, preserving the document;
 * leave authentication and real connection verification to the host. */
export function setupHermes(env: NodeJS.ProcessEnv, credentialDirectory: string, transport: "stdio" | "hosted"): { existed: boolean; path: string; backup?: string; warning?: string } {
  const root = resolve(env.HERMES_HOME?.trim() || join(homedir(), ".hermes"));
  const path = join(root, "config.yaml");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("Hermes config is a symbolic link; update its Extrovert entry manually to avoid changing another profile.");
  const lock = `${path}.extrovert-setup.lock`;
  let descriptor: number;
  try { descriptor = openSync(lock, "wx", 0o600); }
  catch { throw new Error("Another Extrovert setup may be editing this Hermes profile. Retry after it finishes; if interrupted, inspect the setup lock before removing it."); }
  const temporary = `${path}.extrovert-${randomUUID()}.tmp`;
  try {
    const original = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (Buffer.byteLength(original) > 1024 * 1024) throw new Error("Hermes config is too large for automatic setup; add the Extrovert entry manually.");
    const document = parseDocument(original);
    if (document.errors.length) throw new Error("Hermes config could not be parsed. It has not been changed; fix its YAML syntax and retry.");
    if (document.contents && !isMap(document.contents)) throw new Error("Hermes config must be a YAML mapping. It has not been changed.");
    const servers = document.get("mcp_servers", true);
    if (servers && !isMap(servers)) throw new Error("Hermes mcp_servers must be a YAML mapping. It has not been changed.");
    if (document.hasIn(["mcp_servers", "extrovert"])) {
      const timeout = document.getIn(["mcp_servers", "extrovert", "timeout"]);
      const warning = typeof timeout === "number" && timeout <= 55
        ? "This profile's Extrovert timeout is too short for review waits. Set mcp_servers.extrovert.timeout to 90 seconds and reload Hermes."
        : undefined;
      return { existed: true, path, warning };
    }
    const entry = transport === "hosted"
      ? { url: "https://mcp.extrovert.dev/mcp", auth: "oauth", timeout: 90, enabled: true }
      : { command: "npx", args: ["-y", "@extrovert.dev/mcp@next"], env: { EXTROVERT_CONFIG_DIR: credentialDirectory }, timeout: 90, enabled: true };
    document.setIn(["mcp_servers", "extrovert"], entry);
    writeFileSync(temporary, document.toString(), { flag: "wx", mode: 0o600 });
    if ((existsSync(path) ? readFileSync(path, "utf8") : "") !== original) throw new Error("Hermes config changed during setup. No changes were applied; retry.");
    const backup = original ? `${path}.before-extrovert-${randomUUID()}` : undefined;
    if (backup) writeFileSync(backup, original, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
    return { existed: false, path, backup };
  } finally {
    closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
    unlinkSync(lock);
  }
}
