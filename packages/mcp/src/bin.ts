#!/usr/bin/env node
/**
 * Extrovert MCP server CLI entrypoint.
 *
 *   extrovert-mcp            # stdio transport (default; for local MCP hosts)
 *   extrovert-mcp --http     # hosted Streamable HTTP transport
 *   extrovert-mcp --http --port 9000
 *
 * Configuration is read from the environment (see config.ts):
 *   EXTROVERT_API_BASE_URL, EXTROVERT_API_KEY, EXTROVERT_MOCK, ...
 */

import { runHttp } from "./http.js";
import { runStdio } from "./stdio.js";

interface CliArgs {
  http: boolean;
  port?: number;
  host?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { http: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--http":
      case "--hosted":
        args.http = true;
        break;
      case "--stdio":
        args.http = false;
        break;
      case "--port": {
        const next = argv[++i];
        if (next) args.port = Number.parseInt(next, 10);
        break;
      }
      case "--host": {
        const next = argv[++i];
        if (next) args.host = next;
        break;
      }
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        // Ignore unknown flags so MCP hosts can pass extras harmlessly.
        break;
    }
  }
  return args;
}

const HELP = `extrovert-mcp — MCP server for Extrovert (a real mailbox for your agent, in one call)

Usage:
  extrovert-mcp [--http] [--port <n>] [--host <addr>]

Transports:
  (default)     stdio — for Claude Desktop, Claude Code, Cursor, and other local hosts
  --http        hosted Streamable HTTP transport at POST /mcp (default port 8787)

Environment:
  EXTROVERT_API_BASE_URL   Base URL of the Extrovert REST API (default https://api.extrovert.dev)
  EXTROVERT_API_KEY        Scoped agent key (pk_agent_…) or enrollment key (pk_enroll_…)
  EXTROVERT_MOCK           Set to 1 to force offline fixture mode
  PORT / HOST            Override --http bind (also honored by hosting platforms)

Tools: redeem_enrollment, create_inbox, list_inboxes, get_inbox, update_inbox, delete_inbox,
       send_email, reply_email, read_messages, list_threads, search, wait_for_email
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args.http) {
    const opts: { port?: number; host?: string } = {};
    if (args.port !== undefined) opts.port = args.port;
    if (args.host !== undefined) opts.host = args.host;
    await runHttp(opts);
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  process.stderr.write(`extrovert-mcp: fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
