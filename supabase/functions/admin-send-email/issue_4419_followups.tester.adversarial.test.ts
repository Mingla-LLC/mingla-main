// Issue #4419 follow-ups — tester adversarial (mingla-tester, L3). Angles the
// implementor suite does not take:
//
//   TF-1 a person deferred by a 429 storm is sent exactly once when the next
//        run comes back to them, under the same idempotency key every try; the
//        people already accepted are never sent again
//   TF-2 a normal 40-person batch paces its starts >= 200 ms apart and its
//        pacing alone stays far inside one cron minute
//
// FAILS-ON-REVERT: re-sending accepted deliveries or changing the idempotency
// key per try reds TF-1; dropping `await paceSend()` reds TF-2.
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.env.set("SUPABASE_URL", "https://issue4419f.supabase.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key-4419f");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-4419f");
Deno.env.set("RESEND_API_KEY", "re_test_issue_4419f");
Deno.env.set("UNSUBSCRIBE_TOKEN_SECRET", "issue-4419-unsubscribe-secret-long-enough-for-tests");
Deno.env.set("MINGLA_LOGO_URL", "https://usemingla.com/email-logo.png");
Deno.env.set("MINGLA_FOOTER_ADDRESS", "Mingla, hello@usemingla.com");

const {
  ADMIN_SEND_MIN_INTERVAL_MS,
  ADMIN_SEND_REQUESTS_PER_SECOND,
  RESEND_ACCOUNT_LIMIT_PER_SECOND,
  SNAPSHOT_MAX_ATTEMPTS,
  pacing,
  processClaimedCampaign,
  resetSendPacer,
  sendCampaignTest,
} = await import("./index.ts");

type Row = Record<string, unknown>;
const CAMPAIGN = "44190000-0000-4000-8000-0000000000f1";
const ADMIN_ID = "44190000-0000-4000-8000-0000000000a1";
const words = { id: "words", type: "rich_text", html: "<p>Hi {first_name}</p>" };
const GOOD_DOC = { version: 1, blocks: [words] };

function fakeDb(opts: { campaign: Row; deliveries: Row[]; reserve?: "ok" | "error" }) {
  const log: Row = { ...opts.campaign };
  const state = {
    deliveries: opts.deliveries.map((d) => ({ ...d })),
    audits: [] as Row[],
    deletedAudits: [] as unknown[],
    reserveCalls: 0,
    auditSelects: 0,
  };
  const chain = (table: string) => {
    const filters: Array<[string, string, unknown]> = [];
    let op = "select";
    let patch: Row = {};
    let head = false;
    const match = (r: Row) =>
      filters.every(([k, c, v]) =>
        k === "eq" ? String(r[c]) === String(v) : k === "in" ? (v as unknown[]).includes(r[c]) : true
      );
    const run = () => {
      if (table === "admin_email_log") {
        if (op === "update") { Object.assign(log, patch); return { data: [log], error: null }; }
        return { data: [log], error: null };
      }
      if (table === "admin_email_recipient_deliveries") {
        const rows = state.deliveries.filter(match);
        if (op === "update") { for (const r of rows) Object.assign(r, patch); return { data: null, error: null }; }
        return { data: head ? null : rows, error: null, count: rows.length };
      }
      if (table === "admin_audit_log") {
        if (op === "delete") { state.deletedAudits.push(filters[0][2]); return { data: null, error: null }; }
        state.auditSelects += 1;
        return { data: [], error: null, count: 0 };
      }
      return { data: [], error: null }; // suppression lists, blog posts
    };
    const c: Record<string, unknown> = {};
    for (const m of ["order", "range", "limit", "not", "lte", "or", "ilike", "gte", "is"]) c[m] = () => c;
    c.select = (_x?: string, o?: { head?: boolean }) => { head = Boolean(o?.head); return c; };
    c.update = (p: Row) => { op = "update"; patch = p; return c; };
    c.delete = () => { op = "delete"; return c; };
    c.eq = (col: string, v: unknown) => { filters.push(["eq", col, v]); return c; };
    c.in = (col: string, v: unknown[]) => { filters.push(["in", col, v]); return c; };
    c.maybeSingle = () => { const r = run(); return Promise.resolve({ data: (r.data as unknown[] | null)?.[0] ?? null, error: r.error }); };
    c.single = c.maybeSingle;
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(res(run()));
    return c;
  };
  const client = {
    from: (t: string) => chain(t),
    rpc(fn: string, p: Row = {}) {
      if (fn === "claim_admin_email_delivery_batch") {
        const due = state.deliveries.filter((d) => d.status === "pending" || d.status === "retrying");
        for (const d of due) { d.status = "sending"; d.attempts = Number(d.attempts ?? 0) + 1; }
        return Promise.resolve({ data: due.map((d) => ({ ...d })), error: null });
      }
      if (fn === "issue_4419_admin_email_test_send_reserve") {
        state.reserveCalls += 1;
        if (opts.reserve === "error") return Promise.resolve({ data: null, error: { message: "audit down" } });
        // The SQL function: count and write in one step.
        const used = state.audits.filter((a) => a.actor === p.p_actor).length;
        if (used >= Number(p.p_limit)) return Promise.resolve({ data: null, error: null });
        const id = `a${state.audits.length + 1}`;
        state.audits.push({ id, actor: p.p_actor });
        return Promise.resolve({ data: id, error: null });
      }
      if (fn === "admin_people_directory") {
        const c: Record<string, unknown> = {};
        for (const m of ["select", "eq", "limit"]) c[m] = () => c;
        c.maybeSingle = () => Promise.resolve({ data: null, error: null });
        return c;
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
  return { client: client as never, state, log };
}

const campaignRow = (extra: Row = {}): Row => ({
  id: CAMPAIGN, subject: "Hello {first_name}", body: "Hi", body_document: GOOD_DOC,
  status: "sending", started_at: "2026-11-13T09:00:00.000Z", processing_started_at: "2026-11-13T09:00:00.000Z",
  rendered_at: null, rendered_document: null, sent_count: 0, snapshot_attempts: 0, created_at: "2026-11-12T10:00:00.000Z",
  recipient_type: "bulk", timezone: "UTC", ...extra,
});
const deliveries = (n: number, extra: Row = {}): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `d${i + 1}`, campaign_id: CAMPAIGN, recipient_email: `p${i + 1}@example.com`, status: "pending", attempts: 0,
    created_at: new Date().toISOString(), personalization: { email: `p${i + 1}@example.com`, first_name: `P${i + 1}` }, ...extra,
  }));

/** A virtual clock: sleep advances it, every fetch is stamped with it. */
function virtualTime(respond: (n: number) => Response) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const stamps: number[] = [];
  const realNow = pacing.now;
  const realSleep = pacing.sleep;
  pacing.now = () => t;
  pacing.sleep = (ms: number) => { sleeps.push(ms); t += ms; return Promise.resolve(); };
  resetSendPacer();
  const original = globalThis.fetch;
  globalThis.fetch = (() => { stamps.push(t); return Promise.resolve(respond(stamps.length)); }) as typeof fetch;
  return {
    sleeps, stamps,
    restore: () => { pacing.now = realNow; pacing.sleep = realSleep; globalThis.fetch = original; resetSendPacer(); },
  };
}
const ok = (n: number) => new Response(JSON.stringify({ id: `re-${n}` }), { status: 200 });


function recordFetch(respond: (deliveryKey: string, n: number) => Response) {
  let t = 2_000_000;
  const calls: Array<{ key: string; at: number }> = [];
  const realNow = pacing.now;
  const realSleep = pacing.sleep;
  pacing.now = () => t;
  pacing.sleep = (ms: number) => { t += ms; return Promise.resolve(); };
  resetSendPacer();
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
    const key = String((init?.headers as Record<string, string>)["Idempotency-Key"]);
    calls.push({ key, at: t });
    return Promise.resolve(respond(key, calls.length));
  }) as typeof fetch;
  return { calls, now: () => t, restore: () => { pacing.now = realNow; pacing.sleep = realSleep; globalThis.fetch = original; resetSendPacer(); } };
}

Deno.test("TF-1 a deferred person is sent once when the drain comes back; nobody else is sent again", async () => {
  let storm = true;
  const rec = recordFetch((key) =>
    storm && key === "admin-email-d2"
      ? new Response('{"message":"Too many requests"}', { status: 429, headers: { "retry-after": "1" } })
      : new Response(JSON.stringify({ id: `re-${key}` }), { status: 200 })
  );
  try {
    const row = campaignRow({ rendered_at: "2026-11-13T09:00:01Z", rendered_document: GOOD_DOC });
    const db = fakeDb({ campaign: row, deliveries: deliveries(3) });
    await processClaimedCampaign(db.client, row as never);
    assertEquals(db.state.deliveries.map((d) => d.status), ["accepted", "retrying", "accepted"]);
    assertEquals(db.log.status, "sending", "parked until the deferred person is due (P2-1)");
    storm = false;
    await processClaimedCampaign(db.client, { ...db.log, status: "sending" } as never);
    await processClaimedCampaign(db.client, { ...db.log, status: "sending" } as never);
    assertEquals(db.state.deliveries.map((d) => d.status), ["accepted", "accepted", "accepted"]);
    const byKey = new Map<string, number>();
    for (const c of rec.calls) byKey.set(c.key, (byKey.get(c.key) ?? 0) + 1);
    assertEquals(byKey.get("admin-email-d1"), 1, "d1 sent once");
    assertEquals(byKey.get("admin-email-d3"), 1, "d3 sent once");
    // d2: three refused tries in run 1, one accepted try in run 2, all under one key.
    assertEquals(byKey.get("admin-email-d2"), 4);
    assertEquals([...byKey.keys()].sort(), ["admin-email-d1", "admin-email-d2", "admin-email-d3"]);
    assertEquals(db.log.status, "completed");
  } finally { rec.restore(); }
});

Deno.test("TF-2 a normal 40-person batch is paced >= 200 ms apart and its pacing fits one cron minute", async () => {
  const rec = recordFetch((key) => new Response(JSON.stringify({ id: `re-${key}` }), { status: 200 }));
  try {
    const row = campaignRow({ rendered_at: "2026-11-13T09:00:01Z", rendered_document: GOOD_DOC });
    const db = fakeDb({ campaign: row, deliveries: deliveries(40) });
    const t0 = rec.now();
    await processClaimedCampaign(db.client, row as never);
    assertEquals(rec.calls.length, 40);
    for (let i = 1; i < rec.calls.length; i += 1) {
      assert(rec.calls[i].at - rec.calls[i - 1].at >= ADMIN_SEND_MIN_INTERVAL_MS, `gap ${i}`);
    }
    const pacedMs = rec.now() - t0;
    assert(pacedMs >= 39 * ADMIN_SEND_MIN_INTERVAL_MS, `paced ${pacedMs}`);
    assert(pacedMs < 15_000, `pacing alone took ${pacedMs} ms`);
  } finally { rec.restore(); }
});
