import { supabase } from "./supabase";
import { GrowthToolsAppError, toGrowthToolsAppError } from "./growthToolsReads";
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
const COMPETITOR_ERROR_CODES = [
  "duplicate_source", "watch_conflict", "provider_disabled", "budget_deferred",
  "temporarily_unavailable", "edit_required", "retry_exhausted",
] as const;
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
  if (error !== null) throw await toGrowthToolsAppError(error, COMPETITOR_ERROR_CODES);
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
  if (error !== null) throw await toGrowthToolsAppError(error, COMPETITOR_ERROR_CODES);
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
  if (error !== null) throw await toGrowthToolsAppError(error, COMPETITOR_ERROR_CODES);
  const body = data as { competitor?: RawWatchRow };
  if (body.competitor === undefined) throw new GrowthToolsAppError("server", { reason: "malformed_watch_response" });
  return mapWatchRow(body.competitor);
}

export async function refreshCompetitor(brandId: string, competitorId: string): Promise<"cached" | "joined" | "queued"> {
  const { data, error } = await supabase.functions.invoke("growth-tools-run", { body: { action: "watch_refresh", lane: "app", brand_id: brandId, id: competitorId } });
  if (error !== null) throw await toGrowthToolsAppError(error, COMPETITOR_ERROR_CODES);
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
  if (error !== null) throw await toGrowthToolsAppError(error, COMPETITOR_ERROR_CODES);
  const body = data as { ok?: boolean };
  if (body?.ok !== true) {
    throw new GrowthToolsAppError("server", { reason: "malformed_watch_response" });
  }
}

const COMPETITOR_FRESHNESSES = new Set<CompetitorFreshness>([
  "current", "refreshing", "partial", "stale", "needs_attention",
  "link_only", "budget_delayed",
]);
const COMPETITOR_MANUAL_STATES = new Set<CompetitorManualRefreshState>([
  "available", "joined", "cached", "quota_limited", "edit_required",
  "exhausted", "not_applicable",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function malformedBriefResponse(): never {
  throw new GrowthToolsAppError("server", { reason: "malformed_brief_response" });
}

function mapCompetitorBrief(raw: unknown): CompetitorBriefResult["brief"] {
  if (raw === null) return null;
  if (!isRecord(raw) || !hasExactKeys(raw, ["status", "what_changed", "why_it_matters", "worth_doing", "evidence"], ["website_health"]) ||
    (raw.status !== "current" && raw.status !== "partial") ||
    !Array.isArray(raw.what_changed) || raw.what_changed.length < 1 || raw.what_changed.length > 3 ||
    !Array.isArray(raw.why_it_matters) || raw.why_it_matters.length < 1 || raw.why_it_matters.length > 2 ||
    !Array.isArray(raw.worth_doing) || raw.worth_doing.length < 1 || raw.worth_doing.length > 3 ||
    !Array.isArray(raw.evidence) || raw.evidence.length < 1) {
    return malformedBriefResponse();
  }

  const evidenceIds = new Set<string>();
  const evidenceSources = new Map<string, string>();
  const evidence = raw.evidence.map((item) => {
    if (!isRecord(item) || !hasExactKeys(item, ["id", "source_id", "public_url", "checked_at", "observation"], ["observed_at"]) ||
      typeof item.id !== "string" || item.id.trim() === "" || evidenceIds.has(item.id) ||
      typeof item.source_id !== "string" || item.source_id.trim() === "" ||
      !isHttpUrl(item.public_url) ||
      !isTimestamp(item.checked_at) ||
      (item.observed_at !== undefined && !isTimestamp(item.observed_at)) ||
      typeof item.observation !== "string" || item.observation.trim() === "") {
      return malformedBriefResponse();
    }
    evidenceIds.add(item.id);
    evidenceSources.set(item.id, item.source_id);
    return {
      id: item.id,
      sourceId: item.source_id,
      publicUrl: item.public_url,
      ...(typeof item.observed_at === "string" ? { observedAt: item.observed_at } : {}),
      checkedAt: item.checked_at,
      observation: item.observation,
    };
  });

  const factIds = new Set<string>();
  const whatChanged = raw.what_changed.map((item) => {
    if (!isRecord(item) || !hasExactKeys(item, ["id", "text", "source_id", "evidence_id", "confidence"]) ||
      typeof item.id !== "string" || item.id.trim() === "" || factIds.has(item.id) ||
      typeof item.text !== "string" || item.text.trim() === "" ||
      typeof item.source_id !== "string" || item.source_id.trim() === "" ||
      typeof item.evidence_id !== "string" || !evidenceIds.has(item.evidence_id) ||
      evidenceSources.get(item.evidence_id) !== item.source_id || item.confidence !== "observed") {
      return malformedBriefResponse();
    }
    factIds.add(item.id);
    return { id: item.id, text: item.text, sourceId: item.source_id, evidenceId: item.evidence_id, confidence: "observed" as const };
  });

  const whyItMatters = raw.why_it_matters.map((item) => {
    if (!isRecord(item) || !hasExactKeys(item, ["text", "evidence_ids", "confidence"]) ||
      typeof item.text !== "string" || item.text.trim() === "" ||
      item.confidence !== "interpretation" || !Array.isArray(item.evidence_ids) ||
      item.evidence_ids.length < 1 || item.evidence_ids.some((id) => typeof id !== "string" || !evidenceIds.has(id))) {
      return malformedBriefResponse();
    }
    return { text: item.text, evidenceIds: item.evidence_ids as string[], confidence: "interpretation" as const };
  });

  const actionIds = new Set<string>();
  let primaryActions = 0;
  const worthDoing = raw.worth_doing.map((item) => {
    if (!isRecord(item) || !hasExactKeys(item, ["id", "text", "kind", "confidence", "is_primary"], ["target_id"]) ||
      typeof item.id !== "string" || item.id.trim() === "" || actionIds.has(item.id) ||
      typeof item.text !== "string" || item.text.trim() === "" ||
      typeof item.kind !== "string" || item.kind.trim() === "" ||
      item.confidence !== "suggested_action" || typeof item.is_primary !== "boolean" ||
      (item.target_id !== undefined && (typeof item.target_id !== "string" || item.target_id.trim() === ""))) {
      return malformedBriefResponse();
    }
    actionIds.add(item.id);
    if (item.is_primary) primaryActions += 1;
    return {
      id: item.id,
      text: item.text,
      kind: item.kind,
      ...(typeof item.target_id === "string" ? { targetId: item.target_id } : {}),
      confidence: "suggested_action" as const,
      isPrimary: item.is_primary,
    };
  });
  if (primaryActions !== 1) return malformedBriefResponse();

  let websiteHealth: { grade: string | null; changes: unknown[] } | undefined;
  if (raw.website_health !== undefined) {
    if (!isRecord(raw.website_health) || !hasExactKeys(raw.website_health, ["grade", "changes"]) ||
      (raw.website_health.grade !== null && typeof raw.website_health.grade !== "string") ||
      !Array.isArray(raw.website_health.changes)) {
      return malformedBriefResponse();
    }
    websiteHealth = { grade: raw.website_health.grade as string | null, changes: raw.website_health.changes };
  }
  return { status: raw.status, whatChanged, whyItMatters, worthDoing, evidence, ...(websiteHealth ? { websiteHealth } : {}) };
}

export async function getCompetitorBrief(brandId: string, watchId: string): Promise<CompetitorBriefResult> {
  const { data, error } = await supabase.functions.invoke("growth-tools-report", { body: { action: "competitor_brief", lane: "app", brand_id: brandId, watch_id: watchId } });
  if (error !== null) throw await toGrowthToolsAppError(error, COMPETITOR_ERROR_CODES);
  if (!isRecord(data) || !hasExactKeys(data, ["schema_version", "watch_id", "freshness", "updated_at", "checked_at", "next_refresh_at", "no_meaningful_change", "manual_refresh_state", "sources", "brief"])) return malformedBriefResponse();
  const body = data;
  if (body.schema_version !== 2 || body.watch_id !== watchId ||
    !COMPETITOR_FRESHNESSES.has(body.freshness as CompetitorFreshness) ||
    !COMPETITOR_MANUAL_STATES.has(body.manual_refresh_state as CompetitorManualRefreshState) ||
    !isNullableTimestamp(body.updated_at) || !isNullableTimestamp(body.checked_at) ||
    !isNullableTimestamp(body.next_refresh_at) || typeof body.no_meaningful_change !== "boolean" ||
    !Array.isArray(body.sources)) return malformedBriefResponse();
  for (const source of body.sources) {
    if (!isRecord(source) || !hasExactKeys(source, ["kind", "url", "capability", "availability", "availability_generation", "health", "last_checked_at", "safe_reason"], ["id"]) ||
      !isHttpUrl(source.url) || !Number.isInteger(source.availability_generation) || (source.availability_generation as number) < 1 ||
      (source.safe_reason !== null && typeof source.safe_reason !== "string") ||
      (source.last_checked_at !== null && !isTimestamp(source.last_checked_at))) {
      return malformedBriefResponse();
    }
  }
  let sources: NonNullable<CompetitorWatchRow["sources"]>;
  try {
    sources = mapWatchRow({ ...body, schema_version: 2, id: watchId, name: "brief", created_at: "", updated_at: "", summary: {}, latest: null } as RawWatchRow).sources ?? [];
  } catch {
    return malformedBriefResponse();
  }
  return {
    schemaVersion: 2,
    watchId,
    freshness: body.freshness as CompetitorFreshness,
    updatedAt: typeof body.updated_at === "string" ? body.updated_at : null,
    checkedAt: typeof body.checked_at === "string" ? body.checked_at : null,
    nextRefreshAt: typeof body.next_refresh_at === "string" ? body.next_refresh_at : null,
    noMeaningfulChange: body.no_meaningful_change === true,
    manualRefreshState: body.manual_refresh_state as CompetitorManualRefreshState,
    sources,
    brief: mapCompetitorBrief(body.brief),
  };
}
