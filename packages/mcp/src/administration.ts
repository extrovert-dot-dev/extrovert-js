/** Customer administration through an explicitly approved full-control connection.
 * Source of this runtime: sdk/ts/src/administration.ts. The contract generator
 * copies it into the independently published MCP package.
 */
import { administrativeCatalog, administrativeSchemas } from "./administration.generated.js";
import type { AdministrativeOperations } from "./administration.generated.js";

export type { AdministrativeOperations, AdministrativeDownload } from "./administration.generated.js";
export type AdministrativeActionID = keyof AdministrativeOperations;
export type AdministrativeMode = "read" | "change";
type Schema = Record<string, unknown>;
export interface AdministrativeInput {
  path?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
}
export interface AdministrativeRequest {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  responseFormat: "json" | "binary";
  signal?: AbortSignal;
}
export interface AdministrativeActionSummary {
  id: AdministrativeActionID;
  summary: string;
  method: AdministrativeRequest["method"];
  mode: AdministrativeMode;
}
interface Action extends Omit<AdministrativeActionSummary, "mode"> {
  path: string;
  description?: string | null;
  inputSchema: Schema;
  responseFormat: AdministrativeRequest["responseFormat"];
}
const actions = administrativeCatalog as unknown as Action[];
const schemas = administrativeSchemas as unknown as Record<string, Schema>;
const owns = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);
const summary = (a: Action): AdministrativeActionSummary => ({ id: a.id, summary: a.summary, method: a.method, mode: a.method === "GET" ? "read" : "change" });

/** Local discovery never grants authority. Every execution is authorized and
 * attributed by the API, using the current connection and current human roles. */
export class Administration {
  constructor(private readonly execute: (request: AdministrativeRequest) => Promise<unknown>) {}

  list(options: { search?: string; mode?: AdministrativeMode; limit?: number; cursor?: string } = {}) {
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be between 1 and 100");
    const search = options.search?.trim().toLowerCase() ?? "";
    if (search.length > 200) throw new Error("search must be at most 200 characters");
    const prefix = encodeURIComponent(`${search}\n${options.mode ?? ""}`) + ":";
    let offset = 0;
    if (options.cursor !== undefined) {
      if (!options.cursor.startsWith(prefix) || !/^\d+$/.test(options.cursor.slice(prefix.length))) throw new Error("Invalid catalog cursor; keep the same search and mode");
      offset = Number(options.cursor.slice(prefix.length));
      if (!Number.isSafeInteger(offset)) throw new Error("Invalid catalog cursor");
    }
    const matched = actions.filter((a) => (!options.mode || summary(a).mode === options.mode) && `${a.id} ${a.summary} ${a.path}`.toLowerCase().includes(search));
    const data = matched.slice(offset, offset + limit).map(summary);
    const hasMore = offset + data.length < matched.length;
    return { object: "list" as const, data, has_more: hasMore, next_cursor: hasMore ? `${prefix}${offset + data.length}` : null };
  }

  describe(id: string) {
    const a = this.action(id);
    const definitions: Record<string, Schema> = {};
    const rewrite = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (!value || typeof value !== "object") return value;
      const object = value as Schema;
      if (typeof object.$ref === "string") {
        const name = object.$ref.replace("#/components/schemas/", "");
        if (!owns(schemas, name)) throw new Error(`Unknown administrative schema ${name}`);
        if (!owns(definitions, name)) { definitions[name] = {}; definitions[name] = rewrite(schemas[name]) as Schema; }
        return { $ref: `#/$defs/${name}` };
      }
      return Object.fromEntries(Object.entries(object).map(([key, child]) => [key, rewrite(child)]));
    };
    const inputSchema = rewrite(a.inputSchema) as Schema;
    return { ...summary(a), description: a.description ?? a.summary, input_schema: { ...inputSchema, $defs: definitions },
      required_authority: "Explicit full account control (account:admin); current human customer-admin authority. Private platform access is excluded.",
      result_format: a.responseFormat === "binary" ? "Base64 content with content_type and optional filename" : "API response JSON; list cursors are opaque",
      credential_lifetime: "Created credentials survive independently, including administrative credentials; revoke them separately." };
  }

  /** Typed SDK execution. MCP/CLI use run with an explicit read/change mode. */
  call<K extends AdministrativeActionID>(id: K, input: AdministrativeOperations[K]["input"], signal?: AbortSignal): Promise<AdministrativeOperations[K]["output"]> {
    return this.run(id, input as AdministrativeInput, undefined, signal) as Promise<AdministrativeOperations[K]["output"]>;
  }

  async run(id: string, input: AdministrativeInput = {}, mode?: AdministrativeMode, signal?: AbortSignal): Promise<unknown> {
    const a = this.action(id);
    if (mode && summary(a).mode !== mode) throw new Error(`${id} is a ${summary(a).mode} action; use the ${summary(a).mode} tool/command`);
    // Bound data before recursive validation or any network request.
    if (JSON.stringify(input).length > 1_000_000) throw new Error("Administrative input exceeds 1 MB");
    validate(a.inputSchema, input, "input");
    const path = a.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
      const value = input.path?.[name];
      if (typeof value !== "string" || value.length === 0 || value.length > 1024 || /[/\\\u0000-\u001f]/.test(value) || value === "." || value === "..") throw new Error(`Invalid path.${name}`);
      return encodeURIComponent(value);
    });
    return this.execute({ method: a.method, path, query: input.query, body: input.body, responseFormat: a.responseFormat, signal });
  }

  private action(id: string): Action {
    const action = actions.find((a) => a.id === id);
    if (!action) throw new Error(`Unknown administrative action ${id}; search the action catalog first`);
    return action;
  }
}

function validate(s: Schema, value: unknown, at: string, depth = 0): void {
  if (depth > 64) throw new Error(`${at}: input nesting is too deep`);
  const fail = (message: string): never => { throw new Error(`${at}: ${message}`); };
  if (value === null && s.nullable === true) return;
  if (typeof s.$ref === "string") {
    const name = s.$ref.replace("#/components/schemas/", "");
    if (!owns(schemas, name)) fail("unknown schema");
    return validate(schemas[name]!, value, at, depth + 1);
  }
  if (Array.isArray(s.enum) && !s.enum.includes(value)) fail(`expected one of ${s.enum.join(", ")}`);
  if (Array.isArray(s.allOf)) for (const child of s.allOf) validate(child as Schema, value, at, depth + 1);
  for (const key of ["oneOf", "anyOf"]) {
    if (!Array.isArray(s[key])) continue;
    let matches = 0;
    for (const child of s[key]) { try { validate(child as Schema, value, at, depth + 1); matches++; } catch { /* Try the next documented alternative. */ } }
    if (matches === 0 || (key === "oneOf" && matches !== 1)) fail(`must match ${key === "oneOf" ? "exactly one" : "an"} allowed schema`);
  }
  if (s.type === "object" || s.properties) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected an object");
    const object = value as Record<string, unknown>;
    const properties = (s.properties ?? {}) as Record<string, Schema>;
    for (const key of (s.required ?? []) as string[]) if (!owns(object, key) || object[key] === undefined) fail(`missing ${key}`);
    for (const [key, child] of Object.entries(object)) {
      if (child === undefined) continue;
      if (owns(properties, key)) validate(properties[key]!, child, `${at}.${key}`, depth + 1);
      else if (s.additionalProperties === false) fail(`unknown field ${key}`);
      else if (s.additionalProperties && typeof s.additionalProperties === "object") validate(s.additionalProperties as Schema, child, `${at}.${key}`, depth + 1);
    }
  } else if (s.type === "array") {
    if (!Array.isArray(value)) fail("expected an array");
    const array = value as unknown[];
    if (typeof s.minItems === "number" && array.length < s.minItems) fail(`requires at least ${s.minItems} items`);
    if (typeof s.maxItems === "number" && array.length > s.maxItems) fail(`allows at most ${s.maxItems} items`);
    for (const child of array) validate((s.items ?? {}) as Schema, child, at + "[]", depth + 1);
  } else if (s.type === "string") {
    if (typeof value !== "string") fail("expected a string");
    const text = value as string;
    if (typeof s.minLength === "number" && text.length < s.minLength) fail(`requires at least ${s.minLength} characters`);
    if (typeof s.maxLength === "number" && text.length > s.maxLength) fail(`allows at most ${s.maxLength} characters`);
  } else if (s.type === "integer" || s.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || (s.type === "integer" && !Number.isInteger(value))) fail(`expected a ${s.type}`);
    if (typeof s.minimum === "number" && (value as number) < s.minimum) fail(`minimum is ${s.minimum}`);
    if (typeof s.maximum === "number" && (value as number) > s.maximum) fail(`maximum is ${s.maximum}`);
  } else if (s.type === "boolean" && typeof value !== "boolean") fail("expected a boolean");
}
