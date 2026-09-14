/**
 * refundPolicyPrefill — issue #3284 [refund terms on events and experiences], §C6.
 *
 * What the organiser's published refund terms give an order AS OF TODAY, for the
 * Orders → refund sheet. DISPLAY ONLY: nothing here is sent to `refund-order`,
 * which keeps receiving exactly the lines and amount the organiser confirms.
 *
 * The rule is the server's (`realizedRefundPct`): whole days until the order's
 * earliest day starts, the tier with the largest `days_before_start` at or under
 * that, else 0%; amount = FLOOR(paid × pct / 100), never above what is still
 * refundable.
 *
 * No policy, an unknown policy, a free order, an unknown start or an unknown
 * currency → no suggestion at all (Constitution #9: missing is hidden).
 */

import {
  realizedRefundPct,
  type RefundPolicy,
} from "../services/refundPolicyService";
import { formatCurrency } from "./currency";

export type RefundPrefillOfferingType = "event" | "experience";

export interface RefundPolicySuggestion {
  /** The realized refund percentage today (0–100). */
  pct: number;
  /** FLOOR(paid × pct / 100), capped at the still-refundable amount (minor units). */
  suggestedCents: number;
  /** The organiser-facing caption (design §4.9). */
  caption: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * The window label of the tier that applies, worded exactly as the public ladder
 * words it (OfferingRefundLadder `refundTierLabel`, design §4.7).
 */
export function refundTierWindowLabel(
  tiers: RefundPolicy["tiers"],
  index: number,
  offeringType: RefundPrefillOfferingType,
): string {
  const tier = tiers[index];
  if (index === 0) {
    return `${tier.days_before_start}+ days before the ${offeringType}`;
  }
  const prev = tiers[index - 1];
  if (index === tiers.length - 1 && tier.days_before_start === 0) {
    return `Under ${prev.days_before_start} days`;
  }
  return `${tier.days_before_start}–${prev.days_before_start - 1} days before`;
}

/**
 * The start instant the refund window counts back from: the EARLIEST start among
 * the order's own days; when the order is not day-scoped (or its days are not in
 * the list), the offering's first occurrence; else the fallback start.
 */
export function resolveOrderRefundStartAt(input: {
  orderDayIds: readonly string[];
  occurrences: ReadonlyArray<{ id: string; startAt: string }>;
  fallbackStartAt: string | null | undefined;
}): string | null {
  const parse = (iso: string): number => Date.parse(iso);
  const earliest = (starts: string[]): string | null => {
    let best: string | null = null;
    for (const start of starts) {
      if (!Number.isFinite(parse(start))) continue;
      if (best === null || parse(start) < parse(best)) best = start;
    }
    return best;
  };
  const wanted = new Set(input.orderDayIds);
  const ownDays = earliest(
    input.occurrences.filter((o) => wanted.has(o.id)).map((o) => o.startAt),
  );
  if (ownDays !== null) return ownDays;
  const firstOccurrence = earliest(input.occurrences.map((o) => o.startAt));
  if (firstOccurrence !== null) return firstOccurrence;
  const fallback = input.fallbackStartAt ?? null;
  return fallback !== null && Number.isFinite(parse(fallback)) ? fallback : null;
}

export function computeRefundPolicySuggestion(input: {
  policy: RefundPolicy | null | undefined;
  offeringType: RefundPrefillOfferingType;
  startsAt: string | null;
  paidCents: number;
  remainingCents: number;
  currency: string | null;
  now: Date;
}): RefundPolicySuggestion | null {
  const { policy, offeringType, startsAt, currency, now } = input;
  if (policy === null || policy === undefined) return null;
  if (!Number.isFinite(input.paidCents) || input.paidCents <= 0) return null;
  if (currency === null || startsAt === null) return null;
  const startMs = Date.parse(startsAt);
  if (!Number.isFinite(startMs)) return null;

  const daysRemaining = Math.floor((startMs - now.getTime()) / MS_PER_DAY);
  const pct = realizedRefundPct(policy, daysRemaining);

  if (pct <= 0) {
    return {
      pct: 0,
      suggestedCents: 0,
      caption: `As of today, your refund policy gives no refund this close to the ${offeringType}. You can still refund any amount.`,
    };
  }

  // The applying tier: the largest days_before_start at or under daysRemaining.
  let tierIndex = -1;
  policy.tiers.forEach((tier, index) => {
    if (tier.days_before_start > daysRemaining) return;
    if (
      tierIndex === -1 ||
      tier.days_before_start > policy.tiers[tierIndex].days_before_start
    ) {
      tierIndex = index;
    }
  });
  const window =
    tierIndex === -1
      ? null
      : refundTierWindowLabel(policy.tiers, tierIndex, offeringType);

  const remaining = Math.max(0, Math.floor(input.remainingCents));
  const suggestedCents = Math.min(
    Math.floor((input.paidCents * pct) / 100),
    remaining,
  );
  const amount = formatCurrency(suggestedCents / 100, currency);
  const windowSuffix = window === null ? "" : window;

  const caption =
    pct === 100
      ? `As of today, your refund policy gives the full ${amount}${windowSuffix === "" ? "" : ` (${windowSuffix})`}.`
      : `As of today, your refund policy suggests ${amount} (${pct}%${windowSuffix === "" ? "" : ` · ${windowSuffix}`}).`;

  return { pct, suggestedCents, caption };
}
