type UnknownRow = Record<string, unknown>;

export type CreativeLibraryInput = {
  creatives: UnknownRow[];
  versions: UnknownRow[];
  plans: UnknownRow[];
  campaigns: UnknownRow[];
  adSets: UnknownRow[];
  ads: UnknownRow[];
  providerRefs: UnknownRow[];
};

const PROVIDER_STATUS_PRIORITY: Record<string, number> = {
  failed: 6,
  timed_out: 5,
  processing: 4,
  uploading: 3,
  pending: 2,
  ready: 1,
};

function record(value: unknown): UnknownRow | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRow
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): number {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function ratioLabel(value: unknown): string | null {
  const ratio = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  if (Math.abs(ratio - 9 / 16) <= 0.035) return "Reels & stories · 9:16";
  if (Math.abs(ratio - 4 / 5) <= 0.04) return "Portrait feed · 4:5";
  if (Math.abs(ratio - 1) <= 0.04) return "Square feed · 1:1";
  if (Math.abs(ratio - 1.91) <= 0.08) return "Landscape feed · 1.91:1";
  if (Math.abs(ratio - 16 / 9) <= 0.08) return "Landscape video · 16:9";
  return `Custom ratio · ${ratio.toFixed(2)}:1`;
}

function variantLabels(value: unknown): string[] {
  const variants = record(value);
  if (!variants) return [];
  const labels: Record<string, string> = {
    "9:16": "Reels & stories · 9:16",
    "4:5": "Portrait feed · 4:5",
    "1:1": "Square feed · 1:1",
    "1.91:1": "Landscape feed · 1.91:1",
  };
  return Object.keys(variants).flatMap((key) =>
    labels[key] ? [labels[key]] : []
  );
}

function summarizeProviderRefs(rows: UnknownRow[]) {
  const grouped = new Map<string, UnknownRow[]>();
  for (const row of rows) {
    const platform = text(row.platform);
    const lane = text(row.lane);
    if (!platform || !lane) continue;
    const key = `${platform}:${lane}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const providerReadiness = [...grouped.entries()].map(([key, candidates]) => {
    const selected = [...candidates].sort((a, b) => {
      const statusDelta = (PROVIDER_STATUS_PRIORITY[String(b.status)] ?? 0) -
        (PROVIDER_STATUS_PRIORITY[String(a.status)] ?? 0);
      return statusDelta || timestamp(b.updated_at) - timestamp(a.updated_at);
    })[0];
    const [platform, lane] = key.split(":");
    return {
      platform,
      lane,
      status: text(selected.status) ?? "pending",
      retryable: selected.retryable === true,
      last_checked_at: text(selected.last_checked_at),
      updated_at: text(selected.updated_at),
    };
  }).sort((a, b) => a.platform.localeCompare(b.platform));

  const statuses = providerReadiness.map((row) => row.status);
  let processingSummary = "not_started";
  if (statuses.some((status) => ["failed", "timed_out"].includes(status))) {
    processingSummary = "needs_attention";
  } else if (
    statuses.some((status) => ["uploading", "processing"].includes(status))
  ) {
    processingSummary = "preparing";
  } else if (
    statuses.length > 0 && statuses.every((status) => status === "ready")
  ) {
    processingSummary = "ready";
  } else if (statuses.length > 0) {
    processingSummary = "partial";
  }
  return {
    provider_readiness: providerReadiness,
    processing_summary: processingSummary,
  };
}

/**
 * Builds the Admin Creative Library presentation contract. Provider account
 * identifiers, uploaded media references, content hashes and storage paths are
 * intentionally not accepted by the returned shape.
 */
// MINGLA-INVARIANT: I-CREATIVE-HOUSE-REUSE-BY-PROVENANCE | issue #3697 | house reuse requires source='admin_upload' and no brand
export function isHouseReusable(creative: UnknownRow): boolean {
  return creative.source === "admin_upload" && creative.brand_id === null;
}

function sourceSummary(creative: UnknownRow): string {
  switch (creative.source) {
    case "admin_upload":
      return creative.brand_id ? "Host brand library" : "Mingla admin library";
    case "ari_upload":
      return "From Ari";
    case "event_cover":
      return "Event cover";
    case "host_upload":
      return "Host brand library";
    default:
      return creative.brand_id ? "Host brand library" : "Mingla admin library";
  }
}

export function buildCreativeLibrary(input: CreativeLibraryInput) {
  const plansById = new Map(input.plans.map((row) => [String(row.id), row]));
  const versionsById = new Map(
    input.versions.map((row) => [String(row.id), row]),
  );
  const campaignById = new Map(
    input.campaigns.map((row) => [String(row.id), row]),
  );
  const campaignIdByAdSet = new Map(
    input.adSets.map((row) => [String(row.id), String(row.campaign_id)]),
  );
  const campaignIdsByCreative = new Map<string, Set<string>>();
  for (const ad of input.ads) {
    const creativeId = text(ad.creative_id);
    const campaignId = campaignIdByAdSet.get(String(ad.ad_set_id));
    if (!creativeId || !campaignId) continue;
    const ids = campaignIdsByCreative.get(creativeId) ?? new Set<string>();
    ids.add(campaignId);
    campaignIdsByCreative.set(creativeId, ids);
  }

  return input.creatives.map((creative) => {
    const creativeId = String(creative.id);
    const usedVersions = input.versions.filter((version) => {
      const canonical = record(version.canonical_plan);
      return canonical?.creative_library_id === creativeId;
    }).sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at));
    const usedPlanIds = new Set(
      usedVersions.map((version) => String(version.plan_id)),
    );
    const campaignIds = new Set(campaignIdsByCreative.get(creativeId) ?? []);
    for (const campaign of input.campaigns) {
      const version = versionsById.get(String(campaign.plan_version_id));
      const canonical = record(version?.canonical_plan);
      if (canonical?.creative_library_id === creativeId) {
        campaignIds.add(String(campaign.id));
      }
    }
    const campaigns = [...campaignIds].flatMap((id) => {
      const campaign = campaignById.get(id);
      return campaign ? [campaign] : [];
    });
    const providerSummary = summarizeProviderRefs(
      input.providerRefs.filter((row) => row.creative_id === creativeId),
    );
    const latestVersion = usedVersions[0] ?? null;
    const latestCanonical = record(latestVersion?.canonical_plan);
    const mediaRights = record(latestCanonical?.media_rights);
    const placementFormats = new Set([
      ...variantLabels(creative.variants),
      ...(ratioLabel(creative.aspect_ratio)
        ? [ratioLabel(creative.aspect_ratio)]
        : []),
    ].filter((label): label is string => Boolean(label)));
    const usedAtValues = [...usedVersions, ...campaigns]
      .map((row) => text(row.updated_at) ?? text(row.created_at))
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => timestamp(b) - timestamp(a));
    const lastUsedAt: string | null = usedAtValues.length > 0
      ? usedAtValues[0]
      : null;
    const activeCampaigns = campaigns.filter((campaign) =>
      ["ACTIVE", "active"].includes(String(campaign.status))
    ).length;
    const planStates = [...usedPlanIds].flatMap((id) => {
      const plan = plansById.get(id);
      return plan && text(plan.state) ? [String(plan.state)] : [];
    });

    return {
      id: creativeId,
      name: text(creative.name) ?? "Untitled creative",
      kind: text(creative.kind) ?? "unknown",
      status: text(creative.status) ?? "unknown",
      preview_url: text(creative.poster_url) ??
        (creative.kind === "image" ? text(creative.source_url) : null),
      aspect_ratio: creative.aspect_ratio ?? null,
      duration_seconds: creative.duration_seconds ?? null,
      ai_generated: creative.ai_generated === true,
      source_summary: sourceSummary(creative),
      // Legal hold: Host-owned media stays visible for operations, but cannot
      // be selected into a Mingla house plan until Terms approval exists.
      // #3040/#3697 — house media is decided by immutable provenance, never by
      // a brand that happens to be missing.
      house_reuse_allowed: isHouseReusable(creative),
      source: text(creative.source),
      source_job_id: text(creative.source_job_id),
      rendition_height: typeof creative.rendition_height === "number"
        ? creative.rendition_height
        : null,
      placement_formats: [...placementFormats],
      version_label: latestVersion
        ? `v${Number(latestVersion.version_number) || 1}`
        : "Not used in a plan",
      rights: mediaRights?.rights_confirmed === true
        ? {
          state: "confirmed",
          basis: text(mediaRights.rights_basis) ?? "Confirmed",
          ai_generated: mediaRights.ai_generated === true,
        }
        : {
          state: usedVersions.length > 0 ? "missing" : "not_recorded",
          basis: null,
          ai_generated: creative.ai_generated === true,
        },
      usage: {
        plan_count: usedPlanIds.size,
        campaign_count: campaignIds.size,
        active_campaign_count: activeCampaigns,
        last_used_at: lastUsedAt,
        plan_states: [...new Set(planStates)].sort(),
      },
      ...providerSummary,
      created_at: text(creative.created_at),
      updated_at: text(creative.updated_at),
    };
  }).sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at));
}
