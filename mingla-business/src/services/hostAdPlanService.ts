/**
 * Issue #3697 v1.4 — Host Ads immutable-plan client.
 *
 * This is the same server-owned plan used by Admin and Ari. The client never
 * supplies currency or provider money: it sends amounts in the brand's verified
 * settlement currency and the server freezes account currency + FX authority.
 */

import { edgeErrorCode } from "./edgeErrorCode";
import { supabase } from "./supabase";
import type { AdVideoFit } from "../utils/adVideoFit";
import {
  HOST_AD_SALES_PLATFORMS,
  hostAdPageSellsTickets,
} from "../components/marketing/ads/hostAdGoal";
import {
  HOST_AD_OWNED_ERROR_COPY,
  hostAdVideoFailedMessage,
  hostAdVideoPendingMessage,
} from "../components/marketing/ads/hostAdCopy";
import {
  type HostAdAvailabilityRow,
  type HostAdInterestPick,
  type HostAdPlace,
  hostAdPlaceForSave,
  hostAdRefsForApp,
  hostAdSelectionsFromCanonical,
  placeKind,
} from "../components/marketing/ads/hostAdTargeting";

const PREPARED_VIDEO_PLATFORMS = new Set([
  "meta",
  "google",
  "tiktok",
  "snapchat",
]);

type PrepareEnvelope = {
  state?: string;
  retry_after_seconds?: number | null;
  error?: { message?: string } | null;
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type HostAdPlatform =
  "meta" | "tiktok" | "snapchat" | "google" | "reddit";

export type HostAdPage = {
  page_type: string;
  id: string;
  brand_slug: string;
  entity_slug: string | null;
  title: string;
  brand_name: string;
  canonical_url: string;
  availability: string;
  starts_at: string | null;
  city: string | null;
  cover_url: string | null;
  result_kind: string | null;
  /**
   * #4238: the server's verdict and, for dated pages, the next date, how many
   * dates are left, the last moment anyone can book and the page's time zone.
   * A page with `ok: false` is shown greyed out with its reason.
   */
  ok?: boolean;
  availability_reason?: string | null;
  next_date?: string | null;
  last_bookable_at?: string | null;
  dates_remaining?: number | null;
  timezone?: string | null;
};

/** #4238: what this ad optimises for on each platform (frozen in the plan). */
export type HostAdOptimization = "visits" | "sales";

export {
  HOST_AD_SALES_PAGE_TYPES,
  HOST_AD_SALES_PLATFORMS,
  hostAdPageSellsTickets,
  hostOptimizationSummary,
} from "../components/marketing/ads/hostAdGoal";

/**
 * #4238 D1: the server decides which provider account a Host ad uses; the
 * client never sees or sends a lane.
 */
export type HostAdConnection = {
  id: string;
  platform: HostAdPlatform;
  currency: string;
  status: string;
  connected: boolean;
  /** Read-only preview of the server's Sales signal gate. */
  sales: { ready: boolean; reason: string };
};

/** #4238 media-buyer: a place (city, region or pin) matched on each app. */
export type HostAdTargetingCity = HostAdPlace;

/** #4238 media-buyer: an interest matched on each app separately. */
export type HostAdTargetingInterest = HostAdInterestPick;

export type HostAdTargetingSearchResult = {
  id: string;
  name: string;
  meta: Record<string, unknown>;
};

export type HostAdCreative = {
  id: string;
  name: string;
  kind: "video";
  status: "active";
  source_url: string | null;
  poster_url: string | null;
  mp4_master_url: string | null;
  bunny_video_id: string | null;
  duration_seconds: number | null;
  aspect_ratio: number | null;
  created_at: string;
  /**
   * #3040 AD-04 — per connected platform, judged server-side by the shared ads
   * channel matrix. Absent on servers older than #3040.
   */
  fit?: AdVideoFit[];
};

export type HostAdPlanRow = {
  id: string;
  state: string;
  current_version_id: string | null;
  destination_key: string;
  review_required: boolean;
  review_reasons: string[];
  updated_at: string;
};

export type HostAdDraft = {
  id: string;
  client_kind: "host" | "ari";
  owner_kind: "host";
  brand_id: string;
  plan_id: string | null;
  revision: number;
  current_step: string;
  draft_state: Record<string, unknown>;
  updated_at: string;
};

/** #4238 wave 2: the state of one audience on one ad app. */
export type HostAdAudiencePlatformState = {
  platform: HostAdPlatform;
  state:
    | "pending"
    | "below_minimum"
    | "syncing"
    | "ready"
    | "too_small"
    | "terms_required"
    | "ineligible"
    | "unsupported"
    | "error"
    | "retired";
  neededCount: number | null;
};

/** #4238 wave 2: the brand's own audience, names and rough sizes only. */
export type HostAdAudience = {
  audienceKey: string;
  name: string;
  kind: "list" | "lookalike";
  approxSize: number | null;
  lookalikeCountry: string | null;
  platforms: HostAdAudiencePlatformState[];
};

/** Server rows → typed audiences. Unknown shapes are dropped, never guessed. */
export function hostAdAudiencesFromSetup(raw: unknown): HostAdAudience[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): HostAdAudience[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.audience_key !== "string" || !row.audience_key) return [];
    const platforms = Array.isArray(row.platforms) ? row.platforms : [];
    return [{
      audienceKey: row.audience_key,
      name: typeof row.display_name === "string" ? row.display_name : "",
      kind: row.kind === "lookalike" ? "lookalike" : "list",
      approxSize:
        typeof row.approx_size === "number" && Number.isFinite(row.approx_size)
          ? row.approx_size
          : null,
      lookalikeCountry:
        typeof row.lookalike_country === "string"
          ? row.lookalike_country
          : null,
      platforms: platforms.flatMap((value): HostAdAudiencePlatformState[] => {
        if (!value || typeof value !== "object") return [];
        const state = value as Record<string, unknown>;
        if (typeof state.platform !== "string" || typeof state.state !== "string") {
          return [];
        }
        return [{
          platform: state.platform as HostAdPlatform,
          state: state.state as HostAdAudiencePlatformState["state"],
          neededCount:
            typeof state.needed_count === "number" ? state.needed_count : null,
        }];
      }),
    }];
  });
}

export type HostAdSetup = {
  /** false when no ad platform is ready for Hosts yet. */
  available: boolean;
  /** brands.country_code, upper-cased ISO-3166 alpha-2, or null. */
  brand_country_code: string | null;
  currency: string;
  pages: HostAdPage[];
  connections: HostAdConnection[];
  creatives: HostAdCreative[];
  plans: HostAdPlanRow[];
  /** #4238 wave 2: the brand's own audiences ([] when none or unavailable). */
  audiences: HostAdAudience[];
  /** "unavailable" when the audiences could not be loaded. */
  audiences_error?: "unavailable";
  /** #4238: apps staff marked as not running in a country, with the reason. */
  availability?: HostAdAvailabilityRow[];
  /** #4238: apps that give a reach number (staff switch). */
  reach_enabled?: Partial<Record<HostAdPlatform, boolean>>;
  /** #4238: each app's daily minimum in the brand's money (visits / sales). */
  minimums?: {
    platform: HostAdPlatform;
    visits_daily_minimum_cents?: number;
    sales_daily_minimum_cents?: number;
  }[];
};

export type TargetingSnapshot = {
  platform: HostAdPlatform;
  verdict: "exact" | "broader" | "unavailable" | "check_required";
  widening_summary: string[];
  checks_required: string[];
  broader_accepted: boolean;
  audience_intent: Record<string, unknown>;
  compiled_targeting: Record<string, unknown>;
  provider_estimate: {
    state: string;
    quality: "provider_estimate" | "unavailable";
    source: string;
    unit: "potential_reach";
    lower_bound: number | null;
    upper_bound: number | null;
    period: string | null;
    assumptions: string[];
    non_additive: true;
    detail: string;
  } | null;
  estimate_observed_at: string | null;
};

export type HostAdPlanAggregate = {
  plan: HostAdPlanRow & { brand_id: string; owner_kind: "host" };
  version: {
    id: string;
    plan_hash: string;
    host_currency: string;
    host_budget_cents: number;
    canonical_plan: Record<string, unknown>;
  };
  provider_allocations: Record<string, unknown>[];
  targeting_snapshots: TargetingSnapshot[];
  reviews: {
    decision: "approved" | "changes_requested" | "rejected";
    reason: string | null;
    decided_at: string;
  }[];
  funding_hold: Record<string, unknown> | null;
  provider_attempts: Record<string, unknown>[];
  campaigns: Record<string, unknown>[];
};

/**
 * #4238 P0 (F-10): the Host's picks, read back by key from the plan itself
 * (`canonical_plan.targeting_selection`). Never by the compiled array index:
 * one app's missing match used to shift the next ids onto the wrong place.
 */
export function hostTargetingSelectionsFromAggregate(
  aggregate: HostAdPlanAggregate,
): {
  cities: HostAdTargetingCity[];
  excluded: HostAdTargetingCity[];
  interests: HostAdTargetingInterest[];
  radiusKm: number | null;
} {
  const canonical = aggregate.version.canonical_plan;
  const audience = canonical.audience_intent as
    Record<string, unknown> | undefined;
  const picks = hostAdSelectionsFromCanonical(canonical);
  return {
    cities: picks.places,
    excluded: picks.excluded,
    interests: picks.interests,
    radiusKm: typeof audience?.radiusKm === "number" ? audience.radiusKm : null,
  };
}

export class HostAdPlanError extends Error {
  readonly code: string;
  readonly detail: string;

  constructor(code: string, detail: string) {
    super(detail);
    this.name = "HostAdPlanError";
    this.code = code;
    this.detail = detail;
  }
}

async function invoke<T>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
  });
  if (error !== null) {
    type EdgePayload = { error?: string; detail?: unknown; message?: string };
    let payload: EdgePayload | null = null;
    try {
      const response = (error as { context?: Response }).context;
      if (response && typeof response.json === "function") {
        payload = (await response.json()) as EdgePayload;
      }
    } catch {
      payload = null;
    }
    // #4238: never use the SDK's own text ("Edge Function returned a non-2xx
    // status code") as detail; the Host would read it. Fall back to the
    // server's code, then to a neutral code.
    const rawDetail =
      payload?.detail ?? payload?.message ?? payload?.error ?? "request_failed";
    const detail =
      typeof rawDetail === "string" ? rawDetail : JSON.stringify(rawDetail);
    throw new HostAdPlanError(payload?.error ?? "network", detail);
  }
  // #4238: an edge envelope carries `error: null` on success, and
  // admin-ad-creative-prepare carries an error OBJECT beside `state:"failed"`
  // so its caller can retry. Fail only on a real error code string.
  if (edgeErrorCode(data) !== null) {
    const payload = data as { error: string; detail?: unknown };
    throw new HostAdPlanError(
      payload.error,
      typeof payload.detail === "string"
        ? payload.detail
        : JSON.stringify(payload.detail ?? payload.error),
    );
  }
  return data as T;
}

export async function loadHostAdSetup(brandId: string): Promise<HostAdSetup> {
  const result = await invoke<
    { ok: true } & Omit<HostAdSetup, "audiences"> & { audiences?: unknown }
  >("ad-plan", {
    action: "host_setup",
    brand_id: brandId,
  });
  return { ...result, audiences: hostAdAudiencesFromSetup(result.audiences) };
}

export async function searchHostAdTargeting(input: {
  brandId: string;
  platform: HostAdPlatform;
  kind: "city" | "interest" | "region" | "pin" | "language";
  query: string;
  country?: string | null;
}): Promise<HostAdTargetingSearch> {
  // #4238: `match: true` asks the server's one per-app matcher
  // (I-4238-PER-APP-MATCH); `unavailable` marks an app error.
  return invoke("admin-ad-targeting-search", {
    brand_id: input.brandId,
    owner_kind: "host",
    platform: input.platform,
    kind: input.kind,
    q: input.query,
    match: true,
    ...(input.country ? { country: input.country } : {}),
  });
}

export type HostAdTargetingSearch = {
  results: HostAdTargetingSearchResult[];
  warning?: string;
  /** #4238: the app errored; never read this as "not found". */
  unavailable?: boolean;
  /** #4238: the app's results one level up (TikTok PROVINCE). */
  wider?: HostAdTargetingSearchResult[];
  match?: {
    state?: "match" | "wider" | "none";
    best?: HostAdTargetingSearchResult;
    wider?: HostAdTargetingSearchResult;
  };
};

/**
 * #4238: one app's lookup for the builder. A thrown error (network, edge)
 * reads as "Couldn't check", exactly like a provider error.
 */
export async function lookupHostAdTargeting(
  input: Parameters<typeof searchHostAdTargeting>[0],
): Promise<HostAdTargetingSearch | null> {
  try {
    return await searchHostAdTargeting(input);
  } catch {
    return null;
  }
}

export async function getHostAdPlan(
  planId: string,
): Promise<HostAdPlanAggregate> {
  return invoke<HostAdPlanAggregate>("ad-plan", {
    action: "get",
    plan_id: planId,
  });
}

export async function getHostAdDraft(draftId: string): Promise<HostAdDraft> {
  const result = await invoke<{ draft: HostAdDraft }>("ad-plan", {
    action: "get_draft",
    draft_id: draftId,
  });
  return result.draft;
}

export async function saveHostAdDraft(input: {
  draftId: string;
  brandId: string;
  expectedRevision: number;
  currentStep: string;
  draftState: Record<string, unknown>;
  planId?: string | null;
}): Promise<HostAdDraft> {
  const result = await invoke<{ draft: HostAdDraft }>("ad-plan", {
    action: "save_draft",
    draft_id: input.draftId,
    client_kind: "host",
    owner_kind: "host",
    brand_id: input.brandId,
    expected_revision: input.expectedRevision,
    current_step: input.currentStep,
    draft_state: input.draftState,
    plan_id: input.planId ?? null,
  });
  return result.draft;
}

const HOST_PLAN_IN_PROGRESS_STATES = new Set([
  "validating",
  "ready_for_funding",
  "funding_pending",
  "funded_held",
  "staff_review_required",
  "staff_approved",
  "changes_requested",
  "creating_paused_objects",
  "creation_failed_retryable",
  "creation_failed_terminal",
]);

export async function listHostAdPlans(
  brandId: string,
): Promise<HostAdPlanAggregate[]> {
  return (await listHostAdWorkspace(brandId)).plans;
}

/**
 * #4238: plan states that mean the ad was created on the apps (live, ended
 * and everything between). A draft for such a plan is finished, not open.
 */
const HOST_PLAN_LAUNCHED_STATES = new Set([
  "platform_review",
  "scheduled",
  "live",
  "pause_requested",
  "paused",
  "stop_requested",
  "settling",
  "ended",
  "platform_rejected",
  "partially_ready",
  "partially_live",
  "settlement_attention_required",
]);

export async function listHostAdWorkspace(brandId: string): Promise<{
  plans: HostAdPlanAggregate[];
  drafts: HostAdDraft[];
  launchedPlanIds: string[];
  planIdByVersionId: Record<string, string>;
}> {
  const result = await invoke<{
    plans: HostAdPlanRow[];
    drafts: HostAdDraft[];
  }>("ad-plan", {
    action: "list",
    brand_id: brandId,
    include_drafts: true,
  });
  const rows = (result.plans ?? []).filter(
    (plan) =>
      typeof plan.current_version_id === "string" &&
      HOST_PLAN_IN_PROGRESS_STATES.has(plan.state),
  );
  const settled = await Promise.allSettled(
    rows.map((plan) => getHostAdPlan(plan.id)),
  );
  return {
    plans: settled.flatMap((item) =>
      item.status === "fulfilled" ? [item.value] : [],
    ),
    drafts: result.drafts ?? [],
    launchedPlanIds: (result.plans ?? [])
      .filter((plan) => HOST_PLAN_LAUNCHED_STATES.has(plan.state))
      .map((plan) => plan.id),
    planIdByVersionId: Object.fromEntries(
      (result.plans ?? []).flatMap((plan) =>
        typeof plan.current_version_id === "string"
          ? [[plan.current_version_id, plan.id]]
          : [],
      ),
    ),
  };
}

export type PrepareHostAdPlanInput = {
  brandId: string;
  existingPlanId?: string | null;
  page: HostAdPage;
  connections: HostAdConnection[];
  creative: HostAdCreative;
  name: string;
  primaryText: string;
  headline: string;
  countries: string[];
  cities: HostAdTargetingCity[];
  /** The shared distance for places saved before per-place distances. */
  radiusKm: number | null;
  interests: HostAdTargetingInterest[];
  /** #4238: places to leave out. */
  excludedPlaces?: HostAdTargetingCity[];
  /** #4238: ISO 639-1 codes; empty = every language. */
  languages?: string[];
  /** #4238: Meta's own locale key per language code. */
  languageIds?: Record<string, string>;
  ageMin: number;
  ageMax: number;
  gender: "all" | "men" | "women";
  dailyBudgetCents: number;
  capCents: number;
  startsAt?: string | null;
  endsAt?: string | null;
  acceptBroader: boolean;
  rightsConfirmed: boolean;
  rightsBasis: "owned" | "licensed" | "authorized_by_brand";
  aiGenerated: boolean;
  optimization: HostAdOptimization;
  /** #4238 wave 2: the brand's own audience keys (0-3). */
  audienceKeys?: string[];
  /** #4238 P1: leave out people who already bought (the brand's past guests). */
  excludePastBuyers?: boolean;
  /** #4238 P1: the button (frozen; the server maps it to each app's own). */
  cta?: "tickets" | "book" | "signup" | "learn";
  /** #4238 P1: how the Host set the budget (total for the run, or per day). */
  budgetMode?: "total" | "daily";
  /**
   * #4238 P1: per-app daily and cap shares, in `connections` order
   * (minimums first, then even). Absent: an even split, as before.
   */
  shares?: { dailyCents: number[]; capCents: number[] };
};

export type PreparedHostAdPlan = {
  planId: string;
  versionId: string;
  planHash: string;
  status: "ready" | "broader" | "blocked";
  targeting: TargetingSnapshot[];
  measurement: Record<string, unknown> | null;
  mediaRights: Record<string, unknown> | null;
  /** #4238: the frozen per-platform goal; absent on plans saved before it. */
  optimizationByPlatform?: Record<string, unknown> | null;
  providerValidations: {
    platform: HostAdPlatform;
    result: Record<string, unknown>;
  }[];
};

function splitCents(total: number, count: number): number[] {
  if (!Number.isSafeInteger(total) || total <= 0 || count <= 0) return [];
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from(
    { length: count },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

/**
 * #4238: the per-platform goal frozen into the plan hash. "sales" only where
 * the page sells tickets, the platform has a sales path and its signal is
 * ready; everything else optimises for page visits. The server re-validates.
 */
export function hostOptimizationByPlatform(
  optimization: HostAdOptimization,
  page: Pick<HostAdPage, "page_type" | "result_kind">,
  connections: Pick<HostAdConnection, "platform" | "sales">[],
): Record<string, HostAdOptimization> {
  return Object.fromEntries(
    connections.map((connection) => [
      connection.platform,
      optimization === "sales" &&
      hostAdPageSellsTickets(page) &&
      connection.sales?.ready === true &&
      HOST_AD_SALES_PLATFORMS.includes(connection.platform)
        ? "sales"
        : "visits",
    ]),
  );
}

/**
 * #4238: the only refs a Host client may send. Audience ids are deliberately
 * absent: they come from audience_selection, resolved on the server.
 */
export type HostTargetingRefs = {
  locationIds?: Record<string, string>;
  interestIds?: Record<string, string>;
  languageIds?: Record<string, string>;
  includeAudienceIds?: never;
  excludeAudienceIds?: never;
  advantageAudience?: never;
};

/**
 * #4238: the audience and per-app ids a Host plan (and a reach read) sends.
 * One owner, so the reach number is for exactly the plan that is checked.
 */
export function buildHostAudience(
  input: Pick<
    PrepareHostAdPlanInput,
    | "countries"
    | "cities"
    | "radiusKm"
    | "interests"
    | "ageMin"
    | "ageMax"
    | "gender"
    | "excludedPlaces"
    | "languages"
    | "languageIds"
    | "connections"
  >,
): {
  audienceIntent: Record<string, unknown>;
  refsByPlatform: Record<string, HostTargetingRefs>;
  excludedPlaces: HostAdTargetingCity[];
} {
  const placeIntent = (city: HostAdTargetingCity) => ({
    name: city.name,
    countryCode: city.countryCode,
    ...(placeKind(city) !== "city" ? { kind: placeKind(city) } : {}),
    ...(typeof city.radiusKm === "number" && placeKind(city) !== "region"
      ? { radiusKm: city.radiusKm }
      : {}),
  });
  const excludedPlaces = input.excludedPlaces ?? [];
  const languages = [...new Set(input.languages ?? [])];
  const everyPlaceHasRadius = input.cities.every(
    (city) => typeof city.radiusKm === "number" || placeKind(city) === "region",
  );
  const audienceIntent = {
    countries: input.countries,
    ...(input.cities.length > 0
      ? { cities: input.cities.map(placeIntent) }
      : {}),
    ...(input.cities.length > 0 &&
    input.radiusKm !== null &&
    !everyPlaceHasRadius
      ? { radiusKm: input.radiusKm }
      : {}),
    ageMin: input.ageMin,
    ageMax: input.ageMax,
    gender: input.gender,
    ...(input.interests.length > 0
      ? {
          interests: input.interests.map((interest) => ({
            name: interest.name,
          })),
        }
      : {}),
    ...(excludedPlaces.length > 0
      ? {
          excludedPlaces: excludedPlaces.map((city) => ({
            name: city.name,
            countryCode: city.countryCode,
            ...(placeKind(city) === "region" ? { kind: "region" } : {}),
          })),
        }
      : {}),
    ...(languages.length > 0 ? { languages } : {}),
  };
  // #4238: ids by key (hostAdPlaceKey), so no app's id lands on another place.
  const refsByPlatform = Object.fromEntries(
    input.connections.map((connection) => {
      const refs: HostTargetingRefs = hostAdRefsForApp(
        connection.platform,
        input.cities,
        input.interests,
        excludedPlaces,
        input.languageIds ?? {},
      );
      return [connection.platform, refs];
    }),
  );
  return { audienceIntent, refsByPlatform, excludedPlaces };
}

/** #4238 P1: reach per app while building (staff-switched apps only). */
export type HostAdReachRow = {
  platform: HostAdPlatform;
  state: string;
  lower: number | null;
  upper: number | null;
  meter: "too_narrow" | "good" | "broad" | null;
};

export async function estimateHostAdReach(
  input: Parameters<typeof buildHostAudience>[0] & { brandId: string },
): Promise<HostAdReachRow[]> {
  const { audienceIntent, refsByPlatform } = buildHostAudience(input);
  const result = await invoke<{ estimates: HostAdReachRow[] }>("ad-plan", {
    action: "host_estimate",
    brand_id: input.brandId,
    platforms: input.connections.map((connection) => connection.platform),
    audience_intent: audienceIntent,
    refs_by_platform: refsByPlatform,
  });
  return result.estimates ?? [];
}

/** #4238: the brand's past guests list, the people "already bought". */
export function hostAdPastBuyersKey(brandId: string): string {
  return `brand:${brandId.toLowerCase()}:guests`;
}

export async function prepareHostAdPlan(
  input: PrepareHostAdPlanInput,
): Promise<PreparedHostAdPlan> {
  if (
    input.connections.length === 0 ||
    new Set(input.connections.map((connection) => connection.platform)).size !==
      input.connections.length
  ) {
    throw new HostAdPlanError(
      "validation_error",
      HOST_AD_OWNED_ERROR_COPY.noApps,
    );
  }
  const destinationKey = [
    input.page.page_type,
    input.page.brand_slug,
    input.page.page_type === "brand" ? null : input.page.entity_slug,
  ]
    .filter(Boolean)
    .join(":");
  let planId = input.existingPlanId ?? null;
  if (!planId) {
    const opened = await invoke<{ plan: { id: string } }>("ad-plan", {
      action: "open",
      client_kind: "host",
      owner_kind: "host",
      brand_id: input.brandId,
      destination_family: "public_mingla_page",
      destination_key: destinationKey,
    });
    planId = opened.plan.id;
  }
  const { audienceIntent, refsByPlatform, excludedPlaces } =
    buildHostAudience(input);
  const copy = {
    primary: input.primaryText,
    headline: input.headline,
  };
  const capShares =
    input.shares?.capCents.length === input.connections.length
      ? input.shares.capCents
      : splitCents(input.capCents, input.connections.length);
  const dailyShares =
    input.shares?.dailyCents.length === input.connections.length
      ? input.shares.dailyCents
      : splitCents(input.dailyBudgetCents, input.connections.length);
  const versioned = await invoke<{
    version: {
      id: string;
      plan_hash: string;
      canonical_plan: Record<string, unknown>;
    };
  }>("ad-plan", {
    action: "create_version",
    plan_id: planId,
    canonical_plan: {
      name: input.name,
      schedule: {
        ...(input.startsAt ? { starts_at: input.startsAt } : {}),
        ...(input.endsAt ? { ends_at: input.endsAt } : {}),
      },
      audience_intent: audienceIntent,
      // #4238 P0 (F-10): the Host's picks per app, read back by key.
      targeting_selection: {
        places: input.cities.map(hostAdPlaceForSave),
        excluded: excludedPlaces.map(hostAdPlaceForSave),
        interests: input.interests.map((interest) => ({
          name: interest.name,
          refs: interest.refs,
          ...(interest.labels ? { labels: interest.labels } : {}),
        })),
      },
      copy,
      creative_library_id: input.creative.id,
      creative_url: null,
      media_rights: {
        rights_confirmed: input.rightsConfirmed,
        rights_basis: input.rightsBasis,
        ai_generated: input.aiGenerated,
      },
      special_ad_category: "NONE",
      confirmation_phrase: "LAUNCH",
      ...(input.cta ? { call_to_action: input.cta } : {}),
      ...(input.budgetMode ? { budget_mode: input.budgetMode } : {}),
      // #4238 wave 2: the server checks these are this brand's own.
      audience_selection: {
        include_keys: [...new Set(input.audienceKeys ?? [])]
          .filter((key) => key !== hostAdPastBuyersKey(input.brandId))
          .slice(0, 3),
        ...(input.excludePastBuyers
          ? { exclude_keys: [hostAdPastBuyersKey(input.brandId)] }
          : {}),
      },
      optimization_by_platform: hostOptimizationByPlatform(
        input.optimization,
        input.page,
        input.connections,
      ),
      broader_acceptance: Object.fromEntries(
        input.connections.map((connection) => [
          connection.platform,
          input.acceptBroader,
        ]),
      ),
    },
    provider_allocations: input.connections.map((connection, index) => ({
      platform: connection.platform,
      connection_id: connection.id,
      host_budget_cents: capShares[index],
      host_delivery_budget_cents: dailyShares[index],
    })),
  });
  const versionId = versioned.version.id;
  const planHash = versioned.version.plan_hash;
  const frozen = await invoke<{ targeting_snapshots: TargetingSnapshot[] }>(
    "ad-plan",
    {
      action: "freeze_targeting",
      plan_version_id: versionId,
      audience_intent: audienceIntent,
      refs_by_platform: refsByPlatform,
    },
  );
  const targeting = frozen.targeting_snapshots ?? [];
  const blocked = targeting.some(
    (row) => row.verdict === "unavailable" || row.verdict === "check_required",
  );
  const broader = targeting.some(
    (row) => row.verdict === "broader" && row.broader_accepted !== true,
  );
  if (!blocked && !broader) {
    await invoke("ad-plan", {
      action: "mark_ready",
      plan_version_id: versionId,
      plan_hash: planHash,
    });
  }
  return {
    planId,
    versionId,
    planHash,
    status: blocked ? "blocked" : broader ? "broader" : "ready",
    targeting,
    measurement:
      (versioned.version.canonical_plan.measurement as
        Record<string, unknown> | undefined) ?? null,
    mediaRights:
      (versioned.version.canonical_plan.media_rights as
        Record<string, unknown> | undefined) ?? null,
    optimizationByPlatform: recordValue(
      versioned.version.canonical_plan.optimization_by_platform,
    ),
    // Provider-native video copies do not exist yet. Exact provider validation
    // runs only after funding, review and launch confirmation bind this plan.
    providerValidations: [],
  };
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> => recordValue(item) !== null,
      )
    : [];
}

function hostExecutionTargeting(
  snapshot: TargetingSnapshot,
): Record<string, unknown> {
  const platform = snapshot.platform;
  const audience = snapshot.audience_intent;
  const compiled = snapshot.compiled_targeting;
  const countries = Array.isArray(audience.countries)
    ? audience.countries.map(String)
    : [];
  const cities = recordList(audience.cities);
  const ageMin =
    typeof audience.ageMin === "number" ? audience.ageMin : undefined;
  const ageMax =
    typeof audience.ageMax === "number" ? audience.ageMax : undefined;
  if (platform === "meta") {
    const geo = recordValue(compiled.geo_locations) ?? {};
    const flexible = recordList(compiled.flexible_spec);
    return {
      countries,
      ...(Array.isArray(geo.cities) ? { cities: geo.cities } : {}),
      ...(typeof compiled.age_min === "number"
        ? { age_min: compiled.age_min }
        : {}),
      ...(typeof compiled.age_max === "number"
        ? { age_max: compiled.age_max }
        : {}),
      ...(Array.isArray(compiled.genders) ? { genders: compiled.genders } : {}),
      ...(Array.isArray(flexible[0]?.interests)
        ? { interests: flexible[0].interests }
        : {}),
    };
  }
  if (platform === "tiktok") {
    return {
      countries,
      ...(cities.length > 0 && Array.isArray(compiled.location_ids)
        ? { location_ids: compiled.location_ids }
        : {}),
      ...(Array.isArray(compiled.interest_category_ids)
        ? { interest_category_ids: compiled.interest_category_ids }
        : {}),
      ...(ageMin !== undefined ? { age_min: ageMin } : {}),
      ...(ageMax !== undefined ? { age_max: ageMax } : {}),
      ...(typeof compiled.gender === "string"
        ? { gender: compiled.gender }
        : {}),
    };
  }
  if (platform === "snapchat") {
    const genders =
      audience.gender === "women"
        ? ["FEMALE"]
        : audience.gender === "men"
          ? ["MALE"]
          : null;
    return {
      countries,
      demographics: [
        {
          min_age: String(ageMin ?? 18),
          ...(ageMax !== undefined && ageMax < 65
            ? { max_age: String(ageMax) }
            : {}),
          ...(genders ? { genders } : {}),
        },
      ],
      ...(Array.isArray(compiled.geo_circles)
        ? { resolved_circles: compiled.geo_circles }
        : {}),
      ...(Array.isArray(compiled.interest_category_ids)
        ? { interests: compiled.interest_category_ids }
        : {}),
    };
  }
  if (platform === "google") {
    const ids = Array.isArray(compiled.location_ids)
      ? compiled.location_ids.map(String)
      : [];
    const resolvedLocations = cities
      .map((city, index) => ({
        criterion_id: ids[index],
        name: String(city.name ?? ""),
        canonical_name: String(city.name ?? ""),
        country_code: String(city.countryCode ?? "").toUpperCase(),
        target_type: "City",
      }))
      .filter((city) => city.criterion_id && city.name && city.country_code);
    return {
      countries,
      ...(resolvedLocations.length > 0
        ? { resolved_locations: resolvedLocations }
        : {}),
      ...(ageMin !== undefined && ageMin > 18 ? { age_min: ageMin } : {}),
      ...(ageMax !== undefined && ageMax < 65 ? { age_max: ageMax } : {}),
      ...(Array.isArray(compiled.gender_types) &&
      compiled.gender_types.length > 0
        ? { genders: compiled.gender_types }
        : {}),
      ...(Array.isArray(compiled.audience_ids)
        ? { audiences: compiled.audience_ids }
        : {}),
    };
  }
  const genders =
    audience.gender === "women"
      ? ["FEMALE"]
      : audience.gender === "men"
        ? ["MALE"]
        : null;
  return {
    countries,
    ...(genders ? { genders } : {}),
    ...(Array.isArray(compiled.interests) && compiled.interests.length > 0
      ? { passthrough: { reddit: { interests: compiled.interests } } }
      : {}),
  };
}

/**
 * #4238: the destination descriptor admin-ad-create-campaign accepts, and
 * only that. canonical_plan.destination is the full ad_plan_destination_resolve
 * result (ok, ready, title, canonical_url, destination_family, ...); create's
 * resolver refuses any other key (destination_descriptor_unknown_field), so
 * sending it whole failed every Host create at the validate step.
 */
export function hostAdDestinationDescriptor(
  destination: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["page_type", "brand_slug", "entity_slug"] as const) {
    const value = destination?.[key];
    if (typeof value === "string" && value.trim()) out[key] = value;
  }
  return out;
}

export function providerCreatePayload(
  aggregate: HostAdPlanAggregate,
  allocation: Record<string, unknown>,
  validateOnly = false,
): Record<string, unknown> {
  const platform = String(allocation.platform) as HostAdPlatform;
  const canonical = aggregate.version.canonical_plan;
  const destination = canonical.destination as Record<string, unknown>;
  const schedule = (canonical.schedule ?? {}) as Record<string, unknown>;
  const copy = (canonical.copy ?? {}) as Record<string, unknown>;
  const primary = String(copy.primary ?? canonical.name ?? "Mingla promotion");
  const headline = String(
    copy.headline ?? canonical.name ?? "Mingla promotion",
  );
  const snapshot = aggregate.targeting_snapshots.find(
    (row) => row.platform === platform,
  );
  if (!snapshot)
    throw new HostAdPlanError("plan_conflict", HOST_AD_OWNED_ERROR_COPY.noAudienceOwner);
  const audience = snapshot.audience_intent;
  const deliveryBudgets = canonical.delivery_budgets as
    Record<string, Record<string, unknown>> | undefined;
  const daily = Number(deliveryBudgets?.[platform]?.host_amount_cents);
  const cap = Number(allocation.host_budget_cents);
  const providerDaily = Number(
    deliveryBudgets?.[platform]?.provider_amount_cents,
  );
  const providerCap = Number(allocation.provider_budget_cents);
  const commonTargeting = hostExecutionTargeting(snapshot);
  // #4238: no lane (the server derives it from the owner) and no objective
  // fields (the server derives them from the plan's optimization_by_platform).
  const base: Record<string, unknown> = {
    platform,
    owner_kind: "host",
    brand_id: aggregate.plan.brand_id,
    plan_version_id: aggregate.version.id,
    plan_hash: aggregate.version.plan_hash,
    request_id: `host_plan_${aggregate.version.plan_hash}_${platform}${
      validateOnly ? "_validate" : ""
    }`.slice(0, 120),
    name: String(canonical.name ?? "Mingla promotion"),
    destination: hostAdDestinationDescriptor(destination),
    destinations: [hostAdDestinationDescriptor(destination)],
    audience_intent: audience,
    copy_intent: copy,
    creative_intent: {
      kind: "video",
      creative_library_id: String(canonical.creative_library_id ?? ""),
      image_url: null,
    },
    budget: {
      type: "daily",
      amount_cents: validateOnly ? providerDaily : daily,
      cap_cents: validateOnly ? providerCap : cap,
    },
    schedule,
    targeting: commonTargeting,
    compliance: {
      aiGenerated:
        (canonical.media_rights as Record<string, unknown> | undefined)
          ?.ai_generated === true,
      specialAdCategory: "NONE",
    },
    ...(validateOnly ? { validate_only: true } : {}),
  };
  const creativeId = String(canonical.creative_library_id ?? "");
  if (platform === "tiktok") {
    return {
      ...base,
      creative: {
        kind: "video",
        creative_library_id: creativeId,
        // #4238: TikTok doesn't show emoji (the builder says so); nothing is
        // cut — create_version refused text over 100 characters.
        ad_text: primary.replace(/\p{Extended_Pictographic}/gu, ""),
      },
    };
  }
  if (platform === "reddit") {
    return {
      ...base,
      creative: {
        kind: "video",
        creative_library_id: creativeId,
        headline: primary,
      },
    };
  }
  if (platform === "snapchat") {
    return {
      ...base,
      creative: {
        kind: "video",
        creative_library_id: creativeId,
        headline,
        brand_name: String(destination.brand_slug ?? "Mingla").slice(0, 32),
      },
    };
  }
  if (platform === "google") {
    return {
      ...base,
      creative: {
        kind: "video",
        creative_library_id: creativeId,
        headlines: [headline],
        long_headlines: [primary],
        descriptions: [primary],
        business_name: String(destination.brand_slug ?? "Mingla").slice(0, 25),
      },
      keywords: [],
    };
  }
  return {
    ...base,
    creative: {
      kind: "video",
      creative_library_id: creativeId,
      message: primary,
      headline,
      ai_generated:
        (canonical.media_rights as Record<string, unknown> | undefined)
          ?.ai_generated === true,
    },
    special_ad_categories: [],
  };
}

async function validateAggregate(
  aggregate: HostAdPlanAggregate,
): Promise<PreparedHostAdPlan["providerValidations"]> {
  const validations: PreparedHostAdPlan["providerValidations"] = [];
  for (const allocation of aggregate.provider_allocations) {
    const platform = String(allocation.platform) as HostAdPlatform;
    const result = await invoke<Record<string, unknown>>(
      "admin-ad-create-campaign",
      providerCreatePayload(aggregate, allocation, true),
    );
    validations.push({ platform, result });
  }
  return validations;
}

async function recordCreateFailure(
  aggregate: HostAdPlanAggregate,
  platform: string,
  cause: unknown,
): Promise<void> {
  const detail = cause instanceof Error ? cause.message : String(cause);
  await invoke("ad-plan", {
    action: "record_create_failure",
    plan_version_id: aggregate.version.id,
    plan_hash: aggregate.version.plan_hash,
    platform,
    error_detail: detail,
  });
}

async function prepareBoundVideoPlatforms(
  aggregate: HostAdPlanAggregate,
): Promise<void> {
  const creativeId = String(
    aggregate.version.canonical_plan.creative_library_id ?? "",
  );
  if (!creativeId) {
    throw new HostAdPlanError(
      "creative_required",
      HOST_AD_OWNED_ERROR_COPY.noVideo,
    );
  }
  for (const allocation of aggregate.provider_allocations) {
    const platform = String(allocation.platform);
    if (!PREPARED_VIDEO_PLATFORMS.has(platform)) continue;
    let action: "start" | "status" | "retry" = "status";
    let retried = false;
    try {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const row = await invoke<PrepareEnvelope>(
          "admin-ad-creative-prepare",
          {
            action,
            creative_library_id: creativeId,
            platform,
            brand_id: aggregate.plan.brand_id,
            plan_version_id: aggregate.version.id,
            plan_hash: aggregate.version.plan_hash,
          },
        );
        if (row.state === "ready") break;
        if (row.state === "failed" || row.state === "timed_out") {
          if (retried) {
            throw new HostAdPlanError(
              "provider_prepare_failed",
              hostAdVideoFailedMessage(platform),
            );
          }
          action = "retry";
          retried = true;
        } else if (row.state === "not_started") {
          action = "start";
        } else {
          action = "status";
        }
        const seconds = Math.min(
          10,
          Math.max(1, Number(row.retry_after_seconds) || 2),
        );
        await wait(seconds * 1000);
        if (attempt === 59) {
          throw new HostAdPlanError(
            "provider_prepare_pending",
            hostAdVideoPendingMessage(platform),
          );
        }
      }
    } catch (cause) {
      await recordCreateFailure(aggregate, platform, cause);
      throw cause;
    }
  }
}

export async function cancelHostAdPlanBeforeCreate(input: {
  versionId: string;
  planHash: string;
  reason: string;
}): Promise<void> {
  await invoke("ad-plan", {
    action: "cancel_before_create",
    plan_version_id: input.versionId,
    plan_hash: input.planHash,
    phrase: "CANCEL PLAN",
    reason: input.reason,
    idempotency_key: `host_cancel_${input.planHash}`.slice(0, 120),
  });
}

export type FundHostAdPlanResult = {
  state: "staff_review_required" | "funded_held";
  planId: string;
};

export type LaunchHostAdPlanResult = {
  state: "launched";
  planId: string;
  campaigns?: Record<string, unknown>[];
};

function assertCurrentVersion(
  aggregate: HostAdPlanAggregate,
  input: { versionId: string; planHash: string },
): void {
  if (
    aggregate.version.id !== input.versionId ||
    aggregate.version.plan_hash !== input.planHash
  ) {
    throw new HostAdPlanError(
      "plan_conflict",
      HOST_AD_OWNED_ERROR_COPY.changed,
    );
  }
}

export async function fundHostAdPlan(input: {
  planId: string;
  versionId: string;
  planHash: string;
}): Promise<FundHostAdPlanResult> {
  let aggregate = await getHostAdPlan(input.planId);
  assertCurrentVersion(aggregate, input);
  if (["changes_requested", "staff_rejected"].includes(aggregate.plan.state)) {
    throw new HostAdPlanError("staff_review", aggregate.plan.state);
  }
  if (aggregate.plan.state === "staff_review_required") {
    return { state: "staff_review_required", planId: input.planId };
  }
  if (!aggregate.funding_hold) {
    await invoke("ad-plan", {
      action: "fund",
      plan_version_id: input.versionId,
      plan_hash: input.planHash,
      idempotency_key: `host_fund_${input.planHash}`.slice(0, 120),
    });
    aggregate = await getHostAdPlan(input.planId);
  }
  if (aggregate.plan.state === "staff_review_required") {
    return { state: "staff_review_required", planId: input.planId };
  }
  return { state: "funded_held", planId: input.planId };
}

export async function launchHostAdPlan(input: {
  planId: string;
  versionId: string;
  planHash: string;
}): Promise<LaunchHostAdPlanResult> {
  const aggregate = await getHostAdPlan(input.planId);
  assertCurrentVersion(aggregate, input);
  if (["changes_requested", "staff_rejected"].includes(aggregate.plan.state)) {
    throw new HostAdPlanError("staff_review", aggregate.plan.state);
  }
  if (aggregate.plan.state === "staff_review_required") {
    throw new HostAdPlanError(
      "staff_review",
      HOST_AD_OWNED_ERROR_COPY.inReview,
    );
  }
  if (
    !aggregate.funding_hold ||
    aggregate.funding_hold.state !== "held" ||
    ![
      "funded_held",
      "staff_approved",
      "creating_paused_objects",
      "creation_failed_retryable",
    ].includes(aggregate.plan.state)
  ) {
    throw new HostAdPlanError(
      "funding_required",
      HOST_AD_OWNED_ERROR_COPY.fundingRequired,
    );
  }
  await invoke("ad-plan", {
    action: "confirm_launch",
    plan_version_id: input.versionId,
    plan_hash: input.planHash,
    phrase: "LAUNCH",
  });
  await prepareBoundVideoPlatforms(aggregate);
  await validateAggregate(aggregate);
  const createdCampaigns: {
    created: Record<string, unknown>;
    campaignId: string;
    platform: string;
  }[] = [];
  for (const allocation of aggregate.provider_allocations) {
    const platform = String(allocation.platform);
    let created: Record<string, unknown>;
    try {
      created = await invoke<Record<string, unknown>>(
        "admin-ad-create-campaign",
        providerCreatePayload(aggregate, allocation),
      );
    } catch (cause) {
      await recordCreateFailure(aggregate, platform, cause);
      throw cause;
    }
    const nestedCampaign = created.campaign as
      Record<string, unknown> | undefined;
    const campaignId = String(created.campaign_id ?? nestedCampaign?.id ?? "");
    if (!campaignId) {
      const cause = new HostAdPlanError(
        "provider_create_failed",
        HOST_AD_OWNED_ERROR_COPY.notConfirmed,
      );
      await recordCreateFailure(aggregate, platform, cause);
      throw cause;
    }
    createdCampaigns.push({
      created,
      campaignId,
      platform,
    });
  }
  const campaigns: Record<string, unknown>[] = [];
  for (const item of createdCampaigns) {
    await invoke("host-ad-campaign", {
      action: "launch",
      brand_id: aggregate.plan.brand_id,
      campaign_id: item.campaignId,
      idempotency_key: `host_launch_${input.planHash}_${item.platform}`.slice(
        0,
        120,
      ),
    });
    campaigns.push({ ...item.created, campaign_id: item.campaignId });
  }
  return { state: "launched", planId: input.planId, campaigns };
}
