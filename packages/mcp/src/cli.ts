import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";

import { ExtrovertApiError, ExtrovertClient } from "./client.js";
import { loadConfig } from "./config.js";
import { createCredentialStore, type CredentialStore } from "./credentials.js";
import type { Message, Review, WhoAmI } from "./types.js";

const MCP_PACKAGE = "@extrovert.dev/mcp@next";

export const CLI_HELP = `extrovert — setup, authenticate, and use Extrovert without custom transport code

Usage:
  extrovert setup [--host codex|claude]
  extrovert auth login --with-token
  extrovert auth status
  extrovert auth logout
  extrovert signup --human-email <email> [--username <name>]
  extrovert verify [--otp <code>]
  extrovert whoami [--json]
  extrovert inbox list [--limit <n>] [--json]
  extrovert message list --inbox <address> [--unread] [--limit <n>] [--json]
  extrovert message get <message-id> [--source] [--json]
  extrovert review list [--state <state>] [--limit <n>] [--json]
  extrovert review status <review-id> [--json]
  extrovert send --inbox <address> --to <email> --subject <text> --text <body>
                 --summary <reviewer-intent> [--client-id <id>] [--rules-reviewed]

Authentication:
  signup stores only a short-lived pending key; verify atomically replaces it with
  the full key in a permission-restricted local credential file. EXTROVERT_API_KEY
  always takes precedence over the stored credential.

MCP transport:
  Running extrovert-mcp with no command starts stdio. The official plugin and
  'extrovert setup' configure that published server directly.
`;

export interface CliOptions {
  env?: NodeJS.ProcessEnv;
  stdin?: NodeJS.ReadStream | Readable;
  stdout?: NodeJS.WriteStream | Writable;
  stderr?: NodeJS.WriteStream | Writable;
  credentialStore?: CredentialStore;
  runCommand?: (command: string, args: string[]) => SpawnSyncReturns<string>;
}

interface CliContext {
  env: NodeJS.ProcessEnv;
  stdin: NodeJS.ReadStream | Readable;
  stdout: NodeJS.WriteStream | Writable;
  stderr: NodeJS.WriteStream | Writable;
  store: CredentialStore;
  runCommand: (command: string, args: string[]) => SpawnSyncReturns<string>;
}

export async function runCli(argv: string[], options: CliOptions = {}): Promise<number> {
  const env = options.env ?? process.env;
  const context: CliContext = {
    env,
    stdin: options.stdin ?? process.stdin,
    stdout: options.stdout ?? process.stdout,
    stderr: options.stderr ?? process.stderr,
    store: options.credentialStore ?? createCredentialStore(env),
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
    switch (command) {
      case "setup":
        return setupCommand(argv.slice(1), context);
      case "auth":
        return authCommand(argv.slice(1), context);
      case "signup":
        return signupCommand(argv.slice(1), context);
      case "verify":
        return verifyCommand(argv.slice(1), context);
      case "whoami":
        return whoamiCommand(argv.slice(1), context);
      case "inbox":
        return inboxCommand(argv.slice(1), context);
      case "message":
        return messageCommand(argv.slice(1), context);
      case "review":
        return reviewCommand(argv.slice(1), context);
      case "send":
        return sendCommand(argv.slice(1), context);
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

function setupCommand(args: string[], context: CliContext): number {
  const host = option(args, "--host") ?? "codex";
  if (!new Set(["codex", "claude"]).has(host)) {
    throw new CliUsageError("--host must be codex or claude");
  }
  const executable = host;
  const existing = context.runCommand(executable, ["mcp", "get", "extrovert", ...(host === "codex" ? ["--json"] : [])]);
  if (existing.error && isMissingExecutable(existing.error)) {
    throw new Error(`${host} is not installed or not on PATH`);
  }
  if (existing.status === 0) {
    context.stdout.write(`Extrovert MCP is already configured for ${host}. Start a new session to load it.\n`);
    return 0;
  }

  const added = context.runCommand(executable, ["mcp", "add", "extrovert", "--", "npx", "-y", MCP_PACKAGE]);
  if (added.error) throw added.error;
  if (added.status !== 0) {
    throw new Error(cleanCommandError(added.stderr) || `Could not configure Extrovert MCP for ${host}`);
  }
  context.stdout.write(`Configured Extrovert MCP for ${host}. Start a new session, then call sign_up or whoami.\n`);
  return 0;
}

async function authCommand(args: string[], context: CliContext): Promise<number> {
  const action = args[0];
  switch (action) {
    case "login": {
      if (!hasFlag(args, "--with-token")) {
        throw new CliUsageError("auth login requires --with-token; the key is read from EXTROVERT_API_KEY or a hidden stdin prompt");
      }
      const token = (context.env.EXTROVERT_API_KEY ?? "").trim() || (await readSecret(context, "Agent key: "));
      if (!token.startsWith("pk_agent_")) throw new CliUsageError("Expected a scoped pk_agent_… key");
      const client = clientForKey(token, context, context.env.EXTROVERT_API_BASE_URL);
      const me = await client.whoami();
      context.store.save(token, clientBaseUrl(token, context, context.env.EXTROVERT_API_BASE_URL));
      context.stdout.write(`Authenticated agent ${me.agent_id}; credential saved at ${context.store.paths.credential}.\n`);
      return 0;
    }
    case "status": {
      const auth = resolveAuthentication(context);
      if (!auth) {
        context.stdout.write("Not authenticated. Run 'extrovert signup' or 'extrovert auth login --with-token'.\n");
        return 1;
      }
      const me = await auth.client.whoami();
      context.stdout.write(`Authenticated via ${auth.source}.\n${formatWhoAmI(me)}\n`);
      return 0;
    }
    case "logout": {
      const removed = context.store.clear();
      context.store.clearPendingSignup();
      context.stdout.write(removed ? "Removed the stored Extrovert credential.\n" : "No stored Extrovert credential was present.\n");
      return 0;
    }
    default:
      throw new CliUsageError("auth requires login, status, or logout");
  }
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
    otp_expires_at: result.otp_expires_at,
    api_base_url: config.apiBaseUrl,
  });
  context.stdout.write(
    `Verification code sent to ${result.otp_sent_to}.\nInbox: ${result.address}\nPending credential saved securely; run 'extrovert verify'.\n`,
  );
  return 0;
}

async function verifyCommand(args: string[], context: CliContext): Promise<number> {
  const pending = context.store.loadPendingSignup();
  if (!pending) throw new Error("No pending signup. Run 'extrovert signup --human-email <email>' first.");
  const otp = option(args, "--otp") ?? (await readVisibleLine(context, "Verification code: "));
  if (!otp.trim()) throw new CliUsageError("Verification code cannot be empty");
  const client = clientForKey(pending.agent_key, context, pending.api_base_url);
  const result = await client.verify({ otp: otp.trim() });
  try {
    context.store.save(result.agent_key, pending.api_base_url);
  } catch (error) {
    context.stdout.write(`${JSON.stringify({ agent_key: result.agent_key, address: result.address, scopes: result.scopes })}\n`);
    throw new Error(`Verification succeeded, but durable credential storage failed. The replacement key was printed once above. ${renderError(error)}`);
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

async function inboxCommand(args: string[], context: CliContext): Promise<number> {
  if (args[0] !== "list") throw new CliUsageError("inbox requires list");
  const limit = integerOption(args, "--limit", 20, 1, 100);
  const page = await requireAuthentication(context).client.listInboxes({ limit });
  writeResult(
    context,
    page,
    hasFlag(args, "--json"),
    (value) => value.items.map((inbox) => `${inbox.address}\t${inbox.status}\t${inbox.id}`).join("\n") || "No inboxes.",
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
  return { client: clientForKey(stored.agent_key, context, stored.api_base_url), source: context.store.paths.credential };
}

function requireAuthentication(context: CliContext): { client: ExtrovertClient; source: string } {
  const auth = resolveAuthentication(context);
  if (!auth) throw new Error("No Extrovert credential. Run 'extrovert signup' or 'extrovert auth login --with-token'.");
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

function formatWhoAmI(me: WhoAmI): string {
  return [
    `Agent: ${me.agent_id}`,
    `Org: ${me.org_id || "(none)"}`,
    `Project: ${me.project_id || "(none)"}`,
    `Key: ${me.key_id}`,
    `Scopes: ${me.scopes.join(", ") || "(none)"}`,
  ].join("\n");
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

async function readSecret(context: CliContext, prompt: string): Promise<string> {
  const input = context.stdin as NodeJS.ReadStream;
  if (!input.isTTY || typeof input.setRawMode !== "function") return readAll(context.stdin);
  context.stderr.write(prompt);
  return new Promise<string>((resolve, reject) => {
    const characters: string[] = [];
    const wasRaw = input.isRaw;
    const onData = (chunk: Buffer | string) => {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
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
      }
    };
    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode?.(wasRaw ?? false);
      input.pause();
    };
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function readVisibleLine(context: CliContext, prompt: string): Promise<string> {
  context.stderr.write(prompt);
  const value = await readAll(context.stdin);
  return value.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8").trim();
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
