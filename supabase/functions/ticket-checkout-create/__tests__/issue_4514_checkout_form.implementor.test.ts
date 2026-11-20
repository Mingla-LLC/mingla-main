// MINGLA-INVARIANT: I-4514-CHECKOUT-FORM-BEFORE-PAYMENT | issue #4514 | with a required, live form on the page and the capability marker, ticket-checkout-create refuses missing or invalid answers before any checkout session, payment-provider object or free order exists; no marker completes the order as "to answer"; door sales are exempt.
/**
 * #4514 wave 5 — the brand form check in ticket-checkout-create
 * (BUILD CONTRACT v2 §3.6, C1, C8, C9).
 *
 * The decision itself is SQL (brand_form_checkout_check / _stash, proven by the
 * pg17 suite issue_4514_brand_forms.implementor.pg17.test.sql T-CHECKOUT). This
 * suite proves the edge wiring: WHERE the check runs (before the session and
 * every provider/free-finalize call), that the stash runs before the free
 * finalize, that a failed stash stops payment, that no marker means no check at
 * all, and that a door sale never carries the marker.
 *
 * Harness copied from issue_4238_free_order_ad_work_scheduled.implementor.test.ts.
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createTicketCheckoutCreateHandler,
  type TicketCheckoutCreateDeps,
} from "../index.ts";
import {
  brandFormRefusal,
  isCheckoutBrandFormRefusal,
  parseCheckoutBrandForm,
} from "../brandFormCheckout.ts";
import { resolveDoorPayCheckout } from "../doorPayCheckout.ts";

const EVENT_ID = "10000000-0000-4000-8000-00000000e136";
const TIER_ID = "20000000-0000-4000-8000-00000000e137";
const SESSION_ID = "30000000-0000-4000-8000-00000000e138";
const ORDER_ID = "40000000-0000-4000-8000-00000000e139";
const TICKET_ID = "50000000-0000-4000-8000-00000000e13a";
const FORM_ID = "45140000-0000-4000-8000-000000000f01";
const VERSION_ID = "45140000-0000-4000-8000-000000000f02";
const QUESTION_ID = "45140000-0000-4000-8000-000000000f03";

Deno.env.set(
  "app.qr_token_pepper",
  "issue-4514-regression-pepper-value-0123456789",
);

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
  /** The page's form, as brand_form_checkout_check reads it. */
  formMode: "none" | "required_step" | "optional_on_page" = "required_step";
  /** The off switch (BRAND_FORMS_KILL_SWITCH) as SQL reads it. */
  switchedOff = false;
  /** Makes the stash write fail (a database error, not a refusal). */
  stashFails = false;
  readonly stashed: Array<Record<string, unknown>> = [];

  /**
   * A model of brand_form_checkout_check / _stash (the SQL is proven by the
   * pg17 suite): required + marker + no answers refuses; answers for another
   * version are form_changed; "bad" answers are invalid.
   */
  private brandForm(
    name: string,
    args: Record<string, unknown>,
  ): DbResult & { error?: { message: string; details?: string } | null } {
    if (name === "brand_form_checkout_stash" && this.stashFails) {
      return { data: null, error: { message: "could not write" } };
    }
    if (this.switchedOff || this.formMode === "none") {
      return {
        data: { outcome: this.switchedOff ? "off" : "none" },
        error: null,
      };
    }
    const form = args.p_form as Record<string, unknown> | null;
    if (form === null) {
      if (this.formMode === "required_step") {
        return {
          data: null,
          error: {
            message: "form_answers_required",
            details: JSON.stringify({ formId: FORM_ID, versionId: VERSION_ID }),
          },
        };
      }
      return { data: { outcome: "none" }, error: null };
    }
    if (form.versionId !== VERSION_ID) {
      return {
        data: null,
        error: {
          message: "form_changed",
          details: JSON.stringify({ formId: FORM_ID, versionId: VERSION_ID }),
        },
      };
    }
    const answers = form.answers as Record<string, unknown>;
    if (answers[QUESTION_ID] === "bad") {
      return {
        data: null,
        error: {
          message: "form_answers_invalid",
          details: JSON.stringify([{
            questionId: QUESTION_ID,
            code: "required",
          }]),
        },
      };
    }
    if (name === "brand_form_checkout_stash") {
      this.stashed.push({ session: args.p_checkout_session_id, answers });
    }
    return { data: { outcome: "stash" }, error: null };
  }

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
      case "brand_form_checkout_check":
      case "brand_form_checkout_stash":
        return this.brandForm(name, _args);
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
      "PROVIDER CALLED — a free reservation never reaches a provider",
    );
  }) as never,
});

const freeRequest = (extra: Record<string, unknown> = {}): Request =>
  new Request("https://edge.test/ticket-checkout-create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventId: EVENT_ID,
      surface: "web",
      returnContract: "host_v1",
      buyer: {
        name: "Guest Person",
        email: "guest@issue4514.test",
        phone: "+15551234567",
      },
      lines: [{
        ticketTypeId: TIER_ID,
        quantity: 1,
        expectedUnitPriceCents: 0,
      }],
      ...extra,
    }),
  });

const ANSWERS = {
  formId: FORM_ID,
  versionId: VERSION_ID,
  answers: { [QUESTION_ID]: "Vegetarian" },
};

async function run(db: FakeCheckoutDb, extra: Record<string, unknown>) {
  const g = globalThis as unknown as {
    EdgeRuntime?: { waitUntil: (w: Promise<unknown>) => void };
  };
  const held: Promise<unknown>[] = [];
  g.EdgeRuntime = { waitUntil: (w) => held.push(w) };
  try {
    const res = await createTicketCheckoutCreateHandler(makeDeps(db))(
      freeRequest(extra),
    );
    const body = await res.json() as Record<string, unknown>;
    await Promise.all(held);
    return { status: res.status, body };
  } finally {
    delete g.EdgeRuntime;
  }
}

const has = (db: FakeCheckoutDb, op: string) => db.operations.includes(op);

Deno.test("#4514 W5 required form + marker + no answers: refused before any session or free order", async () => {
  const db = new FakeCheckoutDb();
  const { status, body } = await run(db, { brandFormStep: 1 });
  assertEquals(status, 422);
  assertEquals(body.error, "form_answers_required");
  assertEquals(body.versionId, VERSION_ID);
  assert(has(db, "rpc:brand_form_checkout_check"));
  assert(
    !has(db, "rpc:biz_ticket_checkout_create_session"),
    "a session was created",
  );
  assert(
    !has(db, "rpc:biz_ticket_checkout_finalize"),
    "a free order was finalized",
  );
  assertEquals(db.orders.length, 0);
  assertEquals(db.stashed.length, 0);
});

Deno.test("#4514 W5 invalid answers and a stale version are refused before any session", async () => {
  for (
    const [form, code, status] of [
      [
        { ...ANSWERS, answers: { [QUESTION_ID]: "bad" } },
        "form_answers_invalid",
        422,
      ],
      [
        { ...ANSWERS, versionId: "45140000-0000-4000-8000-000000000fff" },
        "form_changed",
        409,
      ],
    ] as const
  ) {
    const db = new FakeCheckoutDb();
    const res = await run(db, { brandFormStep: 1, brandForm: form });
    assertEquals(res.status, status);
    assertEquals(res.body.error, code);
    assert(!has(db, "rpc:biz_ticket_checkout_create_session"));
    assertEquals(db.orders.length, 0);
  }
});

Deno.test("#4514 W5 valid answers are stashed against the session BEFORE the free finalize", async () => {
  const db = new FakeCheckoutDb();
  const { status, body } = await run(db, {
    brandFormStep: 1,
    brandForm: ANSWERS,
  });
  assertEquals(status, 200);
  assertEquals(body.kind, "free_completed");
  assertEquals(db.stashed, [{ session: SESSION_ID, answers: ANSWERS.answers }]);
  const check = db.operations.indexOf("rpc:brand_form_checkout_check");
  const session = db.operations.indexOf(
    "rpc:biz_ticket_checkout_create_session",
  );
  const stash = db.operations.indexOf("rpc:brand_form_checkout_stash");
  const finalize = db.operations.indexOf("rpc:biz_ticket_checkout_finalize");
  assert(
    check >= 0 && check < session,
    "the check must run before the session",
  );
  assert(
    session < stash && stash < finalize,
    "the stash must sit between the session and the finalize",
  );
});

Deno.test("#4514 W5 a failed stash answers 409 and no order is finalized", async () => {
  const db = new FakeCheckoutDb();
  db.stashFails = true;
  const { status, body } = await run(db, {
    brandFormStep: 1,
    brandForm: ANSWERS,
  });
  assertEquals(status, 409);
  assertEquals(body.error, "brand_form_stash_failed");
  assert(!has(db, "rpc:biz_ticket_checkout_finalize"));
  assertEquals(db.orders.length, 0);
});

Deno.test("#4514 W5 no marker (an older client): the order completes as to-answer with no form call", async () => {
  const db = new FakeCheckoutDb();
  const { status, body } = await run(db, {});
  assertEquals(status, 200);
  assertEquals(body.kind, "free_completed");
  assert(!db.operations.some((op) => op.startsWith("rpc:brand_form_")));
  assertEquals(db.stashed.length, 0);
});

Deno.test("#4514 W5 the off switch: a required form stops blocking", async () => {
  const db = new FakeCheckoutDb();
  db.switchedOff = true;
  const { status, body } = await run(db, { brandFormStep: 1 });
  assertEquals(status, 200);
  assertEquals(body.kind, "free_completed");
  assertEquals(db.stashed.length, 0);
});

Deno.test("#4514 W5 an optional form with no answers never blocks", async () => {
  const db = new FakeCheckoutDb();
  db.formMode = "optional_on_page";
  const { status } = await run(db, { brandFormStep: 1 });
  assertEquals(status, 200);
});

Deno.test("#4514 W5 malformed brand form fields are a 400, never ignored", () => {
  for (
    const body of [
      { brandFormStep: 2 },
      { brandFormStep: 1, brandForm: "x" },
      {
        brandFormStep: 1,
        brandForm: { formId: "nope", versionId: VERSION_ID, answers: {} },
      },
      { brandFormStep: 1, brandForm: { ...ANSWERS, answers: [] } },
    ]
  ) {
    const parsed = parseCheckoutBrandForm(body);
    assert(isCheckoutBrandFormRefusal(parsed));
    if (isCheckoutBrandFormRefusal(parsed)) assertEquals(parsed.status, 400);
  }
  const nested = parseCheckoutBrandForm({
    brandFormStep: 1,
    brandForm: { ...ANSWERS, answers: { [QUESTION_ID]: { deep: 1 } } },
  });
  assert(isCheckoutBrandFormRefusal(nested));
  if (isCheckoutBrandFormRefusal(nested)) assertEquals(nested.status, 422);
  assertEquals(brandFormRefusal({ message: "boom" }), null);
});

Deno.test("#4514 W5 door sales are exempt (C9): the rebuilt door body never carries the marker", async () => {
  const CODE_ID = "42710000-0000-4000-8000-0000000000c4";
  const row = {
    id: CODE_ID,
    code: "ABCD2345",
    event_id: EVENT_ID,
    event_date_id: null,
    lines: [{ ticketTypeId: TIER_ID, quantity: 1 }],
    status: "opened",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    total_cents: 3135,
  };
  const fake = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: row, error: null }),
        }),
      }),
    }),
  };
  const resolved = await resolveDoorPayCheckout(fake, {
    doorCode: "ABCD2345",
    eventId: EVENT_ID,
    brandFormStep: 1,
    brandForm: ANSWERS,
    buyer: { name: "G", email: "g@example.test", phone: "+12025550101" },
    purchaseTermsAccepted: true,
  });
  assert(resolved.ok);
  if (!resolved.ok) return;
  const parsed = parseCheckoutBrandForm(resolved.body);
  assert(!isCheckoutBrandFormRefusal(parsed));
  if (!isCheckoutBrandFormRefusal(parsed)) {
    assertEquals(parsed.capable, false);
    assertEquals(parsed.form, null);
  }
  // And both form calls in the handler are skipped for a door sale by name.
  const src = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
  assertEquals(
    src.split("if (doorPay === null && parsedBrandForm.capable) {").length - 1,
    2,
    "the check and the stash must both skip door pay",
  );
});
