/**
 * Issue #1735 CI rework — the EAGER slice of the growth-tools client (P-32's
 * read side). The Overview grade tile and the to-do nudge fan-out are on the
 * BOOT path (Home/Hub/venue Overview), so they must not drag the full
 * service (run/watch/search/hash) into the web `__common` chunk (ORCH-1083
 * budget). This module holds ONLY: the typed error contract, the defensive
 * report types, and the P-43 latest-by-subject read. `growthToolsService.ts`
 * (the P-32 canonical module, lazy behind the shell's Insights boundary)
 * re-exports everything here — the lazy side keeps ONE import surface.
 * Same P-35/COMMS-0136 state-ownership rules; the P-36 CI gate guards this
 * module under the same `growthTools*` token family.
 */

import { supabase } from "./supabase";
import type { GrowthToolName } from "../hooks/growthToolsKeys";

// ── Typed error contract (P-32) ──────────────────────────────────────────────

export type GrowthToolsAppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "validation"
  | "rate_limited"
  | "generation_failed"
  | "not_found"
  | "watch_limit"
  | "duplicate_competitor"
  | "duplicate_source"
  | "watch_conflict"
  | "provider_disabled"
  | "budget_deferred"
  | "temporarily_unavailable"
  | "edit_required"
  | "retry_exhausted"
  | "server"
  | "network";

export class GrowthToolsAppError extends Error {
  readonly code: GrowthToolsAppErrorCode;
  /** P-25 additive detail on `generation_failed` ("timeout" | "upstream_failed"). */
  readonly reason: string | null;
  /** P-19 additive scope on `rate_limited` ("brand" on the app lane). */
  readonly scope: string | null;
  readonly status: number | null;

  constructor(
    code: GrowthToolsAppErrorCode,
    options?: { reason?: string | null; scope?: string | null; status?: number | null },
  ) {
    super(`growth-tools ${code}${options?.reason ? `: ${options.reason}` : ""}`);
    this.name = "GrowthToolsAppError";
    this.code = code;
    this.reason = options?.reason ?? null;
    this.scope = options?.scope ?? null;
    this.status = options?.status ?? null;
  }
}

const KNOWN_CODES: readonly GrowthToolsAppErrorCode[] = [
  "unauthenticated",
  "forbidden",
  "validation",
  "rate_limited",
  "generation_failed",
  "not_found",
  "watch_limit",
  "duplicate_competitor",
  "server",
];

interface EngineErrorBody {
  error?: unknown;
  reason?: unknown;
  scope?: unknown;
}

/**
 * Map a `functions.invoke` failure to the typed contract. FunctionsHttpError
 * carries the raw `Response` as `.context` (the `pipelineInvokeError`
 * duck-typing precedent — no class import, version-proof); relay/fetch
 * failures have no parsable context and are the `network` class.
 */
export async function toGrowthToolsAppError(error: {
  message?: string;
  context?: unknown;
}, additionalCodes: readonly GrowthToolsAppErrorCode[] = []): Promise<GrowthToolsAppError> {
  const ctx = error.context;
  if (
    ctx !== null &&
    ctx !== undefined &&
    typeof (ctx as Response).json === "function"
  ) {
    const status = typeof (ctx as Response).status === "number"
      ? (ctx as Response).status
      : null;
    let body: EngineErrorBody | null = null;
    try {
      body = (await (ctx as Response).json()) as EngineErrorBody;
    } catch (parseError) {
      // Non-JSON error body — surfaced as `server` with the HTTP status; the
      // parse failure is logged with context, never swallowed silently.
      console.error(
        "[growthToolsService] non-JSON error body",
        status,
        parseError,
      );
      return new GrowthToolsAppError("server", { status });
    }
    const rawCode = typeof body?.error === "string" ? body.error : null;
    const code = (KNOWN_CODES as readonly string[]).includes(rawCode ?? "") ||
        (additionalCodes as readonly string[]).includes(rawCode ?? "")
      ? (rawCode as GrowthToolsAppErrorCode)
      : "server";
    return new GrowthToolsAppError(code, {
      reason: typeof body?.reason === "string" ? body.reason : null,
      scope: typeof body?.scope === "string" ? body.scope : null,
      status,
    });
  }
  // No Response context — the request never reached the function (offline,
  // DNS, relay). React Query surfaces it as the `network` class.
  return new GrowthToolsAppError("network", {
    reason: error.message ?? null,
  });
}

// ── Report types (third copy of the contract — app side, defensive) ─────────

export type GraderSignalStatus = "pass" | "warn" | "fail";

export interface GraderSiteSignal {
  key?: string;
  label?: string;
  status?: GraderSignalStatus | string;
  detail?: string;
}

export interface GraderReportScores {
  overall?: number;
  grade?: string;
  first_impression?: number;
  findability?: number;
  mobile?: number;
  menu_offers?: number;
  occasion_signal?: number;
  reasons?: Record<string, string>;
}

export interface GraderReportFix {
  title?: string;
  why?: string;
  change?: string;
  impact?: string;
}

export interface GraderCompetitionCompetitor {
  name?: string;
  city?: string;
  website?: string | null;
  mingla_score?: number | null;
  what_they_do_better?: string[];
  evidence?: string | null;
}

export interface GraderHeadToHeadRow {
  dimension?: string;
  you?: string;
  them?: string;
  winner?: string;
}

/**
 * The grader report as persisted by `growth-tools-run` (verified against the
 * DEPLOYED assembly, run/index.ts:2271–2311). Every field optional — parsers
 * are defensive per G-8: absent/malformed sections render NOTHING, never
 * fabricate (Constitution #9). `meta.schema_version` absent ⇒ legacy row
 * (P-11): treated as version 1.
 */
export interface GraderReport {
  venue?: { name?: string; city?: string; website?: string };
  scores?: GraderReportScores;
  site_signals?: { checks?: GraderSiteSignal[] };
  screenshot?: {
    image_url?: string | null;
    og_image_url?: string | null;
    after_url?: string | null;
  };
  fixes?: GraderReportFix[];
  rewritten_hero?: { before_excerpt?: string; after_copy?: string };
  competition?: {
    competitors?: GraderCompetitionCompetitor[];
    your_rank_read?: string;
    outrank_playbook?: string[];
  };
  head_to_head?: { competitor?: string; rows?: GraderHeadToHeadRow[] };
  ai_read?: string;
  meta?: {
    generated_at?: string;
    fetch_failed?: boolean;
    competition_source?: string;
    schema_version?: number;
  };
}

// ── Authenticated latest-read (P-43) ─────────────────────────────────────────

export interface SubjectLatestReport {
  runId: string;
  createdAt: string;
  report: GraderReport;
  /** OQ-U1 ruling: the authenticated read returns `input` too. */
  input: Record<string, unknown> | null;
}

export type SubjectLatestResult =
  | { status: "none" }
  | {
    status: "report_ready";
    latest: SubjectLatestReport;
    /** Present only when `includePrevious` AND a second report_ready row exists. */
    previous: SubjectLatestReport | null;
  };

export async function readLatestBySubject(
  brandId: string,
  tool: GrowthToolName,
  subjectRef: string,
  includePrevious: boolean,
): Promise<SubjectLatestResult> {
  const { data, error } = await supabase.functions.invoke("growth-tools-report", {
    body: {
      lane: "app",
      brand_id: brandId,
      tool,
      subject_ref: subjectRef,
      include_previous: includePrevious,
    },
  });
  if (error !== null) throw await toGrowthToolsAppError(error);
  const body = data as {
    status?: string;
    run_id?: string;
    created_at?: string;
    report?: GraderReport;
    input?: Record<string, unknown> | null;
    previous?: {
      run_id?: string;
      created_at?: string;
      report?: GraderReport;
      input?: Record<string, unknown> | null;
    };
  };
  if (body?.status === "none") return { status: "none" };
  if (
    body?.status !== "report_ready" ||
    typeof body.run_id !== "string" ||
    typeof body.created_at !== "string" ||
    body.report === undefined
  ) {
    throw new GrowthToolsAppError("server", { reason: "malformed_read_response" });
  }
  const previous = body.previous !== undefined &&
      typeof body.previous.run_id === "string" &&
      typeof body.previous.created_at === "string" &&
      body.previous.report !== undefined
    ? {
      runId: body.previous.run_id,
      createdAt: body.previous.created_at,
      report: body.previous.report,
      input: body.previous.input ?? null,
    }
    : null;
  return {
    status: "report_ready",
    latest: {
      runId: body.run_id,
      createdAt: body.created_at,
      report: body.report,
      input: body.input ?? null,
    },
    previous,
  };
}
