/**
 * Issue #3697 — the plain-English facts one campaign row shows (pure).
 *
 * One status chip instead of the raw advertiser + delivery badges, dates in
 * the campaign's own schedule zone (never the viewer's browser), spend against
 * the provider hard cap from the spend-sync rows, and the provider deep link.
 * Every value comes from the row; anything missing renders as "—".
 */

import { campaignLifecycle } from "./adCampaignWorkspace.js";
import { HARD_CAP_PAUSE_RATIO, formatCampaignMoney } from "./adSpendCap.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Delivery states that mean the provider is actually serving the ad. */
const DELIVERING_STATES = new Set(["ACTIVE"]);

/**
 * The one status chip for a campaign row.
 * @returns {{ label: string, variant: string, key: string }}
 */
export function campaignStatusChip(campaign, now = new Date()) {
  const lifecycle = campaignLifecycle(campaign, now);
  if (lifecycle === "needs_attention") {
    return { key: lifecycle, label: "Needs attention", variant: "error" };
  }
  if (lifecycle === "ended") {
    return { key: lifecycle, label: "Ended", variant: "default" };
  }
  if (lifecycle === "scheduled") {
    return { key: lifecycle, label: "Scheduled", variant: "info" };
  }
  if (lifecycle === "live") {
    const delivery = String(campaign?.delivery_status ?? "").toUpperCase();
    return DELIVERING_STATES.has(delivery)
      ? { key: "live", label: "Live · delivering", variant: "success" }
      : { key: "live", label: "Live · in review", variant: "info" };
  }
  return { key: "paused", label: "Paused", variant: "default" };
}

function validZone(zone) {
  if (typeof zone !== "string" || zone.length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** "Africa/Lagos" → "Lagos time"; "UTC" → "UTC". */
export function zoneCityLabel(zone) {
  if (!validZone(zone)) return null;
  if (zone === "UTC" || zone === "Etc/UTC") return "UTC";
  const city = zone.split("/").pop()?.replaceAll("_", " ");
  return city ? `${city} time` : zone;
}

function formatWall(iso, zone) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/**
 * Start → end in the campaign's schedule zone, labelled. A campaign whose plan
 * recorded no zone is shown in UTC and labelled UTC — never the browser zone.
 * @returns {{ range: string|null, zoneLabel: string, daysLeftLabel: string|null }}
 */
export function campaignScheduleInZone({
  startsAt = null,
  endsAt = null,
  timeZone = null,
  now = new Date(),
} = {}) {
  const zone = validZone(timeZone) ? timeZone : "UTC";
  const start = formatWall(startsAt, zone);
  const end = formatWall(endsAt, zone);
  const range = start && end
    ? `${start} → ${end}`
    : start
      ? `Starts ${start}`
      : end
        ? `Ends ${end}`
        : null;
  const endMs = Date.parse(endsAt ?? "");
  let daysLeftLabel = null;
  if (Number.isFinite(endMs) && endMs > now.getTime()) {
    const days = Math.ceil((endMs - now.getTime()) / DAY_MS);
    daysLeftLabel = `${days} day${days === 1 ? "" : "s"} left`;
  }
  return { range, zoneLabel: zoneCityLabel(zone), daysLeftLabel };
}

function positiveInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * The provider money a row enforces. An amended budget (#3697 Change budget)
 * supersedes the frozen plan allocation; the frozen value stays the fallback.
 */
export function effectiveProviderMoney(campaign) {
  const currency =
    typeof campaign?.provider_currency === "string" &&
    /^[A-Z]{3}$/.test(campaign.provider_currency)
      ? campaign.provider_currency
      : null;
  const capCents =
    positiveInt(campaign?.amended_provider_budget_cents) ??
    positiveInt(campaign?.provider_budget_cents);
  const dailyCents =
    positiveInt(campaign?.amended_provider_delivery_budget_cents) ??
    positiveInt(campaign?.provider_delivery_budget_cents);
  return { currency, capCents, dailyCents };
}

/**
 * Spend-to-date from the ad_spend_daily rows embedded on the campaign. Only
 * rows in the provider currency count; a mismatched row makes spend unknown
 * rather than mixing currencies.
 */
export function campaignSpendToDate(campaign) {
  const { currency } = effectiveProviderMoney(campaign);
  const rows = Array.isArray(campaign?.ad_spend_daily)
    ? campaign.ad_spend_daily
    : [];
  if (!currency || rows.length === 0) {
    return { spendCents: null, lastSpendSyncAt: latest(rows) };
  }
  let total = 0;
  for (const row of rows) {
    const rowCurrency = String(row?.currency ?? "").trim().toUpperCase();
    const cents = Number(row?.spend_cents);
    if (rowCurrency !== currency || !Number.isFinite(cents) || cents < 0) {
      return { spendCents: null, lastSpendSyncAt: latest(rows) };
    }
    total += cents;
  }
  return { spendCents: total, lastSpendSyncAt: latest(rows) };
}

function latest(rows) {
  let best = null;
  for (const row of rows ?? []) {
    const ms = Date.parse(row?.synced_at ?? "");
    if (Number.isFinite(ms) && (best === null || ms > best)) best = ms;
  }
  return best === null ? null : new Date(best).toISOString();
}

/**
 * Everything the row's money block shows, derived from real values only.
 */
export function campaignMoneyFacts(campaign) {
  const { currency, capCents, dailyCents } = effectiveProviderMoney(campaign);
  const { spendCents, lastSpendSyncAt } = campaignSpendToDate(campaign);
  const pauseAtCents =
    capCents === null ? null : Math.floor(capCents * HARD_CAP_PAUSE_RATIO);
  const ratio =
    capCents !== null && spendCents !== null ? spendCents / capCents : null;
  const cadence = campaign?.lifetime_budget_cents != null ? "lifetime" : "daily";
  // Meta may spend up to 75% over a daily budget on a single day (it evens
  // out over the week); other providers publish no such figure here.
  const busyDayCents =
    campaign?.platform === "meta" && cadence === "daily" && dailyCents !== null
      ? Math.round(dailyCents * 1.75)
      : null;
  const syncs = [campaign?.status_synced_at, lastSpendSyncAt]
    .map((iso) => Date.parse(iso ?? ""))
    .filter(Number.isFinite);
  const lastSyncedAt = syncs.length
    ? new Date(Math.max(...syncs)).toISOString()
    : null;
  const money = (cents) => formatCampaignMoney(currency, cents);
  return {
    currency,
    cadence,
    capCents,
    dailyCents,
    spendCents,
    pauseAtCents,
    ratio,
    barRatio: ratio === null ? null : Math.min(Math.max(ratio, 0), 1),
    atPauseThreshold: ratio !== null && ratio >= HARD_CAP_PAUSE_RATIO,
    busyDayCents,
    lastSyncedAt,
    spendLabel: spendCents === null ? "—" : money(spendCents),
    capLabel: capCents === null ? "—" : money(capCents),
    pauseAtLabel: pauseAtCents === null ? "—" : money(pauseAtCents),
    dailyLabel: dailyCents === null ? "—" : money(dailyCents),
    busyDayLabel: busyDayCents === null ? null : money(busyDayCents),
  };
}

/** "just now", "12 min ago", "3 h ago", "2 days ago"; null when unknown. */
export function relativeTimeLabel(iso, now = new Date()) {
  const ms = Date.parse(iso ?? "");
  if (!Number.isFinite(ms)) return null;
  const diff = Math.max(0, now.getTime() - ms);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Meta account ids are stored with or without the "act_" prefix. */
function metaAccountNumber(externalAccountId) {
  const raw = String(externalAccountId ?? "").trim().replace(/^act_/i, "");
  return /^[0-9]+$/.test(raw) ? raw : null;
}

/**
 * The provider's own manager page for one object. Only providers whose deep
 * link is built from IDs Mingla records are listed; any other provider (or a
 * missing ID) returns null and the page hides the link.
 */
const META_LEVEL_PAGES = {
  campaign: ["campaigns", "selected_campaign_ids"],
  ad_set: ["adsets", "selected_adset_ids"],
  ad: ["ads", "selected_ad_ids"],
};

const PROVIDER_OBJECT_LINKS = {
  meta: ({ accountId, level, externalId }) => {
    const act = metaAccountNumber(accountId);
    const page = META_LEVEL_PAGES[level];
    if (!act || !page || !/^[0-9]+$/.test(externalId)) return null;
    const query = new URLSearchParams({ act, [page[1]]: externalId });
    return `https://adsmanager.facebook.com/adsmanager/manage/${page[0]}?${query.toString()}`;
  },
};

export function providerObjectUrl({ platform, level, accountId, externalId }) {
  const build = PROVIDER_OBJECT_LINKS[platform];
  const id = String(externalId ?? "").trim();
  if (!build || !id) return null;
  return build({ accountId, level, externalId: id });
}

export function providerManagerUrl(campaign, connection = campaign?.connection) {
  return providerObjectUrl({
    platform: campaign?.platform,
    level: "campaign",
    accountId: connection?.external_account_id,
    externalId: campaign?.external_campaign_id,
  });
}

/** "Meta" → "Open in Meta". */
export function providerManagerLabel(platformLabel) {
  return `Open in ${platformLabel}`;
}
