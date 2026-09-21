/**
 * issue #2079 — TESTER ADVERSARIAL suite for the RECONCILE SWEEP's evidence-hold
 * leg (`releaseStripeEvidenceHolds` inside `reconcile-stuck-checkouts/index.ts`).
 *
 * WHY THIS ANGLE. The implementor's two suites
 * (`_shared/__tests__/issue_2079_evidence_hold_completes_sale.happy.test.ts` and
 * `...tester.adversarial.test.ts`) drive the STRIPE and PAYSTACK webhook routers
 * with fake routers, and cover the sweep only as a call-site/source assertion.
 * The sweep is the one caller that is NOT driven by a signed provider event: it
 * picks held sessions out of the database itself and decides, from its own
 * read-only Stripe reads, whether a paid ticket sale completes. It is therefore
 * the caller where a weak gate turns directly into "a sale completed without
 * real evidence of payment". Every case below drives the REAL
 * `createReconcileStuckCheckoutsHandler` and asserts a NEGATIVE: that
 * `release_ticket_checkout_evidence_hold` was never invoked, that no Stripe read
 * happened at all, or that the response contract did not move.
 *
 * WHAT IS BEING DEFENDED, in money terms. A released hold deletes the buyer's
 * refund rows and puts the session back in flight to be finalized into tickets.
 * If the sweep releases on evidence that does not prove capture — a
 * PaymentIntent that is not `succeeded`, a Checkout Session that resolves to a
 * DIFFERENT PaymentIntent (the exact #2079 hosted-relation bug class), a
 * succeeded PI carrying no charge id, a Paystack reference read as a Stripe one
 * — Mingla has cancelled a refund and issued a ticket for money it cannot prove
 * it holds. Fail-closed is the requirement; these tests are the proof.
 *
 * FAILS ON REVERT (true line deletion, not a comment-out), verified locally:
 *   - delete `if (csPi !== piId) { ...; continue; }` from
 *     `releaseStripeEvidenceHolds`  -> ADV-1 goes red.
 *   - delete `if (!chargeId || !amount) { ...; continue; }`               -> ADV-4 goes red.
 *   - delete `if (pi.status !== "succeeded") continue;`                   -> ADV-2 goes red.
 *   - delete `if (!piId || !piId.startsWith("pi_") || !accountId) continue;`
 *                                                                        -> ADV-3 goes red.
 *   - drop the conditional spread that hides the two new body keys       -> ADV-5 goes red.
 *
 * Run with:
 *   deno test --allow-env --allow-read \
 *     supabase/functions/reconcile-stuck-checkouts/__tests__/issue_2079_evidence_hold_sweep.tester.adversarial.test.ts
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createReconcileStuckCheckoutsHandler,
  type ReconcileStuckCheckoutsDeps,
} from "../index.ts";

const RELEASE_RPC = "release_ticket_checkout_evidence_hold";
const MINUTE = 60_000;

// ── Fixture table ────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  status: string;
  reversal_state: string;
  expires_at: string;
  created_at: string;
  order_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_account_id: string | null;
  brand_id: string | null;
  buyer_email: string | null;
  failed_at?: string | null;
  failure_reason?: string | null;
  updated_at?: string | null;
}

type Filter =
  | { op: "in"; col: string; values: string[] }
  | { op: "lt"; col: string; value: string }
  | { op: "eq"; col: string; value: unknown }
  | { op: "is"; col: string; value: null };

function tsValue(raw: string): number {
  if (raw === "infinity") return Number.POSITIVE_INFINITY;
  if (raw === "-infinity") return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) throw new Error(`fake db: bad timestamp ${raw}`);
  return parsed;
}

function matches(row: SessionRow, filter: Filter): boolean {
  const cell = (row as unknown as Record<string, unknown>)[filter.col];
  switch (filter.op) {
    case "in":
      return filter.values.includes(String(cell));
    case "lt":
      return tsValue(String(cell)) < tsValue(filter.value);
    case "eq":
      return cell === filter.value;
    case "is":
      return cell === null || cell === undefined;
  }
}

interface DbResult {
  data: unknown;
  error: { message: string } | null;
}

/** Every observable the assertions are allowed to be about. */
interface Recorder {
  /** `{ op:col }` of each SELECT on ticket_checkout_sessions, in order. */
  selectFilterOps: string[][];
  /** Ids each SELECT returned, in order — proves server-side limit placement. */
  selectIds: string[][];
  /** Stripe object ids retrieved this run (PI and Checkout Session both). */
  stripeRetrieves: string[];
  /** RPC names invoked, in order. */
  rpcCalls: string[];
  /** Arguments of every release RPC call, so slot placement is provable. */
  releaseArgs: Array<Record<string, unknown>>;
}

class SelectBuilder implements PromiseLike<DbResult> {
  private filters: Filter[] = [];
  private orderCol: string | null = null;
  private ascending = true;
  private limitN: number | null = null;

  constructor(
    private readonly rows: SessionRow[],
    private readonly rec: Recorder,
  ) {}

  in(col: string, values: string[]): this {
    this.filters.push({ op: "in", col, values });
    return this;
  }
  lt(col: string, value: string): this {
    this.filters.push({ op: "lt", col, value });
    return this;
  }
  eq(col: string, value: unknown): this {
    this.filters.push({ op: "eq", col, value });
    return this;
  }
  is(col: string, value: null): this {
    this.filters.push({ op: "is", col, value });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.ascending = opts?.ascending ?? true;
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  /** WHERE -> ORDER BY -> LIMIT, the PostgREST/SQL order. */
  private run(): DbResult {
    let out = this.rows.filter((row) =>
      this.filters.every((filter) => matches(row, filter))
    );
    if (this.orderCol !== null) {
      const col = this.orderCol;
      const dir = this.ascending ? 1 : -1;
      out = [...out].sort((a, b) =>
        dir *
        (tsValue(String((a as unknown as Record<string, unknown>)[col])) -
          tsValue(String((b as unknown as Record<string, unknown>)[col])))
      );
    }
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    this.rec.selectFilterOps.push(this.filters.map((f) => `${f.op}:${f.col}`));
    this.rec.selectIds.push(out.map((row) => row.id));
    return { data: out.map((row) => ({ ...row })), error: null };
  }

  then<A, B = never>(
    onfulfilled?: ((value: DbResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

class UpdateBuilder implements PromiseLike<DbResult> {
  private filters: Filter[] = [];
  private projecting = false;

  constructor(
    private readonly rows: SessionRow[],
    private readonly patch: Record<string, unknown>,
  ) {}

  eq(col: string, value: unknown): this {
    this.filters.push({ op: "eq", col, value });
    return this;
  }
  is(col: string, value: null): this {
    this.filters.push({ op: "is", col, value });
    return this;
  }
  lt(col: string, value: string): this {
    this.filters.push({ op: "lt", col, value });
    return this;
  }
  select(_cols: string): this {
    this.projecting = true;
    return this;
  }

  private run(): DbResult {
    const hit = this.rows.filter((row) =>
      this.filters.every((filter) => matches(row, filter))
    );
    for (const row of hit) Object.assign(row, this.patch);
    return {
      data: this.projecting ? hit.map((row) => ({ id: row.id })) : null,
      error: null,
    };
  }

  then<A, B = never>(
    onfulfilled?: ((value: DbResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

/** A PaymentIntent as the sweep will see it, keyed by PI id. */
interface PiFixture {
  status: string;
  latest_charge?: unknown;
  amount_received?: unknown;
  amount?: unknown;
  currency?: unknown;
}

interface Harness {
  rows: SessionRow[];
  rec: Recorder;
  deps: ReconcileStuckCheckoutsDeps;
}

function harness(
  rows: SessionRow[],
  pis: Record<string, PiFixture> = {},
  /** Checkout Session id -> the PaymentIntent Stripe says it belongs to. */
  checkoutSessions: Record<string, string | null> = {},
  /** Release-RPC answers by session id; a thrown string becomes an RPC error. */
  releaseAnswers: Record<string, unknown> = {},
): Harness {
  const rec: Recorder = {
    selectFilterOps: [],
    selectIds: [],
    stripeRetrieves: [],
    rpcCalls: [],
    releaseArgs: [],
  };

  const db = {
    from(table: string) {
      if (table !== "ticket_checkout_sessions") {
        throw new Error(`fake db: table ${table} is not modelled`);
      }
      return {
        select: (_cols: string) => new SelectBuilder(rows, rec),
        update: (patch: Record<string, unknown>) =>
          new UpdateBuilder(rows, patch),
      };
    },
    rpc(name: string, params: unknown): Promise<DbResult> {
      rec.rpcCalls.push(name);
      if (name === RELEASE_RPC) {
        const args = (params ?? {}) as Record<string, unknown>;
        rec.releaseArgs.push(args);
        const answer = releaseAnswers[String(args.p_checkout_session_id)];
        if (answer instanceof Error) {
          return Promise.resolve({
            data: null,
            error: { message: answer.message },
          });
        }
        return Promise.resolve({
          data: answer ?? { outcome: "not_held" },
          error: null,
        });
      }
      if (name === "issue_2079_verify_ticket_paid_identity") {
        return Promise.resolve({ data: { outcome: "verified" }, error: null });
      }
      if (name === "biz_ticket_checkout_finalize") {
        return Promise.resolve({
          data: { outcome: "ok", orderId: "order-2079-adv" },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    functions: {
      invoke(_name: string, _opts: unknown): Promise<DbResult> {
        return Promise.resolve({
          data: null,
          error: { message: "dispatch offline in test" },
        });
      },
    },
  };

  const stripe = {
    paymentIntents: {
      retrieve: (id: string) => {
        rec.stripeRetrieves.push(id);
        const pi = pis[id];
        if (pi === undefined) {
          throw new Error(`fake stripe: unexpected PaymentIntent retrieve ${id}`);
        }
        return Promise.resolve({ id, payment_method_types: ["card"], ...pi });
      },
    },
    checkout: {
      sessions: {
        retrieve: (id: string) => {
          rec.stripeRetrieves.push(id);
          if (!(id in checkoutSessions)) {
            throw new Error(`fake stripe: unexpected Checkout Session ${id}`);
          }
          return Promise.resolve({ id, payment_intent: checkoutSessions[id] });
        },
      },
    },
  };

  const deps: ReconcileStuckCheckoutsDeps = {
    serviceClient: () =>
      db as unknown as ReturnType<ReconcileStuckCheckoutsDeps["serviceClient"]>,
    stripeClient: () =>
      stripe as unknown as ReturnType<
        ReconcileStuckCheckoutsDeps["stripeClient"]
      >,
    qrTokenPepper: () => "issue-2079-tester-adversarial-pepper-0123456789",
  };

  return { rows, rec, deps };
}

interface SweepBody {
  reconciled: number;
  expired: number;
  skipped: number;
  errors: number;
  evidenceHoldsReleased?: number;
  evidenceHolds?: Array<Record<string, unknown>>;
  results: Array<Record<string, unknown>>;
}

async function runSweep(h: Harness): Promise<SweepBody> {
  const handler = createReconcileStuckCheckoutsHandler(h.deps);
  const response = await handler(
    new Request("https://sweep.test/", {
      method: "POST",
      headers: { authorization: "Bearer service-role-under-test" },
    }),
  );
  assertEquals(response.status, 200);
  return await response.json() as SweepBody;
}

/** A paid checkout held exactly the way #2079 describes: failed, paid reversal
 * pending, no order. Everything else is varied per case. */
function heldSession(over: Partial<SessionRow> & { id: string }): SessionRow {
  return {
    status: "failed",
    reversal_state: "paid_reversal_pending",
    expires_at: new Date(Date.now() - 90 * MINUTE).toISOString(),
    created_at: new Date(Date.now() - 120 * MINUTE).toISOString(),
    order_id: null,
    stripe_payment_intent_id: "pi_held_default",
    stripe_checkout_session_id: null,
    stripe_account_id: "acct_2079",
    brand_id: "brand-2079",
    buyer_email: "buyer@usemingla.com",
    failed_at: new Date(Date.now() - 90 * MINUTE).toISOString(),
    ...over,
  };
}

function releaseCalls(rec: Recorder): number {
  return rec.rpcCalls.filter((name) => name === RELEASE_RPC).length;
}

// ── ADV-1 ────────────────────────────────────────────────────────────────────
// The hosted-relation bug class, carried into the sweep. The session stores a
// Checkout Session id; Stripe says that Checkout Session belongs to a DIFFERENT
// PaymentIntent (or to none at all). The stored PI is then not proven to be this
// buyer's money, and the sale must not complete on it.
Deno.test(
  "#2079 SWEEP ADV-1 a Checkout Session that resolves to another PaymentIntent never releases the hold",
  async () => {
    for (
      const [label, csPi] of [
        ["a different PaymentIntent", "pi_someone_else"],
        ["no PaymentIntent at all", null],
      ] as Array<[string, string | null]>
    ) {
      const h = harness(
        [
          heldSession({
            id: "sess_relation",
            stripe_payment_intent_id: "pi_held_relation",
            stripe_checkout_session_id: "cs_held_relation",
          }),
        ],
        {
          // Deliberately fully releasable if the relation guard is gone.
          pi_held_relation: {
            status: "succeeded",
            latest_charge: "ch_held_relation",
            amount_received: 12_000,
            currency: "usd",
          },
        },
        { cs_held_relation: csPi },
        { sess_relation: { outcome: "released", refundsReleased: 1 } },
      );

      const body = await runSweep(h);

      assertEquals(
        releaseCalls(h.rec),
        0,
        `${label}: the release owner must never be asked`,
      );
      assert(
        !h.rec.stripeRetrieves.includes("pi_held_relation"),
        `${label}: the sweep must stop at the unproven relation, before reading the PI`,
      );
      assertEquals(body.evidenceHoldsReleased, 0);
      assertEquals(
        body.evidenceHolds?.[0]?.skip,
        "evidence_hold_relation_unproven",
      );
    }
  },
);

// ── ADV-2 ────────────────────────────────────────────────────────────────────
// Only `succeeded` is capture. Every other PaymentIntent status Stripe can
// report on a live checkout is money Mingla does not hold.
Deno.test(
  "#2079 SWEEP ADV-2 a PaymentIntent that is not succeeded never releases the hold",
  async () => {
    const notCaptured = [
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
      "processing",
      "requires_capture",
      "canceled",
    ];
    for (const status of notCaptured) {
      const h = harness(
        [
          heldSession({
            id: `sess_${status}`,
            stripe_payment_intent_id: `pi_${status}`,
          }),
        ],
        {
          [`pi_${status}`]: {
            status,
            latest_charge: `ch_${status}`,
            amount_received: 12_000,
            currency: "usd",
          },
        },
        {},
        { [`sess_${status}`]: { outcome: "released", refundsReleased: 1 } },
      );

      const body = await runSweep(h);

      assertEquals(
        releaseCalls(h.rec),
        0,
        `status=${status}: the release owner must never be asked`,
      );
      assertEquals(
        body.evidenceHoldsReleased ?? 0,
        0,
        `status=${status}: nothing may be reported released`,
      );
    }
  },
);

// ── ADV-3 ────────────────────────────────────────────────────────────────────
// A Paystack hold and an account-less hold are not Stripe holds. The sweep is
// the Stripe leg only; reading either against Stripe would at best 404 and at
// worst resolve a foreign object. No Stripe I/O, no release, for either.
Deno.test(
  "#2079 SWEEP ADV-3 a Paystack hold and an account-less hold cause no Stripe read and no release",
  async () => {
    const h = harness(
      [
        heldSession({
          id: "sess_paystack",
          // Paystack references live in the PI-id slot on this rail.
          stripe_payment_intent_id: "mingla_tk_01JABCDE",
          stripe_account_id: null,
        }),
        heldSession({
          id: "sess_no_account",
          stripe_payment_intent_id: "pi_no_account",
          stripe_account_id: null,
        }),
        heldSession({
          id: "sess_no_reference",
          stripe_payment_intent_id: null,
        }),
      ],
      // Any retrieve at all throws, because none is modelled.
      {},
      {},
      {},
    );

    const body = await runSweep(h);

    assertEquals(
      h.rec.stripeRetrieves.length,
      0,
      "no Stripe object may be read for a non-Stripe or account-less hold",
    );
    assertEquals(releaseCalls(h.rec), 0);
    assertEquals(
      body.evidenceHolds,
      undefined,
      "a run that acted on no hold must report the body it always reported",
    );
  },
);

// ── ADV-4 ────────────────────────────────────────────────────────────────────
// The original #2079 defect was a first signal MISSING a piece of evidence. The
// fix must not become "release anyway when the evidence is still missing": a
// succeeded PI with no charge id, or with an unusable amount or currency, is the
// same incomplete evidence that opened the hold in the first place.
Deno.test(
  "#2079 SWEEP ADV-4 incomplete evidence on a succeeded PaymentIntent never releases the hold",
  async () => {
    const incomplete: Array<[string, PiFixture]> = [
      ["no latest_charge", {
        status: "succeeded",
        latest_charge: null,
        amount_received: 12_000,
        currency: "usd",
      }],
      ["latest_charge is an object with no id", {
        status: "succeeded",
        latest_charge: { object: "charge" },
        amount_received: 12_000,
        currency: "usd",
      }],
      ["no amount of any kind", {
        status: "succeeded",
        latest_charge: "ch_ok",
        currency: "usd",
      }],
      ["amount is a string", {
        status: "succeeded",
        latest_charge: "ch_ok",
        amount_received: "12000",
        amount: "12000",
        currency: "usd",
      }],
      ["currency missing", {
        status: "succeeded",
        latest_charge: "ch_ok",
        amount_received: 12_000,
      }],
      ["currency is not a 3-letter code", {
        status: "succeeded",
        latest_charge: "ch_ok",
        amount_received: 12_000,
        currency: "dollars",
      }],
      ["amount is not a safe integer", {
        status: "succeeded",
        latest_charge: "ch_ok",
        amount_received: Number.MAX_SAFE_INTEGER + 2,
        currency: "usd",
      }],
    ];

    for (const [label, pi] of incomplete) {
      const h = harness(
        [heldSession({ id: "sess_incomplete", stripe_payment_intent_id: "pi_incomplete" })],
        { pi_incomplete: pi },
        {},
        { sess_incomplete: { outcome: "released", refundsReleased: 1 } },
      );

      const body = await runSweep(h);

      assertEquals(
        releaseCalls(h.rec),
        0,
        `${label}: the release owner must never be asked on incomplete evidence`,
      );
      assertEquals(body.evidenceHoldsReleased, 0, label);
      assertEquals(
        body.evidenceHolds?.[0]?.skip,
        "evidence_hold_evidence_incomplete",
        label,
      );
    }
  },
);

// ── ADV-5 ────────────────────────────────────────────────────────────────────
// The held-session lookup must be a SERVER-SIDE predicate, and it must be
// bounded. A JS-side filter applied after an unbounded read would still pass a
// naive happy path while reading — and, with a weaker gate, releasing — rows it
// was never meant to see. Assert placement and the cap together.
Deno.test(
  "#2079 SWEEP ADV-5 the held-session lookup is server-side, bounded, and touches no settled session",
  async () => {
    const rows: SessionRow[] = [];
    // 14 genuine holds: two more than the cap of 10.
    for (let i = 0; i < 14; i++) {
      rows.push(
        heldSession({
          id: `sess_hold_${i}`,
          stripe_payment_intent_id: `pi_hold_${i}`,
          created_at: new Date(Date.now() - (200 + i) * MINUTE).toISOString(),
        }),
      );
    }
    // Sessions that must never be looked at by the evidence-hold leg.
    rows.push(
      heldSession({
        id: "sess_already_ordered",
        order_id: "order-existing",
        stripe_payment_intent_id: "pi_already_ordered",
      }),
      heldSession({
        id: "sess_already_reversed",
        reversal_state: "paid_reversed",
        stripe_payment_intent_id: "pi_already_reversed",
      }),
      heldSession({
        id: "sess_not_failed",
        status: "paid_completed",
        stripe_payment_intent_id: "pi_not_failed",
      }),
    );

    const pis: Record<string, PiFixture> = {};
    for (let i = 0; i < 14; i++) {
      // Not succeeded, so nothing is released; this case is about WHICH rows
      // the sweep is allowed to reach at all.
      pis[`pi_hold_${i}`] = { status: "processing" };
    }

    const h = harness(rows, pis, {}, {});
    await runSweep(h);

    const holdLookup = h.rec.selectFilterOps[0] ?? [];
    assertEquals(
      holdLookup.sort(),
      ["eq:reversal_state", "eq:status", "is:order_id"].sort(),
      "the held-session predicate must be sent to Postgres, not applied in JS",
    );
    const examined = h.rec.selectIds[0] ?? [];
    assertEquals(
      examined.length,
      10,
      "the evidence-hold batch must be capped server-side",
    );
    for (const forbidden of [
      "sess_already_ordered",
      "sess_already_reversed",
      "sess_not_failed",
    ]) {
      assert(
        !examined.includes(forbidden),
        `${forbidden} is settled and must never enter the evidence-hold batch`,
      );
    }
    for (const forbidden of [
      "pi_already_ordered",
      "pi_already_reversed",
      "pi_not_failed",
    ]) {
      assert(
        !h.rec.stripeRetrieves.includes(forbidden),
        `${forbidden} must never be read from Stripe`,
      );
    }
  },
);

// ── ADV-6 ────────────────────────────────────────────────────────────────────
// A release that errors must never be read as a release, must not abort the run,
// and must not stop the ordinary sweep batch behind it from working. A money
// path that fails loudly on one row and silently skips the rest is worse than
// the bug it replaces.
Deno.test(
  "#2079 SWEEP ADV-6 a failing release is never counted as released and never aborts the run",
  async () => {
    const h = harness(
      [
        heldSession({
          id: "sess_rpc_error",
          stripe_payment_intent_id: "pi_rpc_error",
          created_at: new Date(Date.now() - 300 * MINUTE).toISOString(),
        }),
        heldSession({
          id: "sess_rpc_ok",
          stripe_payment_intent_id: "pi_rpc_ok",
          created_at: new Date(Date.now() - 200 * MINUTE).toISOString(),
        }),
      ],
      {
        pi_rpc_error: {
          status: "succeeded",
          latest_charge: "ch_rpc_error",
          amount_received: 9_900,
          currency: "usd",
        },
        pi_rpc_ok: {
          status: "succeeded",
          latest_charge: "ch_rpc_ok",
          amount_received: 9_900,
          currency: "usd",
        },
      },
      {},
      {
        sess_rpc_error: new Error("deadlock detected"),
        // An outcome the client does not model must degrade to "still held".
        sess_rpc_ok: { outcome: "something_new_from_the_future" },
      },
    );

    const body = await runSweep(h);

    assertEquals(releaseCalls(h.rec), 2, "both holds must still be attempted");
    assertEquals(
      body.evidenceHoldsReleased,
      0,
      "neither an error nor an unknown outcome may count as a release",
    );
    const errored = body.evidenceHolds?.find((r) => r.sessionId === "sess_rpc_error");
    assert(errored, "the failing hold must be reported, not swallowed");
    assert(
      typeof errored?.error === "string" &&
        errored.error.includes("deadlock detected"),
      "the underlying failure must reach the run record",
    );
    const unknown = body.evidenceHolds?.find((r) => r.sessionId === "sess_rpc_ok");
    assertEquals(
      unknown?.evidenceHold,
      "not_held",
      "an unrecognised answer must degrade to 'still held', never to 'released'",
    );
  },
);

// ── ADV-7 ────────────────────────────────────────────────────────────────────
// Slot discipline. The release owner takes eight arguments and re-proves
// identity from them; a value in the wrong slot is how #2079 started (a Paystack
// numeric id in the reference slot). The Stripe sweep leg must never populate
// the Paystack slot, must never put the charge id in the reference slot, and
// must pass the account the PI was actually read against.
Deno.test(
  "#2079 SWEEP ADV-7 the Stripe sweep fills each identity slot with its own value and never the Paystack one",
  async () => {
    const h = harness(
      [
        heldSession({
          id: "sess_slots",
          stripe_payment_intent_id: "pi_slots",
          stripe_account_id: "acct_slots",
        }),
      ],
      {
        pi_slots: {
          status: "succeeded",
          latest_charge: { id: "ch_slots" },
          amount_received: 7_500,
          amount: 9_999,
          currency: "gbp",
        },
      },
      {},
      { sess_slots: { outcome: "released", refundsReleased: 1 } },
    );

    const body = await runSweep(h);

    assertEquals(releaseCalls(h.rec), 1);
    const args = h.rec.releaseArgs[0];
    assertEquals(args.p_checkout_session_id, "sess_slots");
    assertEquals(args.p_provider, "stripe");
    assertEquals(args.p_payment_reference, "pi_slots");
    assertEquals(
      args.p_paystack_transaction_id,
      null,
      "a Stripe release must never carry a Paystack transaction id",
    );
    assertEquals(args.p_stripe_charge_id, "ch_slots");
    assertEquals(args.p_observed_account_reference, "acct_slots");
    assertEquals(
      args.p_amount_cents,
      7_500,
      "the amount that actually moved (amount_received) wins over the intended amount",
    );
    assertEquals(args.p_currency, "GBP");
    assertEquals(body.evidenceHoldsReleased, 1);
  },
);
