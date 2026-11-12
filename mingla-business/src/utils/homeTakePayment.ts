/**
 * #4389 (screen HT) — pure rules for taking payments from Home.
 */
import type { DoorSaleRecord } from "../types/doorSales";
import type { UpcomingItem } from "./upcomingBuilder";

const sameLocalDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

/** "At the door today": every door sale recorded today, any method, net of refunds. */
export function doorTodaySummary(
  sales: readonly DoorSaleRecord[],
  now: Date,
): { count: number; totalMajor: number; currency: string | null } {
  let count = 0;
  let totalMajor = 0;
  let currency: string | null = null;
  for (const sale of sales) {
    const at = new Date(sale.recordedAt);
    if (Number.isNaN(at.getTime()) || !sameLocalDay(at, now)) continue;
    if (sale.status === "refunded_full") continue;
    count += 1;
    totalMajor += Math.max(
      0,
      (sale.totalAtSale ?? sale.totalGbpAtSale) - (sale.refundedAmount ?? sale.refundedAmountGbp),
    );
    if (currency === null && sale.currency.length > 0) currency = sale.currency;
  }
  return { count, totalMajor: Math.round(totalMajor * 100) / 100, currency };
}

/** Event ids that can take a door sale today: live now, or starting today. */
export function doorEventIdsToday(
  liveItems: readonly UpcomingItem[],
  upcomingItems: readonly UpcomingItem[],
  now: Date,
): string[] {
  const ids = new Set<string>();
  for (const item of liveItems) if (item.kind !== "trip") ids.add(item.id);
  for (const item of upcomingItems) {
    if (item.kind === "draft" || item.kind === "trip" || item.startAtUtc === null) continue;
    if (sameLocalDay(item.startAtUtc, now)) ids.add(item.id);
  }
  return [...ids];
}

export type HomeTapCardMode = "ios" | "android" | "owner" | null;

/**
 * The Tap to Pay Home card. Only for a brand whose payments are set up, on a
 * phone and brand where Tap to Pay works, until it is set up or "Not now".
 * Web never shows it.
 */
export function homeTapCardMode(input: {
  os: string;
  entryShown: boolean;
  brandEligible: boolean;
  paymentsReady: boolean;
  notNow: boolean;
  needsSetup: boolean;
  mayAcceptTerms: boolean;
}): HomeTapCardMode {
  if (input.os !== "ios" && input.os !== "android") return null;
  if (!input.entryShown || !input.brandEligible || !input.paymentsReady) return null;
  if (input.notNow || !input.needsSetup) return null;
  if (!input.mayAcceptTerms) return "owner";
  return input.os === "ios" ? "ios" : "android";
}
