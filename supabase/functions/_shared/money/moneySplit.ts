/**
 * Issue #3355 P6 (D-10) — "can sell" and "can be paid out" are two answers.
 *
 * I-MONEY-SELL-VS-PAYOUT-DISTINCT: every Ari money answer (get_payout_status,
 * the launch plan, the money gate, readiness answers) is built from the one
 * server split in `brand_readiness(...).money` (pg_brand_can_collect /
 * pg_brand_can_payout, migration 20280307003355) with a plain-English guide
 * per reason. A brand that can sell but can't be paid out yet (the Paystack
 * hold rail, a Stripe account without payouts) is never described as having
 * payouts enabled. Enforcing test:
 * supabase/functions/_shared/__tests__/issue_3355_money_flow.implementor.test.ts.
 */

import type { BrandReadinessMoney } from "../agentReadinessTools.ts";

const SELL_GUIDE: Readonly<Record<string, string>> = Object.freeze({
  ready: "This brand can sell paid tickets.",
  no_provider:
    "Payments aren't connected yet. The owner connects them in Payments setup.",
  kyc_incomplete:
    "Payment setup isn't finished yet. The owner finishes it in Payments setup.",
  provider_disabled:
    "The payment provider has paused this account. The owner can see what it needs in Payments setup.",
  currency_missing:
    "There's no payout currency yet. It's set when the owner connects a bank in Payments setup.",
  currency_reconciliation_pending:
    "A currency change needs a decision before anything paid can go on sale. A finance manager, a brand admin or the owner can decide it, and I can help with that here.",
  unsupported_market: "Payments aren't available in this brand's country yet.",
});

const PAYOUT_GUIDE: Readonly<Record<string, string>> = Object.freeze({
  ready: "Payouts reach the brand's bank.",
  no_bank: "Payouts start once the owner connects a bank in Payments setup.",
  payouts_disabled:
    "The payment provider hasn't turned payouts on yet. The owner can check Payments setup.",
  provider_review:
    "The payment provider needs more information before it pays out. The owner can check Payments setup.",
  currency_reconciliation_pending:
    "Payouts wait until the currency change is decided.",
  hold_rail_sell_before_bank:
    "Sales are held safely until the owner connects a bank; payouts start then.",
});

/** What has to happen before payouts start, said after "payouts start once". */
const PAYOUT_CONDITION: Readonly<Record<string, string>> = Object.freeze({
  no_bank: "your bank is connected",
  hold_rail_sell_before_bank: "your bank is connected",
  payouts_disabled: "the payment provider turns payouts on",
  provider_review: "the payment provider has the information it needs",
  currency_reconciliation_pending: "the currency change is decided",
});

export interface MoneySplitView {
  can_sell: boolean;
  sell_reason: string;
  sell_guide: string;
  can_be_paid_out: boolean;
  payout_reason: string;
  payout_guide: string;
  terms_accepted_by_caller: boolean | null;
  terms_guide: string | null;
  rail: string;
  currency: string | null;
  /** One plain sentence for the whole position. */
  summary: string;
}

export function sellGuide(reason: string): string {
  return SELL_GUIDE[reason] ?? SELL_GUIDE.kyc_incomplete;
}

export function payoutGuide(reason: string): string {
  return PAYOUT_GUIDE[reason] ?? PAYOUT_GUIDE.no_bank;
}

const TERMS_GUIDE =
  "You still need to accept the Organiser Terms before publishing anything paid; the app asks when you publish.";

/** The one sentence for the money position (never "payouts are enabled"). */
export function moneySummary(money: BrandReadinessMoney): string {
  let line: string;
  if (money.can_sell && money.can_be_paid_out) {
    line = "This brand can sell paid tickets and payouts reach its bank.";
  } else if (money.can_sell) {
    line = `You can sell now; payouts start once ${
      PAYOUT_CONDITION[money.payout_reason] ?? "your bank is connected"
    }.`;
  } else {
    line = sellGuide(money.sell_reason);
  }
  return money.terms_accepted_by_caller === false
    ? `${line} ${TERMS_GUIDE}`
    : line;
}

export function moneySplitView(money: BrandReadinessMoney): MoneySplitView {
  return {
    can_sell: money.can_sell,
    sell_reason: money.sell_reason,
    sell_guide: sellGuide(money.can_sell ? "ready" : money.sell_reason),
    can_be_paid_out: money.can_be_paid_out,
    payout_reason: money.payout_reason,
    payout_guide: payoutGuide(
      money.can_be_paid_out ? "ready" : money.payout_reason,
    ),
    terms_accepted_by_caller: money.terms_accepted_by_caller,
    terms_guide: money.terms_accepted_by_caller === false ? TERMS_GUIDE : null,
    rail: money.rail,
    currency: money.currency,
    summary: moneySummary(money),
  };
}
