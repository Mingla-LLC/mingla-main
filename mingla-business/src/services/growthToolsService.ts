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
 * Subject discipline (P-41, I-PROPOSED-1734-SUBJECT-REF-APP-LANE-ONLY): when
 * a run is attached to a standing subject, WRITES send a `{type, id}` object;
 * ambient #1008 draft forecasts are intentionally subjectless. The client
 * never composes `subject_ref` on a write. READS may transmit it (P-43).
 *
 * State ownership (P-35, COMMS-0136): results returned here live in the React
 * Query cache / component state ONLY — never in any persisted zustand store.
 * The strict-grep gate `issue-1734-tool-results-not-persisted.mjs` fails CI if
 * any file under `src/store/` imports this module.
 */

import { supabase } from "./supabase";
import type { GrowthToolName } from "../hooks/growthToolsKeys";
// Issue #1735 CI rework — the read slice lives in `growthToolsReads.ts` (the
// EAGER boot-path module; see its header). Re-exported here so the lazy side
// keeps the single P-32 import surface.
import {
  GrowthToolsAppError,
  toGrowthToolsAppError,
} from "./growthToolsReads";
import type { GraderReport } from "./growthToolsReads";
import type {
  CompetitorBriefResult,
  CompetitorCapability,
  CompetitorFreshness,
  CompetitorManualRefreshState,
  CompetitorSourceHealth,
  CompetitorSourceInput,
  CompetitorSourceKind,
  CompetitorWatchRow,
  CompetitorWatchV2Row,
} from "../types/growthTools";

export {
  GrowthToolsAppError,
  readLatestBySubject,
  toGrowthToolsAppError,
} from "./growthToolsReads";
export type {
  GraderCompetitionCompetitor,
  GraderHeadToHeadRow,
  GraderReport,
  GraderReportFix,
  GraderReportScores,
  GraderSiteSignal,
  GraderSignalStatus,
  GrowthToolsAppErrorCode,
  SubjectLatestReport,
  SubjectLatestResult,
} from "./growthToolsReads";

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

export interface GrowthToolRunResult<TReport = GraderReport> {
  runId: string;
  report: TReport;
  /** P-22 — true when the server re-served an identical-input run (free). */
  cached: boolean;
}

export async function runGrowthTool<TReport = GraderReport>(
  tool: GrowthToolName,
  brandId: string,
  input: object,
  options?: { clientRef?: string; subject?: GrowthToolRunSubject },
): Promise<GrowthToolRunResult<TReport>> {
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
  const body = data as { run_id?: string; report?: TReport; cached?: boolean };
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

export type ClientRefReadResult<TReport = GraderReport> =
  | { status: "created" | "failed"; reason: string | null }
  | { status: "report_ready"; runId: string; createdAt: string; report: TReport };

/** P-27 — the socket-drop resume read, keyed by the client-minted ref. */
export async function readRunByClientRef<TReport = GraderReport>(
  brandId: string,
  clientRef: string,
): Promise<ClientRefReadResult<TReport>> {
  const { data, error } = await supabase.functions.invoke("growth-tools-report", {
    body: { lane: "app", brand_id: brandId, client_ref: clientRef },
  });
  if (error !== null) throw await toGrowthToolsAppError(error);
  const body = data as {
    status?: string;
    reason?: string;
    run_id?: string;
    created_at?: string;
    report?: TReport;
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

export type { CompetitorWatchRow, CompetitorWatchV2Row, CompetitorSourceInput, CompetitorBriefResult };

interface RawWatchRow {
  schema_version?: number;
  id?: string;
  name?: string;
  city?: string | null;
  website?: string | null;
  place_pool_id?: string | null;
  created_at?: string;
  updated_at?: string;
  freshness?: string;
  last_brief_updated_at?: string | null;
  checked_at?: string | null;
  next_refresh_at?: string | null;
  no_meaningful_change?: boolean;
  manual_refresh_state?: string;
  sources?: Record<string, unknown>[];
  summary?: { what_changed?: unknown; primary_action?: unknown };
  active_job?: Record<string, unknown> | null;
  latest?: {
    run_id?: string;
    grade?: string | null;
    overall?: number | null;
    checked_at?: string;
    schema_version?: number | null;
  } | null;
}

function mapWatchRow(raw: RawWatchRow): CompetitorWatchRow {
  const sourceKinds = new Set<CompetitorSourceKind>(["website", "instagram", "tiktok"]);
  const capabilities = new Set<CompetitorCapability>(["analyzed_weekly", "link_only", "disabled"]);
  const healths = new Set<CompetitorSourceHealth>(["pending", "current", "private", "removed", "invalid", "rate_limited", "unreachable", "unsupported", "disabled"]);
  const freshnesses = new Set<CompetitorFreshness>(["current", "refreshing", "partial", "stale", "needs_attention", "link_only", "budget_delayed"]);
  const manualStates = new Set<CompetitorManualRefreshState>(["available", "joined", "cached", "quota_limited", "edit_required", "exhausted", "not_applicable"]);
  if (raw.schema_version === undefined) {
    return {
      id: raw.id ?? "",
      name: raw.name ?? "",
      city: raw.city ?? null,
      website: raw.website ?? null,
      placePoolId: raw.place_pool_id ?? null,
      createdAt: raw.created_at ?? "",
      latest: raw.latest !== null && raw.latest !== undefined && typeof raw.latest.run_id === "string" && typeof raw.latest.checked_at === "string" ? { runId: raw.latest.run_id, grade: typeof raw.latest.grade === "string" ? raw.latest.grade : null, overall: typeof raw.latest.overall === "number" ? raw.latest.overall : null, checkedAt: raw.latest.checked_at, schemaVersion: typeof raw.latest.schema_version === "number" ? raw.latest.schema_version : null } : null,
    };
  }
  if (raw.schema_version !== 2 || !freshnesses.has(raw.freshness as CompetitorFreshness) || !manualStates.has(raw.manual_refresh_state as CompetitorManualRefreshState)) {
    throw new GrowthToolsAppError("server", { reason: "malformed_watch_v2" });
  }
  const sources = (raw.sources ?? []).map((source) => {
    if (!sourceKinds.has(source.kind as CompetitorSourceKind) || !capabilities.has(source.capability as CompetitorCapability) || !healths.has(source.health as CompetitorSourceHealth) || (source.availability !== "enabled" && source.availability !== "paused") || typeof source.url !== "string") {
      throw new GrowthToolsAppError("server", { reason: "malformed_watch_source" });
    }
    return {
      id: typeof source.id === "string" ? source.id : undefined,
      kind: source.kind as CompetitorSourceKind,
      url: source.url,
      capability: source.capability as CompetitorCapability,
      availability: source.availability as "enabled" | "paused",
      availabilityGeneration: typeof source.availability_generation === "number" ? source.availability_generation : 1,
      health: source.health as CompetitorSourceHealth,
      lastCheckedAt: typeof source.last_checked_at === "string" ? source.last_checked_at : null,
      safeReason: typeof source.safe_reason === "string" ? source.safe_reason : null,
    };
  });
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
    schemaVersion: 2,
    id: raw.id ?? "",
    name: raw.name ?? "",
    city: raw.city ?? null,
    website: raw.website ?? null,
    placePoolId: raw.place_pool_id ?? null,
    createdAt: raw.created_at ?? "",
    updatedAt: raw.updated_at ?? "",
    freshness: raw.freshness as CompetitorFreshness,
    lastBriefUpdatedAt: typeof raw.last_brief_updated_at === "string" ? raw.last_brief_updated_at : null,
    checkedAt: typeof raw.checked_at === "string" ? raw.checked_at : null,
    nextRefreshAt: typeof raw.next_refresh_at === "string" ? raw.next_refresh_at : null,
    noMeaningfulChange: raw.no_meaningful_change === true,
    manualRefreshState: raw.manual_refresh_state as CompetitorManualRefreshState,
    sources,
    summary: {
      whatChanged: typeof raw.summary?.what_changed === "string" ? raw.summary.what_changed : null,
      primaryAction: typeof raw.summary?.primary_action === "string" ? raw.summary.primary_action : null,
    },
    activeJob: raw.active_job !== null && raw.active_job !== undefined && typeof raw.active_job.id === "string" && typeof raw.active_job.state === "string"
      ? {
        id: raw.active_job.id,
        state: raw.active_job.state as "due" | "leased" | "retry_wait" | "budget_deferred",
        fundingLane: raw.active_job.funding_lane === "manual" ? "manual" : "scheduled",
        memberRetryCount: typeof raw.active_job.member_retry_count === "number" ? raw.active_job.member_retry_count : 0,
      }
      : null,
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
  competitor: { name: string; city: string; sources?: CompetitorSourceInput[]; website?: string; placePoolId?: string | null },
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
        ...(competitor.sources !== undefined
          ? { sources: competitor.sources.map((source) => ({ kind: source.kind, url: source.url.trim() })) }
          : competitor.website !== undefined ? { website: competitor.website.trim() } : {}),
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

export async function updateCompetitor(
  brandId: string,
  competitorId: string,
  expectedUpdatedAt: string,
  competitor: { name: string; city: string; sources: CompetitorSourceInput[] },
): Promise<CompetitorWatchRow> {
  const { data, error } = await supabase.functions.invoke("growth-tools-run", { body: {
    action: "watch_update", lane: "app", brand_id: brandId, id: competitorId,
    expected_updated_at: expectedUpdatedAt,
    competitor: { name: competitor.name.trim(), city: competitor.city.trim(), sources: competitor.sources.map((s) => ({ kind: s.kind, url: s.url.trim() })) },
  } });
  if (error !== null) throw await toGrowthToolsAppError(error);
  const body = data as { competitor?: RawWatchRow };
  if (body.competitor === undefined) throw new GrowthToolsAppError("server", { reason: "malformed_watch_response" });
  return mapWatchRow(body.competitor);
}

export async function refreshCompetitor(brandId: string, competitorId: string): Promise<"cached" | "joined" | "queued"> {
  const { data, error } = await supabase.functions.invoke("growth-tools-run", { body: { action: "watch_refresh", lane: "app", brand_id: brandId, id: competitorId } });
  if (error !== null) throw await toGrowthToolsAppError(error);
  const result = (data as { result?: unknown }).result;
  if (result !== "cached" && result !== "joined" && result !== "queued") throw new GrowthToolsAppError("server", { reason: "malformed_refresh_response" });
  return result;
}

export async function removeCompetitor(
  brandId: string,
  competitorId: string,
  expectedUpdatedAt?: string,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke("growth-tools-run", {
    body: {
      action: "watch_remove",
      lane: "app",
      brand_id: brandId,
      id: competitorId,
      ...(expectedUpdatedAt !== undefined ? { expected_updated_at: expectedUpdatedAt } : {}),
    },
  });
  if (error !== null) throw await toGrowthToolsAppError(error);
  const body = data as { ok?: boolean };
  if (body?.ok !== true) {
    throw new GrowthToolsAppError("server", { reason: "malformed_watch_response" });
  }
}

export async function getCompetitorBrief(brandId: string, watchId: string): Promise<CompetitorBriefResult> {
  const { data, error } = await supabase.functions.invoke("growth-tools-report", { body: { action: "competitor_brief", lane: "app", brand_id: brandId, watch_id: watchId } });
  if (error !== null) throw await toGrowthToolsAppError(error);
  const body = data as Record<string, unknown>;
  if (body.schema_version !== 2 || body.watch_id !== watchId) throw new GrowthToolsAppError("server", { reason: "malformed_brief_response" });
  return {
    schemaVersion: 2,
    watchId,
    freshness: body.freshness as CompetitorFreshness,
    updatedAt: typeof body.updated_at === "string" ? body.updated_at : null,
    checkedAt: typeof body.checked_at === "string" ? body.checked_at : null,
    nextRefreshAt: typeof body.next_refresh_at === "string" ? body.next_refresh_at : null,
    noMeaningfulChange: body.no_meaningful_change === true,
    manualRefreshState: body.manual_refresh_state as CompetitorManualRefreshState,
    sources: mapWatchRow({ ...body, schema_version: 2, id: watchId, name: "brief", created_at: "", updated_at: "", summary: {}, latest: null } as RawWatchRow).sources ?? [],
    brief: body.brief as CompetitorBriefResult["brief"],
  };
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
