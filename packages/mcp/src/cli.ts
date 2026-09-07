import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";

import { ExtrovertApiError, ExtrovertClient } from "./client.js";
import { loadConfig, SERVER_VERSION } from "./config.js";
import { AGENT_CONTEXT_URL, AGENT_GUIDE_URL, buildAgentContext, fetchAgentContext } from "./agent-context.js";
import { renderDomain } from "./domain-presentation.js";
import { waitForDomain } from "./domain-wait.js";
import { formatWhoAmI } from "./identity-presentation.js";
import { setupHermes } from "./hermes-setup.js";
import { refreshClaude } from "./claude-refresh.js";
import { inspectSkills, parseSkillInspection } from "./skill-status.js";
import { Administration, type AdministrativeInput } from "./administration.js";
import { createCredentialStore, credentialFingerprint, isPersistentAPICredential, type CredentialStore } from "./credentials.js";
import { createLocalCredentialProvider, logoutLocalCredential } from "./local-oauth.js";
import { beginOAuthLogin, createLoopbackLogin, exchangeLoginCode, HOSTED_LOGIN_CALLBACK, loginAuthorizationUrl, OAuthLoginError, openLoginBrowser, parseCompletionCode, preferHeadlessLogin, revokeLoginTokens, type LoopbackLogin, type OAuthLoginRequest } from "./oauth-login.js";
import type { Message, Review } from "./types.js";

const MCP_PACKAGE = "@extrovert.dev/mcp@next";

export const CLI_HELP = `extrovert - setup, authenticate, and use Extrovert without custom transport code

Usage:
  extrovert version [--json]
  extrovert agent status [--json]
  extrovert agent status --host auto|claude|codex|hermes --scope project|user
                         --skills <comma-separated Extrovert names> [--json]
  extrovert setup [--host auto|codex|claude|hermes] [--transport stdio|hosted]
  extrovert setup --refresh --host claude [--json]
  extrovert auth login [--no-browser | --browser] [--json] [--reconnect]
  extrovert auth login --with-token
  extrovert auth complete [--json]
  extrovert auth cancel [--json]
  extrovert auth status
  extrovert auth logout
  extrovert enroll --agent-handle <name> [--client-id <retry-id>]
  extrovert domain list [--page <cursor>] [--limit <n>] [--json]
  extrovert domain status <domain> [--json]
  extrovert domain wait <domain> [--timeout-seconds <0-50>] [--json]
  extrovert domain recheck <domain> [--json]
  extrovert domain connect <domain> [--scope org|project] [--json]
  extrovert signup --human-email <email> [--username <name>]
  extrovert verify [--otp <code>]
  extrovert whoami [--json]
  extrovert auth whoami [--json]
  extrovert admin actions [--search <text>] [--mode read|change] [--limit <n>] [--cursor <cursor>]
  extrovert admin describe <action-id>
  extrovert admin read <action-id> [--input <json>]
  extrovert admin change <action-id> --input-stdin
  extrovert doctor [--domain <domain>] [--json]
  extrovert inbox list [--domain <name>] [--project <id> | --wildcard] [--limit <n>] [--cursor <cursor>] [--json]
  extrovert message list --inbox <address> [--unread] [--limit <n>] [--json]
  extrovert message get <message-id> [--source] [--json]
  extrovert review list [--state <state>] [--limit <n>] [--json]
  extrovert review status <review-id> [--json]
  extrovert send --inbox <address> --to <email> --subject <text> --text <body>
                 --summary <reviewer-intent> [--client-id <id>] [--rules-reviewed]

Authentication:
  auth login opens local browser sign-in when available. Its printed fallback URL
  finishes on Extrovert's website and supplies a one-use code for hidden stdin.
  SSH uses this hosted fallback directly. --no-browser chooses it explicitly.
  Non-interactive or --json login returns pending instructions immediately; run
  auth complete in the same profile and provide the website's code on stdin.
  Existing working credentials are reused; --reconnect explicitly replaces this
  profile only after browser consent and a successful whoami. Failed login preserves it.
  Hosted OAuth belongs to your MCP host; call whoami there to verify that session.
  Local whoami/doctor checks this profile's API credential, which may be different.
  auth login --with-token reads an agent key or independent ev_credential_... API
  credential from hidden stdin. Never put secrets in command arguments.
  enroll reads an enrollment key from EXTROVERT_ENROLLMENT_KEY or hidden stdin.
  Use EXTROVERT_PROFILE for separate agent identities. Hermes profiles use their
  HERMES_HOME automatically; EXTROVERT_CONFIG_DIR is an explicit override.
  signup stores only a short-lived pending key; verify atomically replaces it with
  the full key in a permission-restricted local credential file. EXTROVERT_API_KEY
  always takes precedence over the stored credential.

Access and administration:
  Choose selected inboxes for existing mail, project/org reach for future resources,
  or explicit Full account control for customer administration. Actions are separate.
  Full control defaults to 24 hours; refresh never extends that deadline. Until revoked
  is explicit. Created credentials, including admin credentials, survive independently.
  Start with 'extrovert admin read adminMe', search actions, then describe exact inputs.
  Read state before repeating an ambiguous change. Review and separately revoke created
  access in account > Connections. Do not silently replace an expired credential.
  Guide: https://docs.extrovert.dev/concepts/connections-and-access/

MCP transport:
  Running extrovert-mcp with no command starts stdio. The official plugin and
  explicit-host setup configure that published server directly. --host auto prefers
  hosted OAuth when exactly one supported host is detected; Codex hosted setup
  provides its native interactive sign-in command. Existing entries stay intact.
  setup --refresh --host claude privately updates one supported local/user npx
  entry to @next with --prefer-online. It preserves credentials and other arguments,
  refuses pins and ambiguous configurations, and still requires an MCP restart.
  Refresh bypasses ordinary setup and accepts no --transport override. JSON returns
  restart_required (exit 0) or manual_required (exit 1); runtime_verified stays false.
`;

export interface CliOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: NodeJS.ReadStream | Readable;
  stdout?: NodeJS.WriteStream | Writable;
  stderr?: NodeJS.WriteStream | Writable;
  credentialStore?: CredentialStore;
  runCommand?: (command: string, args: string[]) => SpawnSyncReturns<string>;
  openBrowser?: (url: string) => Promise<boolean>;
}

interface CliContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdin: NodeJS.ReadStream | Readable;
  stdout: NodeJS.WriteStream | Writable;
  stderr: NodeJS.WriteStream | Writable;
  store: CredentialStore;
  runCommand: (command: string, args: string[]) => SpawnSyncReturns<string>;
  openBrowser: (url: string) => Promise<boolean>;
}

export async function runCli(argv: string[], options: CliOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const context: CliContext = {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdin: options.stdin ?? process.stdin,
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
    store: options.credentialStore ?? createCredentialStore(env),
    openBrowser: options.openBrowser ?? openLoginBrowser,
    runCommand:
      options.runCommand ??
      ((command, args) =>
        spawnSync(command, args, {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        })),
  };

  try {
    const command = argv[0];
    if (!command || command === "help" || command === "--help" || command === "-h") {
      context.stdout.write(CLI_HELP);
      return 0;
    }
    if (argv.includes("--help") || argv.includes("-h")) {
      const usages = CLI_HELP.split("\n").filter((line) => line.startsWith(`  extrovert ${command} `));
      if (!usages.length) throw new CliUsageError(`Unknown Extrovert command: ${command}`);
      context.stdout.write(`Usage:\n${usages.join("\n")}\n\nKeys are read from the environment or hidden stdin, never command arguments.\n`);
      return 0;
    }
    switch (command) {
      case "--version":
      case "version":
        writeResult(context, { version: SERVER_VERSION, package: "@extrovert.dev/mcp", channel: "next" }, hasFlag(argv, "--json"), value => value.version);
        return 0;
      case "agent":
        return await agentStatusCommand(argv.slice(1), context);
      case "setup":
        return setupCommand(argv.slice(1), context);
      case "auth":
        return await authCommand(argv.slice(1), context);
      case "enroll":
        return await enrollCommand(argv.slice(1), context);
      case "domain":
        return await domainCommand(argv.slice(1), context);
      case "signup":
        return await signupCommand(argv.slice(1), context);
      case "verify":
        return await verifyCommand(argv.slice(1), context);
      case "whoami":
        return await whoamiCommand(argv.slice(1), context);
      case "doctor":
        return await doctorCommand(argv.slice(1), context);
      case "admin":
        return await administrativeCommand(argv.slice(1), context);
      case "inbox":
        return await inboxCommand(argv.slice(1), context);
      case "message":
        return await messageCommand(argv.slice(1), context);
      case "review":
        return await reviewCommand(argv.slice(1), context);
      case "send":
        return await sendCommand(argv.slice(1), context);
      default:
        throw new CliUsageError(`Unknown Extrovert command: ${command}`);
    }
  } catch (error) {
    const message = renderError(error);
    context.stderr.write(`${message}\n`);
    if (error instanceof CliUsageError) context.stderr.write("Run 'extrovert --help' for usage.\n");
    return error instanceof CliUsageError ? 2 : 1;
  }
}

async function administrativeCommand(args: string[], context: CliContext): Promise<number> {
  const discovery = new Administration(async () => { throw new Error("Discovery cannot execute requests"); });
  let result: unknown;
  if (args[0] === "actions") {
    const mode = option(args, "--mode");
    if (mode !== undefined && mode !== "read" && mode !== "change") throw new CliUsageError("--mode must be read or change");
    result = discovery.list({ search: option(args, "--search"), mode, limit: integerOption(args, "--limit", 20, 1, 100), cursor: option(args, "--cursor") });
  } else if (args[0] === "describe") {
    if (!args[1]) throw new CliUsageError("admin describe requires an action ID");
    result = discovery.describe(args[1]);
  } else if (args[0] === "read" || args[0] === "change") {
    if (!args[1]) throw new CliUsageError("admin read/change requires an action ID");
    if (args[0] === "change" && !hasFlag(args, "--input-stdin")) throw new CliUsageError("admin change reads JSON from --input-stdin to keep credential material out of shell history");
    if (hasFlag(args, "--input-stdin") && option(args, "--input")) throw new CliUsageError("Use either --input or --input-stdin");
    let raw = option(args, "--input") ?? "{}";
    if (hasFlag(args, "--input-stdin")) {
      raw = "";
      for await (const chunk of context.stdin) {
        raw += String(chunk);
        if (raw.length > 1_000_000) throw new CliUsageError("Administrative input exceeds 1 MB");
      }
    }
    let input: AdministrativeInput;
    try { input = JSON.parse(raw) as AdministrativeInput; } catch { throw new CliUsageError("Administrative input must be valid JSON with path/query/body fields"); }
    result = await requireAuthentication(context).client.runAdministrativeAction(args[1], input, args[0]);
  } else throw new CliUsageError("admin requires actions, describe, read, or change");
  context.stdout.write(`${JSON.stringify(result ?? null, null, 2)}\n`);
  return 0;
}

function setupCommand(args: string[], context: CliContext): number {
  if (hasFlag(args, "--refresh")) {
    if (option(args, "--host") !== "claude" || option(args, "--transport") !== undefined) {
      throw new CliUsageError("Refresh requires --host claude without --transport; it preserves the existing stdio connection.");
    }
    const result = refreshClaude(context.env);
    writeResult(context, result, hasFlag(args, "--json"), value => value.status === "restart_required"
      ? `Extrovert's ${value.scope}-scope Claude configuration ${value.configuration_changed ? "was refreshed privately" : "already uses @next with --prefer-online"}. Restart Extrovert MCP in Claude, then check the live release and call whoami. The running connection has not been verified.${value.backup ? ` Private backup: ${value.backup}.` : ""}${value.cleanup_required ? " Configuration was saved, but temporary-file or lock cleanup needs private inspection before another refresh." : ""}`
      : `No configuration was changed (${value.reason}). Review the existing Extrovert entry privately in Claude's MCP settings; preserve its scope, arguments and credentials. Do not copy credentials into commands or chat.`);
    return result.status === "restart_required" ? 0 : 1;
  }
  const requestedHost = option(args, "--host") ?? "codex";
  let host = requestedHost;
  if (host === "auto") {
    const detected = [
      context.env.CODEX_THREAD_ID?.trim() ? "codex" : undefined,
      context.env.CLAUDECODE?.trim() === "1" ? "claude" : undefined,
      context.env.HERMES_HOME?.trim() ? "hermes" : undefined,
    ].filter((value): value is string => Boolean(value));
    if (detected.length !== 1) {
      throw new CliUsageError(`${detected.length ? "Multiple agent hosts were detected" : "The current agent host could not be detected"}. Choose --host codex, --host claude, or --host hermes. For other hosts, connect https://mcp.extrovert.dev/mcp using the host's MCP settings. No configuration was changed.`);
    }
    host = detected[0]!;
  }
  if (!new Set(["codex", "claude", "hermes"]).has(host)) {
    throw new CliUsageError("--host must be auto, codex, claude, or hermes");
  }
  const transport = option(args, "--transport") ?? (requestedHost === "auto" ? "hosted" : "stdio");
  if (transport !== "stdio" && transport !== "hosted") throw new CliUsageError("--transport must be stdio or hosted");
  const credentialAvailable = transport === "stdio" && Boolean(context.env.EXTROVERT_API_KEY?.trim() || context.store.load());
  if (host === "hermes") {
    const result = setupHermes(context.env, context.store.paths.directory, transport);
    context.stdout.write(`Hermes configuration: ${result.path}\n`);
    if (result.warning) context.stdout.write(`${result.warning}\n`);
    if (result.existed) {
      context.stdout.write("Extrovert already has an entry in this Hermes profile. It was not changed. Start or reload the session and call whoami; configuration alone does not prove the connection works.\n");
    } else {
      context.stdout.write(`Extrovert configured for this Hermes profile.${result.backup ? ` A private backup of the previous configuration is at ${result.backup}.` : ""}\n`);
      context.stdout.write(transport === "hosted" ? "Next: run 'hermes mcp login extrovert' and sign in to your existing Extrovert account. Create an account only if you do not have one. Then start or reload your session and call whoami. If sign-in succeeds but whoami fails, do not repeat approval; share the response request ID with support.\n" : credentialAvailable
        ? "An agent credential is already available for this profile. Next: run 'extrovert doctor', then start or reload Hermes and call whoami to confirm access.\n"
        : "Next: run 'extrovert auth login' for this same profile, or redeem an enrollment key with 'extrovert enroll --agent-handle <name>'. Run 'extrovert doctor', then start or reload Hermes and call whoami.\n");
    }
    return 0;
  }
  const executable = host;
  const existing = context.runCommand(executable, ["mcp", "get", "extrovert", ...(host === "codex" ? ["--json"] : [])]);
  if (existing.error && isMissingExecutable(existing.error)) {
    throw new Error(`${host} is not installed or not on PATH`);
  }
  if (existing.error) throw existing.error;
  if (existing.status === 0) {
    context.stdout.write(`Extrovert MCP configuration exists for ${host}; it has not been changed. Configuration alone does not confirm a working connection. Start a new session and call whoami to verify access.\n`);
    return 0;
  }
  if (!/no MCP server named|^not found$/im.test(`${existing.stderr}\n${existing.stdout}`)) {
    throw new Error(`Could not inspect the existing ${host} MCP configuration. No configuration was changed. ${cleanCommandError(existing.stderr)}`);
  }
  if (transport === "hosted" && host === "codex") {
    // Codex add can immediately start OAuth. Do not hide its login prompt inside
    // the installer's piped subprocess or wait indefinitely for a browser callback.
    context.stdout.write("Setup required: Extrovert has not been configured for Codex. Run this native command in an interactive terminal and complete its sign-in flow:\ncodex mcp add extrovert --url https://mcp.extrovert.dev/mcp\nSign in to your existing Extrovert account first. Create an account only if you do not have one. Then start or reload Codex and call whoami to verify access.\n");
    return 1;
  }
  const addArgs = transport === "hosted"
    ? ["mcp", "add", "--transport", "http", "--scope", "local", "extrovert", "https://mcp.extrovert.dev/mcp"]
    : host === "claude"
      ? ["mcp", "add", "extrovert", "--transport", "stdio", "--env", `EXTROVERT_CONFIG_DIR=${context.store.paths.directory}`, "--", "npx", "-y", MCP_PACKAGE]
      : ["mcp", "add", "extrovert", "--env", `EXTROVERT_CONFIG_DIR=${context.store.paths.directory}`, "--", "npx", "-y", MCP_PACKAGE];
  const added = context.runCommand(executable, addArgs);
  if (added.error) throw added.error;
  if (added.status !== 0) {
    throw new Error(cleanCommandError(added.stderr) || `Could not configure Extrovert MCP for ${host}`);
  }
  if (transport === "hosted") {
    context.stdout.write("Configured Extrovert hosted MCP for Claude Code in this project's local scope. Open /mcp in Claude Code to sign in to your existing Extrovert account; create an account only if you do not have one. Start or reload the session and call whoami to verify access.\n");
    return 0;
  }
  context.stdout.write(`Configured Extrovert MCP for ${host}. ${credentialAvailable
    ? "An agent credential is already available for this profile. Run 'extrovert doctor'."
    : "Run 'extrovert auth login' to sign in to your existing account, or redeem an enrollment key with 'extrovert enroll --agent-handle <name>'."} Start a new session and call whoami to verify the connection.\n`);
  return 0;
}

async function agentStatusCommand(args: string[], context: CliContext): Promise<number> {
  if (args[0] !== "status") throw new CliUsageError("agent requires status");
  let inspection: ReturnType<typeof parseSkillInspection>;
  try { inspection = parseSkillInspection(args, context.env); } catch (error) { throw new CliUsageError((error as Error).message); }
  const config = loadConfig(context.env);
  try {
    const remote = config.mock ? await buildAgentContext(config) : await fetchAgentContext();
    if (inspection) {
      const local = inspectSkills(inspection, remote.skills, context.env, context.cwd);
      const result = { ...remote, status: local.status, installed_cli_version: SERVER_VERSION, release_match: remote.release_version === SERVER_VERSION, local_skills: local, next_action: local.next_action };
      writeResult(context, result, hasFlag(args, "--json"), value => `${value.status}: ${value.local_skills.skills.map(skill => `${skill.name}: ${skill.status}`).join(", ")}\n${value.local_skills.summary}`);
      return local.status === "files_ready" ? 0 : 1;
    }
    const matches = remote.release_version === SERVER_VERSION;
    const result = {
      status: "ok", installed_cli_version: SERVER_VERSION,
      release_match: matches, installed_skills: "not_inspected",
      next_action: matches ? "read_live_guide" : "review_release_difference",
      ...remote,
    };
    writeResult(context, result, hasFlag(args, "--json"), value =>
      `Installed CLI: ${value.installed_cli_version}. Hosted release: ${value.release_version}.\nSignup: ${value.signup.status}.\nRead ${value.docs.agent_index}\nSkill files were not inspected or changed. Preserve pins and local edits.`);
    return 0;
  } catch {
    if (inspection) {
      const local = inspectSkills(inspection, undefined, context.env, context.cwd);
      writeResult(context, { status: "unavailable", installed_cli_version: SERVER_VERSION, local_skills: local, next_action: "read_live_guide", contract_url: AGENT_CONTEXT_URL }, hasFlag(args, "--json"), () => `unavailable: Current published skill hashes could not be checked. ${local.summary}`);
      return 1;
    }
    const result = { status: "unavailable", installed_cli_version: SERVER_VERSION, next_action: "read_live_guide", agent_index: AGENT_GUIDE_URL, contract_url: AGENT_CONTEXT_URL,
      summary: "Could not verify the hosted release. Read the live guide; do not treat this local CLI as current or retry an ambiguous mutation." };
    writeResult(context, result, hasFlag(args, "--json"), value => `${value.summary}\n${value.agent_index}`);
    return 1;
  }
}

async function authCommand(args: string[], context: CliContext): Promise<number> {
  const action = args[0];
  if (action === "complete" || action === "cancel" || (action === "login" && !hasFlag(args, "--with-token"))) return browserAuthCommand(args, context);
  switch (action) {
    case "whoami":
      return whoamiCommand(args.slice(1), context);
    case "login": {
      const token = (context.env.EXTROVERT_API_KEY ?? "").trim() || (await readSecret(context, "API credential: "));
      if (!isPersistentAPICredential(token)) throw new CliUsageError("Expected a scoped pk_agent_… key or independent ev_credential_… credential. Hosted OAuth access/refresh tokens remain managed by the host.");
      const client = clientForKey(token, context, context.env.EXTROVERT_API_BASE_URL);
      const me = await client.whoami();
      context.store.save(token, clientBaseUrl(token, context, context.env.EXTROVERT_API_BASE_URL));
      context.stdout.write(`Authenticated agent ${me.agent_id}; credential saved at ${context.store.paths.credential}.\n`);
      return 0;
    }
    case "status": {
      const auth = resolveAuthentication(context);
      if (!auth) {
        context.stdout.write("Not connected locally. Run 'extrovert auth login' or redeem an enrollment key with 'extrovert enroll --agent-handle <name>'. Hosted MCP sign-in belongs to that host.\n");
        return 1;
      }
      const me = await auth.client.whoami();
      context.stdout.write(`Authenticated via ${auth.source}.\n${formatWhoAmI(me)}\n`);
      return 0;
    }
    case "logout": {
      const result = await logoutLocalCredential(context.store);
      context.store.clearPendingSignup();
      context.store.clearPendingOAuth();
      writeResult(context, result, hasFlag(args, "--json"), () => result.status === "remote_unconfirmed"
        ? "Could not confirm revocation of this local OAuth connection. Credentials were preserved so you can retry logout."
        : result.remote_revocation === "confirmed" ? "Revoked this local OAuth connection and removed its stored credentials."
        : result.credential_removed ? "Removed the stored Extrovert credential. Independent API keys must be revoked separately in Connections."
        : "No stored Extrovert credential was present.");
      return result.status === "remote_unconfirmed" ? 1 : 0;
    }
    default:
      throw new CliUsageError("auth requires login, complete, cancel, status, whoami, or logout");
  }
}

async function browserAuthCommand(args: string[], context: CliContext): Promise<number> {
  const json = hasFlag(args, "--json");
  let listener: LoopbackLogin | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let loginRequest: OAuthLoginRequest | undefined;
  let expired = false;
  let finishing = false;
  const controller = new AbortController();
  const operation = new AbortController();
  const setDeadline = (request: OAuthLoginRequest) => {
    const remaining = Date.parse(request.expires_at) - Date.now();
    if (remaining <= 0) throw new OAuthLoginError("expired", "This login request expired. Start a new login.");
    deadline = setTimeout(() => { expired = true; controller.abort(); operation.abort(); }, remaining);
  };
  const onSignal = () => { controller.abort(); operation.abort(); };
  process.once("SIGINT", onSignal); process.once("SIGTERM", onSignal);
  const emit = (value: Record<string, unknown>, message: string) => writeResult(context, value, json, () => message);
  const readCode = async (request: OAuthLoginRequest, prompt: string) => {
    const text = await readSecret(context, prompt, controller.signal);
    if (!text.trim()) throw new OAuthLoginError("cancelled", "Login input ended. Your existing profile was preserved.");
    return parseCompletionCode(text, request);
  };
  try {
    const known = new Set(["--json", "--no-browser", "--browser", "--reconnect"]);
    if (args.slice(1).some(arg => !known.has(arg) || (args[0] !== "login" && arg !== "--json")) || (hasFlag(args, "--no-browser") && hasFlag(args, "--browser"))) throw new CliUsageError("Use auth login [--no-browser | --browser] [--json] [--reconnect], auth complete, or auth cancel. Completion codes are read from hidden stdin, never arguments.");
    if (args[0] === "cancel") {
      context.store.clearPendingOAuth();
      emit({ status: "cancelled" }, "Cancelled pending login. Your existing profile was preserved.");
      return 0;
    }
    if (args[0] === "complete") {
      if (context.env.EXTROVERT_API_KEY?.trim()) throw new CliUsageError("EXTROVERT_API_KEY overrides this profile. Remove that explicit override before completing browser login.");
      const request = context.store.loadPendingOAuth();
      if (!request) throw new OAuthLoginError("invalid_response", "No pending login exists in this profile. Run extrovert auth login first.");
      loginRequest = request;
      setDeadline(request);
      const code = await readCode(request, "Paste the Extrovert completion code: ");
      finishing = true;
      clearTimeout(deadline);
      return await finishBrowserLogin(request, code, true, context, json, operation.signal);
    }
    const existing = resolveAuthentication(context);
    if (existing && !hasFlag(args, "--reconnect")) {
      try {
        const me = await existing.client.whoami();
        emit({ status: "complete", reused: true, identity: me }, `Already connected.\n${formatWhoAmI(me)}\nUse --reconnect for a new browser consent, or a different EXTROVERT_PROFILE for another agent.`);
        return 0;
      } catch {
        throw new OAuthLoginError("unavailable", "This profile's existing access could not be verified. Check connectivity or use auth login --reconnect for explicit new consent. The credential was preserved.");
      }
    }
    if (context.env.EXTROVERT_API_KEY?.trim()) throw new CliUsageError("EXTROVERT_API_KEY overrides this profile. Remove that explicit override before browser login, or choose the intended environment.");
    if (context.store.loadPendingSignup()) throw new CliUsageError("This profile has a pending signup. Complete it or use a different EXTROVERT_PROFILE before starting browser login.");
    const tty = Boolean((context.stdin as NodeJS.ReadStream).isTTY);
    if (hasFlag(args, "--browser") && (!tty || json)) throw new CliUsageError("--browser needs an interactive terminal. Use --no-browser --json and then auth complete for automation.");
    let pending = context.store.loadPendingOAuth();
    if (pending && Date.parse(pending.expires_at) <= Date.now()) { context.store.clearPendingOAuth(); pending = undefined; }
    let request: OAuthLoginRequest;
    let localUrl: string | undefined;
    if (pending) request = pending;
    else {
      const fingerprint = credentialFingerprint(context.store.load());
      const headless = hasFlag(args, "--no-browser") || json || (!hasFlag(args, "--browser") && preferHeadlessLogin(context.env, tty));
      if (!headless) {
        try { listener = await createLoopbackLogin(); }
        catch { context.stderr.write("A local login listener could not start. Using the hosted completion page.\n"); }
      }
      const started = await beginOAuthLogin({ issuer: context.env.EXTROVERT_API_BASE_URL, redirectUri: listener?.redirectUri ?? HOSTED_LOGIN_CALLBACK, manualRedirectUri: HOSTED_LOGIN_CALLBACK, signal: operation.signal });
      operation.signal.throwIfAborted();
      request = started.request;
      context.store.savePendingOAuth({ ...request, credential_fingerprint: fingerprint });
      localUrl = listener ? started.authorizationUrl : undefined;
    }
    const authorizationUrl = loginAuthorizationUrl(request, true);
    loginRequest = request;
    const result = { status: "pending", authorization_url: authorizationUrl, expires_at: request.expires_at, next_action: "auth complete", instructions: "Open authorization_url, sign in to your existing account and approve access. Paste the hosted page's completion code into extrovert auth complete in this same profile. Never put the code in a command argument." };
    if (!tty || json) { emit(result, `${result.instructions}\n${authorizationUrl}`); return 0; }
    setDeadline(request);
    const local = listener?.wait(request, controller.signal).then(code => ({ code, manual: false }));
    if (local) void local.catch(() => {}); // An abort during browser launch is handled by the race below.
    if (localUrl) {
      context.stdout.write("Opening your browser to sign in…\n");
      if (!await context.openBrowser(localUrl)) context.stdout.write("The browser could not be opened automatically.\n");
    }
    context.stdout.write(`If you are signing in on another machine or the browser did not open, visit:\n${authorizationUrl}\nThis link returns to Extrovert's website with a completion code.\n`);
    const manual = readCode(request, "Paste code here if prompted > ").then(code => ({ code, manual: true }));
    const completed = await Promise.race(local ? [local, manual] : [manual]);
    finishing = true;
    clearTimeout(deadline);
    controller.abort();
    return await finishBrowserLogin(request, completed.code, completed.manual, context, json, operation.signal);
  } catch (error) {
    if (error instanceof CliUsageError) throw error;
    const status = expired ? "expired" : operation.signal.aborted ? "cancelled" : error instanceof OAuthLoginError ? error.status : !finishing && (controller.signal.aborted || (error instanceof Error && /cancel|input ended/i.test(error.message))) ? "cancelled" : "unavailable";
    const message = expired ? "Login timed out. Start a new login; your existing profile was preserved." : error instanceof OAuthLoginError ? error.message : status === "cancelled" ? "Login cancelled. Your existing profile was preserved." : "Login did not complete. Your existing profile was preserved; start a new login if the code exchange was attempted.";
    if (loginRequest && ["denied", "expired", "cancelled"].includes(status)) {
      try { context.store.takePendingOAuth(loginRequest.state); } catch { /* A different process may have replaced this attempt. */ }
    }
    if (json) emit({ status, message, next_action: status === "invalid_response" ? "auth complete" : "auth login" }, message);
    else context.stderr.write(`${message}\n`);
    return 1;
  } finally {
    clearTimeout(deadline);
    controller.abort();
    await listener?.close();
    process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal);
  }
}

async function finishBrowserLogin(request: OAuthLoginRequest, code: string, manual: boolean, context: CliContext, json: boolean, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  const claimed = context.store.takePendingOAuth(request.state);
  if (!claimed) throw new OAuthLoginError("cancelled", "This login was already completed or cancelled. Check auth status before starting another.");
  if (claimed.credential_fingerprint === undefined || credentialFingerprint(context.store.load()) !== claimed.credential_fingerprint) throw new OAuthLoginError("cancelled", "This profile changed while login was pending. Its current credentials were preserved. Start a new login.");
  const tokens = await exchangeLoginCode({ ...claimed, redirect_uri: manual ? claimed.manual_redirect_uri ?? claimed.redirect_uri : claimed.redirect_uri }, code, { signal });
  let me;
  try {
    signal.throwIfAborted();
    me = await clientForKey(tokens.access_token, context, tokens.api_base_url).whoami();
    signal.throwIfAborted();
    await context.store.saveOAuth({ ...tokens, grant_expires_at: me.connection?.expires_at_ms ? new Date(me.connection.expires_at_ms).toISOString() : undefined }, { expectedFingerprint: claimed.credential_fingerprint, signal });
  } catch (error) {
    if (!await revokeLoginTokens(tokens)) context.stderr.write("Could not confirm cleanup of the newly approved connection. Review it in Extrovert account > Connections. Your previous profile was preserved.\n");
    throw error;
  }
  writeResult(context, { status: "complete", identity: me, credential_source: context.store.paths.credential }, json, () => `Connected.\n${formatWhoAmI(me)}\nCredentials saved privately for this profile. Start or reload its stdio MCP and call whoami there.`);
  return 0;
}

async function enrollCommand(args: string[], context: CliContext): Promise<number> {
  const handle = requiredOption(args, "--agent-handle");
  // Never overwrite another agent's stored identity as an enrollment side effect.
  if (context.store.load() || context.env.EXTROVERT_API_KEY?.trim()) {
    throw new CliUsageError("This profile already has an agent key. Run 'extrovert auth status', or choose a new EXTROVERT_PROFILE for a new agent.");
  }
  const token = context.env.EXTROVERT_ENROLLMENT_KEY?.trim() || await readSecret(context, "Enrollment key: ");
  if (!token.startsWith("pk_enroll_")) throw new CliUsageError("Expected an enrollment key. For an existing agent key use 'extrovert auth login --with-token'.");
  const config = loadConfig({ ...context.env, EXTROVERT_API_KEY: "" });
  const client = new ExtrovertClient(config, {
    onDurableAgentKey: (key, baseUrl) => {
      context.store.save(key, baseUrl);
      return { location: context.store.paths.credential };
    },
  });
  await client.redeemEnrollment({ enrollment_token: token, agent_handle: handle, client_id: option(args, "--client-id") ?? `enroll-${handle}` });
  if (!client.credentialPersistenceStatus().persisted) {
    throw new Error("Enrollment succeeded, but the agent key could not be saved. Fix this profile's credential-directory permissions and retry with the same agent handle and retry id. No secret was printed.");
  }
  const me = await client.whoami();
  context.stdout.write(`Agent connected. Credential saved privately for this profile.\n${formatWhoAmI(me)}\nStart or reload your MCP session and call whoami.\n`);
  return 0;
}

async function domainCommand(args: string[], context: CliContext): Promise<number> {
  const action = args[0];
  if (!["list", "status", "wait", "recheck", "connect"].includes(action ?? "")) throw new CliUsageError("domain requires list, status, wait, recheck, or connect");
  const client = requireAuthentication(context).client;
  if (action === "list") {
    const limit = option(args, "--limit");
    if (limit && (!Number.isInteger(Number(limit)) || Number(limit) < 1 || Number(limit) > 100)) throw new CliUsageError("--limit must be an integer from 1 to 100");
    const page = await client.listDomains({ page: option(args, "--page"), limit: limit ? Number(limit) : undefined });
    writeResult(context, page, hasFlag(args, "--json"), (value) => (value.items.map((domain) => renderDomain(domain, hasFlag(args, "--diagnostics"))).join("\n\n") || "No domains are available to this agent.") + (value.next_cursor ? `\nMore results are available. Next page: ${value.next_cursor}` : ""));
    return 0;
  }
  const domain = args[1];
  if (!domain || domain.startsWith("-")) throw new CliUsageError(`domain ${action} requires a domain name`);
  if (action === "wait") {
    const timeout = option(args, "--timeout-seconds");
    const result = await waitForDomain((signal) => client.getDomain(domain, signal), { timeout_seconds: timeout === undefined ? undefined : Number(timeout) });
    writeResult(context, result, hasFlag(args, "--json"), (value) => renderDomain(value.domain, hasFlag(args, "--diagnostics")) + (value.outcome === "timed_out" ? `\nStill setting up. Resume checking in ${value.resume_after_seconds} seconds.` : ""));
    return 0;
  }
  const scope = option(args, "--scope");
  if (scope && scope !== "org" && scope !== "project") throw new CliUsageError("--scope must be org or project");
  const result = action === "status" ? await client.getDomain(domain)
    : action === "recheck" ? await client.verifyDomain(domain)
    : await client.onboardDomain({ domain, mode: "ns_delegated", scope: scope as "org" | "project" | undefined });
  writeResult(context, result, hasFlag(args, "--json"), (value) => renderDomain(value, hasFlag(args, "--diagnostics")));
  return 0;
}

async function signupCommand(args: string[], context: CliContext): Promise<number> {
  const humanEmail = requiredOption(args, "--human-email");
  const username = option(args, "--username");
  const apiBaseUrl = context.env.EXTROVERT_API_BASE_URL;
  const config = loadConfig({ ...context.env, EXTROVERT_API_KEY: "", ...(apiBaseUrl ? { EXTROVERT_API_BASE_URL: apiBaseUrl } : {}) });
  const client = new ExtrovertClient(config);
  const result = await client.signUp({ human_email: humanEmail, username });
  context.store.savePendingSignup({
    agent_key: result.agent_key,
    human_email: humanEmail,
    address: result.address,
    otp_expires_at: result.activation_expires_at ?? result.otp_expires_at ?? "",
    activation_method: result.activation_method,
    api_base_url: config.apiBaseUrl,
  });
  context.stdout.write(
    `${result.activation_method === "incoming_email" ? result.message : `Verification code sent to ${result.otp_sent_to}. If it is missing, confirm the address and check spam/junk for the Extrovert verification email.`}\nInbox: ${result.address}\nPending credential saved securely; run 'extrovert verify'.\n`,
  );
  return 0;
}

async function verifyCommand(args: string[], context: CliContext): Promise<number> {
  const pending = context.store.loadPendingSignup();
  if (!pending) throw new Error("No pending signup. Run 'extrovert signup --human-email <email>' first.");
  const client = clientForKey(pending.agent_key, context, pending.api_base_url);
  let otp: string | undefined;
  if (pending.activation_method === "incoming_email") {
    const activation = await client.activationStatus();
    if (activation.state !== "proven") {
      context.stdout.write(activation.state === "expired" ? "This reservation expired. Sign in to the console to continue.\n" : `Your agent’s inbox is almost ready. Send an email from ${activation.human_email} to ${activation.address}, or approve it in the console, then run 'extrovert verify' again.\n`);
      return 0;
    }
  } else {
    otp = option(args, "--otp") ?? (await readVisibleLine(context, "Verification code: "));
    if (!otp.trim()) throw new CliUsageError("Verification code cannot be empty");
  }
  const result = await client.verify({ otp: otp?.trim() });
  try {
    context.store.save(result.agent_key, pending.api_base_url);
  } catch (error) {
    throw new Error(`Verification succeeded, but the new credential could not be saved. No key was printed. Fix this profile's storage permissions and ask the account owner for a replacement scoped key; do not repeat signup or create another account. ${renderError(error)}`);
  }
  context.store.clearPendingSignup();
  context.stdout.write(
    `Verified. Full credential saved at ${context.store.paths.credential}.\nInbox: ${result.address}\nScopes: ${result.scopes.join(", ")}\nStart a new agent session; Extrovert MCP will authenticate automatically.\n`,
  );
  return 0;
}

async function whoamiCommand(args: string[], context: CliContext): Promise<number> {
  const me = await requireAuthentication(context).client.whoami();
  writeResult(context, me, hasFlag(args, "--json"), formatWhoAmI);
  return 0;
}

async function doctorCommand(args: string[], context: CliContext): Promise<number> {
  const auth = resolveAuthentication(context);
  if (!auth) {
    const result = { connected: false, next_action: "connect", summary: "No local agent credential is available for this profile. Hosted OAuth credentials belong to your MCP host; use whoami there. For local access, run 'extrovert auth login' or redeem an enrollment key with 'extrovert enroll --agent-handle <name>'." };
    writeResult(context, result, hasFlag(args, "--json"), (value) => value.summary);
    return 1;
  }
  const me = await auth.client.whoami();
  const domainName = option(args, "--domain");
  const domain = domainName ? await auth.client.getDomain(domainName) : undefined;
  const result = { connected: true, identity: me, credential_source: auth.source, domain,
    next_action: "verify_in_host", summary: "The local API connection works. Start or reload your MCP session and call whoami there to confirm the host uses this same profile and identity." };
  writeResult(context, result, hasFlag(args, "--json"), () => [formatWhoAmI(me), domain ? renderDomain(domain) : "", result.summary].filter(Boolean).join("\n\n"));
  return 0;
}

async function inboxCommand(args: string[], context: CliContext): Promise<number> {
  if (args[0] !== "list") throw new CliUsageError("inbox requires list");
  const limit = integerOption(args, "--limit", 20, 1, 100);
  const page = await requireAuthentication(context).client.listInboxes({ limit, domain: option(args, "--domain"), project: option(args, "--project"), wildcard: hasFlag(args, "--wildcard"), cursor: option(args, "--cursor") });
  writeResult(
    context,
    page,
    hasFlag(args, "--json"),
    (value) => {
      const rows = value.items.map((inbox) => `${inbox.address}\t${inbox.status ?? "status unavailable"}\t${inbox.id}`).join("\n") || "No inboxes matched this connection’s scope and filters.";
      return value.next_cursor ? `${rows}\nMore inboxes are available. Repeat with the same filters and --cursor ${JSON.stringify(value.next_cursor)}.` : rows;
    },
  );
  return 0;
}

async function messageCommand(args: string[], context: CliContext): Promise<number> {
  const action = args[0];
  const client = requireAuthentication(context).client;
  if (action === "list") {
    const inbox = requiredOption(args, "--inbox");
    const limit = integerOption(args, "--limit", 20, 1, 100);
    const page = await client.listMessages({ inbox, limit, unread_only: hasFlag(args, "--unread") });
    writeResult(
      context,
      page,
      hasFlag(args, "--json"),
      (value) => value.items.map(formatMessageSummary).join("\n") || "No messages.",
    );
    return 0;
  }
  if (action === "get") {
    const id = positional(args.slice(1))[0];
    if (!id) throw new CliUsageError("message get requires a message id");
    const message = await client.getMessage(id);
    writeResult(context, message, hasFlag(args, "--json"), (value) => formatMessage(value, hasFlag(args, "--source")));
    return 0;
  }
  throw new CliUsageError("message requires list or get");
}

async function reviewCommand(args: string[], context: CliContext): Promise<number> {
  const action = args[0];
  const client = requireAuthentication(context).client;
  if (action === "status") {
    const id = positional(args.slice(1))[0];
    if (!id) throw new CliUsageError("review status requires a review id");
    const review = await client.getReview(id);
    writeResult(context, review, hasFlag(args, "--json"), formatReview);
    return 0;
  }
  if (action === "list") {
    const state = option(args, "--state") as Review["state"] | undefined;
    const limit = integerOption(args, "--limit", 20, 1, 100);
    const page = await client.listReviews({ state, limit });
    writeResult(
      context,
      page,
      hasFlag(args, "--json"),
      (value) => value.items.map((review) => `${review.id}\t${review.state}\t${review.proposed_subject}`).join("\n") || "No reviews.",
    );
    return 0;
  }
  throw new CliUsageError("review requires list or status");
}

async function sendCommand(args: string[], context: CliContext): Promise<number> {
  const inbox = requiredOption(args, "--inbox");
  const recipients = optionList(args, "--to");
  if (!recipients.length) throw new CliUsageError("send requires at least one --to recipient");
  const subject = requiredOption(args, "--subject");
  const text = requiredOption(args, "--text");
  const summary = requiredOption(args, "--summary");
  const clientId = option(args, "--client-id") ?? `cli-${randomUUID()}`;
  const client = requireAuthentication(context).client;

  await client.getInbox(inbox);
  const rules = await client.getRules();
  if (rules.items.length && !hasFlag(args, "--rules-reviewed")) {
    throw new CliUsageError(
      `${rules.items.length} writing rule(s) apply. Review and apply them through MCP, or rerun with --rules-reviewed after doing so.`,
    );
  }
  for (const recipient of recipients) {
    const suppression = await client.precheckSuppression(recipient);
    if (suppression.suppressed) throw new Error(`Recipient ${recipient} is suppressed; no message was submitted.`);
  }

  const result = await client.submitForReview({
    inbox,
    to: recipients,
    subject,
    text,
    mode: "review",
    intent: { summary },
    client_id: clientId,
  });
  context.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

function resolveAuthentication(context: CliContext): { client: ExtrovertClient; source: string } | undefined {
  const fromEnvironment = (context.env.EXTROVERT_API_KEY ?? "").trim();
  if (fromEnvironment) {
    return { client: clientForKey(fromEnvironment, context, context.env.EXTROVERT_API_BASE_URL), source: "EXTROVERT_API_KEY" };
  }
  const stored = context.store.load();
  if (!stored) return undefined;
  const env = { ...context.env, EXTROVERT_API_KEY: stored.agent_key, EXTROVERT_API_BASE_URL: stored.api_base_url };
  return { client: new ExtrovertClient(loadConfig(env), { credentialProvider: createLocalCredentialProvider(context.store, { apiBaseUrl: stored.api_base_url }) }), source: context.store.paths.credential };
}

function requireAuthentication(context: CliContext): { client: ExtrovertClient; source: string } {
  const auth = resolveAuthentication(context);
  if (!auth) throw new Error("No Extrovert credential for this profile. Run 'extrovert auth login' or redeem an enrollment key with 'extrovert enroll --agent-handle <name>'. Hosted sign-in credentials are managed by your MCP host.");
  return auth;
}

function clientForKey(key: string, context: CliContext, baseUrl?: string): ExtrovertClient {
  const env: NodeJS.ProcessEnv = { ...context.env, EXTROVERT_API_KEY: key };
  if (baseUrl?.trim()) env.EXTROVERT_API_BASE_URL = baseUrl.trim();
  return new ExtrovertClient(loadConfig(env));
}

function clientBaseUrl(key: string, context: CliContext, baseUrl?: string): string {
  const env: NodeJS.ProcessEnv = { ...context.env, EXTROVERT_API_KEY: key };
  if (baseUrl?.trim()) env.EXTROVERT_API_BASE_URL = baseUrl.trim();
  return loadConfig(env).apiBaseUrl;
}

function writeResult<T>(context: CliContext, value: T, json: boolean, format: (value: T) => string): void {
  context.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${format(value)}\n`);
}

function formatMessageSummary(message: Message): string {
  const unread = message.seen ? " " : "*";
  return `${unread} ${message.id}\t${message.date}\t${message.from.email}\t${message.subject}`;
}

function formatMessage(message: Message, source: boolean): string {
  const body = source ? message.text ?? message.html ?? "" : message.extracted_text ?? message.text ?? message.extracted_html ?? message.html ?? "";
  return [
    `From: ${message.from.name ? `${message.from.name} <${message.from.email}>` : message.from.email}`,
    `To: ${message.to.map((address) => address.email).join(", ")}`,
    `Subject: ${message.subject}`,
    `Date: ${message.date}`,
    `Message: ${message.id}`,
    "",
    body,
  ].join("\n");
}

function formatReview(review: Review): string {
  return [
    `Review: ${review.id}`,
    `State: ${review.state}`,
    `Closed: ${review.closed === undefined ? "unknown" : String(review.closed)}`,
    `Subject: ${review.sent_subject ?? review.proposed_subject}`,
    `Updated: ${review.updated_at}`,
    ...(review.sent_at ? [`Sent: ${review.sent_at}`] : []),
    ...(review.send_error ? [`Error: ${review.send_error}`] : []),
  ].join("\n");
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new CliUsageError(`${name} requires a value`);
  return value;
}

function requiredOption(args: string[], name: string): string {
  const value = option(args, name)?.trim();
  if (!value) throw new CliUsageError(`${name} is required`);
  return value;
}

function optionList(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new CliUsageError(`${name} requires a value`);
    values.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
  }
  return [...new Set(values)];
}

function integerOption(args: string[], name: string, fallback: number, min: number, max: number): number {
  const raw = option(args, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new CliUsageError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function positional(args: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value) continue;
    if (value.startsWith("--")) {
      if (!new Set(["--json", "--source", "--unread", "--rules-reviewed", "--with-token"]).has(value)) index++;
      continue;
    }
    values.push(value);
  }
  return values;
}

async function readSecret(context: CliContext, prompt: string, signal?: AbortSignal): Promise<string> {
  const input = context.stdin as NodeJS.ReadStream;
  if (signal?.aborted) throw new OAuthLoginError("cancelled", "Login cancelled.");
  if (!input.isTTY || typeof input.setRawMode !== "function") return readLine(context.stdin, signal);
  context.stderr.write(prompt);
  return new Promise<string>((resolve, reject) => {
    const characters: string[] = [];
    const wasRaw = input.isRaw;
    const onData = (chunk: Buffer | string) => {
      for (const character of String(chunk)) {
        if (character === "\u0003" || character === "\u0004") {
          cleanup();
          reject(new Error("Cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          context.stderr.write("\n");
          resolve(characters.join("").trim());
          return;
        }
        if (character === "\u007f" || character === "\b") characters.pop();
        else characters.push(character);
        if (characters.length > 8192) { cleanup(); reject(new Error("Credential input is too long")); return; }
      }
    };
    const cleanup = () => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("close", onEnd);
      input.off("error", onError);
      signal?.removeEventListener("abort", onAbort);
      input.setRawMode?.(wasRaw ?? false);
      input.pause();
    };
    const onEnd = () => { cleanup(); reject(new Error("Credential input ended before Enter")); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onAbort = () => { cleanup(); reject(new OAuthLoginError("cancelled", "Login cancelled.")); };
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("close", onEnd);
    input.once("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function readVisibleLine(context: CliContext, prompt: string): Promise<string> {
  context.stderr.write(prompt);
  return readLine(context.stdin);
}

function readLine(stream: Readable, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new OAuthLoginError("cancelled", "Login cancelled.")); return; }
    let text = "";
    const cleanup = () => { stream.off("data", onData); stream.off("end", onEnd); stream.off("error", onError); signal?.removeEventListener("abort", onAbort); stream.pause(); };
    const onEnd = () => { cleanup(); resolve(text.trim()); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onAbort = () => { cleanup(); reject(new OAuthLoginError("cancelled", "Login cancelled.")); };
    const onData = (chunk: Buffer | string) => {
      text += String(chunk);
      if (text.length > 8192) { onError(new Error("Input is too long")); return; }
      const end = text.search(/[\r\n]/);
      if (end >= 0) { text = text.slice(0, end); onEnd(); }
    };
    stream.on("data", onData); stream.once("end", onEnd); stream.once("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    stream.resume();
  });
}

function renderError(error: unknown): string {
  if (error instanceof ExtrovertApiError) {
    const code = error.code ? ` [${error.code}]` : "";
    const request = error.details && typeof error.details === "object" && "request_id" in error.details
      ? ` request ${(error.details as { request_id?: unknown }).request_id ?? ""}`
      : "";
    return `Extrovert API error${code}: ${error.message}${request}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function cleanCommandError(value: string | Buffer | null | undefined): string {
  return value ? String(value).trim() : "";
}

function isMissingExecutable(error: Error): boolean {
  return "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}
