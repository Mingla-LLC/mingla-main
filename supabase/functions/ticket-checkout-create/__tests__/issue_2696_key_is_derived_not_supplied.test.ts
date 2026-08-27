/**
 * issue #2696 [a caller-supplied idempotency key could resolve another event's
 * session] — the edge half.
 *
 * WHAT WAS TRUE. `ticket-checkout-create` accepted `body.idempotencyKey`
 * VERBATIM with no validation — no prefix, no length, no relationship to the
 * event being bought — and that key is the sole lookup for an existing session
 * (`WHERE idempotency_key=p_idempotency_key`, with no event conjunct). So a
 * request naming event B could be answered with event A's session, after which
 * every decision — the #2101 access mode, the named-buyer cross-check, the
 * status-token write — was made against B's rules on A's row.
 *
 * WHAT IT WAS NOT. Not a route to somebody's pass. Disclosure still required the
 * victim's 256-bit `buyer_status_token`, and 0 of 142 disclosable sessions lack
 * one. I called this a live hole first and withdrew that; it is a cross-event
 * existence ORACLE (does this person hold a reservation — answerable even for
 * private events and events outside their sale window) and a way to overwrite a
 * stranger's token mid-checkout on an event the caller cannot otherwise touch.
 *
 * NO CLIENT EVER SENT IT. Both native flows forward an optional field nothing
 * populates; the web service passes none. The branch was dead for honest traffic
 * and live only for someone probing it — and the service's own comment already
 * described the intended model: "the server derives the idempotency key from the
 * request body alone." This makes that comment true.
 *
 * The DERIVED key embeds the event id, so deriving it always is the fix. The
 * paired migration adds `AND event_id=p_event_id` to the lookup so the scoping
 * is ENFORCED rather than implied — 179 of 179 live rows already satisfy it.
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
  /** issue #2696 — the key the lookup actually receives, which is the subject. */
  readonly idempotencyKeys: string[] = [];
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
        this.idempotencyKeys.push(String(_args.p_idempotency_key ?? ""));
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


const FOREIGN_KEY = "ticket_checkout:11111111-2222-3333-4444-555555555555:victim@example.invalid:+2348010000000:tier:1";

/** A free request carrying a caller-chosen idempotency key. */
const requestWithSuppliedKey = (key: string): Request =>
  new Request("https://edge.test/ticket-checkout-create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventId: EVENT_ID,
      surface: "web",
      returnContract: "host_v1",
      idempotencyKey: key,
      lines: [{ ticketTypeId: TIER_ID, quantity: 1 }],
      buyer: {
        name: "Probing Caller",
        email: "prober@example.invalid",
        phone: "+2348012345678",
      },
    }),
  });

const keyPassedToRpc = (db: FakeResubmitDb): string => {
  const key = db.idempotencyKeys.at(-1);
  if (key === undefined) throw new Error("create_session was never called");
  return key;
};

Deno.test("#2696 a caller-supplied key is IGNORED — the server derives its own", async () => {
  const db = new FakeResubmitDb();
  db.alreadyCompleted = false;
  const handler = createTicketCheckoutCreateHandler(makeDeps(db));

  await handler(requestWithSuppliedKey(FOREIGN_KEY));

  const used = keyPassedToRpc(db);
  assert(
    used !== FOREIGN_KEY,
    "the caller's key reached the lookup — a request for one event could be " +
      "answered with another event's session",
  );
  assert(
    used.includes(EVENT_ID),
    `the derived key must name the event being bought; got ${used}`,
  );
});

Deno.test("#2696 the derived key names the requested event, not one the caller chose", async () => {
  // The property that makes the whole scoping work: whatever the caller sends,
  // the key handed to the lookup is composed from the event THIS request is for.
  const db = new FakeResubmitDb();
  db.alreadyCompleted = false;
  const handler = createTicketCheckoutCreateHandler(makeDeps(db));

  await handler(requestWithSuppliedKey("1"));

  const used = keyPassedToRpc(db);
  assert(
    used !== "1",
    "a one-character key reached the lookup — that value collides across every " +
      "brand on the platform",
  );
  assert(used.startsWith("ticket_checkout:"), `unexpected key shape: ${used}`);
  assert(used.includes(EVENT_ID), "the derived key does not name the event");
});
