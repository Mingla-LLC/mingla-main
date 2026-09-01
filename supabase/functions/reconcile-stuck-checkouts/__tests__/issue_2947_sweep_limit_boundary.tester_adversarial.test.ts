/**
 * issue #2947 slice 1 — TESTER ADVERSARIAL suite. Independent of, and
 * deliberately not overlapping with, `issue_2947_sweep_expiry_filter.test.ts`.
 *
 * WHAT THE IMPLEMENTOR'S SUITE ALREADY COVERS, and why this file exists.
 * T-1/T-2 prove EXCLUSION: with 6 expirable rows and 60–120 `'infinity'` holds,
 * no `'infinity'` row occupies a batch slot. In every one of those fixtures the
 * expirable population is 6 — far below `SWEEP_BATCH_LIMIT` — so the LIMIT is
 * never reached and its interaction with the predicate is never exercised. The
 * SPEC's slice-1 tester contract asks for the other half:
 *
 *     "assert SWEEP_BATCH_LIMIT bounds EXPIRABLE rows, not rows scanned —
 *      a filter on the wrong side of the limit passes the happy path and
 *      fails this."
 *
 * Bounding is a SATURATION property, not an exclusion property. It is only
 * observable when expirable rows are in SURPLUS of the limit. Every case below
 * therefore oversubscribes the batch and asserts on how the 50 slots are spent.
 *
 * THE FAKE IS BUILT INDEPENDENTLY, ON EXECUTED POSTGRES TRUTH. A fixture that
 * is wrong in the same direction as the code passes both, so the timestamp
 * semantics below were executed against production `gqnoajqerqhnvulmnyvv`
 * (read-only, no lock taken) rather than assumed:
 *
 *     'infinity'::timestamptz  < now()  =  false     to_json(...) = "infinity"
 *     '-infinity'::timestamptz < now()  =  true      to_json(...) = "-infinity"
 *     (NULL::timestamptz       < now()) IS NULL      -> row excluded
 *
 * That third row is why `matchesLt` returns false for null rather than
 * throwing: PostgREST drops a NULL on `lt`, it does not error.
 *
 * FAILS ON REVERT. Delete `.lt("expires_at", nowIso)` from index.ts — a true
 * line deletion, which is exactly `origin/main` @ b6ca942fb — and TA-1 and TA-2
 * go red with two DIFFERENT signatures (0 expired and 25 expired respectively),
 * which is what distinguishes a server-side predicate from a post-limit filter.
 * TA-3, TA-4 and TA-5 are characterisation cases and are green on both sides by
 * design; each says so at its own site.
 *
 * Run with:
 *   deno test --allow-net --allow-env --allow-read \
 *     supabase/functions/reconcile-stuck-checkouts/__tests__/issue_2947_sweep_limit_boundary.tester_adversarial.test.ts
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createReconcileStuckCheckoutsHandler,
  type ReconcileStuckCheckoutsDeps,
} from "../index.ts";

/**
 * `SWEEP_BATCH_LIMIT` is module-private in index.ts. Pinned here rather than
 * imported so that raising it in the function without revisiting these
 * assertions surfaces as a red test rather than a silently weakened bound.
 */
const BATCH_LIMIT = 50;

const MINUTE = 60_000;

interface Row {
  id: string;
  status: string;
  /** ISO-8601, or the literal `infinity` / `-infinity` sentinels. */
  expires_at: string | null;
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

// ── Postgres timestamptz semantics, executed above, not assumed ──────────────

function ts(raw: string): number {
  if (raw === "infinity") return Number.POSITIVE_INFINITY;
  if (raw === "-infinity") return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`fixture error: unrepresentable timestamptz ${raw}`);
  }
  return parsed;
}

/** `NULL < x` is NULL in Postgres, and PostgREST drops the row. */
function matchesLt(cell: unknown, bound: string): boolean {
  if (cell === null || cell === undefined) return false;
  return ts(String(cell)) < ts(bound);
}

type Filter =
  | { op: "in"; col: string; values: string[] }
  | { op: "lt"; col: string; value: string }
  | { op: "eq"; col: string; value: unknown }
  | { op: "is"; col: string };

function matches(row: Row, f: Filter): boolean {
  const cell = (row as unknown as Record<string, unknown>)[f.col];
  switch (f.op) {
    case "in":
      return f.values.includes(String(cell));
    case "lt":
      return matchesLt(cell, f.value);
    case "eq":
      return cell === f.value;
    case "is":
      return cell === null || cell === undefined;
  }
}

interface DbResult {
  data: unknown;
  error: { message: string } | null;
}

interface Recorder {
  /** Ids the batch SELECT returned, in the order the DB returned them. */
  batchIds: string[];
  /** Columns the batch SELECT projected — PostgREST returns ONLY these. */
  batchColumns: string[];
  stripeRetrieves: string[];
  expiredIds: string[];
  rpcCalls: string[];
}

class Select implements PromiseLike<DbResult> {
  private filters: Filter[] = [];
  private orderCol: string | null = null;
  private asc = true;
  private lim: number | null = null;

  constructor(
    private readonly rows: Row[],
    private readonly cols: string[],
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
  is(col: string, _value: null): this {
    this.filters.push({ op: "is", col });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderCol = col;
    this.asc = opts?.ascending ?? true;
    return this;
  }
  limit(n: number): this {
    this.lim = n;
    return this;
  }

  /** WHERE -> ORDER BY -> LIMIT, the order the database evaluates them in. */
  private run(): DbResult {
    let out = this.rows.filter((r) => this.filters.every((f) => matches(r, f)));
    if (this.orderCol !== null) {
      const col = this.orderCol;
      const dir = this.asc ? 1 : -1;
      out = [...out].sort((a, b) =>
        dir *
        (ts(String((a as unknown as Record<string, unknown>)[col])) -
          ts(String((b as unknown as Record<string, unknown>)[col])))
      );
    }
    if (this.lim !== null) out = out.slice(0, this.lim);
    this.rec.batchIds = out.map((r) => r.id);
    this.rec.batchColumns = [...this.cols];
    // PostgREST returns ONLY the projected columns. Returning the whole row
    // would hide a handler that reads a field it never asked the DB for.
    return {
      data: out.map((r) => {
        const projected: Record<string, unknown> = {};
        for (const c of this.cols) {
          projected[c] = (r as unknown as Record<string, unknown>)[c];
        }
        return projected;
      }),
      error: null,
    };
  }

  then<A, B = never>(
    onfulfilled?: ((v: DbResult) => A | PromiseLike<A>) | null,
    onrejected?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

class Update implements PromiseLike<DbResult> {
  private filters: Filter[] = [];
  private projecting = false;

  constructor(
    private readonly rows: Row[],
    private readonly patch: Record<string, unknown>,
    private readonly rec: Recorder,
  ) {}

  eq(col: string, value: unknown): this {
    this.filters.push({ op: "eq", col, value });
    return this;
  }
  is(col: string, _value: null): this {
    this.filters.push({ op: "is", col });
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
    const hit = this.rows.filter((r) =>
      this.filters.every((f) => matches(r, f))
    );
    for (const r of hit) Object.assign(r, this.patch);
    if (this.patch.status === "expired") {
      this.rec.expiredIds.push(...hit.map((r) => r.id));
    }
    return {
      data: this.projecting ? hit.map((r) => ({ id: r.id })) : null,
      error: null,
    };
  }

  then<A, B = never>(
    onfulfilled?: ((v: DbResult) => A | PromiseLike<A>) | null,
    onrejected?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

interface Harness {
  rows: Row[];
  rec: Recorder;
  deps: ReconcileStuckCheckoutsDeps;
}

function harness(
  rows: Row[],
  piStatuses: Record<string, string> = {},
): Harness {
  const rec: Recorder = {
    batchIds: [],
    batchColumns: [],
    stripeRetrieves: [],
    expiredIds: [],
    rpcCalls: [],
  };

  const db = {
    from(table: string) {
      if (table !== "ticket_checkout_sessions") {
        throw new Error(`fake db: table ${table} is not modelled`);
      }
      return {
        select: (cols: string) =>
          new Select(rows, cols.split(",").map((c) => c.trim()), rec),
        update: (patch: Record<string, unknown>) =>
          new Update(rows, patch, rec),
      };
    },
    rpc(name: string, _params: unknown): Promise<DbResult> {
      rec.rpcCalls.push(name);
      if (name === "issue_2079_verify_ticket_paid_identity") {
        return Promise.resolve({ data: { outcome: "verified" }, error: null });
      }
      if (name === "biz_ticket_checkout_finalize") {
        return Promise.resolve({
          data: { outcome: "ok", orderId: "order-adv-2947" },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    functions: {
      invoke(_n: string, _o: unknown): Promise<DbResult> {
        return Promise.resolve({
          data: null,
          error: { message: "dispatch offline in test" },
        });
      },
    },
  };

  /**
   * Any retrieve at all is recorded. An id absent from `piStatuses` throws:
   * that is how "the sweep must never send a `mingla_*` Paystack reference to
   * Stripe" is proven rather than asserted.
   */
  const stripe = {
    paymentIntents: {
      retrieve: (id: string) => {
        rec.stripeRetrieves.push(id);
        const status = piStatuses[id];
        if (status === undefined) {
          throw new Error(
            `fake stripe: unexpected PaymentIntent retrieve ${id}`,
          );
        }
        return Promise.resolve({
          id,
          status,
          payment_method_types: ["card"],
          latest_charge: `ch_${id}`,
        });
      },
    },
    checkout: {
      sessions: {
        retrieve: (id: string) => {
          rec.stripeRetrieves.push(id);
          throw new Error(`fake stripe: unexpected Checkout Session ${id}`);
        },
      },
    },
  };

  return {
    rows,
    rec,
    deps: {
      serviceClient: () =>
        db as unknown as ReturnType<
          ReconcileStuckCheckoutsDeps["serviceClient"]
        >,
      stripeClient: () =>
        stripe as unknown as ReturnType<
          ReconcileStuckCheckoutsDeps["stripeClient"]
        >,
      qrTokenPepper: () => "issue-2947-tester-adversarial-pepper-0123456789",
    },
  };
}

interface Summary {
  reconciled: number;
  expired: number;
  skipped: number;
  errors: number;
  results: Array<Record<string, unknown>>;
}

async function runSweep(h: Harness): Promise<Summary> {
  const response = await createReconcileStuckCheckoutsHandler(h.deps)(
    new Request("https://sweep.test/", {
      method: "POST",
      headers: { authorization: "Bearer service-role-under-test" },
    }),
  );
  assertEquals(response.status, 200);
  return await response.json() as Summary;
}

// ── Fixture builders ─────────────────────────────────────────────────────────

function row(over: Partial<Row> & { id: string }): Row {
  return {
    status: "pending_free",
    expires_at: new Date(Date.now() - 30 * MINUTE).toISOString(),
    created_at: new Date(Date.now() - 45 * MINUTE).toISOString(),
    order_id: null,
    stripe_payment_intent_id: null,
    stripe_checkout_session_id: null,
    stripe_account_id: null,
    brand_id: "brand-adv-2947",
    buyer_email: "buyer@usemingla.com",
    ...over,
  };
}

/** A queued waiting-room hold: held status, clock not started, oldest in a rush. */
function queued(n: number, ageMinutes: number): Row {
  return row({
    id: `queued-${String(n).padStart(4, "0")}`,
    status: n % 2 === 0 ? "pending_free" : "requires_payment",
    expires_at: "infinity",
    created_at: new Date(Date.now() - ageMinutes * MINUTE).toISOString(),
  });
}

/** An abandoned free hold: no payment ref, clock run out — classify() expires it. */
function expirable(n: number, ageMinutes: number): Row {
  return row({
    id: `expirable-${String(n).padStart(4, "0")}`,
    status: "pending_free",
    expires_at: new Date(Date.now() - (ageMinutes - 15) * MINUTE).toISOString(),
    created_at: new Date(Date.now() - ageMinutes * MINUTE).toISOString(),
  });
}

/**
 * A Paystack row exactly as production stores it: the `mingla_*` reference
 * lives in the `stripe_payment_intent_id` COLUMN (classify.ts:23-29), so it is
 * ref-class PAYSTACK, not STRIPE_PI.
 */
function paystack(n: number, ageMinutes: number): Row {
  return row({
    id: `paystack-${String(n).padStart(4, "0")}`,
    status: "awaiting_web_redirect",
    stripe_payment_intent_id: `mingla_paystack_${String(n).padStart(4, "0")}`,
    expires_at: new Date(Date.now() - (ageMinutes - 15) * MINUTE).toISOString(),
    created_at: new Date(Date.now() - ageMinutes * MINUTE).toISOString(),
  });
}

// ── TA-1 · the LIMIT must be spent, in full, on expirable rows ───────────────

Deno.test("#2947 TA-1 - SWEEP_BATCH_LIMIT bounds EXPIRABLE rows: 50 of 50 slots do real work when expirable rows are in surplus", async () => {
  // 200 queued holds, every one older than every expirable row — the ordering
  // that produced 50-of-50 starvation on production — plus 80 genuinely
  // expirable rows, i.e. 30 MORE than the batch can hold. The implementor's
  // T-1/T-2 never exceed 6 expirable rows, so the limit is never reached there
  // and "the limit bounds expirable rows" is never actually put under load.
  const queuedRows = Array.from({ length: 200 }, (_, i) => queued(i, 900 + i));
  const expirableRows = Array.from(
    { length: 80 },
    (_, i) => expirable(i, 300 - i),
  );

  const h = harness([...queuedRows, ...expirableRows]);
  const summary = await runSweep(h);

  // The bound: exactly SWEEP_BATCH_LIMIT slots, and every one of them actionable.
  assertEquals(
    h.rec.batchIds.length,
    BATCH_LIMIT,
    "the batch must fill to SWEEP_BATCH_LIMIT while expirable rows remain",
  );
  assertEquals(
    h.rec.batchIds.filter((id) => id.startsWith("queued-")).length,
    0,
    "not one slot may be spent on a row that can never expire",
  );
  assertEquals(
    summary.expired,
    BATCH_LIMIT,
    "a full batch of expirable rows must yield a full batch of expiries",
  );
  assertEquals(summary.errors, 0);
  assertEquals(summary.skipped, 0);

  // ORDERING SURVIVES THE FILTER. The 50 taken must be the 50 OLDEST expirable
  // rows — `expirable(i, 300 - i)` makes index 0 the oldest. This is what
  // separates WHERE -> ORDER BY -> LIMIT from a post-limit JS filter, which
  // could return an arbitrary subset and still look "all expirable".
  assertEquals(
    h.rec.batchIds,
    Array.from(
      { length: BATCH_LIMIT },
      (_, i) => `expirable-${String(i).padStart(4, "0")}`,
    ),
    "the batch must be the OLDEST expirable rows, in created_at order",
  );

  // The 30 expirable rows beyond the limit are deferred, not lost: still
  // in-flight, untouched, and first in line on the next tick.
  for (let i = BATCH_LIMIT; i < 80; i++) {
    const deferredRow = h.rows.find((r) =>
      r.id === `expirable-${String(i).padStart(4, "0")}`
    );
    assert(deferredRow !== undefined);
    assertEquals(
      deferredRow.status,
      "pending_free",
      `${deferredRow.id} must be deferred, not consumed`,
    );
  }

  // And every queued hold is still holding its stock at the sentinel.
  for (const r of h.rows.filter((x) => x.id.startsWith("queued-"))) {
    assertEquals(r.expires_at, "infinity");
  }
});

// ── TA-2 · interleaved by age — the post-limit-filter discriminator ──────────

Deno.test("#2947 TA-2 - a 1:1 age interleave still yields a full batch of expiries, never a diluted half-batch", async () => {
  // Strict alternation by created_at: queued, expirable, queued, expirable...
  // A filter applied AFTER the limit takes the 50 oldest rows (25 of each) and
  // then discards the queued half, yielding 25 expiries from a 50-row budget.
  // A filter applied BEFORE the limit yields 50. That numeric gap — 50 vs 25 —
  // is the discriminator, and no case in the implementor's suite produces it.
  const rows: Row[] = [];
  for (let i = 0; i < 100; i++) {
    rows.push(queued(i, 1000 - i * 2));
    rows.push(expirable(i, 999 - i * 2));
  }

  const h = harness(rows);
  const summary = await runSweep(h);

  assertEquals(h.rec.batchIds.length, BATCH_LIMIT);
  assertEquals(
    summary.expired,
    BATCH_LIMIT,
    "an age-interleaved population must not halve the run's useful throughput",
  );
  assertEquals(
    h.rec.batchIds.filter((id) => id.startsWith("queued-")).length,
    0,
  );
  assertEquals(
    h.rec.stripeRetrieves,
    [],
    "no Stripe budget on a free-rail batch",
  );
});

// ── TA-3 · the residual starvation surface the predicate does NOT close ──────

Deno.test("#2947 TA-3 - PINNED DEFECT: past-expiry PAYSTACK rows are unexpirable yet still occupy every slot", async () => {
  // classify() returns `skip: paystack_unverified` for a PAYSTACK ref
  // UNCONDITIONALLY — the expiry cutoff is never consulted (classify.ts:170-174).
  // Such a row is therefore permanently unactionable, yet `expires_at < now()`
  // is TRUE for it, so the shipped predicate admits it to the batch. It is the
  // same starvation shape `'infinity'` has, arriving through a different door.
  //
  // THIS IS NOT A REGRESSION — the row was in the batch before the fix too, and
  // this case is green on both sides of the revert. It is pinned because the
  // slice's own success criterion and its DRAFT invariant claim that the
  // predicate makes SWEEP_BATCH_LIMIT bound EXPIRABLE rows. It does not: it
  // bounds rows whose clock has run out, which is a strictly larger set.
  //
  // When that gap is closed (slice 4's per-arm split is the natural home), this
  // assertion goes red and must be updated DELIBERATELY. That is the point.
  const paystackRows = Array.from(
    { length: 60 },
    (_, i) => paystack(i, 900 + i),
  );
  const expirableRows = Array.from(
    { length: 6 },
    (_, i) => expirable(i, 300 - i),
  );

  const h = harness([...paystackRows, ...expirableRows]);
  const summary = await runSweep(h);

  assertEquals(h.rec.batchIds.length, BATCH_LIMIT);
  assertEquals(
    h.rec.batchIds.filter((id) => id.startsWith("paystack-")).length,
    BATCH_LIMIT,
    "all 50 slots go to rows classify() can never act on",
  );
  assertEquals(
    summary.expired,
    0,
    "and the 6 genuinely abandoned free holds are starved out of the batch",
  );
  assertEquals(summary.skipped, BATCH_LIMIT);
  assertEquals(summary.errors, 0);

  // The one thing that IS right here, and it matters: a `mingla_*` reference
  // must never be sent to Stripe. Zero retrieves.
  assertEquals(h.rec.stripeRetrieves, []);
});

// ── TA-4 · the REAL production quiet-path baseline ───────────────────────────

Deno.test("#2947 TA-4 - the true live in-flight population is 6 PAYSTACK rows, and the run summary matches production exactly", async () => {
  // Read from production on 2026-09-01 (read-only): the 6 in-flight rows are
  // all `awaiting_web_redirect`, all past expiry (created 2026-08-17..19), and
  // all carry a `mingla_*` PAYSTACK reference in `stripe_payment_intent_id` —
  // NOT a Stripe PaymentIntent. Every one of the 24 retained sweep responses in
  // `net._http_response` (08:45..14:30 UTC, across the deploy) reports
  // `{"reconciled":0,"expired":0,"skipped":6,"errors":0}` with `mingla_*` ids.
  //
  // Green on both sides of the revert, by design: these rows are past expiry,
  // so the predicate removes nothing for them and today's Mingla cannot notice
  // slice 1 shipped. That is the quiet-path property, asserted on the
  // population production actually has.
  const live = Array.from({ length: 6 }, (_, i) => paystack(i, 60 - i));
  const terminal = [
    row({ id: "done-free", status: "free_completed" }),
    row({ id: "done-paid", status: "paid_completed", order_id: "o-adv-1" }),
    row({ id: "already-expired", status: "expired" }),
  ];

  const h = harness([...live, ...terminal]);
  const summary = await runSweep(h);

  assertEquals(summary.reconciled, 0);
  assertEquals(summary.expired, 0);
  assertEquals(summary.skipped, 6);
  assertEquals(summary.errors, 0);
  assertEquals(
    summary.results.map((r) => r.skip),
    Array.from({ length: 6 }, () => "paystack_unverified"),
  );
  assertEquals(
    h.rec.stripeRetrieves,
    [],
    "a Paystack reference must never reach Stripe",
  );
  assertEquals(h.rec.rpcCalls, []);

  // Terminal rows were never in scope and must stay out of it.
  for (const r of terminal) assertEquals(r.failure_reason ?? null, null);

  // The batch SELECT projects exactly the columns the handler reads — a column
  // the handler consumes but never requested would surface as undefined here.
  assert(h.rec.batchColumns.includes("expires_at"));
  assert(h.rec.batchColumns.includes("stripe_payment_intent_id"));
  assert(h.rec.batchColumns.includes("status"));
});

// ── TA-5 · the mirror sentinel the predicate lets through ────────────────────

Deno.test("#2947 TA-5 - '-infinity' passes the predicate but can never be expired: the NaN fail-safe holds, the batch slot leaks", async () => {
  // Executed on production: `'-infinity'::timestamptz < now()` is TRUE and
  // `to_json` renders it as the string "-infinity". So the shipped predicate
  // ADMITS such a row. Then `Date.parse("-infinity")` is NaN and
  // classify.ts::isPastExpiry returns false on NaN, so the row is treated as
  // in-window and skipped — forever.
  //
  // Two halves, both pinned:
  //   1. the fail-safe is CORRECT — an unparseable expiry never expires a row;
  //   2. the exclusion is INCOMPLETE — the predicate screens `+infinity` but
  //      not its mirror, so the batch can still hold unactionable rows.
  // No production row carries '-infinity' today (verified: 0 rows), so this is
  // a latent surface, not a live defect. Green on both sides of the revert.
  assert(
    Number.isNaN(Date.parse("infinity")),
    "V8: Date.parse('infinity') is NaN",
  );
  assert(
    Number.isNaN(Date.parse("-infinity")),
    "V8: Date.parse('-infinity') is NaN",
  );

  const mirror = row({
    id: "neg-infinity-hold",
    status: "pending_free",
    expires_at: "-infinity",
    created_at: new Date(Date.now() - 5000 * MINUTE).toISOString(),
  });
  const genuine = expirable(0, 300);

  const h = harness([mirror, genuine]);
  const summary = await runSweep(h);

  // It IS admitted — the predicate does not screen it.
  assert(
    h.rec.batchIds.includes("neg-infinity-hold"),
    "'-infinity' < now() is true, so the predicate admits the row",
  );
  // ...and it is never expired, because isPastExpiry fails safe on NaN.
  assertEquals(h.rec.expiredIds, [genuine.id]);
  assertEquals(
    h.rows.find((r) => r.id === "neg-infinity-hold")?.status,
    "pending_free",
  );
  assertEquals(summary.expired, 1);
  assertEquals(summary.skipped, 1);
  assertEquals(summary.errors, 0);
  assertEquals(
    summary.results.find((r) => r.sessionId === "neg-infinity-hold")?.skip,
    "in_window",
  );

  // The `+infinity` sentinel, by contrast, is screened out of the batch
  // entirely — the asymmetry, stated side by side.
  const both = harness([
    row({
      id: "pos-infinity-hold",
      expires_at: "infinity",
      created_at: new Date(Date.now() - 5000 * MINUTE).toISOString(),
    }),
    row({
      id: "neg-infinity-hold-2",
      expires_at: "-infinity",
      created_at: new Date(Date.now() - 4999 * MINUTE).toISOString(),
    }),
  ]);
  await runSweep(both);
  assertEquals(both.rec.batchIds, ["neg-infinity-hold-2"]);
});
