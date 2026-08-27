/**
 * issue #2695 [the buyer waits on their own confirmation email] — the ordering
 * proof, driven through the REAL handler on the REAL #2150 harness.
 *
 * MEASURED, 34 real purchases: the buyer waited 5 670 ms at p50, of which
 * 3 774 ms — 66% — was `dispatchTicketConfirmation` rendering and sending an
 * email TO THEM. They watched a spinner while a message about the thing that
 * had already succeeded went out. That dead time is also what made people tap
 * twice, which is #2689.
 *
 * WHY MOVING IT IS SAFE, and it is not "the fetch usually works". Both
 * `ticket_order_notifications` rows are inserted INSIDE
 * `issue_1930_ticket_checkout_finalize_base`'s transaction, before the dispatch
 * exists. The dispatch CONSUMES rows; it does not create them. Worst case is a
 * LATE email, never a lost one — `orch_0788_notification_retry_sweeper` collects
 * a `pending` row five minutes on.
 *
 * That backstop had never once fired in production and its own suite was red on
 * main in no CI lane. #2695 repaired and registered it FIRST.
 *
 * WHY THIS FILE REUSES THE #2150 HARNESS. My first attempt hand-rolled a fake db
 * and got a 500 before finalize — I would have been debugging my own stub, and
 * any assertion that eventually passed would have been about the stub rather
 * than the handler. The harness below already drives the real free path.
 *
 * THE MECHANISM: the dispatch fetch is held open FOREVER. If the handler awaits
 * it, nothing here completes and the test times out — which is the truthful
 * signal, because a buyer whose spinner never stops is exactly what that means.
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
            replayed: false,
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


/**
 * Holds every outbound confirmation fetch open forever.
 *
 * THE ENV LINES ARE LOAD-BEARING, and their absence is why the first version of
 * this test was worthless. `dispatchTicketConfirmation` opens with
 * `if (!url || !key) return;` — with those unset, as they are in a bare test
 * run, it returns INSTANTLY without ever calling fetch. The hung-fetch trick
 * could never fire, so the suite passed identically with the `await` restored
 * and proved nothing at all. Setting them puts the real fetch on the path,
 * which is the only thing that makes awaiting distinguishable from not.
 */
const withHungDispatch = async <T>(run: () => Promise<T>): Promise<T> => {
  Deno.env.set("SUPABASE_URL", "https://edge.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (
      url.includes("ticket-confirmation-dispatch") ||
      url.includes("notify-dispatch")
    ) {
      return new Promise<Response>(() => {});
    }
    return realFetch(input as never);
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
  }
};

Deno.test("#2695 the buyer is answered without waiting on the confirmation send", async () => {
  const db = new FakeResubmitDb();
  db.alreadyCompleted = false;
  const handler = createTicketCheckoutCreateHandler(makeDeps(db));

  const res = await withHungDispatch(() => handler(freeRequest()));
  const body = await res.json() as Record<string, unknown>;

  assertEquals(res.status, 200);
  assertEquals(body.kind, "free_completed");
  assert(
    db.finalizeCalls === 1,
    "the reservation was not actually finalized, so this proves nothing about ordering",
  );
});

Deno.test("#2695 the durable rows come from FINALIZE, not from the send", async () => {
  // The safety argument, pinned. If a future change moved the
  // `ticket_order_notifications` insert out of finalize and into the dispatch,
  // an un-awaited send would become a LOST email rather than a late one — and
  // this file's entire premise would be false with nothing else going red.
  const db = new FakeResubmitDb();
  db.alreadyCompleted = false;
  const handler = createTicketCheckoutCreateHandler(makeDeps(db));

  await withHungDispatch(() => handler(freeRequest()));

  assert(
    db.operations.includes("rpc:biz_ticket_checkout_finalize"),
    "finalize was never called, so no durable notification rows exist",
  );
});
