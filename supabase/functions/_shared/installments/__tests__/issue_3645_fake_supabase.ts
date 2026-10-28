/**
 * Issue #3645 — a small in-memory stand-in for the service-role Supabase
 * client used by the instalment module tests. Every RPC and table operation is
 * recorded; responses come from per-test handlers.
 */
export interface TableOp {
  table: string;
  kind: "select" | "update" | "insert";
  columns: string | null;
  values: Record<string, unknown> | null;
  filters: Array<[string, string, unknown]>;
  head: boolean;
}

export type Result = { data: unknown; error: { message: string } | null; count?: number | null };

export interface FakeHandlers {
  rpc?: (name: string, args: Record<string, unknown>) => Result | Promise<Result>;
  table?: (op: TableOp) => Result | Promise<Result>;
}

export interface FakeSupabase {
  client: unknown;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  tableOps: TableOp[];
}

export function fakeSupabase(handlers: FakeHandlers): FakeSupabase {
  const rpcCalls: FakeSupabase["rpcCalls"] = [];
  const tableOps: TableOp[] = [];

  function builder(table: string) {
    const op: TableOp = { table, kind: "select", columns: null, values: null, filters: [], head: false };
    const run = async (): Promise<Result> => {
      tableOps.push(op);
      return handlers.table ? await handlers.table(op) : { data: null, error: null };
    };
    const chain: Record<string, unknown> = {};
    const filter = (kind: string) => (col: string, val: unknown) => {
      op.filters.push([kind, col, val]);
      return chain;
    };
    Object.assign(chain, {
      select(columns?: string, opts?: { head?: boolean }) {
        if (op.kind === "select") op.columns = columns ?? "*";
        if (opts?.head) op.head = true;
        return chain;
      },
      update(values: Record<string, unknown>) {
        op.kind = "update";
        op.values = values;
        return chain;
      },
      insert(values: Record<string, unknown>) {
        op.kind = "insert";
        op.values = values;
        return chain;
      },
      eq: filter("eq"),
      neq: filter("neq"),
      in: filter("in"),
      is: filter("is"),
      gt: filter("gt"),
      lt: filter("lt"),
      lte: filter("lte"),
      gte: filter("gte"),
      order: () => chain,
      limit: () => chain,
      maybeSingle: run,
      single: run,
      then(resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) {
        return run().then(resolve, reject);
      },
    });
    return chain;
  }

  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return handlers.rpc ? await handlers.rpc(name, args) : { data: null, error: null };
    },
    from: (table: string) => builder(table),
  };
  return { client, rpcCalls, tableOps };
}

export function ok(data: unknown): Result {
  return { data, error: null };
}
