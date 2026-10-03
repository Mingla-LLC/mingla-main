/**
 * brandPayoutVisibility — #3645 PR10: what the organiser is TOLD about their
 * payouts, on both rails, from one pure module.
 *
 * Three states land on the EXISTING Payments status card (never a second card):
 *   - "Selling, add a bank to get paid"   charge-ready but not payout-ready
 *   - "Next payout on <date>"             payout-ready with money maturing
 *   - "Payouts paused"                    an admin hold (boolean only — the
 *                                         admin reason never reaches the client)
 *
 * The facts come from `brand_get_payout_visibility` (finance_manager+), which
 * derives them from the RLS-locked hold table and ledger aggregates. #1180 law:
 * nothing here knows `error_message` / attempt_count / OTP / KYC internals — the
 * DTO has no field to carry them.
 *
 * Pure: no React, no I/O. The tone of every sentence mirrors
 * `payoutStatusOneLiner` (the release timeline PR1 already got right) so the
 * card and the timeline say the same thing.
 */

import { accent, semantic } from "../constants/designSystem";
import type { BrandStripeBannerConfig } from "./brandStripeUiState";
import { formatPayoutReleaseDate } from "./payoutBreakdown";
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

export type BrandPayoutStatusKind =
  | "payouts_paused"
  | "selling_add_bank"
  | "next_payout";

export interface BrandPayoutStatus {
  kind: BrandPayoutStatusKind;
  title: string;
  sub: string;
  /** Null when the card offers no action (paused, next payout). */
  ctaLabel: string | null;
}

export const PAYOUTS_PAUSED_TITLE = "Payouts paused";
export const PAYOUTS_PAUSED_SUB =
  "Your sales keep adding up. They'll be sent once payouts resume.";
export const SELLING_ADD_BANK_TITLE = "Selling, add a bank to get paid";
export const SELLING_ADD_BANK_SUB =
  "You can keep selling. Your money waits until you add a bank.";
export const SELLING_ADD_BANK_CTA = "Add bank";
export const NEXT_PAYOUT_SUB =
  "Sent to your bank about a day after each payment.";

export interface ResolveBrandPayoutStatusInput {
  /** `isBrandChargeReady(brand)` — can sell paid supply. */
  chargeReady: boolean;
  /** `isBrandPayoutReady(brand)` — a bank can receive releases. */
  payoutReady: boolean;
  /** Null until the RPC answers (or if the caller may not read it). */
  visibility: BrandPayoutVisibilityDTO | null | undefined;
  /** Injectable clock for the past-due wording; defaults to now. */
  now?: Date;
}

/**
 * The single place the three states are decided. Precedence is load-bearing:
 *   1. paused    — an admin hold outranks everything: no date is promised.
 *   2. add bank  — charge-ready without a bank: money is waiting on the
 *                  organiser, which is the thing they can act on.
 *   3. next      — payout-ready with a maturing release.
 * Anything else → null (the existing card copy stands).
 */
export function resolveBrandPayoutStatus(
  input: ResolveBrandPayoutStatusInput,
): BrandPayoutStatus | null {
  const visibility = input.visibility ?? null;

  if (visibility?.payoutsPaused === true) {
    return {
      kind: "payouts_paused",
      title: PAYOUTS_PAUSED_TITLE,
      sub: PAYOUTS_PAUSED_SUB,
      ctaLabel: null,
    };
  }

  if (input.chargeReady && !input.payoutReady) {
    return {
      kind: "selling_add_bank",
      title: SELLING_ADD_BANK_TITLE,
      sub: SELLING_ADD_BANK_SUB,
      ctaLabel: SELLING_ADD_BANK_CTA,
    };
  }

  if (input.payoutReady && visibility?.nextPayoutAt != null) {
    const when = formatPayoutReleaseDate(visibility.nextPayoutAt);
    if (when.length > 0) {
      const due = new Date(visibility.nextPayoutAt).getTime();
      const now = (input.now ?? new Date()).getTime();
      // A maturity already in the past means the sweep is about to send it —
      // never print a date that has gone by as if it were upcoming.
      const title = due > now
        ? `Next payout on ${when}`
        : "Your next payout is on its way";
      return { kind: "next_payout", title, sub: NEXT_PAYOUT_SUB, ctaLabel: null };
    }
  }

  return null;
}

/** Banner config for a payout status (the shape the one status card renders). */
export function payoutStatusToBannerConfig(
  status: BrandPayoutStatus,
  options: { withCta: boolean },
): BrandStripeBannerConfig {
  const hasCta = options.withCta && status.ctaLabel !== null;
  const success = status.kind === "next_payout";
  return {
    icon: success ? "check" : status.kind === "payouts_paused" ? "clock" : "bank",
    iconColor: success ? semantic.success : accent.warm,
    title: status.title,
    sub: status.sub,
    ctaLabel: hasCta ? status.ctaLabel : null,
    ctaVariant: hasCta ? "primary" : null,
    destructive: false,
    ...(success ? { success: true } : {}),
  };
}

/**
 * Stripe rail: overlay a payout status on the EXISTING Stripe status banner.
 *
 * Only the "connected" banner (`active`) is overlaid. Every state where Stripe
 * itself needs something from the organiser (not connected, onboarding,
 * verifying, restricted, unresolved) keeps its own card untouched — a payout
 * line must never paper over "Action required".
 */
export function overlayPayoutStatusOnStripeBanner(
  base: BrandStripeBannerConfig | null,
  status: BrandPayoutStatus | null,
): BrandStripeBannerConfig | null {
  if (status === null) return base;
  if (base !== null && base.success !== true) return base;
  return payoutStatusToBannerConfig(status, { withCta: true });
}

// ---------------------------------------------------------------------------
// Per-offering money: paid out vs on its way (event / trip / experience cards).
// ---------------------------------------------------------------------------

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
