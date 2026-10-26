// Issue #4130 (Wave 2a) — can this brand take money and get paid?
//
// The ONE place admin decides a brand's payment readiness, for Stripe and
// Paystack alike. The Payments page uses it, and the Brands page (Wave 3)
// reuses it, so the two pages can never disagree. Pure: no React, no
// Supabase. The facts come from admin_list_brand_payment_readiness
// (services/adminMoneyService.js listBrandPaymentReadiness / fetchPaymentReadinessRows).
//
// Rules:
//   - The provider is the brand's chosen one (brands.payment_provider). A
//     Paystack brand is judged on its Paystack bank recipient, never on Stripe
//     Connect (which it does not use); a Stripe brand on Stripe Connect.
//   - "ready"         the brand can sell and Mingla can send its money.
//   - "needs_action"  something the host must do (finish Stripe details, add a bank).
//   - "no_setup"      the brand chose a provider and set nothing up yet.
//   - Something Mingla must do (top up the Stripe balance, a late payout) is a
//     blocker shown beside a ready brand: it is not the host's action.

export const READINESS = Object.freeze({
  READY: "ready",
  NEEDS_ACTION: "needs_action",
  NO_SETUP: "no_setup",
});

export const READINESS_LABEL = Object.freeze({
  ready: "Ready",
  needs_action: "Needs host action",
  no_setup: "No payment setup",
});

export const PROVIDER_LABEL = Object.freeze({
  paystack: "Paystack · NGN",
  stripe: "Stripe · USD",
});

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function hasPositive(map) {
  return Object.values(map ?? {}).some((cents) => count(cents) > 0);
}

/** The brand's provider: its chosen one, else whatever it has set up. */
export function brandProvider(row) {
  const chosen = typeof row?.payment_provider === "string" ? row.payment_provider.toLowerCase() : "";
  if (chosen === "paystack" || chosen === "stripe") return chosen;
  if (row?.paystack_recipient_active || row?.paystack_subaccount_code) return "paystack";
  if (row?.has_stripe_account || row?.stripe_connect_id) return "stripe";
  return "stripe";
}

function paystackReadiness(row) {
  if (row?.paystack_recipient_active) {
    return {
      state: READINESS.READY,
      bankLabel: row.paystack_bank_mask ? `Bank on file ${row.paystack_bank_mask}` : "Bank on file",
      hostAction: null,
    };
  }
  if (row?.paystack_subaccount_code) {
    return { state: READINESS.NEEDS_ACTION, bankLabel: "No bank", hostAction: "Host must add a bank" };
  }
  return { state: READINESS.NO_SETUP, bankLabel: "No bank", hostAction: "Host has not set up payouts" };
}

function stripeReadiness(row) {
  if (!row?.has_stripe_account && !row?.stripe_connect_id) {
    return { state: READINESS.NO_SETUP, bankLabel: "No bank", hostAction: "Host has not connected Stripe" };
  }
  if (row?.stripe_detached) {
    return { state: READINESS.NEEDS_ACTION, bankLabel: "Not checked", hostAction: "Stripe account disconnected" };
  }
  const bankLabel = row?.stripe_bank_verified
    ? "Bank verified"
    : row?.stripe_payouts_enabled
      ? "Bank on file"
      : row?.stripe_bank_last4
        ? "Bank not verified"
        : "No bank";
  if (count(row?.stripe_past_due_count) > 0) {
    return { state: READINESS.NEEDS_ACTION, bankLabel, hostAction: "Stripe needs overdue identity details" };
  }
  if (!row?.stripe_charges_enabled) {
    return { state: READINESS.NEEDS_ACTION, bankLabel, hostAction: "Stripe has not turned on card payments yet" };
  }
  if (!row?.stripe_payouts_enabled) {
    return { state: READINESS.NEEDS_ACTION, bankLabel, hostAction: "Host must add a bank" };
  }
  return { state: READINESS.READY, bankLabel, hostAction: null };
}

/**
 * The readiness verdict for one brand row:
 *   { provider, providerLabel, state, stateLabel, bankLabel, blocking,
 *     blockingOnMingla, stripeActionsAllowed, heldCents, paidOutCents }
 * `blocking` is the one sentence for "What's blocking" (null when nothing).
 */
export function derivePaymentReadiness(row) {
  const provider = brandProvider(row);
  const base = provider === "paystack" ? paystackReadiness(row) : stripeReadiness(row);
  const states = row?.held_states ?? {};
  let minglaBlock = null;
  if (row?.blocked_on_mingla_balance) minglaBlock = "Mingla must top up the Stripe balance";
  else if (count(states.late_on_us) > 0) minglaBlock = "A payout is late on Mingla";
  else if (count(states.paused) > 0) minglaBlock = "Payouts are paused by Mingla";

  let blocking = base.hostAction;
  if (!blocking && count(states.waiting_for_bank) > 0) blocking = "Host must add a bank";
  if (!blocking && minglaBlock) blocking = minglaBlock;
  if (!blocking && base.state === READINESS.READY && !row?.has_paid_sales) blocking = "No sales yet";

  return {
    provider,
    providerLabel: PROVIDER_LABEL[provider],
    state: base.state,
    stateLabel: READINESS_LABEL[base.state],
    bankLabel: base.bankLabel,
    blocking,
    blockingOnMingla: Boolean(minglaBlock),
    // Refresh from Stripe / onboarding links only make sense for a brand on Stripe.
    stripeActionsAllowed: provider === "stripe" && Boolean(row?.stripe_connect_id || row?.has_stripe_account),
    heldCents: row?.held_by_currency ?? {},
    paidOutCents: row?.paid_out_by_currency ?? {},
    hasHeldMoney: hasPositive(row?.held_by_currency),
  };
}

/** Rows with their verdict attached (`readiness`), for lists. */
export function withReadiness(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, readiness: derivePaymentReadiness(row) }));
}

/** Provider ("all" | "paystack" | "stripe") and readiness ("all" | state) filters. */
export function filterByReadiness(rows, { provider = "all", readiness = "all" } = {}) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const r = row.readiness ?? derivePaymentReadiness(row);
    if (provider && provider !== "all" && r.provider !== provider) return false;
    if (readiness && readiness !== "all" && r.state !== readiness) return false;
    return true;
  });
}

/**
 * KPI tiles: ready (by provider), needs host action, selling with no bank yet
 * (money held waiting for a bank), no payment setup. Held money per currency
 * for the "selling with no bank" brands; currencies are never added.
 */
export function summarizeReadiness(rows) {
  const list = withReadiness(rows);
  const out = {
    total: list.length,
    ready: 0,
    readyByProvider: { paystack: 0, stripe: 0 },
    needsAction: 0,
    noSetup: 0,
    sellingWithoutBank: 0,
    heldWithoutBankByCurrency: {},
  };
  for (const row of list) {
    const r = row.readiness;
    if (r.state === READINESS.READY) {
      out.ready += 1;
      out.readyByProvider[r.provider] += 1;
    } else if (r.state === READINESS.NEEDS_ACTION) out.needsAction += 1;
    else out.noSetup += 1;
    if (count(row.held_states?.waiting_for_bank) > 0) {
      out.sellingWithoutBank += 1;
      for (const [cur, cents] of Object.entries(row.held_by_currency ?? {})) {
        out.heldWithoutBankByCurrency[cur] = (out.heldWithoutBankByCurrency[cur] ?? 0) + count(cents);
      }
    }
  }
  return out;
}
