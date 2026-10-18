/**
 * issue #2947 slice 4 — set-based free/NO_REF arm happy path.
 *
 * 1,000 past-expiry NO_REF rows clear in one run with ZERO Stripe retrieves.
 * Reverting the free-arm RPC call (or stubbing it to expire nothing) leaves
 * only SWEEP_BATCH_LIMIT=50 cleared via the per-row backstop.
 *
 * Run with:
 *   deno test --allow-net --allow-env --allow-read \
 *     supabase/functions/reconcile-stuck-checkouts/__tests__/issue_2947_slice4_free_arm.implementor.happy.test.ts
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createReconcileStuckCheckoutsHandler,
  type ReconcileStuckCheckoutsDeps,
} from "../index.ts";

interface SessionRow {
  id: string;
  status: string;
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

const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "service-role-under-test";

function tsValue(raw: string): number {
  if (raw === "infinity") return Number.POSITIVE_INFINITY;
  if (raw === "-infinity") return Number.NEGATIVE_INFINITY;
  return Date.parse(raw);
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

interface Recorder {
  stripeRetrieves: string[];
  expiredIds: string[];
  rpcCalls: string[];
  freeArmEnabled: boolean;
}

class SelectBuilder implements PromiseLike<DbResult> {
  private filters: Filter[] = [];
  private orderCol: string | null = null;
  private ascending = true;
  private limitN: number | null = null;

  constructor(private readonly rows: SessionRow[]) {}

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

function harness(
  rows: SessionRow[],
  opts: { freeArmEnabled?: boolean } = {},
): { rows: SessionRow[]; rec: Recorder; deps: ReconcileStuckCheckoutsDeps } {
  const rec: Recorder = {
    stripeRetrieves: [],
    expiredIds: [],
    rpcCalls: [],
    freeArmEnabled: opts.freeArmEnabled !== false,
  };

  const db = {
    from(table: string) {
      if (table !== "ticket_checkout_sessions") {
        throw new Error(`fake db: table ${table} is not modelled`);
      }
      return {
        select: (_cols: string) => new SelectBuilder(rows),
        update: (patch: Record<string, unknown>) =>
          new UpdateBuilder(rows, patch, rec),
      };
    },
    rpc(name: string, params: unknown): Promise<DbResult> {
      rec.rpcCalls.push(name);
      if (name === "issue_2947_expire_no_ref_holds") {
        if (!rec.freeArmEnabled) {
          return Promise.resolve({
            data: { expired_count: 0, freed: [] },
            error: null,
          });
        }
        const args = (params ?? {}) as { p_now?: string; p_limit?: number };
        const now = args.p_now ?? new Date().toISOString();
        const limit = args.p_limit ?? 5000;
        const candidates = rows
          .filter((row) =>
            IN_FLIGHT.includes(row.status) &&
            row.stripe_payment_intent_id == null &&
            row.stripe_checkout_session_id == null &&
            row.order_id == null &&
            tsValue(row.expires_at) < tsValue(now)
          )
          .sort((a, b) => tsValue(a.created_at) - tsValue(b.created_at))
          .slice(0, limit);
        for (const row of candidates) {
          Object.assign(row, {
            status: "expired",
            failed_at: now,
            failure_reason: "abandoned_past_expiry",
            updated_at: now,
          });
          rec.expiredIds.push(row.id);
        }
        return Promise.resolve({
          data: {
            expired_count: candidates.length,
            freed: candidates.length > 0
              ? [{
                ticket_type_id: "00000000-0000-4000-8000-000000000294",
                freed_qty: candidates.length,
              }]
              : [],
          },
          error: null,
        });
      }
      if (
        name === "issue_2947_waitlist_drain_for_ticket_type" ||
        name === "issue_2947_note_expired_session"
      ) {
        return Promise.resolve({
          data: name === "issue_2947_note_expired_session" ? [] : 0,
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    functions: {
      invoke(): Promise<DbResult> {
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
        throw new Error(`fake stripe: unexpected PaymentIntent retrieve ${id}`);
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

  const deps: ReconcileStuckCheckoutsDeps = {
    serviceClient: () =>
      db as unknown as ReturnType<
        ReconcileStuckCheckoutsDeps["serviceClient"]
      >,
    stripeClient: () =>
      stripe as unknown as ReturnType<
        ReconcileStuckCheckoutsDeps["stripeClient"]
      >,
    qrTokenPepper: () => "issue-2947-slice4-pepper-value-0123456789abcdef",
    paystackVerifier: () => Promise.reject(new Error("paystack offline")),
  };

  return { rows, rec, deps };
}

const MINUTE = 60_000;

function freeHold(n: number): SessionRow {
  return {
    id: `free-${String(n).padStart(4, "0")}`,
    status: "pending_free",
    expires_at: new Date(Date.now() - 20 * MINUTE).toISOString(),
    created_at: new Date(Date.now() - (40 + n) * MINUTE).toISOString(),
    order_id: null,
    stripe_payment_intent_id: null,
    stripe_checkout_session_id: null,
    stripe_account_id: null,
    brand_id: "brand-s4",
    buyer_email: "buyer@usemingla.com",
  };
}

Deno.test("#2947 slice4 T-1 - 1000 free past-expiry rows clear with zero Stripe calls", async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => freeHold(i));
  const h = harness(rows);
  const handler = createReconcileStuckCheckoutsHandler(h.deps);
  const response = await handler(
    new Request("https://sweep.test/", {
      method: "POST",
      headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    }),
  );
  assertEquals(response.status, 200);
  const summary = await response.json() as {
    expired: number;
    freeArmExpired: number;
    errors: number;
  };

  assertEquals(summary.expired, 1000);
  assertEquals(summary.freeArmExpired, 1000);
  assertEquals(summary.errors, 0);
  assertEquals(h.rec.expiredIds.length, 1000);
  assertEquals(h.rec.stripeRetrieves, []);
  assert(
    h.rec.rpcCalls.includes("issue_2947_expire_no_ref_holds"),
    "set-based free arm must run",
  );
  assert(
    h.rec.rpcCalls.includes("issue_2947_waitlist_drain_for_ticket_type"),
    "waitlist drain handoff must run after free arm",
  );
});

Deno.test("#2947 slice4 T-2 - without free arm only SWEEP_BATCH_LIMIT=50 clear (fails-on-revert)", async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => freeHold(i));
  const h = harness(rows, { freeArmEnabled: false });
  const handler = createReconcileStuckCheckoutsHandler(h.deps);
  const response = await handler(
    new Request("https://sweep.test/", {
      method: "POST",
      headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    }),
  );
  const summary = await response.json() as { expired: number };

  assertEquals(
    summary.expired,
    50,
    "reverting the free arm leaves 950 stranded for later ticks",
  );
  assertEquals(h.rec.stripeRetrieves, []);
});
