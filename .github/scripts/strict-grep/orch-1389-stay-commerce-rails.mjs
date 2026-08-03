#!/usr/bin/env node
/**
 * Issue #1389 — Stay commerce rails must remain server-authoritative, dark by
 * default, typed into shared refund/payout systems, and isolated from legacy
 * ticket/reservation webhook fallbacks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const files = {
  schema: "supabase/migrations/20270131013812_issue_1389_stay_commerce_schema.sql",
  payment:
    "supabase/migrations/20270131013813_issue_1389_stay_payment_management.sql",
  cancellation:
    "supabase/migrations/20270131013814_issue_1389_stay_cancellation_refunds.sql",
  payout:
    "supabase/migrations/20270131013815_issue_1389_stay_payout_release.sql",
  operations:
    "supabase/migrations/20270131013816_issue_1389_stay_notifications_and_sweep.sql",
  late:
    "supabase/migrations/20270131013818_issue_1389_late_success_refund.sql",
  disputes:
    "supabase/migrations/20270131013819_issue_1389_stay_disputes.sql",
  edge: "supabase/functions/stay-reservations/index.ts",
  provider: "supabase/functions/_shared/stayPaymentProvider.ts",
  stripeRouter: "supabase/functions/_shared/stripeWebhookRouter.ts",
  paystackRouter: "supabase/functions/paystack-webhook/index.ts",
  refunds: "supabase/functions/_shared/sourceRefundControlPlane.ts",
  payoutWorker: "supabase/functions/payout-release-sweep/index.ts",
  config: "supabase/config.toml",
};

const rules = [
  ["schema", "('STAY_RESERVE_WRITES', false"],
  ["schema", "('STAY_STRIPE_COMMERCE', false"],
  ["schema", "('STAY_PAYSTACK_COMMERCE', false"],
  ["schema", "('STAY_NOTIFICATIONS', false"],
  ["payment", "resolve_brand_pricing_inputs("],
  ["payment", "public.pg_brand_can_collect("],
  ["payment", "v_group.total_minor"],
  ["payment", "provider_evidence_mismatch"],
  ["payment", "state = 'refund_due'"],
  ["cancellation", "stay_dependent_place_requires_room"],
  ["cancellation", "'stay_reservation'"],
  ["cancellation", "convert_postponement_debt_to_permanent("],
  ["payout", "record_stay_provider_fee("],
  ["payout", "platform_remainder"],
  ["payout", "provider_remainder"],
  ["payout", "run_stay_payout_release_dark_sweep("],
  ["operations", "payment_ambiguous"],
  ["operations", "stay_reservation_event_notification"],
  ["late", "stay_payment_late_success_refund"],
  ["late", "source_refund_ledger_allocations"],
  ["disputes", "issue_1389_record_stay_dispute("],
  ["disputes", "'post_release_dispute'"],
  ["disputes", "convert_postponement_debt_to_permanent("],
  ["edge", '"create_payment"'],
  ["edge", '"cancel_preview"'],
  ["edge", '"cancel"'],
  ["edge", "issue_1389_prepare_payment"],
  ["edge", "issue_1389_bind_payment_attempt"],
  ["provider", 'mingla_purpose: "stay_reservation"'],
  ["provider", "application_fee_amount"],
  ["provider", "getPaymentMethodTypes()"],
  ["provider", "mingla_stay_"],
  ["stripeRouter", "isStayStripePaymentEvent(event)"],
  ["stripeRouter", "handleStayStripeDispute(supabase, event)"],
  ["paystackRouter", "isStayPaystackCharge(data)"],
  ["refunds", '| "stay_reservation"'],
  ["refunds", '"Stay reservation"'],
  ["payoutWorker", '"record_stay_provider_fee"'],
  ["config", "[functions.stay-reservation-sweep]"],
];

export function violations(sources) {
  const failures = [];
  for (const [key, token] of rules) {
    if (!sources[key]?.includes(token)) {
      failures.push(`${key}:missing:${token}`);
    }
  }
  const prepareStart = sources.payment?.indexOf(
    "CREATE OR REPLACE FUNCTION public.issue_1389_prepare_payment(",
  ) ?? -1;
  const prepareEnd = sources.payment?.indexOf(
    "CREATE OR REPLACE FUNCTION",
    prepareStart + 1,
  ) ?? -1;
  const prepare = prepareStart >= 0
    ? sources.payment.slice(
      prepareStart,
      prepareEnd > prepareStart ? prepareEnd : undefined,
    )
    : "";
  if (
    prepare.includes("p_amount_minor bigint,") ||
    prepare.includes("p_currency_code text,")
  ) {
    failures.push("payment:client_money_parameters");
  }
  if (
    sources.provider?.includes("subaccount: prepared.") ||
    sources.provider?.includes("transactionChargeSubunits:")
  ) {
    failures.push("provider:legacy_paystack_split");
  }
  const stayRoute = sources.stripeRouter?.indexOf(
    "isStayStripePaymentEvent(event)",
  ) ?? -1;
  const ticketRoute = sources.stripeRouter?.indexOf(
    "handleTicketCheckoutPaymentIntent(supabase, event)",
  ) ?? -1;
  if (stayRoute < 0 || ticketRoute < 0 || stayRoute > ticketRoute) {
    failures.push("stripeRouter:stay_must_precede_ticket");
  }
  const stayPaystack = sources.paystackRouter?.indexOf(
    "isStayPaystackCharge(data)",
  ) ?? -1;
  const legacyPaystack = sources.paystackRouter?.indexOf(
    "handlePaystackChargeSuccess(",
  ) ?? -1;
  if (
    stayPaystack < 0 ||
    legacyPaystack < 0 ||
    stayPaystack > legacyPaystack
  ) {
    failures.push("paystackRouter:stay_must_precede_legacy");
  }
  return failures;
}

function selfTest() {
  const fixture = Object.fromEntries(
    Object.keys(files).map((key) => [key, ""]),
  );
  for (const [key, token] of rules) fixture[key] += `${token}\n`;
  fixture.payment =
    "CREATE OR REPLACE FUNCTION public.issue_1389_prepare_payment(\n" +
    fixture.payment +
    "\nCREATE OR REPLACE FUNCTION public.fixture_next(";
  fixture.stripeRouter +=
    "\nhandleTicketCheckoutPaymentIntent(supabase, event)";
  fixture.paystackRouter += "\nhandlePaystackChargeSuccess(";
  if (violations(fixture).length !== 0) {
    throw new Error(`valid fixture failed: ${violations(fixture).join(",")}`);
  }
  for (const [key, token] of rules) {
    const mutant = { ...fixture, [key]: fixture[key].replace(token, "") };
    if (violations(mutant).length === 0) {
      throw new Error(`mutation survived: ${key}:${token}`);
    }
  }
  for (const forbidden of [
    "p_amount_minor bigint,",
    "p_currency_code text,",
  ]) {
    const mutant = {
      ...fixture,
      payment: fixture.payment.replace(
        "\nCREATE OR REPLACE FUNCTION public.fixture_next(",
        `\n${forbidden}\nCREATE OR REPLACE FUNCTION public.fixture_next(`,
      ),
    };
    if (violations(mutant).length === 0) {
      throw new Error(`forbidden mutation survived: ${forbidden}`);
    }
  }
  console.log("orch-1389-stay-commerce-rails self-test: PASS");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const sources = Object.fromEntries(
    Object.entries(files).map(([key, relative]) => [
      key,
      fs.readFileSync(path.join(root, relative), "utf8"),
    ]),
  );
  const failures = violations(sources);
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
  console.log("orch-1389-stay-commerce-rails: PASS");
}
