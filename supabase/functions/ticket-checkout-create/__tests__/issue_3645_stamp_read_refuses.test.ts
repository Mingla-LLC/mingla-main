// Issue #3645 — a Paystack ticket checkout whose brand payout-hold stamp
// cannot be read is refused (retryable 503) BEFORE a provider attempt is
// claimed or Paystack is initialized. Reading the failure as "unstamped" split
// a stamped brand's sale to the organiser at charge time, and the payout sweep
// then paid the organiser a second time.
// Harness adapted from issue_3645_paystack_plan_checkout.test.ts.
// Fails on revert: restoring the "treating as unstamped" read initializes
// Paystack with the organiser subaccount split.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketCheckoutCreateHandler,
  type TicketCheckoutCreateDeps,
} from "../index.ts";

const EVENT_ID = "10000000-0000-4000-8000-000000003645";
const TIER_ID = "20000000-0000-4000-8000-000000003645";
const SESSION_ID = "30000000-0000-4000-8000-000000003645";

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
  /** #3281 6c — what the session's `expires_at` read returns. */
  expiry: string | null | undefined | "throw" | "error" = undefined;
  readonly operations: string[] = [];
  readonly updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  sessionError: { message: string } | null = null;
  schedule: Record<string, unknown> | null = null;
  quote: Record<string, unknown> | null = null;
  cutover: "error" | "throw" | "stamped" | "unstamped" = "unstamped";

  from(table: string): FakeQuery { return new FakeQuery(this, table); }
  async rpc(name: string, _args: Record<string, unknown>): Promise<DbResult> {
    this.operations.push(`rpc:${name}`);
    // #4624 item 5a: harness registration only, no assertion changes. Paid rails
    // now extend a capped discount's hold before the provider call; these
    // fixtures use no discount, so nothing is extended.
    if (name === "issue_4624_extend_discount_hold") return { data: 0, error: null };
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
        // Issue #3645 — the brand's payout-hold stamp read.
        if (this.cutover === "throw") throw new Error("socket closed");
        if (this.cutover === "error") return { data: null, error: { message: "statement timeout" } };
        return {
          data: { brands: { payout_hold_cutover_at: this.cutover === "stamped" ? "2026-01-01T00:00:00Z" : null } },
          error: null,
        };
      }
      return { data: { event_type: "event", bookings_closed: false }, error: null };
    }
    // #3281 6c — the session expiry read after the Paystack commit.
    if (table === "ticket_checkout_sessions" && action === "select" && single) {
      if (this.expiry === "throw") throw new Error("expiry read failed");
      if (this.expiry === "error") return { data: null, error: { message: "down" } };
      return {
        data: this.expiry === undefined ? null : { expires_at: this.expiry },
        error: null,
      };
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
    idempotencyKey: "i3645-stamp-fixture",
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


for (const failure of ["error", "throw"] as const) {
  Deno.test(`#3645 ticket checkout: a stamp read ${failure} refuses before any claim or Paystack call`, async () => {
    const payloads: InitializeInput[] = [];
    const ops = { operations: [] as string[] };
    const { db, handler } = harness(initializer(ops, payloads), null);
    db.cutover = failure;
    let response: Response | null = null;
    let thrown: unknown = null;
    try {
      response = await handler(request());
    } catch (error) {
      thrown = error;
    }
    // A thrown read may surface as the edge wrapper's 500; either way no
    // payment may start. An error result is the retryable 503.
    if (failure === "error") {
      assertEquals(response?.status, 503);
      assertEquals(await response?.json(), { error: "payout_settings_unavailable" });
    } else {
      assertEquals(thrown !== null || (response !== null && response.status >= 500), true);
    }
    assertEquals(payloads, []);
    assertEquals(db.operations.includes("reference:persisted"), false);
    assertEquals(db.operations.includes("paystack:initialize"), false);
  });
}

Deno.test("#3645 ticket checkout: an unstamped brand still splits to its subaccount", async () => {
  const payloads: InitializeInput[] = [];
  const ops = { operations: [] as string[] };
  const { db, handler } = harness(initializer(ops, payloads), null);
  db.cutover = "unstamped";
  const response = await handler(request());
  assertEquals(response.status, 200);
  assertEquals(payloads.length, 1);
  assertEquals(payloads[0].subaccount, "ACCT_fixture");
});

Deno.test("#3645 ticket checkout: a stamped brand settles to Mingla (no split)", async () => {
  const payloads: InitializeInput[] = [];
  const ops = { operations: [] as string[] };
  const { db, handler } = harness(initializer(ops, payloads), null);
  db.cutover = "stamped";
  const response = await handler(request());
  assertEquals(response.status, 200);
  assertEquals(payloads.length, 1);
  assertEquals("subaccount" in payloads[0], false);
});
