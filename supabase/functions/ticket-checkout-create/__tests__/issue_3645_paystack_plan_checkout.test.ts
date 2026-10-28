// Issue #3645 — Paystack payment-plan checkout (quote + create), SC-2..SC-4.
// Harness adapted from issue_1929_hidden_checkout_edge.test.ts.
// Fails on revert: charging the full schedule (or dropping the charge plan)
// fails "deposit only, plan persisted".
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketCheckoutCreateHandler,
  type TicketCheckoutCreateDeps,
} from "../index.ts";
import {
  buildPricingBreakdown,
  computeBuyerSubtotal,
  computeConfigVat,
} from "../../_shared/allInPricingEngine.ts";
import { computePaystackInstallmentCharges } from "../../_shared/installments/paystackInstallmentPricing.ts";

const EVENT_ID = "10000000-0000-4000-8000-000000003645";
const TIER_ID = "20000000-0000-4000-8000-000000003645";
const SESSION_ID = "30000000-0000-4000-8000-000000003645";

const SCHEDULE = {
  fullPriceCents: 1_000_000, depositCents: 250_000, currency: "NGN",
  installments: [{ ordinal: 1, pct: 75, amountCents: 750_000, dueAt: "2027-03-01T12:00:00.000Z" }],
};
const SWITCHES = { pass_tax: true, pass_mingla_fee: true, pass_service_fee: true };

function engine(base: number) {
  const input = { baseCents: base, switches: SWITCHES, region: "NG" as const, currency: "NGN",
    effectiveTakeRateBps: 150, takeRateSource: "platform_default" as const, serviceFeeBps: 300 };
  const sub = computeBuyerSubtotal(input);
  const vat = computeConfigVat(sub.buyerSubtotalCents, 750, true);
  return { total: vat.buyerTotalCents, fee: buildPricingBreakdown({ input, amountTotalCents: vat.buyerTotalCents,
    taxCents: vat.taxCents, taxBasis: "config_vat", stripeTaxCalculationId: null }).application_fee_amount_cents };
}

type DbResult = { data?: unknown; error?: { message: string } | null; count?: number };

class FakeQuery implements PromiseLike<DbResult> {
  private action = "select";
  private payload: Record<string, unknown> | null = null;
  constructor(
    private readonly db: FakeServiceClient,
    private readonly table: string,
  ) {}
  select(_columns: string, options?: { count?: string; head?: boolean }): this {
    this.action = options?.head ? "head" : "select";
    return this;
  }
  update(payload: Record<string, unknown>): this {
    this.action = "update";
    this.payload = payload;
    return this;
  }
  eq(_column: string, _value: unknown): this { return this; }
  gt(_column: string, _value: unknown): this { return this; }
  in(_column: string, _value: unknown[]): this { return this; }
  // issue #2689 — the status-token UPDATE now carries `.is("order_id", null)`,
  // so a duplicate that is about to refuse can no longer re-mint the possession
  // proof of a session that already completed.
  is(_column: string, _value: unknown): this { return this; }
  maybeSingle(): Promise<DbResult> { return Promise.resolve(this.execute(true)); }
  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute(false)).then(onfulfilled, onrejected);
  }
  private execute(single: boolean): DbResult {
    return this.db.execute(this.table, this.action, this.payload, single);
  }
}

class FakeServiceClient {
  readonly operations: string[] = [];
  readonly updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  sessionError: { message: string } | null = null;
  schedule: Record<string, unknown> | null = null;
  quote: Record<string, unknown> | null = null;

  from(table: string): FakeQuery { return new FakeQuery(this, table); }
  async rpc(name: string, _args: Record<string, unknown>): Promise<DbResult> {
    this.operations.push(`rpc:${name}`);
    // [TEST-MOD-APPROVED #2101] Harness registration only — no assertion
    // changes. #2101 added the named-buyer decision as the FIRST authority in
    // ticket-checkout-create, before any event-date, capacity, session or
    // provider work. This harness throws on unregistered RPCs, and the edge
    // fence FAILS CLOSED on an unanswered decision (correctly — treating a
    // null answer as "allowed" would be a fail-open), so every #1929 case
    // returned 403 instead of its own contract code. The #1929 fixtures are
    // unrestricted events, so the decision is `allowed_unrestricted` and every
    // ordering / status assertion below runs exactly as it did before.
    if (name === "issue_2101_ticket_checkout_access_decision") {
      return { data: "allowed_unrestricted", error: null };
    }
    if (name === "biz_ticket_checkout_create_session") {
      if (this.sessionError) return { data: null, error: this.sessionError };
      this.operations.push("session:complete");
      return {
        data: {
          checkoutSessionId: SESSION_ID,
          totalCents: this.schedule === null ? 1_000_000 : 250_000,
          currency: "NGN",
          stripeAccountId: null,
          installmentSchedule: this.schedule,
        },
        error: null,
      };
    }
    if (name === "resolve_event_pricing_inputs") {
      this.operations.push("provider:resolved-paystack");
      return {
        data: [{
          payment_provider: "paystack",
          payment_country: "NG",
          pricing_currency: "NGN",
          pass_tax: true,
          pass_mingla_fee: true,
          pass_service_fee: true,
          pricing_region: "NG",
          effective_take_rate_bps: 150,
          take_rate_source: "platform_default",
          paystack_subaccount_code: "ACCT_fixture",
          vat_rate_bps: 750,
        }],
        error: null,
      };
    }
    if (name === "issue_3872_ticket_quote" && this.quote) return { data: this.quote, error: null };
    if (name === "issue_3872_code_attempt") return { data: true, error: null };
    if (name === "issue_2579_record_checkout_refusal") return { data: null, error: null };
    throw new Error(`unexpected RPC ${name}`);
  }
  execute(
    table: string,
    action: string,
    payload: Record<string, unknown> | null,
    single: boolean,
  ): DbResult {
    if (table === "event_dates" && action === "head") return { count: 1, error: null };
    if (table === "events" && single && action === "select") {
      if (this.operations.includes("provider:resolved-paystack")) {
        this.operations.push("cutover:read");
        return { data: { brands: { payout_hold_cutover_at: null } }, error: null };
      }
      return { data: { event_type: "event", bookings_closed: false }, error: null };
    }
    if (table === "ticket_checkout_sessions" && action === "update" && payload) {
      this.updates.push({ table, payload });
      if ("buyer_status_token_hash" in payload) this.operations.push("status-token:persisted");
      if (payload.status === "awaiting_web_redirect") this.operations.push("reference:persisted");
      if (payload.status === "failed") this.operations.push("failure:persisted");
      return { data: null, error: null };
    }
    throw new Error(`unexpected query ${table}/${action}/${single}`);
  }
}

const request = () => new Request("http://edge.test/ticket-checkout-create", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer fixture" },
  body: JSON.stringify({
    eventId: EVENT_ID,
    buyer: {
      name: "Hidden Buyer",
      email: "buyer@example.com",
      phone: "+2348012345678",
      marketingOptIn: false,
    },
    lines: [{ ticketTypeId: TIER_ID, quantity: 1 }],
    idempotencyKey: "i3645-plan-fixture",
    surface: "web",
  }),
});

const harness = (
  initialize: TicketCheckoutCreateDeps["paystackInitializeTransaction"],
  schedule?: Record<string, unknown> | null,
) => {
  const db = new FakeServiceClient();
  if (schedule !== undefined) db.schedule = schedule;
  const deps: TicketCheckoutCreateDeps = {
    userIdFromAuthHeader: async () => null,
    serviceClient: () => db as never,
    paystackInitializeTransaction: initialize,
  };
  return { db, handler: createTicketCheckoutCreateHandler(deps) };
};


type InitializeInput = Parameters<TicketCheckoutCreateDeps["paystackInitializeTransaction"]>[0];

function initializer(db: { operations: string[] }, payloads: InitializeInput[]) {
  return async (input: InitializeInput) => {
    payloads.push(input);
    db.operations.push("paystack:initialize");
    return { authorization_url: "https://synthetic.invalid/authorize", access_code: "a", reference: String(input.reference) };
  };
}

Deno.test("#3645 SC-3 plan create: Paystack charges the deposit only and the later payment's price is persisted", async () => {
  const payloads: InitializeInput[] = [];
  const ops = { operations: [] as string[] };
  const { db, handler } = harness(initializer(ops, payloads), SCHEDULE);
  const response = await handler(request());
  const json = await response.json();
  assertEquals(response.status, 200, JSON.stringify(json));
  assertEquals(json.kind, "requires_paystack_redirect");
  const deposit = engine(250_000);
  const full = engine(1_000_000);
  assertEquals(payloads.length, 1);
  assertEquals(payloads[0].amountSubunits, deposit.total);
  assert(payloads[0].amountSubunits < full.total);
  assertEquals(payloads[0].channels, ["card", "bank", "ussd", "bank_transfer"]);
  assertEquals((payloads[0].metadata as Record<string, unknown>).mingla_installment_plan_root, "true");
  assertEquals((payloads[0].metadata as Record<string, unknown>).mingla_installment_count, "1");
  const persisted = db.updates.find((u) => u.payload.status === "awaiting_web_redirect")!.payload;
  const plan = persisted.installment_charge_plan as { payments: Array<Record<string, number>> };
  const [expected] = computePaystackInstallmentCharges({
    installments: [{ ordinal: 1, amountCents: 750_000 }], switches: SWITCHES,
    effectiveTakeRateBps: 150, takeRateSource: "platform_default", vatRateBps: 750,
  });
  assertEquals(plan.payments.length, 1);
  assertEquals(plan.payments[0].ordinal, 1);
  assertEquals(plan.payments[0].netCents, 750_000);
  assertEquals(plan.payments[0].buyerTotalCents, expected.buyerTotalCents);
  assertEquals(plan.payments[0].applicationFeeCents, expected.applicationFeeCents);
  assertEquals(json.installmentChargeSchedule.payments[0].buyerTotalCents, expected.buyerTotalCents);
  assertEquals(json.installmentChargeSchedule.payments[0].dueAt, "2027-03-01T12:00:00.000Z");
});

Deno.test("#3645 SC-4 a later payment under NGN 50 is refused before any Paystack call", async () => {
  const payloads: InitializeInput[] = [];
  const ops = { operations: [] as string[] };
  const tiny = { ...SCHEDULE, installments: [{ ordinal: 1, pct: 1, amountCents: 3_000, dueAt: "2027-03-01T12:00:00.000Z" }] };
  const { handler } = harness(initializer(ops, payloads), tiny);
  const response = await handler(request());
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error, "installment_amount_below_minimum");
  assertEquals(payloads.length, 0);
});

Deno.test("#3645 full-pay Paystack create is unchanged: no plan fields, no charge plan", async () => {
  const payloads: InitializeInput[] = [];
  const ops = { operations: [] as string[] };
  const { db, handler } = harness(initializer(ops, payloads), null);
  const json = await (await handler(request())).json();
  assertEquals(json.installmentChargeSchedule, undefined);
  const persisted = db.updates.find((u) => u.payload.status === "awaiting_web_redirect")!.payload;
  assertEquals("installment_charge_plan" in persisted, false);
  assertEquals(payloads[0].metadata, {
    mingla_checkout_session_id: SESSION_ID,
    mingla_event_id: EVENT_ID,
    mingla_buyer_email: "buyer@example.com",
  });
});

function quoteRequest() {
  return new Request("https://edge.test/ticket-checkout-create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "quote", eventId: EVENT_ID, buyer: { name: "Quote Buyer", email: "buyer@example.com",
      phone: "+2348012345678" }, lines: [{ ticketTypeId: TIER_ID, quantity: 1 }], surface: "web" }),
  });
}

function quoteFixture(schedule: Record<string, unknown> | null) {
  return {
    currency: "NGN", lines: [], listSubtotalCents: 1_000_000, discountCents: 0, netSubtotalCents: 1_000_000,
    dueTodayNetCents: schedule ? 250_000 : 1_000_000, dueTodayListCents: 250_000, installmentSchedule: schedule,
    discounts: [], codeOutcome: null, notices: [], quoteDigest: "a".repeat(32), quoteListDigest: "b".repeat(32),
  };
}

Deno.test("#3645 SC-2 quote: deposit and each later payment as all-in naira from the same engine", async () => {
  const { db, handler } = harness(async () => { throw new Error("no provider in quote"); }, null);
  db.quote = quoteFixture(SCHEDULE);
  const response = await handler(quoteRequest());
  const json = await response.json();
  assertEquals(response.status, 200, JSON.stringify(json));
  assertEquals(json.buyerTotalCents, engine(250_000).total);
  assertEquals(json.installmentChargeSchedule.currency, "NGN");
  const p = json.installmentChargeSchedule.payments[0];
  assertEquals(p.buyerTotalCents, engine(750_000).total);
  assertEquals(p.feesCents + p.taxCents + 750_000, p.buyerTotalCents);
  assertEquals(json.planTotalBuyerCents, engine(250_000).total + engine(750_000).total);
});

Deno.test("#3645 SC-4 quote refuses a later payment under NGN 50", async () => {
  const { db, handler } = harness(async () => { throw new Error("no provider in quote"); }, null);
  db.quote = quoteFixture({ ...SCHEDULE, installments: [{ ordinal: 1, pct: 1, amountCents: 3_000, dueAt: "2027-03-01T12:00:00.000Z" }] });
  const response = await handler(quoteRequest());
  assertEquals(response.status, 409);
  assertEquals((await response.json()).error, "installment_amount_below_minimum");
});

Deno.test("#3645 full-pay Paystack quote has no plan fields", async () => {
  const { db, handler } = harness(async () => { throw new Error("no provider in quote"); }, null);
  db.quote = quoteFixture(null);
  const json = await (await handler(quoteRequest())).json();
  assertEquals(json.installmentChargeSchedule, undefined);
  assertEquals(json.planTotalBuyerCents, undefined);
});
