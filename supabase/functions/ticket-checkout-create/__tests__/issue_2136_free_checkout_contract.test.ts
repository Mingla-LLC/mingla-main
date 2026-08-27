/**
 * issue #2136 [free-ticket checkout] — implementor happy-path regression.
 *
 * WHAT WAS BROKEN, runtime-proved on production (sessions 5cbed701-…,
 * 0a04a737-…, 7241d52e-… — all `status='failed'`,
 * `reversal_state='paid_reversal_pending'`, zero `orders`, zero `tickets`):
 *
 *   1. DATABASE — the #1930 finalize wrapper CAS-compares the session's
 *      `admission_epoch`, which is written ONLY by
 *      `issue_1930_claim_ticket_provider_attempt`. The free arm has no provider
 *      and never claims, so a free session's epoch is always NULL, the guard
 *      always fired, and (with no payment reference to interpret) it took the
 *      `paid_provider_reference_missing` arm: session failed, order never
 *      minted, a revocation-outbox row opened for a sale that took no money.
 *      `outcome='finalized'` was UNREACHABLE for a free ticket.
 *
 *   2. EDGE — the guard was `if (finalizeError || !finalized)`. Every non-success
 *      outcome is a TRUTHY object, so a finalize that created NO order was
 *      returned to the guest as HTTP 200 `kind:"free_completed"`.
 *
 *   3. CLIENT — `buyer.tsx` then ran `result.tickets.map(...)` unguarded and the
 *      raw `Cannot read properties of undefined (reading 'map')` was rendered to
 *      the guest.
 *
 * This suite pins all three, on the REAL handler, with a fake service client
 * that SIMULATES the database arms rather than asserting on source text: the
 * fake only mints an order + tickets + a `free_completed` session when the
 * finalize outcome is `finalized`, exactly as the migration does.
 *
 * FAILS ON REVERT of either the Edge outcome branching or the SQL no-value arm.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketCheckoutCreateHandler,
  readIssuedTicketsForOrder,
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
    if (this.table === "tickets" && this.action === "select") {
      return { data: this.db.tickets, error: null };
    }
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

Deno.test("#2136 HAPPY PATH: a free reservation mints a free order, a free_completed session and a NON-EMPTY tickets array", async () => {
  const db = new FakeCheckoutDb();
  const res = await createTicketCheckoutCreateHandler(makeDeps(db))(
    freeRequest(),
  );

  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.kind, "free_completed");

  // (1) an `orders` row exists with payment_method='free'
  assertEquals(db.orders.length, 1);
  assertEquals(db.orders[0].payment_method, "free");
  assertEquals(db.orders[0].id, ORDER_ID);

  // (2) the checkout session reads `free_completed`
  assertEquals(db.sessionStatus, "free_completed");

  // (3) the response carries a NON-EMPTY tickets array. This is the exact
  //     shape `buyer.tsx` maps over — before #2136 it was `undefined`.
  const tickets = body.tickets as Array<Record<string, unknown>> | undefined;
  assert(
    Array.isArray(tickets),
    "the free_completed envelope carried no tickets array",
  );
  assertEquals(tickets.length, 1);
  assertEquals(tickets[0].ticketId, TICKET_ID);
  assertEquals(tickets[0].qrPayload, "mgl_free_2136_qr");
  assertEquals(tickets[0].status, "valid");

  // The buyer contract's remaining required fields must all be present.
  assertEquals(body.orderId, ORDER_ID);
  assertEquals(body.checkoutSessionId, SESSION_ID);
  assertEquals(body.paymentStatus, "paid");
  assertEquals(body.totalCents, 0);
  assertEquals(body.currency, "NGN");
});

Deno.test("#2136 HAPPY PATH, idempotent replay: a finalize that answers {outcome,orderId} with no tickets still returns a usable envelope", async () => {
  // The wrapper's `order_id IS NOT NULL` early return carries no tickets. A
  // second tap therefore used to produce `tickets: undefined` even on a sale
  // that HAD completed. The Edge reads the issued rows back by order id.
  const db = new FakeCheckoutDb();
  db.replayArm = true;
  const res = await createTicketCheckoutCreateHandler(makeDeps(db))(
    freeRequest(),
  );

  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.kind, "free_completed");
  const tickets = body.tickets as Array<Record<string, unknown>> | undefined;
  assert(
    Array.isArray(tickets) && tickets.length === 1,
    "the replay arm produced no tickets — the read-back did not run",
  );
  assertEquals(tickets[0].ticketId, TICKET_ID);
  assertEquals(tickets[0].ticketName, "Free entry");
  // NaN totals and a missing currency are also closed on the replay arm.
  assertEquals(body.totalCents, 0);
  assertEquals(body.currency, "NGN");
  assert(
    db.operations.includes("select:tickets"),
    "the issued-ticket read-back was never performed",
  );
});

Deno.test("#2136 NEGATIVE: outcome 'unavailable' -> handled 409, NO confirmation, NO order", async () => {
  const db = new FakeCheckoutDb();
  db.finalizeMode = "unavailable";
  const res = await createTicketCheckoutCreateHandler(makeDeps(db))(
    freeRequest(),
  );

  // A handled error, not a fake success.
  assertEquals(res.status, 409);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.error, "checkout_unavailable");
  assertStringIncludes(String(body.message ?? ""), "no longer available");

  // NO confirmation: the guest is never told the reservation completed.
  assert(
    body.kind !== "free_completed",
    "a finalize that created nothing was still labelled free_completed",
  );
  assertEquals(body.tickets, undefined);
  assertEquals(body.orderId, undefined);

  // NO order.
  assertEquals(db.orders.length, 0);
  assertEquals(db.tickets.length, 0);
  assertEquals(db.sessionStatus, "pending_free");
});

Deno.test("#2136 NEGATIVE: outcome 'paid_reversal_pending' is an EXPLICIT handled branch, not a success", async () => {
  // This is the outcome production actually returned for every free checkout
  // before #2136. It must mirror the paid path (ticket-checkout-confirm returns
  // HTTP 409 `checkout_unavailable` for this exact outcome).
  const db = new FakeCheckoutDb();
  db.finalizeMode = "paid_reversal_pending";
  const res = await createTicketCheckoutCreateHandler(makeDeps(db))(
    freeRequest(),
  );

  assertEquals(res.status, 409);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.error, "checkout_unavailable");
  assert(body.kind !== "free_completed");
  assertEquals(db.orders.length, 0);
});

Deno.test("#2136 the free arm never touches a payment provider", async () => {
  const db = new FakeCheckoutDb();
  await createTicketCheckoutCreateHandler(makeDeps(db))(freeRequest());
  for (
    const forbidden of [
      "rpc:issue_1930_claim_ticket_provider_attempt",
      "rpc:issue_1930_commit_ticket_provider_attempt",
    ]
  ) {
    assert(
      !db.operations.includes(forbidden),
      `${forbidden} ran on the free path: ${db.operations.join(",")}`,
    );
  }
});

Deno.test("#2136 readIssuedTicketsForOrder prefers the envelope and falls back to the canonical rows", async () => {
  const envelope = [{
    ticketId: TICKET_ID,
    ticketTypeId: TIER_ID,
    ticketName: "Free entry",
    qrPayload: "mgl_free_2136_qr",
    status: "valid",
  }];
  const neverRead = {
    from: () => {
      throw new Error("read-back ran even though the envelope carried tickets");
    },
  };
  // issue #2216 — this funnel now ALSO attaches `qrImageDataUrl` (the free
  // confirmation screen rendered a blank white square without it). The #2136
  // contract is unchanged and asserted at exactly its original strength: every
  // field the envelope carried is preserved byte-for-byte. The added image is
  // asserted separately below, and owned by issue_2216_free_ticket_qr_image.
  const fromEnvelope = await readIssuedTicketsForOrder(
    neverRead,
    ORDER_ID,
    envelope,
  );
  assertEquals(
    fromEnvelope.map(({ qrImageDataUrl: _image, ...rest }) => rest),
    envelope,
  );
  assert(
    fromEnvelope[0].qrImageDataUrl.startsWith("data:image/png;base64,"),
    "issue #2216: the envelope arm must carry a rendered QR image",
  );

  // Empty / malformed envelopes fall through to the read-back.
  const db = new FakeCheckoutDb();
  db.tickets.push({
    id: TICKET_ID,
    order_id: ORDER_ID,
    ticket_type_id: TIER_ID,
    qr_code: "mgl_free_2136_qr",
    status: "valid",
    ticket_types: { name: "Free entry" },
  });
  for (const bad of [undefined, null, [], "tickets", [{ nope: 1 }]]) {
    const rows = await readIssuedTicketsForOrder(db, ORDER_ID, bad);
    assertEquals(rows.length, 1);
    assertEquals(rows[0].ticketId, TICKET_ID);
    assertEquals(rows[0].ticketName, "Free entry");
  }

  // A read error is NOT swallowed into a fake success — it returns [], which
  // the handler turns into a refusal.
  const erroring = {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({ data: null, error: { message: "boom" } }),
        }),
      }),
    }),
  };
  assertEquals(await readIssuedTicketsForOrder(erroring, ORDER_ID, null), []);
});

// ---------------------------------------------------------------------------
// The SQL half of the contract. The Edge branching above is necessary but not
// sufficient: without the migration's no-value arm the free path can only ever
// reach `unavailable` / `paid_reversal_pending`, so the guest would get a
// permanent, polite 409 and still never hold a free ticket.
// ---------------------------------------------------------------------------
const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20270417002136_issue_2136_free_checkout_finalize_contract.sql",
    import.meta.url,
  ),
);

Deno.test("#2136 SQL: the finalize wrapper has a no-value arm that reaches the base mint", () => {
  const fn = migration.slice(
    migration.indexOf(
      "CREATE OR REPLACE FUNCTION public.biz_ticket_checkout_finalize",
    ),
  );
  const noValueArm = fn.slice(
    fn.indexOf("IF COALESCE(v_session.total_cents,0)=0"),
    fn.indexOf(
      "IF public.issue_1930_event_sale_reason(v_event)<>'sellable' OR v_session.revoked_at IS NOT NULL",
    ),
  );
  assert(noValueArm.length > 0, "the no-value arm is absent from the wrapper");
  // Comments explain the arm (and legitimately name the epoch); assert on the
  // executable statements only.
  const arm = noValueArm
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  // Entered only with zero total AND no provider reference of any kind, so no
  // paid caller (all four supply one) can reach it.
  assertStringIncludes(arm, "COALESCE(p_stripe_payment_intent_id,'')=''");
  assertStringIncludes(arm, "COALESCE(p_stripe_charge_id,'')=''");
  // Live current truth, and NO admission-epoch CAS (a free session never
  // claims an attempt, so its epoch is always NULL).
  assertStringIncludes(arm, "issue_1930_ticket_session_authorized");
  assert(
    !arm.includes("admission_epoch"),
    "the no-value arm still CAS-compares an admission epoch a free session can never have",
  );
  // Failure is `unavailable`, never a reversal of a payment that never happened.
  assertStringIncludes(arm, "jsonb_build_object('outcome','unavailable')");
  assert(
    !arm.includes("paid_reversal_pending"),
    "a free reservation is still recorded as a pending payment reversal",
  );
  // Success delegates to the base mint, whose envelope carries `tickets`.
  assertStringIncludes(
    arm,
    "public.issue_1930_ticket_checkout_finalize_base(p_checkout_session_id",
  );
});

Deno.test("#2136 SQL: the PAID current-truth guard is preserved byte-for-byte", () => {
  // Production has had exactly two successful paid checkouts. The no-value arm
  // is additive; the paid guard, its provider-evidence CASE, its outbox write
  // and its late reversal must be untouched.
  for (
    const clause of [
      "OR v_session.admission_epoch IS NULL OR v_admission.epoch<>v_session.admission_epoch",
      "WHEN COALESCE(p_stripe_payment_intent_id,'') ~ '^pi_[A-Za-z0-9]+$'",
      "'paid_provider_reference_missing','provider_unknown','paid_provider_reference_missing'",
      "public.issue_1930_mint_ticket_late_reversal(v_session.id,",
      "RETURN jsonb_build_object('outcome','paid_reversal_pending',",
    ]
  ) {
    assertStringIncludes(migration, clause);
  }
  // The grant surface is unchanged: service_role only.
  assertStringIncludes(
    migration,
    "REVOKE ALL ON FUNCTION public.biz_ticket_checkout_finalize(uuid,text,text,text,text,text,text,boolean)\n  FROM PUBLIC, anon, authenticated;",
  );
  assertStringIncludes(
    migration,
    "GRANT EXECUTE ON FUNCTION public.biz_ticket_checkout_finalize(uuid,text,text,text,text,text,text,boolean)\n  TO service_role;",
  );
});
