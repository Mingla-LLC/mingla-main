/**
 * Issue #3697 v1.4 provider-native audience estimates.
 *
 * Each result belongs to exactly one provider and is deliberately non-additive:
 * the same person can be eligible on several platforms. Provider reads are
 * certification-gated and never create, mutate, or launch provider objects.
 */

import type { AdConnectionRow, Platform } from "./adChannelCore.ts";
import type {
  TargetingCompileResult,
  TargetingVerdict,
} from "./adTargetingCompiler.ts";
import { metaGraph, resolveMetaClient } from "./meta.ts";
import { resolveTikTokClient, tiktokApi } from "./tiktok.ts";
import {
  buildSnapchatCircleGeos,
  resolveSnapchatClient,
  snapchatApi,
  type SnapchatCircleGeo,
  snapchatDemographicsWithDefault,
} from "./snapchat.ts";
import { redditRequest, resolveRedditClient } from "./reddit.ts";

export type ProviderEstimateState =
  | "available"
  | "certification_required"
  | "allowlist_required"
  | "provider_error"
  | "response_unrecognized"
  | "targeting_unavailable";

export type ProviderAudienceEstimate = {
  state: ProviderEstimateState;
  quality: "provider_estimate" | "unavailable";
  source: string;
  unit: "potential_reach";
  lower_bound: number | null;
  upper_bound: number | null;
  period: string | null;
  assumptions: string[];
  non_additive: true;
  detail: string;
};

export type EstimateInput = {
  platform: Platform;
  verdict: TargetingVerdict;
  compiledTargeting: Record<string, unknown>;
  connection: AdConnectionRow;
  providerBudgetCents: number;
};

export type ProviderEstimateTransports = {
  meta: (input: EstimateInput) => Promise<unknown>;
  tiktok: (input: EstimateInput) => Promise<unknown>;
  snapchat: (input: EstimateInput) => Promise<unknown>;
  reddit: (input: EstimateInput) => Promise<unknown>;
};

const SOURCES: Record<Platform, string> = {
  meta: "meta:/reachestimate",
  tiktok: "tiktok:/ad/audience_size/estimate/",
  snapchat: "snapchat:/audience_size_v2",
  google: "google:ReachPlanService.GenerateReachForecast",
  reddit: "reddit:/forecasting/audience_and_delivery_estimates",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function child(value: unknown, ...path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (Array.isArray(current) && /^\d+$/.test(key)) {
      current = current[Number(key)];
      continue;
    }
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

function bound(value: unknown): number | null {
  const numeric = typeof value === "string" && value.trim()
    ? Number(value)
    : value;
  return typeof numeric === "number" && Number.isSafeInteger(numeric) &&
      numeric >= 0
    ? numeric
    : null;
}

function unavailable(
  platform: Platform,
  state: Exclude<ProviderEstimateState, "available">,
  detail: string,
  assumptions: string[] = [],
): ProviderAudienceEstimate {
  return {
    state,
    quality: "unavailable",
    source: SOURCES[platform],
    unit: "potential_reach",
    lower_bound: null,
    upper_bound: null,
    period: null,
    assumptions,
    non_additive: true,
    detail,
  };
}

function available(
  platform: Platform,
  lower: number,
  upper: number,
  period: string | null,
  assumptions: string[],
): ProviderAudienceEstimate {
  if (lower > upper) {
    return unavailable(
      platform,
      "response_unrecognized",
      "provider_bounds_invalid",
      assumptions,
    );
  }
  return {
    state: "available",
    quality: "provider_estimate",
    source: SOURCES[platform],
    unit: "potential_reach",
    lower_bound: lower,
    upper_bound: upper,
    period,
    assumptions,
    non_additive: true,
    detail: "provider_native_estimate",
  };
}

export function parseMetaAudienceEstimate(
  payload: unknown,
): ProviderAudienceEstimate {
  if (child(payload, "estimate_ready") === false) {
    return unavailable("meta", "provider_error", "provider_estimate_not_ready");
  }
  const single = bound(
    child(payload, "users") ?? child(payload, "data", "users") ??
      child(payload, "estimate_mau") ??
      child(payload, "data", "estimate_mau"),
  );
  const lower = bound(
    child(payload, "estimate_mau_lower_bound") ??
      child(payload, "data", "estimate_mau_lower_bound"),
  );
  const upper = bound(
    child(payload, "estimate_mau_upper_bound") ??
      child(payload, "data", "estimate_mau_upper_bound"),
  );
  if (single !== null) {
    return available("meta", single, single, null, [
      "Meta potential reach for the frozen targeting specification.",
    ]);
  }
  return lower !== null && upper !== null
    ? available("meta", lower, upper, null, [
      "Meta potential reach for the frozen targeting specification.",
    ])
    : unavailable("meta", "response_unrecognized", "provider_bounds_missing");
}

export function parseSnapAudienceEstimate(
  payload: unknown,
): ProviderAudienceEstimate {
  const estimate = child(payload, "audience_size") ??
    child(payload, "audience_sizes", "0", "audience_size") ?? payload;
  const lower = bound(
    child(estimate, "audience_size_minimum") ?? child(estimate, "minimum"),
  );
  const upper = bound(
    child(estimate, "audience_size_maximum") ?? child(estimate, "maximum"),
  );
  return lower !== null && upper !== null
    ? available("snapchat", lower, upper, null, [
      "Snap potential reach for the frozen ad-squad targeting specification.",
    ])
    : unavailable(
      "snapchat",
      "response_unrecognized",
      "provider_bounds_missing",
    );
}

export function parseRedditAudienceEstimate(
  payload: unknown,
): ProviderAudienceEstimate {
  const range = child(payload, "data", "target_audience_range") ??
    child(payload, "target_audience_range");
  const lower = bound(child(range, "min"));
  const upper = bound(child(range, "max"));
  return lower !== null && upper !== null
    ? available("reddit", lower, upper, "rolling_30_days", [
      "Reddit target audience range uses Reddit's fixed 30-day audience period.",
      "Delivery forecasts are directional and are not included in this audience range.",
    ])
    : unavailable("reddit", "response_unrecognized", "provider_bounds_missing");
}

export function parseTikTokAudienceEstimate(
  payload: unknown,
): ProviderAudienceEstimate {
  const candidate = child(payload, "audience_size") ??
    child(payload, "user_count") ??
    child(payload, "data", "audience_size") ??
    child(payload, "data", "user_count") ?? payload;
  const single = bound(candidate);
  const lower = bound(
    child(candidate, "lower_bound") ?? child(candidate, "minimum") ??
      child(candidate, "min"),
  );
  const upper = bound(
    child(candidate, "upper_bound") ?? child(candidate, "maximum") ??
      child(candidate, "max"),
  );
  if (single !== null) {
    return available("tiktok", single, single, null, [
      "TikTok potential reach for the frozen targeting specification.",
    ]);
  }
  return lower !== null && upper !== null
    ? available("tiktok", lower, upper, null, [
      "TikTok potential reach for the frozen targeting specification.",
    ])
    : unavailable("tiktok", "response_unrecognized", "provider_bounds_missing");
}

export function buildSnapAudienceSizeBody(input: EstimateInput) {
  const compiled = input.compiledTargeting;
  const countries = Array.isArray(compiled.country_codes)
    ? compiled.country_codes.map(String)
    : [];
  const circles = Array.isArray(compiled.geo_circles)
    ? compiled.geo_circles as SnapchatCircleGeo[]
    : [];
  const geos = buildSnapchatCircleGeos(circles) ??
    countries.map((countryCode) => ({
      country_code: countryCode.trim().toLowerCase(),
    }));
  const demographic: Record<string, unknown> = {};
  if (typeof compiled.age_min === "number") {
    demographic.min_age = String(compiled.age_min);
  }
  if (typeof compiled.age_max === "number") {
    demographic.max_age = String(compiled.age_max);
  }
  if (compiled.gender === "men") demographic.genders = ["MALE"];
  if (compiled.gender === "women") demographic.genders = ["FEMALE"];
  const interestIds = Array.isArray(compiled.interest_category_ids)
    ? compiled.interest_category_ids.map(String)
    : [];
  return {
    ad_squad: {
      name: "Mingla audience estimate",
      status: "PAUSED",
      type: "SNAP_ADS",
      targeting: {
        geos,
        demographics: snapchatDemographicsWithDefault(
          Object.keys(demographic).length ? [demographic] : null,
        ),
        ...(interestIds.length
          ? { interests: [{ category_id: interestIds }] }
          : {}),
      },
      billing_event: "IMPRESSION",
      bid_strategy: "AUTO_BID",
      optimization_goal: "SWIPES",
      placement_v2: { config: "AUTOMATIC" },
      delivery_constraint: "DAILY_BUDGET",
      daily_budget_micro: input.providerBudgetCents * 10_000,
    },
  };
}

export function buildRedditAudienceEstimateBody(input: EstimateInput) {
  const compiled = input.compiledTargeting;
  const gender = compiled.gender === "men"
    ? "MALE"
    : compiled.gender === "women"
    ? "FEMALE"
    : undefined;
  return {
    objective: "CLICKS",
    ad_group_configs: [{
      goal_value: input.providerBudgetCents * 10_000,
      goal_type: "DAILY_SPEND",
      bid_strategy: "MAXIMIZE_VOLUME",
      optimization_goal: "CLICKS",
      targeting: {
        geolocations: compiled.country_codes ?? [],
        ...(gender ? { gender } : {}),
        ...(Array.isArray(compiled.interests)
          ? { interests: compiled.interests }
          : {}),
        expand_targeting: false,
        locations: ["FEED"],
        platforms: ["ALL"],
      },
    }],
  };
}

export function buildTikTokAudienceEstimateBody(input: EstimateInput) {
  return {
    advertiser_id: input.connection.external_account_id,
    placement_type: "AUTOMATIC",
    objective_type: "TRAFFIC",
    optimization_goal: "CLICK",
    auto_targeting_enabled: false,
    ...input.compiledTargeting,
  };
}

const defaultTransports: ProviderEstimateTransports = {
  meta: async (input) => {
    const client = resolveMetaClient(input.connection);
    const accountId = input.connection.external_account_id.replace(/^act_/, "");
    return await metaGraph(client, "GET", `act_${accountId}/reachestimate`, {
      targeting_spec: input.compiledTargeting,
      optimize_for: "IMPRESSIONS",
    });
  },
  tiktok: async (input) => {
    const client = resolveTikTokClient(input.connection);
    return await tiktokApi(
      client,
      "POST",
      "ad/audience_size/estimate/",
      buildTikTokAudienceEstimateBody(input),
    );
  },
  snapchat: async (input) => {
    const client = await resolveSnapchatClient(input.connection);
    return await snapchatApi(
      client,
      "POST",
      `adaccounts/${client.adAccountId}/audience_size_v2`,
      buildSnapAudienceSizeBody(input),
    );
  },
  reddit: async (input) => {
    const client = await resolveRedditClient(input.connection);
    return await redditRequest(
      client,
      "POST",
      `ad_accounts/${input.connection.external_account_id}/forecasting/audience_and_delivery_estimates`,
      buildRedditAudienceEstimateBody(input),
    );
  },
};

export async function fetchProviderAudienceEstimate(
  input: EstimateInput,
  transports: ProviderEstimateTransports = defaultTransports,
): Promise<ProviderAudienceEstimate> {
  if (input.verdict === "unavailable" || input.verdict === "check_required") {
    return unavailable(
      input.platform,
      "targeting_unavailable",
      `targeting_${input.verdict}`,
    );
  }
  if (input.platform === "google") {
    return unavailable(
      "google",
      "allowlist_required",
      "google_reach_plan_allowlist_and_certification_required",
      ["Google ReachPlanService is private and must be allowlisted before use."],
    );
  }
  if (input.connection.extra?.audience_estimate_certified !== true) {
    return unavailable(
      input.platform,
      "certification_required",
      "provider_audience_estimate_not_certified",
    );
  }
  try {
    if (input.platform === "meta") {
      return parseMetaAudienceEstimate(await transports.meta(input));
    }
    if (input.platform === "tiktok") {
      return parseTikTokAudienceEstimate(await transports.tiktok(input));
    }
    if (input.platform === "snapchat") {
      return parseSnapAudienceEstimate(await transports.snapchat(input));
    }
    return parseRedditAudienceEstimate(await transports.reddit(input));
  } catch {
    return unavailable(
      input.platform,
      "provider_error",
      "provider_estimate_request_failed",
    );
  }
}

export function estimateInputFromTargeting(input: {
  compiled: TargetingCompileResult;
  connection: AdConnectionRow;
  providerBudgetCents: number;
}): EstimateInput {
  return {
    platform: input.compiled.platform,
    verdict: input.compiled.verdict,
    compiledTargeting: input.compiled.compiledTargeting,
    connection: input.connection,
    providerBudgetCents: input.providerBudgetCents,
  };
}
