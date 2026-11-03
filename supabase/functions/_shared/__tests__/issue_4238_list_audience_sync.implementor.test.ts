// Issue #4238 wave 2 — T8: the list-audience delta sync against fake
// providers and an in-memory database. No provider is ever called.

import {
  assert,
  assertEquals,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ListTransport,
  type MemberHashRow,
  type ProviderListFact,
  syncListAudiences,
} from "../adListAudienceProvider.ts";
import type { ListPlatform } from "../adListAudienceRules.ts";

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
    const def = this.tables.ad_list_audiences.find((r) => r.id === args.p_audience_id);
    return Promise.resolve({ data: { member_count: def?.member_count ?? 0 }, error: null });
  }
}

const hex = (n: number, seed = "a") => (seed + n.toString(16)).padStart(64, "0").slice(-64);

function members(audienceId: string, count: number, addedAt: string, seed = "a"): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    audience_id: audienceId,
    member_key: hex(i, seed),
    email_sha256: hex(i, seed),
    email_google_sha256: null,
    phone_sha256: null,
    phone_e164_sha256: null,
    country: "NG",
    added_at: addedAt,
    removed_at: null,
  }));
}

type Call = { platform: string; op: string; providerId?: string; n?: number; hashes?: string[] };

function fakeTransport(
  platform: ListPlatform,
  calls: Call[],
  opts: { createError?: unknown; readState?: ProviderListFact["state"] } = {},
): ListTransport {
  let created = 0;
  return {
    connectionId: `conn-${platform}`,
    createList: (_name) => {
      if (opts.createError) return Promise.reject(opts.createError);
      created += 1;
      calls.push({ platform, op: "create" });
      return Promise.resolve({ providerAudienceId: `${platform}-aud-${created}`, approxSize: null, state: "syncing" });
    },
    createLookalike: (_name, seed, country) => {
      calls.push({ platform, op: `lookalike:${seed}:${country}` });
      return Promise.resolve({ providerAudienceId: `${platform}-lal`, approxSize: null, state: "syncing" });
    },
    send: (providerId, action, rows: MemberHashRow[]) => {
      calls.push({
        platform,
        op: action,
        providerId,
        n: rows.length,
        hashes: rows.map((r) => String(r.email_sha256)),
      });
      return Promise.resolve();
    },
    read: (providerId) =>
      Promise.resolve({ providerAudienceId: providerId, approxSize: 200, state: opts.readState ?? "ready" }),
    remove: (providerId) => {
      calls.push({ platform, op: "delete", providerId });
      return Promise.resolve();
    },
  };
}

const T0 = Date.parse("2026-11-03T03:47:00Z");
const RECENT = new Date(T0 - 3_600_000).toISOString();

function definition(id: string, key: string, count: number, extra: Row = {}): Row {
  return {
    id,
    audience_key: key,
    owner_kind: "host",
    brand_id: "b1",
    kind: "list",
    source: "guests",
    display_name: "Your past guests",
    member_count: count,
    member_count_by_country: { NG: count },
    members_refreshed_at: RECENT,
    requested_at: RECENT,
    last_used_at: null,
    status: "active",
    lookalike_country: null,
    seed_audience_id: null,
    ...extra,
  };
}

function baseTables(defs: Row[], memberRows: Row[] = [], extra: Record<string, Row[]> = {}) {
  return {
    ad_list_audiences: defs,
    ad_list_audience_members: memberRows,
    ad_list_audience_platforms: [],
    ad_platform_audience_terms: [],
    ad_list_audience_sync_runs: [],
    brands: [{ id: "b1", name: "Room 27", deleted_at: null }],
    ...extra,
  };
}

function lines() {
  const out: Row[] = [];
  return { out, log: (line: Row) => out.push(line) };
}

Deno.test("T8 SC-10 below the minimum: no provider audience, needed_count recorded", async () => {
  const db = new FakeDb(baseTables([definition("a1", "brand:b1:guests", 50)]));
  const calls: Call[] = [];
  const { log } = lines();
  await syncListAudiences({
    db,
    kind: "daily",
    transports: { meta: fakeTransport("meta", calls), snapchat: fakeTransport("snapchat", calls) },
    redditEnabled: false,
    now: () => T0,
    log,
  });
  assertEquals(calls, []);
  const rows = db.tables.ad_list_audience_platforms;
  assertEquals(rows.find((r) => r.platform === "meta")?.state, "below_minimum");
  assertEquals(rows.find((r) => r.platform === "meta")?.needed_count, 50);
  assertEquals(rows.find((r) => r.platform === "snapchat")?.needed_count, 950);
});

Deno.test("T8 create + full upload, then a delta: removes then only new adds", async () => {
  const day0 = new Date(T0 - 2 * 86_400_000).toISOString();
  const db = new FakeDb(baseTables(
    [definition("a1", "brand:b1:guests", 120)],
    members("a1", 120, day0),
  ));
  const calls: Call[] = [];
  await syncListAudiences({ db, kind: "daily", transports: { meta: fakeTransport("meta", calls) }, redditEnabled: false, now: () => T0 });
  assertEquals(calls.map((c) => c.op), ["create", "add"]);
  assertEquals(calls[1].n, 120);
  const state = db.tables.ad_list_audience_platforms[0];
  assertEquals(state.provider_audience_id, "meta-aud-1");
  // #4238 P1-1: synced through the snapshot's own database time.
  assertEquals(state.synced_through, RECENT);

  // A day later: one person leaves (opt-out), two join. The refresh stamps
  // both, and members_refreshed_at, with one database now().
  const T1 = T0 + 86_400_000;
  const refreshAt = new Date(T1 - 1_800_000).toISOString();
  const leaver = db.tables.ad_list_audience_members[3];
  leaver.removed_at = refreshAt;
  db.tables.ad_list_audience_members.push(...members("a1", 2, refreshAt, "b"));
  db.tables.ad_list_audiences[0].members_refreshed_at = refreshAt;
  calls.length = 0;
  await syncListAudiences({ db, kind: "daily", transports: { meta: fakeTransport("meta", calls) }, redditEnabled: false, now: () => T1 });
  assertEquals(calls.map((c) => `${c.op}:${c.n}`), ["remove:1", "add:2"]);
  assertEquals(calls[0].hashes, [String(leaver.email_sha256)]);
});

Deno.test("T8 SC-3 a removals pass sends the REMOVE to every synced platform and owes adds to the daily run", async () => {
  const day0 = new Date(T0 - 2 * 86_400_000).toISOString();
  const memberRows = members("a1", 1200, day0);
  const db = new FakeDb(baseTables([definition("a1", "brand:b1:guests", 1200)], memberRows));
  const calls: Call[] = [];
  const transports = {
    meta: fakeTransport("meta", calls),
    snapchat: fakeTransport("snapchat", calls),
    tiktok: fakeTransport("tiktok", calls),
  };
  await syncListAudiences({ db, kind: "daily", transports, redditEnabled: false, now: () => T0 });
  const leaver = memberRows[7];
  const refreshAt = new Date(T0 + 600_000).toISOString();
  leaver.removed_at = refreshAt;
  db.tables.ad_list_audiences[0].member_count = 1199;
  db.tables.ad_list_audiences[0].members_refreshed_at = refreshAt;
  db.tables.ad_list_audience_members.push(...members("a1", 1, refreshAt, "c"));
  calls.length = 0;
  await syncListAudiences({ db, kind: "removals", transports, redditEnabled: false, now: () => T0 + 3_600_000 });
  const removes = calls.filter((c) => c.op === "remove");
  assertEquals(removes.map((c) => c.platform).sort(), ["meta", "snapchat", "tiktok"]);
  for (const call of removes) assertEquals(call.hashes, [String(leaver.email_sha256)]);
  assertEquals(calls.filter((c) => c.op === "add").length, 0, "removals-only pass sends no adds");
  // The daily run still sends the owed add.
  calls.length = 0;
  await syncListAudiences({ db, kind: "daily", transports, redditEnabled: false, now: () => T0 + 86_400_000 });
  assertEquals(calls.filter((c) => c.op === "add").map((c) => c.n), [1, 1, 1]);
});

Deno.test("T8 SC-11 Meta terms not accepted: nothing uploaded, row reads terms_required", async () => {
  const db = new FakeDb(baseTables(
    [definition("a1", "brand:b1:guests", 500)],
    members("a1", 500, RECENT),
    { ad_platform_audience_terms: [{ connection_id: "conn-meta", platform: "meta", state: "not_accepted" }] },
  ));
  const calls: Call[] = [];
  await syncListAudiences({ db, kind: "daily", transports: { meta: fakeTransport("meta", calls) }, redditEnabled: false, now: () => T0 });
  assertEquals(calls, []);
  assertEquals(db.tables.ad_list_audience_platforms[0].state, "terms_required");
});

Deno.test("T8 SC-11 a Meta 200/1870090 terms error records not_accepted and does not retry", async () => {
  const db = new FakeDb(baseTables(
    [definition("a1", "brand:b1:guests", 500), definition("a2", "brand:b1:contacts", 500)],
    [...members("a1", 500, RECENT), ...members("a2", 500, RECENT, "d")],
  ));
  const calls: Call[] = [];
  let attempts = 0;
  const transport = fakeTransport("meta", calls, {
    createError: { code: 200, subcode: 1870090, message: "Custom Audience Terms Not Accepted" },
  });
  const counted: ListTransport = {
    ...transport,
    createList: (name) => {
      attempts += 1;
      return transport.createList(name);
    },
  };
  await syncListAudiences({ db, kind: "daily", transports: { meta: counted }, redditEnabled: false, now: () => T0 });
  assertEquals(attempts, 1, "the platform stops for this run: no retry storm");
  assertEquals(db.tables.ad_list_audience_platforms.find((r) => r.audience_id === "a2")?.state, "terms_required");
  assertEquals(db.tables.ad_platform_audience_terms[0].state, "not_accepted");
});

Deno.test("T8 TikTok: a REMOVE that would leave fewer than 1,000 deletes the audience", async () => {
  const memberRows = members("a1", 1000, new Date(T0 - 2 * 86_400_000).toISOString());
  const db = new FakeDb(baseTables([definition("a1", "brand:b1:guests", 1000)], memberRows));
  const calls: Call[] = [];
  await syncListAudiences({ db, kind: "daily", transports: { tiktok: fakeTransport("tiktok", calls) }, redditEnabled: false, now: () => T0 });
  memberRows[0].removed_at = new Date(T0 + 1000).toISOString();
  db.tables.ad_list_audiences[0].member_count = 999;
  db.tables.ad_list_audiences[0].members_refreshed_at = memberRows[0].removed_at;
  calls.length = 0;
  await syncListAudiences({ db, kind: "removals", transports: { tiktok: fakeTransport("tiktok", calls) }, redditEnabled: false, now: () => T0 + 3_600_000 });
  assertEquals(calls.map((c) => c.op), ["delete"]);
  const state = db.tables.ad_list_audience_platforms[0];
  assertEquals(state.state, "too_small");
  assertEquals(state.provider_audience_id, null);
});

Deno.test("T8 SC-14 a run over budget returns more + cursor; the next run resumes without duplicate adds", async () => {
  const defs = ["a1", "a2", "a3"].map((id) => definition(id, `brand:b1:${id}`, 150));
  const memberRows = defs.flatMap((d, i) => members(String(d.id), 150, RECENT, "abc"[i]));
  const db = new FakeDb(baseTables(defs, memberRows));
  const calls: Call[] = [];
  let clock = T0;
  const now = () => clock;
  const transport = fakeTransport("meta", calls);
  const slow: ListTransport = {
    ...transport,
    createList: (name) => {
      clock += 30_000; // each create takes 30 s of the 40 s budget
      return transport.createList(name);
    },
  };
  const first = await syncListAudiences({ db, kind: "daily", transports: { meta: slow }, redditEnabled: false, now, budgetMs: 40_000 });
  assertEquals(first.more, true);
  assert(first.cursor?.after);
  const firstAdds = calls.filter((c) => c.op === "add").map((c) => c.providerId);
  const runRow = db.tables.ad_list_audience_sync_runs.at(-1)!;
  assertEquals(runRow.more, true);
  clock = T0 + 60_000;
  const second = await syncListAudiences({
    db,
    kind: "daily",
    transports: { meta: slow },
    redditEnabled: false,
    now,
    budgetMs: 400_000,
    cursor: first.cursor,
  });
  assertEquals(second.more, false);
  const allAdds = calls.filter((c) => c.op === "add").map((c) => c.providerId);
  assertEquals(new Set(allAdds).size, allAdds.length, "no audience received its full upload twice");
  assertEquals(allAdds.length, 3);
  assert(firstAdds.length >= 1);
});

Deno.test("T8 Reddit off and Google ineligible: no calls, plain states", async () => {
  const db = new FakeDb(baseTables([definition("a1", "brand:b1:guests", 5000)], members("a1", 5000, RECENT)));
  const calls: Call[] = [];
  await syncListAudiences({
    db,
    kind: "daily",
    transports: { reddit: fakeTransport("reddit", calls), google: fakeTransport("google", calls) },
    redditEnabled: false,
    now: () => T0,
  });
  assertEquals(calls, []);
  const rows = db.tables.ad_list_audience_platforms;
  assertEquals(rows.find((r) => r.platform === "reddit")?.state, "unsupported");
  assertEquals(rows.find((r) => r.platform === "google")?.state, "ineligible");
});

Deno.test("T8 Google eligible but unconfirmed terms: terms_required, nothing sent", async () => {
  const db = new FakeDb(baseTables(
    [definition("a1", "brand:b1:guests", 5000)],
    members("a1", 5000, RECENT),
    { ad_platform_audience_terms: [{ connection_id: "conn-google", platform: "google", eligibility: "eligible", state: "unknown", admin_confirmed_at: null }] },
  ));
  const calls: Call[] = [];
  await syncListAudiences({ db, kind: "daily", transports: { google: fakeTransport("google", calls) }, redditEnabled: false, now: () => T0 });
  assertEquals(calls, []);
  assertEquals(db.tables.ad_list_audience_platforms[0].state, "terms_required");
});

Deno.test("T8 SC-12 a lookalike waits for a ready seed and the per-country minimum", async () => {
  const seed = definition("s1", "brand:b1:seed", 99, { member_count_by_country: { NG: 99 }, source: "seed" });
  const lal = definition("l1", "brand:b1:lookalike:NG", 99, {
    kind: "lookalike",
    seed_audience_id: "s1",
    lookalike_country: "NG",
  });
  const db = new FakeDb(baseTables([seed, lal], members("s1", 99, RECENT)));
  const calls: Call[] = [];
  await syncListAudiences({ db, kind: "daily", transports: { meta: fakeTransport("meta", calls) }, redditEnabled: false, now: () => T0 });
  const lalRow = db.tables.ad_list_audience_platforms.find((r) => r.audience_id === "l1");
  assertEquals(lalRow?.state, "below_minimum");
  assertEquals(lalRow?.needed_count, 1);
  assertEquals(calls.filter((c) => c.op.startsWith("lookalike")), []);

  // 120 NG seed members, seed synced and ready: the lookalike is created.
  db.tables.ad_list_audiences[0].member_count = 120;
  db.tables.ad_list_audiences[0].member_count_by_country = { NG: 120 };
  db.tables.ad_list_audience_members.push(...members("s1", 21, RECENT, "e"));
  await syncListAudiences({ db, kind: "daily", transports: { meta: fakeTransport("meta", calls) }, redditEnabled: false, now: () => T0 + 1000 });
  await syncListAudiences({ db, kind: "daily", transports: { meta: fakeTransport("meta", calls) }, redditEnabled: false, now: () => T0 + 2000 });
  assert(calls.some((c) => c.op === "lookalike:meta-aud-1:NG"));
});

Deno.test("T8 retired definitions and deleted brands delete their provider audiences", async () => {
  const db = new FakeDb(baseTables([definition("a1", "brand:b1:guests", 500)], members("a1", 500, RECENT)));
  const calls: Call[] = [];
  await syncListAudiences({ db, kind: "daily", transports: { meta: fakeTransport("meta", calls) }, redditEnabled: false, now: () => T0 });
  db.tables.brands[0].deleted_at = new Date(T0).toISOString();
  calls.length = 0;
  await syncListAudiences({ db, kind: "daily", transports: { meta: fakeTransport("meta", calls) }, redditEnabled: false, now: () => T0 + 1000 });
  assertEquals(calls.map((c) => c.op), ["delete"]);
  assertEquals(db.tables.ad_list_audience_platforms[0].state, "retired");
});

Deno.test("T8 logs carry only key, platform, counts and a code: never a hash or an address", async () => {
  const db = new FakeDb(baseTables([definition("a1", "brand:b1:guests", 150)], members("a1", 150, RECENT)));
  const { out, log } = lines();
  const consoleLines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => consoleLines.push(args.map(String).join(" "));
  try {
    await syncListAudiences({ db, kind: "daily", transports: { meta: fakeTransport("meta", []) }, redditEnabled: false, now: () => T0, log });
    await syncListAudiences({ db, kind: "daily", transports: { meta: fakeTransport("meta", []) }, redditEnabled: false, now: () => T0 + 86_400_000 });
  } finally {
    console.log = original;
  }
  for (const line of out) {
    assertEquals(Object.keys(line).sort(), ["adds", "audience_key", "error_code", "platform", "removes"]);
  }
  for (const text of [...out.map((l) => JSON.stringify(l)), ...consoleLines]) {
    assertNotMatch(text, /[0-9a-f]{64}/);
    assertNotMatch(text, /@/);
    assertNotMatch(text, /\+\d{8,}/);
  }
  assertEquals(db.tables.ad_list_audience_sync_runs.length, 2);
  assertEquals(
    Object.keys(db.tables.ad_list_audience_sync_runs[0]).sort(),
    ["adds", "audiences_refreshed", "cursor", "errors", "finished_at", "kind", "more", "removes", "started_at"],
  );
});

// #4238 P1-1: the bound is database time from AFTER the refresh, kept as the
// database's own string (microseconds included), not the worker's run start.
Deno.test("T8 P1-1 a refresh during the pass bounds the delta by its database time", async () => {
  const day0 = new Date(T0 - 2 * 86_400_000).toISOString();
  const memberRows = members("a1", 150, day0);
  const db = new FakeDb(baseTables(
    [definition("a1", "brand:b1:guests", 150, { members_refreshed_at: null })],
    memberRows,
    {
      ad_list_audience_platforms: [{
        audience_id: "a1", platform: "meta", connection_id: "conn-meta",
        provider_audience_id: "meta-aud-1", state: "ready", synced_through: day0,
      }],
    },
  ));
  const dbNow = "2026-11-03T03:47:00.250731+00:00"; // after the run start (T0)
  db.rpc = (name: string, args: Row) => {
    db.rpcs.push(name);
    if (name === "ad_list_audience_refresh" && args.p_audience_id === "a1") {
      memberRows[4].removed_at = dbNow;
      db.tables.ad_list_audiences[0].members_refreshed_at = dbNow;
    }
    return Promise.resolve({ data: { member_count: 149 }, error: null });
  };
  const calls: Call[] = [];
  await syncListAudiences({ db, kind: "removals", transports: { meta: fakeTransport("meta", calls) }, redditEnabled: false, now: () => T0 });
  assertEquals(calls.filter((c) => c.op === "remove").flatMap((c) => c.hashes ?? []), [String(memberRows[4].email_sha256)]);
  assertEquals(db.tables.ad_list_audience_platforms[0].synced_through, day0, "a removals pass keeps synced_through");
  calls.length = 0;
  await syncListAudiences({ db, kind: "daily", transports: { meta: fakeTransport("meta", calls) }, redditEnabled: false, now: () => T0 + 1000 });
  assertEquals(db.tables.ad_list_audience_platforms[0].synced_through, dbNow);
});

// #4238 P2-2: the provider audience id is kept the moment it exists.
Deno.test("T8 P2-2 a refused first upload keeps the new provider audience id; the next run uploads into it", async () => {
  const db = new FakeDb(baseTables([definition("a1", "brand:b1:guests", 150)], members("a1", 150, RECENT)));
  const calls: Call[] = [];
  const base = fakeTransport("meta", calls);
  let refuse = true;
  const meta: ListTransport = {
    ...base,
    send: (id, action, rows) =>
      refuse
        ? Promise.reject({ code: 200, subcode: 1870090, message: "Custom Audience Terms Not Accepted" })
        : base.send(id, action, rows),
  };
  await syncListAudiences({ db, kind: "daily", transports: { meta }, redditEnabled: false, now: () => T0 });
  const row = db.tables.ad_list_audience_platforms[0];
  assertEquals(row.provider_audience_id, "meta-aud-1", "the id survives the refused upload");
  assertEquals(row.state, "terms_required");
  assertEquals(row.synced_through ?? null, null, "nothing counted as synced");
  db.tables.ad_platform_audience_terms[0].state = "accepted";
  refuse = false;
  calls.length = 0;
  await syncListAudiences({ db, kind: "daily", transports: { meta }, redditEnabled: false, now: () => T0 + 86_400_000 });
  assertEquals(calls.filter((c) => c.op === "create").length, 0, "no second audience");
  assertEquals(calls.filter((c) => c.op === "add").map((c) => [c.providerId, c.n]), [["meta-aud-1", 150]]);
});

Deno.test("T8 rework: a row that falls below the minimum drops the stale terms_not_accepted code", async () => {
  const db = new FakeDb(baseTables(
    [definition("a1", "brand:b1:guests", 50)],
    [],
    {
      ad_list_audience_platforms: [{
        audience_id: "a1",
        platform: "meta",
        state: "terms_required",
        error_code: "terms_not_accepted",
        provider_audience_id: null,
        needed_count: null,
      }],
      ad_platform_audience_terms: [{ connection_id: "conn-meta", platform: "meta", state: "accepted" }],
    },
  ));
  const calls: Call[] = [];
  await syncListAudiences({ db, kind: "daily", transports: { meta: fakeTransport("meta", calls) }, redditEnabled: false, now: () => T0 });
  assertEquals(calls, []);
  const row = db.tables.ad_list_audience_platforms.find((r) => r.audience_id === "a1" && r.platform === "meta");
  assertEquals([row?.state, row?.needed_count, row?.error_code], ["below_minimum", 50, null]);
});
