// Issue #4419 — tester adversarial (mingla-tester, L3). Angles the implementor
// suite does not take:
//
//   TA-1 personalization survives the frozen document: across two batches each
//        person gets their own first name (never the sample's "Maya"), and the
//        stored rendered_document keeps the {first_name} token un-filled
//   TA-2 campaign sends go out from campaigns.usemingla.com with a reply-to
//        and the List-Unsubscribe headers; the ticket and system senders that
//        every other renderTransactionalEmail caller uses stay on usemingla.com
//   TA-3 a later batch reuses the stored copy without writing it again, even
//        when the campaign record handed in is stale (rendered_at missing)
//   TA-4 (retest of P2-1) a read blip right after the FIRST batch saved the
//        copy hands the send back to the drain; later runs reuse that copy
//        (no second write, a blog edit ignored) and every person gets exactly
//        one email
//
// FAILS-ON-REVERT: storing the personalized (sample) document instead of the
// un-personalized one reds TA-1; dropping .is("rendered_at", null) from the
// snapshot write reds TA-3 (the fake refuses the second write like the trigger);
// failing the campaign on a read error (no retry branch) reds TA-4.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

Deno.env.set("SUPABASE_URL", "https://issue4419.supabase.test");
Deno.env.set("SUPABASE_ANON_KEY", "anon-key-4419");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-key-4419");
Deno.env.set("RESEND_API_KEY", "re_test_issue_4419");
Deno.env.set("UNSUBSCRIBE_TOKEN_SECRET", "issue-4419-unsubscribe-secret-long-enough-for-tests");
Deno.env.set("MINGLA_LOGO_URL", "https://usemingla.com/email-logo.png");
Deno.env.set("MINGLA_FOOTER_ADDRESS", "Mingla, hello@usemingla.com");

const {
  ADMIN_SENDER,
  processClaimedCampaign,
} = await import("./index.ts");
const {
  deliveryFailureCode,
  SAMPLE_RECIPIENT,
} = await import("./model.ts");
const { EMAIL_SENDERS } = await import("../_shared/email/senders.ts");

type Row = Record<string, unknown>;

const CAMPAIGN = "44190000-0000-4000-8000-0000000000e1";
const POST_ID = "44190000-0000-4000-a000-000000000001";
const ADMIN_ID = "44190000-0000-4000-8000-0000000000a1";
const MEMBER_ID = "44190000-0000-4000-8000-0000000000b1";

const blogBlock = {
  id: "blog",
  type: "blog_post",
  postId: POST_ID,
  style: "card",
  buttonText: "Read the guide",
};
const words = { id: "words", type: "rich_text", html: "<p>Hi {first_name}, five rooftops this weekend.</p>" };

function blogRow(title: string) {
  return {
    id: POST_ID,
    slug: "supper-club",
    status: "published",
    category: { label: "Hosting" },
    version: { id: `v-${title}`, title, summary: "Five hosts on guest lists", read_minutes: 4, cover_alt: "", cover: null },
  };
}

// A small fake database: one admin_email_log table with filters that must all
// match for an update (and the #4419 trigger's refusal), deliveries, audits,
// a mutable blog post, and the RPCs the functions call.
function fakeDb(options: {
  campaign?: Row;
  deliveries?: Row[];
  blogTitle?: string | null;
  failSnapshotWrite?: boolean;
  listResult?: Row;
  person?: Row | null;
  audits?: Row[];
  engagement?: Row | null;
  engagementCounts?: Row[];
  engagementError?: boolean;
} = {}) {
  const log = new Map<string, Row>();
  if (options.campaign) log.set(String(options.campaign.id), { ...options.campaign });
  const state = {
    blogTitle: options.blogTitle === undefined ? "Title A" : options.blogTitle,
    deliveries: (options.deliveries ?? []).map((d) => ({ ...d })),
    audits: [...(options.audits ?? [])] as Row[],
    rpcCalls: [] as Array<{ fn: string; params: unknown }>,
    deliveryInserts: 0,
    logUpdates: [] as Row[],
  };
  const snapshotColumns = ["rendered_subject", "rendered_preheader", "rendered_html", "rendered_text", "rendered_document", "render_sample", "rendered_at"];

  function chainFor(table: string) {
    const filters: Array<{ kind: string; col: string; value: unknown }> = [];
    let op: "select" | "update" | "insert" = "select";
    let patch: Row | null = null;
    let head = false;
    const matchesRow = (row: Row) =>
      filters.every((f) => {
        if (f.kind === "eq") return String(row[f.col] ?? "") === String(f.value);
        if (f.kind === "is") return (row[f.col] ?? null) === f.value;
        if (f.kind === "in") return (f.value as unknown[]).includes(row[f.col]);
        if (f.kind === "gte") return String(row[f.col] ?? "") >= String(f.value);
        return true;
      });
    const run = (): { data: unknown; error: unknown; count?: number } => {
      if (table === "blog_posts") {
        return { data: state.blogTitle ? [blogRow(state.blogTitle)] : [], error: null };
      }
      if (table === "channel_suppressions" || table === "marketing_unsubscribes") return { data: [], error: null };
      if (table === "admin_email_log") {
        const rows = [...log.values()].filter(matchesRow);
        if (op === "update" && patch) {
          if (options.failSnapshotWrite && "rendered_html" in patch) {
            return { data: null, error: { message: 'new row for relation "admin_email_log" violates check constraint "admin_email_log_snapshot_size"' } };
          }
          for (const row of rows) {
            if (row.rendered_at && snapshotColumns.some((col) => col in patch! && patch![col] !== row[col])) {
              return { data: null, error: { code: "PT409", message: "admin_email_snapshot_immutable" } };
            }
            Object.assign(row, patch);
            state.logUpdates.push({ ...patch });
          }
          return { data: rows.map((r) => ({ ...r })), error: null };
        }
        return { data: rows.map((r) => ({ ...r })), error: null };
      }
      if (table === "admin_email_recipient_deliveries") {
        if (op === "insert") { state.deliveryInserts += 1; return { data: null, error: null }; }
        const rows = state.deliveries.filter(matchesRow);
        if (op === "update" && patch) { for (const row of rows) Object.assign(row, patch); return { data: null, error: null }; }
        return { data: rows, error: null, count: rows.length };
      }
      if (table === "admin_audit_log") {
        if (op === "insert") return { data: null, error: null };
        const rows = state.audits.filter((a) =>
          filters.every((f) => {
            if (f.col === "metadata->>actor_user_id") return (a.metadata as Row)?.actor_user_id === f.value;
            if (f.kind === "gte") return String(a[f.col] ?? "") >= String(f.value);
            return String(a[f.col] ?? "") === String(f.value);
          })
        );
        return { data: head ? null : rows, error: null, count: rows.length };
      }
      throw new Error(`unexpected table ${table}`);
    };
    const chain: Record<string, unknown> = {};
    for (const m of ["order", "range", "limit", "not", "lte", "or", "ilike"]) chain[m] = () => chain;
    chain.select = (_cols?: string, opts?: { head?: boolean }) => { if (opts?.head) head = true; return chain; };
    chain.update = (p: Row) => { op = "update"; patch = p; return chain; };
    chain.insert = (row: Row) => {
      op = "insert";
      if (table === "admin_audit_log") state.audits.push({ ...row, created_at: new Date().toISOString() });
      return chain;
    };
    chain.eq = (col: string, value: unknown) => { filters.push({ kind: "eq", col, value }); return chain; };
    chain.is = (col: string, value: unknown) => { filters.push({ kind: "is", col, value }); return chain; };
    chain.in = (col: string, value: unknown[]) => { filters.push({ kind: "in", col, value }); return chain; };
    chain.gte = (col: string, value: unknown) => { filters.push({ kind: "gte", col, value }); return chain; };
    chain.maybeSingle = () => {
      const result = run();
      const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
      return Promise.resolve({ data, error: result.error });
    };
    chain.single = chain.maybeSingle;
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      try { return Promise.resolve(resolve(run())); } catch (e) { return reject ? reject(e) : Promise.reject(e); }
    };
    return chain;
  }

  const client = {
    from: (table: string) => chainFor(table),
    rpc(fn: string, params: Row = {}) {
      state.rpcCalls.push({ fn, params });
      if (fn === "claim_admin_email_delivery_batch") {
        // One delivery per batch, so two calls are two batches.
        const next = state.deliveries.find((d) => d.status === "pending");
        if (next) { next.status = "sending"; next.attempts = Number(next.attempts ?? 0) + 1; }
        return Promise.resolve({ data: next ? [{ ...next }] : [], error: null });
      }
      if (fn === "issue_4419_admin_email_delivery_summary") {
        const ds = state.deliveries;
        const failures = ds.filter((d) => ["failed", "retrying"].includes(String(d.status)) && d.last_error);
        const byCode = new Map<string, number>();
        for (const d of failures) {
          const code = deliveryFailureCode(String(d.last_error));
          byCode.set(code, (byCode.get(code) ?? 0) + 1);
        }
        return Promise.resolve({
          data: {
            total: ds.length,
            accepted: ds.filter((d) => d.status === "accepted").length,
            failed: ds.filter((d) => d.status === "failed").length,
            pending: ds.filter((d) => ["pending", "sending", "retrying"].includes(String(d.status))).length,
            skipped_late: ds.filter((d) => d.status === "skipped_opt_out").length,
            by_reason: [...byCode.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code, count]) => ({ code, count })),
            raw: failures[0] ? String(failures[0].last_error).slice(0, 300) : null,
          },
          error: null,
        });
      }
      if (fn === "issue_4383_person_label") {
        const names: Row = { [ADMIN_ID]: "Abimbola A.", [MEMBER_ID]: "Seth O." };
        return Promise.resolve({ data: names[String(params.p_user_id)] ?? null, error: null });
      }
      if (fn === "issue_4419_admin_email_list") {
        return Promise.resolve({ data: options.listResult ?? { rows: [], counts: {}, total: 0 }, error: null });
      }
      if (fn === "issue_4419_admin_email_engagement_counts") {
        return Promise.resolve(options.engagementError ? { data: null, error: { message: "down" } } : { data: options.engagementCounts ?? [], error: null });
      }
      if (fn === "issue_4419_admin_email_engagement") {
        return Promise.resolve(options.engagementError ? { data: null, error: { message: "down" } } : { data: options.engagement ?? null, error: null });
      }
      if (fn === "admin_people_directory") {
        const c: Record<string, unknown> = {};
        for (const m of ["select", "eq", "limit"]) c[m] = () => c;
        c.maybeSingle = () => Promise.resolve({ data: options.person ?? null, error: null });
        return c;
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
  return { client: client as never, state, log };
}

function withFetch() {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Row }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return Promise.resolve(new Response(JSON.stringify({ id: `resend-${calls.length}` }), { status: 200 }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const campaignRow = (extra: Row = {}): Row => ({
  id: CAMPAIGN,
  subject: "Lagos this weekend, {first_name}",
  body: "Hi",
  body_document: { version: 1, blocks: [words, blogBlock] },
  status: "sending",
  started_at: "2026-11-13T09:00:00.000Z",
  processing_started_at: "2026-11-13T09:00:00.000Z",
  rendered_at: null,
  rendered_document: null,
  recipient_type: "bulk",
  recipient_count: 2,
  skipped_count: 0,
  matched_count: 2,
  sent_by: ADMIN_ID,
  created_at: "2026-11-12T10:00:00.000Z",
  timezone: "Africa/Lagos",
  ...extra,
});

const twoDeliveries = (): Row[] => [
  { id: "d1", campaign_id: CAMPAIGN, recipient_email: "maya@example.com", status: "pending", attempts: 0, personalization: { ...SAMPLE_RECIPIENT, email: "maya@example.com" } },
  { id: "d2", campaign_id: CAMPAIGN, recipient_email: "ade@example.com", status: "pending", attempts: 0, personalization: { email: "ade@example.com", first_name: "Ade" } },
];

const current = (db: ReturnType<typeof fakeDb>) => db.log.get(CAMPAIGN)!;

Deno.test("TA-1 each person gets their own name across batches; the frozen document keeps the token", async () => {
  const fetch = withFetch();
  try {
    const db = fakeDb({ campaign: campaignRow(), deliveries: twoDeliveries() });
    await processClaimedCampaign(db.client, campaignRow());
    await processClaimedCampaign(db.client, { ...current(db) } as never);
    assertEquals(fetch.calls.length, 2);
    const [maya, ade] = fetch.calls;
    assertEquals(maya.body.to, ["maya@example.com"]);
    assertEquals(ade.body.to, ["ade@example.com"]);
    assertStringIncludes(String(ade.body.subject), "Ade");
    assertStringIncludes(String(ade.body.html), "Hi Ade,");
    assertEquals(String(ade.body.html).includes("Maya"), false, "Ade's email carries the sample's name");
    assertEquals(String(ade.body.text).includes("Maya"), false);
    // The stored document is un-personalized; only the stored HTML is Maya's.
    const stored = JSON.stringify(current(db).rendered_document);
    assertStringIncludes(stored, "{first_name}");
    assertEquals(stored.includes("Maya"), false);
    assertStringIncludes(String(current(db).rendered_html), "Maya");
  } finally { fetch.restore(); }
});

Deno.test("TA-2 campaign sends use campaigns.usemingla.com with a reply-to; other senders unchanged", async () => {
  const fetch = withFetch();
  try {
    const db = fakeDb({ campaign: campaignRow(), deliveries: twoDeliveries() });
    await processClaimedCampaign(db.client, campaignRow());
    const sent = fetch.calls[0].body;
    assertEquals(sent.from, "Mingla <hello@campaigns.usemingla.com>");
    assert(typeof sent.reply_to === "string" && String(sent.reply_to).includes("@"), "reply_to present");
    const headers = sent.headers as Record<string, string>;
    assert(headers && headers["List-Unsubscribe"], "List-Unsubscribe kept on campaign sends");
    assertEquals(ADMIN_SENDER.address, "hello@campaigns.usemingla.com");
    // Ticket and system email (every other renderTransactionalEmail caller) stay on usemingla.com.
    assertEquals(EMAIL_SENDERS.tickets.address, "tickets@usemingla.com");
    assertEquals(EMAIL_SENDERS.system.address, "notifications@usemingla.com");
    assertEquals(EMAIL_SENDERS.admin.address, "hello@usemingla.com");
  } finally { fetch.restore(); }
});

Deno.test("TA-3 a later batch with a stale record reuses the stored copy and never rewrites it", async () => {
  const fetch = withFetch();
  try {
    const db = fakeDb({ campaign: campaignRow(), deliveries: twoDeliveries() });
    await processClaimedCampaign(db.client, campaignRow());
    const saved = { ...current(db) };
    db.state.blogTitle = "Title C";
    // A stale claim hands in the record as it was before the copy existed.
    const result = await processClaimedCampaign(db.client, campaignRow() as never) as Row;
    assertEquals(result.error, undefined, String(result.error));
    assertEquals(current(db).status === "failed", false, "the campaign was failed by a second snapshot write");
    assertEquals(current(db).rendered_html, saved.rendered_html);
    assertEquals(current(db).rendered_at, saved.rendered_at);
    assertEquals(fetch.calls.length, 2);
    assertStringIncludes(String(fetch.calls[1].body.html), "Title A");
    assertEquals(String(fetch.calls[1].body.html).includes("Title C"), false);
  } finally { fetch.restore(); }
});

Deno.test("TA-4 a read blip after the first save re-queues; the next runs reuse the copy, one email each", async () => {
  const fetch = withFetch();
  try {
    const db = fakeDb({ campaign: campaignRow(), deliveries: twoDeliveries() });
    // Every read-back of admin_email_log fails during the first run only.
    let blip = true;
    const realFrom = (db.client as unknown as { from: (t: string) => Record<string, unknown> }).from;
    (db.client as unknown as { from: (t: string) => Record<string, unknown> }).from = (table: string) => {
      const chain = realFrom(table);
      if (table !== "admin_email_log" || !blip) return chain;
      const select = chain.select as (...a: unknown[]) => Record<string, unknown>;
      chain.select = (...a: unknown[]) => {
        const next = select(...a);
        next.maybeSingle = () => Promise.resolve({ data: null, error: { message: "connection reset" } });
        return next;
      };
      return chain;
    };
    const first = await processClaimedCampaign(db.client, campaignRow()) as Row;
    assertEquals(first.retry, true, JSON.stringify(first));
    assertEquals(current(db).status, "queued");
    assertEquals(current(db).processing_started_at, null);
    assertEquals(current(db).completed_at ?? null, null);
    assert(current(db).rendered_at, "the copy saved before the blip is kept");
    assertEquals(fetch.calls.length, 0, "nothing sent on the run that could not read the copy");
    const savedHtml = current(db).rendered_html;
    blip = false;
    db.state.blogTitle = "Title Z";
    for (let i = 0; i < 3; i += 1) {
      await processClaimedCampaign(db.client, { ...current(db), status: "sending" } as never);
    }
    assertEquals(fetch.calls.length, 2, "one email per person, no double send");
    assertEquals(new Set(fetch.calls.map((c) => c.headers["Idempotency-Key"])).size, 2);
    assertEquals(fetch.calls.some((c) => String(c.body.html).includes("Title Z")), false);
    assertEquals(current(db).rendered_html, savedHtml);
    assertEquals(db.state.logUpdates.filter((u) => "rendered_html" in u).length, 1);
    assertEquals(current(db).status, "completed");
  } finally { fetch.restore(); }
});
