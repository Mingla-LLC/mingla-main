// ORCH-1384 INVESTIGATE probe — import-map mock for @supabase/supabase-js@2.
// Replaces createClient with a scripted double so the REAL invite-brand-member
// handler executes its full control flow. Scenario state lives on globalThis
// so the test file can program per-scenario responses and inspect captured
// writes. READ-ONLY investigation: nothing here touches any real backend.

type Json = Record<string, unknown>;

export interface CapturedOp {
  client: "caller" | "service";
  table?: string;
  op: string; // "select" | "insert" | "delete" | "update" | "rpc:<name>"
  args?: unknown;
  filters: Array<{ m: string; a: unknown[] }>;
}

export interface Scenario {
  user: { id: string; email: string } | null;
  rank: number;
  brandRow: Json | null;
  duplicateInviteRow: Json | null; // duplicate-guard result
  invitationInsert: { data: Json | null; error: Json | null };
  linkInsert: { error: Json | null };
  captured: CapturedOp[];
}

function scenario(): Scenario {
  return (globalThis as Record<string, unknown>).__ORCH1384_SCENARIO as Scenario;
}

class QueryBuilder {
  private table: string;
  private clientKind: "caller" | "service";
  private op = "select";
  private args: unknown = undefined;
  private filters: Array<{ m: string; a: unknown[] }> = [];
  private wantSingle = false;

  constructor(table: string, clientKind: "caller" | "service") {
    this.table = table;
    this.clientKind = clientKind;
  }

  private chain(m: string, ...a: unknown[]): QueryBuilder {
    this.filters.push({ m, a });
    return this;
  }
  select(...a: unknown[]): QueryBuilder {
    if (this.op === "select") this.op = "select";
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
  maybeSingle(): Promise<{ data: unknown; error: unknown }> {
    this.wantSingle = true;
    return this.resolve();
  }
  single(): Promise<{ data: unknown; error: unknown }> {
    this.wantSingle = true;
    return this.resolve();
  }
  then(
    onf: (v: { data: unknown; error: unknown }) => unknown,
    onr?: (e: unknown) => unknown,
  ): Promise<unknown> {
    return this.resolve().then(onf, onr);
  }

  private record(): void {
    scenario().captured.push({
      client: this.clientKind,
      table: this.table,
      op: this.op,
      args: this.args,
      filters: this.filters,
    });
  }

  private resolve(): Promise<{ data: unknown; error: unknown }> {
    const s = scenario();
    this.record();
    // ---- scripted responses per table+op ----
    if (this.table === "brands" && this.op === "select") {
      return Promise.resolve({ data: s.brandRow, error: null });
    }
    if (this.table === "brand_invitations" && this.op === "select") {
      // duplicate guard
      return Promise.resolve({ data: s.duplicateInviteRow, error: null });
    }
    if (this.table === "brand_invitations" && this.op === "insert") {
      return Promise.resolve({
        data: s.invitationInsert.data,
        error: s.invitationInsert.error,
      });
    }
    if (this.table === "brand_invitations" && this.op === "delete") {
      return Promise.resolve({ data: null, error: null });
    }
    if (this.table === "creator_accounts" && this.op === "select") {
      return Promise.resolve({
        data: { display_name: "Seth Partner", business_name: null },
        error: null,
      });
    }
    if (this.table === "audit_log" && this.op === "insert") {
      return Promise.resolve({ data: null, error: null });
    }
    if (this.table === "partner_brand_links" && this.op === "insert") {
      return Promise.resolve({ data: null, error: s.linkInsert.error });
    }
    return Promise.resolve({ data: this.wantSingle ? null : [], error: null });
  }
}

export function createClient(
  _url: string,
  key: string,
  _opts?: unknown,
): unknown {
  const clientKind: "caller" | "service" = key === "SERVICE_KEY_FAKE"
    ? "service"
    : "caller";
  return {
    auth: {
      getUser(): Promise<unknown> {
        const s = scenario();
        return Promise.resolve(
          s.user
            ? { data: { user: s.user }, error: null }
            : { data: { user: null }, error: { message: "no user" } },
        );
      },
    },
    from(table: string): QueryBuilder {
      return new QueryBuilder(table, clientKind);
    },
    rpc(name: string, args: unknown): Promise<unknown> {
      const s = scenario();
      s.captured.push({ client: clientKind, op: `rpc:${name}`, args, filters: [] });
      if (name === "biz_brand_effective_rank") {
        return Promise.resolve({ data: s.rank, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
}
