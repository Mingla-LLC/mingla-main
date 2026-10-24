import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  createTicketCheckoutCreateHandler,
  type TicketCheckoutCreateDeps,
} from "../index.ts";

const EVENT = "3872b000-0000-4000-8400-000000000001";
const TIER = "3872b000-0000-4000-8400-000000000002";
type DbResult = {
  data?: unknown;
  error?: { message: string } | null;
  count?: number;
};

class FakeQuery implements PromiseLike<DbResult> {
  private action = "select";
  constructor(
    private readonly db: FakeServiceClient,
    private readonly table: string,
  ) {}
  select(_columns: string, options?: { head?: boolean }): this {
    this.action = options?.head ? "head" : "select";
    return this;
  }
  eq(_column: string, _value: unknown): this {
    return this;
  }
  gt(_column: string, _value: unknown): this {
    return this;
  }
  maybeSingle(): Promise<DbResult> {
    return Promise.resolve(this.db.execute(this.table, this.action));
  }
  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?:
      | ((value: DbResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.db.execute(this.table, this.action)).then(
      onfulfilled,
      onrejected,
    );
  }
}

class FakeServiceClient {
  readonly calls: string[] = [];
  limiterAllowed = true;
  rejectionReason: "not_found" | "paused" = "not_found";

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  async rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<DbResult> {
    this.calls.push(`rpc:${name}`);
    if (name === "issue_2101_ticket_checkout_access_decision") {
      return { data: "allowed_unrestricted", error: null };
    }
    if (name === "issue_3872_code_attempt") {
      return {
        data: args.p_record_failure === true ? true : this.limiterAllowed,
        error: null,
      };
    }
    if (name === "issue_3872_ticket_quote") {
      return {
        data: {
          currency: "GBP",
          lines: [{
            ticketTypeId: TIER,
            ticketName: "General",
            quantity: 1,
            listUnitCents: 1_000,
            netUnitCents: 900,
            lineListCents: 1_000,
            lineNetCents: 900,
            discountCents: 100,
            discounts: [],
          }],
          listSubtotalCents: 1_000,
          discountCents: 100,
          netSubtotalCents: 900,
          dueTodayNetCents: 900,
          dueTodayListCents: 1_000,
          installmentSchedule: null,
          discounts: [],
          codeOutcome: {
            status: "rejected",
            reason: this.rejectionReason,
            required: null,
            with: null,
            replaced: [],
          },
          notices: [],
          quoteDigest: "a".repeat(32),
          quoteListDigest: "b".repeat(32),
        },
        error: null,
      };
    }
    if (name === "resolve_event_pricing_inputs") {
      return {
        data: [{
          pass_tax: false,
          pass_mingla_fee: true,
          pass_service_fee: true,
          pricing_region: "GB",
          pricing_currency: "GBP",
          venue_tax_address: null,
          effective_take_rate_bps: 150,
          take_rate_source: "platform_default",
          stripe_account_id: "acct_quote_fixture",
          payment_provider: "stripe",
          payment_country: "GB",
          vat_rate_bps: null,
        }],
        error: null,
      };
    }
    if (name === "issue_2579_record_checkout_refusal") {
      return { data: null, error: null };
    }
    throw new Error(`unexpected RPC ${name}`);
  }

  execute(table: string, action: string): DbResult {
    if (table === "event_dates" && action === "head") {
      return { count: 1, error: null };
    }
    if (table === "events" && action === "select") {
      return {
        data: {
          event_type: "event",
          bookings_closed: false,
          booking_deadline: null,
          is_multi_date: false,
          is_recurring: false,
          multi_date_pricing_mode: "per_day",
        },
        error: null,
      };
    }
    throw new Error(`unexpected query ${table}/${action}`);
  }
}

function request(mode: "quote" | "preview"): Request {
  return new Request("https://edge.test/ticket-checkout-create", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.10, 10.0.0.1",
    },
    body: JSON.stringify({
      mode,
      eventId: EVENT,
      buyer: {
        name: "Quote Buyer",
        email: "buyer@example.com",
        phone: "+447700900123",
      },
      lines: [{ ticketTypeId: TIER, quantity: 1 }],
      surface: "web",
      discountCode: "SAVE-10",
    }),
  });
}

function harness(db = new FakeServiceClient()) {
  let providerCalls = 0;
  const deps: TicketCheckoutCreateDeps = {
    userIdFromAuthHeader: async () => null,
    serviceClient: () => db as never,
    paystackInitializeTransaction: (async () => {
      providerCalls++;
      throw new Error("provider_must_not_run");
    }) as TicketCheckoutCreateDeps["paystackInitializeTransaction"],
  };
  return {
    db,
    handler: createTicketCheckoutCreateHandler(deps),
    providerCalls: () => providerCalls,
  };
}

Deno.test("#3872 quote and preview alias write no session and create no provider object", async () => {
  for (const mode of ["quote", "preview"] as const) {
    const h = harness();
    const response = await h.handler(request(mode));
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.kind, "quote");
    assertEquals(body.subtotalCents, 900);
    assertEquals(body.totalCents, body.buyerTotalCents);
    assertEquals(h.providerCalls(), 0);
    assertEquals(
      h.db.calls.some((call) =>
        call.includes("biz_ticket_checkout_create_session") ||
        call.includes("biz_ticket_link_checkout_create_session")
      ),
      false,
    );
  }
});

Deno.test("#3872 code limiter refuses before quote", async () => {
  const h = harness();
  h.db.limiterAllowed = false;
  const response = await h.handler(request("quote"));
  assertEquals(response.status, 429);
  assertEquals(await response.json(), {
    error: "rate_limited",
    detail: "code_attempts",
  });
  assertEquals(
    h.db.calls.includes("rpc:issue_3872_ticket_quote"),
    false,
  );
});

Deno.test("#3872 unknown and paused codes have the same public response shape", async () => {
  const unknown = harness();
  unknown.db.rejectionReason = "not_found";
  const unknownBody = await (await unknown.handler(request("quote"))).json();
  const paused = harness();
  paused.db.rejectionReason = "paused";
  const pausedBody = await (await paused.handler(request("quote"))).json();
  assertEquals(Object.keys(unknownBody).sort(), Object.keys(pausedBody).sort());
  assertEquals(
    Object.keys(unknownBody.codeOutcome).sort(),
    Object.keys(pausedBody.codeOutcome).sort(),
  );
});
