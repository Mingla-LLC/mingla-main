// Issue #3697 — a small in-memory stand-in for the service-role client, used
// by the ad-plan handler tests. It implements only the query shapes the
// Creative Library lifecycle paths use: select / eq / neq / is / in / ilike /
// the library cursor `or`, order, limit, maybeSingle, count+head, and rpc.
// Rows are returned whole (column lists are not projected), which is enough
// to prove what reaches the response.

type Row = Record<string, unknown>;
type RpcHandler = (args: Row) => { data?: unknown; error?: unknown };

const read = (row: Row, column: string): unknown => {
  const [base, path] = column.split("->>");
  if (path === undefined) return row[base];
  const value = row[base];
  return value && typeof value === "object"
    ? (value as Row)[path] ?? null
    : null;
};

const likeToRegExp = (pattern: string): RegExp => {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "\\" && i + 1 < pattern.length) {
      out += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    } else if (char === "%") out += ".*";
    else if (char === "_") out += ".";
    else out += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
};

class Query {
  private filters: ((row: Row) => boolean)[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private max: number | null = null;
  private countOnly = false;

  constructor(private readonly db: FakeAdPlanDb, private readonly table: string) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    this.db.calls.push({ table: this.table, op: "select" });
    if (options?.head) this.countOnly = true;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => read(row, column) === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => read(row, column) !== value);
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push((row) => (read(row, column) ?? null) === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(read(row, column)));
    return this;
  }
  ilike(column: string, pattern: string) {
    const re = likeToRegExp(pattern);
    this.filters.push((row) => re.test(String(read(row, column) ?? "")));
    return this;
  }
  or(expression: string) {
    // Only the library cursor: created_at.lt.X,and(created_at.eq.X,id.lt.Y)
    const match =
      /^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)\)$/
        .exec(expression);
    if (!match) throw new Error(`fake db: unsupported or(${expression})`);
    const [, before, same, id] = match;
    this.filters.push((row) => {
      const createdAt = String(row.created_at);
      return createdAt < before || (createdAt === same && String(row.id) < id);
    });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }
  limit(count: number) {
    this.max = count;
    return this;
  }
  private rows(): Row[] {
    let rows = (this.db.tables[this.table] ?? []).filter((row) =>
      this.filters.every((filter) => filter(row))
    );
    for (const { column, ascending } of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const left = String(read(a, column) ?? "");
        const right = String(read(b, column) ?? "");
        return (left < right ? -1 : left > right ? 1 : 0) * (ascending ? 1 : -1);
      });
    }
    return this.max === null ? rows : rows.slice(0, this.max);
  }
  maybeSingle() {
    const rows = this.rows();
    return Promise.resolve({ data: rows[0] ?? null, error: null });
  }
  single() {
    const rows = this.rows();
    return Promise.resolve(
      rows[0]
        ? { data: rows[0], error: null }
        : { data: null, error: { code: "PGRST116", message: "no rows" } },
    );
  }
  then<T>(resolve: (value: unknown) => T, reject?: (reason: unknown) => T) {
    try {
      const rows = this.rows();
      return Promise.resolve(
        this.countOnly
          ? { data: null, error: null, count: rows.length }
          : { data: rows, error: null, count: rows.length },
      ).then(resolve, reject);
    } catch (error) {
      return Promise.reject(error).then(resolve, reject);
    }
  }
}

export class FakeAdPlanDb {
  calls: { table: string; op: string }[] = [];
  rpcCalls: { name: string; args: Row }[] = [];
  readonly auth: { getUser: (token: string) => Promise<unknown> };

  constructor(
    readonly tables: Record<string, Row[]>,
    readonly rpcs: Record<string, RpcHandler> = {},
    users: Record<string, { id: string; email: string }> = {},
  ) {
    this.auth = {
      getUser: (token: string) =>
        Promise.resolve(
          users[token]
            ? { data: { user: users[token] }, error: null }
            : { data: { user: null }, error: { message: "bad token" } },
        ),
    };
  }

  from(table: string) {
    return new Query(this, table);
  }

  rpc(name: string, args: Row) {
    this.rpcCalls.push({ name, args });
    const handler = this.rpcs[name];
    if (!handler) {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST202", message: `missing ${name}` },
      });
    }
    const result = handler(args);
    return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  }
}

export const ADMIN = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@test.local" };
export const HOST = { id: "a0000000-0000-4000-8000-000000000002", email: "host@test.local" };

export function adminTables(extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    admin_users: [{ id: "admin-row", email: ADMIN.email, status: "active" }],
    ad_creatives: [],
    event_cover_video_jobs: [],
    ad_plan_versions: [],
    ad_plans: [],
    ad_creative_platform_refs: [],
    ads: [],
    ad_sets: [],
    ad_campaigns: [],
    ad_plan_provider_allocations: [],
    profiles: [],
    brands: [],
    ...extra,
  };
}

export async function callAdPlan(
  handler: (req: Request, deps: Record<string, unknown>) => Promise<Response>,
  db: FakeAdPlanDb,
  token: string,
  body: Row,
  deps: Record<string, unknown> = {},
): Promise<{ status: number; body: Row }> {
  const response = await handler(
    new Request("https://edge.test/ad-plan", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { db, ...deps },
  );
  return { status: response.status, body: await response.json() };
}

/** A probe-derived video row. Defaults to a vertical 1080×1920 15 s clip with sound. */
export function videoCreative(overrides: Row = {}): Row {
  return {
    id: "c0000000-0000-4000-8000-000000000001",
    name: "House reel",
    kind: "video",
    status: "active",
    source_url: "https://cdn.test/guid-house-0001/play_1080p.mp4",
    poster_url: "https://cdn.test/guid-house-0001/thumbnail.jpg",
    mp4_master_url: "https://cdn.test/guid-house-0001/play_1080p.mp4",
    bunny_video_id: "guid-house-0001",
    storage_path: null,
    content_hash: "do-not-return",
    mime_type: "video/mp4",
    width: 1080,
    height: 1920,
    aspect_ratio: 0.5625,
    duration_seconds: 15,
    has_audio: true,
    byte_size: 12_000_000,
    ai_generated: false,
    variants: {},
    brand_id: null,
    source: "admin_upload",
    source_brand_id: null,
    source_job_id: "j0000000-0000-4000-8000-000000000001",
    source_job_ref: "j0000000-0000-4000-8000-000000000001",
    rendition_height: 1080,
    created_by: ADMIN.id,
    archived_at: null,
    archived_by: null,
    purged_at: null,
    created_at: "2026-10-18T10:00:00.000Z",
    updated_at: "2026-10-18T10:00:00.000Z",
    ...overrides,
  };
}
