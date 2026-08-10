/**
 * Issue #1735 (umbrella #1734) — growth-tools client service (platform SPEC
 * P-32; watch/search/read additions per #1735 G-4).
 *
 * Every call is a `supabase.functions.invoke` against the DEPLOYED dual-lane
 * engines (#1734 platform wave): `lane:"app"` + the session JWT the supabase
 * client attaches automatically — exactly what the server's P-3 chain
 * verifies. Non-2xx responses THROW a typed `GrowthToolsAppError` (React
 * Query's error state needs a throw; the `pipelineInvokeError` precedent).
 * NEVER `catch {}` — every failure either reaches the hook's error state or is
 * rethrown typed (Constitution #3).
 *
 * Subject discipline (P-41, I-PROPOSED-1734-SUBJECT-REF-APP-LANE-ONLY): run
 * WRITES send a `subject: {type, id}` OBJECT — the client NEVER composes a
 * `subject_ref` string on a write; the server resolves ownership and composes
 * it. READS may transmit the full string (P-43).
 *
 * State ownership (P-35, COMMS-0136): results returned here live in the React
 * Query cache / component state ONLY — never in any persisted zustand store.
 * The strict-grep gate `issue-1734-tool-results-not-persisted.mjs` fails CI if
 * any file under `src/store/` imports this module.
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
async function toGrowthToolsAppError(error: {
  message?: string;
  context?: unknown;
}): Promise<GrowthToolsAppError> {
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
    const code = (KNOWN_CODES as readonly string[]).includes(rawCode ?? "")
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

// ── Canonical input builder + client input-hash (P-33) ──────────────────────

/**
 * Recursive key-sorted JSON stringify — the canonical form the client hash is
 * computed over. Stable across insertion order; `undefined` values dropped
 * (JSON semantics).
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJsonStringify(v)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(record[k])}`)
    .join(",");
  return `{${body}}`;
}

/**
 * Canonical grader input: trimmed, key-sorted-ready. The website is passed
 * through verbatim (the server normalizes + SSRF-guards it — the engine stays
 * the gatekeeper); name/city mirror the engine's trim.
 */
export function buildGraderInput(input: {
  name: string;
  city: string;
  website: string;
}): { name: string; city: string; website: string } {
  return {
    name: input.name.trim(),
    city: input.city.trim(),
    website: input.website.trim(),
  };
}

/**
 * CLIENT-side stable input hash (P-33). Deliberately NOT the server's sha256
 * P-22 hash — it only needs to be stable per input state (it keys RQ cache
 * entries, nothing else). FNV-1a 32-bit over the canonical JSON, hex.
 */
export function stableInputHash(input: unknown): string {
  const canonical = canonicalJsonStringify(input);
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** RN-safe per-attempt client_ref mint — the SERVER requires a UUID shape. */
export function mintClientRef(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") {
    return g.crypto.randomUUID();
  }
  // Hermes fallback: RFC4122-v4-shaped from Math.random (the
  // intakeSchemaService precedent — adequate for a resume ref).
  const hex = (n: number): string =>
    Math.floor(Math.random() * 16 ** n)
      .toString(16)
      .padStart(n, "0");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${
    ["8", "9", "a", "b"][Math.floor(Math.random() * 4)]
  }${hex(3)}-${hex(12)}`;
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

// ── Run (G-7 / P-32) ─────────────────────────────────────────────────────────

/** engine tool value → edge function name. */
const TOOL_FUNCTION: Record<GrowthToolName, string> = {
  venues: "growth-tools-run",
  events: "growth-tools-events",
  trips: "growth-tools-trips",
  experiences: "growth-tools-pricing",
};

export interface GrowthToolRunSubject {
  type: "venue" | "competitor";
  id: string;
}

export interface GrowthToolRunResult {
  runId: string;
  report: GraderReport;
  /** P-22 — true when the server re-served an identical-input run (free). */
  cached: boolean;
}

export async function runGrowthTool(
  tool: GrowthToolName,
  brandId: string,
  input: Record<string, unknown>,
  options?: { clientRef?: string; subject?: GrowthToolRunSubject },
): Promise<GrowthToolRunResult> {
  // P-41 / I-PROPOSED-1734-SUBJECT-REF-APP-LANE-ONLY: the write carries the
  // subject as an OBJECT — never a composed `subject_ref` string. The server
  // proves ownership (COMMS-0136: before EVERY success path) and composes it.
  const { data, error } = await supabase.functions.invoke(TOOL_FUNCTION[tool], {
    body: {
      action: "run",
      lane: "app",
      brand_id: brandId,
      input,
      ...(options?.clientRef !== undefined ? { client_ref: options.clientRef } : {}),
      ...(options?.subject !== undefined ? { subject: options.subject } : {}),
    },
  });
  if (error !== null) throw await toGrowthToolsAppError(error);
  const body = data as { run_id?: string; report?: GraderReport; cached?: boolean };
  if (typeof body?.run_id !== "string" || body.report === undefined) {
    throw new GrowthToolsAppError("server", { reason: "malformed_run_response" });
  }
  return {
    runId: body.run_id,
    report: body.report,
    cached: body.cached === true,
  };
}

// ── Authenticated reads (P-43 / P-26 / P-27) ─────────────────────────────────

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

export type ClientRefReadResult =
  | { status: "created" | "failed"; reason: string | null }
  | { status: "report_ready"; runId: string; createdAt: string; report: GraderReport };

/** P-27 — the socket-drop resume read, keyed by the client-minted ref. */
export async function readRunByClientRef(
  brandId: string,
  clientRef: string,
): Promise<ClientRefReadResult> {
  const { data, error } = await supabase.functions.invoke("growth-tools-report", {
    body: { lane: "app", brand_id: brandId, client_ref: clientRef },
  });
  if (error !== null) throw await toGrowthToolsAppError(error);
  const body = data as {
    status?: string;
    reason?: string;
    run_id?: string;
    created_at?: string;
    report?: GraderReport;
  };
  if (body?.status === "report_ready") {
    if (
      typeof body.run_id !== "string" ||
      typeof body.created_at !== "string" ||
      body.report === undefined
    ) {
      throw new GrowthToolsAppError("server", { reason: "malformed_read_response" });
    }
    return {
      status: "report_ready",
      runId: body.run_id,
      createdAt: body.created_at,
      report: body.report,
    };
  }
  if (body?.status === "created" || body?.status === "failed") {
    return {
      status: body.status,
      reason: typeof body.reason === "string" ? body.reason : null,
    };
  }
  throw new GrowthToolsAppError("server", { reason: "malformed_read_response" });
}

// ── Competitor watch CRUD + search (P-46) ────────────────────────────────────

export interface CompetitorWatchLatest {
  runId: string;
  grade: string | null;
  overall: number | null;
  checkedAt: string;
  schemaVersion: number | null;
}

export interface CompetitorWatchRow {
  id: string;
  name: string;
  city: string | null;
  website: string | null;
  placePoolId: string | null;
  createdAt: string;
  latest: CompetitorWatchLatest | null;
}

interface RawWatchRow {
  id?: string;
  name?: string;
  city?: string | null;
  website?: string | null;
  place_pool_id?: string | null;
  created_at?: string;
  latest?: {
    run_id?: string;
    grade?: string | null;
    overall?: number | null;
    checked_at?: string;
    schema_version?: number | null;
  } | null;
}

function mapWatchRow(raw: RawWatchRow): CompetitorWatchRow {
  const latest = raw.latest !== null && raw.latest !== undefined &&
      typeof raw.latest.run_id === "string" &&
      typeof raw.latest.checked_at === "string"
    ? {
      runId: raw.latest.run_id,
      grade: typeof raw.latest.grade === "string" ? raw.latest.grade : null,
      overall: typeof raw.latest.overall === "number" ? raw.latest.overall : null,
      checkedAt: raw.latest.checked_at,
      schemaVersion: typeof raw.latest.schema_version === "number"
        ? raw.latest.schema_version
        : null,
    }
    : null;
  return {
    id: raw.id ?? "",
    name: raw.name ?? "",
    city: raw.city ?? null,
    website: raw.website ?? null,
    placePoolId: raw.place_pool_id ?? null,
    createdAt: raw.created_at ?? "",
    latest,
  };
}

export async function listCompetitors(
  brandId: string,
  venueListingId: string,
): Promise<CompetitorWatchRow[]> {
  const { data, error } = await supabase.functions.invoke("growth-tools-run", {
    body: {
      action: "watch_list",
      lane: "app",
      brand_id: brandId,
      venue_listing_id: venueListingId,
    },
  });
  if (error !== null) throw await toGrowthToolsAppError(error);
  const body = data as { competitors?: RawWatchRow[] };
  if (!Array.isArray(body?.competitors)) {
    throw new GrowthToolsAppError("server", { reason: "malformed_watch_response" });
  }
  return body.competitors.map(mapWatchRow);
}

export async function addCompetitor(
  brandId: string,
  venueListingId: string,
  competitor: { name: string; city: string; website: string; placePoolId?: string | null },
): Promise<CompetitorWatchRow> {
  const { data, error } = await supabase.functions.invoke("growth-tools-run", {
    body: {
      action: "watch_add",
      lane: "app",
      brand_id: brandId,
      venue_listing_id: venueListingId,
      competitor: {
        name: competitor.name.trim(),
        city: competitor.city.trim(),
        website: competitor.website.trim(),
        ...(competitor.placePoolId !== undefined && competitor.placePoolId !== null
          ? { place_pool_id: competitor.placePoolId }
          : {}),
      },
    },
  });
  if (error !== null) throw await toGrowthToolsAppError(error);
  const body = data as { competitor?: RawWatchRow };
  if (body?.competitor === undefined) {
    throw new GrowthToolsAppError("server", { reason: "malformed_watch_response" });
  }
  return mapWatchRow(body.competitor);
}

export async function removeCompetitor(
  brandId: string,
  competitorId: string,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke("growth-tools-run", {
    body: {
      action: "watch_remove",
      lane: "app",
      brand_id: brandId,
      id: competitorId,
    },
  });
  if (error !== null) throw await toGrowthToolsAppError(error);
  const body = data as { ok?: boolean };
  if (body?.ok !== true) {
    throw new GrowthToolsAppError("server", { reason: "malformed_watch_response" });
  }
}

export interface PlaceSearchResult {
  id: string;
  name: string;
  city: string | null;
  website: string | null;
  photoUrl: string | null;
}

export async function searchPlaces(
  brandId: string,
  q: string,
  city?: string,
): Promise<PlaceSearchResult[]> {
  const { data, error } = await supabase.functions.invoke("growth-tools-run", {
    body: {
      action: "search",
      lane: "app",
      brand_id: brandId,
      q,
      ...(city !== undefined && city.length > 0 ? { city } : {}),
    },
  });
  if (error !== null) throw await toGrowthToolsAppError(error);
  const body = data as {
    results?: {
      id?: string;
      name?: string;
      city?: string | null;
      website?: string | null;
      photo_url?: string | null;
    }[];
  };
  if (!Array.isArray(body?.results)) {
    throw new GrowthToolsAppError("server", { reason: "malformed_search_response" });
  }
  return body.results
    .filter((r) => typeof r.id === "string" && typeof r.name === "string")
    .map((r) => ({
      id: r.id as string,
      name: r.name as string,
      city: r.city ?? null,
      website: r.website ?? null,
      photoUrl: r.photo_url ?? null,
    }));
}
