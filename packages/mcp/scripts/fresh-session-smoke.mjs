#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const configDirectory = mkdtempSync(join(tmpdir(), "extrovert-fresh-session-"));
const calls = [];
const api = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  calls.push({ path: url.pathname, authorization: request.headers.authorization });
  response.setHeader("content-type", "application/json");

  if (url.pathname === "/v1/agent/sign-up") return json(response, 201, signupResponse());
  if (url.pathname === "/v1/agent/verify") {
    assert.equal(request.headers.authorization, "Bearer pk_agent_proj_smoke_limited");
    return json(response, 200, verifyResponse());
  }
  if (url.pathname === "/v1/auth/me") {
    assert.equal(request.headers.authorization, "Bearer pk_agent_proj_smoke_full");
    return json(response, 200, whoamiResponse());
  }
  if (url.pathname === "/v1/inboxes/extrovert%40extrovertmail.com/messages") {
    assert.equal(request.headers.authorization, "Bearer pk_agent_proj_smoke_full");
    return json(response, 200, { items: [messageResponse()], total: 1 });
  }
  if (url.pathname === "/v1/messages/msg_smoke_reply") return json(response, 200, messageResponse());
  if (url.pathname === "/v1/reviews/rr_smoke") return json(response, 200, reviewResponse());
  return json(response, 404, { code: "not_found", detail: url.pathname });
});

await new Promise((resolveListen) => api.listen(0, "127.0.0.1", resolveListen));
try {
  const address = api.address();
  assert.ok(address && typeof address === "object");
  const childEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry) => typeof entry[1] === "string"),
  );
  childEnv.EXTROVERT_CONFIG_DIR = configDirectory;
  childEnv.EXTROVERT_API_BASE_URL = `http://127.0.0.1:${address.port}`;

  const first = await connect(childEnv);
  try {
    const signup = await first.client.callTool({
      name: "sign_up",
      arguments: { human_email: "human@example.test", username: "extrovert" },
    });
    assert.notEqual(signup.isError, true);
    const verify = await first.client.callTool({ name: "verify_signup", arguments: { otp: "528698" } });
    assert.notEqual(verify.isError, true);
  } finally {
    await first.client.close();
  }

  const credentialPath = join(configDirectory, "credentials.json");
  if (process.platform !== "win32") assert.equal(statSync(credentialPath).mode & 0o777, 0o600);

  const second = await connect(childEnv);
  try {
    const me = await second.client.callTool({ name: "whoami", arguments: {} });
    assert.match(toolText(me), /pagt_smoke/);

    const messages = await second.client.callTool({
      name: "read_messages",
      arguments: { inbox: "extrovert@extrovertmail.com", limit: 20, unread_only: false },
    });
    assert.match(toolText(messages), /msg_smoke_reply/);

    const message = await second.client.callTool({
      name: "get_message",
      arguments: { id: "msg_smoke_reply", format: "text", variant: "extracted" },
    });
    assert.match(toolText(message), /poem about email and agents/);

    const review = await second.client.callTool({ name: "get_review", arguments: { id: "rr_smoke" } });
    assert.match(toolText(review), /\[sent\]/);
  } finally {
    await second.client.close();
  }

  assert.ok(calls.some((call) => call.path === "/v1/auth/me" && call.authorization === "Bearer pk_agent_proj_smoke_full"));
  process.stdout.write("fresh-session MCP smoke passed: signup → verify → restart → whoami/read/review\n");
} finally {
  await new Promise((resolveClose, reject) => api.close((error) => (error ? reject(error) : resolveClose())));
}

async function connect(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/bin.js")],
    cwd: process.cwd(),
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "extrovert-fresh-session-smoke", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

function toolText(result) {
  return (result.content ?? []).filter((item) => item.type === "text").map((item) => item.text).join("\n");
}

function json(response, status, body) {
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

function signupResponse() {
  return {
    customer_id: "cus_smoke",
    agent_id: "pagt_smoke",
    agent_key: "pk_agent_proj_smoke_limited",
    scopes: ["mailbox:read"],
    address: "extrovert@extrovertmail.com",
    verified: false,
    otp_sent_to: "human@example.test",
    otp_expires_at: "2026-09-01T00:15:00Z",
    message: "sent",
  };
}

function verifyResponse() {
  return {
    agent_id: "pagt_smoke",
    agent_key: "pk_agent_proj_smoke_full",
    scopes: ["mailbox:create", "mailbox:read", "mailbox:send", "webhook:write"],
    address: "extrovert@extrovertmail.com",
    verified: true,
    message: "verified",
    mailbox_quickstart: {
      inbox: "extrovert@extrovertmail.com",
      list_mail: { tool: "read_messages", arguments: { inbox: "extrovert@extrovertmail.com" } },
      read_message: { tool: "get_message", arguments: { id: "<message_id>" } },
      wait_for_mail: { tool: "wait_for_email", arguments: { inbox: "extrovert@extrovertmail.com" } },
    },
  };
}

function whoamiResponse() {
  return {
    customer_id: "cus_smoke",
    org_id: "org_smoke",
    project_id: "prj_smoke",
    tier: "project",
    agent_id: "pagt_smoke",
    key_id: "pkey_smoke",
    scopes: ["mailbox:create", "mailbox:read", "mailbox:send", "webhook:write"],
  };
}

function messageResponse() {
  return {
    id: "msg_smoke_reply",
    thread_id: "thr_smoke",
    inbox: "extrovert@extrovertmail.com",
    direction: "inbound",
    from: { email: "admin@example.test" },
    to: [{ email: "extrovert@extrovertmail.com" }],
    subject: "Re: Hello",
    text: "Write me a little poem about email and agents.",
    extracted_text: "Write me a little poem about email and agents.",
    date: "2026-08-31T21:04:12Z",
    message_id: "<smoke@example.test>",
    seen: false,
    folder: "INBOX",
  };
}

function reviewResponse() {
  return {
    id: "rr_smoke",
    state: "sent",
    mode: "review",
    effective_mode: "review",
    kind: "send",
    from_address: "extrovert@extrovertmail.com",
    agent_id: "pagt_smoke",
    intent_summary: "say hello",
    revision: 1,
    version: 2,
    proposed_subject: "Hello",
    proposed_body_text: "Hello!",
    proposed_to: ["admin@example.test"],
    closed: true,
    created_at: "2026-08-31T21:00:00Z",
    updated_at: "2026-08-31T21:03:26Z",
    sent_at: "2026-08-31T21:03:26Z",
  };
}
