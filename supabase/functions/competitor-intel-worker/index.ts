import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeCompetitorSource } from "../_shared/competitorSourceIdentity.ts";
import { observeCompetitorWebsite } from "../_shared/competitorWebsiteObservation.ts";

export const ANALYZED_PROVIDER_ALLOWLIST = new Set(
  ["website", "instagram"] as const,
);
// raw provider response bodies remain in worker memory only and are discarded;
// only the bounded normalized observation contract below is persisted.
const MAX_OBSERVED_ITEMS = 20;
const OBSERVATION_WINDOW_DAYS = 28;
const RESERVED_MICROUSD = 50_000;
const PROVIDER_TIMEOUT_MS = 12_000;
const SYNTHESIS_TIMEOUT_MS = 15_000;
const WORKER_CLAIM_LIMIT = 3;
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${
    Object.keys(record).sort().map((k) =>
      `${JSON.stringify(k)}:${canonical(record[k])}`
    ).join(",")
  }}`;
}
export async function fetchWithTimeout(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("unreachable");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export type CurrentObservation = {
  sourceId: string;
  kind: string;
  facts: unknown;
  checkedAt: string;
  latestObservedAt: string | null;
  publicUrl: string;
  fingerprint: string;
};
export type PriorObservation = {
  source_id: string;
  facts: unknown;
  checked_at: string;
};
export interface ObservationComparison {
  sourceId: string;
  kind: string;
  before: unknown | null;
  after: unknown;
  changedPaths: string[];
}
export interface VenueContext {
  listing: {
    id: string;
    name: string;
    city: string | null;
    venue_category: string;
  } | null;
  brand_published_events: Array<
    { id: string; title: string; description: string | null }
  >;
}
function changedPaths(
  before: unknown,
  after: unknown,
  prefix = "",
  depth = 0,
): string[] {
  if (canonical(before) === canonical(after)) return [];
  if (
    depth >= 3 || before === null || after === null ||
    typeof before !== "object" || typeof after !== "object" ||
    Array.isArray(before) || Array.isArray(after)
  ) return [prefix || "source"];
  const keys = [
    ...new Set([
      ...Object.keys(before as Record<string, unknown>),
      ...Object.keys(after as Record<string, unknown>),
    ]),
  ].sort();
  return keys.flatMap((key) =>
    changedPaths(
      (before as Record<string, unknown>)[key],
      (after as Record<string, unknown>)[key],
      prefix ? `${prefix}.${key}` : key,
      depth + 1,
    )
  ).filter((value) => !/(?:^|\.)checked_at$/.test(value)).slice(0, 8);
}
export function buildObservationComparisons(
  current: CurrentObservation[],
  prior: PriorObservation[],
): ObservationComparison[] {
  const priorBySource = new Map(
    prior.map((item) => [item.source_id, item.facts]),
  );
  return current.map((item) => ({
    sourceId: item.sourceId,
    kind: item.kind,
    before: priorBySource.get(item.sourceId) ?? null,
    after: item.facts,
    changedPaths: changedPaths(
      priorBySource.get(item.sourceId) ?? null,
      item.facts,
    ),
  }));
}
export function publicationStates(
  hasFailures: boolean,
): { briefStatus: "current" | "partial"; jobState: "succeeded" | "partial" } {
  return hasFailures
    ? { briefStatus: "partial", jobState: "partial" }
    : { briefStatus: "current", jobState: "succeeded" };
}
export function leaseStillOwned(
  liveJob: { state?: string; lease_owner?: string | null } | null | undefined,
  expectedOwner: string,
): boolean {
  return liveJob?.state === "leased" && liveJob.lease_owner === expectedOwner;
}
export function observedChangeText(
  name: string,
  comparisons: ObservationComparison[],
): string {
  const comparable = comparisons.filter((item) => item.before !== null);
  const changed = comparable.find((item) => item.changedPaths.length > 0);
  const newlyObserved = comparisons.find((item) => item.before === null);
  return changed
    ? `${
      changed.kind === "website" ? "Website" : "Instagram"
    } public fields changed: ${changed.changedPaths.slice(0, 3).join(", ")}.`
    : comparable.length === 0 && newlyObserved
    ? `Mingla checked ${name}'s current public ${newlyObserved.kind} information.`
    : `Mingla checked ${name}'s current public information.`;
}
export function venueRelevantFallback(
  observations: CurrentObservation[],
  context: VenueContext,
): { why: string; action: string } {
  const liveMusic = /(?:live[ _-]?music|concert|\bband\b|\bdj\b|acoustic)/i
    .test(canonical(observations.map((item) => item.facts)));
  if (!context.listing) {
    return {
      why:
        "No comparable Mingla venue signal is available yet, so this observation is not being treated as a venue gap.",
      action:
        "Review the public evidence and add only a genuine venue response that fits your business.",
    };
  }
  const matchingEvent = context.brand_published_events.some((event) =>
    /(?:live[ _-]?music|concert|\bband\b|\bdj\b|acoustic)/i.test(
      `${event.title} ${event.description ?? ""}`,
    )
  );
  if (liveMusic && !matchingEvent) {
    return {
      why:
        "The competitor's public source mentions live music, while no matching published Mingla event was found in this brand's bounded venue context.",
      action:
        "Consider whether a genuine live-music event fits your venue; publish one only if you can deliver it well.",
    };
  }
  return {
    why:
      "The competitor observation was compared with this venue's Mingla listing and the brand's bounded published-event context.",
    action:
      "Review the evidence against your current listing and published events before choosing one relevant update.",
  };
}
async function loadVenueContext(
  db: Db,
  venueListingId: string,
): Promise<VenueContext> {
  const { data: listing, error: listingError } = await db.from("venue_listings")
    .select(
      "id,brand_id,name,city,venue_category",
    ).eq("id", venueListingId).maybeSingle();
  if (listingError) throw new Error("venue_context_read_failed");
  if (!listing) return { listing: null, brand_published_events: [] };
  const { data: events, error: eventsError } = await db.from("events").select(
    "id,title,description",
  ).eq("brand_id", listing.brand_id).in("status", ["scheduled", "live"]).in(
    "visibility",
    ["public", "discover"],
  ).is("deleted_at", null).order("published_at", { ascending: false }).limit(5);
  if (eventsError) throw new Error("venue_context_read_failed");
  return {
    listing: {
      id: listing.id,
      name: listing.name,
      city: listing.city ?? null,
      venue_category: listing.venue_category,
    },
    brand_published_events: (events ?? []).map((
      event: Record<string, any>,
    ) => ({
      id: event.id,
      title: String(event.title),
      description: typeof event.description === "string"
        ? event.description.slice(0, 500)
        : null,
    })),
  };
}

// Edge functions use the ungenerated service-role client throughout this repo.
// Runtime row contracts are narrowed explicitly at each boundary below.
type Db = any;
interface ClaimedJob {
  id: string;
  competitor_id: string;
  brand_id: string;
  venue_listing_id: string;
  source_set_fingerprint: string;
  capability_snapshot: Record<string, number>;
  lease_owner: string;
  attempt_count: number;
  funding_lane: "scheduled" | "manual";
  manual_tool_lead_id: string | null;
}

export async function processCompetitorJob(
  db: Db,
  job: ClaimedJob,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const { data: watch, error: watchError } = await db.from("tool_competitors")
    .select(
      "id,name,city,current_brief_id,updated_at",
    ).eq("id", job.competitor_id).maybeSingle();
  if (watchError) throw new Error("watch_read_failed");
  if (!watch) return cancel(db, job, "superseded");
  const { data: sources, error: sourcesError } = await db.from(
    "tool_competitor_sources",
  ).select(
    "id,kind,normalized_url,normalized_identity,source_fingerprint,capability,health,last_checked_at",
  ).eq("competitor_id", job.competitor_id).order("kind");
  if (sourcesError) throw new Error("sources_read_failed");
  const { data: caps, error: capsError } = await db.from(
    "tool_competitor_provider_capabilities",
  )
    .select("kind,mode,enabled,availability_generation");
  if (capsError) throw new Error("capabilities_read_failed");
  const capMap = new Map<string, Record<string, any>>(
    (caps ?? []).map((c: Record<string, any>) => [c.kind, c]),
  );
  const effective = (sources ?? []).filter((s: Record<string, any>) =>
    ANALYZED_PROVIDER_ALLOWLIST.has(s.kind) &&
    s.capability === "analyzed_weekly" &&
    capMap.get(s.kind)?.mode === "analyzed_weekly" &&
    capMap.get(s.kind)?.enabled === true &&
    job.capability_snapshot[s.kind] ===
      capMap.get(s.kind)?.availability_generation
  );
  if (effective.length === 0) return cancel(db, job, "provider_disabled");
  if (job.funding_lane === "scheduled") {
    const { data: reservation, error } = await db.rpc(
      "issue_2725_reserve_budget",
      { p_job: job.id, p_amount: RESERVED_MICROUSD },
    );
    if (error || !reservation) return;
  }
  const observations: CurrentObservation[] = [];
  const failures: Array<{ sourceId: string; kind: string; code: string }> = [];
  for (const source of effective) {
    // Pause/resume generation check immediately before provider I/O.
    const { data: liveCap, error: liveCapError } = await db.from(
      "tool_competitor_provider_capabilities",
    ).select("enabled,mode,availability_generation").eq("kind", source.kind)
      .single();
    const { data: liveJob, error: liveJobError } = await db.from(
      "tool_competitor_refresh_jobs",
    )
      .select("state,lease_owner,cancel_requested_at,capability_snapshot").eq(
        "id",
        job.id,
      ).single();
    if (liveCapError || liveJobError) throw new Error("lease_recheck_failed");
    if (!leaseStillOwned(liveJob, job.lease_owner)) {
      return cancel(db, job, "superseded");
    }
    if (
      !liveCap?.enabled || liveCap.mode !== "analyzed_weekly" ||
      liveCap.availability_generation !==
        job.capability_snapshot[source.kind] ||
      liveJob?.cancel_requested_at
    ) return cancel(db, job, "provider_generation_changed");
    try {
      let observed: {
        facts: unknown;
        checkedAt: string;
        latestObservedAt: string | null;
      };
      if (source.kind === "website") {
        observed = await observeCompetitorWebsite(
          await normalizeCompetitorSource("website", source.normalized_url),
          fetcher,
        );
      } else {observed = await observeInstagram(
          source.normalized_identity.replace(/^instagram:/, ""),
          fetcher,
        );}
      const fingerprint = await sha256(canonical(observed.facts));
      observations.push({
        sourceId: source.id,
        kind: source.kind,
        facts: observed.facts,
        checkedAt: observed.checkedAt,
        latestObservedAt: observed.latestObservedAt,
        publicUrl: source.normalized_url,
        fingerprint,
      });
    } catch (error) {
      const code = providerSafeCode(error);
      failures.push({ sourceId: source.id, kind: source.kind, code });
      const { error: sourceFailureWriteError } = await db.from(
        "tool_competitor_sources",
      ).update({
        health: code,
        last_checked_at: new Date().toISOString(),
        last_safe_error_code: code,
        updated_at: new Date().toISOString(),
      }).eq("id", source.id);
      if (sourceFailureWriteError) throw new Error("source_write_failed");
    }
  }
  if (observations.length === 0) {
    return finishFailure(db, job, failures[0]?.code ?? "unreachable");
  }
  const obsSet = await sha256(
    observations.map((o) => o.fingerprint).sort().join("|"),
  );
  const { data: current, error: currentError } = watch.current_brief_id
    ? await db.from("tool_competitor_briefs").select(
      "observation_set_fingerprint,updated_at,job_id",
    ).eq("id", watch.current_brief_id).maybeSingle()
    : { data: null, error: null };
  if (currentError) throw new Error("current_brief_read_failed");
  for (const observation of observations) {
    const { error: observationWriteError } = await db.from(
      "tool_competitor_observations",
    ).upsert({
      job_id: job.id,
      competitor_id: job.competitor_id,
      source_id: observation.sourceId,
      schema_version: 1,
      window_start: new Date(Date.now() - OBSERVATION_WINDOW_DAYS * 86400000)
        .toISOString(),
      window_end: new Date().toISOString(),
      checked_at: observation.checkedAt,
      latest_observed_at: observation.latestObservedAt,
      observation_fingerprint: observation.fingerprint,
      coverage: failures.length ? "partial" : "complete",
      facts: observation.facts,
    }, { onConflict: "job_id,source_id" });
    if (observationWriteError) throw new Error("observation_write_failed");
    const { error: sourceSuccessWriteError } = await db.from(
      "tool_competitor_sources",
    ).update({
      health: "current",
      last_checked_at: observation.checkedAt,
      last_observed_at: observation.latestObservedAt,
      last_success_at: observation.checkedAt,
      last_safe_error_code: null,
      updated_at: new Date().toISOString(),
    }).eq("id", observation.sourceId);
    if (sourceSuccessWriteError) throw new Error("source_write_failed");
  }
  const checkedAt = observations.map((o) => o.checkedAt).sort().at(-1) ??
    new Date().toISOString();
  if (current?.observation_set_fingerprint === obsSet) {
    const finished = await finishJob(db, job, "no_change", null, {
      checked_at: checkedAt,
    });
    if (finished.applied && watch.current_brief_id) {
      await purgeOldLiveContent(
        db,
        job.competitor_id,
        watch.current_brief_id,
        job.id,
      );
    }
    return;
  }
  const { data: priorRows, error: priorError } = current?.job_id
    ? await db.from("tool_competitor_observations").select(
      "source_id,facts,checked_at",
    ).eq("job_id", current.job_id).order("source_id").limit(3)
    : { data: [], error: null };
  if (priorError) throw new Error("prior_observations_read_failed");
  const comparisons = buildObservationComparisons(
    observations,
    (priorRows ?? []) as PriorObservation[],
  );
  const venueContext = await loadVenueContext(db, job.venue_listing_id);
  const brief = await synthesizeBrief(
    watch.name,
    watch.city,
    observations,
    comparisons,
    venueContext,
    fetcher,
  );
  validateBrief(brief, observations);
  // Generation + source fingerprint recheck immediately before publish.
  const { data: publishJob, error: publishJobError } = await db.from(
    "tool_competitor_refresh_jobs",
  )
    .select(
      "state,lease_owner,cancel_requested_at,source_set_fingerprint,capability_snapshot",
    ).eq("id", job.id).single();
  const { data: publishWatch, error: publishWatchError } = await db.from(
    "tool_competitors",
  ).select("id")
    .eq("id", job.competitor_id).maybeSingle();
  if (publishJobError || publishWatchError) {
    throw new Error("publish_recheck_failed");
  }
  if (
    !publishWatch || !leaseStillOwned(publishJob, job.lease_owner) ||
    publishJob.cancel_requested_at ||
    publishJob.source_set_fingerprint !== job.source_set_fingerprint ||
    canonical(publishJob.capability_snapshot) !==
      canonical(job.capability_snapshot)
  ) return cancel(db, job, "superseded");
  const { briefStatus } = publicationStates(failures.length > 0);
  const finished = await finishJob(db, job, "publish", null, {
    brief_status: briefStatus,
    checked_at: checkedAt,
    observation_set_fingerprint: obsSet,
    what_changed: brief.what_changed,
    why_it_matters: brief.why_it_matters,
    worth_doing: brief.worth_doing,
    evidence: brief.evidence,
  });
  if (!finished.applied || !finished.brief_id) return;
  await purgeOldLiveContent(db, job.competitor_id, finished.brief_id, job.id);
}

export async function observeInstagram(
  username: string,
  fetcher: typeof fetch,
): Promise<
  { facts: unknown; checkedAt: string; latestObservedAt: string | null }
> {
  const igUser = Deno.env.get("META_COMPETITOR_IG_USER_ID") ?? "";
  const token = Deno.env.get("META_COMPETITOR_ACCESS_TOKEN") ?? "";
  const version = Deno.env.get("META_GRAPH_API_VERSION") ?? "v23.0";
  if (!igUser || !token) throw new Error("disabled");
  const fields =
    `business_discovery.username(${username}){username,name,biography,website,media.limit(${MAX_OBSERVED_ITEMS}){id,caption,comments_count,like_count,media_type,permalink,timestamp}}`;
  const response = await fetchWithTimeout(
    fetcher,
    `https://graph.facebook.com/${version}/${igUser}?fields=${
      encodeURIComponent(fields)
    }&access_token=${encodeURIComponent(token)}`,
    { headers: { Accept: "application/json" } },
    PROVIDER_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "rate_limited"
        : response.status === 404
        ? "removed"
        : "unreachable",
    );
  }
  const body = await response.json() as {
    business_discovery?: {
      username?: string;
      name?: string;
      biography?: string;
      website?: string;
      media?: { data?: Array<Record<string, unknown>> };
    };
  };
  const profile = body.business_discovery;
  if (!profile) throw new Error("private");
  const cutoff = Date.now() - OBSERVATION_WINDOW_DAYS * 86400000;
  const media = (profile.media?.data ?? []).filter((item) =>
    typeof item.timestamp === "string" &&
    Date.parse(item.timestamp as string) >= cutoff
  ).slice(0, MAX_OBSERVED_ITEMS);
  const items = media.map((item) => ({
    public_url: String(item.permalink ?? ""),
    published_at: String(item.timestamp),
    format: String(item.media_type).toLowerCase() === "video"
      ? "video"
      : "image",
    ...(typeof item.caption === "string"
      ? { caption_excerpt: item.caption.slice(0, 280) }
      : {}),
    outbound_urls: [],
    visible_counts: {
      ...(Number.isInteger(item.like_count) ? { likes: item.like_count } : {}),
      ...(Number.isInteger(item.comments_count)
        ? { comments: item.comments_count }
        : {}),
    },
  }));
  return {
    facts: {
      profile: {
        name: profile.name,
        bio: profile.biography?.slice(0, 500),
        outbound_urls: profile.website ? [profile.website] : [],
      },
      items,
      cadence: {
        posts_7d:
          items.filter((i) =>
            Date.parse(i.published_at) >= Date.now() - 7 * 86400000
          ).length,
        posts_28d: items.length,
      },
      themes: [],
    },
    checkedAt: new Date().toISOString(),
    latestObservedAt: items[0]?.published_at ?? null,
  };
}
export async function synthesizeBrief(
  name: string,
  city: string | null,
  observations: CurrentObservation[],
  comparisons: ObservationComparison[],
  venueContext: VenueContext,
  fetcher: typeof fetch,
): Promise<
  {
    what_changed: unknown[];
    why_it_matters: unknown[];
    worth_doing: unknown[];
    evidence: unknown[];
  }
> {
  const evidence = observations.map((o, index) => ({
    id: `e${index + 1}`,
    source_id: o.sourceId,
    public_url: o.publicUrl,
    checked_at: o.checkedAt,
    observation: `${
      o.kind === "website" ? "Website" : "Instagram"
    } public information was checked.`,
  }));
  const comparable = comparisons.filter((item) => item.before !== null);
  const firstCheck = comparable.length === 0;
  const changed = comparable.find((item) => item.changedPaths.length > 0);
  const newlyObserved = comparisons.find((item) => item.before === null);
  const primary = changed ?? newlyObserved ?? observations[0];
  const primaryEvidence = `e${
    Math.max(
      0,
      observations.findIndex((item) => item.sourceId === primary.sourceId),
    ) + 1
  }`;
  const baselineFacts = [{
    id: "f1",
    text: observedChangeText(name, comparisons),
    source_id: primary.sourceId,
    evidence_id: primaryEvidence,
    confidence: "observed",
  }];
  const relevance = venueRelevantFallback(observations, venueContext);
  const fallback = {
    what_changed: baselineFacts,
    why_it_matters: [{
      text: relevance.why,
      evidence_ids: [primaryEvidence],
      confidence: "interpretation",
    }],
    worth_doing: [{
      id: "a1",
      text: relevance.action,
      kind: "review_venue_context",
      confidence: "suggested_action",
      is_primary: true,
    }],
    evidence,
  };
  const key = Deno.env.get("GOOGLE_AI_API_KEY") ?? "";
  if (!key) return fallback;
  const prompt = {
    name,
    city,
    first_check: firstCheck,
    must_not_claim_change: firstCheck,
    before_after: comparisons.map((item, index) => ({
      source_id: item.sourceId,
      kind: item.kind,
      before: firstCheck ? null : item.before,
      after: item.after,
      changed_paths: firstCheck ? [] : item.changedPaths,
      evidence_id: `e${index + 1}`,
    })),
    venue_context: venueContext,
    contract: {
      max_facts: 3,
      max_interpretations: 2,
      max_actions: 3,
      exactly_one_primary: true,
      probabilistic: true,
      no_revenue_or_causal_claims: true,
      only_claim_changes_present_in_changed_paths: true,
      interpretations_and_actions_must_cite_venue_context_or_say_no_comparable_signal:
        true,
    },
  };
  try {
    const response = await fetchWithTimeout(
      fetcher,
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${
        encodeURIComponent(key)
      }`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text:
                `Return JSON only. Build a sourced venue-relevant competitor brief from this bounded before/after input: ${
                  JSON.stringify(prompt)
                }`,
            }],
          }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
      SYNTHESIS_TIMEOUT_MS,
    );
    if (!response.ok) throw new Error("synthesis_failed");
    const result = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const parsed = JSON.parse(
      result.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}",
    );
    return {
      ...parsed,
      what_changed: firstCheck ? baselineFacts : parsed.what_changed,
      evidence,
    };
  } catch {
    return fallback;
  }
}
function exactKeys(
  value: unknown,
  required: string[],
  optional: string[] = [],
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key));
}
export function validateBrief(
  brief: {
    what_changed: unknown[];
    why_it_matters: unknown[];
    worth_doing: unknown[];
    evidence: unknown[];
  },
  observations: CurrentObservation[],
): void {
  if (
    !Array.isArray(brief.what_changed) || brief.what_changed.length < 1 ||
    brief.what_changed.length > 3 || !Array.isArray(brief.why_it_matters) ||
    brief.why_it_matters.length < 1 || brief.why_it_matters.length > 2 ||
    !Array.isArray(brief.worth_doing) ||
    brief.worth_doing.length < 1 || brief.worth_doing.length > 3 ||
    !Array.isArray(brief.evidence) ||
    brief.evidence.length !== observations.length
  ) throw new Error("invalid_synthesis");
  const sourceIds = new Set(observations.map((item) => item.sourceId));
  const evidenceIds = new Set<string>();
  const evidenceSource = new Map<string, string>();
  for (const item of brief.evidence) {
    if (
      !exactKeys(item, [
        "id",
        "source_id",
        "public_url",
        "checked_at",
        "observation",
      ], ["observed_at"])
    ) throw new Error("invalid_synthesis");
    const e = item as Record<string, unknown>;
    if (
      typeof e.id !== "string" || evidenceIds.has(e.id) ||
      typeof e.source_id !== "string" || !sourceIds.has(e.source_id) ||
      typeof e.public_url !== "string" || !/^https?:\/\//i.test(e.public_url) ||
      typeof e.checked_at !== "string" ||
      !Number.isFinite(Date.parse(e.checked_at)) ||
      typeof e.observation !== "string" || !e.observation.trim()
    ) throw new Error("invalid_synthesis");
    evidenceIds.add(e.id);
    evidenceSource.set(e.id, e.source_id);
  }
  const factIds = new Set<string>();
  for (const item of brief.what_changed) {
    if (
      !exactKeys(item, ["id", "text", "source_id", "evidence_id", "confidence"])
    ) throw new Error("invalid_synthesis");
    const f = item as Record<string, unknown>;
    if (
      typeof f.id !== "string" || factIds.has(f.id) ||
      typeof f.text !== "string" || !f.text.trim() ||
      typeof f.source_id !== "string" || !sourceIds.has(f.source_id) ||
      typeof f.evidence_id !== "string" || !evidenceIds.has(f.evidence_id) ||
      evidenceSource.get(f.evidence_id) !== f.source_id ||
      f.confidence !== "observed"
    ) throw new Error("invalid_synthesis");
    factIds.add(f.id);
  }
  for (const item of brief.why_it_matters) {
    if (!exactKeys(item, ["text", "evidence_ids", "confidence"])) {
      throw new Error("invalid_synthesis");
    }
    const i = item as Record<string, unknown>;
    if (
      typeof i.text !== "string" || !i.text.trim() ||
      i.confidence !== "interpretation" || !Array.isArray(i.evidence_ids) ||
      i.evidence_ids.length < 1 || i.evidence_ids.some((id) =>
        typeof id !== "string" || !evidenceIds.has(id)
      )
    ) {
      throw new Error("invalid_synthesis");
    }
  }
  const actionIds = new Set<string>();
  let primary = 0;
  for (const item of brief.worth_doing) {
    if (
      !exactKeys(item, ["id", "text", "kind", "confidence", "is_primary"], [
        "target_id",
      ])
    ) throw new Error("invalid_synthesis");
    const a = item as Record<string, unknown>;
    if (
      typeof a.id !== "string" || actionIds.has(a.id) ||
      typeof a.text !== "string" || !a.text.trim() ||
      typeof a.kind !== "string" || !a.kind.trim() ||
      a.confidence !== "suggested_action" || typeof a.is_primary !== "boolean"
    ) throw new Error("invalid_synthesis");
    actionIds.add(a.id);
    if (a.is_primary) primary += 1;
  }
  if (primary !== 1) throw new Error("invalid_synthesis");
  const serialized = canonical(brief);
  if (
    /revenue|market share|impressions|reach|footfall|ad spend/i.test(serialized)
  ) throw new Error("prohibited_metric");
}
export function providerSafeCode(error: unknown): string {
  const code = error instanceof Error ? error.message : "unreachable";
  return [
      "private",
      "removed",
      "invalid",
      "rate_limited",
      "unreachable",
      "unsupported",
      "disabled",
    ].includes(code)
    ? code
    : "unreachable";
}
function deterministicJitter(id: string): number {
  return parseInt(id.replaceAll("-", "").slice(0, 8), 16) % 21_601 * 1000;
}
export function nextWeeklyDue(id: string, nowMs = Date.now()): string {
  return new Date(nowMs + 7 * 86400000 + deterministicJitter(id)).toISOString();
}
async function finishJob(
  db: Db,
  job: ClaimedJob,
  outcome: "publish" | "no_change" | "failure" | "cancel",
  safeError: string | null,
  payload: Record<string, unknown> = {},
): Promise<{ applied: boolean; state?: string; brief_id?: string | null }> {
  const { data, error } = await db.rpc("issue_2725_finish_job", {
    p_job: job.id,
    p_owner: job.lease_owner,
    p_outcome: outcome,
    p_safe_error: safeError,
    p_expected_fp: job.source_set_fingerprint,
    p_expected_caps: job.capability_snapshot,
    p_payload: payload,
  });
  if (error) throw new Error("terminal_transition_failed");
  return (data ?? { applied: false }) as {
    applied: boolean;
    state?: string;
    brief_id?: string | null;
  };
}
async function cancel(db: Db, job: ClaimedJob, code: string): Promise<void> {
  await finishJob(db, job, "cancel", code);
}
async function finishFailure(
  db: Db,
  job: ClaimedJob,
  code: string,
): Promise<void> {
  await finishJob(db, job, "failure", code);
}
async function purgeOldLiveContent(
  db: Db,
  watchId: string,
  currentBriefId: string,
  currentObservationJobId: string,
): Promise<void> {
  const { data: briefs, error: briefsError } = await db.from(
    "tool_competitor_briefs",
  ).select(
    "id,job_id",
  ).eq("competitor_id", watchId).order("created_at", { ascending: false });
  if (briefsError) {
    console.error("[competitor-intel-worker] cleanup brief read failed", {
      watch_id: watchId,
    });
    return;
  }
  const current = (briefs ?? []).find((brief: Record<string, any>) =>
    brief.id === currentBriefId
  );
  const previous = (briefs ?? []).find((brief: Record<string, any>) =>
    brief.id !== currentBriefId
  );
  const keepBriefIds = new Set([currentBriefId, previous?.id].filter(Boolean));
  const orderedObservationJobs = [
    ...new Set(
      [currentObservationJobId, current?.job_id, previous?.job_id].filter(
        Boolean,
      ),
    ),
  ];
  const keepObservationJobs = new Set(orderedObservationJobs.slice(0, 2));
  const { data: observations, error: observationsError } = await db.from(
    "tool_competitor_observations",
  )
    .select("id,job_id").eq("competitor_id", watchId);
  if (observationsError) {
    console.error("[competitor-intel-worker] cleanup observation read failed", {
      watch_id: watchId,
    });
    return;
  }
  const staleObservationIds = (observations ?? []).filter((
    row: Record<string, any>,
  ) => !keepObservationJobs.has(row.job_id)).map((row: Record<string, any>) =>
    row.id
  );
  if (staleObservationIds.length) {
    const { error } = await db.from("tool_competitor_observations").delete().in(
      "id",
      staleObservationIds,
    );
    if (error) {
      console.error(
        "[competitor-intel-worker] cleanup observation delete failed",
        { watch_id: watchId },
      );
    }
  }
  for (
    const stale of (briefs ?? []).filter((brief: Record<string, any>) =>
      !keepBriefIds.has(brief.id)
    )
  ) {
    const { error } = await db.from("tool_competitor_briefs").delete().eq(
      "id",
      stale.id,
    );
    if (error) {
      console.error("[competitor-intel-worker] cleanup brief delete failed", {
        watch_id: watchId,
      });
    }
  }
}
async function housekeeping(db: Db): Promise<void> {
  const limits = [{
    table: "tool_competitor_refresh_jobs",
    column: "redacted_at",
    days: 90,
  }, {
    table: "tool_competitor_budget_ledger",
    column: "created_at",
    days: 400,
  }, {
    table: "tool_competitor_admin_actions",
    column: "created_at",
    days: 400,
  }];
  for (const item of limits) {
    const { data } = await db.from(item.table).select("id").lt(
      item.column,
      new Date(Date.now() - item.days * 86400000).toISOString(),
    ).limit(100);
    if ((data ?? []).length) {
      await db.from(item.table).delete().in(
        "id",
        (data ?? []).map((row: Record<string, any>) => row.id),
      );
    }
  }
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const cron = Deno.env.get("CRON_SECRET") ?? "";
  const bearer = (req.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (
    !bearer ||
    (!safeEqual(bearer, service) && (!cron || !safeEqual(bearer, cron)))
  ) return json({ error: "unauthenticated" }, 401);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (!url || !service) return json({ error: "server" }, 500);
  const db = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const owner = crypto.randomUUID();
  const { data, error } = await db.rpc("issue_2725_claim_jobs", {
    p_owner: owner,
    p_limit: WORKER_CLAIM_LIMIT,
  });
  if (error) {
    console.error("[competitor-intel-worker] claim failed", error.message);
    return json({ error: "server" }, 500);
  }
  await Promise.all(((data ?? []) as ClaimedJob[]).map(async (job) => {
    try {
      await processCompetitorJob(db, job);
    } catch (error) {
      console.error(
        "[competitor-intel-worker] job failed",
        job.id,
        error instanceof Error ? error.message : "unknown",
      );
      await finishFailure(db, job, "unreachable");
    }
  }));
  await housekeeping(db);
  return json({ ok: true, claimed: (data ?? []).length });
}
if (import.meta.main) serve(handler);
