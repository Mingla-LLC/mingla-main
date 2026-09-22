import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeCompetitorSource } from "../_shared/competitorSourceIdentity.ts";
import { observeCompetitorWebsite } from "../_shared/competitorWebsiteObservation.ts";
import { resolveGovernedAdField } from "../_shared/governedAdSecret.ts";
// issue #3526 — single source for the model id, endpoint, rates and thinking level.
import {
  GEMINI_API_BASE,
  GEMINI_INPUT_MICROUSD_PER_TOKEN,
  GEMINI_MODEL_ID as SHARED_GEMINI_MODEL_ID,
  GEMINI_OUTPUT_MICROUSD_PER_TOKEN,
  GEMINI_PRICING_VERSION,
  GEMINI_THINKING_LEVEL_MINIMAL,
  geminiErrorFingerprint,
} from "../_shared/geminiModel.ts";
// issue #3526 M-4 — Layer-C passive health observation. This worker recorded
// nothing at all, so the entire GEMINI_API_KEY surface was invisible to the
// health tables by construction.
import { recordApiCall } from "../_shared/apiHealthLog.ts";

export const ANALYZED_PROVIDER_ALLOWLIST = new Set(
  ["website", "instagram"] as const,
);
// raw provider response bodies remain in worker memory only and are discarded;
// only the bounded normalized observation contract below is persisted.
const MAX_OBSERVED_ITEMS = 20;
const OBSERVATION_WINDOW_DAYS = 28;
const RESERVED_MICROUSD = 50_000;
// issue #3526 — re-exported from _shared/geminiModel.ts. The receipts this
// worker writes name the model, so the export stays; the VALUE lives in one
// place. Line ~1500 used to hardcode the literal in the URL and ignore this
// constant entirely — that is the exact trap the single-source gate now blocks.
export const GEMINI_MODEL_ID = SHARED_GEMINI_MODEL_ID;
// issue #3541 — v3.5 states the output bounds in the instruction text. The
// version is part of the synthesis cache key AND of
// tool_competitor_synthesis_results' unique key, so bumping it is what stops a
// v3.4 result being reused for a v3.5 request.
export const PROMPT_CONTRACT_VERSION = "competitor-brief-v3.5";
// issue #3526 — stamped next to actual_microusd on every job row. Bumped in the
// same change as the rates: without it a $0.30-rate row and a $0.75-rate row
// are indistinguishable to a later reader.
export const PRICING_VERSION = GEMINI_PRICING_VERSION;
// issue #3541 — WHY THIS NUMBER. It is sized against SYNTHESIS_TIMEOUT_MS,
// not against the schema, and the derivation is here so the next person can
// check it instead of trusting it.
//
// WHAT WENT WRONG AT 1,200. The largest brief that ever passed validation was
// 955 candidate tokens (2026-08-29 03:08). 1,200 is 1.26x that — no margin at
// all. Ordinary model drift walked straight into it: finish_reason MAX_TOKENS
// with 1183 / 1189 / 1185 candidate tokens on three separate weeks and two
// different models, every one within six tokens of the ceiling. Output that
// clusters that tightly is a wall, not content.
//
// WHY THE TIMEOUT SETS THE NUMBER AND THE SCHEMA CANNOT.
// PROVIDER_RESPONSE_SCHEMA is deliberately unbounded — issue #2814 proved that
// minItems/maxItems/minimum/maximum on this schema make Gemini refuse the
// request outright ("the specified schema produces a constraint that has too
// many states for serving", HTTP 400, no candidate and no usage metadata at
// all), and the guard in issue2796_worker_v3_happy.test.ts keeps them out. So
// the only ceiling that can be raised here is the one the clock imposes.
//
//   Measured, 2026-09-22 receipt: 1,185 candidate tokens in 6,753 ms on
//   gemini-3.6-flash at thinking_level "minimal"
//     => 5.699 ms per output token (MEASURED_SYNTHESIS_MS_PER_OUTPUT_TOKEN)
//   Read pessimistically — the whole 6,753 ms treated as generation, no credit
//   for connect or time-to-first-token:
//     floor(15,000 / 5.699) = 2,632 tokens is all SYNTHESIS_TIMEOUT_MS can buy
//
//     2,200 = 83.6% of that wall, leaving ~2,460 ms of slack
//
//   Read with ~1,500 ms of connect + TTFT the model runs at ~225 tok/s, so
//   2,200 tokens takes ~11.3 s — comfortable under either reading. A budget
//   ABOVE 2,632 could only ever convert a truncation into a timeout abort,
//   which is a worse failure: an abort writes no usage metadata at all.
//
// HOW IT RELATES TO THE SHAPE THE VALIDATORS ACCEPT. The largest document
// validateBrief and validateDecisionReport would both accept — every array at
// its maximum and every free-text field at its character ceiling
// simultaneously — serializes to 10,351 characters, about 2,588 tokens at 4
// chars/token. That is ABOVE this budget and above the 2,632-token wall, so no
// budget can cover it inside 15 s. That ceiling is not what the model should
// be aiming at, and the v3.5 prompt now says so explicitly: the bounds live in
// the instruction text, where they cost the constrained decoder nothing. At
// 2,200 the budget is 2.3x the largest brief that has ever actually passed.
//
// HOW IT RELATES TO RESERVED_MICROUSD (50,000) — comfortable.
//   Output 2,200 x GEMINI_OUTPUT_MICROUSD_PER_TOKEN (3.75) = 8,250. Input is
//   capped by MAX_SYNTHESIS_REQUEST_BYTES (65,536 bytes, ~16,400 tokens) x
//   GEMINI_INPUT_MICROUSD_PER_TOKEN (0.75) = 12,300. Worst case ~20,550
//   microUSD against a 50,000 reservation — which matters because the receipts
//   table CHECKs actual_microusd <= reserved_microusd, so an overshoot would
//   fail the receipt write outright. Today's truncated call cost 5,796.
export const MAX_SYNTHESIS_OUTPUT_TOKENS = 2_200;
// The 2026-09-22 receipt, kept as numbers so the tests can redo the division
// rather than restate its answer.
export const MEASURED_SYNTHESIS_CANDIDATE_TOKENS = 1_185;
export const MEASURED_SYNTHESIS_LATENCY_MS = 6_753;
export const MEASURED_SYNTHESIS_MS_PER_OUTPUT_TOKEN =
  MEASURED_SYNTHESIS_LATENCY_MS / MEASURED_SYNTHESIS_CANDIDATE_TOKENS;
// issue #3541 — the result_class recorded when the provider stopped because it
// hit MAX_SYNTHESIS_OUTPUT_TOKENS. Distinct from "provider_error" on purpose:
// the call worked and the bill was paid, so the next reader must be sent to
// this file, not to Google's status page.
//
// Nothing constrains this value on the way in. issue_2725_record_model_usage
// writes p_receipt->>'result_class' straight into
// tool_competitor_model_usage_receipts.result_class, which is `text NOT NULL`
// with no CHECK and no enum; issue_2725_finish_job never reads result_class at
// all (it branches on p_safe_error); issue_2725_settle_zero_cost takes a
// p_result_class argument its body ignores. There is no dashboard or admin
// reader of the column. So a new value cannot break a consumer, and no
// migration is needed to introduce one.
export const RESULT_CLASS_OUTPUT_BUDGET_EXCEEDED = "output_budget_exceeded";
const MAX_SYNTHESIS_REQUEST_BYTES = 65_536;
const PROVIDER_TIMEOUT_MS = 12_000;
export const SYNTHESIS_TIMEOUT_MS = 15_000;
const WORKER_CLAIM_LIMIT = 3;
export const PROVIDER_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "what_changed",
    "why_it_matters",
    "worth_doing",
    "decision",
    "theme_signals",
    "interpretation_meta",
    "comparisons",
    "action_plan",
  ],
  properties: {
    what_changed: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "source_id", "evidence_id", "confidence"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          source_id: { type: "string" },
          evidence_id: { type: "string" },
          confidence: { type: "string", enum: ["observed"] },
        },
      },
    },
    why_it_matters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidence_ids", "confidence"],
        properties: {
          text: { type: "string" },
          evidence_ids: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: ["interpretation"] },
        },
      },
    },
    worth_doing: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "text", "kind", "confidence", "is_primary"],
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          kind: { type: "string" },
          confidence: { type: "string", enum: ["suggested_action"] },
          is_primary: { type: "boolean" },
          target_id: { type: "string" },
        },
      },
    },
    decision: {
      type: "object",
      additionalProperties: false,
      required: [
        "class",
        "confidence",
        "headline",
        "rationale",
        "signal_ids",
        "owner_fact_ids",
      ],
      properties: {
        class: { type: "string", enum: ["watch", "opportunity", "act"] },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        headline: { type: "string" },
        rationale: { type: "string" },
        signal_ids: { type: "array", items: { type: "string" } },
        owner_fact_ids: { type: "array", items: { type: "string" } },
      },
    },
    theme_signals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "kind",
          "derivation",
          "dimension",
          "label",
          "summary",
          "source_id",
          "evidence_ids",
          "metrics",
          "changed_paths",
        ],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["theme"] },
          derivation: { type: "string", enum: ["synthesis"] },
          dimension: {
            type: "string",
            enum: [
              "category",
              "positioning",
              "event_theme",
              "offer",
              "content_cadence",
              "source_presence",
            ],
          },
          label: { type: "string" },
          summary: { type: "string" },
          source_id: { type: "string" },
          evidence_ids: { type: "array", items: { type: "string" } },
          metrics: {
            type: "object",
            additionalProperties: false,
            required: [
              "posts_7d",
              "posts_28d",
              "images_28d",
              "videos_28d",
            ],
            properties: {
              posts_7d: { type: "integer", nullable: true },
              posts_28d: { type: "integer", nullable: true },
              images_28d: { type: "integer", nullable: true },
              videos_28d: { type: "integer", nullable: true },
            },
          },
          changed_paths: { type: "array", items: { type: "string" } },
        },
      },
    },
    interpretation_meta: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "index",
          "signal_type",
          "confidence",
          "priority",
          "signal_ids",
          "owner_fact_ids",
        ],
        properties: {
          index: { type: "integer" },
          signal_type: {
            type: "string",
            enum: ["threat", "opportunity", "neutral"],
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          priority: { type: "string", enum: ["high", "medium"] },
          signal_ids: { type: "array", items: { type: "string" } },
          owner_fact_ids: { type: "array", items: { type: "string" } },
        },
      },
    },
    comparisons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "dimension",
          "owner_text",
          "competitor_text",
          "outcome",
          "confidence",
          "signal_ids",
          "owner_fact_ids",
        ],
        properties: {
          id: { type: "string" },
          dimension: {
            type: "string",
            enum: [
              "category",
              "positioning",
              "event_theme",
              "offer",
              "content_cadence",
              "source_presence",
            ],
          },
          owner_text: { type: "string" },
          competitor_text: { type: "string" },
          outcome: {
            type: "string",
            enum: [
              "owner_advantage",
              "competitor_pressure",
              "different",
              "not_comparable",
            ],
          },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          signal_ids: { type: "array", items: { type: "string" } },
          owner_fact_ids: { type: "array", items: { type: "string" } },
        },
      },
    },
    action_plan: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "index",
          "action_id",
          "timeframe",
          "impact",
          "confidence",
          "order",
          "is_primary",
          "signal_ids",
          "owner_fact_ids",
        ],
        properties: {
          index: { type: "integer" },
          action_id: { type: "string" },
          timeframe: {
            type: "string",
            enum: ["this_week", "this_month", "bigger_project"],
          },
          impact: { type: "string", enum: ["high", "medium"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          order: { type: "integer" },
          is_primary: { type: "boolean" },
          signal_ids: { type: "array", items: { type: "string" } },
          owner_fact_ids: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;
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
export function geminiCostMicrousd(
  prompt: number,
  candidate: number,
  thinking: number,
): number {
  if (
    ![prompt, candidate, thinking].every(Number.isSafeInteger) || prompt < 0 ||
    candidate < 0 || thinking < 0
  ) throw new Error("invalid_usage_metadata");
  // issue #3526 — rates from the single source. microUSD per token:
  // input 0.75 (was 0.3), output 3.75 (was 2.5). Thinking bills as output and
  // is already included here — the asymmetry fixed in computeCostUsdGemini.
  return Math.ceil(
    prompt * GEMINI_INPUT_MICROUSD_PER_TOKEN +
      (candidate + thinking) * GEMINI_OUTPUT_MICROUSD_PER_TOKEN,
  );
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
interface VenueEventRow {
  id: string;
  title: string;
  description: string | null;
  startTimes: string[];
}
function narrowVenueEventRow(value: unknown): VenueEventRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string") return null;
  const dates = Array.isArray(row.event_dates) ? row.event_dates : [];
  const startTimes = dates.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const startAt = (value as Record<string, unknown>).start_at;
    return typeof startAt === "string" ? [startAt] : [];
  }).sort();
  return {
    id: row.id,
    title: row.title,
    description: typeof row.description === "string"
      ? row.description.slice(0, 500)
      : null,
    startTimes,
  };
}
type DecisionDimension =
  | "category"
  | "positioning"
  | "event_theme"
  | "offer"
  | "content_cadence"
  | "source_presence";
type DecisionReport = {
  decision: Record<string, unknown>;
  signals: Array<Record<string, unknown>>;
  signal_evidence: Array<Record<string, unknown>>;
  interpretation_meta: Array<Record<string, unknown>>;
  comparisons: Array<Record<string, unknown>>;
  action_plan: Array<Record<string, unknown>>;
  owner_facts: Array<Record<string, unknown>>;
};
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
  if (!listing) throw new Error("venue_context_read_failed");
  const { data: events, error: eventsError } = await db.from("events").select(
    "id,title,description,event_dates(start_at)",
  ).eq("brand_id", listing.brand_id).in("status", ["scheduled", "live"]).in(
    "visibility",
    ["public", "discover"],
  ).is("deleted_at", null).limit(20);
  if (eventsError) throw new Error("venue_context_read_failed");
  const eventRows: unknown[] = Array.isArray(events) ? events : [];
  return {
    listing: {
      id: listing.id,
      name: listing.name,
      city: listing.city ?? null,
      venue_category: listing.venue_category,
    },
    brand_published_events: eventRows.map(narrowVenueEventRow).filter(
      (event): event is VenueEventRow => event !== null,
    ).sort((left, right) => {
      const leftStart = left.startTimes[0] ?? "9999";
      const rightStart = right.startTimes[0] ?? "9999";
      return leftStart.localeCompare(rightStart) || left.id.localeCompare(right.id);
    }).slice(0, 5).map((event) => ({
      id: event.id,
      title: event.title,
      description: event.description,
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

const CURRENT_BRIEF_SCHEMA_VERSION = 3;

export function canFinishAsNoChange(
  current: {
    observation_set_fingerprint?: string | null;
    schema_version?: number | null;
  } | null,
  observationSetFingerprint: string,
): boolean {
  return current?.observation_set_fingerprint === observationSetFingerprint &&
    current.schema_version === CURRENT_BRIEF_SCHEMA_VERSION;
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
  const { data: reservation, error: reservationError } = await db.rpc(
    "issue_2725_reserve_budget",
    { p_job: job.id, p_owner: job.lease_owner, p_amount: RESERVED_MICROUSD },
  );
  if (reservationError || !reservation) return;
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
      "observation_set_fingerprint,updated_at,job_id,schema_version",
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
  if (canFinishAsNoChange(current, obsSet)) {
    await settleZeroCost(db, job, "no_change");
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
    { db, job },
  );
  validateBrief(brief, observations);
  validateDecisionReport(brief.decision_report, brief, observations);
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
    schema_version: 3,
    decision_report: brief.decision_report,
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
  const igUser = resolveGovernedAdField(
    "META_COMPETITOR_IG_USER_ID",
    "META_COMPETITOR_IG_USER_ID",
  ) ?? "";
  const token = resolveGovernedAdField(
    "META_COMPETITOR_ACCESS_TOKEN",
    "META_COMPETITOR_ACCESS_TOKEN",
  ) ?? "";
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

function numberOrNull(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 20
    ? Number(value)
    : null;
}

function normalizedDecisionText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
}

export function buildDecisionFoundation(
  observations: CurrentObservation[],
  comparisons: ObservationComparison[],
  venueContext: VenueContext,
): Pick<DecisionReport, "signals" | "signal_evidence" | "owner_facts"> {
  const comparisonBySource = new Map(comparisons.map((item) => [item.sourceId, item]));
  const signalEvidence = observations.slice(0, 8).map((observation, index) => ({
    id: `e${index + 1}`,
    source_id: observation.sourceId,
    source_url: observation.publicUrl,
    observation: concreteEvidenceObservation(observation).slice(0, 280),
    checked_at: observation.checkedAt,
    observed_at: observation.latestObservedAt,
  }));
  const signals: Array<Record<string, unknown>> = [];
  for (const [index, observation] of observations.entries()) {
    const facts = observation.facts as {
      cadence?: { posts_7d?: unknown; posts_28d?: unknown };
      items?: Array<{ format?: unknown }>;
    };
    const evidenceId = signalEvidence[index]?.id;
    if (!evidenceId) continue;
    const posts7d = numberOrNull(facts.cadence?.posts_7d);
    const posts28d = numberOrNull(facts.cadence?.posts_28d);
    const images28d = numberOrNull(
      facts.items?.filter((item) => item.format === "image").length ?? null,
    );
    const videos28d = numberOrNull(
      facts.items?.filter((item) => item.format === "video").length ?? null,
    );
    signals.push({
      id: `s-${observation.kind}-${index + 1}`,
      kind: observation.kind === "website" ? "website" : "profile",
      derivation: "deterministic",
      dimension: "positioning",
      label: observation.kind === "website" ? "Website positioning" : "Instagram profile",
      summary: signalEvidence[index].observation.slice(0, 180),
      source_id: observation.sourceId,
      evidence_ids: [evidenceId],
      metrics: { posts_7d: null, posts_28d: null, images_28d: null, videos_28d: null },
      changed_paths: [],
    });
    const realChangedPaths = comparisonBySource.get(observation.sourceId)?.before === null
      ? []
      : comparisonBySource.get(observation.sourceId)?.changedPaths ?? [];
    if (realChangedPaths.length > 0 && signals.length < 6) {
      signals.push({
        id: `s-delta-${index + 1}`,
        kind: "delta",
        derivation: "deterministic",
        dimension: "positioning",
        label: "Verified public change",
        summary: `Changed public fields: ${realChangedPaths.join(", ")}`.slice(0, 180),
        source_id: observation.sourceId,
        evidence_ids: [evidenceId],
        metrics: { posts_7d: null, posts_28d: null, images_28d: null, videos_28d: null },
        changed_paths: realChangedPaths,
      });
    }
    if (observation.kind === "instagram" && posts28d !== null && signals.length < 6) {
      signals.push({
        id: `s-cadence-${index + 1}`,
        kind: "cadence",
        derivation: "deterministic",
        dimension: "content_cadence",
        label: "Instagram cadence",
        summary: `${posts7d ?? 0} posts in 7 days · ${posts28d} in 28 days`,
        source_id: observation.sourceId,
        evidence_ids: [evidenceId],
        metrics: { posts_7d: posts7d, posts_28d: posts28d, images_28d: images28d, videos_28d: videos28d },
        changed_paths: [],
      });
    }
    if (observation.kind === "instagram" && (images28d !== null || videos28d !== null) && signals.length < 6) {
      signals.push({
        id: `s-format-${index + 1}`,
        kind: "format",
        derivation: "deterministic",
        dimension: "content_cadence",
        label: "Content format",
        summary: `${images28d ?? 0} images · ${videos28d ?? 0} videos in 28 days`,
        source_id: observation.sourceId,
        evidence_ids: [evidenceId],
        metrics: { posts_7d: posts7d, posts_28d: posts28d, images_28d: images28d, videos_28d: videos28d },
        changed_paths: [],
      });
    }
  }
  const ownerFacts: Array<Record<string, unknown>> = [];
  if (venueContext.listing) {
    ownerFacts.push({
      id: "of-listing-category",
      kind: "listing_category",
      entity_id: venueContext.listing.id,
      dimension: "category" satisfies DecisionDimension,
      text: venueContext.listing.venue_category.slice(0, 240),
    });
  }
  for (const event of venueContext.brand_published_events.slice(0, 5)) {
    ownerFacts.push({ id: `of-event-title-${event.id}`, kind: "event_title", entity_id: event.id,
      dimension: "event_theme" satisfies DecisionDimension, text: event.title.slice(0, 240) });
    if (event.description && ownerFacts.length < 11) {
      ownerFacts.push({ id: `of-event-description-${event.id}`, kind: "event_description", entity_id: event.id,
        dimension: "event_theme" satisfies DecisionDimension, text: event.description.slice(0, 240) });
    }
  }
  return { signals: signals.slice(0, 6), signal_evidence: signalEvidence, owner_facts: ownerFacts.slice(0, 11) };
}

export function groundedThemeSignals(
  value: unknown,
  existingSignals: Array<Record<string, unknown>>,
  signalEvidence: Array<Record<string, unknown>>,
  maxThemes: number,
): Array<Record<string, unknown>> {
  const dimensions = new Set<DecisionDimension>([
    "category",
    "positioning",
    "event_theme",
    "offer",
    "content_cadence",
    "source_presence",
  ]);
  const evidenceById = new Map(
    signalEvidence.flatMap((item) =>
      typeof item.id === "string" && typeof item.source_id === "string"
        ? [[item.id, item] as const]
        : []
    ),
  );
  const knownSourceIds = new Set(
    [...evidenceById.values()].map((item) => String(item.source_id)),
  );
  const usedIds = new Set(
    existingSignals.flatMap((item) =>
      typeof item.id === "string" ? [item.id] : []
    ),
  );
  const result: Array<Record<string, unknown>> = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (result.length >= Math.min(2, Math.max(0, maxThemes))) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const dimension = record.dimension as DecisionDimension;
    const label = normalizedDecisionText(record.label, 60);
    const summary = normalizedDecisionText(record.summary, 180);
    if (!dimensions.has(dimension) || !label || !summary) continue;
    const requestedEvidence = Array.isArray(record.evidence_ids)
      ? [...new Set(record.evidence_ids.filter((id): id is string =>
        typeof id === "string" && evidenceById.has(id)
      ))]
      : [];
    const requestedSource = typeof record.source_id === "string"
      ? record.source_id
      : null;
    const sourceId = requestedSource && knownSourceIds.has(requestedSource)
      ? requestedSource
      : requestedEvidence.length > 0
      ? String(evidenceById.get(requestedEvidence[0])?.source_id)
      : null;
    if (!sourceId) continue;
    let evidenceIds = requestedEvidence.filter((id) =>
      evidenceById.get(id)?.source_id === sourceId
    ).slice(0, 3);
    if (evidenceIds.length === 0) {
      const fallback = [...evidenceById].find(([, evidence]) =>
        evidence.source_id === sourceId
      )?.[0];
      if (!fallback) continue;
      evidenceIds = [fallback];
    }
    const requestedId = normalizedDecisionText(record.id, 64);
    let id = requestedId && !usedIds.has(requestedId) ? requestedId : null;
    if (!id) {
      let ordinal = result.length + 1;
      do id = `s-theme-${ordinal++}`; while (usedIds.has(id));
    }
    usedIds.add(id);
    result.push({
      id,
      kind: "theme",
      derivation: "synthesis",
      dimension,
      label,
      summary,
      source_id: sourceId,
      evidence_ids: evidenceIds,
      metrics: {
        posts_7d: null,
        posts_28d: null,
        images_28d: null,
        videos_28d: null,
      },
      changed_paths: [],
    });
  }
  return result;
}

export function groundedDecisionComparisons(
  value: unknown,
  signals: Array<Record<string, unknown>>,
  ownerFacts: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const signalById = new Map(signals.map((item) => [String(item.id), item]));
  const ownerById = new Map(ownerFacts.map((item) => [String(item.id), item]));
  const allowedDimensions = new Set<DecisionDimension>([
    "category",
    "positioning",
    "event_theme",
    "offer",
    "content_cadence",
    "source_presence",
  ]);
  const accepted: Array<Record<string, unknown>> = [];
  const usedIds = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    if (accepted.length >= 5) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const requestedSignalIds = Array.isArray(record.signal_ids)
      ? record.signal_ids.filter((id): id is string => typeof id === "string")
      : [];
    const requestedOwnerIds = Array.isArray(record.owner_fact_ids)
      ? record.owner_fact_ids.filter((id): id is string => typeof id === "string")
      : [];
    const referencedDimensions = [...new Set(requestedSignalIds.flatMap((id) => {
      const dimension = signalById.get(id)?.dimension;
      return allowedDimensions.has(dimension as DecisionDimension)
        ? [dimension as DecisionDimension]
        : [];
    }))];
    const requestedDimension = record.dimension as DecisionDimension;
    const dimension = allowedDimensions.has(requestedDimension)
      ? requestedDimension
      : referencedDimensions.length === 1 ? referencedDimensions[0] : null;
    if (!dimension) continue;
    const signalIds = [...new Set(requestedSignalIds.filter((id) =>
      signalById.get(id)?.dimension === dimension
    ))].slice(0, 3);
    if (signalIds.length === 0) continue;
    const ownerIds = [...new Set(requestedOwnerIds.filter((id) =>
      ownerById.get(id)?.dimension === dimension
    ))].slice(0, 3);
    const signal = signalById.get(signalIds[0]);
    const owner = ownerIds.length > 0 ? ownerById.get(ownerIds[0]) : null;
    const ownerText = normalizedDecisionText(record.owner_text, 140) ??
      normalizedDecisionText(owner?.text, 140) ??
      "No comparable verified Mingla venue signal";
    const competitorText = normalizedDecisionText(record.competitor_text, 140) ??
      normalizedDecisionText(signal?.summary, 140);
    if (!competitorText) continue;
    const requestedId = normalizedDecisionText(record.id, 64);
    let id = requestedId && !usedIds.has(requestedId) ? requestedId : null;
    if (!id) {
      let ordinal = accepted.length + 1;
      do id = `c-grounded-${ordinal++}`; while (usedIds.has(id));
    }
    usedIds.add(id);
    const requestedOutcome = String(record.outcome);
    const outcome = ownerIds.length === 0
      ? "not_comparable"
      : ["owner_advantage", "competitor_pressure", "different", "not_comparable"]
          .includes(requestedOutcome)
      ? requestedOutcome
      : "not_comparable";
    const requestedConfidence = String(record.confidence);
    accepted.push({
      id,
      dimension,
      owner_text: ownerText,
      competitor_text: competitorText,
      outcome,
      confidence: ["high", "medium", "low"].includes(requestedConfidence)
        ? requestedConfidence
        : "low",
      signal_ids: signalIds,
      owner_fact_ids: ownerIds,
    });
  }
  if (accepted.length > 0) return accepted;
  const signal = signals.find((item) =>
    allowedDimensions.has(item.dimension as DecisionDimension) &&
    typeof item.id === "string" && typeof item.summary === "string"
  );
  if (!signal) return [];
  const dimension = signal.dimension as DecisionDimension;
  const owner = ownerFacts.find((item) => item.dimension === dimension);
  return [{
    id: "c-grounded-1",
    dimension,
    owner_text: typeof owner?.text === "string"
      ? owner.text.slice(0, 140)
      : "No comparable verified Mingla venue signal",
    competitor_text: String(signal.summary).slice(0, 140),
    outcome: "not_comparable",
    confidence: "high",
    signal_ids: [signal.id],
    owner_fact_ids: owner && typeof owner.id === "string" ? [owner.id] : [],
  }];
}

export function groundedDecisionBindings(
  parsed: Record<string, unknown> | null,
  signals: Array<Record<string, unknown>>,
  ownerFacts: Array<Record<string, unknown>>,
  whyCount: number,
  actions: Array<Record<string, unknown>>,
): Pick<DecisionReport, "decision" | "interpretation_meta" | "action_plan"> {
  const signalIds = new Set(
    signals.flatMap((item) => typeof item.id === "string" ? [item.id] : []),
  );
  const ownerIds = new Set(
    ownerFacts.flatMap((item) => typeof item.id === "string" ? [item.id] : []),
  );
  const boundedIds = (
    value: unknown,
    allowed: Set<string>,
    fallback: string[] = [],
  ) => {
    const ids = Array.isArray(value)
      ? [...new Set(value.filter((id): id is string =>
        typeof id === "string" && allowed.has(id)
      ))].slice(0, 3)
      : [];
    return ids.length > 0 ? ids : fallback;
  };
  const fallbackSignalIds = signals.flatMap((item) =>
    typeof item.id === "string" ? [item.id] : []
  ).slice(0, 1);
  const decisionInput = parsed?.decision &&
      typeof parsed.decision === "object" && !Array.isArray(parsed.decision)
    ? parsed.decision as Record<string, unknown>
    : {};
  const decision = {
    class: ["watch", "opportunity", "act"].includes(
        String(decisionInput.class),
      )
      ? decisionInput.class
      : "watch",
    confidence: ["high", "medium", "low"].includes(
        String(decisionInput.confidence),
      )
      ? decisionInput.confidence
      : "low",
    headline: normalizedDecisionText(decisionInput.headline, 160) ??
      "Competitor signal reviewed",
    rationale: normalizedDecisionText(decisionInput.rationale, 240) ??
      "The available public signal should be reviewed against the venue's current plan.",
    signal_ids: boundedIds(
      decisionInput.signal_ids,
      signalIds,
      fallbackSignalIds,
    ),
    owner_fact_ids: boundedIds(decisionInput.owner_fact_ids, ownerIds),
  };
  const interpretationInput = Array.isArray(parsed?.interpretation_meta)
    ? parsed.interpretation_meta
    : [];
  const interpretation_meta = Array.from({ length: whyCount }, (_, index) => {
    const raw = interpretationInput[index] &&
        typeof interpretationInput[index] === "object" &&
        !Array.isArray(interpretationInput[index])
      ? interpretationInput[index] as Record<string, unknown>
      : {};
    return {
      index,
      signal_type: ["threat", "opportunity", "neutral"].includes(
          String(raw.signal_type),
        )
        ? raw.signal_type
        : "neutral",
      confidence: ["high", "medium", "low"].includes(String(raw.confidence))
        ? raw.confidence
        : "low",
      priority: ["high", "medium"].includes(String(raw.priority))
        ? raw.priority
        : "medium",
      signal_ids: boundedIds(raw.signal_ids, signalIds, fallbackSignalIds),
      owner_fact_ids: boundedIds(raw.owner_fact_ids, ownerIds),
    };
  });
  const actionInput = Array.isArray(parsed?.action_plan)
    ? parsed.action_plan
    : [];
  const action_plan = actions.map((action, index) => {
    const matched = actionInput.find((item) =>
      item && typeof item === "object" && !Array.isArray(item) &&
      (item as Record<string, unknown>).action_id === action.id
    );
    const indexed = actionInput[index];
    const raw = matched && typeof matched === "object" && !Array.isArray(matched)
      ? matched as Record<string, unknown>
      : indexed && typeof indexed === "object" && !Array.isArray(indexed)
      ? indexed as Record<string, unknown>
      : {};
    return {
      index,
      action_id: action.id,
      timeframe: action.is_primary === true
        ? "this_week"
        : ["this_week", "this_month", "bigger_project"].includes(
            String(raw.timeframe),
          )
        ? raw.timeframe
        : "this_month",
      impact: ["high", "medium"].includes(String(raw.impact))
        ? raw.impact
        : "medium",
      confidence: ["high", "medium", "low"].includes(String(raw.confidence))
        ? raw.confidence
        : "low",
      order: index + 1,
      is_primary: action.is_primary,
      signal_ids: boundedIds(raw.signal_ids, signalIds, fallbackSignalIds),
      owner_fact_ids: boundedIds(raw.owner_fact_ids, ownerIds),
    };
  });
  return { decision, interpretation_meta, action_plan };
}

export function primaryActionFirst(
  value: unknown,
): Array<Record<string, unknown>> {
  const actions = Array.isArray(value)
    ? value as Array<Record<string, unknown>>
    : [];
  const primary = actions.filter((item) =>
    item && typeof item === "object" && !Array.isArray(item) &&
    (item as Record<string, unknown>).is_primary === true
  );
  if (primary.length !== 1) return actions.slice(0, 3);
  return [
    primary[0],
    ...actions.filter((item) => item !== primary[0]).slice(0, 2),
  ];
}

export async function synthesizeBrief(
  name: string,
  city: string | null,
  observations: CurrentObservation[],
  comparisons: ObservationComparison[],
  venueContext: VenueContext,
  fetcher: typeof fetch,
  context?: { db: Db; job: ClaimedJob },
): Promise<
  {
    what_changed: unknown[];
    why_it_matters: unknown[];
    worth_doing: unknown[];
    evidence: unknown[];
    decision_report: DecisionReport;
  }
> {
  // The production caller resolves a live venue listing before synthesis. The
  // empty context branch preserves the exported v2 unit seam used by the
  // pre-v3 regression suite; processCompetitorJob can never publish it.
  const legacyV2Fixture = venueContext.listing === null;
  const foundation = buildDecisionFoundation(observations, comparisons, venueContext);
  const evidence = observations.map((o, index) => ({
    id: `e${index + 1}`,
    source_id: o.sourceId,
    public_url: o.publicUrl,
    checked_at: o.checkedAt,
    ...(o.latestObservedAt ? { observed_at: o.latestObservedAt } : {}),
    observation: concreteEvidenceObservation(o),
  }));
  const comparable = comparisons.filter((item) => item.before !== null);
  const firstCheck = comparable.length === 0;
  const baselineOnly = firstCheck ||
    comparable.every((item) => item.changedPaths.length === 0);
  const baselineFacts = observations.map((observation, index) => ({
    id: `f${index + 1}`,
    text: evidence[index].observation,
    source_id: observation.sourceId,
    evidence_id: `e${index + 1}`,
    confidence: "observed",
  }));
  const prompt = {
    name,
    city,
    first_check: firstCheck,
    must_not_claim_change: baselineOnly,
    before_after: comparisons.map((item, index) => ({
      source_id: item.sourceId,
      kind: item.kind,
      changed_paths: baselineOnly ? [] : item.changedPaths,
      evidence_id: `e${index + 1}`,
    })),
    deterministic_decision_foundation: foundation,
    contract: {
      max_facts: 3,
      max_interpretations: 2,
      max_actions: 3,
      decision_report_v3: true,
      exactly_one_primary: true,
      probabilistic: true,
      no_revenue_or_causal_claims: true,
      only_claim_changes_present_in_changed_paths: true,
      interpretations_and_actions_must_cite_venue_context_or_say_no_comparable_signal:
        true,
      output_shape: {
        what_changed:
          "1-3 objects: id,text,source_id,evidence_id,confidence=observed",
        why_it_matters:
          "1-2 objects: text,evidence_ids,confidence=interpretation",
        worth_doing:
          "1-3 objects: id,text,kind,confidence=suggested_action,is_primary,target_id(optional)",
        decision:
          "object: class,confidence,headline,rationale,signal_ids,owner_fact_ids",
        theme_signals:
          "0-2 objects: id,kind=theme,derivation=synthesis,dimension,label,summary,source_id,evidence_ids,metrics,changed_paths=[]",
        interpretation_meta:
          "one per why_it_matters: index,signal_type,confidence,priority,signal_ids,owner_fact_ids",
        comparisons:
          "0-5 objects: id,dimension,owner_text,competitor_text,outcome,confidence,signal_ids,owner_fact_ids",
        action_plan:
          "one per worth_doing: index,action_id,timeframe,impact,confidence,order,is_primary,signal_ids,owner_fact_ids",
      },
    },
  };
  const fingerprint = await sha256(canonical(prompt));
  if (context) {
    const { data: cached, error: cacheError } = await context.db.from(
      "tool_competitor_synthesis_results",
    )
      .select("result").eq("competitor_id", context.job.competitor_id).eq(
        "model_id",
        GEMINI_MODEL_ID,
      )
      .eq("prompt_contract_version", PROMPT_CONTRACT_VERSION).eq(
        "canonical_input_fingerprint",
        fingerprint,
      ).maybeSingle();
    if (cacheError) throw new Error("synthesis_cache_read_failed");
    if (cached?.result) {
      const reused = {
        ...cached.result,
        what_changed: baselineOnly
          ? sanitizeFirstCheckFacts(cached.result.what_changed, baselineFacts)
          : cached.result.what_changed,
        evidence,
        worth_doing: Array.isArray(cached.result.worth_doing)
          ? cached.result.worth_doing.map((action: Record<string, unknown>) =>
            typeof action?.text === "string" &&
              /review (?:the )?evidence/i.test(action.text)
              ? {
                ...action,
                text:
                  "Use this public observation to make one small, deliverable update to an existing venue event or listing this week.",
              }
              : action
          )
          : cached.result.worth_doing,
        decision_report: cached.result.decision_report,
      };
      validateBrief(reused, observations);
      if (!legacyV2Fixture) validateDecisionReport(reused.decision_report, reused, observations);
      await settleZeroCost(context.db, context.job, "accepted_reuse");
      return reused;
    }
  }
  // Production's shared Gemini secret owner is GEMINI_API_KEY. The legacy
  // name is a read-only deploy-transition bridge and must never restore the
  // zero-cost generic publication path.
  const key = Deno.env.get("GEMINI_API_KEY") ??
    Deno.env.get("GOOGLE_AI_API_KEY") ?? "";
  if (!key) throw new Error("model_configuration_missing");
  const requestBody = {
    contents: [{
      // issue #3541 — THE OUTPUT BOUNDS LIVE HERE, IN THE PROMPT, AND NOT IN
      // PROVIDER_RESPONSE_SCHEMA. That is not a stylistic choice.
      //
      // Issue #2814 proved that putting minItems/maxItems/minimum/maximum on
      // this schema makes Gemini refuse the whole request — "the specified
      // schema produces a constraint that has too many states for serving",
      // HTTP 400, no candidate and no usage metadata — and
      // issue2796_worker_v3_happy.test.ts guards them back out. That budget is
      // spent by responseJsonSchema alone; instruction text costs the
      // constrained decoder nothing, so it is the one lever that can bound the
      // answer without re-triggering that 400.
      //
      // Every number below is one the code ALREADY enforces or throws away.
      // Nothing here is invented:
      //   what_changed 3          validateBrief (length > 3 -> invalid_synthesis)
      //                           and parsed.what_changed.slice(0, 3)
      //   why_it_matters 2        validateBrief (length > 2) and
      //                           parsed.why_it_matters.slice(0, 2)
      //   worth_doing 3           validateBrief (length > 3) and
      //                           primaryActionFirst (primary + 2)
      //   exactly one primary     validateBrief (primary !== 1)
      //   theme_signals 2         groundedThemeSignals' Math.min(2, ...) and
      //                           validateDecisionReport (synthesizedThemes > 2)
      //   comparisons 5           groundedDecisionComparisons' `accepted.length
      //                           >= 5` break and validateDecisionReport
      //   changed_paths empty     groundedThemeSignals hardcodes [] and
      //                           validateDecisionReport throws on a synthesis
      //                           signal with any
      //   id arrays 3             boundedIds in groundedDecisionBindings and the
      //                           .slice(0, 3) calls in the other helpers
      //   240 / 180 / 160 / 140   the normalizedDecisionText and
      //                           boundedDecisionText ceilings on owner_facts
      //                           text and decision.rationale (240), signal
      //                           summary (180), decision.headline (160) and
      //                           comparison owner/competitor text (140)
      // The 240 on what_changed / why_it_matters / worth_doing text is the one
      // figure argued rather than copied: nothing downstream truncates those
      // three, so they take the contract's own sentence ceiling.
      //
      // These lines are instruction only. They do NOT relax validateBrief or
      // validateDecisionReport, and a model that ignores them still fails the
      // same way it always did.
      parts: [{
        text:
          `Return JSON only. Contract ${PROMPT_CONTRACT_VERSION}. Build a sourced venue-relevant competitor brief from this bounded before/after input: ${
            JSON.stringify(prompt)
          }
Length limits — anything past them is discarded before it is read, so spending output on it wastes the answer:
- what_changed: at most 3 items. why_it_matters: at most 2. worth_doing: at most 3, with exactly one is_primary true.
- theme_signals: at most 2, and changed_paths must always be [].
- comparisons: at most 5. interpretation_meta: exactly one per why_it_matters. action_plan: exactly one per worth_doing.
- Every signal_ids, owner_fact_ids and evidence_ids array: at most 3 ids, reused verbatim from the input.
- Free text ceilings, in characters: what_changed.text, why_it_matters.text, worth_doing.text and decision.rationale 240; theme_signals.summary 180; decision.headline 160; comparisons.owner_text and comparisons.competitor_text 140; theme_signals.label 60.
Write to those limits, not to the token budget. A shorter brief that stays inside them is correct; a longer one is cut off and thrown away.`,
      }],
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: PROVIDER_RESPONSE_SCHEMA,
      temperature: 0,
      seed: parseInt(fingerprint.slice(0, 8), 16) % 2147483647,
      // issue #3526 — Gemini 3 removed `thinkingBudget`; the replacement is
      // `thinking_level`. `minimal` is the floor and ONLY gemini-3.6-flash
      // offers it (3.7/3.8 stop at `low`), which is why the repin picked 3.6.
      // SYNTHESIS_TIMEOUT_MS (15s) and MAX_SYNTHESIS_OUTPUT_TOKENS (2,200) are
      // both sized for a non-thinking model; the default `medium` would blow
      // through both. issue #3541 raised the budget 1,200 -> 2,200 and this
      // line kept saying 1,200 — the exact class of defect #3541 was about, so
      // it is corrected rather than left: a reader chasing a truncation must
      // not be told the wrong live budget.
      thinkingConfig: { thinking_level: GEMINI_THINKING_LEVEL_MINIMAL },
      candidateCount: 1,
      maxOutputTokens: MAX_SYNTHESIS_OUTPUT_TOKENS,
    },
  };
  const serializedRequest = JSON.stringify(requestBody);
  const requestBytes = new TextEncoder().encode(serializedRequest).byteLength;
  if (requestBytes > MAX_SYNTHESIS_REQUEST_BYTES) {
    throw new Error("synthesis_request_too_large");
  }
  const started = Date.now();
  let response: Response;
  try {
    response = await fetchWithTimeout(
      fetcher,
      // issue #3526 — was a hardcoded 2.5 Flash model literal that ignored
      // GEMINI_MODEL_ID above, so repinning the constant alone left this worker
      // calling the retired model. Built from the shared constants now.
      `${GEMINI_API_BASE}/${GEMINI_MODEL_ID}:generateContent?key=${
        encodeURIComponent(key)
      }`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: serializedRequest,
      },
      SYNTHESIS_TIMEOUT_MS,
    );
  } catch {
    if (context) {
      const { error } = await context.db.rpc("issue_2725_record_model_usage", {
        p_job: context.job.id,
        p_owner: context.job.lease_owner,
        p_receipt: {
          model_id: GEMINI_MODEL_ID,
          prompt_contract_version: PROMPT_CONTRACT_VERSION,
          canonical_input_fingerprint: fingerprint,
          request_bytes: requestBytes,
          prompt_tokens: null,
          candidate_tokens: null,
          thinking_tokens: null,
          total_tokens: null,
          provider_model_version: null,
          latency_ms: Date.now() - started,
          finish_reason: null,
          result_class: "usage_missing",
          pricing_version: PRICING_VERSION,
          reserved_microusd: RESERVED_MICROUSD,
          actual_microusd: null,
          usage_complete: false,
        },
      });
      if (error) throw new Error("usage_receipt_write_failed");
    }
    throw new Error("usage_metadata_missing");
  }
  const result = await response.json().catch(() => ({})) as {
    error?: { status?: string; message?: string };
    candidates?: Array<
      { finishReason?: string; content?: { parts?: Array<{ text?: string }> } }
    >;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      totalTokenCount?: number;
    };
    modelVersion?: string;
  };
  // issue #3526 M-4 — Layer-C passive health observation. Fire-and-forget;
  // never awaited, never allowed to change this function's return.
  if (response.ok) {
    void recordApiCall("gemini", true, Date.now() - started, response.status); // ORCH-1201 Layer-C
  } else {
    const errorBody = JSON.stringify(result.error ?? {});
    // issue #3526 M-5 — status AND detail in ONE structured object so a reader
    // scanning for the status code cannot miss the sentence explaining it.
    console.error("[competitor-intel-worker] Gemini HTTP", {
      status: response.status,
      detail: errorBody.slice(0, 200),
    });
    void recordApiCall(
      "gemini",
      false,
      Date.now() - started,
      response.status,
      geminiErrorFingerprint(response.status, errorBody),
    ); // ORCH-1201 Layer-C
  }
  // issue #3541 — read once, used by the result classification below AND by
  // the receipt, so the two can never disagree about what the provider said.
  const finishReason = result.candidates?.[0]?.finishReason ?? null;
  const u = result.usageMetadata;
  const promptTokens = u?.promptTokenCount,
    candidateTokens = u?.candidatesTokenCount,
    thinkingTokens = u?.thoughtsTokenCount ?? 0,
    totalTokens = u?.totalTokenCount;
  const usageComplete =
    [promptTokens, candidateTokens, thinkingTokens, totalTokens].every((v) =>
      Number.isSafeInteger(v) && Number(v) >= 0
    ) &&
    totalTokens ===
      Number(promptTokens) + Number(candidateTokens) + Number(thinkingTokens);
  const actual = usageComplete
    ? geminiCostMicrousd(
      Number(promptTokens),
      Number(candidateTokens),
      Number(thinkingTokens),
    )
    : null;
  let parsed: Record<string, unknown> | null = null;
  if (response.ok) {
    try {
      parsed = JSON.parse(
        result.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
      );
    } catch {
      parsed = null;
    }
  }
  const themeSignals = groundedThemeSignals(
    parsed?.theme_signals,
    foundation.signals,
    foundation.signal_evidence,
    6 - foundation.signals.length,
  );
  const decisionSignals = [...foundation.signals, ...themeSignals];
  const whyItMatters = Array.isArray(parsed?.why_it_matters)
    ? parsed.why_it_matters.slice(0, 2)
    : [];
  const worthDoing = primaryActionFirst(parsed?.worth_doing);
  const bindings = groundedDecisionBindings(
    parsed,
    decisionSignals,
    foundation.owner_facts,
    whyItMatters.length,
    worthDoing,
  );
  const candidate = {
    why_it_matters: whyItMatters,
    worth_doing: worthDoing,
    what_changed: baselineOnly
      ? sanitizeFirstCheckFacts(parsed?.what_changed, baselineFacts)
      : Array.isArray(parsed?.what_changed) ? parsed.what_changed.slice(0, 3) : [],
    evidence,
    decision_report: {
      decision: bindings.decision,
      signals: decisionSignals,
      signal_evidence: foundation.signal_evidence,
      interpretation_meta: bindings.interpretation_meta,
      comparisons: groundedDecisionComparisons(
        parsed?.comparisons,
        decisionSignals,
        foundation.owner_facts,
      ),
      action_plan: bindings.action_plan,
      owner_facts: foundation.owner_facts,
    },
  };
  // issue #3541 — a MAX_TOKENS finish is OUR defect, not Google's.
  //
  // This used to record "provider_error", which is what sent the next reader
  // to check on Google for eleven days while the actual cause was
  // MAX_SYNTHESIS_OUTPUT_TOKENS. The HTTP call succeeded, the usage metadata
  // was complete, the bill was paid — the answer simply did not fit. That
  // deserves its own name, and RESULT_CLASS_OUTPUT_BUDGET_EXCEEDED points at
  // this file instead of at the provider.
  //
  // It wins over BOTH of the other failure classes below. Truncated JSON
  // usually fails to parse ("provider_error" before), but JSON that happens to
  // close cleanly at the cut parses and then fails validation
  // ("invalid_result" before) — the same defect must not report two different
  // names depending on where the knife landed.
  const outputBudgetExceeded = finishReason === "MAX_TOKENS";
  let resultClass = response.ok && parsed
    ? "accepted"
    : outputBudgetExceeded
    ? RESULT_CLASS_OUTPUT_BUDGET_EXCEEDED
    : "provider_error";
  if (usageComplete && parsed) {
    try {
      validateBrief(candidate, observations);
      if (!legacyV2Fixture) validateDecisionReport(candidate.decision_report, candidate, observations);
    } catch {
      resultClass = outputBudgetExceeded
        ? RESULT_CLASS_OUTPUT_BUDGET_EXCEEDED
        : "invalid_result";
    }
  }
  const outputBytes = new TextEncoder().encode(
    result.candidates?.[0]?.content?.parts?.[0]?.text ?? "",
  ).byteLength;
  console.info("[competitor-intel-worker] synthesis", {
    schema_version: 3,
    validation_outcome: usageComplete ? resultClass : "usage_missing",
    request_bytes: requestBytes,
    output_bytes: outputBytes,
    prompt_tokens: promptTokens ?? null,
    candidate_tokens: candidateTokens ?? null,
    thinking_tokens: thinkingTokens,
    total_tokens: totalTokens ?? null,
    actual_microusd: actual,
    state: response.ok ? "responded" : "provider_error",
    reused: false,
  });
  let receiptId: string | null = null;
  if (context) {
    const { data, error } = await context.db.rpc(
      "issue_2725_record_model_usage",
      {
        p_job: context.job.id,
        p_owner: context.job.lease_owner,
        p_receipt: {
          model_id: GEMINI_MODEL_ID,
          prompt_contract_version: PROMPT_CONTRACT_VERSION,
          canonical_input_fingerprint: fingerprint,
          request_bytes: requestBytes,
          prompt_tokens: promptTokens ?? null,
          candidate_tokens: candidateTokens ?? null,
          thinking_tokens: thinkingTokens,
          total_tokens: totalTokens ?? null,
          provider_model_version: result.modelVersion ?? null,
          latency_ms: Date.now() - started,
          finish_reason: finishReason,
          result_class: usageComplete ? resultClass : "usage_missing",
          pricing_version: PRICING_VERSION,
          reserved_microusd: RESERVED_MICROUSD,
          actual_microusd: actual,
          usage_complete: usageComplete,
        },
      },
    );
    if (error) throw new Error("usage_receipt_write_failed");
    receiptId = data;
  }
  if (!usageComplete) throw new Error("usage_metadata_missing");
  if (!response.ok || !parsed) throw new Error("synthesis_failed");
  validateBrief(candidate, observations);
  if (!legacyV2Fixture) validateDecisionReport(candidate.decision_report, candidate, observations);
  if (context) {
    const { data, error } = await context.db.rpc(
      "issue_2725_accept_synthesis",
      {
        p_job: context.job.id,
        p_owner: context.job.lease_owner,
        p_model: GEMINI_MODEL_ID,
        p_prompt_version: PROMPT_CONTRACT_VERSION,
        p_fingerprint: fingerprint,
        p_result: candidate,
        p_receipt: receiptId,
      },
    );
    if (error || !data) throw new Error("synthesis_accept_failed");
    validateBrief(data, observations);
    validateDecisionReport(data.decision_report, data, observations);
    return data;
  }
  return candidate as any;
}

function boundedText(value: unknown, max = 220): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

export function concreteEvidenceObservation(
  observation: CurrentObservation,
): string {
  const facts = observation.facts as {
    profile?: { name?: unknown; bio?: unknown };
    items?: Array<{ caption_excerpt?: unknown }>;
  };
  const caption = boundedText(
    facts?.items?.find((item) => boundedText(item?.caption_excerpt))
      ?.caption_excerpt,
  );
  const bio = boundedText(facts?.profile?.bio);
  const title = boundedText(facts?.profile?.name);
  if (observation.kind === "instagram") {
    if (caption) return `Instagram's public post says “${caption}”`;
    if (bio) return `Instagram's public profile says “${bio}”`;
    if (title) return `Instagram's public profile is named “${title}”`;
  } else {
    if (bio) return `The public website describes the venue as “${bio}”`;
    if (title) return `The public website title is “${title}”`;
  }
  throw new Error("insufficient_source_facts");
}

const HISTORICAL_FIRST_CHECK_CLAIM =
  /\b(changed|changed since|previously|used to|no longer|increased|decreased|started|stopped|new this week)\b/i;

function sanitizeFirstCheckFacts(
  value: unknown,
  fallback: Array<Record<string, unknown>>,
): unknown[] {
  if (!Array.isArray(value) || value.length < 1) return fallback;
  return value.map((fact, index) => {
    if (!fact || typeof fact !== "object") return fact;
    const record = fact as Record<string, unknown>;
    if (
      typeof record.text === "string" &&
      !HISTORICAL_FIRST_CHECK_CLAIM.test(record.text)
    ) return record;
    const replacement = fallback.find((candidate) =>
      candidate.evidence_id === record.evidence_id
    ) ?? fallback[Math.min(index, fallback.length - 1)] ?? fallback[0];
    return { ...record, text: replacement?.text };
  });
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
  if (
    /Mingla checked .*public|public information was checked|compared (?:with )?(?:this|the) venue.*bounded|review (?:the )?evidence/i
      .test(serialized)
  ) throw new Error("generic_intelligence");
}

function boundedDecisionText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

function boundedIds(
  value: unknown,
  min: number,
  max: number,
  known?: Set<string>,
): value is string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) return false;
  const seen = new Set<string>();
  return value.every((id) =>
    boundedDecisionText(id, 64) && !seen.has(id) &&
    (known === undefined || known.has(id)) && Boolean(seen.add(id))
  );
}

export function validateDecisionReport(
  report: unknown,
  brief: { why_it_matters: unknown[]; worth_doing: unknown[]; evidence: unknown[] },
  observations: CurrentObservation[],
): asserts report is DecisionReport {
  if (!exactKeys(report, ["decision", "signals", "signal_evidence", "interpretation_meta", "comparisons", "action_plan", "owner_facts"])) {
    throw new Error("invalid_decision_report");
  }
  const dimensions = new Set<DecisionDimension>(["category", "positioning", "event_theme", "offer", "content_cadence", "source_presence"]);
  const confidences = new Set(["high", "medium", "low"]);
  const sourceById = new Map(observations.map((item) => [item.sourceId, item]));
  if (!Array.isArray(report.signal_evidence) || report.signal_evidence.length < 1 || report.signal_evidence.length > 8) throw new Error("invalid_decision_report");
  const evidenceIds = new Set<string>();
  const evidenceSource = new Map<string, string>();
  for (const item of report.signal_evidence) {
    if (!exactKeys(item, ["id", "source_id", "source_url", "observation", "checked_at", "observed_at"])) throw new Error("invalid_decision_report");
    const source = sourceById.get(String(item.source_id));
    if (!boundedDecisionText(item.id, 64) || evidenceIds.has(item.id) || !source ||
      item.source_url !== source.publicUrl || !boundedDecisionText(item.observation, 280) ||
      typeof item.checked_at !== "string" || !Number.isFinite(Date.parse(item.checked_at)) ||
      (item.observed_at !== null && (typeof item.observed_at !== "string" || !Number.isFinite(Date.parse(item.observed_at))))) throw new Error("invalid_decision_report");
    evidenceIds.add(item.id);
    evidenceSource.set(item.id, source.sourceId);
  }
  if (!Array.isArray(report.signals) || report.signals.length < 1 || report.signals.length > 6) throw new Error("invalid_decision_report");
  const signalIds = new Set<string>();
  const signalDimension = new Map<string, DecisionDimension>();
  let synthesizedThemes = 0;
  for (const item of report.signals) {
    if (!exactKeys(item, ["id", "kind", "derivation", "dimension", "label", "summary", "source_id", "evidence_ids", "metrics", "changed_paths"]) ||
      !boundedDecisionText(item.id, 64) || signalIds.has(item.id) ||
      !["profile", "website", "content", "theme", "cadence", "format", "delta"].includes(String(item.kind)) ||
      !["deterministic", "synthesis"].includes(String(item.derivation)) || !dimensions.has(item.dimension as DecisionDimension) ||
      !boundedDecisionText(item.label, 60) || !boundedDecisionText(item.summary, 180) || !sourceById.has(String(item.source_id)) ||
      !boundedIds(item.evidence_ids, 1, 3, evidenceIds) || !exactKeys(item.metrics, ["posts_7d", "posts_28d", "images_28d", "videos_28d"]) ||
      !Array.isArray(item.changed_paths) || item.changed_paths.length > 8 || item.changed_paths.some((path) => !boundedDecisionText(path, 80)) ||
      (item.evidence_ids as string[]).some((id) => evidenceSource.get(id) !== item.source_id)) throw new Error("invalid_decision_report");
    const metrics = item.metrics as Record<string, unknown>;
    const metricValues = [metrics.posts_7d, metrics.posts_28d, metrics.images_28d, metrics.videos_28d];
    if (metricValues.some((metric) => metric !== null && (!Number.isInteger(metric) || Number(metric) < 0 || Number(metric) > 20))) throw new Error("invalid_decision_report");
    if (item.derivation === "synthesis") {
      if (item.kind !== "theme" || metricValues.some((metric) => metric !== null) || item.changed_paths.length > 0) throw new Error("invalid_decision_report");
      synthesizedThemes += 1;
    } else if (["cadence", "format", "delta"].includes(String(item.kind)) === false && item.kind === "theme") {
      throw new Error("invalid_decision_report");
    }
    signalIds.add(item.id);
    signalDimension.set(item.id, item.dimension as DecisionDimension);
  }
  if (synthesizedThemes > 2) throw new Error("invalid_decision_report");
  if (!Array.isArray(report.owner_facts) || report.owner_facts.length < 1 || report.owner_facts.length > 11) throw new Error("invalid_decision_report");
  const ownerIds = new Set<string>();
  const ownerDimension = new Map<string, DecisionDimension>();
  for (const item of report.owner_facts) {
    if (!exactKeys(item, ["id", "kind", "entity_id", "dimension", "text"]) || !boundedDecisionText(item.id, 64) || ownerIds.has(item.id) ||
      !["listing_category", "event_title", "event_description"].includes(String(item.kind)) || !boundedDecisionText(item.entity_id, 64) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(item.entity_id)) ||
      !dimensions.has(item.dimension as DecisionDimension) || !boundedDecisionText(item.text, 240)) throw new Error("invalid_decision_report");
    ownerIds.add(item.id);
    ownerDimension.set(item.id, item.dimension as DecisionDimension);
  }
  if (!exactKeys(report.decision, ["class", "confidence", "headline", "rationale", "signal_ids", "owner_fact_ids"]) ||
    !["watch", "opportunity", "act"].includes(String(report.decision.class)) || !confidences.has(String(report.decision.confidence)) ||
    !boundedDecisionText(report.decision.headline, 160) || !boundedDecisionText(report.decision.rationale, 240) ||
    !boundedIds(report.decision.signal_ids, 1, 3, signalIds) || !boundedIds(report.decision.owner_fact_ids, 0, 3, ownerIds)) throw new Error("invalid_decision_report");
  if (!Array.isArray(report.interpretation_meta) || report.interpretation_meta.length !== brief.why_it_matters.length) throw new Error("invalid_decision_report");
  report.interpretation_meta.forEach((item, index) => {
    if (!exactKeys(item, ["index", "signal_type", "confidence", "priority", "signal_ids", "owner_fact_ids"]) || item.index !== index ||
      !["threat", "opportunity", "neutral"].includes(String(item.signal_type)) || !confidences.has(String(item.confidence)) ||
      !["high", "medium"].includes(String(item.priority)) || !boundedIds(item.signal_ids, 1, 3, signalIds) || !boundedIds(item.owner_fact_ids, 0, 3, ownerIds)) throw new Error("invalid_decision_report");
  });
  if (!Array.isArray(report.comparisons) || report.comparisons.length > 5) throw new Error("invalid_decision_report");
  const comparisonIds = new Set<string>();
  for (const item of report.comparisons) {
    if (!exactKeys(item, ["id", "dimension", "owner_text", "competitor_text", "outcome", "confidence", "signal_ids", "owner_fact_ids"]) ||
      !boundedDecisionText(item.id, 64) || comparisonIds.has(String(item.id)) || !dimensions.has(item.dimension as DecisionDimension) || !boundedDecisionText(item.owner_text, 140) ||
      !boundedDecisionText(item.competitor_text, 140) || !["owner_advantage", "competitor_pressure", "different", "not_comparable"].includes(String(item.outcome)) ||
      !confidences.has(String(item.confidence)) || !boundedIds(item.signal_ids, 1, 3, signalIds) || !boundedIds(item.owner_fact_ids, 0, 3, ownerIds) ||
      (item.signal_ids as string[]).some((id) => signalDimension.get(id) !== item.dimension) ||
      (item.owner_fact_ids as string[]).some((id) => ownerDimension.get(id) !== item.dimension) ||
      (item.outcome !== "not_comparable" && (item.owner_fact_ids as string[]).length === 0)) throw new Error("invalid_decision_report");
    comparisonIds.add(String(item.id));
  }
  if (!Array.isArray(report.action_plan) || report.action_plan.length !== brief.worth_doing.length) throw new Error("invalid_decision_report");
  const baseActions = brief.worth_doing as Array<Record<string, unknown>>;
  const actionIds = new Set<string>();
  let primary = 0;
  report.action_plan.forEach((item, index) => {
    if (!exactKeys(item, ["index", "action_id", "timeframe", "impact", "confidence", "order", "is_primary", "signal_ids", "owner_fact_ids"]) ||
      item.index !== index || item.action_id !== baseActions[index]?.id || actionIds.has(String(item.action_id)) || item.order !== index + 1 ||
      !["this_week", "this_month", "bigger_project"].includes(String(item.timeframe)) || !["high", "medium"].includes(String(item.impact)) ||
      !confidences.has(String(item.confidence)) || typeof item.is_primary !== "boolean" || item.is_primary !== baseActions[index]?.is_primary ||
      !boundedIds(item.signal_ids, 1, 3, signalIds) || !boundedIds(item.owner_fact_ids, 0, 3, ownerIds)) throw new Error("invalid_decision_report");
    if (item.is_primary) {
      primary += 1;
      if (item.order !== 1 || item.timeframe !== "this_week") throw new Error("invalid_decision_report");
    }
    actionIds.add(String(item.action_id));
  });
  if (primary !== 1) throw new Error("invalid_decision_report");
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
async function settleZeroCost(
  db: Db,
  job: ClaimedJob,
  resultClass: string,
): Promise<void> {
  const { error } = await db.rpc("issue_2725_settle_zero_cost", {
    p_job: job.id,
    p_owner: job.lease_owner,
    p_result_class: resultClass,
  });
  if (error) throw new Error("budget_settlement_failed");
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
  }, {
    table: "tool_competitor_model_usage_receipts",
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
      const message = error instanceof Error ? error.message : "unknown";
      const safeCode = [
          "usage_metadata_missing",
          "usage_receipt_write_failed",
        ].includes(message)
        ? "model_usage_missing"
        : [
            "synthesis_failed",
            "synthesis_accept_failed",
            "invalid_synthesis",
            "invalid_decision_report",
            "prohibited_metric",
          ].includes(message)
        ? "model_response_invalid"
        : "unreachable";
      console.error(
        "[competitor-intel-worker] job failed",
        job.id,
        message,
      );
      await finishFailure(db, job, safeCode);
    }
  }));
  await housekeeping(db);
  return json({ ok: true, claimed: (data ?? []).length });
}
if (import.meta.main) serve(handler);
