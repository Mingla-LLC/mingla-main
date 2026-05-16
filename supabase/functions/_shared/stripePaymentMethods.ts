/**
 * ORCH-0849 — curated Stripe payment-method allowlist for Mingla ticket
 * checkout PaymentIntents.
 *
 * Phase 1 allowlist (this ORCH): card + link + apple_pay + google_pay.
 * All four are direct-charge-compatible (Stripe-Account header per
 * ORCH-0843), require no redirect-flow plumbing beyond what
 * ORCH-0834-rescoped / ORCH-0837 already wired (urlScheme +
 * handleURLCallback), and require no delayed-method webhook routing
 * beyond what's already covered.
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
  "apple_pay",
  "google_pay",
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
