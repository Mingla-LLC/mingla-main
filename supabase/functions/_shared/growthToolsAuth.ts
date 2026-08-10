// ISSUE-1734 [Growth tools shared platform] — the SINGLE shared app-lane auth +
// quota + cache + budget module for the four growth-tool engines and
// growth-tools-report (P-6: one implementation, one point of audit; the gate
// does NOT import this — the gate has no app lane, P-30).
//
// LANE MODEL (P-2): the app lane is entered if and only if the request body
// carries `lane:"app"`. Anything else is the web lane, processed exactly as
// before — the marketing transport already sends an anon-key Bearer, so header
// presence can NEVER discriminate the lanes.
//
// AUTH CHAIN (P-3, the brand-stripe-onboard pattern):
//   1. Bearer extract → absent → 401 {error:"unauthenticated"}.
//   2. auth.getUser(token) — cryptographic verification by GoTrue. Error or no
//      user → 401. userId comes EXCLUSIVELY from data.user.id — never from a
//      locally-decoded claim, never from a client-sent field.
//   3. brand_id body field must be a UUID → else 400 {error:"validation"}.
//   4. biz_is_brand_member_for_read(brand, user) — RPC error → 500 (FAIL
//      CLOSED: never proceed on an unverifiable membership); !== true → 403.
// A forged/expired JWT is REJECTED (401), never downgraded to the anonymous
// lane (P-4): no row, no Gemini call, no quota consumed.
//
// OWNERSHIP ON EVERY SUCCESS PATH (P-5, COMMS-0136 bug class): every app-lane
// code path that returns report data or attributes a row — fresh run, cached
// hit, status/report read, any future early return — re-establishes user+brand
// authorization BEFORE returning. No "already computed"-style shortcut may
// bypass it. Enforces I-PROPOSED-1734-APP-LANE-VERIFIED-IDENTITY-EVERY-PATH.
//
// QUOTA (P-19..P-23): brand-keyed, per tool, rolling 24h, counted on the
// tool_leads rows themselves (lane='app' predicate — web IP arithmetic is
// untouched, I-PROPOSED-1734-LANE-QUOTAS-ISOLATED). Fail-OPEN on count errors,
// but observably (structured console.error) — the caller is cryptographically
// identified, so an uncounted run is attributable and bounded.
//
// CACHE (P-22, amended P-42): newest report_ready row per (brand, tool,
// input_hash, subject_ref) within 24h. Subject-aware (NULL-safe equality) so a
// venue-subject run and a competitor-subject run with identical inputs can
// never cross-serve. The brand predicate + the explicit row.brand_id assert IS
// the ownership check on the cached-hit path (P-5).
//
// BUDGETS (P-23/P-24): per-call timeout caps + per-run wall-clock budgets for
// the four engines. Hardening for BOTH lanes — no happy-path response shape or
// error string changes on the web lane.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function isUuidValue(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// ── P-2: lane selection — body-explicit, never header-sniffed ────────────────
export function isAppLane(body: Record<string, unknown>): boolean {
  return body.lane === "app";
}

// ── P-3..P-5: the app-lane auth chain ────────────────────────────────────────
export interface AppLaneAuth {
  userId: string;
  brandId: string;
}

/**
 * Authenticate an app-lane request. Returns { userId, brandId } on success or
 * a ready-to-return Response (401/400/403/500) on failure.
 *
 * (I-PROPOSED-1734-APP-LANE-VERIFIED-IDENTITY-EVERY-PATH / COMMS-0136): every
 * app-lane success path calls this (or re-checks row.brand_id equality for row
 * reads) BEFORE returning — cached hits and early returns included.
 */
export async function authenticateAppLane(
  req: Request,
  body: Record<string, unknown>,
  supabase: ServiceClient,
): Promise<AppLaneAuth | Response> {
  // 1. Bearer extract.
  const authHeader = req.headers.get("authorization") ?? "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return json({ error: "unauthenticated" }, 401);
  }
  const token = tokenMatch[1];

  // 2. Cryptographic verification via GoTrue (the brand-stripe-onboard
  //    decodeAndVerifyJwt pattern) — a forged/expired JWT is REJECTED here,
  //    never downgraded to the anonymous lane (P-4).
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: "server" }, 500);
  }
  const userClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data?.user?.id) {
    return json({ error: "unauthenticated" }, 401);
  }
  const userId: string = data.user.id;

  // 3. brand_id must be a UUID.
  const brandId = body.brand_id;
  if (!isUuidValue(brandId)) {
    return json({ error: "validation", fields: ["brand_id"] }, 400);
  }

  // 4. Membership floor (P-51, D-S5a FINAL): ANY brand member (rank > 0).
  //    RPC error → FAIL CLOSED (500) — never proceed on an unverifiable
  //    membership. Flipping the floor later is a one-line change HERE only.
  const { data: isMember, error: rpcErr } = await supabase.rpc(
    "biz_is_brand_member_for_read",
    { p_brand_id: brandId, p_user_id: userId },
  );
  if (rpcErr) {
    console.error(
      "[growth-tools] membership rpc failed (fail-closed)",
      rpcErr.message ?? String(rpcErr),
    );
    return json({ error: "server" }, 500);
  }
  if (isMember !== true) {
    return json({ error: "forbidden" }, 403);
  }

  return { userId, brandId };
}

// ── P-22: canonical JSON + input hash ────────────────────────────────────────
/** Recursive key-sorted JSON stringify — stable across property order. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalJson(v === undefined ? null : v)).join(",") + "]";
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return "{" +
    keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k] === undefined ? null : record[k])}`)
      .join(",") +
    "}";
}

/** input_hash = sha256(tool + "\n" + canonicalJson(normalizedInput)) hex. */
export async function computeInputHash(
  tool: string,
  normalizedInput: unknown,
): Promise<string> {
  const data = new TextEncoder().encode(`${tool}\n${canonicalJson(normalizedInput)}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── P-19..P-21, P-23: brand-keyed app-lane quota ─────────────────────────────
// Recommended default caps (D-S4 approved): venues 10 / events 25 / trips 15 /
// pricing 15. Tool values are the tool_leads.tool values ('experiences' is the
// pricing engine's tool value; the env key for it is "pricing" per P-23).
export const APP_LANE_DEFAULT_CAPS: Record<string, number> = {
  venues: 10,
  events: 25,
  trips: 15,
  experiences: 15,
};

const ENV_KEY_BY_TOOL: Record<string, string> = {
  venues: "venues",
  events: "events",
  trips: "trips",
  experiences: "pricing",
};

/**
 * Resolve the app-lane cap for one tool. Code-const defaults overridable by
 * ONE optional packed env `GROWTH_TOOLS_APP_LIMITS_JSON` (e.g.
 * {"venues":10,"events":25,"trips":15,"pricing":15}); malformed → defaults +
 * console.error. Deliberately NOT in MINGLA_RUNTIME_CONFIG_JSON — that would
 * make the engines new resolveRuntimeString consumers and force an edit of the
 * pinned issue-1203 gate (COMMS-0124 hazard class). Zero secret slots consumed
 * until Seth ever tunes it.
 */
export function appLaneCapForTool(tool: string): number {
  const fallback = APP_LANE_DEFAULT_CAPS[tool] ?? 10;
  const raw = Deno.env.get("GROWTH_TOOLS_APP_LIMITS_JSON") ?? "";
  if (raw.trim().length === 0) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    const key = ENV_KEY_BY_TOOL[tool] ?? tool;
    const v = (parsed as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      return Math.round(v);
    }
    return fallback;
  } catch (err) {
    console.error(
      "[growth-tools] GROWTH_TOOLS_APP_LIMITS_JSON malformed — using defaults",
      err instanceof Error ? err.message : String(err),
    );
    return fallback;
  }
}

const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface QuotaResult {
  limited: boolean;
  /** true when the counter read errored and the run proceeds fail-open. */
  failedOpen: boolean;
}

/**
 * P-19/P-20: count(*) of this brand's app-lane rows for this tool in the last
 * 24h (partial index idx_tool_leads_app_quota). NEVER consults
 * x-forwarded-for — there is no header whose absence skips the check
 * (I-PROPOSED-1734-LANE-QUOTAS-ISOLATED). Fail-OPEN observably on a count
 * error (P-23): structured log line, run proceeds.
 */
export async function checkAppLaneQuota(
  supabase: ServiceClient,
  brandId: string,
  tool: string,
): Promise<QuotaResult> {
  const cap = appLaneCapForTool(tool);
  const sinceIso = new Date(Date.now() - QUOTA_WINDOW_MS).toISOString();
  const { count, error } = await supabase
    .from("tool_leads")
    .select("id", { count: "exact", head: true })
    .eq("brand_id", brandId)
    .eq("tool", tool)
    .eq("lane", "app")
    .gte("created_at", sinceIso);
  if (error) {
    console.error(
      "[growth-tools] app-quota-count-failed",
      JSON.stringify({ tool, brand_id: brandId, message: error.message ?? String(error) }),
    );
    return { limited: false, failedOpen: true };
  }
  return { limited: (count ?? 0) >= cap, failedOpen: false };
}

// ── P-22 (amended P-42): input-hash cache, subject-aware ─────────────────────
export interface CacheHit {
  runId: string;
  report: unknown;
}

/**
 * Newest row where brand/tool/input_hash match, lane='app',
 * status='report_ready', created_at within 24h, AND subject_ref IS NOT
 * DISTINCT FROM the requested subject (NULL-safe — P-42: a venue-subject run
 * and a competitor-subject run with byte-identical inputs never cross-serve).
 * A read error is treated as a MISS (fail-open observably — a fresh run is the
 * safe fallback). The brand predicate + the explicit brand equality assert
 * below IS the P-5 ownership check on this success path (COMMS-0136 class —
 * do NOT remove).
 */
export async function lookupAppLaneCache(
  supabase: ServiceClient,
  auth: AppLaneAuth,
  tool: string,
  inputHash: string,
  subjectRef: string | null,
): Promise<CacheHit | null> {
  const sinceIso = new Date(Date.now() - QUOTA_WINDOW_MS).toISOString();
  let query = supabase
    .from("tool_leads")
    .select("id, report, brand_id")
    .eq("brand_id", auth.brandId)
    .eq("tool", tool)
    .eq("lane", "app")
    .eq("input_hash", inputHash)
    .eq("status", "report_ready")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(1);
  query = subjectRef === null
    ? query.is("subject_ref", null)
    : query.eq("subject_ref", subjectRef);
  const { data, error } = await query;
  if (error) {
    console.error(
      "[growth-tools] app-cache-lookup-failed",
      JSON.stringify({ tool, message: error.message ?? String(error) }),
    );
    return null;
  }
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return null;
  // (P-5 / COMMS-0136) explicit ownership assert on the cached-hit path — the
  // query already keys on brand_id, but a future query edit must not be able
  // to silently widen this. Never serve another brand's row.
  if ((row as { brand_id?: unknown }).brand_id !== auth.brandId) {
    console.error("[growth-tools] cache ownership assert failed — treating as miss");
    return null;
  }
  const report = (row as { report?: unknown }).report;
  if (report === null || report === undefined || typeof report !== "object") {
    return null;
  }
  return { runId: (row as { id: string }).id, report };
}

// ── P-40/P-41: subject resolve (server-derived, never client-composed) ───────
export const SUBJECT_REF_RE =
  /^(venue|competitor|event):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ResolvedSubject {
  subjectRef: string | null;
  /**
   * For competitor subjects ONLY: the engine input is taken FROM THE WATCH ROW,
   * overriding any client-sent input fields (P-41 — this is what makes the
   * §S11 diff deterministic: same subject ⇒ same competitor definition).
   */
  competitorInput?: {
    name: string;
    city: string;
    website: string;
    place_pool_id: string | null;
  };
}

/**
 * Resolve an app-lane run request's optional `subject: {type, id}` object.
 * The client NEVER sends a subject_ref string on a WRITE — any such field is
 * ignored; the literal '<type>:<id>' is composed HERE, only after the
 * referenced entity is proven to belong to the authenticated brand
 * (I-PROPOSED-1734-SUBJECT-REF-APP-LANE-ONLY; COMMS-0136 applied to writes —
 * a member of brand A must not stamp brand B's entity id into A's history).
 *
 *   venue:<venue_listings.id>      — tools 'venues' and 'experiences' only.
 *   competitor:<tool_competitors.id> — tool 'venues' only.
 *   event:<id>                     — format-reserved; accepted by NO v1 run path.
 */
export async function resolveRunSubject(
  supabase: ServiceClient,
  auth: AppLaneAuth,
  tool: string,
  raw: unknown,
): Promise<ResolvedSubject | Response> {
  if (raw === undefined || raw === null) return { subjectRef: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return json({ error: "validation", fields: ["subject"] }, 400);
  }
  const subject = raw as Record<string, unknown>;
  const type = subject.type;
  const id = subject.id;
  if ((type !== "venue" && type !== "competitor") || !isUuidValue(id)) {
    // 'event' is format-reserved but accepted by NO v1 run path (P-40).
    return json({ error: "validation", fields: ["subject"] }, 400);
  }

  if (type === "venue") {
    if (tool !== "venues" && tool !== "experiences") {
      return json({ error: "validation", fields: ["subject"] }, 400);
    }
    const { data, error } = await supabase
      .from("venue_listings")
      .select("id, brand_id")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[growth-tools] subject venue lookup failed", error.message);
      return json({ error: "server" }, 500);
    }
    if (!data || (data as { brand_id?: unknown }).brand_id !== auth.brandId) {
      return json({ error: "forbidden" }, 403);
    }
    return { subjectRef: `venue:${id}` };
  }

  // type === "competitor"
  if (tool !== "venues") {
    return json({ error: "validation", fields: ["subject"] }, 400);
  }
  const { data, error } = await supabase
    .from("tool_competitors")
    .select("id, brand_id, name, city, website, place_pool_id")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[growth-tools] subject competitor lookup failed", error.message);
    return json({ error: "server" }, 500);
  }
  if (!data || (data as { brand_id?: unknown }).brand_id !== auth.brandId) {
    return json({ error: "forbidden" }, 403);
  }
  const row = data as {
    name: string;
    city: string;
    website: string;
    place_pool_id: string | null;
  };
  return {
    subjectRef: `competitor:${id}`,
    competitorInput: {
      name: row.name,
      city: row.city,
      website: row.website,
      place_pool_id: row.place_pool_id ?? null,
    },
  };
}

// ── P-23/P-24: per-call timeout caps + per-run budgets ───────────────────────
/** Gemini google_search-grounded pass: per-attempt cap. */
export const GROUNDED_CALL_TIMEOUT_MS = 45_000;
/** Gemini structured pass: per-attempt cap. */
export const STRUCTURED_CALL_TIMEOUT_MS = 25_000;
/** Open-Meteo (each call). */
export const WEATHER_CALL_TIMEOUT_MS = 8_000;
/** Pexels cover search. */
export const PEXELS_CALL_TIMEOUT_MS = 8_000;

/** Per-run wall-clock budgets, measured from handler start (P-24). */
export const RUN_BUDGET_MS: Record<string, number> = {
  venues: 120_000,
  events: 100_000,
  trips: 130_000,
  experiences: 80_000,
};

export interface RunBudget {
  remainingMs(): number;
  exhausted(): boolean;
}

/**
 * Wall-clock budget tracker. Integration rule (P-24): before any external
 * call, compute remaining budget; a BEST-EFFORT stage is SKIPPED (fallback
 * taken) when remaining < its single-attempt cap; a FATAL stage runs with
 * min(cap, remaining) and retries only if budget remains; budget exhausted at
 * a fatal stage → markFailed() + 502 {error:"generation_failed",
 * reason:"timeout"} (P-25 — `reason` is additive; the web `error` string is
 * unchanged).
 */
export function createRunBudget(
  totalMs: number,
  now: () => number = Date.now,
): RunBudget {
  const startedAt = now();
  return {
    remainingMs: () => Math.max(0, totalMs - (now() - startedAt)),
    exhausted: () => totalMs - (now() - startedAt) <= 0,
  };
}

/** True for the AbortError DOMException a timed-out fetch rejects with. */
export function isAbortError(err: unknown): boolean {
  return (err instanceof DOMException || err instanceof Error) &&
    err.name === "AbortError";
}
