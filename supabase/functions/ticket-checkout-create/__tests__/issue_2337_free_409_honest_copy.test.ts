/**
 * issue #2337 [free checkout says "no more tickets" for any conflict] — the
 * END-TO-END proof, and the reason this suite is not two suites.
 *
 * THE DEFECT. `freeCheckoutErrorMessage` opened with
 *
 *     if (httpStatusOf(error) === 409) return FREE_CHECKOUT_UNAVAILABLE_MESSAGE;
 *
 * and `ticket-checkout-create` answers 409 for TWELVE distinct free-rail
 * conflicts carrying FIVE distinct bounded tokens. Every one of them reached the
 * guest as "this free ticket is no longer available … Nothing was reserved" —
 * including `free_reservation_already_exists`, which means the guest ALREADY
 * HOLDS the reservation, on an event whose ticket type is UNLIMITED.
 *
 * WHY THIS FILE DRIVES BOTH HALVES IN ONE PROCESS. A test that hand-copies the
 * server's tokens into a client-side assertion is a test of the transcription,
 * not of the server: the arms drift, the copy stays green, and nobody finds out
 * until a founder does. So each case below
 *
 *   1. drives the REAL `createTicketCheckoutCreateHandler` into ONE 409 arm,
 *   2. takes the REAL `Response` it produced,
 *   3. wraps it exactly the way `supabase.functions.invoke` does (an opaque
 *      `FunctionsHttpError` whose `.context` IS that Response),
 *   4. runs the REAL `readEdgeRefusal` + the REAL `freeCheckoutErrorMessage`
 *      from `mingla-business/src/services/checkoutErrorCopy.ts`,
 *
 * and asserts on the sentence a guest would actually read. Nothing in the chain
 * is a stand-in. That is only possible because #2337 moved the mapper into a
 * module with ZERO imports.
 *
 * FAILS ON REVERT. `#2337 REVERT GUARD` at the bottom re-implements the deleted
 * line — status-keyed mapping — and asserts it disagrees with the shipped mapper
 * on real arms. Restore the old mapper and the arm cases go red first; the guard
 * documents exactly which sentences the revert would resurrect.
 */
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketCheckoutCreateHandler,
  type TicketCheckoutCreateDeps,
} from "../index.ts";
import {
  FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE,
  FREE_CHECKOUT_CONFLICT_MESSAGE,
  FREE_CHECKOUT_FAILED_MESSAGE,
  FREE_CHECKOUT_INTAKE_STALE_MESSAGE,
  FREE_CHECKOUT_MESSAGES,
  FREE_CHECKOUT_SOLD_OUT_MESSAGE,
  FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
  freeCheckoutErrorMessage,
  readEdgeRefusal,
} from "../../../../mingla-business/src/services/checkoutErrorCopy.ts";

const EVENT_ID = "10000000-0000-4000-8000-000000002337";
const TIER_ID = "20000000-0000-4000-8000-000000002338";
const SESSION_ID = "30000000-0000-4000-8000-000000002339";
const ORDER_ID = "40000000-0000-4000-8000-00000000233a";
const TICKET_ID = "50000000-0000-4000-8000-00000000233b";
const SCHEMA_VERSION_ID = "60000000-0000-4000-8000-00000000233c";

// `qrTokenPepper()` rejects anything under 32 chars; without it the free arm
// answers HTTP 500 and every case below would be vacuously "not a 200".
Deno.env.set(
  "app.qr_token_pepper",
  "issue-2337-regression-pepper-value-0123456789",
);
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY left unset: the confirmation dispatch
// and the ad-conversion fan-out both no-op without them, so no network I/O.

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

/**
 * Which free-rail refusal this run should reproduce. One name per REACHABLE 409
 * arm in `ticket-checkout-create`, named by the line that emits it so a reader
 * can go straight to the source.
 */
type Arm =
  | "happy"
  | "intake_schema_stale_751"
  | "session_rpc_failed_819"
  | "session_rpc_capacity_819"
  | "free_reservation_already_exists_902"
  | "replay_order_has_no_tickets_918"
  | "status_token_persist_failed_1008"
  | "session_not_authorized_1054"
  | "finalize_rpc_errored_1079"
  | "finalize_unavailable_1104"
  | "finalize_reversal_pending_1120"
  | "finalize_unexpected_outcome_1135"
  | "finalize_order_missing_1146"
  | "finalize_tickets_missing_1173";

class FakeQuery implements PromiseLike<DbResult> {
  private action = "select";
  constructor(
    private readonly db: FakeDb,
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
  // so a session that already completed never has its possession proof re-minted
  // by a duplicate that is about to refuse. Without this stub the chain returns
  // undefined and every arm below answers 500 instead of its real 409.
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
    if (this.table === "events") {
      // Only the intake arm needs a trip; every other case is a plain event, so
      // the trip-only gates are skipped exactly as they are for a real event.
      return {
        data: this.db.arm === "intake_schema_stale_751"
          ? {
            event_type: "trip",
            bookings_closed: false,
            booking_deadline: null,
          }
          : {
            event_type: "event",
            bookings_closed: false,
            booking_deadline: null,
          },
        error: null,
      };
    }
    if (this.table === "event_dates") return { data: null, error: null, count: 1 };
    if (this.table === "trip_intake_schemas") {
      return {
        data: this.db.arm === "intake_schema_stale_751"
          ? [{
            ticket_type_id: TIER_ID,
            schema_version_id: SCHEMA_VERSION_ID,
            schema: { questions: [{ id: "diet", type: "text", required: false }] },
          }]
          : [],
        error: null,
      };
    }
    if (this.table === "ticket_checkout_sessions" && this.action === "update") {
      return this.db.arm === "status_token_persist_failed_1008"
        ? { data: null, error: { message: "update denied" } }
        : { data: null, error: null };
    }
    if (this.table === "tickets" && this.action === "select") {
      return { data: this.db.tickets, error: null };
    }
    return { data: null, error: null, count: 0 };
  }
}

/**
 * A fake that behaves like the database, not like a stub that says yes: it mints
 * an order + tickets only on the arm where the real wrapper does, so "nothing
 * was reserved" is a real observable rather than an assertion about a mock.
 */
class FakeDb {
  readonly operations: string[] = [];
  readonly tickets: TicketRow[] = [];
  constructor(readonly arm: Arm) {}

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
        return this.createSession();
      case "issue_2150_free_replay_disclosure_authorized":
        // The completed-replay arms only. `false` is what the real RPC answers
        // when an ANONYMOUS caller presents no buyer status token.
        return {
          data: this.arm !== "free_reservation_already_exists_902",
          error: null,
        };
      case "issue_1930_ticket_session_authorized":
        return {
          data: this.arm !== "session_not_authorized_1054",
          error: null,
        };
      case "biz_ticket_checkout_finalize":
        return this.finalize();
      default:
        return { data: null, error: null };
    }
  }

  private createSession(): DbResult {
    if (this.arm === "session_rpc_failed_819") {
      return { data: null, error: { message: "deadlock detected" } };
    }
    if (this.arm === "session_rpc_capacity_819") {
      // The EXACT shape a genuinely sold-out LIMITED tier produces: the SQL
      // `RAISE EXCEPTION 'ticket_capacity_exceeded'` surfaces as the RPC error
      // message and the Edge forwards it as the 409's `detail`.
      return { data: null, error: { message: "ticket_capacity_exceeded" } };
    }
    const completedReplay = this.arm === "free_reservation_already_exists_902" ||
      this.arm === "replay_order_has_no_tickets_918";
    return {
      data: {
        checkoutSessionId: SESSION_ID,
        totalCents: 0,
        currency: "NGN",
        eventId: EVENT_ID,
        ...(completedReplay
          ? { status: "free_completed", orderId: ORDER_ID }
          : {}),
      },
      error: null,
    };
  }

  private finalize(): DbResult {
    switch (this.arm) {
      case "finalize_rpc_errored_1079":
        return { data: null, error: { message: "finalize exploded" } };
      case "finalize_unavailable_1104":
        return { data: { outcome: "unavailable" }, error: null };
      case "finalize_reversal_pending_1120":
        return {
          data: {
            outcome: "paid_reversal_pending",
            reversalReason: "paid_provider_reference_missing",
          },
          error: null,
        };
      case "finalize_unexpected_outcome_1135":
        return { data: { outcome: "reticulating_splines" }, error: null };
      case "finalize_order_missing_1146":
        return { data: { outcome: "finalized" }, error: null };
      case "finalize_tickets_missing_1173":
        // An order EXISTS and no ticket rows do. This is the arm whose copy must
        // never say "nothing was reserved".
        return { data: { outcome: "finalized", orderId: ORDER_ID }, error: null };
      default:
        break;
    }
    this.tickets.push({
      id: TICKET_ID,
      order_id: ORDER_ID,
      ticket_type_id: TIER_ID,
      qr_code: "mgl_free_2337_qr",
      status: "valid",
      ticket_types: { name: "Free entry" },
    });
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
          qrPayload: "mgl_free_2337_qr",
          status: "valid",
        }],
      },
      error: null,
    };
  }
}

const makeDeps = (client: FakeDb): TicketCheckoutCreateDeps => ({
  userIdFromAuthHeader: () => Promise.resolve(null),
  serviceClient: () => client as never,
  paystackInitializeTransaction: (() => {
    throw new Error(
      "PROVIDER CALLED — a free reservation must never reach a payment provider",
    );
  }) as never,
});

const freeRequest = (arm: Arm): Request =>
  new Request("https://edge.test/ticket-checkout-create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventId: EVENT_ID,
      surface: "web",
      returnContract: "host_v1",
      buyer: {
        name: "Guest Person",
        email: "guest@issue2337.test",
        phone: "+15551234567",
      },
      lines: [{ ticketTypeId: TIER_ID, quantity: 1, expectedUnitPriceCents: 0 }],
      ...(arm === "intake_schema_stale_751"
        ? {
          intake_form_data: [{
            ticket_type_id: TIER_ID,
            // Stale on purpose: the organizer re-versioned the schema after the
            // guest opened the form.
            schema_version_id: "00000000-0000-4000-8000-0000000000ff",
            answers: { diet: "none" },
          }],
        }
        : {}),
    }),
  });

/**
 * The `FunctionsHttpError` shape `supabase.functions.invoke` throws: an opaque
 * message, and the REAL `Response` on `.context`. Built here rather than mocked
 * so `readEdgeRefusal` reads a real body exactly as it does in a browser.
 */
const asInvokeError = (
  response: Response,
): { message: string; context: Response } => ({
  message: "Edge Function returned a non-2xx status code",
  context: response,
});

interface ArmOutcome {
  status: number;
  token: string | null;
  detail: string | null;
  message: string;
}

/** Drive the real handler, then run the real client mapper over its answer. */
const runArm = async (arm: Arm): Promise<ArmOutcome> => {
  const db = new FakeDb(arm);
  const response = await createTicketCheckoutCreateHandler(makeDeps(db))(
    freeRequest(arm),
  );
  const status = response.status;
  const refusal = await readEdgeRefusal(asInvokeError(response.clone()));
  const thrown = Object.assign(
    new Error("Edge Function returned a non-2xx status code"),
    { status: refusal.status, code: refusal.code, detail: refusal.detail },
  );
  return {
    status,
    token: refusal.code,
    detail: refusal.detail,
    message: freeCheckoutErrorMessage(thrown),
  };
};

/**
 * EVERY reachable free-rail 409, the token the server actually emits on it, and
 * the sentence the guest actually reads. Derived by EXECUTION — `runArm` calls
 * the handler — not by reading `index.ts`.
 */
const ARMS: ReadonlyArray<
  { arm: Arm; token: string; expected: string }
> = [
  {
    arm: "intake_schema_stale_751",
    token: "intake_schema_stale",
    expected: FREE_CHECKOUT_INTAKE_STALE_MESSAGE,
  },
  {
    arm: "session_rpc_failed_819",
    token: "checkout_session_failed",
    expected: FREE_CHECKOUT_FAILED_MESSAGE,
  },
  {
    arm: "session_rpc_capacity_819",
    token: "checkout_session_failed",
    expected: FREE_CHECKOUT_SOLD_OUT_MESSAGE,
  },
  {
    arm: "free_reservation_already_exists_902",
    token: "free_reservation_already_exists",
    expected: FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE,
  },
  {
    arm: "replay_order_has_no_tickets_918",
    token: "checkout_unavailable",
    expected: FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
  },
  {
    arm: "status_token_persist_failed_1008",
    token: "checkout_session_failed",
    expected: FREE_CHECKOUT_FAILED_MESSAGE,
  },
  {
    arm: "session_not_authorized_1054",
    token: "checkout_unavailable",
    expected: FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
  },
  {
    arm: "finalize_rpc_errored_1079",
    token: "checkout_finalize_failed",
    expected: FREE_CHECKOUT_CONFLICT_MESSAGE,
  },
  {
    arm: "finalize_unavailable_1104",
    token: "checkout_unavailable",
    expected: FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
  },
  {
    arm: "finalize_reversal_pending_1120",
    token: "checkout_unavailable",
    expected: FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
  },
  {
    arm: "finalize_unexpected_outcome_1135",
    token: "checkout_finalize_failed",
    expected: FREE_CHECKOUT_CONFLICT_MESSAGE,
  },
  {
    arm: "finalize_order_missing_1146",
    token: "checkout_finalize_failed",
    expected: FREE_CHECKOUT_CONFLICT_MESSAGE,
  },
  {
    arm: "finalize_tickets_missing_1173",
    token: "checkout_finalize_failed",
    expected: FREE_CHECKOUT_CONFLICT_MESSAGE,
  },
];

for (const { arm, token, expected } of ARMS) {
  Deno.test(`#2337 arm ${arm}: server emits 409 '${token}' and the guest reads honest copy`, async () => {
    const outcome = await runArm(arm);
    assertEquals(outcome.status, 409, `${arm} did not produce a 409`);
    assertEquals(outcome.token, token, `${arm} emitted an unexpected token`);
    assertEquals(outcome.message, expected, `${arm} produced the wrong copy`);
    assert(
      FREE_CHECKOUT_MESSAGES.includes(outcome.message),
      `${arm} produced a string this module does not own: ${outcome.message}`,
    );
  });
}

Deno.test("#2337 the happy path is untouched — a free reservation still completes with its tickets", async () => {
  const db = new FakeDb("happy");
  const res = await createTicketCheckoutCreateHandler(makeDeps(db))(
    freeRequest("happy"),
  );
  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.kind, "free_completed");
  const tickets = body.tickets as Array<Record<string, unknown>>;
  assertEquals(tickets.length, 1);
  assertEquals(tickets[0].ticketId, TICKET_ID);
});

Deno.test("#2337 NO free-rail 409 claims the tickets are gone unless the DATABASE raised ticket_capacity_exceeded", async () => {
  // The founder's event: `is_unlimited: true`, `quantity_total: null`. The
  // create-session guard is `IF v_ticket_type.quantity_total IS NOT NULL AND …`
  // (latest definer 20270420002160_issue_2160_multiday_multiselect.sql), so an
  // unlimited tier cannot raise the exception, cannot produce the detail, and
  // therefore cannot produce the sold-out sentence — from ANY arm.
  for (const { arm } of ARMS) {
    const outcome = await runArm(arm);
    if (arm === "session_rpc_capacity_819") {
      assertEquals(outcome.detail, "ticket_capacity_exceeded");
      assertEquals(outcome.message, FREE_CHECKOUT_SOLD_OUT_MESSAGE);
      continue;
    }
    assertNotEquals(
      outcome.message,
      FREE_CHECKOUT_SOLD_OUT_MESSAGE,
      `${arm} told the guest there are no tickets left without the database ever saying so`,
    );
  }
});

Deno.test("#2337 the migration's capacity guard is skipped for an unlimited tier", async () => {
  // Read the LATEST definer of `biz_ticket_checkout_create_session`, not a
  // remembered one, so a re-emit that drops the NULL guard fails here.
  const sql = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270420002160_issue_2160_multiday_multiselect.sql",
      import.meta.url,
    ),
  );
  const guard = sql.slice(
    sql.indexOf("IF v_ticket_type.quantity_total IS NOT NULL"),
    sql.indexOf("RAISE EXCEPTION 'ticket_capacity_exceeded'"),
  );
  assert(
    guard.length > 0,
    "the capacity guard no longer tests quantity_total IS NOT NULL — an unlimited tier can now be called sold out",
  );
});

Deno.test("#2337 REVERT GUARD: the deleted status-keyed line disagrees with the shipped mapper on real arms", async () => {
  // The exact line #2337 removed:
  //     if (httpStatusOf(error) === 409) return FREE_CHECKOUT_UNAVAILABLE_MESSAGE;
  // Restoring it makes every arm below read "no longer available … Nothing was
  // reserved". Each entry here is a sentence the revert would resurrect.
  const collapsedByStatus = FREE_CHECKOUT_UNAVAILABLE_MESSAGE;
  const wouldRegress: string[] = [];
  for (const { arm, expected } of ARMS) {
    const outcome = await runArm(arm);
    assertEquals(outcome.status, 409);
    if (expected !== collapsedByStatus) wouldRegress.push(arm);
  }
  assert(
    wouldRegress.length >= 8,
    `the revert guard has gone slack — only ${wouldRegress.length} arms still distinguish themselves from the status-keyed answer`,
  );
  assert(
    wouldRegress.includes("free_reservation_already_exists_902"),
    "the arm the whole issue is about no longer disagrees with the status-keyed mapper",
  );
  assert(
    wouldRegress.includes("session_rpc_capacity_819"),
    "the genuinely-sold-out arm no longer disagrees with the status-keyed mapper",
  );
});
