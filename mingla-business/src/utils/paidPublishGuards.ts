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
 * supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql):
 *   - stripe_charges_disabled → "Finish your payment setup" → route to the
 *     brand's Stripe Connect onboarding (`/brand/{brandId}/payments/onboard`,
 *     the same entry BrandOnboardView uses to reach charges_enabled=true).
 *   - offering_date_past → "Pick a future date" → route to the WHEN/date field.
 *
 * FREE offerings and in-person-only paid offerings never trigger these reasons
 * (the RPCs gate paid-online only), so this helper only ever sees them for the
 * paid case.
 */

export type PaidPublishGuardReason =
  | "stripe_charges_disabled"
  | "offering_date_past";

export type PaidPublishGuardAction = "stripe_onboarding" | "edit_date";

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
    body: "You can't publish a paid listing until your Stripe payouts are switched on. It takes a couple of minutes.",
    actionLabel: "Finish Stripe setup",
    action: "stripe_onboarding",
  },
  offering_date_past: {
    reason: "offering_date_past",
    title: "Pick a future date",
    body: "This date has already passed. Choose a date that's still ahead so people can book it.",
    actionLabel: "Edit date",
    action: "edit_date",
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
 * The canonical Stripe Connect onboarding route for a brand — the same entry
 * BrandOnboardView ("Set up payments") drives the brand to so its
 * charges_enabled flips true. Used by the `stripe_onboarding` action.
 */
export const brandStripeOnboardingRoute = (brandId: string): string =>
  `/brand/${brandId}/payments/onboard`;
