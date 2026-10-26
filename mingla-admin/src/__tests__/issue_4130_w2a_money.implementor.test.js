// Issue #4130 (Wave 2a) — Mingla money, Payments, Orders, Money ledger.
//
//   W2A-1  payment readiness is decided in one place (lib/paymentReadiness.js):
//          a Paystack brand is judged on its Paystack bank, never on Stripe;
//          a Paystack brand with no setup is "no payment setup"; Stripe-only
//          actions are allowed on Stripe brands only; a Mingla-side block
//          (Stripe balance) is shown as Mingla's, not the host's
//   W2A-2  Mingla money tables never add currencies; the USD total is the sum
//          of USD figures and is "not converted" (null) when one is missing
//   W2A-3  the fee reads as a share of the TICKET price (4.5%, not 4.31%),
//          with "older pricing" below 4%
//   W2A-4  the Mingla money page replaces the placeholder and reads only
//          admin_mingla_money_summary; failed loads are LoadError + Retry
//   W2A-5  Payments: no "Read-only", Stripe actions gated, Paystack search
//   W2A-6  Orders: real statuses, Free and Host not paid filters, no D38,
//          no refund on free orders, refund names the provider and maps
//          paystack_refund_* errors, shared money formatter
//   W2A-7  Money ledger: Payouts first, one Disputes tab, Platform revenue
//          is a link to Mingla money, owes-back can be marked settled,
//          payout totals show errors, Refunds filter has Cancelled
//
// Run: node --test src/__tests__/issue_4130_w2a_money.implementor.test.js
// (from mingla-admin). Hermetic: pure modules and source text only.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  READINESS,
  derivePaymentReadiness,
  filterByReadiness,
  summarizeReadiness,
  withReadiness,
} from "../lib/paymentReadiness.js";
import {
  exceptionItems,
  feeShareOfTicket,
  headline,
  madeTable,
  moneyRow,
  periodRange,
  summaryCurrencies,
} from "../lib/minglaMoney.js";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// Facts as admin_list_brand_payment_readiness returns them.
const paystackReady = {
  brand_id: "b1", brand_name: "Naira Club", payment_provider: "paystack",
  paystack_subaccount_code: "ACCT_1", paystack_recipient_active: true, paystack_recipient_code: "RCP_1",
  paystack_bank_mask: "••••4130", has_stripe_account: false, stripe_connect_id: null,
  stripe_charges_enabled: false, stripe_payouts_enabled: false,
  paid_out_by_currency: { NGN: 4904180 }, held_by_currency: {}, held_states: {}, has_paid_sales: true,
};
const paystackNothing = {
  brand_id: "b2", brand_name: "Paystack Nothing", payment_provider: "paystack",
  paystack_subaccount_code: null, paystack_recipient_active: false, has_stripe_account: false,
  paid_out_by_currency: {}, held_by_currency: {}, held_states: {}, has_paid_sales: false,
};
const stripeOverdue = {
  brand_id: "b3", brand_name: "Overdue", payment_provider: "stripe", stripe_connect_id: "acct_1",
  has_stripe_account: true, stripe_charges_enabled: false, stripe_payouts_enabled: false,
  stripe_past_due_count: 7, paid_out_by_currency: {}, held_by_currency: {}, held_states: {},
};
const stripeShortBalance = {
  brand_id: "b4", brand_name: "Short balance", payment_provider: "stripe", stripe_connect_id: "acct_2",
  has_stripe_account: true, stripe_charges_enabled: true, stripe_payouts_enabled: true,
  stripe_past_due_count: 0, blocked_on_mingla_balance: true,
  held_by_currency: { USD: 3090 }, held_states: { late_on_us: 1 }, has_paid_sales: true,
};
const stripeNoBank = {
  brand_id: "b5", brand_name: "No bank", payment_provider: "stripe", stripe_connect_id: "acct_3",
  has_stripe_account: true, stripe_charges_enabled: true, stripe_payouts_enabled: false,
  stripe_past_due_count: 0, held_by_currency: { USD: 295 }, held_states: { waiting_for_bank: 1 }, has_paid_sales: true,
};

describe("W2A-1 payment readiness, one place, both providers", () => {
  it("a Paystack brand with a bank on file is ready, judged on Paystack and not Stripe", () => {
    const r = derivePaymentReadiness(paystackReady);
    assert.equal(r.provider, "paystack");
    assert.equal(r.state, READINESS.READY);
    assert.equal(r.bankLabel, "Bank on file ••••4130");
    assert.equal(r.blocking, null);
    assert.equal(r.stripeActionsAllowed, false, "no Stripe buttons on a Paystack brand");
  });
  it("a Paystack brand with no setup is listed as no payment setup", () => {
    const r = derivePaymentReadiness(paystackNothing);
    assert.equal(r.state, READINESS.NO_SETUP);
    assert.equal(r.stateLabel, "No payment setup");
  });
  it("Stripe brands: overdue details need the host; a short balance is Mingla's block", () => {
    const overdue = derivePaymentReadiness(stripeOverdue);
    assert.equal(overdue.state, READINESS.NEEDS_ACTION);
    assert.equal(overdue.blocking, "Stripe needs overdue identity details");
    assert.equal(overdue.stripeActionsAllowed, true);
    const short = derivePaymentReadiness(stripeShortBalance);
    assert.equal(short.state, READINESS.READY);
    assert.equal(short.blocking, "Mingla must top up the Stripe balance");
    assert.equal(short.blockingOnMingla, true);
  });
  it("KPIs count ready by provider, host action, selling with no bank and no setup", () => {
    const k = summarizeReadiness([paystackReady, paystackNothing, stripeOverdue, stripeShortBalance, stripeNoBank]);
    assert.equal(k.ready, 2);
    assert.deepEqual(k.readyByProvider, { paystack: 1, stripe: 1 });
    assert.equal(k.needsAction, 2);
    assert.equal(k.noSetup, 1);
    assert.equal(k.sellingWithoutBank, 1);
    assert.deepEqual(k.heldWithoutBankByCurrency, { USD: 295 });
  });
  it("provider and readiness filters", () => {
    const rows = withReadiness([paystackReady, paystackNothing, stripeOverdue]);
    assert.deepEqual(filterByReadiness(rows, { provider: "paystack" }).map((r) => r.brand_id), ["b1", "b2"]);
    assert.deepEqual(filterByReadiness(rows, { readiness: "needs_action" }).map((r) => r.brand_id), ["b3"]);
  });
  it("the Payments service and page use the shared readiness, not their own", () => {
    const service = read("services/adminMoneyService.js");
    assert.match(service, /supabase\.rpc\("admin_list_brand_payment_readiness"/);
    assert.match(service, /import \{ filterByReadiness, withReadiness \} from "\.\.\/lib\/paymentReadiness"/);
    const pagePayments = stripComments(read("pages/BusinessPaymentsPage.jsx"));
    assert.match(pagePayments, /summarizeReadiness\(rows\)/);
    assert.doesNotMatch(pagePayments, /listBrandStripeStatus/);
  });
});

// A summary as admin_mingla_money_summary returns it.
const SUMMARY = {
  lines: [
    { kind: "buyers_paid", currency: "NGN", cents: 50829750, usd_cents: 38215 },
    { kind: "buyers_paid", currency: "USD", cents: 5435, usd_cents: 5435 },
    { kind: "buyers_paid", currency: "GBP", cents: 2000, usd_cents: null },
    { kind: "fee", currency: "NGN", cents: 1524600, usd_cents: 1148 },
    { kind: "fee", currency: "USD", cents: 50, usd_cents: 50 },
    { kind: "profit", currency: "NGN", cents: 494246, usd_cents: 373 },
    { kind: "profit", currency: "USD", cents: -110, usd_cents: -110 },
  ],
  pricing: {
    rows: [
      { kind: "fee", currency: "NGN", period: "current", cents: 1192500, usd_cents: 898 },
      { kind: "profit", currency: "NGN", period: "current", cents: 567106, usd_cents: 427 },
    ],
    current_since: { NGN: "2026-10-22T15:29:08Z" },
  },
  exceptions: {
    never_in_payout: { count: 7 }, late_on_mingla: { count: 1 }, processing_over_fee: { count: 0 },
    transfer_fee_not_recorded: { count: 25 }, owes_back_open: { count: 0 },
  },
};

describe("W2A-2 Mingla money never adds currencies", () => {
  it("each currency keeps its own figure; the USD total adds USD figures only", () => {
    const fee = moneyRow(SUMMARY, "fee", ["NGN", "USD"]);
    assert.equal(fee.byCurrency.NGN.cents, 1524600);
    assert.equal(fee.byCurrency.USD.cents, 50);
    assert.equal(fee.usdTotal, 1198, "$11.48 + $0.50");
    const profit = moneyRow(SUMMARY, "profit", ["NGN", "USD"]);
    assert.equal(profit.usdTotal, 263, "$3.73 − $1.10");
  });
  it("a currency with no USD figure makes the total 'not converted', never a partial sum", () => {
    assert.equal(moneyRow(SUMMARY, "buyers_paid").usdTotal, null);
    assert.deepEqual(summaryCurrencies(SUMMARY), ["NGN", "USD", "GBP"]);
  });
  it("headline: revenue, profit and the share of the fee kept on 4.5% pricing", () => {
    const h = headline({ ...SUMMARY, lines: SUMMARY.lines.filter((l) => l.currency !== "GBP") });
    assert.equal(h.revenue.usdTotal, 1198);
    assert.equal(h.profit.usdTotal, 263);
    assert.equal(Math.round(h.currentPricing.sharePercent * 10) / 10, 47.6);
  });
  it("the made table has the waterfall rows in order", () => {
    assert.deepEqual(madeTable(SUMMARY).rows.map((r) => r.kind),
      ["buyers_paid", "refunds", "disputes", "fee", "processing", "transfer_costs", "profit"]);
  });
  it("needs a look lists only exceptions with rows, late first", () => {
    assert.deepEqual(exceptionItems(SUMMARY).map((i) => i.id), ["late_on_mingla", "never_in_payout", "transfer_fee_not_recorded"]);
  });
  it("periods", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    assert.deepEqual(periodRange("all", now), [null, null]);
    assert.deepEqual(periodRange("last_month", now), ["2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"]);
  });
});

describe("W2A-3 fee as a share of the ticket price", () => {
  it("4.5% on a ₦50,000 ticket reads 4.5%, not 4.31% of what the buyer paid", () => {
    assert.deepEqual(feeShareOfTicket(225000, 5000000), { percent: 4.5, label: "4.5%", older: false });
  });
  it("below 4% is the older pricing", () => {
    const s = feeShareOfTicket(75000, 5150000);
    assert.equal(s.older, true);
    assert.equal(s.label, "1.5%");
    assert.equal(feeShareOfTicket(10, 0), null);
  });
});

describe("W2A-4 the Mingla money page", () => {
  const app = stripComments(read("App.jsx"));
  const page = stripComments(read("pages/MinglaMoneyPage.jsx"));
  it("replaces the placeholder", () => {
    assert.match(app, /"mingla-money": MinglaMoneyPage/);
    // #4130 (integration): pages/shellHubs.jsx is retired; the placeholder
    // must not survive anywhere App or a page could draw it.
    assert.doesNotMatch(app, /MinglaMoneyPlaceholder/);
    for (const file of fs.readdirSync(path.join(SRC, "pages")).filter((f) => /\.jsx?$/.test(f))) {
      assert.doesNotMatch(stripComments(read(`pages/${file}`)), /MinglaMoneyPlaceholder/, file);
    }
  });
  it("reads the summary RPC through the service, shows errors with Retry, and is honest about live vs test", () => {
    assert.match(read("services/adminMoneyService.js"), /supabase\.rpc\("admin_mingla_money_summary"/);
    assert.match(page, /getMinglaMoneySummary\(from, to\)/);
    assert.match(page, /<LoadError title="Couldn't load Mingla money"/);
    assert.match(page, /Test money is not recorded yet/);
    assert.match(page, /not converted/);
    assert.match(page, /Total revenue \(USD\)/);
    assert.match(page, /Total profit \(USD\)/);
    assert.doesNotMatch(page, /mingla_revenue_log|listRevenueLog/);
  });
});

describe("W2A-5 Payments", () => {
  const page = stripComments(read("pages/BusinessPaymentsPage.jsx"));
  it("says nothing about read-only and gates Stripe actions on Stripe brands", () => {
    assert.doesNotMatch(page, /Read-only/);
    assert.match(page, /readinessRow\?\.readiness\?\.stripeActionsAllowed &&/);
    assert.match(page, /Brand, slug, Stripe or Paystack code/);
    assert.match(page, /Paid out to date/);
    assert.match(page, /Held now/);
  });
});

describe("W2A-6 Orders", () => {
  const page = stripComments(read("pages/BusinessOrdersPage.jsx"));
  it("filters on the statuses orders really take, plus Free and Host not paid", () => {
    for (const v of ["paid", "free", "partial_refund", "refunded", "failed", "cancelled", "pending", "host_not_paid"]) {
      assert.match(page, new RegExp(`value: "${v}"`), v);
    }
    assert.doesNotMatch(page, /partially_refunded|"disputed"/);
  });
  it("no D38, shared money formatter, Free orders read Free and have no refund", () => {
    assert.doesNotMatch(page, /D38/);
    assert.match(page, /formatMoneyMinor\(cents, currency\)/);
    assert.doesNotMatch(page, /Intl\.NumberFormat\("en-US"/);
    assert.match(page, /REFUNDABLE_STATUSES\.includes\(order\.payment_status\) && !isFreeOrder\(order\)/);
  });
  it("the refund window names the brand's provider and explains Paystack errors", () => {
    assert.match(page, /Refunds move real money through \$\{PROVIDER_NAME\[provider\]/);
    assert.doesNotMatch(page, /Stripe LIVE mode/);
    for (const code of ["paystack_refund_failed", "paystack_refund_retryable", "paystack_refund_below_minimum"]) {
      assert.match(page, new RegExp(`case "${code}"`), code);
    }
  });
  it("columns: ticket, Mingla fee, buyer paid, host paid", () => {
    for (const label of ['label: "Ticket"', 'label: "Mingla fee"', 'label: "Buyer paid"', 'label: "Host paid?"']) {
      assert.ok(page.includes(label), label);
    }
  });
});

describe("W2A-7 Money ledger", () => {
  const page = stripComments(read("pages/BusinessMoneyLedgerPage.jsx"));
  const act = read("services/adminMoneyActService.js");
  it("Payouts first, one Disputes tab, Platform revenue is a link to Mingla money", () => {
    const tabs = page.slice(page.indexOf("const TABS = ["), page.indexOf("];", page.indexOf("const TABS = [")));
    assert.match(tabs, /^const TABS = \[\s*\{ id: "payouts"/);
    assert.doesNotMatch(tabs, /paystack_disputes/);
    assert.match(page, /window\.location\.hash = "#\/mingla-money"/);
    assert.doesNotMatch(page, /listRevenueLog/);
    assert.match(page, /fetchPage=\{listAllDisputes\}/);
  });
  it("owes back can be marked settled through the audited RPC, with a reference", () => {
    assert.match(act, /callAdminWriteRpc\("admin_settle_owes_back"/);
    assert.match(page, /settleOwesBack\(\{ currency: settleCurrency, reference, reason \}\)/);
    assert.match(page, /Payment reference \(required\)/);
  });
  it("payout totals show an error with Retry; refunds filter has Cancelled; fee is a share of the ticket", () => {
    assert.match(page, /<LoadError title="Couldn't load the payout totals"/);
    assert.match(page, /\{ value: "cancelled", label: "Cancelled" \}/);
    assert.match(page, /feeShareOfTicket\(payout\.mingla_fee_cents, payout\.ticket_cents\)/);
    assert.doesNotMatch(page, /Mingla fee · 4\.5%"/);
  });
});
