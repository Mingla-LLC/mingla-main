/**
 * issue #2694 [a concurrent duplicate can receive another buyer's QR codes] —
 * the disclosure gate on the finalize replay path.
 *
 * THE DEFECT, and it is live. On a concurrent duplicate the session RPC's
 * in-flight arm answers `pending_free` with a null order, so the #2150
 * possession branch is SKIPPED — deliberately: that path is documented as
 * needing no token, on the reasoning that finalize is idempotent under its own
 * row lock. It is. But when the winner commits first, finalize returns the
 * ALREADY-EXISTING order, and the Edge then reads its tickets and renders their
 * QR images for whoever asked. No JWT. No token. No code sent to the buyer.
 *
 * Whether that happens was decided by TIMING alone — the pre-finalize gate
 * refuses a completed session, so the outcome was a coin flip between
 * disclosing a stranger's pass and telling its owner the sale was gone. Two
 * production rows carry the fingerprint of that window (`updated_at` earlier
 * than the row's own `completed_at`, which only a second create can produce):
 * gaps of 27ms and 52ms, one of them the day this was found.
 *
 * WHY THE OBVIOUS FIX WAS THE DANGEROUS ONE. Deleting the pre-gate — proposed
 * on the correct observation that finalize already handles replays — removes
 * the coin and discloses EVERY time. The gate stays; finalize now reports
 * `replayed`, and a replay must prove possession exactly as #2150 does.
 *
 * These cases drive the REAL handler. The fake models the REAL predicates: the
 * authorize gate refuses a completed session, and the disclosure function
 * requires a non-empty presented hash equal to the stored one.
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

  /** issue #2694 — finalize finds the order already there (the lost race). */
  replayedFinalize = false;

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
        // issue #2694 — THE RACE, modelled exactly. `create_session` above
        // answered `pending_free` (so the #2150 branch was skipped), and by the
        // time finalize ran the winner had already committed. The real function
        // now reports that with `replayed:true` and mints nothing.
        if (this.replayedFinalize) {
          return {
            data: { outcome: "finalized", replayed: true, orderId: ORDER_ID },
            error: null,
          };
        }
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


const RACE_TOKEN = "mgl_free_2694_real_token";

/** The lost race: `create_session` says pending_free, finalize says replayed. */
const raceDb = (storedHash: string | null): FakeResubmitDb => {
  const db = new FakeResubmitDb();
  db.alreadyCompleted = false;
  db.replayedFinalize = true;
  db.storedStatusTokenHash = storedHash;
  return db;
};

Deno.test("#2694 a replay WITHOUT possession is refused and discloses nothing", async () => {
  const db = raceDb(await sha256Hex(RACE_TOKEN));
  const handler = createTicketCheckoutCreateHandler(makeDeps(db));

  const response = await handler(freeRequest());
  const body = await response.json() as Record<string, unknown>;
  const serialized = JSON.stringify(body);

  assertEquals(response.status, 409);
  assertEquals(body.error, "free_reservation_already_exists");

  assertFalse(
    serialized.includes(ORDER_ID),
    "the refusal LEAKED THE ORDER ID of a reservation the caller never proved was theirs",
  );
  assertFalse(
    serialized.includes("mgl_free_2150_qr"),
    "the refusal LEAKED THE QR PAYLOAD — the caller could scan the guest's pass, " +
      "biz_ticket_scan would mark it used, and the guest would be refused at the door",
  );
  assertFalse(
    serialized.includes("data:image"),
    "the refusal leaked a rendered QR image",
  );
  assertEquals(
    body.tickets,
    undefined,
    "the refusal carried tickets",
  );
});

Deno.test("#2694 a replay WITH possession is served the existing order", async () => {
  // The honest guest whose first response was lost. They hold their token, so
  // they get their reservation back rather than a second one.
  const db = raceDb(await sha256Hex(RACE_TOKEN));
  const handler = createTicketCheckoutCreateHandler(makeDeps(db));

  const response = await handler(freeRequest(RACE_TOKEN));
  const body = await response.json() as Record<string, unknown>;

  assertEquals(response.status, 200);
  assertEquals(body.kind, "free_completed");
  assertEquals(body.orderId, ORDER_ID);
});

Deno.test("#2694 a served replay echoes the PRESENTED token, never a fresh one", async () => {
  // The status-token UPDATE carries `.is("order_id", null)` (#2689), so on a
  // completed session a freshly minted token's hash is never stored. Handing it
  // back would give the guest a key that opens nothing.
  const db = raceDb(await sha256Hex(RACE_TOKEN));
  const handler = createTicketCheckoutCreateHandler(makeDeps(db));

  const response = await handler(freeRequest(RACE_TOKEN));
  const body = await response.json() as Record<string, unknown>;

  assertEquals(
    body.buyerStatusToken,
    RACE_TOKEN,
    "the guest was handed a token whose hash was never stored",
  );
});

Deno.test("#2694 REVERT GUARD — without the check, the no-token caller gets the order", async () => {
  // Not a re-implementation: this asserts the PROPERTY that makes the fix
  // load-bearing. The fake's disclosure function is the real one's shape — an
  // empty presented hash can never authorize. If a future change stops asking
  // it on this path, the first case above goes green while production leaks,
  // so pin that the question is ASKED.
  const db = raceDb(await sha256Hex(RACE_TOKEN));
  const handler = createTicketCheckoutCreateHandler(makeDeps(db));

  await handler(freeRequest());

  assert(
    db.operations.includes("rpc:issue_2150_free_replay_disclosure_authorized"),
    "the replay path stopped asking for possession — the disclosure gate is gone",
  );
  assertEquals(
    db.presentedHashes.at(-1),
    "",
    "the caller presented no token, which must never authorize",
  );
});
