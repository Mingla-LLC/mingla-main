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
      // #4238: Host-visible; "results" when the page names no result kind.
      primary_result_label: text(hierarchy[0]) ?? "results",
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

// ── #4238 wave 2: results over time ─────────────────────────────────────────

export type DailySeriesRow = {
  day: string;
  campaign_id: string;
  platform: string | null;
  spend_cents: number | null;
  currency: string | null;
  impressions: number | null;
  clicks: number | null;
  page_visits: number | null;
  results: number | null;
};

export type HostDailyPoint = {
  day: string;
  spend_host_cents: number | null;
  spend_provider_cents: number | null;
  provider_currency: string | null;
  impressions: number | null;
  clicks: number | null;
  page_visits: number | null;
  results: number | null;
};

/** Converts a provider-currency total into host currency; null when it can't. */
export type FrozenConvert = (input: {
  amount: number;
  platform: string;
  source: string;
}) => Promise<number | null>;

function sumOrNull(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number =>
    value !== null && Number.isFinite(value)
  );
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0);
}

/**
 * One point per day for the Host charts. Host-currency spend converts each
 * platform's CUMULATIVE provider total through the plan's frozen FX and takes
 * differences, so the last cumulative point equals host_spend_equivalent_cents
 * exactly. If any conversion fails, every day's spend_host_cents is null and
 * the chart falls back to provider currency. Missing data stays null.
 */
export async function buildHostDailySeries(input: {
  rows: DailySeriesRow[];
  hostCurrency: string | null;
  convert: FrozenConvert;
}): Promise<{
  daily: HostDailyPoint[];
  by_platform_spend: {
    platform: string;
    spend_provider_cents: number;
    provider_currency: string | null;
    results: number;
  }[];
}> {
  const days = [...new Set(input.rows.map((row) => row.day))].sort();
  const platforms = [
    ...new Set(input.rows.map((row) => row.platform ?? "unknown")),
  ].sort();
  const providerCurrencies = new Set(
    input.rows.filter((row) => row.spend_cents !== null && row.currency)
      .map((row) => String(row.currency).toUpperCase()),
  );
  const providerCurrency = providerCurrencies.size === 1
    ? [...providerCurrencies][0]
    : null;
  const hostByDay = new Map<string, number>();
  let hostOk = !!input.hostCurrency;
  for (const platform of platforms) {
    if (!hostOk) break;
    const rows = input.rows.filter((row) =>
      (row.platform ?? "unknown") === platform && row.spend_cents !== null
    );
    const currency = rows[0]?.currency?.toUpperCase() ?? null;
    if (rows.some((row) => row.currency?.toUpperCase() !== currency)) {
      hostOk = false;
      break;
    }
    let cumulative = 0;
    let previousConverted = 0;
    for (const day of days) {
      const dayCents = rows.filter((row) => row.day === day)
        .reduce((sum, row) => sum + Number(row.spend_cents ?? 0), 0);
      if (dayCents === 0 && cumulative === 0) continue;
      cumulative += dayCents;
      const converted = currency === input.hostCurrency
        ? cumulative
        : currency
        ? await input.convert({ amount: cumulative, platform, source: currency })
        : null;
      if (converted === null || !Number.isSafeInteger(converted)) {
        hostOk = false;
        break;
      }
      hostByDay.set(day, (hostByDay.get(day) ?? 0) + (converted - previousConverted));
      previousConverted = converted;
    }
  }
  const daily = days.map((day) => {
    const rows = input.rows.filter((row) => row.day === day);
    const providerSpend = sumOrNull(rows.map((row) => row.spend_cents));
    return {
      day,
      spend_host_cents: hostOk
        ? (providerSpend === null ? null : hostByDay.get(day) ?? 0)
        : null,
      spend_provider_cents: providerCurrency ? providerSpend : null,
      provider_currency: providerCurrency,
      impressions: sumOrNull(rows.map((row) => row.impressions)),
      clicks: sumOrNull(rows.map((row) => row.clicks)),
      page_visits: sumOrNull(rows.map((row) => row.page_visits)),
      results: sumOrNull(rows.map((row) => row.results)),
    };
  });
  const by_platform_spend = platforms.map((platform) => {
    const rows = input.rows.filter((row) => (row.platform ?? "unknown") === platform);
    return {
      platform,
      spend_provider_cents: rows.reduce((sum, row) => sum + Number(row.spend_cents ?? 0), 0),
      provider_currency: rows.find((row) => row.currency)?.currency?.toUpperCase() ?? null,
      results: rows.reduce((sum, row) => sum + Number(row.results ?? 0), 0),
    };
  });
  return { daily, by_platform_spend };
}

/** "2026-11-02" for an instant in a time zone (UTC when the zone is unknown). */
export function dayInZone(instantIso: string, timeZone: string | null): string {
  const date = new Date(instantIso);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Converts provider minor units into host minor units at a frozen rate. */
export type ListSummaryConvert = (input: {
  amount: number;
  source: string;
  target: string;
  snapshotId: string | null;
}) => Promise<number | null>;

/**
 * The Host Ads list summary ("This month" card), in the brand currency.
 *
 * #4238 P1-3: provider-currency spend (Meta bills in USD) is converted with
 * each plan's frozen exchange rate, the same way the detail page converts
 * host_spend_equivalent_cents: the campaign's cumulative total is converted,
 * and this month is that minus the converted total before the month. If any
 * campaign's spend can't be converted (no allocation, mixed currencies, a
 * failed conversion), spend is hidden (null) rather than shown partial.
 * Months, days and results are counted in the brand's time zone. Results are
 * only this calendar month's.
 */
export async function buildHostListSummary(input: {
  campaigns: ReturnType<typeof buildHostCampaignList>;
  /** ad_campaigns rows: id, platform, plan_version_id. */
  rawCampaigns: Row[];
  spend: Row[];
  /** ad_conversions rows: campaign_id, created_at. */
  conversions: Row[];
  /** ad_plan_provider_allocations rows. */
  allocations: Row[];
  nowIso: string;
  timeZone: string | null;
  convert: ListSummaryConvert;
}): Promise<{
  currency: string | null;
  spent_cents: number | null;
  budget_cents: number;
  results: number;
  daily_spend: { day: string; cents: number | null }[];
} | null> {
  if (input.campaigns.length === 0) return null;
  const currencies = unique(input.campaigns.map((row) => row.currency))
    .map((code) => code.toUpperCase());
  const currency = currencies.length === 1 ? currencies[0] : null;
  const today = dayInZone(input.nowIso, input.timeZone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const windowStartMs = Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000;
  const windowDays = Array.from({ length: 30 }, (_, i) =>
    new Date(windowStartMs + i * 86_400_000).toISOString().slice(0, 10)
  );
  const dayHost = new Map<string, number>(windowDays.map((day) => [day, 0]));
  let monthHost: number | null = currency ? 0 : null;

  for (const campaign of input.rawCampaigns) {
    if (monthHost === null) break;
    const id = String(campaign.id);
    const rows = input.spend.filter((row) => String(row.campaign_id) === id);
    if (rows.length === 0) continue;
    const amounts = rows.map((row) => integer(row.spend_cents));
    const sources = unique(rows.map((row) => row.currency)).map((code) => code.toUpperCase());
    if (amounts.some((value) => value === null) || sources.length !== 1) {
      monthHost = null;
      break;
    }
    const source = sources[0];
    let snapshotId: string | null = null;
    if (source !== currency) {
      const allocation = input.allocations.find((row) =>
        text(row.plan_version_id) === text(campaign.plan_version_id) &&
        text(row.platform) === text(campaign.platform)
      );
      if (
        !allocation || !text(campaign.plan_version_id) ||
        text(allocation.provider_currency)?.toUpperCase() !== source ||
        text(allocation.host_currency)?.toUpperCase() !== currency
      ) {
        monthHost = null;
        break;
      }
      snapshotId = text(allocation.fx_snapshot_id);
    }
    const convert = (amount: number) =>
      amount === 0
        ? Promise.resolve(0)
        : source === currency
        ? Promise.resolve(amount)
        : input.convert({ amount, source, target: currency!, snapshotId });
    const total = rows.reduce((sum, row) => sum + (integer(row.spend_cents) ?? 0), 0);
    const before = rows.filter((row) => (text(row.spend_date) ?? "") < monthStart)
      .reduce((sum, row) => sum + (integer(row.spend_cents) ?? 0), 0);
    const [totalHost, beforeHost] = await Promise.all([convert(total), convert(before)]);
    if (
      totalHost === null || beforeHost === null ||
      !Number.isSafeInteger(totalHost) || !Number.isSafeInteger(beforeHost)
    ) {
      monthHost = null;
      break;
    }
    monthHost += totalHost - beforeHost;
    // The sparkline: each day's provider spend at this campaign's frozen rate.
    const rate = total > 0 ? totalHost / total : 0;
    for (const row of rows) {
      const day = text(row.spend_date);
      if (day && dayHost.has(day)) {
        dayHost.set(day, (dayHost.get(day) ?? 0) + Math.round((integer(row.spend_cents) ?? 0) * rate));
      }
    }
  }

  const monthCampaignIds = new Set(
    input.spend.filter((row) => (text(row.spend_date) ?? "") >= monthStart)
      .map((row) => String(row.campaign_id)),
  );
  const running = input.campaigns.filter((row) =>
    ["live", "scheduled", "in_review"].includes(String(row.lifecycle)) ||
    row.campaign_ids.some((id) => monthCampaignIds.has(id))
  );
  const listedIds = new Set(input.campaigns.flatMap((row) => row.campaign_ids));
  const results = input.conversions.filter((row) => {
    const at = text(row.created_at);
    return listedIds.has(String(row.campaign_id)) && !!at &&
      Number.isFinite(Date.parse(at)) &&
      dayInZone(at, input.timeZone).slice(0, 7) === today.slice(0, 7);
  }).length;
  return {
    currency,
    spent_cents: monthHost,
    budget_cents: running.reduce((sum, row) => sum + (row.cap_cents ?? 0), 0),
    results,
    daily_spend: windowDays.map((day) => ({
      day,
      cents: monthHost === null ? null : dayHost.get(day) ?? 0,
    })),
  };
}
