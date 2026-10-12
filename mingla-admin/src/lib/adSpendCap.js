/**
 * toward #3697 Wave 3 — spend-vs-cap + schedule honesty helpers (pure).
 * Cap pause threshold matches server (`adMoney` / spend sync): 98%.
 */

export const HARD_CAP_PAUSE_RATIO = 0.98;

/**
 * Format minor units in the campaign's currency (never force USD).
 * @param {string|null|undefined} currency
 * @param {number|string|null|undefined} minor
 */
export function formatCampaignMoney(currency, minor) {
  if (minor === null || minor === undefined || minor === "") return "—";
  const value = Number(minor);
  if (!Number.isFinite(value)) return "—";
  const code = typeof currency === "string" && /^[A-Z]{3}$/.test(currency) ? currency : null;
  if (!code) {
    return `$${(value / 100).toFixed(2)}`;
  }
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(value / 100);
  } catch {
    return `${code} ${(value / 100).toFixed(2)}`;
  }
}

/**
 * @param {{ spendCents?: number|null, capCents?: number|null }} input
 * @returns {{ ratio: number|null, pctLabel: string, atPauseThreshold: boolean, spendLabelNeedsCap: boolean }}
 */
export function spendCapProgress({ spendCents = null, capCents = null } = {}) {
  const spend = spendCents === null || spendCents === undefined ? null : Number(spendCents);
  const cap = capCents === null || capCents === undefined ? null : Number(capCents);
  if (!Number.isFinite(cap) || cap <= 0) {
    return {
      ratio: null,
      pctLabel: "—",
      atPauseThreshold: false,
      spendLabelNeedsCap: false,
    };
  }
  if (!Number.isFinite(spend) || spend < 0) {
    return {
      ratio: null,
      pctLabel: "—",
      atPauseThreshold: false,
      spendLabelNeedsCap: true,
    };
  }
  const ratio = Math.min(spend / cap, 1);
  const atPauseThreshold = spend / cap >= HARD_CAP_PAUSE_RATIO;
  return {
    ratio,
    pctLabel: `${Math.round(ratio * 100)}%`,
    atPauseThreshold,
    spendLabelNeedsCap: true,
  };
}

/** Pause is only meaningful while the advertiser status is ACTIVE (#3708). */
export function canPauseCampaign(status) {
  return status === "ACTIVE";
}

/** Launch is offered for PAUSED campaigns that are not archived/deleted. */
export function canLaunchCampaign(status) {
  return status === "PAUSED";
}

/**
 * Human schedule window for list/detail.
 * @param {{ startsAt?: string|null, endsAt?: string|null }} input
 */
export function scheduleWindowLabel({ startsAt = null, endsAt = null } = {}) {
  const fmt = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  };
  const start = fmt(startsAt);
  const end = fmt(endsAt);
  if (!start && !end) return null;
  if (start && end) return `${start} → ${end}`;
  if (start) return `Starts ${start}`;
  return `Ends ${end}`;
}
