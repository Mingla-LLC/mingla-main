import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketCheckoutCreateHandler,
  type TicketCheckoutCreateDeps,
} from "../index.ts";

const EVENT_ID = "10000000-0000-4000-8000-000000000001";
const TIER_ID = "20000000-0000-4000-8000-000000000002";
const SESSION_ID = "30000000-0000-4000-8000-000000000003";

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
          totalCents: 100_000,
          currency: "NGN",
          stripeAccountId: null,
          installmentSchedule: null,
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
    idempotencyKey: "i1929-edge-fixture",
    surface: "web",
  }),
});

const harness = (
  initialize: TicketCheckoutCreateDeps["paystackInitializeTransaction"],
) => {
  const db = new FakeServiceClient();
  const deps: TicketCheckoutCreateDeps = {
    userIdFromAuthHeader: async () => null,
    serviceClient: () => db as never,
    paystackInitializeTransaction: initialize,
  };
  return { db, handler: createTicketCheckoutCreateHandler(deps) };
};

Deno.test("#1929 import-safe seam and exact production bootstrap", async () => {
  const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assertEquals((source.match(/if \(import\.meta\.main\)/g) ?? []).length, 1);
  assertEquals((source.match(/serve\(createTicketCheckoutCreateHandler\(\)\);/g) ?? []).length, 1);
  assertMatch(source, /const defaultDeps[\s\S]*userIdFromAuthHeader,[\s\S]*serviceClient,[\s\S]*paystackInitializeTransaction,/);
  const contract = source.match(/export interface TicketCheckoutCreateDeps \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assertEquals((contract.match(/:/g) ?? []).length, 3);
});

Deno.test("#1929 event_not_selling maps to exact 409 before provider/network", async () => {
  let initializerCalls = 0;
  const { db, handler } = harness(async () => {
    initializerCalls++;
    throw new Error("must not initialize");
  });
  db.sessionError = { message: "event_not_selling" };
  const response = await handler(request());
  assertEquals(response.status, 409);
  assertEquals(await response.json(), {
    error: "checkout_session_failed",
    detail: "event_not_selling",
  });
  assertEquals(initializerCalls, 0);
  assertEquals(db.updates.length, 0);
  assertEquals(db.operations.some((op) => op.includes("provider")), false);
});

Deno.test("#1929 hidden NGN session persists status/reference before mocked Paystack", async () => {
  type InitializeInput = Parameters<
    TicketCheckoutCreateDeps["paystackInitializeTransaction"]
  >[0];
  const payloads: InitializeInput[] = [];
  const { db, handler } = harness(async (input) => {
    payloads.push(input);
    db.operations.push("paystack:initialize");
    return {
      authorization_url: "https://synthetic.invalid/authorize",
      access_code: "access_fixture",
      reference: String(input.reference),
    };
  });
  const response = await handler(request());
  const json = await response.json();
  assertEquals(response.status, 200);
  assertEquals(json.kind, "requires_paystack_redirect");
  assertEquals(json.checkoutSessionId, SESSION_ID);
  assertEquals(json.authorizationUrl, "https://synthetic.invalid/authorize");
  assertEquals(json.currency, "NGN");
  assert(typeof json.buyerStatusToken === "string" && json.buyerStatusToken.length > 0);
  assertEquals(payloads.length, 1);
  const payload = payloads[0];
  assertEquals(db.operations.indexOf("session:complete") < db.operations.indexOf("status-token:persisted"), true);
  assertEquals(db.operations.indexOf("status-token:persisted") < db.operations.indexOf("provider:resolved-paystack"), true);
  assertEquals(db.operations.indexOf("provider:resolved-paystack") < db.operations.indexOf("reference:persisted"), true);
  assertEquals(db.operations.indexOf("reference:persisted") < db.operations.indexOf("paystack:initialize"), true);
  const persisted = db.updates.find((u) => u.payload.status === "awaiting_web_redirect")!.payload;
  assertEquals(payload.email, "buyer@example.com");
  assertEquals(payload.currency, "NGN");
  assertEquals(payload.amountSubunits, persisted.total_cents);
  assertEquals(payload.reference, persisted.stripe_payment_intent_id);
  assertEquals(payload.channels, ["card", "bank", "ussd", "bank_transfer"]);
  assertEquals(payload.subaccount, "ACCT_fixture");
  assertEquals(payload.transactionChargeSubunits, persisted.stripe_application_fee_amount_cents);
  const callback = new URL(String(payload.callbackUrl));
  assertEquals(callback.origin, "https://host.usemingla.com");
  assertEquals(callback.pathname, `/checkout/${EVENT_ID}/confirm`);
  assertEquals(callback.searchParams.get("cs"), "paystack");
  assertEquals(callback.searchParams.get("csi"), SESSION_ID);
  assertEquals(payload.metadata, {
    mingla_checkout_session_id: SESSION_ID,
    mingla_event_id: EVENT_ID,
    mingla_buyer_email: "buyer@example.com",
  });
});

Deno.test("#1929 mocked Paystack failure preserves failed update and exact 502", async () => {
  let calls = 0;
  const { db, handler } = harness(async () => {
    calls++;
    db.operations.push("paystack:initialize");
    throw new Error("synthetic initialize failure");
  });
  const response = await handler(request());
  assertEquals(response.status, 502);
  assertEquals(await response.json(), {
    error: "paystack_initialize_failed",
    detail: "synthetic initialize failure",
  });
  assertEquals(calls, 1);
  assertEquals(db.operations.indexOf("reference:persisted") < db.operations.indexOf("paystack:initialize"), true);
  assertEquals(db.operations.indexOf("paystack:initialize") < db.operations.indexOf("failure:persisted"), true);
  const failed = db.updates.find((u) => u.payload.status === "failed")!.payload;
  assert(typeof failed.failed_at === "string");
  assert(typeof failed.updated_at === "string");
  assertEquals(db.operations.some((op) => op.includes("finalize") || op.includes("stripe")), false);
});
