/**
 * Issue #3697 v1.4 — Host Ads immutable-plan client.
 *
 * This is the same server-owned plan used by Admin and Ari. The client never
 * supplies currency or provider money: it sends amounts in the brand's verified
 * settlement currency and the server freezes account currency + FX authority.
 */

import { supabase } from "./supabase";

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
};

export type HostAdConnection = {
  id: string;
  platform: HostAdPlatform;
  lane: "business";
  currency: string;
  status: string;
  connected: boolean;
};

export type HostAdTargetingCity = {
  name: string;
  countryCode: string;
  refs: Partial<Record<HostAdPlatform, string>>;
};

export type HostAdTargetingInterest = {
  name: string;
  refs: Partial<Record<HostAdPlatform, string>>;
};

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

export function hostTargetingSelectionsFromAggregate(
  aggregate: HostAdPlanAggregate,
): {
  cities: HostAdTargetingCity[];
  interests: HostAdTargetingInterest[];
  radiusKm: number | null;
} {
  const audience = aggregate.version.canonical_plan.audience_intent as
    Record<string, unknown> | undefined;
  const cityRows = recordList(audience?.cities);
  const interestRows = recordList(audience?.interests);
  const cities = cityRows.map((city, index) => {
    const refs: Partial<Record<HostAdPlatform, string>> = {};
    for (const snapshot of aggregate.targeting_snapshots) {
      const compiled = snapshot.compiled_targeting;
      if (snapshot.platform === "meta") {
        const geo = recordValue(compiled.geo_locations);
        const row = recordList(geo?.cities)[index];
        if (row?.key) refs.meta = String(row.key);
      } else if (
        ["tiktok", "google"].includes(snapshot.platform) &&
        Array.isArray(compiled.location_ids) &&
        compiled.location_ids[index]
      ) {
        refs[snapshot.platform] = String(compiled.location_ids[index]);
      }
    }
    return {
      name: String(city.name ?? ""),
      countryCode: String(city.countryCode ?? "").toUpperCase(),
      refs,
    };
  });
  const interests = interestRows.map((interest, index) => {
    const refs: Partial<Record<HostAdPlatform, string>> = {};
    for (const snapshot of aggregate.targeting_snapshots) {
      const compiled = snapshot.compiled_targeting;
      if (snapshot.platform === "meta") {
        const flexible = recordList(compiled.flexible_spec)[0];
        const row = recordList(flexible?.interests)[index];
        if (row?.id) refs.meta = String(row.id);
      } else if (
        snapshot.platform === "tiktok" &&
        Array.isArray(compiled.interest_category_ids) &&
        compiled.interest_category_ids[index]
      ) {
        refs.tiktok = String(compiled.interest_category_ids[index]);
      } else if (
        snapshot.platform === "snapchat" &&
        Array.isArray(compiled.interest_category_ids) &&
        compiled.interest_category_ids[index]
      ) {
        refs.snapchat = String(compiled.interest_category_ids[index]);
      } else if (
        snapshot.platform === "google" &&
        Array.isArray(compiled.audience_ids) &&
        compiled.audience_ids[index]
      ) {
        refs.google = String(compiled.audience_ids[index]);
      } else if (snapshot.platform === "reddit") {
        refs.reddit = String(interest.name ?? "");
      }
    }
    return { name: String(interest.name ?? ""), refs };
  });
  return {
    cities: cities.filter((city) => city.name && city.countryCode),
    interests: interests.filter((interest) => interest.name),
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

export async function searchHostAdTargeting(input: {
  brandId: string;
  platform: HostAdPlatform;
  kind: "city" | "interest";
  query: string;
  country?: string | null;
}): Promise<{ results: HostAdTargetingSearchResult[]; warning?: string }> {
  return invoke("admin-ad-targeting-search", {
    brand_id: input.brandId,
    owner_kind: "host",
    lane: "business",
    platform: input.platform,
    kind: input.kind,
    q: input.query,
    ...(input.country ? { country: input.country } : {}),
  });
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

export async function listHostAdWorkspace(brandId: string): Promise<{
  plans: HostAdPlanAggregate[];
  drafts: HostAdDraft[];
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
  radiusKm: number | null;
  interests: HostAdTargetingInterest[];
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
};

export type PreparedHostAdPlan = {
  planId: string;
  versionId: string;
  planHash: string;
  status: "ready" | "broader" | "blocked";
  targeting: TargetingSnapshot[];
  measurement: Record<string, unknown> | null;
  mediaRights: Record<string, unknown> | null;
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

function targetingName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function targetingCityKey(city: { name: string; countryCode: string }): string {
  return `${city.countryCode.trim().toUpperCase()}:${targetingName(city.name)}`;
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
    ...(input.cities.length > 0
      ? {
          cities: input.cities.map((city) => ({
            name: city.name,
            countryCode: city.countryCode,
          })),
        }
      : {}),
    ...(input.cities.length > 0 && input.radiusKm !== null
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
  };
  const refsByPlatform = Object.fromEntries(
    input.connections.map((connection) => {
      const locationIds = Object.fromEntries(
        input.cities.flatMap((city) => {
          const id = city.refs[connection.platform];
          return id ? [[targetingCityKey(city), id]] : [];
        }),
      );
      const interestIds = Object.fromEntries(
        input.interests.flatMap((interest) => {
          const id = interest.refs[connection.platform];
          return id ? [[targetingName(interest.name), id]] : [];
        }),
      );
      return [
        connection.platform,
        {
          ...(Object.keys(locationIds).length > 0 ? { locationIds } : {}),
          ...(Object.keys(interestIds).length > 0 ? { interestIds } : {}),
        },
      ];
    }),
  );
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
  const deliveryBudgets = canonical.delivery_budgets as
    Record<string, Record<string, unknown>> | undefined;
  const daily = Number(deliveryBudgets?.[platform]?.host_amount_cents);
  const cap = Number(allocation.host_budget_cents);
  const providerDaily = Number(
    deliveryBudgets?.[platform]?.provider_amount_cents,
  );
  const providerCap = Number(allocation.provider_budget_cents);
  const commonTargeting = hostExecutionTargeting(snapshot);
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
      "The immutable plan has no recorded video creative",
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
            lane: "business",
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
              `${platform}: ${row.error?.message ?? "The ad platform could not prepare this video"}`,
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
            `${platform} is still preparing the video; resume this exact plan shortly`,
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
      "This is no longer the current plan version",
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
      "Mingla staff approval is still required",
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
      "Hold the approved budget before launch",
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
        "Provider create returned no campaign ID",
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
