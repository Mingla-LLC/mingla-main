type Row = Record<string, unknown>;

export type HostCampaignListInput = {
  campaigns: Row[];
  versions: Row[];
  plans: Row[];
  spend: Row[];
  conversions: Row[];
  adSets: Row[];
  ads: Row[];
  nowIso: string;
};

function record(value: unknown): Row | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function unique(values: unknown[]): string[] {
  return [
    ...new Set(values.flatMap((value) => {
      const item = text(value);
      return item ? [item] : [];
    })),
  ];
}

function lifecycle(
  planState: string | null,
  campaignStatuses: string[],
  reviewStatuses: string[],
  startsAt: string | null,
  nowIso: string,
): string {
  const state = planState?.toLowerCase() ?? "";
  if (["platform_review"].includes(state)) return "in_review";
  if (["scheduled"].includes(state)) return "scheduled";
  if (["live"].includes(state)) return "live";
  if (["pause_requested", "paused"].includes(state)) return "paused";
  if (["ended", "cancelled_before_create", "expired"].includes(state)) {
    return "ended";
  }
  if (
    [
      "partially_ready",
      "partially_live",
      "creation_failed_retryable",
      "creation_failed_terminal",
      "payment_failed",
      "changes_requested",
      "staff_rejected",
      "platform_rejected",
      "stop_requested",
      "settling",
      "settlement_attention_required",
    ].includes(state)
  ) return "needs_attention";
  if (reviewStatuses.some((status) => status.includes("REJECT"))) {
    return "needs_attention";
  }
  if (campaignStatuses.some((status) => status === "ACTIVE")) return "live";
  if (
    campaignStatuses.length > 0 &&
    campaignStatuses.every((status) => ["ARCHIVED", "DELETED"].includes(status))
  ) return "ended";
  if (startsAt && startsAt > nowIso) return "scheduled";
  return "paused";
}

function nextAction(state: string): string {
  const labels: Record<string, string> = {
    in_review: "Track review",
    scheduled: "View schedule",
    live: "View results",
    paused: "Resume",
    needs_attention: "Fix issue",
    ended: "View report",
  };
  return labels[state] ?? "Open";
}

/** One row per immutable Host plan, with legacy unbound campaigns kept alone. */
export function buildHostCampaignList(input: HostCampaignListInput) {
  const versionsById = new Map(
    input.versions.map((row) => [String(row.id), row]),
  );
  const plansByVersionId = new Map(
    input.plans.map((row) => [String(row.current_version_id), row]),
  );
  const campaignIdByAdSet = new Map(
    input.adSets.map((row) => [String(row.id), String(row.campaign_id)]),
  );
  const adsByCampaignId = new Map<string, Row[]>();
  for (const ad of input.ads) {
    const campaignId = campaignIdByAdSet.get(String(ad.ad_set_id));
    if (!campaignId) continue;
    adsByCampaignId.set(campaignId, [
      ...(adsByCampaignId.get(campaignId) ?? []),
      ad,
    ]);
  }
  const groups = new Map<string, Row[]>();
  for (const campaign of input.campaigns) {
    const versionId = text(campaign.plan_version_id);
    const key = versionId
      ? `plan:${versionId}`
      : `campaign:${String(campaign.id)}`;
    groups.set(key, [...(groups.get(key) ?? []), campaign]);
  }

  return [...groups.values()].map((campaigns) => {
    const first = campaigns[0];
    const campaignIds = campaigns.map((row) => String(row.id));
    const versionId = text(first.plan_version_id);
    const version = versionId ? versionsById.get(versionId) : null;
    const plan = versionId ? plansByVersionId.get(versionId) : null;
    const canonical = record(version?.canonical_plan);
    const measurement = record(canonical?.measurement);
    const hierarchy = Array.isArray(measurement?.result_hierarchy)
      ? measurement.result_hierarchy
      : [];
    const groupSpend = input.spend.filter((row) =>
      campaignIds.includes(String(row.campaign_id))
    );
    const spendByCurrencyMap = new Map<string, number>();
    let impressions = 0;
    let clicks = 0;
    for (const row of groupSpend) {
      const currency = text(row.currency)?.toUpperCase() ?? "";
      const amount = integer(row.spend_cents);
      if (/^[A-Z]{3}$/.test(currency) && amount !== null) {
        spendByCurrencyMap.set(
          currency,
          (spendByCurrencyMap.get(currency) ?? 0) + amount,
        );
      }
      impressions += integer(row.impressions) ?? 0;
      clicks += integer(row.clicks) ?? 0;
    }
    const spendByCurrency = [...spendByCurrencyMap.entries()].map(
      ([currency, spend_cents]) => ({ currency, spend_cents }),
    ).sort((a, b) => a.currency.localeCompare(b.currency));
    const hostCurrency = text(version?.host_currency) ?? text(first.currency);
    const hostSpend = spendByCurrency.length === 0
      ? 0
      : spendByCurrency.length === 1 &&
          spendByCurrency[0].currency === hostCurrency
      ? spendByCurrency[0].spend_cents
      : null;
    const conversions = input.conversions.filter((row) =>
      campaignIds.includes(String(row.campaign_id))
    );
    const resultsValueCents = new Map<string, number>();
    for (const row of conversions) {
      const currency = (text(row.currency) ?? hostCurrency ?? "").toUpperCase();
      const amount = integer(row.value_cents);
      if (!/^[A-Z]{3}$/.test(currency) || amount === null) continue;
      resultsValueCents.set(
        currency,
        (resultsValueCents.get(currency) ?? 0) + amount,
      );
    }
    const ads = campaignIds.flatMap((id) =>
      adsByCampaignId.get(id) ?? []
    );
    const reviewStatuses = unique(ads.map((row) => row.review_status)).map(
      (status) => status.toUpperCase(),
    );
    const campaignStatuses = campaigns.map((row) =>
      String(row.status ?? "").toUpperCase()
    );
    const startsAt = text(first.starts_at);
    const state = lifecycle(
      text(plan?.state),
      campaignStatuses,
      reviewStatuses,
      startsAt,
      input.nowIso,
    );
    const creativeAd = ads[0] ?? null;
    const creative = record(creativeAd?.ad_creatives);
    const cap = integer(version?.host_budget_cents) ??
      integer(first.host_budget_cents) ?? integer(first.cap_cents) ??
      integer(first.daily_budget_cents);

    return {
      ...first,
      id: String(first.id),
      campaign_ids: campaignIds,
      name: text(canonical?.name) ?? text(first.name) ?? "Ad",
      lifecycle: state,
      next_action: nextAction(state),
      plan_state: text(plan?.state),
      platforms: unique(campaigns.map((row) => row.platform)),
      destination: {
        page_type: text(first.dest_page_type),
        url: text(first.dest_url),
      },
      currency: hostCurrency,
      cap_cents: cap,
      host_spend_equivalent_cents: hostSpend,
      spend_by_currency: spendByCurrency,
      primary_result_label: text(hierarchy[0]) ?? "conversions",
      primary_result_count: conversions.length,
      cost_per_result_cents: hostSpend !== null && conversions.length > 0
        ? Math.round(hostSpend / conversions.length)
        : null,
      results_value_cents: Object.fromEntries(
        [...resultsValueCents.entries()].sort(([left], [right]) =>
          left.localeCompare(right)
        ),
      ),
      impressions,
      clicks,
      creative: creative
        ? {
          name: text(creative.name) ?? text(creativeAd?.name) ?? "Creative",
          kind: text(creative.kind) ?? "unknown",
          preview_url: text(creative.poster_url) ?? text(creative.source_url),
          review_status: text(creativeAd?.review_status) ??
            text(creativeAd?.status),
        }
        : null,
      updated_at: text(plan?.updated_at) ?? text(first.updated_at) ??
        text(first.created_at),
    };
  }).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}
