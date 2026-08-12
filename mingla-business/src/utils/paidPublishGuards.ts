/**
 * paidPublishGuards — ORCH-1075 [Paid-publish integrity guards].
 *
 * Single source of truth for the two PUBLISH/EDIT-time rejection reasons the
 * server RPCs raise (Guard A: Stripe readiness; Guard B: past date) and the
 * LOCKED user-facing copy + action they map to (SPEC §3.7). Both publish RPCs
 * (`RAISE EXCEPTION 'reason'` → surfaced on `error.message`) and edit RPCs
 * (`RETURN {ok:false, reason}` → surfaced on `data.reason`) feed through here,
 * so a caller need only pass whichever string it has.
 *
 * Reasons (MUST match the RPC bodies in
 * supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql
 * and, for the third reason,
 * supabase/migrations/20270108001014_issue_1014_free_only_publish_currency_relax.sql):
 *   - stripe_charges_disabled → "Finish your payment setup" → route to the
 *     brand's Stripe Connect onboarding (`/brand/{brandId}/payments/onboard`,
 *     the same entry BrandOnboardView uses to reach charges_enabled=true).
 *   - offering_date_past → "Pick a future date" → route to the WHEN/date field.
 *   - event_currency_required (issue #1014) → "Finish your payment setup" →
 *     same payments-onboard route (provider-neutral: it covers Stripe AND the
 *     NG Paystack path per #971). Raised when a MONEY-BEARING transition (any
 *     ticket priced > 0 — online OR door — or money entering a published
 *     free event) hits a brand with no resolvable payout currency.
 *
 * FREE offerings never trigger these reasons (issue #1014: free-only publishes
 * need zero payment setup), so this helper only ever sees them for the money
 * case.
 */

export type PaidPublishGuardReason =
  | "stripe_charges_disabled"
  | "offering_date_past"
  | "event_currency_required";

export type PaidPublishGuardAction = "stripe_onboarding" | "edit_date";

export type ProviderNeutralPaidPublishGuardReason =
  | "payment_collection_unavailable"
  | "offering_date_past"
  | "event_currency_required";

export type ProviderNeutralPaidPublishGuardAction =
  | "payment_onboarding"
  | "edit_date";

export interface ProviderNeutralPaidPublishGuardCopy {
  reason: ProviderNeutralPaidPublishGuardReason;
  title: string;
  body: string;
  actionLabel: string;
  action: ProviderNeutralPaidPublishGuardAction;
}

export interface PaidPublishGuardCopy {
  reason: PaidPublishGuardReason;
  /** Locked title (SPEC §3.7). */
  title: string;
  /** Locked body copy in Mingla voice (SPEC §3.7). */
  body: string;
  /** Locked primary action label (SPEC §3.7). */
  actionLabel: string;
  /** Which destination the primary action routes to. */
  action: PaidPublishGuardAction;
}

/** LOCKED copy map (SPEC §3.7). Do not reword without an orchestrator decision. */
const PAID_PUBLISH_GUARD_COPY: Record<
  PaidPublishGuardReason,
  PaidPublishGuardCopy
> = {
  stripe_charges_disabled: {
    reason: "stripe_charges_disabled",
    title: "Finish your payment setup",
    body: "You can't publish a paid listing until your bank payouts are switched on. It takes a couple of minutes.",
    actionLabel: "Finish bank setup",
    action: "stripe_onboarding",
  },
  offering_date_past: {
    reason: "offering_date_past",
    title: "Pick a future date",
    body: "This date has already passed. Choose a date that's still ahead so people can book it.",
    actionLabel: "Edit date",
    action: "edit_date",
  },
  // issue #1014 — LOCKED copy. Do not reword without an orchestrator decision.
  event_currency_required: {
    reason: "event_currency_required",
    title: "Finish your payment setup",
    body: "Paid listings need a payout currency, and that comes from your payment setup. Free listings publish any time.",
    actionLabel: "Set up payments",
    action: "stripe_onboarding",
  },
};

/**
 * Detect an ORCH-1075 paid-publish guard reason from EITHER a publish RPC's
 * raised `error.message` OR an edit RPC's `data.reason`. Returns the matched
 * reason or null. Tolerant of decorated messages (e.g. PostgREST may wrap the
 * raised reason), so we substring-match the known tokens.
 */
export const detectPaidPublishGuardReason = (
  raw: string | null | undefined,
): PaidPublishGuardReason | null => {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length === 0) return null;
  // Exact-first (edit RPC reason), then substring (publish RAISE message).
  if (s === "stripe_charges_disabled" || s.includes("stripe_charges_disabled")) {
    return "stripe_charges_disabled";
  }
  if (s === "offering_date_past" || s.includes("offering_date_past")) {
    return "offering_date_past";
  }
  // issue #1014 — money-bearing transition on a brand with no resolvable
  // payout currency (raised by the publish RPCs + both currency triggers).
  if (s === "event_currency_required" || s.includes("event_currency_required")) {
    return "event_currency_required";
  }
  return null;
};

/** Locked copy for a known reason. */
export const paidPublishGuardCopy = (
  reason: PaidPublishGuardReason,
): PaidPublishGuardCopy => PAID_PUBLISH_GUARD_COPY[reason];

/**
 * Convenience: resolve copy directly from a raw RPC error message / reason
 * string. Returns null when the string is not an ORCH-1075 guard reason (the
 * caller then falls back to its existing generic error mapping).
 */
export const resolvePaidPublishGuardCopy = (
  raw: string | null | undefined,
): PaidPublishGuardCopy | null => {
  const reason = detectPaidPublishGuardReason(raw);
  return reason === null ? null : PAID_PUBLISH_GUARD_COPY[reason];
};

/**
 * #1919 transitional wire adapter for standard event/trip/experience writes.
 * Installed clients still receive `stripe_charges_disabled` until cleanup
 * issue #1922; updated clients immediately collapse both wire inputs into the
 * provider-neutral semantic reason. RSVP, Stay, venue, and checkout retain
 * their existing adapters and are deliberately outside this seam.
 */
export const normalizeProviderNeutralPaidPublishGuardReason = (
  raw: string | null | undefined,
): ProviderNeutralPaidPublishGuardReason | null => {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length === 0) return null;
  // Canonical-first when a decorated message contains both tokens.
  if (s.includes("payment_collection_unavailable")) {
    return "payment_collection_unavailable";
  }
  if (s.includes("stripe_charges_disabled")) {
    return "payment_collection_unavailable";
  }
  if (s.includes("offering_date_past")) return "offering_date_past";
  if (s.includes("event_currency_required")) return "event_currency_required";
  return null;
};

const PROVIDER_NEUTRAL_PAID_PUBLISH_COPY: Record<
  ProviderNeutralPaidPublishGuardReason,
  ProviderNeutralPaidPublishGuardCopy
> = {
  payment_collection_unavailable: {
    reason: "payment_collection_unavailable",
    title: "Finish your payment setup",
    body: "You can’t publish a paid listing until this brand’s payout account is ready. Finish payment setup, then try again.",
    actionLabel: "Finish payment setup",
    action: "payment_onboarding",
  },
  offering_date_past: {
    reason: "offering_date_past",
    title: PAID_PUBLISH_GUARD_COPY.offering_date_past.title,
    body: PAID_PUBLISH_GUARD_COPY.offering_date_past.body,
    actionLabel: PAID_PUBLISH_GUARD_COPY.offering_date_past.actionLabel,
    action: "edit_date",
  },
  event_currency_required: {
    reason: "event_currency_required",
    title: PAID_PUBLISH_GUARD_COPY.event_currency_required.title,
    body: PAID_PUBLISH_GUARD_COPY.event_currency_required.body,
    actionLabel: PAID_PUBLISH_GUARD_COPY.event_currency_required.actionLabel,
    action: "payment_onboarding",
  },
};

export const resolveProviderNeutralPaidPublishGuardCopy = (
  raw: string | null | undefined,
): ProviderNeutralPaidPublishGuardCopy | null => {
  const reason = normalizeProviderNeutralPaidPublishGuardReason(raw);
  return reason === null ? null : PROVIDER_NEUTRAL_PAID_PUBLISH_COPY[reason];
};

/**
 * The canonical Stripe Connect onboarding route for a brand — the same entry
 * BrandOnboardView ("Set up payments") drives the brand to so its
 * charges_enabled flips true. Used by the `stripe_onboarding` action.
 */
export const brandStripeOnboardingRoute = (brandId: string): string =>
  `/brand/${brandId}/payments/onboard`;

/** #1919 provider-neutral name for the existing Payments onboarding route. */
export const brandPaymentOnboardingRoute = (brandId: string): string =>
  `/brand/${brandId}/payments/onboard`;
