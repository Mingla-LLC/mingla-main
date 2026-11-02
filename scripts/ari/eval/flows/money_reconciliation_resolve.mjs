/**
 * #3355 P10 — money_reconciliation_resolve (SPEC §7.4): SKIPPED locally.
 *
 * Deciding a pending currency change from Ari is not a structured flow
 * answer: the money gate's "Decide it now" (`resolve_currency`) delegates to
 * the model lane, which reads the currency state and proposes
 * manage_brand_discovery_currency. The local model cannot drive free-form
 * turns, so this eval cannot run without depending on model output, and the
 * evals must never do that. It is listed so every run prints the skip.
 *
 * To make it runnable: give the reconciliation decision its own flow card
 * (options from `currency_reconciliation_options`) so the owner's choice is
 * a structured answer, then assert brand_currency_reconciliations.status.
 */

export const meta = {
  id: "money_reconciliation_resolve",
  brand: "recon",
  account: null,
  capabilities: [],
  skip:
    "resolving a currency change is delegated to the model lane (moneyGate resolve_currency); the local model can't drive it",
};

export function run() {
  throw new Error("skipped");
}
