/**
 * issue #2150 [duplicate free tickets on resubmit] — implementor happy-path
 * regression for the EDGE half of the fix.
 *
 * The load-bearing proof lives in
 * `supabase/migrations/__tests__/issue_2150_free_resubmit_idempotent.test.sql`,
 * which executes the real RPCs on real PostgreSQL and counts real orders,
 * tickets and `ticket_order_notifications` rows. This file covers the one thing
 * SQL cannot: the control flow inside `ticket-checkout-create` itself.
 *
 * WHAT THE EDGE HALF DOES. Post-#2150 the session RPC no longer tombstones a
 * completed ZERO-TOTAL session — it returns that session, carrying
 * `status:'free_completed'` and the `orderId` it already minted. The handler
 * must recognise that and answer with the SAME order's already-issued tickets:
 *
 *   - WITHOUT calling `issue_1930_ticket_session_authorized`, which requires
 *     the session to still be IN FLIGHT and answers `false` for a completed
 *     one — the guest would be told `checkout_unavailable` about a reservation
 *     they actually hold.
 *   - WITHOUT calling `biz_ticket_checkout_finalize`.
 *   - WITHOUT re-dispatching the confirmation, which is what keeps the guest at
 *     exactly one email and one SMS.
 *
 * The fake below models the REAL database rather than saying yes: its
 * `issue_1930_ticket_session_authorized` returns `false` for a completed
 * session exactly as the SQL does, so a true line deletion of the Edge branch
 * turns the happy path into a 409 and REPLAY-01 goes red.
 */
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketCheckoutCreateHandler,
  type TicketCheckoutCreateDeps,
} from "../index.ts";
import { sha256Hex } from "../../_shared/ticketCheckout.ts";

const EVENT_ID = "10000000-0000-4000-8000-000000002150";
const TIER_ID = "20000000-0000-4000-8000-000000002151";
const SESSION_ID = "30000000-0000-4000-8000-000000002152";
const ORDER_ID = "40000000-0000-4000-8000-000000002153";
const TICKET_ID = "50000000-0000-4000-8000-000000002154";

Deno.env.set(
  "app.qr_token_pepper",
  "issue-2150-regression-pepper-value-0123456789",
);
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are left unset: both
// `dispatchTicketConfirmation` and the ad-conversion fan-out no-op without
// them, so this suite performs no network I/O.

type DbResult = {
  data?: unknown;
  error?: { message: string } | null;
  count?: number;
};

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
    private readonly db: FakeResubmitDb,
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
    if (this.table === "event_dates") return { data: null, error: null, count: 1 };
    if (this.table === "trip_intake_schemas") return { data: [], error: null };
    if (this.table === "tickets" && this.action === "select") {
      return { data: this.db.tickets, error: null };
    }
    return { data: null, error: null, count: 0 };
  }
}

/**
 * `alreadyCompleted = true` reproduces exactly what the post-#2150 RPC answers
 * on a resubmit: the guest's ORIGINAL session, untombstoned, terminal, with the
 * order it already minted.
 */
const VALID_STATUS_TOKEN = "issue2150validbuyerstatustoken0123456789abcdef";

class FakeResubmitDb {
  readonly operations: string[] = [];
  alreadyCompleted = false;
  /** Simulates an order whose passes were all voided/refunded. */
  orderHasLiveTickets = true;
  finalizeCalls = 0;
  /** The hash the DB holds for the anonymous session, as the Edge stores it. */
  storedStatusTokenHash: string | null = null;
  /** Every hash the Edge asked the DB to authorize, in order. */
  readonly presentedHashes: string[] = [];
  readonly tickets: TicketRow[] = [{
    id: TICKET_ID,
    order_id: ORDER_ID,
    ticket_type_id: TIER_ID,
    qr_code: "mgl_free_2150_qr",
    status: "valid",
    ticket_types: { name: "Free entry" },
  }];

  from(table: string): FakeQuery {
    if (table === "tickets" && !this.orderHasLiveTickets) this.tickets.length = 0;
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
          data: this.alreadyCompleted
            ? {
              checkoutSessionId: SESSION_ID,
              eventId: EVENT_ID,
              status: "free_completed",
              orderId: ORDER_ID,
              totalCents: 0,
              currency: "NGN",
            }
            : {
              checkoutSessionId: SESSION_ID,
              eventId: EVENT_ID,
              status: "pending_free",
              orderId: null,
              totalCents: 0,
              currency: "NGN",
            },
          error: null,
        };
      case "issue_1930_ticket_session_authorized":
        // The REAL predicate: `status IN ('pending_free','requires_payment',
        // 'processing_payment','awaiting_web_redirect')`. A completed session
        // is NOT authorized — which is why the Edge must never reach here on a
        // resubmit.
        return { data: !this.alreadyCompleted, error: null };
      case "issue_2150_free_replay_disclosure_authorized": {
        // Models the REAL function's anonymous branch: the presented hash must
        // be non-empty AND equal the stored one. The executed PostgreSQL suite
        // (H-08..H-10) proves the function itself; this fake exists only so the
        // Edge's wiring — that it asks at all, and refuses on `false` — is
        // provable here.
        const presented = String(_args.p_buyer_status_token_hash ?? "");
        this.presentedHashes.push(presented);
        return {
          data: this.storedStatusTokenHash !== null &&
            presented.length > 0 &&
            presented === this.storedStatusTokenHash,
          error: null,
        };
      }
      case "biz_ticket_checkout_finalize":
        this.finalizeCalls += 1;
        return {
          data: {
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
              qrPayload: "mgl_free_2150_qr",
              status: "valid",
            }],
          },
          error: null,
        };
      default:
        return { data: null, error: null };
    }
  }
}

const makeDeps = (client: FakeResubmitDb): TicketCheckoutCreateDeps => ({
  userIdFromAuthHeader: () => Promise.resolve(null),
  serviceClient: () => client as never,
  paystackInitializeTransaction: (() => {
    throw new Error(
      "PROVIDER CALLED — a free reservation must never reach a payment provider",
    );
  }) as never,
});

const freeRequest = (buyerStatusToken?: string): Request =>
  new Request("https://edge.test/ticket-checkout-create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventId: EVENT_ID,
      surface: "web",
      returnContract: "host_v1",
      buyer: {
        name: "Resubmitting Guest",
        email: "guest@issue2150.test",
        phone: "+15551234567",
      },
      lines: [{ ticketTypeId: TIER_ID, quantity: 1, expectedUnitPriceCents: 0 }],
      ...(buyerStatusToken !== undefined ? { buyerStatusToken } : {}),
    }),
  });

Deno.test("#2150 REPLAY-01: a resubmit PRESENTING the guest's token returns THAT order's passes, and never re-finalizes", async () => {
  const db = new FakeResubmitDb();
  db.alreadyCompleted = true;
  db.storedStatusTokenHash = await sha256Hex(VALID_STATUS_TOKEN);
  const res = await createTicketCheckoutCreateHandler(makeDeps(db))(
    freeRequest(VALID_STATUS_TOKEN),
  );

  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.kind, "free_completed");
  // The SAME order, not a second one.
  assertEquals(body.orderId, ORDER_ID);
  assertEquals(body.checkoutSessionId, SESSION_ID);
  assertEquals(body.totalCents, 0);
  assertEquals(body.currency, "NGN");
  assertEquals(body.paymentStatus, "paid");

  // The confirm screen maps over this; #2136 proved an undefined array is what
  // the guest sees as a raw TypeError.
  const tickets = body.tickets as Array<Record<string, unknown>> | undefined;
  assert(Array.isArray(tickets), "the replay envelope carried no tickets array");
  assertEquals(tickets.length, 1);
  assertEquals(tickets[0].ticketId, TICKET_ID);
  assertEquals(tickets[0].qrPayload, "mgl_free_2150_qr");

  // Nothing was re-run. These three are what would have produced the duplicate
  // order and the duplicate email + SMS.
  assertEquals(db.finalizeCalls, 0);
  assertFalse(
    db.operations.includes("rpc:biz_ticket_checkout_finalize"),
    "the completed reservation was finalized a second time",
  );
  assertFalse(
    db.operations.includes("rpc:issue_1930_ticket_session_authorized"),
    "the completed reservation was sent to the in-flight authorize gate, " +
      "which refuses it and would tell the guest checkout_unavailable",
  );
  assert(
    db.operations.includes("select:tickets"),
    "the issued-ticket read-back never ran",
  );
  // The token is echoed, never re-minted — and the status-token UPDATE must NOT
  // have run, or it would have rotated the hash the guest just proved against.
  assertEquals(body.buyerStatusToken, VALID_STATUS_TOKEN);
  assertFalse(
    db.operations.includes("update:ticket_checkout_sessions"),
    "the completed session's buyer_status_token_hash was overwritten — the " +
      "guest's real token from their first submit is now invalid",
  );
});

Deno.test("#2150 REPLAY-04: an anonymous resubmit with NO token is refused, and leaks no order id and no QR", async () => {
  const db = new FakeResubmitDb();
  db.alreadyCompleted = true;
  db.storedStatusTokenHash = await sha256Hex(VALID_STATUS_TOKEN);
  // No token presented — this is anyone who knows the guest's email + phone.
  const res = await createTicketCheckoutCreateHandler(makeDeps(db))(
    freeRequest(),
  );

  assertEquals(res.status, 409);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.error, "free_reservation_already_exists");

  // The assertions the guard exists for. Checking the order id alone would pass
  // while the pass itself still leaked, so the QR is asserted specifically.
  const serialized = JSON.stringify(body);
  assertFalse(
    serialized.includes(ORDER_ID),
    "the refusal disclosed the order id",
  );
  assertFalse(
    serialized.includes("mgl_free_2150_qr"),
    "the refusal LEAKED THE QR PAYLOAD — the caller could scan the guest's " +
      "pass and the guest would be refused at the door as a duplicate",
  );
  assertFalse(
    serialized.includes(TICKET_ID) || serialized.includes(SESSION_ID),
    "the refusal disclosed the ticket id or the checkout session id",
  );

  // FAIL SAFE ON STATE: nothing minted, nothing re-sent, nothing rotated.
  assertEquals(db.finalizeCalls, 0);
  assertFalse(
    db.operations.includes("update:ticket_checkout_sessions"),
    "the refused caller rotated the guest's status token",
  );
  assertFalse(
    db.operations.includes("select:tickets"),
    "the passes were read back for a caller who could not prove possession",
  );
});

Deno.test("#2150 REPLAY-05: a WRONG token is refused — possession must be proven, not asserted", async () => {
  const db = new FakeResubmitDb();
  db.alreadyCompleted = true;
  db.storedStatusTokenHash = await sha256Hex(VALID_STATUS_TOKEN);
  const res = await createTicketCheckoutCreateHandler(makeDeps(db))(
    freeRequest("not-the-guests-token-0000000000000000000000"),
  );

  assertEquals(res.status, 409);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.error, "free_reservation_already_exists");
  // The Edge must HASH what it presents, never forward the raw token.
  assertEquals(db.presentedHashes.length, 1);
  assertEquals(
    db.presentedHashes[0],
    await sha256Hex("not-the-guests-token-0000000000000000000000"),
  );
  assertEquals(db.finalizeCalls, 0);
});

Deno.test("#2150 REPLAY-06: the possession check is ASKED on every replay, and a DB error fails closed", async () => {
  const db = new FakeResubmitDb();
  db.alreadyCompleted = true;
  db.storedStatusTokenHash = await sha256Hex(VALID_STATUS_TOKEN);
  // Force the authorization RPC itself to fail. An unavailable decision must
  // never be read as permission.
  const failing = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "rpc") {
        return (name: string, args: Record<string, unknown>) =>
          name === "issue_2150_free_replay_disclosure_authorized"
            ? Promise.resolve({
              data: null,
              error: { message: "connection reset" },
            })
            : (target.rpc as (n: string, a: Record<string, unknown>) => unknown)
              .call(target, name, args);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const res = await createTicketCheckoutCreateHandler(
    makeDeps(failing as FakeResubmitDb),
  )(freeRequest(VALID_STATUS_TOKEN));

  assertEquals(res.status, 409);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.error, "free_reservation_already_exists");
  assertEquals(db.finalizeCalls, 0);
});

Deno.test("#2150 REPLAY-02: the FIRST submit is unchanged — authorize, finalize, tickets", async () => {
  const db = new FakeResubmitDb();
  const res = await createTicketCheckoutCreateHandler(makeDeps(db))(
    freeRequest(),
  );

  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.kind, "free_completed");
  assertEquals(body.orderId, ORDER_ID);
  assertEquals(db.finalizeCalls, 1);
  assert(
    db.operations.includes("rpc:issue_1930_ticket_session_authorized"),
    "the fresh free path stopped authorizing the session",
  );
  const tickets = body.tickets as Array<Record<string, unknown>> | undefined;
  assert(Array.isArray(tickets) && tickets.length === 1);
});

Deno.test("#2150 REPLAY-03: a completed session whose order has NO live passes is a handled 409, never a fake success", async () => {
  const db = new FakeResubmitDb();
  db.alreadyCompleted = true;
  db.orderHasLiveTickets = false;
  db.storedStatusTokenHash = await sha256Hex(VALID_STATUS_TOKEN);
  const res = await createTicketCheckoutCreateHandler(makeDeps(db))(
    freeRequest(VALID_STATUS_TOKEN),
  );

  assertEquals(res.status, 409);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.error, "checkout_unavailable");
  assertEquals(db.finalizeCalls, 0);
});
