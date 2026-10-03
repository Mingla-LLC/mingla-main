/**
 * brandPayoutVisibilityData — #3645 PR10 lean DTO / money helpers.
 *
 * Kept free of designSystem / banner UI so brandPayoutLedgerService (and other
 * boot-shared readers) do not pull card styling into `__common`. Banner /
 * status-card resolution lives in brandPayoutVisibility.ts and is imported
 * only by BrandPaymentsView.
 */

import type {
  BrandPayoutReleaseDTO,
  PayoutLedgerAdjustmentDTO,
} from "./payoutBreakdown";

/** Camel-cased mirror of the `brand_get_payout_visibility` JSON. */
export interface BrandPayoutVisibilityDTO {
  payoutsPaused: boolean;
  /** ISO timestamp of the earliest maturing payout; null when none/paused. */
  nextPayoutAt: string | null;
  earnedCents: number;
  onItsWayCents: number;
  paidCents: number;
  /** Lowercase ISO-3 from the ledger; null when the brand has no currency yet. */
  currency: string | null;
}

const asCents = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
};

/**
 * Parse the RPC payload. Returns null for anything that is not an object so a
 * malformed response degrades to "no extra state", never to a fabricated one.
 */
export function parseBrandPayoutVisibility(
  raw: unknown,
): BrandPayoutVisibilityDTO | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const next = row.next_payout_at;
  const currency = row.currency;
  return {
    payoutsPaused: row.payouts_paused === true,
    nextPayoutAt: typeof next === "string" && next.length > 0 ? next : null,
    earnedCents: asCents(row.earned_cents),
    onItsWayCents: asCents(row.on_its_way_cents),
    paidCents: asCents(row.paid_cents),
    currency:
      typeof currency === "string" && currency.trim().length > 0
        ? currency.trim()
        : null,
  };
}

/** Release states that count as "on its way" (not paid, not dead). */
const ON_ITS_WAY_STATUSES: ReadonlySet<BrandPayoutReleaseDTO["status"]> =
  new Set([
    "pending",
    "in_flight",
    "blocked_kyc",
    "blocked_balance",
    "blocked_otp",
    "blocked_over_cap",
    "fee_unreconciled",
    "blocked_anchor",
    "reanchored",
  ]);

export interface OfferingPayoutMoney {
  paidCents: number;
  onItsWayCents: number;
  /** Lowercase ISO-3 of the releases summed (the first currency seen). */
  currency: string;
}

/**
 * Sum one offering's releases into paid vs on-its-way. Cancelled / failed
 * releases are dead money and are excluded. Releases in a currency other than
 * the first seen are skipped (one answer, one currency — never a mixed sum).
 * Returns null when the offering has no live release yet, so the caller keeps
 * its existing single PAYOUT figure.
 */
export function summariseOfferingPayoutMoney(
  releases: readonly BrandPayoutReleaseDTO[],
  eventId: string,
  adjustments: readonly PayoutLedgerAdjustmentDTO[] = [],
): OfferingPayoutMoney | null {
  // Same recredit the server counts (`brand_get_payout_visibility`): the
  // adjustment-backed maturity recredit, which is what claim actually sends.
  const recreditByRelease = new Map<string, number>();
  for (const adjustment of adjustments) {
    if (adjustment.kind !== "maturity_recredit" || adjustment.releaseId === null) {
      continue;
    }
    recreditByRelease.set(
      adjustment.releaseId,
      (recreditByRelease.get(adjustment.releaseId) ?? 0) + adjustment.amountCents,
    );
  }
  let currency: string | null = null;
  let paidCents = 0;
  let onItsWayCents = 0;
  for (const release of releases) {
    if (release.eventId !== eventId) continue;
    const isPaid = release.status === "released";
    const isWay = ON_ITS_WAY_STATUSES.has(release.status);
    if (!isPaid && !isWay) continue;
    if (currency === null) currency = release.currency;
    if (release.currency !== currency) continue;
    if (isPaid) {
      paidCents += Math.max(
        0,
        release.organiserCashDeliveredCents ?? release.netReleaseCents,
      );
    } else {
      onItsWayCents += Math.max(
        0,
        release.netReleaseCents + (recreditByRelease.get(release.id) ?? 0),
      );
    }
  }
  if (currency === null) return null;
  return { paidCents, onItsWayCents, currency };
}
