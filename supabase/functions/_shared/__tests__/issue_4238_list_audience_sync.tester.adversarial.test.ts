// Issue #4238 wave 2 — TESTER adversarial: list-audience sync timing and
// provider-audience ownership, against an in-memory database and fake
// providers. No provider is ever called.
//
// A. An opt-out (or any exclusion) latched after a sync is removed from the
//    snapshot by the next hourly pass's refresh; that SAME pass must send the
//    REMOVE. The real refresh stamps removed_at with database time, which is
//    after the worker's run start, so the fake refresh here does the same.
// B. A provider audience created on the platform must never be forgotten: if
//    the first upload fails (Meta terms 200/1870090), the next run after terms
//    are accepted must reuse or delete it, not create a second one (an orphan
//    in Mingla's shared ad account).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ListTransport,
  type MemberHashRow,
  type ProviderListFact,
  syncListAudiences,
} from "../adListAudienceProvider.ts";

type Row = Record<string, unknown>;

class Q {
  private filters: ((row: Row) => boolean)[] = [];
  private orders: string[] = [];
  private window: [number, number] | null = null;
  private op: "select" | "delete" | "update" = "select";
  private patch: Row | null = null;
  constructor(private db: FakeDb, private table: string) {}
  select() {
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  in(c: string, v: unknown[]) {
    this.filters.push((r) => v.includes(r[c]));
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  not(c: string, _op: string, v: unknown) {
    this.filters.push((r) => (r[c] ?? null) !== v);
    return this;
  }
  gt(c: string, v: string) {
    this.filters.push((r) => typeof r[c] === "string" && String(r[c]) > v);
    return this;
  }
  lte(c: string, v: string) {
    this.filters.push((r) => typeof r[c] === "string" && String(r[c]) <= v);
    return this;
  }
  lt(c: string, v: string) {
    this.filters.push((r) => typeof r[c] === "string" && String(r[c]) < v);
    return this;
  }
  order(c: string) {
    this.orders.push(c);
    return this;
  }
  range(from: number, to: number) {
    this.window = [from, to];
    return this;
  }
  limit() {
    return this;
  }
  maybeSingle() {
    return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
  }
  private rows(): Row[] {
    let rows = (this.db.tables[this.table] ??= []).filter((r) =>
      this.filters.every((f) => f(r))
    );
    for (const c of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => String(a[c]).localeCompare(String(b[c])));
    }
    return this.window ? rows.slice(this.window[0], this.window[1] + 1) : rows;
  }
  then<T>(resolve: (v: unknown) => T) {
    const rows = this.rows();
    if (this.op === "delete") {
      this.db.tables[this.table] = this.db.tables[this.table].filter((r) => !rows.includes(r));
      return Promise.resolve({ data: null, error: null }).then(resolve);
    }
    if (this.op === "update") {
      rows.forEach((r) => Object.assign(r, this.patch));
      return Promise.resolve({ data: null, error: null }).then(resolve);
    }
    return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null }).then(resolve);
  }
}

class FakeDb {
  clock = { t: 0 };
  refresh: ((id: string, nowIso: string) => void) | null = null;
  rpcs: string[] = [];
  constructor(public tables: Record<string, Row[]>) {}
  from(table: string) {
    const db = this;
    const q = new Q(this, table);
    return Object.assign(q, {
      upsert(row: Row, opts: { onConflict: string }) {
        const keys = opts.onConflict.split(",");
        const list = (db.tables[table] ??= []);
        const found = list.find((r) => keys.every((k) => r[k] === row[k]));
        if (found) Object.assign(found, row);
        else list.push({ ...row });
        return Promise.resolve({ data: null, error: null });
      },
      insert(row: Row) {
        (db.tables[table] ??= []).push({ ...row });
        return Promise.resolve({ data: null, error: null });
      },
    });
  }
  rpc(name: string, args: Row) {
    this.rpcs.push(name);
    this.clock.t += 25; // database time moves on past the run start
    if (this.refresh) this.refresh(String(args.p_audience_id), new Date(this.clock.t).toISOString());
    const def = this.tables.ad_list_audiences.find((r) => r.id === args.p_audience_id);
    return Promise.resolve({ data: { member_count: def?.member_count ?? 0 }, error: null });
  }
}

const hex = (n: number) => n.toString(16).padStart(64, "0");
const T0 = Date.parse("2026-11-03T05:17:00Z");
const BEFORE = new Date(T0 - 3_600_000).toISOString();
type Call = { op: string; providerId?: string; hashes?: string[] };

function guests(extra: Row = {}): Row {
  return {
    id: "g1", audience_key: "brand:b1:guests", owner_kind: "host", brand_id: "b1",
    kind: "list", source: "guests", display_name: "Your past guests",
    member_count: 150, member_count_by_country: { NG: 150 },
    members_refreshed_at: BEFORE, requested_at: BEFORE, last_used_at: null,
    status: "active", lookalike_country: null, seed_audience_id: null, ...extra,
  };
}
function memberRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    audience_id: "g1", member_key: hex(i + 1), email_sha256: hex(i + 1),
    email_google_sha256: null, phone_sha256: null, phone_e164_sha256: null,
    country: "NG", added_at: new Date(T0 - 2 * 86_400_000).toISOString(), removed_at: null,
  }));
}
function tables(defs: Row[], members: Row[], extra: Record<string, Row[]> = {}) {
  return {
    ad_list_audiences: defs, ad_list_audience_members: members,
    ad_list_audience_platforms: [], ad_platform_audience_terms: [],
    ad_list_audience_sync_runs: [], brands: [{ id: "b1", name: "Room 27", deleted_at: null }],
    ...extra,
  };
}
function transport(calls: Call[], opts: { sendError?: () => unknown } = {}): ListTransport {
  let n = 0;
  return {
    connectionId: "conn-meta",
    createList: () => {
      n += 1;
      calls.push({ op: "create", providerId: `meta-aud-${n}` });
      return Promise.resolve({ providerAudienceId: `meta-aud-${n}`, approxSize: null, state: "syncing" } as ProviderListFact);
    },
    createLookalike: () => Promise.reject(new Error("unused")),
    send: (providerId, action, rows: MemberHashRow[]) => {
      const err = opts.sendError?.();
      if (err) return Promise.reject(err);
      calls.push({ op: action, providerId, hashes: rows.map((r) => String(r.email_sha256)) });
      return Promise.resolve();
    },
    read: (providerId) => Promise.resolve({ providerAudienceId: providerId, approxSize: 150, state: "ready" }),
    remove: (providerId) => {
      calls.push({ op: "delete", providerId });
      return Promise.resolve();
    },
  };
}

Deno.test("A: a buyer excluded after a sync is REMOVED on the very next hourly pass", async () => {
  const members = memberRows(150);
  const db = new FakeDb(tables(
    // Dirty: the opt-out trigger cleared members_refreshed_at.
    [guests({ members_refreshed_at: null })],
    members,
    {
      ad_list_audience_platforms: [{
        audience_id: "g1", platform: "meta", connection_id: "conn-meta",
        provider_audience_id: "meta-aud-1", state: "ready",
        synced_through: BEFORE, last_synced_at: BEFORE,
      }],
    },
  ));
  db.clock.t = T0;
  // The real ad_list_audience_refresh sets removed_at = now() (database time).
  db.refresh = (id, nowIso) => {
    if (id !== "g1") return;
    members[0].removed_at = nowIso;
    db.tables.ad_list_audiences[0].members_refreshed_at = nowIso;
    db.tables.ad_list_audiences[0].member_count = 149;
  };
  const calls: Call[] = [];
  await syncListAudiences({
    db, kind: "removals", transports: { meta: transport(calls) }, redditEnabled: false,
    now: () => db.clock.t, log: () => {},
  });
  assertEquals(db.rpcs.includes("ad_list_audience_refresh"), true, "the dirty audience was refreshed");
  assert(members[0].removed_at !== null, "the refresh removed the opted-out buyer");
  const removed = calls.filter((c) => c.op === "remove").flatMap((c) => c.hashes ?? []);
  assertEquals(
    removed.includes(hex(1)), true,
    "the opted-out buyer's hash must go out as a REMOVE in this pass, not an hour later",
  );
});

Deno.test("B: a Meta audience created before a terms refusal is reused or deleted, never orphaned", async () => {
  const db = new FakeDb(tables([guests({ members_refreshed_at: new Date(T0).toISOString() })], memberRows(150)));
  db.clock.t = T0;
  const calls: Call[] = [];
  let refuse = true;
  const terms = Object.assign(new Error("Custom Audience Terms Not Accepted"), { code: 200, subcode: 1870090 });
  const meta = transport(calls, { sendError: () => (refuse ? terms : null) });
  await syncListAudiences({ db, kind: "daily", transports: { meta }, redditEnabled: false, now: () => db.clock.t, log: () => {} });
  assertEquals(calls.filter((c) => c.op === "create").length, 1, "first run created the provider audience");
  // Admin accepts the terms in Business Manager; Check again records it.
  db.tables.ad_platform_audience_terms[0].state = "accepted";
  refuse = false;
  db.clock.t = T0 + 86_400_000;
  await syncListAudiences({ db, kind: "daily", transports: { meta }, redditEnabled: false, now: () => db.clock.t, log: () => {} });
  const creates = calls.filter((c) => c.op === "create").map((c) => c.providerId);
  const deleted = calls.filter((c) => c.op === "delete").map((c) => c.providerId);
  assert(
    creates.length === 1 || deleted.includes("meta-aud-1"),
    `meta-aud-1 was created, then a second audience ${creates.slice(1).join(",")} was created without deleting it`,
  );
});
