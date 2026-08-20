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

/**
 * issue #2333 — `city_required` joins the PROVIDER-NEUTRAL union ONLY. It is
 * deliberately NOT added to `PaidPublishGuardReason` above: that union's whole
 * contract is "money guards", and `city_required` is a location guard. Smuggling
 * it in there would make `detectPaidPublishGuardReason` (used by edit paths that
 * expect a payment problem) start returning a non-payment reason.
 */
export type ProviderNeutralPaidPublishGuardReason =
  | "payment_collection_unavailable"
  | "offering_date_past"
  | "event_currency_required"
  | "city_required";

export type ProviderNeutralPaidPublishGuardAction =
  | "payment_onboarding"
  | "edit_date"
  // issue #2333 — jump to the Where step (wizard index 2).
  | "edit_where";

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
  // issue #2333 — `city_required`, raised by business_publish_event_draft and
  // business_patch_event_taxonomy, was the ONE guard nothing here recognised, so it
  // fell through to "Could not save this publish. Try again." for at least two days
  // while a paying customer retried something that could never succeed.
  if (/(?:^|[^a-z0-9_])city_required(?:$|[^a-z0-9_])/.test(s)) {
    return "city_required";
  }
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
  // issue #2333 — LOCKED copy (SPEC §4 S4a). Do not reword without an orchestrator
  // decision.
  //
  // WHY THIS POINTS AT AN ADDRESS FIELD, which reads oddly next to the rest of #2333:
  // after migration 20270427002333 an ONLINE host can no longer reach `city_required`
  // at all — the server stopped asking. The remaining producer of this guard is the
  // in_person/hybrid host who FREE-TYPED an address instead of picking a Google Places
  // suggestion, which leaves `city` null (validateWhere's own ORCH-0824 arm says the
  // same thing). For that host the address field IS rendered, so the copy is true and
  // the jump lands somewhere they can act. It also covers the window where an
  // un-updated client meets an un-migrated server.
  city_required: {
    reason: "city_required",
    title: "Add where it's happening",
    body: "We need a city or a venue address before this can go live. Open the Where step and pick the address from the suggestions.",
    actionLabel: "Open Where step",
    action: "edit_where",
  },
};

export const resolveProviderNeutralPaidPublishGuardCopy = (
  raw: string | null | undefined,
): ProviderNeutralPaidPublishGuardCopy | null => {
  const reason = normalizeProviderNeutralPaidPublishGuardReason(raw);
  return reason === null ? null : PROVIDER_NEUTRAL_PAID_PUBLISH_COPY[reason];
};

/**
 * issue #2333 S4b — the LAST-RESORT copy for a server guard NOTHING above
 * recognises. Pinned by DRAFT invariant
 * I-2333-UNMAPPED-SERVER-GUARD-NEVER-INVITES-RETRY.
 *
 * THE CLASS BUG THIS REPLACES: every publish path degraded an unknown typed guard to
 * "Could not save this publish. Try again." `city_required` was live and unpublishable
 * for at least two days while the app told a paying customer to retry something that
 * could never succeed. Every future typed server guard is a silent dead end by default
 * until this is structural — so it lives here, in one tested place, not inline in a
 * component's catch block.
 *
 * Three hard requirements, all exercised by the sibling tests:
 *  1. It must NOT invite a retry. Neither branch contains the word "Try again".
 *  2. It must be safe for an ARBITRARY server string. `error.message` can be a
 *     PostgREST envelope, a constraint name, a 4 KB stack fragment, or markup. Only a
 *     string that is ALREADY a bare snake_case guard token is ever echoed; anything
 *     else is described, never quoted. That is why the shape test is anchored
 *     (`^…$`) rather than a substring search.
 *  3. It must leave a trace an engineer can act on — hence the unconditional
 *     `console.error`, which is inside this function so it cannot be forgotten at a
 *     call site.
 */
const UNMAPPED_GUARD_TOKEN_SHAPE = /^[a-z][a-z0-9_]{2,63}$/;

export const describeUnmappedPublishGuard = (
  raw: string | null | undefined,
): string => {
  const s = typeof raw === "string" ? raw.trim() : "";
  // Requirement 3 — always logged, before anything is shown.
  console.error("[#2333] unmapped publish guard", s);
  if (UNMAPPED_GUARD_TOKEN_SHAPE.test(s)) {
    return `We couldn't publish this yet — the server reported "${s}". Contact support and quote that code.`;
  }
  return "We couldn't publish this yet. Nothing was lost — your draft is saved. Contact support if it keeps happening.";
};

/**
 * #2333 edit-context sibling of describeUnmappedPublishGuard.
 *
 * A published-event edit has no draft-preservation contract, so its terminal
 * fallback must describe the operation that actually failed and must not borrow
 * publish/draft claims. The same untrusted-input and engineer-visible logging
 * rules apply.
 */
export const describeUnmappedEditGuard = (
  raw: string | null | undefined,
): string => {
  const s = typeof raw === "string" ? raw.trim() : "";
  console.error("[#2333] unmapped edit guard", s);
  if (UNMAPPED_GUARD_TOKEN_SHAPE.test(s)) {
    return `We couldn't save these changes — the server reported "${s}". Your published event was not changed. Contact support and quote that code.`;
  }
  return "We couldn't save these changes. Your published event was not changed. Contact support if it keeps happening.";
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
