// ISSUE-1003 [Venue Website Grader] — token-gated full-report read.
//
// PUBLIC edge function (verify_jwt=false), but access requires the report_token
// that growth-tools-gate emailed to the verified address. Entering an email on
// the page does NOT reveal the report; only the tokenized link in the email
// does — so the full feature is shown only to people whose email we own.
//
// POST {run_id, token} → 200 {report}
//   → 400 {error:"validation"} | 403 {error:"forbidden"} | 404 {error:"not_found"}
//   → 500 {error:"server"} · OPTIONS → 200 "ok" + CORS
//
// ISSUE-1734 [shared platform] — SECOND, AUTHENTICATED branch for the Business
// app (P-26, amended P-43 + OQ-U1). Entered if and only if the body carries
// `lane:"app"` (P-2 — the web token branch above is byte-stable). Bearer JWT +
// the full P-3 chain (_shared/growthToolsAuth.ts), then EXACTLY ONE of three
// selectors:
//   • {lane:"app", brand_id, run_id}      — one specific run.
//   • {lane:"app", brand_id, client_ref}  — newest run for a client-minted
//     attempt ref (the P-27 resume poll).
//   • {lane:"app", brand_id, tool, subject_ref, include_previous?} — newest
//     report_ready run(s) for a subject (P-43; `include_previous:true` returns
//     the prior one too, for the client-side diff). Reads MAY transmit the
//     subject_ref string; only WRITES must not compose it (P-41).
// Column allowlist (OQ-U1): id, status, report, input, brand_id, created_at —
// NEVER report_token / email / ip_hash / pid / utm
// (I-PROPOSED-1734-TOKEN-FLOW-UNTOUCHED). Ownership: the row's brand_id must
// equal the verified brand on EVERY returned row (P-5, COMMS-0136 — the
// subject selector is additionally keyed by the caller's brand, so foreign
// rows are structurally unreachable there).
//   run_id/client_ref → 200 {status:"created", input} | {status:"failed",
//     reason:"failed", input} | {status:"report_ready", report, input}
//     · 403 {error:"forbidden"} (exists, not owned) · 404 {error:"not_found"}
//   subject → 200 {status:"none"} (never checked — the designed first-run
//     state, NOT an error) | {status:"report_ready", run_id, created_at,
//     report, input, previous?}
//   → 401 {error:"unauthenticated"} · 400 {error:"validation"}

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
// ISSUE-1734 — the SINGLE shared app-lane auth module (P-6).
import {
  authenticateAppLane,
  isAppLane,
  isUuidValue,
  SUBJECT_REF_RE,
} from "../_shared/growthToolsAuth.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// Constant-time-ish string compare (avoids trivial early-exit timing leaks).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── ISSUE-1734 app branch ────────────────────────────────────────────────────
// P-26/P-43 column allowlist (OQ-U1 amended): the select-list IS the
// enforcement — report_token / email / ip_hash / pid / utm can never appear in
// an app-lane response because they are never selected.
const APP_READ_COLUMNS = "id, status, report, input, brand_id, created_at";

const KNOWN_TOOLS = new Set(["venues", "events", "trips", "experiences"]);

interface AppRow {
  id: string;
  status: string;
  report: unknown;
  input: unknown;
  brand_id: string | null;
  created_at: string;
}

// Map one OWNED row to the run_id/client_ref-selector response body. The
// caller has already passed the brand-equality check (P-5).
function rowStatusResponse(row: AppRow): Response {
  if (row.status === "report_ready") {
    return json({
      status: "report_ready",
      report: row.report,
      input: row.input,
    }, 200);
  }
  if (row.status === "failed") {
    return json({ status: "failed", reason: "failed", input: row.input }, 200);
  }
  // 'created' (in-flight). gated_email/emailed are web-only statuses and
  // structurally unreachable here (web rows have NULL brand_id → 403 earlier).
  return json({ status: row.status, input: row.input }, 200);
}

async function handleAppRead(
  req: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "server" }, 500);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // P-3 chain on EVERY read path (P-5, COMMS-0136 — no shortcut skips it).
  const auth = await authenticateAppLane(req, body, supabase);
  if (auth instanceof Response) return auth;

  if (body.action === "competitor_brief") {
    if (!isUuidValue(body.watch_id)) {
      return json({ error: "validation", fields: ["watch_id"] }, 400);
    }
    const { data: watch, error: watchError } = await supabase.from(
      "tool_competitors",
    ).select("id,brand_id,next_due_at,last_success_at,current_brief_id").eq(
      "id",
      body.watch_id,
    ).maybeSingle();
    if (watchError) {
      console.error(
        "[growth-tools-report] competitor watch failed",
        watchError.message,
      );
      return json({ error: "server" }, 500);
    }
    if (!watch) return json({ error: "not_found" }, 404);
    if (watch.brand_id !== auth.brandId) {
      return json({ error: "forbidden" }, 403);
    }
    const { data: sourceRows } = await supabase.from("tool_competitor_sources")
      .select(
        "id,kind,normalized_url,capability,health,last_checked_at,last_safe_error_code",
      ).eq("competitor_id", watch.id).order("kind");
    const { data: capabilities } = await supabase.from(
      "tool_competitor_provider_capabilities",
    ).select("kind,enabled,availability_generation,safe_reason");
    const capMap = new Map((capabilities ?? []).map((cap) => [cap.kind, cap]));
    const sources = (sourceRows ?? []).map((source) => {
      const cap = capMap.get(source.kind) as {
        enabled?: boolean;
        availability_generation?: number;
        safe_reason?: string | null;
      } | undefined;
      const paused = source.capability === "analyzed_weekly" &&
        cap?.enabled !== true;
      return {
        kind: source.kind,
        url: source.normalized_url,
        capability: source.capability,
        availability: paused ? "paused" : "enabled",
        availability_generation: cap?.availability_generation ?? 1,
        health: source.health,
        last_checked_at: source.last_checked_at,
        safe_reason: paused
          ? "automatic_checking_paused"
          : source.last_safe_error_code ?? null,
      };
    });
    const { data: jobs } = await supabase.from("tool_competitor_refresh_jobs")
      .select("state,finished_at,member_retry_count").eq(
        "competitor_id",
        watch.id,
      ).order("created_at", { ascending: false }).limit(1);
    const job = (jobs ?? [])[0] as {
      state?: string;
      finished_at?: string;
      member_retry_count?: number;
    } | undefined;
    let brief: Record<string, unknown> | null = null;
    if (watch.current_brief_id) {
      const { data } = await supabase.from("tool_competitor_briefs").select(
        "status,updated_at,checked_at,what_changed,why_it_matters,worth_doing,evidence",
      ).eq("id", watch.current_brief_id).maybeSingle();
      brief = data as Record<string, unknown> | null;
    }
    const hasAnalyzable = sources.some((source) =>
      source.capability === "analyzed_weekly" &&
      source.availability === "enabled"
    );
    const analyzedSources = sources.filter((source) =>
      source.capability === "analyzed_weekly"
    );
    const hasPausedAnalyzed = analyzedSources.some((source) =>
      source.availability === "paused"
    );
    const providerPaused = analyzedSources.length > 0 &&
      analyzedSources.every((source) => source.availability === "paused");
    const health = sources.map((source) => source.health);
    let freshness = "stale";
    if (
      !hasAnalyzable &&
      sources.every((source) => source.capability === "link_only")
    ) freshness = "link_only";
    else if (providerPaused || job?.state === "budget_deferred") {
      freshness = "budget_delayed";
    } else if (["due", "leased", "retry_wait"].includes(job?.state ?? "")) {
      freshness = "refreshing";
    } else if (hasPausedAnalyzed || brief?.status === "partial") {
      freshness = "partial";
    } else if (
      typeof watch.last_success_at === "string" &&
      Date.now() - Date.parse(watch.last_success_at) <= 8 * 86_400_000
    ) freshness = "current";
    else if (
      !hasAnalyzable ||
      health.every((value) =>
        ["private", "removed", "invalid", "unsupported", "disabled"].includes(
          value,
        )
      )
    ) freshness = "needs_attention";
    const manual = providerPaused
      ? "not_applicable"
      : !hasAnalyzable
      ? (freshness === "link_only" ? "not_applicable" : "edit_required")
      : ["due", "leased", "retry_wait"].includes(job?.state ?? "")
      ? "joined"
      : (job?.member_retry_count ?? 0) >= 1
      ? "exhausted"
      : ["stale", "needs_attention", "budget_delayed"].includes(freshness) ||
          health.some((value) =>
            ["rate_limited", "unreachable"].includes(value)
          )
      ? "available"
      : "not_applicable";
    return json({
      schema_version: 2,
      watch_id: watch.id,
      freshness,
      updated_at: brief?.updated_at ?? null,
      checked_at: job?.state === "no_change"
        ? job.finished_at ?? brief?.checked_at ?? null
        : brief?.checked_at ?? null,
      next_refresh_at: providerPaused ? null : watch.next_due_at,
      no_meaningful_change: job?.state === "no_change",
      manual_refresh_state: manual,
      sources,
      brief: brief
        ? {
          status: brief.status,
          what_changed: brief.what_changed,
          why_it_matters: brief.why_it_matters,
          worth_doing: brief.worth_doing,
          evidence: brief.evidence,
          website_health: { grade: null, changes: [] },
        }
        : null,
    }, 200);
  }

  // Exactly ONE of the three selectors (P-43).
  const hasRunId = body.run_id !== undefined && body.run_id !== null;
  const hasClientRef = body.client_ref !== undefined &&
    body.client_ref !== null;
  const hasSubject = body.subject_ref !== undefined &&
    body.subject_ref !== null;
  const selectorCount =
    [hasRunId, hasClientRef, hasSubject].filter(Boolean).length;
  if (selectorCount !== 1) {
    return json({ error: "validation", fields: ["selector"] }, 400);
  }

  if (hasRunId || hasClientRef) {
    let row: AppRow | null = null;
    if (hasRunId) {
      if (!isUuidValue(body.run_id)) {
        return json({ error: "validation", fields: ["run_id"] }, 400);
      }
      const { data, error } = await supabase
        .from("tool_leads")
        .select(APP_READ_COLUMNS)
        .eq("id", body.run_id)
        .maybeSingle();
      if (error) {
        console.error("[growth-tools-report] app read failed", error.message);
        return json({ error: "server" }, 500);
      }
      row = (data ?? null) as AppRow | null;
    } else {
      if (!isUuidValue(body.client_ref)) {
        return json({ error: "validation", fields: ["client_ref"] }, 400);
      }
      // Newest attempt for this client ref (idx_tool_leads_app_client_ref) —
      // the P-27 resume poll.
      const { data, error } = await supabase
        .from("tool_leads")
        .select(APP_READ_COLUMNS)
        .eq("client_ref", body.client_ref)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) {
        console.error("[growth-tools-report] app read failed", error.message);
        return json({ error: "server" }, 500);
      }
      row = ((data ?? [])[0] ?? null) as AppRow | null;
    }
    if (!row) return json({ error: "not_found" }, 404);
    // (P-5 / COMMS-0136) ownership equality on EVERY returned row: a web row
    // (NULL brand_id) or another brand's row can never match → 403 (exists but
    // not owned — mirrors the web branch's 403/404 distinction; run_ids are
    // unguessable UUIDs either way).
    if (row.brand_id !== auth.brandId) {
      return json({ error: "forbidden" }, 403);
    }
    return rowStatusResponse(row);
  }

  // Subject selector (P-43): {tool, subject_ref, include_previous?}.
  const tool = body.tool;
  if (typeof tool !== "string" || !KNOWN_TOOLS.has(tool)) {
    return json({ error: "validation", fields: ["tool"] }, 400);
  }
  const subjectRef = body.subject_ref;
  if (typeof subjectRef !== "string" || !SUBJECT_REF_RE.test(subjectRef)) {
    return json({ error: "validation", fields: ["subject_ref"] }, 400);
  }
  const includePrevious = body.include_previous === true;

  // Keyed by the CALLER's verified brand (idx_tool_leads_app_subject): another
  // brand's rows can never match, so this selector has no 403 case —
  // cross-brand probing is structurally empty. The per-row brand assert below
  // stands anyway (P-5 — the predicate AND the assert, so a future query edit
  // cannot silently widen).
  const { data, error } = await supabase
    .from("tool_leads")
    .select(APP_READ_COLUMNS)
    .eq("brand_id", auth.brandId)
    .eq("tool", tool)
    .eq("subject_ref", subjectRef)
    .eq("lane", "app")
    .eq("status", "report_ready")
    .order("created_at", { ascending: false })
    .limit(includePrevious ? 2 : 1);
  if (error) {
    console.error("[growth-tools-report] subject read failed", error.message);
    return json({ error: "server" }, 500);
  }
  const rows = (data ?? []) as AppRow[];
  for (const r of rows) {
    if (r.brand_id !== auth.brandId) {
      console.error("[growth-tools-report] subject ownership assert failed");
      return json({ error: "server" }, 500);
    }
  }
  if (rows.length === 0) {
    // "Never checked yet" is the designed first-run state of every standing
    // surface — NOT an error (deliberate: 404 stays the answer for the
    // run_id/client_ref selectors, where a missing SPECIFIC run IS an error).
    return json({ status: "none" }, 200);
  }
  const newest = rows[0];
  const previous = includePrevious && rows.length > 1 ? rows[1] : null;
  return json({
    status: "report_ready",
    run_id: newest.id,
    created_at: newest.created_at,
    report: newest.report,
    input: newest.input,
    ...(previous
      ? {
        previous: {
          run_id: previous.id,
          created_at: previous.created_at,
          report: previous.report,
          input: previous.input,
        },
      }
      : {}),
  }, 200);
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try {
    const raw = await req.json();
    body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  } catch {
    return json({ error: "validation" }, 400);
  }

  // ISSUE-1734 P-2: the app branch is entered ONLY on body-explicit
  // lane:"app" — the anonymous token branch below is byte-stable
  // (I-PROPOSED-1734-WEB-FUNNEL-UNCHANGED / TOKEN-FLOW-UNTOUCHED).
  if (isAppLane(body)) {
    try {
      return await handleAppRead(req, body);
    } catch (err) {
      console.error(
        "[growth-tools-report] app read unexpected error",
        err instanceof Error ? err.message : String(err),
      );
      return json({ error: "server" }, 500);
    }
  }

  const runId = body.run_id;
  const token = typeof body.token === "string" ? body.token : "";
  if (!isUuid(runId) || token.length < 16 || token.length > 128) {
    return json({ error: "validation" }, 400);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "server" }, 500);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: lead, error } = await supabase
      .from("tool_leads")
      .select("report, report_token")
      .eq("id", runId as string)
      .maybeSingle();
    if (error) {
      console.error("[growth-tools-report] lookup failed", error.message);
      return json({ error: "server" }, 500);
    }
    if (!lead) return json({ error: "not_found" }, 404);
    const storedToken =
      typeof (lead as { report_token?: unknown }).report_token === "string"
        ? (lead as { report_token: string }).report_token
        : "";
    const report = (lead as { report: unknown }).report;
    if (storedToken.length < 16 || !safeEqual(storedToken, token)) {
      return json({ error: "forbidden" }, 403);
    }
    if (report === null || typeof report !== "object") {
      return json({ error: "not_found" }, 404);
    }
    return json({ report });
  } catch (err) {
    console.error(
      "[growth-tools-report] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "server" }, 500);
  }
}

if (import.meta.main) {
  serve(handler);
}
