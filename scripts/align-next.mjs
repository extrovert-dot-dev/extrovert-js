#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const registry = "https://registry.npmjs.org";
const packages = ["@extrovert.dev/sdk", "@extrovert.dev/mcp"];
const escaped = (name) => name.replace("/", "%2f");

// Never include authentication responses or credentials in errors/logs.
async function request(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(30000) });
  } catch {
    throw new Error("Registry/identity request failed or timed out");
  }
  if (!response.ok) throw new Error(`Request rejected (HTTP ${response.status})`);
  return response;
}

async function credentials(name) {
  if (process.env.GITHUB_REPOSITORY !== "extrovert-dot-dev/extrovert-js" ||
      process.env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("Trusted credentials require extrovert-js main");
  }
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set("audience", "npm:registry.npmjs.org");
  const identity = await (await request(url, {
    headers: { Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
  })).json();
  if (!identity.value) throw new Error("Identity response missing token");
  const exchange = await (await request(`${registry}/-/npm/v1/oidc/token/exchange/package/${encodeURIComponent(name)}`, {
    method: "POST", headers: { Authorization: `Bearer ${identity.value}` },
  })).json();
  if (!exchange.token) throw new Error("Exchange response missing token");
  return exchange.token;
}

const read = async (name) => (await request(`${registry}/${escaped(name)}`, {
  headers: { "Cache-Control": "no-cache" },
})).json();
const write = async (name, version, token) => {
  await request(`${registry}/-/package/${escaped(name)}/dist-tags/next`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(version),
  });
};

export async function alignNext({ version, tag, readPackage = read, getToken = credentials, writeTag = write }) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || tag !== "next") {
    throw new Error("Alignment requires an exact stable version and tag next");
  }
  function inspect(data) {
    const tags = data["dist-tags"];
    const integrity = data.versions?.[version]?.dist?.integrity;
    if (tags?.latest !== version || !integrity ||
        !(tags.next === version || tags.next?.startsWith(`${version}-`))) {
      throw new Error("Refusing alignment: latest, next or target artifact changed");
    }
    return { tags: { ...tags }, integrity };
  }
  const before = new Map();
  for (const name of packages) before.set(name, inspect(await readPackage(name)));
  const tokens = new Map();
  // Authorize both packages before changing either one.
  for (const name of packages) {
    if (before.get(name).tags.next !== version) tokens.set(name, await getToken(name));
  }
  for (const name of packages) {
    const original = before.get(name);
    const current = inspect(await readPackage(name));
    if (current.integrity !== original.integrity || current.tags.next !== original.tags.next) {
      throw new Error(`${name}: concurrent registry change; stopped`);
    }
    if (current.tags.next !== version) await writeTag(name, version, tokens.get(name));
  }
  for (const name of packages) {
    const after = inspect(await readPackage(name));
    const original = before.get(name);
    if (after.tags.next !== version || after.integrity !== original.integrity ||
        JSON.stringify(Object.entries(after.tags).filter(([tag]) => tag !== "next").sort()) !==
        JSON.stringify(Object.entries(original.tags).filter(([tag]) => tag !== "next").sort())) {
      throw new Error(`${name}: verification failed; inspect registry before retrying`);
    }
    console.log(`${name}: latest=${version}, next=${version}; artifact unchanged`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  alignNext({ version: process.env.EXPECTED_VERSION, tag: process.env.DIST_TAG }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
