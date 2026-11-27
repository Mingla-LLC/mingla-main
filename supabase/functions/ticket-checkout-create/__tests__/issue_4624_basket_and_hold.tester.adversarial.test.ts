// MINGLA-INVARIANT: I-4624-23 | issue #4624 | ticket-checkout-create sends the session at most one line per ticket type (repeats merged only when they differ in quantity, otherwise refused before any checkout database or provider call; a repeat the edge cannot see is refused by the database and surfaced as checkout_lines_duplicate), and asks for a discount-hold extension only when the session holds a limited discount, so a checkout with no capped discount never depends on that call.
/**
 * #4624 tester adversarial (final retest). Drives the real handler through the
 * #1929 fake-client pattern (Paystack rail: no Stripe needed) rather than
 * reading the source:
 *  - repeated ticket types are merged into the one line the session RPC sees;
 *  - a repeat that differs in anything but quantity is refused with no RPC;
 *  - a repeat the edge cannot normalise (letter case) reaches the database,
 *    whose refusal comes back as 400 checkout_lines_duplicate, no provider call;
 *  - no capped discount: no hold-extend call, and a missing hold-extend
 *    function (edge deployed before the migration) cannot break the checkout;
 *  - a capped discount (top-level or on a replayed item): the call is made,
 *    and its failure stops the checkout before the provider.
 * FAILS-ON-REVERT: drop normaliseBasketLines and the first test sees two lines;
 * drop the sessionHasCappedDiscount gate and the "no capped discount" test sees
 * the call (and a 500 when the function is missing).
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketCheckoutCreateHandler,
  type TicketCheckoutCreateDeps,
} from "../index.ts";
import { normaliseBasketLines } from "../basketLines.ts";
import { sessionHasCappedDiscount } from "../discountHold.ts";

const EVENT_ID = "10000000-0000-4000-8000-000000004624";
const TIER_ID = "20000000-0000-4000-8000-00000000abcd";
const SESSION_ID = "30000000-0000-4000-8000-000000004624";

type DbResult = { data?: unknown; error?: { message: string } | null; count?: number };

class FakeQuery implements PromiseLike<DbResult> {
  private action = "select";
  private payload: Record<string, unknown> | null = null;
  constructor(private readonly db: FakeServiceClient, private readonly table: string) {}
  select(_c: string, options?: { count?: string; head?: boolean }): this {
    this.action = options?.head ? "head" : "select";
    return this;
  }
  update(payload: Record<string, unknown>): this {
    this.action = "update";
    this.payload = payload;
    return this;
  }
  eq(_c: string, _v: unknown): this { return this; }
  gt(_c: string, _v: unknown): this { return this; }
  in(_c: string, _v: unknown[]): this { return this; }
  is(_c: string, _v: unknown): this { return this; }
  maybeSingle(): Promise<DbResult> { return Promise.resolve(this.execute(true)); }
  then<T1 = DbResult, T2 = never>(
    ok?: ((value: DbResult) => T1 | PromiseLike<T1>) | null,
    bad?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.execute(false)).then(ok, bad);
  }
  private execute(single: boolean): DbResult {
    return this.db.execute(this.table, this.action, this.payload, single);
  }
}

class FakeServiceClient {
  readonly operations: string[] = [];
  sessionLines: unknown[] | null = null;
  sessionError: { message: string } | null = null;
  sessionExtra: Record<string, unknown> = {};
  holdError: { message: string } | null = null;

  from(table: string): FakeQuery { return new FakeQuery(this, table); }
  async rpc(name: string, args: Record<string, unknown>): Promise<DbResult> {
    this.operations.push(`rpc:${name}`);
    if (name === "issue_4624_extend_discount_hold") {
      return this.holdError ? { data: null, error: this.holdError } : { data: 1, error: null };
    }
    // #2579 records every refusal; it is telemetry, not checkout work.
    if (name === "issue_2579_record_checkout_refusal") return { data: null, error: null };
    if (name === "issue_2101_ticket_checkout_access_decision") {
      return { data: "allowed_unrestricted", error: null };
    }
    if (name === "biz_ticket_checkout_create_session") {
      this.sessionLines = args.p_lines as unknown[];
      if (this.sessionError) return { data: null, error: this.sessionError };
      return {
        data: {
          checkoutSessionId: SESSION_ID,
          totalCents: 100_000,
          currency: "NGN",
          stripeAccountId: null,
          installmentSchedule: null,
          ...this.sessionExtra,
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
  execute(table: string, action: string, payload: Record<string, unknown> | null, single: boolean): DbResult {
    if (table === "event_dates" && action === "head") return { count: 1, error: null };
    if (table === "events" && single && action === "select") {
      if (this.operations.includes("provider:resolved-paystack")) {
        return { data: { brands: { payout_hold_cutover_at: null } }, error: null };
      }
      return { data: { event_type: "event", bookings_closed: false }, error: null };
    }
    if (table === "ticket_checkout_sessions" && action === "update" && payload) {
      return { data: null, error: null };
    }
    throw new Error(`unexpected query ${table}/${action}/${single}`);
  }
}

const request = (lines: unknown[]) =>
  new Request("http://edge.test/ticket-checkout-create", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer fixture" },
    body: JSON.stringify({
      eventId: EVENT_ID,
      buyer: { name: "Retest Buyer", email: "buyer@example.com", phone: "+2348012345678", marketingOptIn: false },
      lines,
      surface: "web",
    }),
  });

const harness = () => {
  const db = new FakeServiceClient();
  let initialized = 0;
  const deps: TicketCheckoutCreateDeps = {
    userIdFromAuthHeader: async () => null,
    serviceClient: () => db as never,
    paystackInitializeTransaction: async (input) => {
      initialized++;
      db.operations.push("paystack:initialize");
      return {
        authorization_url: "https://synthetic.invalid/authorize",
        access_code: "access_fixture",
        reference: String(input.reference),
      };
    },
  };
  return { db, handler: createTicketCheckoutCreateHandler(deps), initialized: () => initialized };
};

Deno.test("#4624 tester: repeated ticket types reach the session as one merged line", async () => {
  const { db, handler } = harness();
  const response = await handler(request([
    { ticketTypeId: TIER_ID, quantity: 2 },
    { ticketTypeId: TIER_ID, quantity: 3 },
  ]));
  assertEquals(response.status, 200);
  assertEquals(db.sessionLines, [{ ticketTypeId: TIER_ID, quantity: 5 }]);
});

Deno.test("#4624 tester: repeats that differ beyond quantity are refused before any RPC", async () => {
  const variants: unknown[][] = [
    [{ ticketTypeId: TIER_ID, quantity: 1 }, { ticketTypeId: TIER_ID, quantity: 1, addOns: [{ id: "a", quantity: 1 }] }],
    [{ ticketTypeId: TIER_ID, quantity: 1, paymentPlanChoice: "full" }, { ticketTypeId: TIER_ID, quantity: 1, paymentPlanChoice: "installments" }],
    [{ ticketTypeId: TIER_ID, quantity: 1, byDate: { d1: 1 } }, { ticketTypeId: TIER_ID, quantity: 1 }],
  ];
  for (const lines of variants) {
    const { db, handler, initialized } = harness();
    const response = await handler(request(lines));
    assertEquals(response.status, 400, JSON.stringify(lines));
    assertEquals(await response.json(), { error: "checkout_lines_duplicate" });
    assertEquals(
      db.operations.filter((op) => op.startsWith("rpc:") && op !== "rpc:issue_2579_record_checkout_refusal"),
      [],
    );
    assertEquals(initialized(), 0);
  }
});

Deno.test("#4624 tester: a repeat the edge cannot see is refused by the database as 400", async () => {
  const { db, handler, initialized } = harness();
  db.sessionError = { message: "checkout_lines_duplicate" };
  const response = await handler(request([
    { ticketTypeId: TIER_ID, quantity: 1 },
    { ticketTypeId: TIER_ID.toUpperCase(), quantity: 1 },
  ]));
  // The edge keys by the exact string, so both lines are sent; the database
  // (uuid-typed) sees one ticket type twice and refuses.
  assertEquals(db.sessionLines?.length, 2);
  assertEquals(response.status, 400);
  assertEquals(await response.json(), { error: "checkout_lines_duplicate" });
  assertEquals(initialized(), 0);
});

Deno.test("#4624 tester: no capped discount, no hold call, and a missing hold function cannot break it", async () => {
  const { db, handler, initialized } = harness();
  db.holdError = { message: "function public.issue_4624_extend_discount_hold does not exist" };
  db.sessionExtra = { discounts: [{ discountId: "d1", kind: "code", limited: false }] };
  const response = await handler(request([{ ticketTypeId: TIER_ID, quantity: 1 }]));
  assertEquals(response.status, 200);
  assertEquals(db.operations.includes("rpc:issue_4624_extend_discount_hold"), false);
  assertEquals(initialized(), 1);
});

Deno.test("#4624 tester: a capped discount asks for the hold and stops on its failure", async () => {
  for (const extra of [
    { discounts: [{ discountId: "d1", kind: "code", limited: true }] },
    { items: [{ ticketTypeId: TIER_ID, applied: [{ discountId: "d1", limited: true }] }] },
  ]) {
    const ok = harness();
    ok.db.sessionExtra = extra;
    assertEquals((await ok.handler(request([{ ticketTypeId: TIER_ID, quantity: 1 }]))).status, 200);
    assert(ok.db.operations.includes("rpc:issue_4624_extend_discount_hold"), JSON.stringify(extra));
    const bad = harness();
    bad.db.sessionExtra = extra;
    bad.db.holdError = { message: "synthetic" };
    const response = await bad.handler(request([{ ticketTypeId: TIER_ID, quantity: 1 }]));
    assertEquals(response.status, 500);
    assertEquals((await response.json()).detail, "discount_hold_extend_failed");
    assertEquals(bad.initialized(), 0);
  }
});

Deno.test("#4624 tester: normaliseBasketLines edge cases", () => {
  const input = [
    { ticketTypeId: "b", quantity: 1 },
    { ticketTypeId: "a", quantity: 2, byDate: { d2: 1, d1: 1 } },
    { ticketTypeId: "b", quantity: 4 },
    { ticketTypeId: "a", quantity: 1, byDate: { d1: 1 } },
  ];
  const snapshot = JSON.stringify(input);
  const result = normaliseBasketLines(input);
  // First-seen order, per-date sums, and the caller's array is not mutated.
  assertEquals(result, {
    ok: true,
    lines: [
      { ticketTypeId: "b", quantity: 5 },
      { ticketTypeId: "a", quantity: 3, byDate: { d1: 2, d2: 1 } },
    ],
  });
  assertEquals(JSON.stringify(input), snapshot);
  // Field order does not matter; empty add-on lists merge.
  assertEquals(
    normaliseBasketLines([
      { ticketTypeId: "c", quantity: 1, addOns: [], note: "x" } as never,
      { note: "x", addOns: [], ticketTypeId: "c", quantity: 1 } as never,
    ]).ok,
    true,
  );
  // Huge quantities are summed, never wrapped; the server's limits refuse them.
  const huge = normaliseBasketLines([
    { ticketTypeId: "h", quantity: 2_000_000_000 },
    { ticketTypeId: "h", quantity: 2_000_000_000 },
  ]);
  assertEquals(huge.ok && huge.lines[0].quantity, 4_000_000_000);
  // __proto__ as an id is an ordinary key.
  assertEquals(
    normaliseBasketLines([{ ticketTypeId: "__proto__", quantity: 1 }, { ticketTypeId: "__proto__", quantity: 1 }]),
    { ok: true, lines: [{ ticketTypeId: "__proto__", quantity: 2 }] },
  );
});

Deno.test("#4624 tester: sessionHasCappedDiscount is strict", () => {
  assertEquals(sessionHasCappedDiscount({}), false);
  assertEquals(sessionHasCappedDiscount({ discounts: [{ limited: "true" }] }), false);
  assertEquals(sessionHasCappedDiscount({ discounts: [null, 1, "x"] } as never), false);
  assertEquals(sessionHasCappedDiscount({ lineItems: [{ applied: [{ limited: true }] }] }), true);
  assertEquals(sessionHasCappedDiscount({ items: [{ applied: [{ limited: false }] }] }), false);
});
