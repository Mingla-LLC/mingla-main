/**
 * issue #2216 [ticket QR renders as a blank white square] — the free-reservation arm.
 *
 * WHAT A PERSON SAW. A guest reserved a free ticket, landed on the
 * confirmation screen, and the pass showed a blank white square. The chrome
 * around it ("Ticket 2 of 4 — Free Entry", the dots, "Swipe to see next
 * ticket") was correct, so the carousel mounted; only the image was missing.
 *
 * WHAT WAS ACTUALLY WRONG — established from PRODUCTION, not from reading
 * source. For the reported free order (`2115cb0f-…`, 4 tickets, all
 * `qr_code` non-null length 122, status `valid`), `function_edge_logs` shows
 * exactly one call: `POST /ticket-checkout-create → 200`, with a response of
 * **988 bytes**. Four rendered 400x400 QR PNGs are ~5.4 KB EACH — a response
 * carrying them could not be under 21 KB. `ticket-checkout-confirm` and
 * `ticket-checkout-status` were never called for that order at all. The
 * generator was fine (proved separately by running the deployed helper inside
 * `supabase/edge-runtime:v1.74.3`); the free arm simply never asked it for an
 * image.
 *
 * ORCH-0932 moved QR rendering server-side and wired it into the only two
 * producers of confirm-screen tickets that existed then (`-confirm`,
 * `-status`). #2136 later made THIS function a third producer — the
 * `free_completed` envelope — and it shipped `qrPayload` with no rendered
 * image. `TicketQrCarousel` renders a plain white `<View>` when
 * `imageDataUrl` is absent, which is the blank square, on every free
 * reservation, on all three checkout verticals.
 *
 * WHAT THIS SUITE PINS. Every arm that can answer a guest `kind:
 * "free_completed"` carries a real, distinct, renderable PNG per ticket:
 *   - the fresh-mint arm (tickets come from the finalize envelope)
 *   - the idempotent-replay arm (tickets are read back from `tickets` rows)
 *   - `readIssuedTicketsForOrder` directly, which is the single funnel both use
 *
 * FAILS ON REVERT: drop the `attachQrImageDataUrls` call in
 * `readIssuedTicketsForOrder` and `qrImageDataUrl` is `undefined` on every
 * ticket in every case below.
 *
 * Network: the QR generator imports the qrcode bundle from esm.sh, exactly as
 * the deployed function does. Run with --allow-net --allow-read --allow-env.
 */
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketCheckoutCreateHandler,
  readIssuedTicketsForOrder,
  type TicketCheckoutCreateDeps,
} from "../index.ts";

const EVENT_ID = "10000000-0000-4000-8000-000000002216";
const TIER_ID = "20000000-0000-4000-8000-000000002216";
const SESSION_ID = "30000000-0000-4000-8000-000000002216";
const ORDER_ID = "40000000-0000-4000-8000-000000002216";
const TICKET_1 = "50000000-0000-4000-8000-000000002216";
const TICKET_2 = "60000000-0000-4000-8000-000000002216";

const PNG_PREFIX = "data:image/png;base64,";

/**
 * Production-shaped `tickets.qr_code`. The reported order's payloads are 122
 * chars — a fixture shorter than that would render a smaller QR and would not
 * exercise the size the door actually scans.
 */
function qrCodeFor(ticketId: string, seed: string): string {
  const sig = seed.repeat(64).slice(0, 64);
  const value = `mingla:v1:ticket:${ticketId}:sig:${sig}`;
  if (value.length !== 122) {
    throw new Error(`fixture qr_code must be 122 chars, got ${value.length}`);
  }
  return value;
}

const QR_1 = qrCodeFor(TICKET_1, "1a");
const QR_2 = qrCodeFor(TICKET_2, "2b");

// `qrTokenPepper()` rejects anything under 32 chars; without it the free arm
// answers 500 and every assertion below would be vacuous.
Deno.env.set(
  "app.qr_token_pepper",
  "issue-2216-regression-pepper-value-0123456789",
);

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
 * Mirrors the post-#2136 database: the finalize wrapper mints state only on
 * its `finalized` arm, and its idempotent-replay arm answers `{outcome,
 * orderId}` with NO tickets — which is why the read-back path exists and why
 * it must be covered here too.
 */
class FakeCheckoutDb {
  /** true => finalize answers WITHOUT tickets, forcing the read-back path. */
  replayArm = false;
  readonly tickets: TicketRow[] = [];

  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }

  // deno-lint-ignore require-await
  async rpc(name: string, _args: Record<string, unknown>): Promise<DbResult> {
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
    this.tickets.push(
      {
        id: TICKET_1,
        order_id: ORDER_ID,
        ticket_type_id: TIER_ID,
        qr_code: QR_1,
        status: "valid",
        ticket_types: { name: "Free Entry" },
      },
      {
        id: TICKET_2,
        order_id: ORDER_ID,
        ticket_type_id: TIER_ID,
        qr_code: QR_2,
        status: "valid",
        ticket_types: { name: "Free Entry" },
      },
    );
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
      tickets: [
        {
          ticketId: TICKET_1,
          ticketTypeId: TIER_ID,
          ticketName: "Free Entry",
          qrPayload: QR_1,
          status: "valid",
        },
        {
          ticketId: TICKET_2,
          ticketTypeId: TIER_ID,
          ticketName: "Free Entry",
          qrPayload: QR_2,
          status: "valid",
        },
      ],
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
        email: "guest@issue2216.test",
        phone: "+15551234567",
      },
      lines: [{
        ticketTypeId: TIER_ID,
        quantity: 2,
        expectedUnitPriceCents: 0,
      }],
    }),
  });

/** The assertion the reported bug fails: a pass a guest can actually show. */
function assertRenderablePass(
  ticket: Record<string, unknown>,
  label: string,
): string {
  const uri = ticket.qrImageDataUrl;
  assert(
    typeof uri === "string",
    `${label}: qrImageDataUrl is ${typeof uri} — the confirmation carousel renders a blank white square for this ticket (issue #2216)`,
  );
  assert(
    (uri as string).startsWith(PNG_PREFIX),
    `${label}: qrImageDataUrl is not a PNG data URI (got "${
      (uri as string).slice(0, 40)
    }")`,
  );
  assert(
    (uri as string).length - PNG_PREFIX.length > 1000,
    `${label}: image body is only ${
      (uri as string).length - PNG_PREFIX.length
    } chars — not a real 400x400 QR`,
  );
  return uri as string;
}

Deno.test(
  "#2216 FRESH-MINT ARM — a free_completed response carries a renderable QR image per ticket",
  async () => {
    const db = new FakeCheckoutDb();
    const res = await createTicketCheckoutCreateHandler(makeDeps(db))(
      freeRequest(),
    );

    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.kind, "free_completed");

    const tickets = body.tickets as Array<Record<string, unknown>>;
    assert(
      Array.isArray(tickets),
      "free_completed envelope carried no tickets",
    );
    assertEquals(tickets.length, 2);

    // The payload the door scans is still there, untouched by this change.
    assertEquals(tickets[0].qrPayload, QR_1);
    assertEquals(tickets[1].qrPayload, QR_2);

    const a = assertRenderablePass(tickets[0], "ticket 1 of 2");
    const b = assertRenderablePass(tickets[1], "ticket 2 of 2");
    assertNotEquals(
      a,
      b,
      "two seats must carry two DIFFERENT images — one shared code means the second guest is turned away",
    );
  },
);

Deno.test(
  "#2216 IDEMPOTENT-REPLAY ARM — a re-tapped free reservation carries the images too",
  async () => {
    // The finalize wrapper's `order_id IS NOT NULL` arm answers with no
    // tickets, so this response is assembled from the canonical `tickets`
    // rows. That read-back path is a second producer and would otherwise be a
    // second place to forget the image.
    const db = new FakeCheckoutDb();
    db.replayArm = true;

    const res = await createTicketCheckoutCreateHandler(makeDeps(db))(
      freeRequest(),
    );

    assertEquals(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.kind, "free_completed");

    const tickets = body.tickets as Array<Record<string, unknown>>;
    assertEquals(tickets.length, 2);
    const a = assertRenderablePass(tickets[0], "replay ticket 1 of 2");
    const b = assertRenderablePass(tickets[1], "replay ticket 2 of 2");
    assertNotEquals(a, b);
  },
);

Deno.test(
  "#2216 SINGLE FUNNEL — readIssuedTicketsForOrder attaches images on BOTH of its inputs",
  async () => {
    // Attaching inside the funnel rather than at the two response sites is what
    // makes a future third caller correct by construction. Both inputs are
    // exercised: the finalize envelope, and the `tickets` read-back.
    const db = new FakeCheckoutDb();
    db.tickets.push({
      id: TICKET_1,
      order_id: ORDER_ID,
      ticket_type_id: TIER_ID,
      qr_code: QR_1,
      status: "valid",
      ticket_types: { name: "Free Entry" },
    });

    const fromReadBack = await readIssuedTicketsForOrder(db, ORDER_ID, null);
    assertEquals(fromReadBack.length, 1);
    assertRenderablePass(
      fromReadBack[0] as unknown as Record<string, unknown>,
      "read-back",
    );
    assertEquals(fromReadBack[0].qrPayload, QR_1);

    const fromEnvelope = await readIssuedTicketsForOrder(db, ORDER_ID, [
      {
        ticketId: TICKET_2,
        ticketTypeId: TIER_ID,
        ticketName: "Free Entry",
        qrPayload: QR_2,
        status: "valid",
      },
    ]);
    assertEquals(fromEnvelope.length, 1);
    assertRenderablePass(
      fromEnvelope[0] as unknown as Record<string, unknown>,
      "envelope",
    );
    assertEquals(fromEnvelope[0].qrPayload, QR_2);
  },
);

Deno.test(
  "#2216 SIZE WITNESS — the free_completed body is far too large to be the 988-byte production response",
  async () => {
    // The production forensic in one assertion. The reported blank-pass order
    // came back in 988 bytes for FOUR tickets; a body carrying real 400x400
    // PNGs cannot be that small. This is what would go red on a silent revert
    // even if someone weakened the per-ticket assertions above.
    const db = new FakeCheckoutDb();
    const res = await createTicketCheckoutCreateHandler(makeDeps(db))(
      freeRequest(),
    );
    const raw = await res.text();
    assert(
      raw.length > 10_000,
      `free_completed body is ${raw.length} bytes for 2 tickets — the pre-fix production response for 4 tickets was 988 bytes, i.e. no images`,
    );
  },
);
