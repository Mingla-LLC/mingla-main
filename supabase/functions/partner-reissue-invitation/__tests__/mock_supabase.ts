// ORCH-1384 — import-map mock for @supabase/supabase-js@2 (T-4 handler
// probes). Replaces createClient with a scripted double so the REAL
// partner-reissue-invitation handler executes its full control flow.
// Scenario state lives on globalThis so the test file programs per-scenario
// responses and inspects captured writes. Mirrors the INVESTIGATE probe
// harness (Mingla_Artifacts/evidence/ORCH-1384/mock_supabase.ts).

type Json = Record<string, unknown>;

export interface CapturedOp {
  client: "caller" | "service";
  table: string;
  op: string; // "select" | "insert" | "update" | "delete"
  args?: unknown;
  filters: Array<{ m: string; a: unknown[] }>;
}

export interface RpcCall {
  name: string;
  args: Json;
}

export interface ReissueScenario {
  user: { id: string; email: string } | null;
  linkRow: Json | null;
  brandRow: Json | null;
  inviterRow: Json | null;
  rpc: { data: Json | null; error: { message: string } | null };
  captured: CapturedOp[];
  rpcCalls: RpcCall[];
}

function scenario(): ReissueScenario {
  return (globalThis as Record<string, unknown>)
    .__ORCH1384_REISSUE_SCENARIO as ReissueScenario;
}

class QueryBuilder {
  private table: string;
  private clientKind: "caller" | "service";
  private op = "select";
  private args: unknown = undefined;
  private filters: Array<{ m: string; a: unknown[] }> = [];

  constructor(table: string, clientKind: "caller" | "service") {
    this.table = table;
    this.clientKind = clientKind;
  }

  private chain(m: string, ...a: unknown[]): QueryBuilder {
    this.filters.push({ m, a });
    return this;
  }
  select(...a: unknown[]): QueryBuilder {
    return this.chain("select", ...a);
  }
  insert(payload: unknown): QueryBuilder {
    this.op = "insert";
    this.args = payload;
    return this;
  }
  update(payload: unknown): QueryBuilder {
    this.op = "update";
    this.args = payload;
    return this;
  }
  delete(): QueryBuilder {
    this.op = "delete";
    return this;
  }
  eq(...a: unknown[]): QueryBuilder {
    return this.chain("eq", ...a);
  }
  is(...a: unknown[]): QueryBuilder {
    return this.chain("is", ...a);
  }
  gt(...a: unknown[]): QueryBuilder {
    return this.chain("gt", ...a);
  }
  limit(...a: unknown[]): QueryBuilder {
    return this.chain("limit", ...a);
  }
  order(...a: unknown[]): QueryBuilder {
    return this.chain("order", ...a);
  }

  private capture(): void {
    scenario().captured.push({
      client: this.clientKind,
      table: this.table,
      op: this.op,
      args: this.args,
      filters: this.filters,
    });
  }

  private resolveRow(): { data: unknown; error: unknown } {
    const s = scenario();
    if (this.table === "partner_brand_links") {
      return { data: s.linkRow, error: null };
    }
    if (this.table === "brands") {
      return { data: s.brandRow, error: null };
    }
    if (this.table === "creator_accounts") {
      return { data: s.inviterRow, error: null };
    }
    return { data: null, error: null };
  }

  maybeSingle(): Promise<{ data: unknown; error: unknown }> {
    this.capture();
    return Promise.resolve(this.resolveRow());
  }
  single(): Promise<{ data: unknown; error: unknown }> {
    this.capture();
    return Promise.resolve(this.resolveRow());
  }

  // Thenable — a bare awaited builder (e.g. the rollback DELETE).
  then<T>(
    onFulfilled: (value: { data: unknown; error: unknown }) => T,
  ): Promise<T> {
    this.capture();
    return Promise.resolve(onFulfilled({ data: null, error: null }));
  }
}

interface ClientOptions {
  global?: { headers?: Record<string, string> };
  auth?: Json;
}

export function createClient(
  _url: string,
  _key: string,
  options?: ClientOptions,
): Json {
  // The caller-bound client passes the Authorization header through
  // options.global.headers; the service client does not.
  const kind: "caller" | "service" =
    options?.global?.headers?.Authorization !== undefined
      ? "caller"
      : "service";
  return {
    auth: {
      getUser: () => {
        const s = scenario();
        return Promise.resolve(
          s.user === null
            ? { data: { user: null }, error: { message: "bad jwt" } }
            : { data: { user: s.user }, error: null },
        );
      },
    },
    from: (table: string) => new QueryBuilder(table, kind),
    rpc: (name: string, args: Json) => {
      const s = scenario();
      s.rpcCalls.push({ name, args });
      return Promise.resolve(s.rpc);
    },
  };
}
