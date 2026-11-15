/**
 * #4238 P1-1 — the free-order ad conversion runs through the handler's
 * injectable `EdgeRuntime.waitUntil` seam (scheduleAdWorkDefault), never
 * a bare `void` promise that outlives the request. A bare `void` made the
 * #2136 / #2150 / #2337 suites red with "Leaks detected" once the fire did more
 * async work (digests) after the response.
 *
 * I-4238-FREE-AD-WORK-SCHEDULED: the free-order fireAdConversion promise is
 * handed to EdgeRuntime.waitUntil exactly once per non-replayed free finalize,
 * and the default scheduler, with no EdgeRuntime, returns a promise the
 * handler awaits (so no work is left running after the response).
 *
 * Fixture copied from issue_2136_free_checkout_contract.test.ts.
 * FAILS ON REVERT of the seam (a bare `void fireAdConversion(...)`).
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketCheckoutCreateHandler,
  scheduleAdWorkDefault,
  type TicketCheckoutCreateDeps,
} from "../index.ts";

const EVENT_ID = "10000000-0000-4000-8000-00000000e136";
const TIER_ID = "20000000-0000-4000-8000-00000000e137";
const SESSION_ID = "30000000-0000-4000-8000-00000000e138";
const ORDER_ID = "40000000-0000-4000-8000-00000000e139";
const TICKET_ID = "50000000-0000-4000-8000-00000000e13a";

// `qrTokenPepper()` rejects anything under 32 chars; the free arm returns HTTP
// 500 `qr_token_pepper_missing` without it, so every case below would be
// vacuously "not a 200" and prove nothing.
Deno.env.set(
  "app.qr_token_pepper",
  "issue-2136-regression-pepper-value-0123456789",
);
// Left unset deliberately: `dispatchTicketConfirmation` and the ad-conversion
// fan-out both no-op without SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, so the
// test performs no network I/O.

type DbResult = {
  data?: unknown;
  error?: { message: string } | null;
  count?: number;
};

type FinalizeMode = "finalized" | "unavailable" | "paid_reversal_pending";

interface OrderRow {
  id: string;
  event_id: string;
  payment_method: string;
}

interface TicketRow {
  id: string;
  order_id: string;
  ticket_type_id: string;
  qr_code: string;
  status: string;
  ticket_types: { name: string };
}

class FakeQuery implements PromiseLike<DbResult> {
  private action = "select";
  constructor(
    private readonly db: FakeCheckoutDb,
    private readonly table: string,
  ) {}
  select(_c?: string, options?: { count?: string; head?: boolean }): this {
    this.action = options?.head ? "head" : "select";
    return this;
  }
  update(_p: Record<string, unknown>): this {
    this.action = "update";
    return this;
  }
  insert(_p: unknown): this {
    this.action = "insert";
    return this;
  }
  eq(): this {
    return this;
  }
  gt(): this {
    return this;
  }
  in(): this {
    return this;
  }
  // issue #2689 — the status-token UPDATE now carries `.is("order_id", null)`,
  // so a duplicate that is about to refuse can no longer re-mint the possession
  // proof of a session that already completed. Without this stub the chain
  // returns undefined and the arm answers 500 instead of its real refusal.
  is(): this {
    return this;
  }
  order(): this {
    return this;
  }
  maybeSingle(): Promise<DbResult> {
    return Promise.resolve(this.exec());
  }
  then<A = DbResult, B = never>(
    onfulfilled?: ((v: DbResult) => A | PromiseLike<A>) | null,
    onrejected?: ((r: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.exec()).then(onfulfilled, onrejected);
  }
  private exec(): DbResult {
    this.db.operations.push(`${this.action}:${this.table}`);
    if (this.table === "event_dates") {
      return { data: null, error: null, count: 1 };
    }
    if (this.table === "trip_intake_schemas") return { data: [], error: null };
    if (this.table === "orders" && this.action === "select") {
      return {
        data: {
          buyer_email: "guest@issue2136.test",
          buyer_phone_e164: "+15551232136",
          buyer_user_id: null,
          purchased_by_user_id: null,
          total_cents: 0,
          tax_amount_cents: 0,
          buyer_fees_cents: 0,
          tax_cents: 0,
          buyer_total_cents: 0,
          event_date_id: null,
          booked_start_at: null,
        },
        error: null,
      };
    }
    if (this.table === "tickets" && this.action === "select") {
      return { data: this.db.tickets, error: null };
    }
    if (
      this.table === "order_line_items" ||
      this.table === "order_discount_lines"
    ) return { data: [], error: null };
    return { data: null, error: null, count: 0 };
  }
}

/**
 * A fake that behaves like the post-#2136 database, not like a stub that says
 * yes. `biz_ticket_checkout_finalize` mints state ONLY on the `finalized` arm,
 * so "no order was created" is a real observable and not an assertion about a
 * mock call list.
 */
class FakeCheckoutDb {
  readonly operations: string[] = [];
  /** Which arm the finalize wrapper takes for this run. */
  finalizeMode: FinalizeMode = "finalized";
  /**
   * When true the wrapper answers from its idempotent-replay arm
   * (`order_id IS NOT NULL` -> `{outcome,orderId}` with NO tickets), which is
   * the second way `result.tickets` reached the client as `undefined`.
   */
  replayArm = false;
  sessionStatus = "pending_free";
  readonly orders: OrderRow[] = [];
  readonly tickets: TicketRow[] = [];

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  // deno-lint-ignore require-await
  async rpc(name: string, _args: Record<string, unknown>): Promise<DbResult> {
    this.operations.push(`rpc:${name}`);
    switch (name) {
      case "issue_2101_ticket_checkout_access_decision":
        return { data: "allowed_unrestricted", error: null };
      case "biz_ticket_checkout_create_session":
        return {
          data: {
            checkoutSessionId: SESSION_ID,
            totalCents: 0,
            currency: "NGN",
          },
          error: null,
        };
      case "issue_1930_ticket_session_authorized":
        return { data: true, error: null };
      case "mint_claim_link":
        return {
          data: { code: "ABC2136000", claimed: false },
          error: null,
        };
      case "biz_ticket_checkout_finalize":
        return { data: this.runFinalize(), error: null };
      default:
        return { data: null, error: null };
    }
  }

  private runFinalize(): Record<string, unknown> {
    if (this.finalizeMode === "unavailable") {
      // The migration's no-value arm: NO session mutation, NO order, NO
      // revocation-outbox row — there is no payment to reverse.
      return { outcome: "unavailable" };
    }
    if (this.finalizeMode === "paid_reversal_pending") {
      // The pre-#2136 production behaviour for a free session. Kept as a case
      // because the Edge must handle it explicitly rather than relabel it.
      this.sessionStatus = "failed";
      return {
        outcome: "paid_reversal_pending",
        reversalReason: "paid_provider_reference_missing",
      };
    }
    this.orders.push({
      id: ORDER_ID,
      event_id: EVENT_ID,
      payment_method: "free",
    });
    this.tickets.push({
      id: TICKET_ID,
      order_id: ORDER_ID,
      ticket_type_id: TIER_ID,
      qr_code: "mgl_free_2136_qr",
      status: "valid",
      ticket_types: { name: "Free entry" },
    });
    this.sessionStatus = "free_completed";
    if (this.replayArm) return { outcome: "finalized", orderId: ORDER_ID };
    return {
      outcome: "finalized",
      orderId: ORDER_ID,
      checkoutSessionId: SESSION_ID,
      eventId: EVENT_ID,
      paymentStatus: "paid",
      totalCents: 0,
      currency: "NGN",
      notificationStatus: "queued",
      tickets: [{
        ticketId: TICKET_ID,
        ticketTypeId: TIER_ID,
        ticketName: "Free entry",
        qrPayload: "mgl_free_2136_qr",
        status: "valid",
      }],
    };
  }
}

const makeDeps = (client: FakeCheckoutDb): TicketCheckoutCreateDeps => ({
  userIdFromAuthHeader: () => Promise.resolve(null),
  serviceClient: () => client as never,
  paystackInitializeTransaction: (() => {
    throw new Error(
      "PROVIDER CALLED — a free reservation must never reach a payment provider",
    );
  }) as never,
});

const freeRequest = (): Request =>
  new Request("https://edge.test/ticket-checkout-create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventId: EVENT_ID,
      surface: "web",
      returnContract: "host_v1",
      buyer: {
        name: "Guest Person",
        email: "guest@issue2136.test",
        phone: "+15551234567",
      },
      lines: [{
        ticketTypeId: TIER_ID,
        quantity: 1,
        expectedUnitPriceCents: 0,
      }],
    }),
  });

Deno.test("#4238 P1-1: on the edge runtime the free-order ad conversion is handed to waitUntil", async () => {
  const g = globalThis as unknown as {
    EdgeRuntime?: { waitUntil: (w: Promise<unknown>) => void };
  };
  const held: Promise<unknown>[] = [];
  g.EdgeRuntime = { waitUntil: (w) => held.push(w) };
  try {
    const db = new FakeCheckoutDb();
    const res = await createTicketCheckoutCreateHandler(makeDeps(db))(freeRequest());
    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.kind, "free_completed");
    // Two waitUntil hand-offs: the checkout start (scheduleCheckoutAdStart)
    // and the free-order conversion. A bare `void` leaves only the first.
    assertEquals(
      held.length,
      2,
      "the free-order ad conversion was not handed to EdgeRuntime.waitUntil",
    );
    await Promise.all(held);
  } finally {
    delete g.EdgeRuntime;
  }
});

Deno.test("#4238 P1-1: with no EdgeRuntime the default scheduler returns an awaitable promise", async () => {
  let settled = false;
  const pending = scheduleAdWorkDefault(
    new Promise((resolve) => setTimeout(resolve, 1)).then(() => {
      settled = true;
    }),
  );
  assert(pending instanceof Promise, "no promise to await without a runtime");
  await pending;
  assert(settled);
});

Deno.test("#4238 P1-1: on the edge runtime the default scheduler uses waitUntil and returns nothing", async () => {
  const g = globalThis as unknown as {
    EdgeRuntime?: { waitUntil: (w: Promise<unknown>) => void };
  };
  const held: Promise<unknown>[] = [];
  g.EdgeRuntime = { waitUntil: (w) => held.push(w) };
  try {
    const work = Promise.resolve();
    const pending = scheduleAdWorkDefault(work);
    assertEquals(pending, undefined);
    assertEquals(held.length, 1);
    await held[0];
  } finally {
    delete g.EdgeRuntime;
  }
});
