// Issue #4294 — Meta Ads through the Graph (Marketing) API.
//
// Meta's ads MCP server accepts only a person's own Facebook sign-in, so a
// company system-user token stored in Vault is refused there. The same token
// works against the plain Graph API on graph.facebook.com. This file is the
// REST adapter that minglaConnectorProxy.ts promised: it implements
// UpstreamTransport with a fixed set of read-only tools, each one a GET.
//
// Rules kept here (I-4294-6, I-4294-7, I-4294-8):
//   * The key is sent only as `Authorization: Bearer <key>`. It is never put
//     in an address, and an `access_token` Meta writes into a next-page
//     address is taken out before that address is used.
//   * A redirect is never followed, and a next page is followed only while it
//     stays on https://graph.facebook.com under the row's API version, at
//     most MAX_GRAPH_PAGES pages per call.
//   * Every id, enum, date and field is checked before any request. A bad
//     input is answered as a tool error and never reaches Meta.
//   * Errors map the way McpHttpTransport maps them: a refused or expired
//     token (HTTP 401/403, Graph codes 190, 102, 10, 200-299) is
//     upstream_key_rejected with none of Meta's words; a timeout, a too-large
//     answer and a 5xx keep their own tokens.
//   * The key is scrubbed from everything returned (and the proxy scrubs it
//     again).
//
// Only a row whose address host is exactly graph.facebook.com is routed
// here (UpstreamRouter); every other row stays on MCP over HTTP.

import {
  CALL_TIMEOUT_MS,
  type FetchLike,
  MAX_UPSTREAM_BYTES,
  McpHttpTransport,
  readCapped,
  scrubText,
  type UpstreamCallResult,
  UpstreamError,
  type UpstreamTarget,
  type UpstreamTool,
  type UpstreamTransport,
  upstreamUrlAllowed,
} from "./minglaConnectorProxy.ts";

export const META_GRAPH_HOST = "graph.facebook.com";
export const DEFAULT_GRAPH_VERSION = "v23.0";
export const MAX_GRAPH_PAGES = 3;
export const MAX_GRAPH_LIMIT = 100;
export const DEFAULT_GRAPH_LIMIT = 25;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** True only for an allowed upstream address whose host is exactly graph.facebook.com. */
export function isMetaGraphUrl(url: string): boolean {
  if (typeof url !== "string" || !upstreamUrlAllowed(url)) return false;
  try {
    return new URL(url).hostname === META_GRAPH_HOST;
  } catch (_err) {
    return false;
  }
}

/**
 * The API root for a row: `https://graph.facebook.com/<version>`. The row's
 * path is the version (`/v23.0`); no path means DEFAULT_GRAPH_VERSION. Any
 * other path is refused (null).
 */
export function graphBase(url: string): string | null {
  if (!isMetaGraphUrl(url)) return null;
  const path = new URL(url).pathname.replace(/\/+$/, "");
  if (path === "") return `https://${META_GRAPH_HOST}/${DEFAULT_GRAPH_VERSION}`;
  if (/^\/v\d{1,2}\.\d{1,2}$/.test(path)) return `https://${META_GRAPH_HOST}${path}`;
  return null;
}

// ---------------------------------------------------------------------------
// Inputs.
// ---------------------------------------------------------------------------

class ArgError extends Error {}

const ID = /^\d{1,25}$/;
const ACT_ID = /^act_\d{1,25}$/;

export const DATE_PRESETS: readonly string[] = [
  "today",
  "yesterday",
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "this_year",
  "last_year",
  "maximum",
  "last_3d",
  "last_7d",
  "last_14d",
  "last_28d",
  "last_30d",
  "last_90d",
  "this_week_mon_today",
  "this_week_sun_today",
  "last_week_mon_sun",
  "last_week_sun_sat",
];

export const LEVELS: readonly string[] = ["account", "campaign", "adset", "ad"];

export const TIME_INCREMENTS: readonly string[] = ["1", "7", "28", "monthly", "all_days"];

export const EFFECTIVE_STATUSES: readonly string[] = [
  "ACTIVE",
  "PAUSED",
  "DELETED",
  "ARCHIVED",
  "IN_PROCESS",
  "WITH_ISSUES",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "PENDING_REVIEW",
  "DISAPPROVED",
  "PREAPPROVED",
  "PENDING_BILLING_INFO",
];

/** The insight metrics a caller may ask for. Nothing else is ever requested. */
export const INSIGHT_FIELDS: readonly string[] = [
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "unique_clicks",
  "ctr",
  "unique_ctr",
  "cpc",
  "cpm",
  "cpp",
  "actions",
  "action_values",
  "cost_per_action_type",
  "conversions",
  "cost_per_conversion",
  "purchase_roas",
  "inline_link_clicks",
  "inline_link_click_ctr",
  "cost_per_inline_link_click",
  "objective",
];
const DEFAULT_INSIGHT_FIELDS = ["spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm"];

const LEVEL_FIELDS: Readonly<Record<string, string[]>> = {
  account: ["account_id", "account_name"],
  campaign: ["account_id", "campaign_id", "campaign_name"],
  adset: ["account_id", "campaign_id", "adset_id", "adset_name"],
  ad: ["account_id", "campaign_id", "adset_id", "ad_id", "ad_name"],
};

const ACCOUNT_FIELDS = "id,account_id,name,account_status,currency,timezone_name,amount_spent";
const CAMPAIGN_FIELDS =
  "id,name,status,effective_status,objective,daily_budget,lifetime_budget,budget_remaining,start_time,stop_time,created_time,updated_time";
const ADSET_FIELDS =
  "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,budget_remaining,optimization_goal,billing_event,bid_strategy,start_time,end_time,created_time,updated_time";
const AD_FIELDS = "id,name,campaign_id,adset_id,status,effective_status,creative{id},created_time,updated_time";
const CREATIVE_FIELDS = "id,name,title,body,object_type,status,call_to_action_type,thumbnail_url";

function onlyKeys(args: Json, allowed: string[]): void {
  for (const k of Object.keys(args)) {
    if (!allowed.includes(k)) throw new ArgError(`Unknown input "${k.slice(0, 40)}". Allowed: ${allowed.join(", ")}.`);
  }
}

/** An ad account id as `act_<digits>` (plain digits are accepted and prefixed). */
function accountId(v: unknown): string {
  if (typeof v === "string" && ACT_ID.test(v)) return v;
  if (typeof v === "string" && ID.test(v)) return `act_${v}`;
  throw new ArgError("account_id must be an ad account id: digits, or act_ followed by digits.");
}

/** Any object id: digits, or `act_<digits>` for an ad account. */
function objectId(v: unknown): string {
  if (typeof v === "string" && (ID.test(v) || ACT_ID.test(v))) return v;
  throw new ArgError("object_id must be digits, or act_ followed by digits for an ad account.");
}

function limitOf(v: unknown): number {
  if (v === undefined) return DEFAULT_GRAPH_LIMIT;
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_GRAPH_LIMIT) return v;
  throw new ArgError(`limit must be a whole number from 1 to ${MAX_GRAPH_LIMIT}.`);
}

function oneOf(v: unknown, allowed: readonly string[], name: string): string {
  if (typeof v === "string" && allowed.includes(v)) return v;
  throw new ArgError(`${name} must be one of: ${allowed.join(", ")}.`);
}

function dateOf(v: unknown, name: string): string {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v) return v;
  }
  throw new ArgError(`${name} must be a real date written YYYY-MM-DD.`);
}

function statusFilter(v: unknown): string | null {
  if (v === undefined) return null;
  if (!Array.isArray(v) || v.length === 0 || v.length > EFFECTIVE_STATUSES.length) {
    throw new ArgError(`status must be a list of: ${EFFECTIVE_STATUSES.join(", ")}.`);
  }
  const out = v.map((s) => oneOf(s, EFFECTIVE_STATUSES, "status"));
  return JSON.stringify([...new Set(out)]);
}

/** Date range, level, metrics and time increment for an insights request. */
function insightQuery(args: Json): Record<string, string> {
  const q: Record<string, string> = {};
  const level = args.level === undefined ? "account" : oneOf(args.level, LEVELS, "level");
  q.level = level;
  const hasRange = args.since !== undefined || args.until !== undefined;
  if (hasRange && args.date_preset !== undefined) {
    throw new ArgError("Give either date_preset or since and until, not both.");
  }
  if (hasRange) {
    const since = dateOf(args.since, "since");
    const until = dateOf(args.until, "until");
    if (since > until) throw new ArgError("since must be on or before until.");
    q.time_range = JSON.stringify({ since, until });
  } else {
    q.date_preset = args.date_preset === undefined ? "last_30d" : oneOf(args.date_preset, DATE_PRESETS, "date_preset");
  }
  let metrics = DEFAULT_INSIGHT_FIELDS;
  if (args.fields !== undefined) {
    if (!Array.isArray(args.fields) || args.fields.length === 0 || args.fields.length > INSIGHT_FIELDS.length) {
      throw new ArgError(`fields must be a list of: ${INSIGHT_FIELDS.join(", ")}.`);
    }
    metrics = [...new Set(args.fields.map((f) => oneOf(f, INSIGHT_FIELDS, "fields")))];
  }
  q.fields = [...LEVEL_FIELDS[level], "date_start", "date_stop", ...metrics].join(",");
  if (args.time_increment !== undefined) {
    q.time_increment = oneOf(args.time_increment, TIME_INCREMENTS, "time_increment");
  }
  return q;
}

// ---------------------------------------------------------------------------
// Tools.
// ---------------------------------------------------------------------------

interface Plan {
  path: string;
  query: Record<string, string>;
  limit: number;
}

interface GraphTool {
  tool: UpstreamTool;
  plan: (args: Json) => Plan;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const S_LIMIT = {
  type: "integer",
  minimum: 1,
  maximum: MAX_GRAPH_LIMIT,
  description: `Most rows to return (1-${MAX_GRAPH_LIMIT}, default ${DEFAULT_GRAPH_LIMIT}).`,
};
const S_ACCOUNT = {
  type: "string",
  pattern: "^(act_)?[0-9]{1,25}$",
  description: "Ad account id, e.g. act_1234567890 (digits alone are accepted).",
};
const S_STATUS = {
  type: "array",
  items: { type: "string", enum: [...EFFECTIVE_STATUSES] },
  minItems: 1,
  maxItems: EFFECTIVE_STATUSES.length,
  description: "Only rows whose effective status is one of these.",
};
const S_INSIGHT_PROPS = {
  date_preset: {
    type: "string",
    enum: [...DATE_PRESETS],
    description: "A named range (default last_30d). Not with since/until.",
  },
  since: {
    type: "string",
    pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
    description: "First day, YYYY-MM-DD (with until).",
  },
  until: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", description: "Last day, YYYY-MM-DD (with since)." },
  level: { type: "string", enum: [...LEVELS], description: "Roll up per account (default), campaign, adset or ad." },
  fields: {
    type: "array",
    items: { type: "string", enum: [...INSIGHT_FIELDS] },
    minItems: 1,
    maxItems: INSIGHT_FIELDS.length,
    description: `Metrics to return (default ${DEFAULT_INSIGHT_FIELDS.join(", ")}).`,
  },
  time_increment: {
    type: "string",
    enum: [...TIME_INCREMENTS],
    description: "Split by days (1, 7, 28), monthly, or all_days.",
  },
  limit: S_LIMIT,
};

function listUnder(edge: string, fields: string) {
  return (args: Json): Plan => {
    onlyKeys(args, ["account_id", "status", "limit"]);
    const account = accountId(args.account_id);
    const limit = limitOf(args.limit);
    const query: Record<string, string> = { fields, limit: String(limit) };
    const status = statusFilter(args.status);
    if (status) query.effective_status = status;
    return { path: `${account}/${edge}`, query, limit };
  };
}

function listSchema(what: string) {
  return {
    type: "object",
    properties: { account_id: S_ACCOUNT, status: S_STATUS, limit: S_LIMIT },
    required: ["account_id"],
    additionalProperties: false,
    description: what,
  };
}

export const META_GRAPH_TOOLS: readonly GraphTool[] = [
  {
    tool: {
      name: "list_ad_accounts",
      title: "List ad accounts",
      description:
        "The ad accounts this company token can see (or a business's owned ad accounts when business_id is given): id, name, status, currency, time zone and amount spent (in the account's minor units).",
      inputSchema: {
        type: "object",
        properties: {
          business_id: { type: "string", pattern: "^[0-9]{1,25}$", description: "Optional Business Manager id." },
          limit: S_LIMIT,
        },
        additionalProperties: false,
      },
      annotations: READ_ONLY,
    },
    plan: (args) => {
      onlyKeys(args, ["business_id", "limit"]);
      const limit = limitOf(args.limit);
      let path = "me/adaccounts";
      if (args.business_id !== undefined) {
        if (typeof args.business_id !== "string" || !ID.test(args.business_id)) {
          throw new ArgError("business_id must be digits.");
        }
        path = `${args.business_id}/owned_ad_accounts`;
      }
      return { path, query: { fields: ACCOUNT_FIELDS, limit: String(limit) }, limit };
    },
  },
  {
    tool: {
      name: "get_account_insights",
      title: "Ad account insights",
      description:
        "Performance of one ad account for a date range (spend, impressions, reach, clicks, CTR, CPC, CPM, actions and more), rolled up per account, campaign, ad set or ad.",
      inputSchema: {
        type: "object",
        properties: { account_id: S_ACCOUNT, ...S_INSIGHT_PROPS },
        required: ["account_id"],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
    },
    plan: (args) => {
      onlyKeys(args, ["account_id", ...Object.keys(S_INSIGHT_PROPS)]);
      const account = accountId(args.account_id);
      const limit = limitOf(args.limit);
      return { path: `${account}/insights`, query: { ...insightQuery(args), limit: String(limit) }, limit };
    },
  },
  {
    tool: {
      name: "get_insights",
      title: "Insights for a campaign, ad set or ad",
      description:
        "Performance of one campaign, ad set, ad or ad account (by id) for a date range, with the same metrics and roll-up levels as get_account_insights.",
      inputSchema: {
        type: "object",
        properties: {
          object_id: {
            type: "string",
            pattern: "^(act_)?[0-9]{1,25}$",
            description: "Campaign, ad set or ad id (digits), or an ad account id (act_...).",
          },
          ...S_INSIGHT_PROPS,
        },
        required: ["object_id"],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
    },
    plan: (args) => {
      onlyKeys(args, ["object_id", ...Object.keys(S_INSIGHT_PROPS)]);
      const id = objectId(args.object_id);
      const limit = limitOf(args.limit);
      return { path: `${id}/insights`, query: { ...insightQuery(args), limit: String(limit) }, limit };
    },
  },
  {
    tool: {
      name: "list_campaigns",
      title: "List campaigns",
      description:
        "Campaigns in one ad account: id, name, status, objective, budgets (minor units) and dates. Optionally only some effective statuses.",
      inputSchema: listSchema("Campaigns in an ad account."),
      annotations: READ_ONLY,
    },
    plan: listUnder("campaigns", CAMPAIGN_FIELDS),
  },
  {
    tool: {
      name: "list_adsets",
      title: "List ad sets",
      description:
        "Ad sets in one ad account: id, name, campaign, status, budgets (minor units), optimization goal, bid strategy and dates.",
      inputSchema: listSchema("Ad sets in an ad account."),
      annotations: READ_ONLY,
    },
    plan: listUnder("adsets", ADSET_FIELDS),
  },
  {
    tool: {
      name: "list_ads",
      title: "List ads",
      description: "Ads in one ad account: id, name, campaign, ad set, status, creative id and dates.",
      inputSchema: listSchema("Ads in an ad account."),
      annotations: READ_ONLY,
    },
    plan: listUnder("ads", AD_FIELDS),
  },
  {
    tool: {
      name: "list_creatives",
      title: "List ad creatives",
      description:
        "Ad creatives in one ad account: id, name, title, body text, type, status, call to action and thumbnail.",
      inputSchema: {
        type: "object",
        properties: { account_id: S_ACCOUNT, limit: S_LIMIT },
        required: ["account_id"],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
    },
    plan: (args) => {
      onlyKeys(args, ["account_id", "limit"]);
      const account = accountId(args.account_id);
      const limit = limitOf(args.limit);
      return { path: `${account}/adcreatives`, query: { fields: CREATIVE_FIELDS, limit: String(limit) }, limit };
    },
  },
];

// ---------------------------------------------------------------------------
// Requests.
// ---------------------------------------------------------------------------

/** Graph error codes that mean the token is refused, expired or lacks a permission. */
export function isGraphAuthError(status: number, error: unknown): boolean {
  if (status === 401 || status === 403) return true;
  if (!isObject(error)) return false;
  const code = typeof error.code === "number" ? error.code : Number(error.code);
  return code === 190 || code === 102 || code === 10 || (code >= 200 && code <= 299);
}

/**
 * Meta's next-page address, made safe to follow: https, exactly
 * graph.facebook.com, no port or user name, under the same API version, with
 * any access_token, appsecret_proof or method taken out. Null when it is not one.
 */
export function safeNextUrl(next: unknown, base: string): string | null {
  if (typeof next !== "string" || next.length > 4096) return null;
  let u: URL;
  try {
    u = new URL(next);
  } catch (_err) {
    return null;
  }
  const versionPath = new URL(base).pathname;
  if (
    u.protocol !== "https:" || u.hostname !== META_GRAPH_HOST || u.port !== "" || u.username !== "" ||
    u.password !== "" || !u.pathname.startsWith(`${versionPath}/`)
  ) {
    return null;
  }
  // `method` would turn this GET into a POST or DELETE on Graph. These names
  // are dropped in any letter case.
  for (const name of [...new Set(u.searchParams.keys())]) {
    if (["access_token", "appsecret_proof", "method"].includes(name.toLowerCase())) u.searchParams.delete(name);
  }
  u.hash = "";
  return u.toString();
}

function invalid(message: string): UpstreamCallResult {
  return { content: [{ type: "text", text: `invalid_argument: ${message}` }], isError: true };
}

export class MetaGraphTransport implements UpstreamTransport {
  private readonly fetchFn: FetchLike;
  private readonly opts: { listTimeoutMs?: number; callTimeoutMs?: number; maxBytes?: number };

  constructor(
    fetchFn: FetchLike,
    opts: { listTimeoutMs?: number; callTimeoutMs?: number; maxBytes?: number } = {},
  ) {
    this.fetchFn = fetchFn;
    this.opts = opts;
  }

  /** One GET; the parsed JSON object, or an UpstreamError. */
  private async get(url: string, key: string, signal: AbortSignal): Promise<Json> {
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
        redirect: "manual",
        signal,
      });
    } catch (_err) {
      if (signal.aborted) throw new UpstreamError("upstream_timeout", null);
      throw new UpstreamError("upstream_unavailable", null);
    }
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      await res.body?.cancel().catch(() => {});
      throw new UpstreamError("upstream_unavailable", res.status);
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel().catch(() => {});
      throw new UpstreamError("upstream_key_rejected", res.status);
    }
    let text: string | null;
    try {
      text = await readCapped(res, this.opts.maxBytes ?? MAX_UPSTREAM_BYTES);
    } catch (_err) {
      if (signal.aborted) throw new UpstreamError("upstream_timeout", null);
      throw new UpstreamError("upstream_unavailable", res.status);
    }
    if (text === null) throw new UpstreamError("upstream_too_large", res.status);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (_err) {
      throw new UpstreamError("upstream_unavailable", res.status);
    }
    const error = isObject(parsed) ? parsed.error : undefined;
    if (res.status < 200 || res.status >= 300 || error !== undefined) {
      if (isGraphAuthError(res.status, error)) throw new UpstreamError("upstream_key_rejected", res.status);
      if (res.status >= 500) throw new UpstreamError("upstream_unavailable", res.status);
      const message = isObject(error) && typeof error.message === "string" ? error.message : "";
      throw new UpstreamError("upstream_unavailable", res.status, scrubText(message, key).slice(0, 300));
    }
    if (!isObject(parsed)) throw new UpstreamError("upstream_unavailable", res.status);
    return parsed;
  }

  listTools(target: UpstreamTarget): Promise<UpstreamTool[]> {
    if (!graphBase(target.url)) return Promise.reject(new UpstreamError("upstream_unavailable", null));
    // The tools are fixed here, so listing makes no request.
    return Promise.resolve(META_GRAPH_TOOLS.map((t) => ({ ...t.tool })));
  }

  async callTool(target: UpstreamTarget, name: string, args: Json): Promise<UpstreamCallResult> {
    const base = graphBase(target.url);
    if (!base) throw new UpstreamError("upstream_unavailable", null);
    const def = META_GRAPH_TOOLS.find((t) => t.tool.name === name);
    if (!def) return invalid("This Meta Ads tool does not exist.");
    let plan: Plan;
    try {
      plan = def.plan(isObject(args) ? args : {});
    } catch (err) {
      if (err instanceof ArgError) return invalid(err.message);
      throw err;
    }
    const first = `${base}/${plan.path}?${new URLSearchParams(plan.query).toString()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.callTimeoutMs ?? CALL_TIMEOUT_MS);
    const rows: unknown[] = [];
    let url: string | null = first;
    // Meta gave a next page on the last page read, whether or not it is safe
    // to follow: an unsafe one is not followed, but the rows are still not all.
    let more = false;
    let pages = 0;
    try {
      while (url && pages < MAX_GRAPH_PAGES && rows.length < plan.limit) {
        const body = await this.get(url, target.key, controller.signal);
        pages++;
        const data = Array.isArray(body.data) ? body.data : [];
        rows.push(...data.slice(0, plan.limit - rows.length));
        const given = isObject(body.paging) ? body.paging.next : undefined;
        more = typeof given === "string" && given !== "";
        url = safeNextUrl(given, base);
      }
    } finally {
      clearTimeout(timer);
    }
    const out: Json = { count: rows.length, more, data: rows };
    if (more) out.note = "More rows exist. Narrow the request, or raise limit (at most 100).";
    const text = scrubText(JSON.stringify(out), target.key);
    if (text.length > (this.opts.maxBytes ?? MAX_UPSTREAM_BYTES)) {
      throw new UpstreamError("upstream_too_large", 200);
    }
    return { content: [{ type: "text", text }], isError: false };
  }
}

// ---------------------------------------------------------------------------
// Routing.
// ---------------------------------------------------------------------------

/** Meta Graph rows to the REST adapter; every other row to MCP over HTTP. */
export class UpstreamRouter implements UpstreamTransport {
  private readonly mcp: UpstreamTransport;
  private readonly meta: UpstreamTransport;

  constructor(mcp: UpstreamTransport, meta: UpstreamTransport) {
    this.mcp = mcp;
    this.meta = meta;
  }

  pick(target: UpstreamTarget): UpstreamTransport {
    return isMetaGraphUrl(target.url) ? this.meta : this.mcp;
  }

  listTools(target: UpstreamTarget): Promise<UpstreamTool[]> {
    return this.pick(target).listTools(target);
  }

  callTool(target: UpstreamTarget, name: string, args: Json): Promise<UpstreamCallResult> {
    return this.pick(target).callTool(target, name, args);
  }
}

/** The transport the connector uses: a router over both adapters, sharing one fetch. */
export function createUpstreamTransport(
  fetchFn: FetchLike,
  opts: { listTimeoutMs?: number; callTimeoutMs?: number; maxBytes?: number } = {},
): UpstreamTransport {
  return new UpstreamRouter(new McpHttpTransport(fetchFn, opts), new MetaGraphTransport(fetchFn, opts));
}
