/**
 * publishStripeReadiness — ORCH-1076 Stream B [proactive publish banners].
 *
 * The PROACTIVE client mirror of the canonical ORCH-1075 server fail-close.
 * Each per-type `isPaid` resolver here is the EXACT boolean mirror of the
 * corresponding server paid predicate, so the proactive "Connect Stripe to
 * publish" banner can NEVER disagree with the actual server block — no
 * false-green dead-end (banner says ready, RPC rejects on Publish — the exact
 * ORCH-1075 failure this program is killing) and no false-block nag.
 *
 * Server source of truth (cited per predicate below):
 *   supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql
 *
 *   - pg_brand_can_charge()  ........ L65-78   (attached stripe_connect_accounts
 *       row, detached_at IS NULL, stripe_account_id NOT NULL, charges_enabled
 *       IS DISTINCT FROM false). The client mirror is `stripeStatus === "active"`
 *       because deriveBrandStripeStatus.ts:57 returns "active" iff
 *       charges_enabled === true.
 *   - EVENT publish guard  .......... L2133-2151 (business_publish_event_draft):
 *       bool_or( availableAt IN ('online','both') AND NOT isFree
 *                AND round(price*100) > 0 ). In-person-only paid (availableAt
 *       ='door') and FREE tickets are EXEMPT.
 *   - TRIP publish guard  ........... L2454-2473 (business_publish_trip_draft):
 *       max(tt.price_cents) WHERE tt.deleted_at IS NULL
 *                                AND tt.available_online = true  > 0.
 *   - EXPERIENCE publish guard  ..... L301-313 + L356-360 (biz_publish_experience
 *       create-path) and L874-884 + L928-930 (biz_update_live_experience twin):
 *       v_resolved_total := is_free ? 0 : whole ? whole_price_cents
 *                                              : Σ stop price_cents;
 *       guard fires on `p_publish AND NOT v_is_free AND v_resolved_total > 0`.
 *       The single experience ticket is always available_online = true.
 *
 * REGRESSION GUARD: if any of those server predicates changes, update these
 * resolvers AND the parity fixtures in
 * `__tests__/publishStripeReadiness.test.ts` in the SAME PR. The parity tests
 * (T-10/T-11/T-12) fail if a resolver drifts from the server truth-table.
 *
 * Draft saves are server-exempt (`p_publish=false` skips all guards), so these
 * resolvers feed the PUBLISH gate ONLY — never "Save as draft" or autosave.
 */

import type { BrandStripeStatus } from "../../store/currentBrandStore";

/**
 * Shared predicate: a paid offering on a brand that can't yet charge needs
 * Stripe connected before it can be published.
 *
 * `stripeStatus !== "active"` is the exact client mirror of
 * `NOT pg_brand_can_charge()` — any of null / undefined / "not_connected" /
 * "onboarding" / "restricted" / "detached" reads as "not active", so the
 * banner fails SAFE toward blocking (never toward a false-green).
 */
export const offeringNeedsStripeToPublish = (args: {
  isPaid: boolean;
  stripeStatus: BrandStripeStatus | null | undefined;
}): boolean => args.isPaid === true && args.stripeStatus !== "active";

/**
 * EVENT paid mirror. Server (L2133-2151): a draft is paid iff ANY ticket is
 * online-sellable (availableAt IN ('online','both')), NOT free, and
 * round(price*100) > 0. Event tickets carried in the draft here are
 * online-sellable by construction, so the availableAt clause is satisfied and
 * the mirror is the existing `!isFree && (priceGbp ?? 0) > 0` per-ticket check
 * (already in draftEventValidation.ts:81-83) re-exposed for resolver-namespace
 * parity. round(price*100) > 0 ⇔ (priceGbp ?? 0) > 0 for the wizard's
 * positive prices.
 */
export const eventDraftIsPaid = (
  tickets: readonly { isFree: boolean; priceGbp: number | null }[],
): boolean => tickets.some((t) => !t.isFree && (t.priceGbp ?? 0) > 0);

/**
 * TRIP paid mirror. Server (L2454-2473): paid iff
 * max(ticket_types.price_cents) WHERE available_online = true > 0.
 *
 * META-ORCH-1174 Leg B2 [MULTI-PACKAGE]: a trip may now carry N packages, each
 * online-sellable by construction. The server `max(...) > 0` is true iff ANY
 * package has a positive price. So the client mirror is "ANY package's
 * round(price*100) > 0". A trip with only free packages (DEC-I) is NOT paid and
 * needs no Stripe — exactly mirroring the server. `parseFloat || 0` matches the
 * wizard's own parsing; cents-rounding matches the server's integer comparison
 * (so "0.005" rounds to 0 cents → not paid).
 */
export const tripDraftIsPaid = (draft: {
  packages: readonly { priceMajor: string }[];
}): boolean =>
  draft.packages.some(
    (p) => Math.round((parseFloat(p.priceMajor) || 0) * 100) > 0,
  );

/**
 * EXPERIENCE paid mirror. Server (L301-313 + L356-360 / L874-884 + L928-930):
 * v_resolved_total = is_free ? 0 : whole ? whole_price_cents : Σ stop
 * price_cents; paid iff `NOT is_free AND v_resolved_total > 0`. The wizard
 * already computes `resolvedTotalMajor` in major units across BOTH pricing
 * modes (ExperienceCreatorWizard.tsx:278-288) — the exact major-units mirror of
 * v_resolved_total — so the client mirror is `!isFree && resolvedTotalMajor > 0`.
 */
export const experienceDraftIsPaid = (draft: {
  isFree: boolean;
  resolvedTotalMajor: number;
}): boolean => !draft.isFree && draft.resolvedTotalMajor > 0;
