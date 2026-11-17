/**
 * #4238 W3-3 test harness (not a test): a tiny in-memory PostgREST-shaped
 * client with real rows, enough for fireAdConversion, the host-funnel helpers
 * and host-attribution-attach. Supports select / eq / is / maybeSingle /
 * insert / update / upsert(onConflict, ignoreDuplicates) / await.
 */

export type Row = Record<string, unknown>;

const UNIQUE: Record<string, string[]> = {
  ad_conversions: ["event_id"],
  ad_match_contexts: ["subject_type", "subject_id"],
  brand_appsflyer_milestones: ["brand_id"],
};

const CONVERSION_DEFAULTS: Row = {
  meta_capi_status: "pending",
  tiktok_events_status: "pending",
  snap_capi_status: "pending",
  reddit_capi_status: "pending",
  google_ads_status: "pending",
  appsflyer_status: "pending",
};

export interface HostFakeDbOptions {
  /**
   * #4452 B20: emails that public.inbound_lead_is_test answers true for (a
   * stand-in for the SQL rule, which its own pg17 tests own). Every other
   * contact is a real lead.
   */
  testLeadEmails?: string[];
  /** Make the inbound_lead_is_test RPC fail (the fail-closed path). */
  testLeadCheckError?: boolean;
}

export function hostFakeDb(seed: Record<string, Row[]> = {}, options: HostFakeDbOptions = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }
  const rowsOf = (t: string): Row[] => (tables[t] ??= []);
  let idSeq = 0;

  const withDefaults = (table: string, row: Row): Row => {
    const base: Row = { id: `row-${++idSeq}`, created_at: new Date().toISOString() };
    return table === "ad_conversions"
      ? { ...base, ...CONVERSION_DEFAULTS, ...row }
      : { ...base, ...row };
  };
  const conflicts = (table: string, row: Row): Row | undefined => {
    const keys = UNIQUE[table];
    if (!keys) return undefined;
    return rowsOf(table).find((r) => keys.every((k) => r[k] === row[k]));
  };

  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" | "insert" | "upsert" = "select";
    let payload: Row | null = null;
    let upsertOpts: { ignoreDuplicates?: boolean } = {};
    let insertError: { code: string; message: string } | null = null;

    const run = (): { data: unknown; error: unknown } => {
      if (op === "insert" && payload) {
        if (conflicts(table, payload)) {
          insertError = { code: "23505", message: "duplicate key" };
          return { data: null, error: insertError };
        }
        rowsOf(table).push(withDefaults(table, payload));
        return { data: null, error: null };
      }
      if (op === "upsert" && payload) {
        const hit = conflicts(table, payload);
        if (hit) {
          if (!upsertOpts.ignoreDuplicates) Object.assign(hit, payload);
        } else {
          rowsOf(table).push(withDefaults(table, payload));
        }
        return { data: null, error: null };
      }
      const matched = rowsOf(table).filter((r) => filters.every((f) => f(r)));
      if (op === "update" && payload) {
        for (const r of matched) Object.assign(r, payload);
        return { data: matched.map((r) => ({ ...r })), error: null };
      }
      return { data: matched.map((r) => ({ ...r })), error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      in: (col: string, vals: unknown[]) => {
        filters.push((r) => vals.includes(r[col]));
        return builder;
      },
      eq: (col: string, val: unknown) => {
        filters.push((r) => r[col] === val);
        return builder;
      },
      neq: (col: string, val: unknown) => {
        filters.push((r) => r[col] !== val);
        return builder;
      },
      is: (col: string, val: unknown) => {
        filters.push((r) => (r[col] ?? null) === val);
        return builder;
      },
      insert: (row: Row) => {
        op = "insert";
        payload = row;
        return builder;
      },
      update: (row: Row) => {
        op = "update";
        payload = row;
        return builder;
      },
      upsert: (row: Row, opts: { ignoreDuplicates?: boolean } = {}) => {
        op = "upsert";
        payload = row;
        upsertOpts = opts;
        return builder;
      },
      maybeSingle: () => {
        const res = run();
        const data = Array.isArray(res.data) ? res.data[0] ?? null : res.data;
        return Promise.resolve({ data, error: res.error });
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
        resolve(run()),
    };
    return builder;
  };

  const users: Record<string, string> = {};
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const testEmails = new Set((options.testLeadEmails ?? []).map((e) => e.toLowerCase()));
  const rpc = (name: string, args: Record<string, unknown> = {}) => {
    rpcCalls.push({ name, args });
    if (name !== "inbound_lead_is_test") {
      return Promise.resolve({ data: null, error: { message: `no fake for rpc ${name}` } });
    }
    if (options.testLeadCheckError) return Promise.resolve({ data: null, error: { message: "rpc down" } });
    const email = typeof args.p_email === "string" ? args.p_email.toLowerCase() : "";
    return Promise.resolve({ data: testEmails.has(email), error: null });
  };
  return {
    rpcCalls,
    // deno-lint-ignore no-explicit-any
    client: { from, rpc, auth: { getUser: (token: string) => Promise.resolve(users[token] ? { data: { user: { id: users[token] } }, error: null } : { data: { user: null }, error: { message: "bad jwt" } }) } } as any,
    tables,
    row: (table: string, pred: (r: Row) => boolean): Row | undefined =>
      rowsOf(table).find(pred),
    addUser: (token: string, id: string) => {
      users[token] = id;
    },
  };
}
