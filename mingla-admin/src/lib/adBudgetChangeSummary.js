/**
 * Issue #3697 — "What happens when you save" for Change budget (pure).
 *
 * Totals are plan-wide in the provider-account currency (a plan's provider
 * campaigns share one cap and one hold). Every line is computed from the real
 * current values and the typed amounts; the server
 * (admin-ad-campaign-action change_budget → ad_plan_amend_budget) re-checks
 * the same rules and is the authority.
 */

import { HARD_CAP_PAUSE_RATIO, formatCampaignMoney } from "./adSpendCap.js";
import { PLATFORM_LABELS } from "./adBuilder/channelPlan.js";
import { campaignMoneyFacts } from "./adCampaignRow.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** "45" / "45.5" / "" → minor units, or null when empty, NaN when invalid. */
export function majorToMinor(text) {
  const value = String(text ?? "").trim();
  if (value === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return Number.NaN;
  return Math.round(Number(value) * 100);
}

/** The plan's current totals from its campaign rows. */
export function planBudgetNow(planCampaigns) {
  const facts = (planCampaigns ?? []).map((row) => {
    const fact = campaignMoneyFacts(row);
    // Same rule as the server: a campaign that never delivered and has no
    // spend row has spent nothing; a live one with no row is unknown.
    const noRows = !Array.isArray(row?.ad_spend_daily) || row.ad_spend_daily.length === 0;
    return fact.spendCents === null && noRows && row?.status !== "ACTIVE"
      ? { ...fact, spendCents: 0 }
      : fact;
  });
  const currency = facts[0]?.currency ?? null;
  const sameCurrency = facts.every((fact) => fact.currency === currency);
  const sum = (key) =>
    facts.some((fact) => fact[key] === null)
      ? null
      : facts.reduce((acc, fact) => acc + fact[key], 0);
  return {
    currency: sameCurrency ? currency : null,
    dailyCents: sameCurrency ? sum("dailyCents") : null,
    capCents: sameCurrency ? sum("capCents") : null,
    spendCents: sameCurrency ? sum("spendCents") : null,
  };
}

/**
 * @returns {{ errors: string[], lines: string[], canSave: boolean,
 *   newDailyCents: number|null, newCapCents: number|null }}
 */
export function budgetChangeSummary({
  planCampaigns = [],
  platform = "meta",
  dailyText = "",
  capText = "",
  reason = "",
  endsAt = null,
  now = new Date(),
} = {}) {
  const current = planBudgetNow(planCampaigns);
  const money = (cents) => formatCampaignMoney(current.currency, cents);
  const provider = PLATFORM_LABELS[platform] ?? platform;
  const typedDaily = majorToMinor(dailyText);
  const typedCap = majorToMinor(capText);
  const errors = [];
  if (Number.isNaN(typedDaily) || typedDaily === 0) {
    errors.push("Enter the daily budget as an amount, like 45 or 45.50.");
  }
  if (Number.isNaN(typedCap) || typedCap === 0) {
    errors.push("Enter the hard cap as an amount, like 160 or 160.00.");
  }
  if (current.currency === null || current.capCents === null || current.dailyCents === null) {
    errors.push("This plan's provider money is unresolved, so its budget can't change here.");
  }
  const newDaily = Number.isFinite(typedDaily) && typedDaily > 0 ? typedDaily : null;
  const newCap = Number.isFinite(typedCap) && typedCap > 0 ? typedCap : null;
  const dailyAfter = newDaily ?? current.dailyCents;
  const capAfter = newCap ?? current.capCents;
  if (newCap !== null && current.spendCents === null) {
    errors.push("Spend so far isn't synced yet. Sync, then change the cap.");
  }
  if (newCap !== null && current.spendCents !== null && newCap < current.spendCents) {
    errors.push(`A new cap can't be below what's already spent (${money(current.spendCents)}).`);
  }
  if (dailyAfter !== null && capAfter !== null && dailyAfter > capAfter) {
    errors.push("The daily budget can't be more than the hard cap.");
  }
  const changed =
    (newDaily !== null && newDaily !== current.dailyCents) ||
    (newCap !== null && newCap !== current.capCents);
  const lines = [];
  if (errors.length === 0 && changed) {
    if (newDaily !== null && newDaily !== current.dailyCents) {
      lines.push(
        `${provider}'s daily budget changes from ${money(current.dailyCents)} to ${money(newDaily)} within a minute.`,
      );
    }
    if (newCap !== null && newCap !== current.capCents) {
      lines.push(
        `The hold on Mingla's ad account goes from ${money(current.capCents)} to ${money(newCap)} (nothing is charged).`,
      );
      lines.push(
        `Auto-pause moves to ${money(Math.floor(newCap * HARD_CAP_PAUSE_RATIO))} (98% of the new cap).`,
      );
    }
    if (current.spendCents !== null && dailyAfter > 0) {
      const days = Math.floor((capAfter - current.spendCents) / dailyAfter);
      const endMs = Date.parse(endsAt ?? "");
      const daysToEnd = Number.isFinite(endMs)
        ? Math.ceil((endMs - now.getTime()) / DAY_MS)
        : null;
      const tail =
        daysToEnd === null
          ? ""
          : days < daysToEnd
            ? " — the cap is reached before the end date if it runs at full speed."
            : " — the end date comes first.";
      lines.push(`Days left at ${money(dailyAfter)}/day: about ${days}${tail}`);
    }
  }
  const reasonOk = String(reason ?? "").trim().length > 0;
  return {
    current,
    errors,
    lines,
    newDailyCents: newDaily,
    newCapCents: newCap,
    canSave: errors.length === 0 && changed && reasonOk,
  };
}
