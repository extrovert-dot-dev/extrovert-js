#!/usr/bin/env node
/**
 * Extrovert MCP + CLI entrypoint.
 *
 *   extrovert-mcp                         # stdio transport for MCP hosts
 *   extrovert-mcp --http --port 9000      # hosted Streamable HTTP
 *   extrovert setup --host codex          # register the packaged stdio server
 *   extrovert signup / verify / message…  # supported CLI fallback
 */

import { CLI_HELP, runCli } from "./cli.js";
import { runHttp } from "./http.js";
import { runStdio } from "./stdio.js";

interface TransportArgs {
  http: boolean;
  port?: number;
  host?: string;
}

const CLI_COMMANDS = new Set([
  "setup",
  "auth",
  "signup",
  "verify",
  "whoami",
  "inbox",
  "message",
  "review",
  "send",
  "help",
]);

const TRANSPORT_HELP = `
MCP transports:
  extrovert-mcp                  stdio (default for local hosts)
  extrovert-mcp --http           Streamable HTTP at /mcp (default port 8787)
  extrovert-mcp --http --port N  override the HTTP port

Environment:
  EXTROVERT_API_BASE_URL   API URL (default https://api.extrovert.dev)
  EXTROVERT_API_KEY        scoped agent key; overrides the stored credential
  EXTROVERT_CONFIG_DIR     override the permission-restricted credential directory
  EXTROVERT_MOCK           set to 1 for offline fixtures
`;

function parseTransportArgs(argv: string[]): TransportArgs {
  const args: TransportArgs = { http: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    switch (arg) {
      case "--http":
      case "--hosted":
        args.http = true;
        break;
      case "--stdio":
        args.http = false;
        break;
      case "--port": {
        const next = argv[++index];
        if (!next) throw new Error("--port requires a value");
        const port = Number(next);
        if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("--port must be from 1 to 65535");
        args.port = port;
        break;
      }
      case "--host": {
        const next = argv[++index];
        if (!next) throw new Error("--host requires a value");
        args.host = next;
        break;
      }
      default:
        // Retain compatibility with MCP hosts that append harmless flags.
        break;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const first = argv[0];
  if (first === "--help" || first === "-h") {
    process.stdout.write(`${CLI_HELP}${TRANSPORT_HELP}`);
    return;
  }
  if (first && CLI_COMMANDS.has(first)) {
    process.exitCode = await runCli(argv);
    return;
  }

  const args = parseTransportArgs(argv);
  if (args.http) {
    const options: { port?: number; host?: string } = {};
    if (args.port !== undefined) options.port = args.port;
    if (args.host !== undefined) options.host = args.host;
    await runHttp(options);
    return;
  }
  await runStdio();
}

main().catch((error) => {
  process.stderr.write(`extrovert: fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
