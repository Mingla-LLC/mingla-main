/**
 * issue #4522 slice 2 — ticket-checkout-create and v2 trip plans.
 *
 * Everything here is inert while `issue_4522_plan_v2_enabled()` is false: no
 * v2 plan can be saved, `issue_4522_checkout_v2_plan` answers NULL, and the
 * add-on payment choice is sent to the database only when a buyer made one.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  checkoutSelectionUsesTripInstallments,
  hasTripInstallmentTemplate,
} from "../../../../packages/offering-rendering/tripInstallmentCapability.ts";
import {
  checkoutQuotePlanChoice,
  parseTripPlanV2ContractPlan,
  tierRowsCarryPlanV2,
  TripPlanV2ContractError,
} from "../tripPlanV2Contract.ts";
import { parseSupersedeRequest, supersedeHeldCheckout } from "../supersedeCheckout.ts";
import { fakeSupabase } from "../../_shared/installments/__tests__/issue_3645_fake_supabase.ts";

const source = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

const V2_PLAN = {
  v: 2,
  deposit: { mode: "percent", pct: 25 },
  count: 3,
  final_due_days_before_start: 30,
};

Deno.test("a v2 plan needs the same trip-plan capability as a legacy plan", () => {
  assert(hasTripInstallmentTemplate({ payment_plan: V2_PLAN }));
  assert(hasTripInstallmentTemplate({ installments: { deposit_pct: 25 } }));
  assert(!hasTripInstallmentTemplate({ payment_plan: null }));
  assert(!hasTripInstallmentTemplate({ payment_plan: [] }));
  assert(!hasTripInstallmentTemplate({}));
  assert(
    checkoutSelectionUsesTripInstallments("auto", [
      { tier_metadata: { payment_plan: V2_PLAN } },
    ]),
  );
  assert(
    !checkoutSelectionUsesTripInstallments("full", [
      { tier_metadata: { payment_plan: V2_PLAN } },
    ]),
  );
});

Deno.test("only a selected package with a v2 plan routes to the database planner", () => {
  assert(tierRowsCarryPlanV2([{ tier_metadata: { payment_plan: V2_PLAN } }]));
  assert(
    !tierRowsCarryPlanV2([
      { tier_metadata: { installments: { deposit_pct: 25 } } },
      { tier_metadata: null },
    ]),
  );
});

Deno.test("the contract-path plan is read strictly; NULL keeps the legacy planner", () => {
  assertEquals(parseTripPlanV2ContractPlan(null), null);
  const plan = parseTripPlanV2ContractPlan({
    dueTodayNetCents: 30000,
    dueTodayListCents: 30000,
    availability: "plan",
    countOffered: 3,
    countGiven: 2,
    finalDueAt: "2027-02-10T08:00:00Z",
    installmentSchedule: {
      fullPriceCents: 120000,
      depositCents: 30000,
      currency: "USD",
      installments: [
        {
          ordinal: 1,
          pct: 37.5,
          amountCents: 45000,
          dueAt: "2027-02-02T08:00:00Z",
          addonPortionCents: 0,
          sourceTicketTypeId: "45220000-0000-4000-8000-000000000013",
        },
        {
          ordinal: 2,
          pct: 37.5,
          amountCents: 45000,
          dueAt: "2027-02-10T08:00:00Z",
          addonPortionCents: 0,
          sourceTicketTypeId: "45220000-0000-4000-8000-000000000013",
        },
      ],
    },
  });
  assert(plan !== null);
  assertEquals(plan.dueTodayCents, 30000);
  assertEquals(plan.hasInstallments, true);
  assertEquals(plan.scheduled.map((row) => row.amountCents), [45000, 45000]);
  assertEquals(plan.scheduled[1].sourceOrdinal, 2);
  assertEquals(plan.summary, {
    planVersion: 2,
    availability: "plan",
    countOffered: 3,
    countGiven: 2,
    finalDueAt: "2027-02-10T08:00:00Z",
  });
  assertEquals(
    parseTripPlanV2ContractPlan({
      dueTodayNetCents: 120000,
      dueTodayListCents: 120000,
      installmentSchedule: null,
      availability: "full_window",
    })?.hasInstallments,
    false,
  );
  for (
    const bad of [
      [],
      { dueTodayNetCents: -1, dueTodayListCents: 0 },
      { dueTodayNetCents: 1, dueTodayListCents: 1, installmentSchedule: {} },
      {
        dueTodayNetCents: 1,
        dueTodayListCents: 1,
        installmentSchedule: {
          installments: [{ ordinal: 1, pct: 1, amountCents: 0, dueAt: "x" }],
        },
      },
    ]
  ) {
    assertThrows(
      () => parseTripPlanV2ContractPlan(bad),
      TripPlanV2ContractError,
    );
  }
});

Deno.test("the add-on payment choice reaches the database only when chosen", () => {
  // It rides the cart lines, so no RPC signature changes and a request without
  // a choice sends exactly the lines it sent before.
  assertStringIncludes(
    source,
    "const rpcLines = addonPaymentMode === null\n      ? lines\n      : lines.map((line) => ({ ...line, addonPaymentMode }));",
  );
  // Quote, the private-link session and the main session read it; the door
  // wrappers (never a trip plan) keep `lines`.
  assertEquals(source.split("p_lines: rpcLines,").length - 1, 3);
  assertStringIncludes(
    source,
    'return jsonResponse({ error: "addon_payment_mode_invalid" }, 400);',
  );
});

Deno.test("v2 refusals keep their names and the contract path plans before binding", () => {
  assertStringIncludes(source, '"installment_plan_unavailable",');
  assertStringIncludes(source, '"payment_plan_v2_unavailable",');
  const v2Rpc = source.indexOf('"issue_4522_checkout_v2_plan"');
  const legacyPlanner = source.indexOf(
    "computedPlan = planV2 ?? computeMultiLineInstallmentPlan(",
  );
  const bind = source.indexOf('"issue_3859_bind_checkout_contract"');
  assert(v2Rpc > 0 && legacyPlanner > v2Rpc && bind > legacyPlanner);
  assertStringIncludes(source, "...(planV2 !== null ? planV2.summary : {}),");
});

Deno.test("W-4 / S-1: a v2 create's review quote prices the lines' own plan choice", () => {
  // Without this the review after a refused or retried create quoted "full"
  // (the v2 session scalar) and showed the full price for a deposit session.
  assertEquals(
    checkoutQuotePlanChoice(true, [{ paymentPlanChoice: "installments" }], "full"),
    "installments",
  );
  assertEquals(
    checkoutQuotePlanChoice(true, [{ paymentPlanChoice: "full" }], "full"),
    "full",
  );
  assertEquals(checkoutQuotePlanChoice(false, null, "auto"), "auto");
  assertEquals(checkoutQuotePlanChoice(false, null, "installments"), "installments");
  const loader = source.slice(
    source.indexOf("const loadTicketQuote = async"),
    source.indexOf("const buildTicketQuoteEnvelope"),
  );
  assertEquals(
    loader.split("p_payment_plan_choice: quotePaymentPlanChoice,").length - 1,
    2,
  );
  assert(!loader.includes("p_payment_plan_choice: paymentPlanChoice,"));
});

// ── issue #4522 E-3: a changed cart closes the checkout it was handed first ──
//
// FAILS ON REVERT: with no supersede step the replacement is opened while the
// first provider page stays payable (two charges, two orders).


const OLD = "4522e300-0000-4000-8000-000000000001";
const EVENT = "4522e300-0000-4000-8000-0000000000e1";
const TOKEN = "t".repeat(64);

function supersedeWorld(opts: {
  provider: "stripe" | "paystack";
  orderId?: string | null;
  status?: string;
  tokenHash?: string;
}) {
  const steps: string[] = [];
  const fake = fakeSupabase({
    table: (op) => {
      if (op.table === "ticket_checkout_sessions") {
        return {
          data: {
            id: OLD, event_id: EVENT, buyer_status_token_hash: opts.tokenHash ?? `h:${TOKEN}`,
            order_id: opts.orderId ?? null, status: opts.status ?? "awaiting_web_redirect", revoked_at: null,
            stripe_account_id: opts.provider === "stripe" ? "acct_1" : null,
            stripe_payment_intent_id: opts.provider === "paystack" ? `mingla_${OLD}` : null,
          },
          error: null,
        };
      }
      if (op.table === "ticket_checkout_provider_attempts") {
        return {
          data: opts.provider === "stripe"
            ? { provider: "stripe", flow: "stripe_checkout", provider_checkout_id: "cs_old", provider_idempotency_key: `ticket_checkout:${OLD}:stripe_checkout` }
            : { provider: "paystack", flow: "paystack_redirect", provider_checkout_id: null, provider_idempotency_key: `ticket_checkout:${OLD}:paystack_redirect` },
          error: null,
        };
      }
      return { data: null, error: null };
    },
    rpc: (name) => {
      steps.push(`rpc:${name}`);
      return { data: { outcome: "superseded" }, error: null };
    },
  });
  return { fake, steps };
}

const deps = (steps: string[], o: {
  expire?: () => Promise<void>;
  retrieve?: { status: string | null; paymentStatus: string | null };
  paystack?: { kind: string; reason?: string };
}) => ({
  sha256Hex: (v: string) => Promise.resolve(`h:${v}`),
  expireStripeCheckout: (input: { checkoutSessionId: string; idempotencyKey: string; stripeAccountId: string }) => {
    steps.push(`expire:${input.checkoutSessionId}:${input.idempotencyKey}:${input.stripeAccountId}`);
    return o.expire ? o.expire() : Promise.resolve();
  },
  retrieveStripeCheckout: () => {
    steps.push("retrieve");
    return Promise.resolve(o.retrieve ?? { status: "open", paymentStatus: "unpaid" });
  },
  resolvePaystackReturn: () => {
    steps.push("paystack_verify");
    return Promise.resolve(o.paystack ?? { kind: "failed" });
  },
});

Deno.test("E-3 card provider: the old page is expired at the provider, then revoked, before a new one", async () => {
  const w = supersedeWorld({ provider: "stripe" });
  const out = await supersedeHeldCheckout(w.fake.client as never, EVENT,
    { checkoutSessionId: OLD, buyerStatusToken: TOKEN }, deps(w.steps, {}));
  assertEquals(out, { kind: "superseded" });
  assertEquals(w.steps, [
    `expire:cs_old:ticket_checkout:${OLD}:stripe_checkout:expire:acct_1`,
    "rpc:issue_4522_supersede_checkout_session",
  ]);
  assertEquals(w.fake.rpcCalls[0].args, {
    p_checkout_session_id: OLD, p_event_id: EVENT, p_buyer_status_token_hash: `h:${TOKEN}`,
  });
});

Deno.test("E-3 card provider: an old page already paid is never closed; the buyer goes to its confirmation", async () => {
  const w = supersedeWorld({ provider: "stripe" });
  const out = await supersedeHeldCheckout(w.fake.client as never, EVENT,
    { checkoutSessionId: OLD, buyerStatusToken: TOKEN },
    deps(w.steps, { expire: () => Promise.reject(new Error("session complete")), retrieve: { status: "complete", paymentStatus: "paid" } }));
  assertEquals(out, { kind: "paid", checkoutSessionId: OLD });
  assertEquals(w.fake.rpcCalls.length, 0);
});

Deno.test("E-3 card provider: an old page that cannot be expired blocks the replacement", async () => {
  const w = supersedeWorld({ provider: "stripe" });
  const out = await supersedeHeldCheckout(w.fake.client as never, EVENT,
    { checkoutSessionId: OLD, buyerStatusToken: TOKEN },
    deps(w.steps, { expire: () => Promise.reject(new Error("network")) }));
  assertEquals(out.kind, "unavailable");
  assertEquals(w.fake.rpcCalls.length, 0);
  // an already-expired page counts as closed
  const w2 = supersedeWorld({ provider: "stripe" });
  assertEquals((await supersedeHeldCheckout(w2.fake.client as never, EVENT,
    { checkoutSessionId: OLD, buyerStatusToken: TOKEN },
    deps(w2.steps, { expire: () => Promise.reject(new Error("expired")), retrieve: { status: "expired", paymentStatus: "unpaid" } }))).kind,
    "superseded");
});

Deno.test("E-3 second provider: verified unpaid → superseded on our side; verified paid → its confirmation", async () => {
  const w = supersedeWorld({ provider: "paystack" });
  assertEquals((await supersedeHeldCheckout(w.fake.client as never, EVENT,
    { checkoutSessionId: OLD, buyerStatusToken: TOKEN }, deps(w.steps, { paystack: { kind: "failed" } }))).kind, "superseded");
  assertEquals(w.steps, ["paystack_verify", "rpc:issue_4522_supersede_checkout_session"]);
  const paid = supersedeWorld({ provider: "paystack" });
  assertEquals(await supersedeHeldCheckout(paid.fake.client as never, EVENT,
    { checkoutSessionId: OLD, buyerStatusToken: TOKEN }, deps(paid.steps, { paystack: { kind: "finalized" } })),
    { kind: "paid", checkoutSessionId: OLD });
  assertEquals(paid.fake.rpcCalls.length, 0);
  // paid at the provider but not finalized yet: never closed on a guess
  const racing = supersedeWorld({ provider: "paystack" });
  assertEquals((await supersedeHeldCheckout(racing.fake.client as never, EVENT,
    { checkoutSessionId: OLD, buyerStatusToken: TOKEN },
    deps(racing.steps, { paystack: { kind: "pending", reason: "finalize_retryable" } }))).kind, "unavailable");
  assertEquals(racing.fake.rpcCalls.length, 0);
});

Deno.test("E-3: someone else's token, or a session already paid, closes nothing at the provider", async () => {
  const w = supersedeWorld({ provider: "stripe", tokenHash: "h:other" });
  assertEquals((await supersedeHeldCheckout(w.fake.client as never, EVENT,
    { checkoutSessionId: OLD, buyerStatusToken: TOKEN }, deps(w.steps, {}))).kind, "not_found");
  assertEquals(w.steps, []);
  const paid = supersedeWorld({ provider: "stripe", orderId: "4522e300-0000-4000-8000-0000000000aa" });
  assertEquals((await supersedeHeldCheckout(paid.fake.client as never, EVENT,
    { checkoutSessionId: OLD, buyerStatusToken: TOKEN }, deps(paid.steps, {}))).kind, "paid");
  assertEquals(paid.steps, []);
  assertEquals(parseSupersedeRequest({ checkoutSessionId: "nope", buyerStatusToken: TOKEN }), null);
  assertEquals(parseSupersedeRequest(undefined), null);
});

Deno.test("E-3: the create path closes the held checkout before any session or provider call, never on a replay", () => {
  const close = source.indexOf("const superseded = await supersedeHeldCheckout(");
  const guard = source.lastIndexOf("resolvedAttempt.data === null", close);
  const replayStart = source.indexOf("\"issue_3859_resolve_checkout_attempt\"");
  const create = source.indexOf("\"biz_ticket_checkout_create_session\",", close);
  const stripeCreate = source.indexOf("stripeWeb.checkout.sessions.create(");
  const paystackInit = source.indexOf("paystackInitializeTransaction(", close);
  assert(close > replayStart && guard > replayStart && guard < close, "only a fresh attempt closes the held checkout");
  assert(create > close && stripeCreate > close && paystackInit > close, "closed before any new session");
  assertStringIncludes(source.slice(close, create), 'error: "checkout_already_paid"');
});
