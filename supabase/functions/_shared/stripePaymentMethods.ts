/**
 * ORCH-0849 — curated Stripe payment-method allowlist for Mingla ticket
 * checkout PaymentIntents.
 *
 * Allowlist (this ORCH, hotfixed 2026-05-15 post-merge): card + link.
 *
 * IMPORTANT — Apple Pay & Google Pay are NOT payment_method_types values.
 * The original Phase 1 set included "apple_pay" and "google_pay", which
 * Stripe rejects with a 400 payment_intent_invalid_parameter. Apple Pay
 * and Google Pay are wallets that surface THROUGH the `card` type when
 * the mobile SDK is initialized with `merchantIdentifier` (iOS) and the
 * Google Pay plugin/config (Android), and the platform's PaymentMethod
 * Configuration has those wallets enabled. They appear automatically in
 * PaymentSheet on supported devices — no entry in payment_method_types
 * is required (or accepted). Live-probe reproduction:
 *   stripe payment_intents create -d "payment_method_types[0]=apple_pay" \
 *     --stripe-account=acct_… → 400 invalid_parameter.
 *
 * Phase 2 candidates (separate ORCHs, NOT this one):
 *   - cash_app_pay — needs urlScheme deep-link live-fire
 *   - klarna / afterpay_clearpay — redirect-flow, needs handleURLCallback
 *     live-fire
 *   - us_bank_account / sepa_debit — delayed methods, needs
 *     payment_intent.processing webhook routing + buyer-pending UX
 *
 * Invariant: I-PROPOSED-STRIPE-PM-METHOD-ALLOWLIST (ORCH-0849) —
 * payment_method_types MUST be sourced from this module; never hardcoded
 * at the PI-create call site; never derived from
 * automatic_payment_methods (preserves ORCH-0837 H2 root-cause guard).
 *
 * CI gate: .github/scripts/strict-grep/i-stripe-pm-method-allowlist.mjs.
 */

export const MINGLA_PM_ALLOWLIST = [
  "card",
  "link",
] as const;

export type MinglaPaymentMethod = (typeof MINGLA_PM_ALLOWLIST)[number];

/**
 * Returns the payment_method_types array for a new PaymentIntent.
 * Currently returns the full allowlist unconditionally. Future variants
 * (per-surface or per-connected-account filtering) can branch here
 * without changing call sites.
 */
export function getPaymentMethodTypes(): readonly MinglaPaymentMethod[] {
  return MINGLA_PM_ALLOWLIST;
}
