// Issue #4271 — a small recording fake of the supabase-js query builder and
// the Stripe SDK calls the door functions make. Test helper, not a suite.

export type DbResult = {
  data?: unknown;
  error?: { message: string; code?: string } | null;
};

export interface DbOp {
  table: string;
  action: "select" | "insert" | "update" | "upsert";
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
}

export type DbHandler = (op: DbOp) => DbResult;
export type RpcHandler = (name: string, args: Record<string, unknown>) => DbResult;

class FakeQuery implements PromiseLike<DbResult> {
  private readonly op: DbOp;
  constructor(private readonly db: FakeDb, table: string) {
    this.op = { table, action: "select", filters: [] };
  }
  select(_columns?: string): this {
    return this;
  }
  insert(payload: unknown): this {
    this.op.action = "insert";
    this.op.payload = payload;
    return this;
  }
  update(payload: unknown): this {
    this.op.action = "update";
    this.op.payload = payload;
    return this;
  }
  upsert(payload: unknown, _options?: unknown): this {
    this.op.action = "upsert";
    this.op.payload = payload;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.op.filters.push(["eq", column, value]);
    return this;
  }
  lt(column: string, value: unknown): this {
    this.op.filters.push(["lt", column, value]);
    return this;
  }
  gt(column: string, value: unknown): this {
    this.op.filters.push(["gt", column, value]);
    return this;
  }
  not(column: string, operator: string, value: unknown): this {
    this.op.filters.push([`not.${operator}`, column, value]);
    return this;
  }
  in(column: string, value: unknown): this {
    this.op.filters.push(["in", column, value]);
    return this;
  }
  is(column: string, value: unknown): this {
    this.op.filters.push(["is", column, value]);
    return this;
  }
  order(_c: string, _o?: unknown): this {
    return this;
  }
  limit(_n: number): this {
    return this;
  }
  single(): Promise<DbResult> {
    return Promise.resolve(this.db.run(this.op));
  }
  maybeSingle(): Promise<DbResult> {
    return Promise.resolve(this.db.run(this.op));
  }
  then<T1 = DbResult, T2 = never>(
    onfulfilled?: ((value: DbResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.db.run(this.op)).then(onfulfilled, onrejected);
  }
}

export class FakeDb {
  readonly ops: DbOp[] = [];
  readonly rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  constructor(
    private readonly onTable: DbHandler,
    private readonly onRpc: RpcHandler,
  ) {}
  from(table: string): FakeQuery {
    return new FakeQuery(this, table);
  }
  run(op: DbOp): DbResult {
    this.ops.push(op);
    return this.onTable(op);
  }
  rpc(name: string, args: Record<string, unknown>): Promise<DbResult> {
    this.rpcs.push({ name, args });
    return Promise.resolve(this.onRpc(name, args));
  }
  opsOn(table: string, action?: DbOp["action"]): DbOp[] {
    return this.ops.filter((o) => o.table === table && (!action || o.action === action));
  }
}

export interface StripeCall {
  method: string;
  params: unknown;
  options: unknown;
}

export function fakeStripe(overrides: {
  retrievePi?: (id: string) => Record<string, unknown>;
} = {}) {
  const calls: StripeCall[] = [];
  return {
    calls,
    client: {
      paymentIntents: {
        create: (params: unknown, options: unknown) => {
          calls.push({ method: "paymentIntents.create", params, options });
          return Promise.resolve({ id: "pi_door1", client_secret: "pi_door1_secret_x" });
        },
        cancel: (id: string, params: unknown, options: unknown) => {
          calls.push({ method: "paymentIntents.cancel", params: { id, params }, options });
          return Promise.resolve({ id, status: "canceled" });
        },
        retrieve: (id: string, params: unknown, options: unknown) => {
          calls.push({ method: "paymentIntents.retrieve", params: { id, params }, options });
          return Promise.resolve(
            overrides.retrievePi?.(id) ?? { id, client_secret: `${id}_secret_x` },
          );
        },
      },
      terminal: {
        locations: {
          create: (params: unknown, options: unknown) => {
            calls.push({ method: "terminal.locations.create", params, options });
            return Promise.resolve({ id: "tml_door1" });
          },
        },
        connectionTokens: {
          create: (params: unknown, options: unknown) => {
            calls.push({ method: "terminal.connectionTokens.create", params, options });
            return Promise.resolve({ secret: "pst_test_door" });
          },
        },
      },
    },
  };
}

export function post(body: unknown, auth = true): Request {
  return new Request("https://example.test/fn", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: "Bearer user-token" } : {}),
    },
    body: JSON.stringify(body),
  });
}

export const PRICING_ROW = {
  pass_tax: false,
  pass_mingla_fee: true,
  pass_service_fee: true,
  pricing_region: "US",
  pricing_currency: "USD",
  venue_tax_address: {
    line1: "1 Main St",
    city: "Austin",
    state: "TX",
    postal_code: "78701",
    country: "US",
  },
  pricing_locked: false,
  effective_take_rate_bps: 150,
  take_rate_source: "platform_default",
  stripe_account_id: "acct_door1",
  payment_provider: "stripe",
  payment_country: "US",
  paystack_subaccount_code: null,
  vat_rate_bps: null,
};
