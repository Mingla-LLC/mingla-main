// Issue #4419 follow-ups: the drain stays under Resend's rate limit and treats
// a 429 as "later", an unreadable saved copy gives up after a few tries without
// starving newer email, the final status follows the deliveries Resend
// accepted, and "Send test to me" holds its hourly limit.
//
// MINGLA-INVARIANT: I-4419-DRAIN-PACED-UNDER-RESEND-LIMIT | issue #4419 | Admin email starts at most ADMIN_SEND_REQUESTS_PER_SECOND provider requests a second (half of the account's 10 a second), and a Resend 429 is retried (Retry-After honoured) and never written as a failed delivery inside 24 hours.
//
//   F-1  sends start >= the minimum interval apart; the math stays under the limit
//   F-2  a 429 is retried in the run (Retry-After honoured) and then accepted
//   F-3  a 429 that keeps coming defers the person (not failed, try given back)
//   F-4  an unreadable copy: backoff 1..4, then partial/failed at the 5th try
//   F-5  stale sent_count + unreadable copy: status follows accepted deliveries
//   F-6  test to me: atomic reserve, no JS check-then-count, no send if the
//        reserve fails, slot returned when Resend refuses
//
// FAILS-ON-REVERT: dropping `await paceSend()` from sendViaResend reds F-1;
// treating 429 as an ordinary failure reds F-2 and F-3; dropping the
// SNAPSHOT_MAX_ATTEMPTS cap reds F-4; counting sent_count instead of the
// deliveries in endUnreadableCopy reds F-5; counting audit rows in JS again
// reds F-6.
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
  DRAIN_BUDGET_MS,
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
    created_at: new Date().toISOString(), next_attempt_at: new Date().toISOString(), personalization: { email: `p${i + 1}@example.com`, first_name: `P${i + 1}` }, ...extra,
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

Deno.test("F-1 sends start at least the minimum interval apart, so the rate stays under the limit", async () => {
  assertEquals(RESEND_ACCOUNT_LIMIT_PER_SECOND, 10);
  assert(ADMIN_SEND_REQUESTS_PER_SECOND <= RESEND_ACCOUNT_LIMIT_PER_SECOND / 2, "Admin email takes at most half the account's allowance");
  assertEquals(ADMIN_SEND_MIN_INTERVAL_MS, Math.ceil(1000 / ADMIN_SEND_REQUESTS_PER_SECOND));
  const clock = virtualTime(ok);
  try {
    const db = fakeDb({ campaign: campaignRow({ rendered_at: "2026-11-13T09:00:01Z", rendered_document: GOOD_DOC }), deliveries: deliveries(40) });
    await processClaimedCampaign(db.client, campaignRow({ rendered_at: "2026-11-13T09:00:01Z", rendered_document: GOOD_DOC }) as never);
    assertEquals(clock.stamps.length, 40);
    for (let i = 1; i < clock.stamps.length; i++) {
      assert(clock.stamps[i] - clock.stamps[i - 1] >= ADMIN_SEND_MIN_INTERVAL_MS, `gap ${i}: ${clock.stamps[i] - clock.stamps[i - 1]}ms`);
    }
    // Any one-second window holds at most ADMIN_SEND_REQUESTS_PER_SECOND starts.
    for (let i = 0; i < clock.stamps.length; i++) {
      const inWindow = clock.stamps.filter((s) => s >= clock.stamps[i] && s < clock.stamps[i] + 1000).length;
      assert(inWindow <= ADMIN_SEND_REQUESTS_PER_SECOND, `window at ${i}: ${inWindow}`);
    }
    assertEquals(db.state.deliveries.filter((d) => d.status === "accepted").length, 40);
  } finally { clock.restore(); }
});

Deno.test("F-2 a 429 is retried in the run (Retry-After honoured) and the person is accepted", async () => {
  const clock = virtualTime((n) =>
    n === 1 ? new Response('{"message":"Too many requests"}', { status: 429, headers: { "retry-after": "2" } }) : ok(n)
  );
  try {
    const row = campaignRow({ rendered_at: "2026-11-13T09:00:01Z", rendered_document: GOOD_DOC });
    const db = fakeDb({ campaign: row, deliveries: deliveries(1) });
    await processClaimedCampaign(db.client, row as never);
    assertEquals(clock.stamps.length, 2, "one retry");
    assert(clock.sleeps.includes(2000), `waited Retry-After: ${clock.sleeps}`);
    assertEquals(db.state.deliveries[0].status, "accepted");
  } finally { clock.restore(); }
});

Deno.test("F-3 a 429 that keeps coming defers the person: never failed, the try is given back", async () => {
  const clock = virtualTime(() => new Response('{"message":"Too many requests"}', { status: 429 }));
  try {
    const row = campaignRow({ rendered_at: "2026-11-13T09:00:01Z", rendered_document: GOOD_DOC });
    const db = fakeDb({ campaign: row, deliveries: deliveries(1) });
    await processClaimedCampaign(db.client, row as never);
    const d = db.state.deliveries[0];
    assertEquals(d.status, "retrying");
    assertEquals(d.attempts, 0, "claimed once (1), given back (0)");
    assert(Date.parse(String(d.next_attempt_at)) >= Date.now() + 55_000, "later, not now");
    assertEquals(log(db).status, "sending", "parked until the person is due, not failed");
    // After 24 hours of being refused SINCE SENDING BEGAN it does fail.
    const hours = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    const old = fakeDb({ campaign: campaignRow({ ...row, started_at: hours(25) }), deliveries: deliveries(1) });
    await processClaimedCampaign(old.client, { ...old.log } as never);
    assertEquals(old.state.deliveries[0].status, "failed");
  } finally { clock.restore(); }
});
const log = (db: ReturnType<typeof fakeDb>) => db.log;
const { personalizeText, SAMPLE_RECIPIENT } = await import("./model.ts");

Deno.test("F-4 an unreadable copy backs off, then ends partial or failed at the cap", async () => {
  // copy_missing (rendered_at set, document gone) is the retryable read problem.
  const base = { rendered_at: "2026-11-13T09:00:01Z", rendered_document: null };
  const starts: number[] = [];
  const db = fakeDb({ campaign: campaignRow(base), deliveries: [] });
  for (let i = 1; i < SNAPSHOT_MAX_ATTEMPTS; i++) {
    const r = await processClaimedCampaign(db.client, { ...db.log } as never) as Row;
    assertEquals(r.retry, true);
    assertEquals(db.log.status, "sending");
    assertEquals(db.log.snapshot_attempts, i);
    starts.push(Date.parse(String(db.log.processing_started_at)));
  }
  for (let i = 1; i < starts.length; i++) assert(starts[i] > starts[i - 1], "each try waits longer than the one before");
  // Last try: nobody accepted -> failed, in plain English.
  const end = await processClaimedCampaign(db.client, { ...db.log } as never) as Row;
  assertEquals(end.retry, undefined);
  assertEquals(db.log.status, "failed");
  assert(String(db.log.last_error).startsWith("The saved copy of this email could not be read"), String(db.log.last_error));
  assert(db.log.completed_at);
  assertEquals(db.log.processing_started_at, null);
  // Someone was accepted -> partial.
  const some = fakeDb({
    campaign: campaignRow({ ...base, snapshot_attempts: SNAPSHOT_MAX_ATTEMPTS - 1 }),
    deliveries: deliveries(2, { status: "accepted" }),
  });
  await processClaimedCampaign(some.client, { ...some.log } as never);
  assertEquals(some.log.status, "partial");
  assertEquals(some.log.sent_count, 2);
});

Deno.test("F-5 a stale sent_count never shows Failed when deliveries were accepted", async () => {
  // An unusable stored copy (not a blip) ends the campaign at once.
  const clock = virtualTime(ok);
  try {
    const db = fakeDb({
      campaign: campaignRow({ rendered_at: "2026-11-13T09:00:01Z", rendered_document: { version: 1, blocks: "garbage" }, sent_count: 0 }),
      deliveries: deliveries(3, { status: "accepted" }),
    });
    await processClaimedCampaign(db.client, { ...db.log } as never);
    assertEquals(db.log.status, "partial", "3 accepted, counter said 0");
    assertEquals(db.log.sent_count, 3);
    assertEquals(clock.stamps.length, 0, "nothing more sent");
    const none = fakeDb({
      campaign: campaignRow({ rendered_at: "2026-11-13T09:00:01Z", rendered_document: { version: 1, blocks: "garbage" }, sent_count: 7 }),
      deliveries: deliveries(2, { status: "failed" }),
    });
    await processClaimedCampaign(none.client, { ...none.log } as never);
    assertEquals(none.log.status, "failed", "nobody accepted, counter was stale the other way");
  } finally { clock.restore(); }
});

Deno.test("F-6 test to me: atomic reserve, nothing sent if it fails, slot returned on a refused send", async () => {
  const sent: string[] = [];
  const original = globalThis.fetch;
  let status = 200;
  globalThis.fetch = (() => { sent.push("x"); return Promise.resolve(new Response("{}", { status })); }) as typeof fetch;
  const who = { user: { id: ADMIN_ID, email: "a@mingla.test" }, isAdmin: true };
  try {
    const row = campaignRow({ status: "completed", rendered_at: "2026-11-13T09:00:01Z", rendered_document: GOOD_DOC });
    const db = fakeDb({ campaign: row, deliveries: [] });
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => sendCampaignTest(db.client, { campaignId: CAMPAIGN }, who)),
    );
    assertEquals(results.filter((r) => r.status === "fulfilled").length, 5);
    assertEquals(sent.length, 5, "eight parallel clicks, five emails");
    assertEquals(db.state.auditSelects, 0, "no check-then-count in JS");
    // The audit write failing means no email.
    sent.length = 0;
    const broken = fakeDb({ campaign: row, deliveries: [], reserve: "error" });
    await assertRejects(() => sendCampaignTest(broken.client, { campaignId: CAMPAIGN }, who), Error, "test_send_count_failed");
    assertEquals(sent.length, 0);
    // Resend refusing gives the slot back.
    status = 500;
    const refused = fakeDb({ campaign: row, deliveries: [] });
    await assertRejects(() => sendCampaignTest(refused.client, { campaignId: CAMPAIGN }, who), Error, "test_send_failed");
    assertEquals(refused.state.deletedAudits, ["a1"]);
  } finally { globalThis.fetch = original; }
});

const rowReady = { rendered_at: "2026-11-13T09:00:01Z", rendered_document: GOOD_DOC };

Deno.test("F-7 (P1-1) the 24 h clock starts when sending began, not when the email was scheduled", async () => {
  const clock = virtualTime(() => new Response('{"message":"Too many requests"}', { status: 429, headers: { "retry-after": "1" } }));
  try {
    const days = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
    // Scheduled 3 days ago (deliveries created then), sending began just now.
    const db = fakeDb({
      campaign: campaignRow({ ...rowReady, created_at: days(3), started_at: new Date().toISOString() }),
      deliveries: deliveries(2, { created_at: days(3) }),
    });
    await processClaimedCampaign(db.client, { ...db.log } as never);
    assertEquals(db.state.deliveries.map((d) => d.status), ["retrying", "retrying"], "kept trying, not failed");
    assert(db.log.status !== "failed");
  } finally { clock.restore(); }
});

Deno.test("F-8 (P2-1) a campaign with nobody due is parked until the earliest person is due; newer campaigns run meanwhile", async () => {
  const clock = virtualTime(() => new Response('{"message":"Too many requests"}', { status: 429 }));
  try {
    const db = fakeDb({ campaign: campaignRow(rowReady), deliveries: deliveries(2) });
    await processClaimedCampaign(db.client, { ...db.log } as never);
    const due = Math.min(...db.state.deliveries.map((d) => Date.parse(String(d.next_attempt_at))));
    assert(due > Date.now() + 55_000);
    assertEquals(db.log.status, "sending");
    // The drain re-claims a "sending" campaign 10 minutes after processing_started_at: that moment is `due`.
    assertEquals(Date.parse(String(db.log.processing_started_at)) + 10 * 60_000, due);
    // Somebody due now keeps it at the front of the queue as before.
    const ready = fakeDb({ campaign: campaignRow(rowReady), deliveries: deliveries(2) });
    ready.state.deliveries[1].status = "retrying";
    ready.state.deliveries[1].next_attempt_at = new Date().toISOString();
    clock.restore();
    const ok2 = virtualTime(ok);
    try {
      await processClaimedCampaign(ready.client, { ...ready.log } as never);
      assertEquals(ready.log.status, "completed");
    } finally { ok2.restore(); }
  } finally { clock.restore(); }
});

Deno.test("F-9 (P2-2) a run stops inside its time budget, releases what it did not send, and never sleeps past it", async () => {
  const clock = virtualTime(() => new Response('{"message":"Too many requests"}', { status: 429, headers: { "retry-after": "1" } }));
  try {
    const start = pacing.now();
    const db = fakeDb({ campaign: campaignRow(rowReady), deliveries: deliveries(40) });
    await processClaimedCampaign(db.client, { ...db.log } as never);
    const elapsed = pacing.now() - start;
    assert(elapsed <= DRAIN_BUDGET_MS + 5_000, `run took ${elapsed} ms`);
    const untouched = db.state.deliveries.filter((d) => d.status === "pending");
    assert(untouched.length > 0, "some people were not reached");
    assert(untouched.every((d) => d.attempts === 0), "their try was given back");
    assert(!db.state.deliveries.some((d) => d.status === "sending"), "nothing left stranded as sending");
    assertEquals(db.log.status, "queued", "released now, not a 10-minute stale claim");
    assertEquals(db.log.processing_started_at, null);
  } finally { clock.restore(); }
  // A Retry-After longer than the wait allowed defers at once, with no sleep.
  const long = virtualTime(() => new Response("{}", { status: 429, headers: { "retry-after": "30" } }));
  try {
    const db = fakeDb({ campaign: campaignRow(rowReady), deliveries: deliveries(1) });
    await processClaimedCampaign(db.client, { ...db.log } as never);
    assert(!long.sleeps.some((ms) => ms >= 10_000), `slept ${long.sleeps}`);
    assertEquals(long.stamps.length, 1, "one call, then deferred");
    assertEquals(db.state.deliveries[0].status, "retrying");
    assert(Date.parse(String(db.state.deliveries[0].next_attempt_at)) >= Date.now() + 29_000, "deferred by Retry-After");
  } finally { long.restore(); }
});

Deno.test("F-10 (P3-2) a good read of the copy resets the try counter", async () => {
  const clock = virtualTime(ok);
  try {
    const db = fakeDb({ campaign: campaignRow({ ...rowReady, snapshot_attempts: 4 }), deliveries: deliveries(1) });
    await processClaimedCampaign(db.client, { ...db.log } as never);
    assertEquals(db.log.snapshot_attempts, 0);
  } finally { clock.restore(); }
});

Deno.test("F-11 (P3-1) the sample values the Admin list uses are what the renderer gives the sample person", () => {
  const sample = {
    "{first_name}": "Maya", "{display_name}": "Maya Okafor", "{username}": "@mayaexplores",
    "{country}": "Nigeria", "{language}": "English", "{joined_date}": "15 Jan 2026", "{name}": "Maya",
  };
  for (const [token, value] of Object.entries(sample)) assertEquals(personalizeText(token, SAMPLE_RECIPIENT), value, token);
});
