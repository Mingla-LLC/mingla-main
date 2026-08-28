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
