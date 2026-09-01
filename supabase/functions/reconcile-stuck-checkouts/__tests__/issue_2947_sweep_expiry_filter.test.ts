/**
 * issue #2947 slice 1 — the sweep's batch SELECT must only contain rows a run
 * can act on. IMPLEMENTOR happy path + the two obligations that ride with it.
 *
 * THE DEFECT. `reconcile-stuck-checkouts` chose its batch by AGE alone:
 *
 *     .in("status", [...4 in-flight statuses...])
 *     .order("created_at", { ascending: true })
 *     .limit(SWEEP_BATCH_LIMIT)          // 50
 *
 * The expiry cutoff was applied twice DOWNSTREAM — in `classify()` and again in
 * the expiry compare-and-swap — but never on the batch itself. Harmless while
 * every in-flight row was also past expiry (the live population, 6 rows, is).
 * The ticket waiting room breaks that: a queued buyer holds stock at
 * `expires_at = 'infinity'::timestamptz`, which is permanently in-flight AND
 * permanently the oldest row in a rush. Measured on production (rolled back)
 * with 60 queued rows present: 50 of 50 batch slots held rows that can never
 * expire and all 6 genuinely-expired rows were starved out of every batch,
 * forever. No abandoned hold is released, so stock never returns to the queue
 * and the waiting room deadlocks itself.
 *
 * WHY THIS FILE DRIVES THE REAL HANDLER. Which rows a batch contains is a
 * BEHAVIOUR. A source-grep test proves `.lt(` was typed; it cannot tell a
 * server-side predicate from a JS `.filter()` applied AFTER the limit — and the
 * post-limit version passes a naive happy path while still starving the sweep.
 * So every case below builds a fixture table, hands the REAL
 * `createReconcileStuckCheckoutsHandler` a fake PostgREST client that applies
 * filters -> order -> limit in that order (Postgres semantics, including
 * `'infinity' < now()` = false), runs the sweep, and asserts on the rows the
 * handler actually touched. Nothing in the chain is a stand-in for the sweep.
 *
 * FAILS ON REVERT. Delete the `.lt("expires_at", nowIso)` line from index.ts —
 * a true line deletion, which is exactly `origin/main` @ b6ca942fb — and
 * `#2947 T-1` and `#2947 T-2` go red (0 of 6 expiries recovered, 50 of 50 slots
 * spent on unexpirable rows). `#2947 T-5`, the quiet-path parity case, stays
 * GREEN on that same revert: that is the point of it. The fix must change
 * nothing for the population Mingla actually has today.
 *
 * Run with:
 *   deno test --allow-net --allow-env --allow-read \
 *     supabase/functions/reconcile-stuck-checkouts/__tests__/issue_2947_sweep_expiry_filter.test.ts
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createReconcileStuckCheckoutsHandler,
  type ReconcileStuckCheckoutsDeps,
} from "../index.ts";

// ── The fixture table ────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  status: string;
  /** ISO-8601, or the literal `infinity` — the queued-hold sentinel. */
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

const IN_FLIGHT = [
  "processing_payment",
  "awaiting_web_redirect",
  "requires_payment",
  "pending_free",
];

/**
 * Postgres `timestamptz` ordering, which is NOT string ordering: `'infinity'`
 * is greater than every finite timestamp, so `'infinity' < now()` is false for
 * any now, forever. That single fact is what makes the shipped predicate
 * exclude a queued hold structurally rather than by convention.
 */
function tsValue(raw: string): number {
  if (raw === "infinity") return Number.POSITIVE_INFINITY;
  if (raw === "-infinity") return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`fake db: unparseable timestamp ${raw}`);
  }
  return parsed;
}

type Filter =
  | { op: "in"; col: string; values: string[] }
  | { op: "lt"; col: string; value: string }
  | { op: "eq"; col: string; value: unknown }
  | { op: "is"; col: string; value: null };

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

/** What the run did, recorded so the assertions can be about behaviour. */
interface Recorder {
  /** Ids the batch SELECT actually returned, in order. */
  batchIds: string[];
  /** Filters the batch SELECT carried, so placement is provable. */
  batchFilterOps: string[];
  /** Every Stripe object id retrieved this run. */
  stripeRetrieves: string[];
  /** Ids the expiry compare-and-swap successfully stamped. */
  expiredIds: string[];
  /** RPC names invoked, in order. */
  rpcCalls: string[];
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

  /**
   * PostgREST/SQL evaluation order — WHERE, then ORDER BY, then LIMIT. A fix
   * written as a post-limit JS filter would be visible here as a 50-row batch
   * of unexpirable rows, which is precisely what T-2 asserts against.
   */
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
    this.rec.batchIds = out.map((row) => row.id);
    this.rec.batchFilterOps = this.filters.map((f) => `${f.op}:${f.col}`);
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
    private readonly rec: Recorder,
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
    if (this.patch.status === "expired") {
      this.rec.expiredIds.push(...hit.map((row) => row.id));
    }
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

interface Harness {
  rows: SessionRow[];
  rec: Recorder;
  deps: ReconcileStuckCheckoutsDeps;
}

/**
 * `piStatuses` maps a PaymentIntent id to the status Stripe reports for it.
 * An id absent from the map is a retrieve the sweep should never have made,
 * and throwing on it is how T-4 proves no Stripe I/O happened at all.
 */
function harness(
  rows: SessionRow[],
  piStatuses: Record<string, string> = {},
): Harness {
  const rec: Recorder = {
    batchIds: [],
    batchFilterOps: [],
    stripeRetrieves: [],
    expiredIds: [],
    rpcCalls: [],
  };

  const db = {
    from(table: string) {
      if (table !== "ticket_checkout_sessions") {
        // Everything else the sweep can reach (the fail-open ad-conversion
        // hook) is meant to be inert here. Throwing keeps the test offline.
        throw new Error(`fake db: table ${table} is not modelled`);
      }
      return {
        select: (_cols: string) => new SelectBuilder(rows, rec),
        update: (patch: Record<string, unknown>) =>
          new UpdateBuilder(rows, patch, rec),
      };
    },
    rpc(name: string, _params: unknown): Promise<DbResult> {
      rec.rpcCalls.push(name);
      if (name === "issue_2079_verify_ticket_paid_identity") {
        return Promise.resolve({ data: { outcome: "verified" }, error: null });
      }
      if (name === "biz_ticket_checkout_finalize") {
        return Promise.resolve({
          data: { outcome: "ok", orderId: "order-2947" },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    functions: {
      invoke(_name: string, _opts: unknown): Promise<DbResult> {
        // The PDF backfill is guarded by try/catch in the sweep; an error here
        // exercises that guard without any network.
        return Promise.resolve({
          data: null,
          error: { message: "dispatch offline in test" },
        });
      },
    },
  };

  const retrievePi = (id: string) => {
    rec.stripeRetrieves.push(id);
    const status = piStatuses[id];
    if (status === undefined) {
      throw new Error(`fake stripe: unexpected PaymentIntent retrieve ${id}`);
    }
    return Promise.resolve({
      id,
      status,
      payment_method_types: ["card"],
      latest_charge: `ch_${id}`,
    });
  };

  const stripe = {
    paymentIntents: { retrieve: (id: string) => retrievePi(id) },
    checkout: {
      sessions: {
        retrieve: (id: string) => {
          rec.stripeRetrieves.push(id);
          throw new Error(`fake stripe: unexpected Checkout Session ${id}`);
        },
      },
    },
  };

  const deps: ReconcileStuckCheckoutsDeps = {
    serviceClient: () =>
      db as unknown as ReturnType<
        ReconcileStuckCheckoutsDeps["serviceClient"]
      >,
    stripeClient: () =>
      stripe as unknown as ReturnType<
        ReconcileStuckCheckoutsDeps["stripeClient"]
      >,
    qrTokenPepper: () => "issue-2947-regression-pepper-value-0123456789",
  };

  return { rows, rec, deps };
}

interface SweepSummary {
  reconciled: number;
  expired: number;
  skipped: number;
  errors: number;
  results: Array<Record<string, unknown>>;
}

async function runSweep(h: Harness): Promise<SweepSummary> {
  const handler = createReconcileStuckCheckoutsHandler(h.deps);
  const response = await handler(
    new Request("https://sweep.test/", {
      method: "POST",
      headers: { authorization: "Bearer service-role-under-test" },
    }),
  );
  assertEquals(response.status, 200);
  return await response.json() as SweepSummary;
}

// ── Fixture builders ─────────────────────────────────────────────────────────

const MINUTE = 60_000;

function session(over: Partial<SessionRow> & { id: string }): SessionRow {
  return {
    status: "pending_free",
    expires_at: new Date(Date.now() - 30 * MINUTE).toISOString(),
    created_at: new Date(Date.now() - 45 * MINUTE).toISOString(),
    order_id: null,
    stripe_payment_intent_id: null,
    stripe_checkout_session_id: null,
    stripe_account_id: null,
    brand_id: "brand-2947",
    buyer_email: "buyer@usemingla.com",
    ...over,
  };
}

/**
 * A queued hold as the waiting room will create it: an existing held-counting
 * status, `expires_at = 'infinity'` so the 15-minute clock has not started, no
 * payment reference (payment only begins at admission), and — this is what
 * starves the sweep — a `created_at` older than every genuinely stuck row,
 * because a rush queues before it abandons.
 */
function queuedHold(n: number): SessionRow {
  return session({
    id: `queued-${String(n).padStart(3, "0")}`,
    status: n % 2 === 0 ? "pending_free" : "requires_payment",
    expires_at: "infinity",
    created_at: new Date(Date.now() - (600 + n) * MINUTE).toISOString(),
  });
}

// ── T-1 · the happy path the dispatch names ──────────────────────────────────

Deno.test("#2947 T-1 - 60 queued holds do not starve the 6 real expiries", async () => {
  const queued = Array.from({ length: 60 }, (_, i) => queuedHold(i));
  const expirable = Array.from({ length: 6 }, (_, i) =>
    session({
      id: `stuck-${i}`,
      status: "pending_free",
      expires_at: new Date(Date.now() - 20 * MINUTE).toISOString(),
      created_at: new Date(Date.now() - 35 * MINUTE).toISOString(),
    }));

  const h = harness([...queued, ...expirable]);
  const summary = await runSweep(h);

  assertEquals(summary.expired, 6, "all six abandoned holds must be released");
  assertEquals(
    h.rec.expiredIds.sort(),
    expirable.map((row) => row.id).sort(),
  );
  assertEquals(summary.errors, 0);

  // The queued holds are untouched: still in-flight, still holding stock,
  // still on `infinity`. Releasing one would break approved rule 3.
  for (const row of h.rows.filter((r) => r.id.startsWith("queued-"))) {
    assertEquals(row.expires_at, "infinity");
    assert(IN_FLIGHT.includes(row.status), `${row.id} left the held set`);
  }
});

// ── T-2 · the limit must bound expirable rows, not rows scanned ──────────────

Deno.test("#2947 T-2 - the batch spends no slot on a row that can never expire", async () => {
  // 120 queued holds — more than twice SWEEP_BATCH_LIMIT — and every one of
  // them older than the expirable rows, which is the ordering that produced
  // 50-of-50 starvation on production.
  const queued = Array.from({ length: 120 }, (_, i) => queuedHold(i));
  const expirable = Array.from({ length: 6 }, (_, i) =>
    session({
      id: `stuck-${i}`,
      expires_at: new Date(Date.now() - 20 * MINUTE).toISOString(),
      created_at: new Date(Date.now() - 35 * MINUTE).toISOString(),
    }));

  const h = harness([...queued, ...expirable]);
  await runSweep(h);

  assertEquals(
    h.rec.batchIds.filter((id) => id.startsWith("queued-")).length,
    0,
    "a row at expires_at='infinity' must never occupy a batch slot",
  );
  assertEquals(h.rec.batchIds.length, 6);

  // Placement, not just presence: the predicate has to sit on the query the
  // database runs, alongside the status filter and ahead of the limit.
  assert(
    h.rec.batchFilterOps.includes("lt:expires_at"),
    `batch SELECT carried ${JSON.stringify(h.rec.batchFilterOps)}`,
  );

  // And no Stripe budget was burned learning nothing about them.
  assertEquals(h.rec.stripeRetrieves, []);
});

// ── T-3 · the OTHER job this function does still works ───────────────────────

Deno.test("#2947 T-3 - a webhook-lost payment past expiry is still finalized, never expired", async () => {
  const h = harness(
    [
      session({
        id: "webhook-lost",
        status: "processing_payment",
        stripe_payment_intent_id: "pi_2947_succeeded",
        stripe_account_id: "acct_2947",
        expires_at: new Date(Date.now() - 5 * MINUTE).toISOString(),
        created_at: new Date(Date.now() - 20 * MINUTE).toISOString(),
      }),
      ...Array.from({ length: 60 }, (_, i) => queuedHold(i)),
    ],
    { pi_2947_succeeded: "succeeded" },
  );

  const summary = await runSweep(h);

  assertEquals(summary.reconciled, 1, "real money must still be recovered");
  assertEquals(summary.expired, 0);
  assertEquals(h.rec.expiredIds, []);
  assertEquals(h.rows[0].status, "processing_payment");
  // Capture-before-finalize is intact and the finalize RPC actually ran.
  assertEquals(h.rec.rpcCalls, [
    "issue_2079_verify_ticket_paid_identity",
    "biz_ticket_checkout_finalize",
  ]);
});

// ── T-4 · what the chosen shape COSTS, asserted rather than hidden ───────────

Deno.test("#2947 T-4 - an in-window webhook-lost payment is DEFERRED, not lost", async () => {
  // Payment succeeded 2 minutes into a 15-minute window. Before this fix the
  // sweep would have retrieved it on the next */15 tick. It no longer does:
  // the row is not in the batch while its clock is still running.
  const row = session({
    id: "in-window-paid",
    status: "processing_payment",
    stripe_payment_intent_id: "pi_2947_inwindow",
    stripe_account_id: "acct_2947",
    expires_at: new Date(Date.now() + 13 * MINUTE).toISOString(),
    created_at: new Date(Date.now() - 2 * MINUTE).toISOString(),
  });

  const deferred = harness([row], { pi_2947_inwindow: "succeeded" });
  const first = await runSweep(deferred);

  assertEquals(first.reconciled, 0, "deferred while the hold clock runs");
  assertEquals(deferred.rec.batchIds, []);
  assertEquals(
    deferred.rec.stripeRetrieves,
    [],
    "and it costs no Stripe retrieve to defer it",
  );

  // THE OTHER HALF, which is the whole reason this is acceptable: once the
  // window passes, the row is picked up and FINALIZED — classify() reads Stripe
  // truth before the clock, so a succeeded PaymentIntent can never be expired
  // instead. The recovery is late by at most one hold window, never missed.
  const later = harness(
    [{
      ...row,
      expires_at: new Date(Date.now() - 1 * MINUTE).toISOString(),
    }],
    { pi_2947_inwindow: "succeeded" },
  );
  const second = await runSweep(later);

  assertEquals(second.reconciled, 1);
  assertEquals(second.expired, 0);
  assertEquals(later.rec.stripeRetrieves, ["pi_2947_inwindow"]);
});

// ── T-5 · the quiet path: today's Mingla must not notice this shipped ────────

Deno.test("#2947 T-5 - the live pre-queue population behaves exactly as it did at b6ca942fb", async () => {
  // The real in-flight population, read from production on 2026-09-01:
  // 6 rows, all awaiting_web_redirect, all past expiry, all carrying a
  // PaymentIntent, none in-window, none on the sentinel. With no queued row in
  // existence the predicate must remove NOTHING, so this case is green both
  // before and after the fix — that is what makes it a quiet-path assertion
  // rather than a second copy of T-1.
  const live = Array.from({ length: 6 }, (_, i) =>
    session({
      id: `live-${i}`,
      status: "awaiting_web_redirect",
      stripe_payment_intent_id: `pi_live_${i}`,
      stripe_account_id: "acct_live",
      // oldest first, so `live-0` is the head of a created_at ASC batch
      expires_at: new Date(Date.now() - (40 - i) * MINUTE).toISOString(),
      created_at: new Date(Date.now() - (55 - i) * MINUTE).toISOString(),
    }));
  // Terminal rows that were never in scope and must stay out of it.
  const terminal = [
    session({ id: "done-free", status: "free_completed" }),
    session({ id: "done-paid", status: "paid_completed", order_id: "o-1" }),
    session({ id: "already-expired", status: "expired" }),
  ];

  const piStatuses = Object.fromEntries(
    live.map((row, i) => [`pi_live_${i}`, "requires_payment_method"]),
  );
  const h = harness([...live, ...terminal], piStatuses);
  const summary = await runSweep(h);

  // Every in-flight row still reaches the sweep — the batch is unchanged.
  assertEquals(h.rec.batchIds, live.map((row) => row.id));
  assertEquals(h.rec.stripeRetrieves, live.map((_, i) => `pi_live_${i}`));
  assertEquals(summary, {
    reconciled: 0,
    expired: 6,
    skipped: 0,
    errors: 0,
    results: live.map((row, i) => ({
      sessionId: row.id,
      piId: `pi_live_${i}`,
      csId: null,
      status: "expired",
    })),
  });
  // Terminal rows untouched, as before.
  for (const row of terminal) {
    assertEquals(row.failure_reason ?? null, null);
  }
});
