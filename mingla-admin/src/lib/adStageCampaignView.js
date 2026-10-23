const STAGE_LABELS = Object.freeze({
  prospecting: "Prospecting",
  retarget: "Retarget",
  abandoners: "Abandoners",
});

export function stageMetricView(adSet) {
  const metrics = Array.isArray(adSet?.ad_stage_metrics_daily)
    ? adSet.ad_stage_metrics_daily
    : [];
  const spendCents = metrics.reduce(
    (sum, row) => sum + Math.max(0, Number(row.spend_cents) || 0),
    0,
  );
  const results = metrics.reduce(
    (sum, row) => sum + Math.max(0, Number(row.results) || 0),
    0,
  );
  const reach = metrics.reduce(
    (sum, row) => sum + Math.max(0, Number(row.reach) || 0),
    0,
  );
  const impressions = metrics.reduce(
    (sum, row) => sum + Math.max(0, Number(row.impressions) || 0),
    0,
  );
  const audienceSizes = adSet?.audience_sizes &&
      typeof adSet.audience_sizes === "object"
    ? adSet.audience_sizes
    : {};
  const tooSmall = Object.entries(audienceSizes)
    .filter(([, size]) => Number.isFinite(Number(size)) && Number(size) < 1000)
    .map(([code]) => code);
  return {
    stage: adSet?.stage ?? null,
    label: STAGE_LABELS[adSet?.stage] ?? "Unstaged",
    spendCents,
    results,
    costPerResultCents: results > 0 ? Math.round(spendCents / results) : null,
    reach,
    frequency: reach > 0 ? impressions / reach : 0,
    currency: metrics.find((row) => /^[A-Z]{3}$/.test(row.currency ?? ""))
      ?.currency ?? null,
    hasMetrics: metrics.length > 0,
    audienceTooSmallCodes: tooSmall,
  };
}

export function campaignStageViews(campaign) {
  return (campaign?.ad_sets ?? [])
    .filter((adSet) => ["prospecting", "retarget", "abandoners"].includes(adSet.stage))
    .map(stageMetricView)
    .sort((a, b) =>
      ["prospecting", "retarget", "abandoners"].indexOf(a.stage) -
      ["prospecting", "retarget", "abandoners"].indexOf(b.stage)
    );
}
