/**
 * Issue #3697 v1.4 — Host Ads immutable-plan client.
 *
 * This is the same server-owned plan used by Admin and Ari. The client never
 * supplies currency or provider money: it sends amounts in the brand's verified
 * settlement currency and the server freezes account currency + FX authority.
 */

import { supabase } from "./supabase";

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
};

export type HostAdConnection = {
  id: string;
  platform: HostAdPlatform;
  lane: "business";
  currency: string;
  status: string;
  connected: boolean;
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

export type HostAdSetup = {
  currency: string;
  pages: HostAdPage[];
  connections: HostAdConnection[];
  creatives: HostAdCreative[];
  plans: HostAdPlanRow[];
};

export type TargetingSnapshot = {
  platform: HostAdPlatform;
  verdict: "exact" | "broader" | "unavailable" | "check_required";
  widening_summary: string[];
  checks_required: string[];
  broader_accepted: boolean;
  audience_intent: Record<string, unknown>;
  compiled_targeting: Record<string, unknown>;
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
  campaigns: Record<string, unknown>[];
};

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
    const rawDetail = payload?.detail ?? payload?.message ?? error.message;
    const detail =
      typeof rawDetail === "string"
        ? rawDetail
        : JSON.stringify(rawDetail ?? "request_failed");
    throw new HostAdPlanError(payload?.error ?? "network", detail);
  }
  if (data && typeof data === "object" && "error" in data) {
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
  const result = await invoke<{ ok: true } & HostAdSetup>("ad-plan", {
    action: "host_setup",
    brand_id: brandId,
  });
  return result;
}

export async function getHostAdPlan(
  planId: string,
): Promise<HostAdPlanAggregate> {
  return invoke<HostAdPlanAggregate>("ad-plan", {
    action: "get",
    plan_id: planId,
  });
}

const HOST_PLAN_IN_PROGRESS_STATES = new Set([
  "validating",
  "ready_for_funding",
  "funding_pending",
  "funded_held",
  "staff_review_required",
  "staff_approved",
  "changes_requested",
  "creation_failed_retryable",
]);

export async function listHostAdPlans(
  brandId: string,
): Promise<HostAdPlanAggregate[]> {
  const result = await invoke<{ plans: HostAdPlanRow[] }>("ad-plan", {
    action: "list",
    brand_id: brandId,
  });
  const rows = (result.plans ?? []).filter(
    (plan) =>
      typeof plan.current_version_id === "string" &&
      HOST_PLAN_IN_PROGRESS_STATES.has(plan.state),
  );
  const settled = await Promise.allSettled(
    rows.map((plan) => getHostAdPlan(plan.id)),
  );
  return settled.flatMap((item) =>
    item.status === "fulfilled" && item.value.campaigns.length === 0
      ? [item.value]
      : [],
  );
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
  ageMin: number;
  ageMax: number;
  gender: "all" | "men" | "women";
  dailyBudgetCents: number;
  capCents: number;
  startsAt?: string | null;
  endsAt?: string | null;
  acceptBroader: boolean;
};

export type PreparedHostAdPlan = {
  planId: string;
  versionId: string;
  planHash: string;
  status: "ready" | "broader" | "blocked";
  targeting: TargetingSnapshot[];
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
      "Choose at least one connected platform, without duplicates.",
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
  const audienceIntent = {
    countries: input.countries,
    ageMin: input.ageMin,
    ageMax: input.ageMax,
    gender: input.gender,
  };
  const copy = {
    primary: input.primaryText,
    headline: input.headline,
  };
  const capShares = splitCents(input.capCents, input.connections.length);
  const dailyShares = splitCents(
    input.dailyBudgetCents,
    input.connections.length,
  );
  const versioned = await invoke<{
    version: { id: string; plan_hash: string };
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
      copy,
      creative_library_id: input.creative.id,
      creative_url: null,
      special_ad_category: "NONE",
      confirmation_phrase: "LAUNCH",
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
      refs_by_platform: {},
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
  const providerValidations =
    !blocked && !broader
      ? await validateAggregate(await getHostAdPlan(planId))
      : [];
  return {
    planId,
    versionId,
    planHash,
    status: blocked ? "blocked" : broader ? "broader" : "ready",
    targeting,
    providerValidations,
  };
}

function genderTarget(gender: unknown): Record<string, unknown> {
  if (gender === "men") return { gender: "men", genders: [1] };
  if (gender === "women") return { gender: "women", genders: [2] };
  return {};
}

function providerCreatePayload(
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
    throw new HostAdPlanError("plan_conflict", "Targeting snapshot is missing");
  const audience = snapshot.audience_intent;
  const countries = Array.isArray(audience.countries) ? audience.countries : [];
  const deliveryBudgets = canonical.delivery_budgets as
    Record<string, Record<string, unknown>> | undefined;
  const daily = Number(deliveryBudgets?.[platform]?.host_amount_cents);
  const cap = Number(allocation.host_budget_cents);
  const providerDaily = Number(
    deliveryBudgets?.[platform]?.provider_amount_cents,
  );
  const providerCap = Number(allocation.provider_budget_cents);
  const commonTargeting = {
    countries,
    ...(typeof audience.ageMin === "number"
      ? { age_min: audience.ageMin }
      : {}),
    ...(typeof audience.ageMax === "number"
      ? { age_max: audience.ageMax }
      : {}),
    ...genderTarget(audience.gender),
  };
  const base: Record<string, unknown> = {
    platform,
    lane: "business",
    owner_kind: "host",
    brand_id: aggregate.plan.brand_id,
    plan_version_id: aggregate.version.id,
    plan_hash: aggregate.version.plan_hash,
    request_id: `host_plan_${aggregate.version.plan_hash}_${platform}${
      validateOnly ? "_validate" : ""
    }`.slice(0, 120),
    name: String(canonical.name ?? "Mingla promotion"),
    destination,
    destinations: [destination],
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
    compliance: { aiGenerated: false, specialAdCategory: "NONE" },
    ...(validateOnly ? { validate_only: true } : {}),
  };
  const creativeId = String(canonical.creative_library_id ?? "");
  if (platform === "tiktok") {
    return {
      ...base,
      objective: "TRAFFIC",
      optimization_goal: "TRAFFIC_LANDING_PAGE_VIEW",
      billing_event: "CPC",
      creative: {
        kind: "video",
        creative_library_id: creativeId,
        ad_text: primary
          .replace(/\p{Extended_Pictographic}/gu, "")
          .slice(0, 100),
      },
    };
  }
  if (platform === "reddit") {
    return {
      ...base,
      objective: "CLICKS",
      creative: {
        kind: "video",
        creative_library_id: creativeId,
        headline: primary.slice(0, 300),
      },
    };
  }
  if (platform === "snapchat") {
    return {
      ...base,
      objective: "TRAFFIC",
      optimization_goal: "SWIPES",
      creative: {
        kind: "video",
        creative_library_id: creativeId,
        headline: headline.slice(0, 34),
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
        headlines: [headline.slice(0, 40)],
        long_headlines: [primary.slice(0, 90)],
        descriptions: [primary.slice(0, 90)],
        business_name: String(destination.brand_slug ?? "Mingla").slice(0, 25),
      },
      keywords: [],
    };
  }
  return {
    ...base,
    objective: "OUTCOME_TRAFFIC",
    optimization_goal: "LINK_CLICKS",
    billing_event: "IMPRESSIONS",
    creative: {
      kind: "video",
      creative_library_id: creativeId,
      message: primary,
      headline: headline.slice(0, 255),
      call_to_action_type: "LEARN_MORE",
      ai_generated: false,
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

export async function cancelHostAdPlanBeforeCreate(input: {
  versionId: string;
  planHash: string;
}): Promise<void> {
  await invoke("ad-plan", {
    action: "cancel_before_create",
    plan_version_id: input.versionId,
    plan_hash: input.planHash,
    idempotency_key: `host_cancel_${input.planHash}`.slice(0, 120),
  });
}

export type LaunchHostAdPlanResult = {
  state: "staff_review_required" | "launched";
  planId: string;
  campaigns?: Record<string, unknown>[];
};

export async function fundCreateAndLaunchHostAdPlan(input: {
  planId: string;
  versionId: string;
  planHash: string;
}): Promise<LaunchHostAdPlanResult> {
  let aggregate = await getHostAdPlan(input.planId);
  if (
    aggregate.version.id !== input.versionId ||
    aggregate.version.plan_hash !== input.planHash
  ) {
    throw new HostAdPlanError(
      "plan_conflict",
      "This is no longer the current plan version",
    );
  }
  if (["changes_requested", "staff_rejected"].includes(aggregate.plan.state)) {
    throw new HostAdPlanError("staff_review", aggregate.plan.state);
  }
  if (aggregate.plan.state === "staff_review_required") {
    return { state: "staff_review_required", planId: input.planId };
  }
  await validateAggregate(aggregate);
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
  await invoke("ad-plan", {
    action: "confirm_launch",
    plan_version_id: input.versionId,
    plan_hash: input.planHash,
    phrase: "LAUNCH",
  });
  const campaigns: Record<string, unknown>[] = [];
  for (const allocation of aggregate.provider_allocations) {
    const created = await invoke<Record<string, unknown>>(
      "admin-ad-create-campaign",
      providerCreatePayload(aggregate, allocation),
    );
    const nestedCampaign = created.campaign as
      Record<string, unknown> | undefined;
    const campaignId = String(created.campaign_id ?? nestedCampaign?.id ?? "");
    if (!campaignId) {
      throw new HostAdPlanError(
        "provider_create_failed",
        "Provider create returned no campaign ID",
      );
    }
    await invoke("host-ad-campaign", {
      action: "launch",
      brand_id: aggregate.plan.brand_id,
      campaign_id: campaignId,
      idempotency_key:
        `host_launch_${input.planHash}_${String(allocation.platform)}`.slice(
          0,
          120,
        ),
    });
    campaigns.push({ ...created, campaign_id: campaignId });
  }
  return { state: "launched", planId: input.planId, campaigns };
}
