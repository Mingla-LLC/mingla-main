// Issue #3040 — a small in-memory stand-in for the supabase-js query builder,
// shared by the #3040 Deno suites. It implements the PostgREST verbs the video
// lane uses with their real filter semantics (eq/neq/in/is/not-is-null/lt/gt,
// order, limit, maybeSingle, update/insert with select), so a test asserts
// what the code asks the database for — not what a hand-written chain mock
// happens to return.
// deno-lint-ignore-file no-explicit-any

export type Row = Record<string, any>;
export type RpcHandler = (
  args: Record<string, any>,
  db: FakeDb,
) => { data: any; error: any } | Promise<{ data: any; error: any }>;

export type FakeDb = {
  tables: Record<string, Row[]>;
  rpcs: Array<{ name: string; args: Record<string, any> }>;
  updates: Array<{ table: string; patch: Row; ids: unknown[] }>;
  inserts: Array<{ table: string; rows: Row[] }>;
  client: any;
};

type Filter = (row: Row) => boolean;

const compare = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  const da = typeof a === "string" ? Date.parse(a) : Number.NaN;
  const db = typeof b === "string" ? Date.parse(b) : Number.NaN;
  if (Number.isFinite(da) && Number.isFinite(db)) return da - db;
  return String(a) < String(b) ? -1 : 1;
};

function builder(db: FakeDb, table: string) {
  const filters: Filter[] = [];
  const orders: Array<{ col: string; ascending: boolean; nullsFirst: boolean }> = [];
  let limitN: number | null = null;
  let mode: "select" | "update" | "insert" = "select";
  let patch: Row = {};
  let inserted: Row[] = [];
  let returning = false;

  const rows = () => db.tables[table] ??= [];
  const matched = (): Row[] => {
    let out = rows().filter((row) => filters.every((f) => f(row)));
    for (const order of [...orders].reverse()) {
      out = [...out].sort((x, y) => {
        const a = x[order.col], b = y[order.col];
        const aNull = a === null || a === undefined;
        const bNull = b === null || b === undefined;
        if (aNull !== bNull) return (aNull ? -1 : 1) * (order.nullsFirst ? 1 : -1);
        const c = compare(a, b);
        return order.ascending ? c : -c;
      });
    }
    return limitN === null ? out : out.slice(0, limitN);
  };
  const run = (): { data: any; error: any } => {
    if (mode === "insert") {
      rows().push(...inserted);
      db.inserts.push({ table, rows: inserted });
      return { data: returning ? inserted : null, error: null };
    }
    if (mode === "update") {
      const hit = rows().filter((row) => filters.every((f) => f(row)));
      for (const row of hit) Object.assign(row, patch);
      db.updates.push({ table, patch, ids: hit.map((row) => row.id) });
      return { data: returning ? hit : null, error: null };
    }
    return { data: matched(), error: null };
  };

  const q: any = {
    select(_cols?: string) {
      if (mode !== "select") returning = true;
      return q;
    },
    eq(col: string, value: unknown) {
      filters.push((row) => row[col] === value);
      return q;
    },
    neq(col: string, value: unknown) {
      filters.push((row) => row[col] !== value);
      return q;
    },
    in(col: string, values: unknown[]) {
      filters.push((row) => values.includes(row[col]));
      return q;
    },
    is(col: string, value: null) {
      filters.push((row) => (value === null ? row[col] == null : row[col] === value));
      return q;
    },
    not(col: string, op: string, value: unknown) {
      if (op === "is" && value === null) filters.push((row) => row[col] != null);
      else filters.push((row) => row[col] !== value);
      return q;
    },
    lt(col: string, value: unknown) {
      filters.push((row) => row[col] != null && compare(row[col], value) < 0);
      return q;
    },
    gt(col: string, value: unknown) {
      filters.push((row) => row[col] != null && compare(row[col], value) > 0);
      return q;
    },
    order(col: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
      orders.push({
        col,
        ascending: options.ascending !== false,
        nullsFirst: options.nullsFirst === true,
      });
      return q;
    },
    limit(n: number) {
      limitN = n;
      return q;
    },
    update(next: Row) {
      mode = "update";
      patch = next;
      return q;
    },
    insert(next: Row | Row[]) {
      mode = "insert";
      inserted = (Array.isArray(next) ? next : [next]).map((row) => ({
        id: row.id ?? crypto.randomUUID(),
        ...row,
      }));
      return q;
    },
    maybeSingle() {
      const result = run();
      const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
      return Promise.resolve({ data, error: result.error });
    },
    single() {
      return q.maybeSingle();
    },
    then(resolve: (value: { data: any; error: any }) => unknown, reject?: (e: unknown) => unknown) {
      try {
        return Promise.resolve(run()).then(resolve, reject);
      } catch (error) {
        return Promise.reject(error).then(resolve, reject);
      }
    },
  };
  return q;
}

export function makeFakeDb(
  tables: Record<string, Row[]>,
  rpcHandlers: Record<string, RpcHandler> = {},
  options: { users?: Record<string, { email: string }> } = {},
): FakeDb {
  const db: FakeDb = {
    tables,
    rpcs: [],
    updates: [],
    inserts: [],
    client: null,
  };
  db.client = {
    from: (table: string) => builder(db, table),
    rpc: (name: string, args: Record<string, any> = {}) => {
      db.rpcs.push({ name, args });
      const handler = rpcHandlers[name];
      if (!handler) {
        return Promise.resolve({
          data: null,
          error: { code: "PGRST202", message: `fake: no rpc ${name}` },
        });
      }
      return Promise.resolve(handler(args, db));
    },
    auth: {
      admin: {
        getUserById: (id: string) =>
          Promise.resolve({
            data: { user: options.users?.[id] ? { id, ...options.users[id] } : null },
            error: null,
          }),
      },
    },
  };
  return db;
}

// The real transition matrix (20271108003040) as a faithful CAS: the row moves
// only from an allowed status along an allowed edge; otherwise it is returned
// unchanged, exactly like cover_video_transition_job.
export const READY_FAIL_CODES = [
  "ready_unclaimed",
  "target_deleted",
  "creative_materialize_failed",
  "creative_source_untrusted",
];
export const transitionJobHandler: RpcHandler = (args, db) => {
  const job = (db.tables.event_cover_video_jobs ?? []).find((row) => row.id === args.p_job_id);
  if (!job) return { data: null, error: null };
  const from = String(job.status);
  const to = String(args.p_to_status);
  const patch = (args.p_patch ?? {}) as Row;
  const edges: Record<string, string[]> = {
    source_uploading: ["source_uploaded", "failed", "cancelled", "superseded"],
    source_uploaded: ["processing_queued", "processing", "ready", "failed", "cancelled", "superseded"],
    processing_queued: ["processing", "ready", "failed", "cancelled", "superseded"],
    processing: ["ready", "failed", "cancelled", "superseded"],
    ready: ["ready"],
  };
  const allowed = (args.p_from_statuses as string[]).includes(from) &&
    !["cancelled", "superseded", "applied"].includes(from) &&
    ((edges[from] ?? []).includes(to) ||
      (from === "ready" && to === "failed" && READY_FAIL_CODES.includes(String(patch.failure_code))));
  if (allowed) {
    Object.assign(job, patch, { status: to });
    if (["ready", "failed", "cancelled", "superseded", "applied"].includes(to)) {
      job.completed_at ??= new Date().toISOString();
    }
  }
  return { data: { ...job }, error: null };
};

export const applyOnceHandler: RpcHandler = (args, db) => {
  const job = (db.tables.event_cover_video_jobs ?? []).find((row) => row.id === args.p_job_id);
  if (!job) return { data: null, error: null };
  if (job.status === "applied") return { data: { ...job }, error: null };
  if (
    job.status !== "ready" || job.processed_url !== args.p_expected_url ||
    (job.application_version ?? 0) !== args.p_expected_version ||
    (["venue_draft", "ad_creative"].includes(job.target_kind) &&
      args.p_expected_requested_by != null && job.requested_by !== args.p_expected_requested_by)
  ) return { data: { ...job }, error: null };
  if (job.target_kind === "ad_creative") {
    const n = (db.tables.ad_creatives ?? []).filter((row) => row.source_job_id === job.id).length;
    if (n !== 1) return { data: { ...job }, error: null };
  }
  Object.assign(job, {
    status: "applied",
    applied_at: new Date().toISOString(),
    application_version: (job.application_version ?? 0) + 1,
    application_receipt: { processedUrl: job.processed_url },
  });
  return { data: { ...job }, error: null };
};

export const withEnv = async (
  env: Record<string, string>,
  fn: () => Promise<void>,
): Promise<void> => {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = Deno.env.get(key);
    Deno.env.set(key, value);
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
};

export const withFetch = async (
  impl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> => {
  const original = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
};

export const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

export const isoAgo = (ms: number): string => new Date(Date.now() - ms).toISOString();
