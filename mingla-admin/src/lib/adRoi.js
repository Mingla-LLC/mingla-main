/**
 * ISSUE-865 PR1 WP-4 — pure ROI math for the campaign "Conversions & ROI" panel.
 *
 * NO fabrication (the dashboard constitution): ROAS and cost-per-result are
 * derived ONLY from a REAL spend figure. There is no in-DB actual-spend source
 * yet (platform insights land with #863), so the rollup returns spend_cents:null
 * and these helpers return null for the spend-dependent metrics — the panel then
 * shows an honest "—" / "connect spend reporting" instead of a made-up number.
 *
 * Framework-free (no React) so it is unit-tested with node:test — the house admin
 * test idiom (pure-logic modules + fs source assertions).
 */

/** Legacy aggregate retained for callers that only need a raw counter. */
export function totalValueCents(valueByCurrency) {
  if (!valueByCurrency || typeof valueByCurrency !== "object") return 0;
  return Object.values(valueByCurrency).reduce((sum, raw) => {
    const value = Number(raw);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
}

/** Money is comparable only when every unit belongs to one currency. */
export function comparableValueCents(valueByCurrency) {
  if (!valueByCurrency || typeof valueByCurrency !== "object") return null;
  const entries = Object.entries(valueByCurrency).filter(([, raw]) =>
    Number.isFinite(Number(raw))
  );
  return entries.length === 1 ? Number(entries[0][1]) : null;
}

/**
 * ROAS = attributed value / spend. Returns null when spend is unknown (null) or
 * <= 0 (a real division would fabricate/inflate). Rounded to 2 dp.
 */
export function computeRoas(valueCents, spendCents) {
  const v = Number(valueCents);
  const s = Number(spendCents);
  if (!Number.isFinite(v) || !Number.isFinite(s) || s <= 0) return null;
  return Math.round((v / s) * 100) / 100;
}

/**
 * Cost per result (cents) = spend / conversions. Null when spend is unknown or
 * there are zero conversions.
 */
export function computeCostPerResult(spendCents, conversions) {
  const s = Number(spendCents);
  const c = Number(conversions);
  if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(c) || c <= 0) return null;
  return Math.round(s / c);
}

/**
 * Shape the raw ad_campaign_conversion_rollup jsonb into the panel's view model.
 * Honest-empty safe: a null / unauthorized payload → zeros + null ROI metrics.
 */
export function toCampaignRoiView(raw) {
  const row = raw && typeof raw === "object" ? raw : {};
  const conversions = Number(row.conversions) || 0;
  const valueByCurrency = row.value_cents && typeof row.value_cents === "object" ? row.value_cents : {};
  const valueCents = comparableValueCents(valueByCurrency);
  const spendCents = row.spend_cents === null || row.spend_cents === undefined
    ? null
    : Number(row.spend_cents);
  const byPlatform = Array.isArray(row.by_platform)
    ? row.by_platform.map((p) => ({
        platform: typeof p.platform === "string" ? p.platform : "unknown",
        conversions: Number(p.conversions) || 0,
        valueCents: Number(p.value_cents) || 0,
        sent: Number(p.sent) || 0,
        failed: Number(p.failed) || 0,
      }))
    : [];
  const sendHealth = row.send_health && typeof row.send_health === "object" ? row.send_health : {};
  return {
    authorized: row.authorized !== false,
    conversions,
    valueByCurrency,
    valueCents,
    spendCents,
    roas: valueCents === null ? null : computeRoas(valueCents, spendCents),
    costPerResultCents: computeCostPerResult(spendCents, conversions),
    byPlatform,
    sendHealth: {
      sent: Number(sendHealth.sent) || 0,
      failed: Number(sendHealth.failed) || 0,
      skipped: Number(sendHealth.skipped) || 0,
      pending: Number(sendHealth.pending) || 0,
    },
    hasData: conversions > 0,
  };
}
