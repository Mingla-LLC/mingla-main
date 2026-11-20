/**
 * #4238 Overview — pure display rules for "is my ad working?". The server
 * decides the verdict, pace and best video; this only shapes them for the
 * screen. Missing data is hidden (null), never drawn as 0 (Constitution #9).
 */

import type {
  HostAdDailyPoint,
  HostAdOverview,
} from "../../../../services/hostAdCampaignService";
import type { HostAdGoal } from "../hostAdBuilderModel";

export type OverviewStepKey = "shown" | "tapped" | "reached" | "checkout" | "bought" | "signedUp";

export type OverviewStep = {
  key: OverviewStepKey;
  value: number;
  /** The rate line under this step, when it has one. */
  rate: { key: "overview.tapRate" | "overview.arrivalRate"; value: string } | null;
};

function sumOrNull(values: readonly (number | null | undefined)[]): number | null {
  const real = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return real.length === 0 ? null : real.reduce((sum, value) => sum + value, 0);
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

/** "1.6" under 10%, else whole ("76"). Null when the rate can't be shown. */
export function overviewRate(part: number, whole: number): string | null {
  if (!(whole > 0) || part < 0 || part > whole) return null;
  const pct = (part / whole) * 100;
  return pct < 10 ? pct.toFixed(1) : String(Math.round(pct));
}

/**
 * AC 3: Shown → Tapped the ad → Reached your page → Started checkout →
 * Bought (sales), or → Signed up (signups); visits stop at the page. A step
 * whose source is null is omitted; page visits of 0 are omitted (the series
 * coalesces them to 0).
 */
export function overviewFunnel(input: {
  daily: readonly HostAdDailyPoint[];
  goal: HostAdGoal;
  checkoutStarted: number | null | undefined;
  orders: number | null | undefined;
  signUps: number | null | undefined;
}): OverviewStep[] {
  const shown = sumOrNull(input.daily.map((point) => point.impressions));
  const taps = sumOrNull(input.daily.map((point) => point.clicks));
  const visits = sumOrNull(input.daily.map((point) => point.page_visits));
  const steps: OverviewStep[] = [];
  if (shown !== null) steps.push({ key: "shown", value: shown, rate: null });
  if (taps !== null) {
    const rate = shown !== null ? overviewRate(taps, shown) : null;
    steps.push({ key: "tapped", value: taps, rate: rate === null ? null : { key: "overview.tapRate", value: rate } });
  }
  if (visits !== null && visits > 0) {
    const rate = taps !== null ? overviewRate(visits, taps) : null;
    steps.push({ key: "reached", value: visits, rate: rate === null ? null : { key: "overview.arrivalRate", value: rate } });
  }
  if (input.goal === "sales") {
    const checkout = count(input.checkoutStarted);
    if (checkout !== null) steps.push({ key: "checkout", value: checkout, rate: null });
    const bought = count(input.orders);
    if (bought !== null) steps.push({ key: "bought", value: bought, rate: null });
  } else if (input.goal === "signups") {
    const signed = count(input.signUps);
    if (signed !== null) steps.push({ key: "signedUp", value: signed, rate: null });
  }
  return steps;
}

/**
 * AC 2: the "Per …" tile. Per result when there is one, else per page
 * visit, else per tap, else hidden (null). Never "—".
 */
export function perResultTile(input: {
  count: number;
  spentPay: number;
  visits: number | null;
  clicks: number | null;
}): { labelKey: "detail.tilePer" | "overview.tilePerVisit" | "overview.tilePerTap"; pay: number } | null {
  if (!(input.spentPay > 0)) return null;
  if (input.count > 0) return { labelKey: "detail.tilePer", pay: Math.round(input.spentPay / input.count) };
  if (input.visits !== null && input.visits > 0) {
    return { labelKey: "overview.tilePerVisit", pay: Math.round(input.spentPay / input.visits) };
  }
  if (input.clicks !== null && input.clicks > 0) {
    return { labelKey: "overview.tilePerTap", pay: Math.round(input.spentPay / input.clicks) };
  }
  return null;
}

/** AC 6: the learning week is 7 days, or the run when it is shorter. */
export function learningTotal(runDays: number | null | undefined): number {
  const days = typeof runDays === "number" && Number.isFinite(runDays) && runDays >= 1 ? Math.trunc(runDays) : 7;
  return Math.min(7, days);
}

export function learningDay(daysLive: number | null | undefined, runDay: number | null | undefined, total: number): number {
  const day = typeof daysLive === "number" ? daysLive : typeof runDay === "number" ? runDay : 1;
  return Math.min(total, Math.max(1, Math.trunc(Number.isFinite(day) ? day : 1)));
}

/** AC 7: "Updated just now / N min / N h / N d ago". Null when unknown. */
export function updatedAgo(
  syncedAt: string | null | undefined,
  nowMs: number,
): { key: "overview.updatedNow" | "overview.updatedMin" | "overview.updatedHours" | "overview.updatedDays"; count: number } | null {
  if (typeof syncedAt !== "string") return null;
  const at = Date.parse(syncedAt);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.floor(Math.max(0, nowMs - at) / 60_000);
  if (minutes < 1) return { key: "overview.updatedNow", count: 0 };
  if (minutes < 60) return { key: "overview.updatedMin", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: "overview.updatedHours", count: hours };
  return { key: "overview.updatedDays", count: Math.floor(hours / 24) };
}

export type OverviewVerdict = NonNullable<HostAdOverview["verdict"]>;

/** AC 1: the verdict's title and the one sentence under it. */
export function verdictCopy(
  verdict: OverviewVerdict,
  goal: HostAdGoal,
  results: number,
): { titleKey: string; bodyKey: string } {
  const titleKey = `overview.verdictTitle.${verdict.state}`;
  switch (verdict.state) {
    case "too_early":
      return { titleKey, bodyKey: "overview.verdictBody.too_early" };
    case "ahead":
      return { titleKey, bodyKey: "overview.verdictBody.ahead" };
    case "on_track":
      return { titleKey, bodyKey: results > 0 ? "overview.verdictBody.on_track" : "overview.verdictBody.onTrackNone" };
    case "behind": {
      const drop = verdict.drop_off ?? "too_dear";
      return {
        titleKey,
        bodyKey: drop === "not_buying" && goal === "signups" ? "overview.dropOff.not_signing_up" : `overview.dropOff.${drop}`,
      };
    }
    default: {
      const never: never = verdict.state;
      return { titleKey: `overview.verdictTitle.${String(never)}`, bodyKey: "overview.verdictBody.on_track" };
    }
  }
}
