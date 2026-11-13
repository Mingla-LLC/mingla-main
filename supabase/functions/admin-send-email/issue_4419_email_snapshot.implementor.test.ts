// Issue #4419 — Admin keeps the exact email that went out.
//
// MINGLA-INVARIANT: I-4419-EMAIL-ONE-DOCUMENT-PER-CAMPAIGN | issue #4419 | Every batch of an Admin campaign sends admin_email_log.rendered_document, saved once by the first batch; a blog edit after that changes neither the stored copy nor what later batches send, and a copy that can't be saved sends nothing.
//
//   S-1  the first batch saves the copy once; its HTML is what a recipient
//        with the sample profile got (SC-1)
//   S-2  a blog edit after the copy changes nothing anyone receives, and the
//        detail page shows the copy (SC-2, SC-5)
//   S-3  a blog post taken down between batches stops the send
//   S-4  a copy that can't be saved fails the campaign, zero provider calls (SC-4)
//   S-5  a copy another run saved first wins; nothing is re-rendered
//   S-6  campaignState over every status and started_at
//   S-7  Cancel is refused once sending started, even between batches; a
//        cancel stores who and audits it (SC-7)
//   S-8  the detail page: exact / preview / rebuilt (with and without a saved
//        blog snapshot); failures grouped; non-admins scheduled only, masked
//        address; unknown and invalid ids (SC-5, SC-8)
//   S-9  the list: no stored HTML, counts, escaped search, non-admin scope (SC-11)
//   S-10 a test to yourself: your address only, [Test], no delivery row, five
//        an hour (SC-12)
//
// FAILS-ON-REVERT: making processClaimedCampaign send resolvedBlog.document
// again (dropping frozenCampaignDocument) reds S-2; dropping
// .is("started_at", null) from cancelCampaign reds S-7.
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
  cancelCampaign,
  errorStatus,
  getCampaignDetail,
  isAdminCaller,
  listCampaigns,
  processClaimedCampaign,
  renderCampaignEmail,
  sendCampaignTest,
} = await import("./index.ts");
const {
  campaignState,
  deliveryFailureCode,
  maskEmail,
  SAMPLE_RECIPIENT,
  subjectSearchPattern,
} = await import("./model.ts");

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

Deno.test("S-1 the first batch saves the copy once; it is what the sample recipient got", async () => {
  const fetch = withFetch();
  try {
    const db = fakeDb({ campaign: campaignRow(), deliveries: twoDeliveries() });
    await processClaimedCampaign(db.client, campaignRow());
    const row = current(db);
    assert(row.rendered_at, "rendered_at set");
    assertEquals(row.rendered_subject, "Lagos this weekend, Maya");
    assertEquals(row.render_sample, { ...SAMPLE_RECIPIENT });
    assertEquals(fetch.calls.length, 1);
    // The person whose profile equals the sample got exactly the stored HTML.
    assertEquals(fetch.calls[0].body.html, row.rendered_html);
    assertEquals(fetch.calls[0].body.text, row.rendered_text);
    assertStringIncludes(String(row.rendered_html), "Title A");
    // The stored document is the blog-resolved one.
    const blocks = (row.rendered_document as { blocks: Row[] }).blocks;
    assertEquals(blocks.map((b) => b.type), ["rich_text", "blog_post_resolved"]);
    // The preview path renders the same HTML for the same input.
    const preview = renderCampaignEmail(String(campaignRow().subject), blocks as never, { ...SAMPLE_RECIPIENT });
    assertEquals(preview.html, row.rendered_html);
    assertEquals(preview.preheader, row.rendered_preheader);
    // Saved exactly once.
    assertEquals(db.state.logUpdates.filter((u) => "rendered_html" in u).length, 1);
    // #4419 Part B: Admin campaigns now send from campaigns.usemingla.com.
    assertEquals(fetch.calls[0].body.from, "Mingla <hello@campaigns.usemingla.com>");
    assertEquals(ADMIN_SENDER.address, "hello@campaigns.usemingla.com");
  } finally { fetch.restore(); }
});

Deno.test("S-2 a blog edit after the copy changes neither the copy nor later batches", async () => {
  const fetch = withFetch();
  try {
    const db = fakeDb({ campaign: campaignRow(), deliveries: twoDeliveries() });
    await processClaimedCampaign(db.client, campaignRow());
    const savedHtml = current(db).rendered_html;
    db.state.blogTitle = "Title B — edited after sending started";
    // Batch 2 (re-claimed by cron: the row now carries the copy).
    await processClaimedCampaign(db.client, { ...current(db) } as never);
    assertEquals(fetch.calls.length, 2);
    assertStringIncludes(String(fetch.calls[1].body.html), "Title A");
    assertEquals(String(fetch.calls[1].body.html).includes("Title B"), false);
    assertEquals(current(db).rendered_html, savedHtml);
    const detail = await getCampaignDetail(db.client, { campaignId: CAMPAIGN }, { isAdmin: true });
    assertEquals(detail.view.kind, "exact");
    assertEquals(detail.view.html, savedHtml);
    assertStringIncludes(detail.view.html, "Title A");
  } finally { fetch.restore(); }
});

Deno.test("S-3 a blog post taken down between batches stops the send", async () => {
  const fetch = withFetch();
  try {
    const db = fakeDb({ campaign: campaignRow(), deliveries: twoDeliveries() });
    await processClaimedCampaign(db.client, campaignRow());
    db.state.blogTitle = null;
    const result = await processClaimedCampaign(db.client, { ...current(db) } as never) as Row;
    assertEquals(result.error, `blog_post_not_published:${POST_ID}`);
    assertEquals(fetch.calls.length, 1);
    assertEquals(current(db).status, "failed");
  } finally { fetch.restore(); }
});

Deno.test("S-4 a copy that can't be saved fails the campaign and sends nothing (D7)", async () => {
  const fetch = withFetch();
  try {
    const db = fakeDb({ campaign: campaignRow(), deliveries: twoDeliveries(), failSnapshotWrite: true });
    const result = await processClaimedCampaign(db.client, campaignRow()) as Row;
    assertEquals(result.ok, false);
    const row = current(db);
    assertEquals(row.status, "failed");
    assert(String(row.last_error).startsWith("email_snapshot_failed:"), String(row.last_error));
    assertEquals(row.processing_started_at, null);
    assert(row.completed_at);
    assertEquals(fetch.calls.length, 0);
    assertEquals(db.state.rpcCalls.some((c) => c.fn === "claim_admin_email_delivery_batch"), false, "no delivery claimed");
  } finally { fetch.restore(); }
});

Deno.test("S-5 a copy another run saved first wins; nothing is re-rendered", async () => {
  const fetch = withFetch();
  try {
    const stored = renderCampaignEmail("Stored subject", [{ type: "rich_text", html: "<p>Stored words</p>" }] as never, { ...SAMPLE_RECIPIENT });
    const db = fakeDb({
      campaign: campaignRow({
        rendered_at: "2026-11-13T09:00:01.000Z",
        rendered_subject: stored.subject, rendered_preheader: stored.preheader, rendered_html: stored.html, rendered_text: stored.text,
        rendered_document: { version: 1, blocks: [{ type: "rich_text", html: "<p>Stored words</p>" }] }, render_sample: { ...SAMPLE_RECIPIENT },
      }),
      deliveries: twoDeliveries(),
    });
    // This run claimed the campaign from an old read (rendered_at still null).
    await processClaimedCampaign(db.client, campaignRow());
    assertEquals(current(db).rendered_html, stored.html, "the stored copy did not change");
    assertStringIncludes(String(fetch.calls[0].body.html), "Stored words");
    assertEquals(String(fetch.calls[0].body.html).includes("Title A"), false);
  } finally { fetch.restore(); }
});

Deno.test("S-6 campaignState over every status and started_at", () => {
  const table: Array<[string, string | null, string, string]> = [
    ["scheduled", null, "scheduled", "Scheduled"],
    ["queued", null, "sending", "Starting"],
    ["queued", "2026-11-13T09:00:00Z", "sending", "Sending"],
    ["sending", "2026-11-13T09:00:00Z", "sending", "Sending"],
    ["completed", "2026-11-13T09:00:00Z", "sent", "Sent"],
    ["sent", null, "sent", "Sent"],
    ["partial", "2026-11-13T09:00:00Z", "partial", "Partially sent"],
    ["failed", null, "failed", "Failed"],
    ["cancelled", null, "cancelled", "Cancelled"],
    ["pending", null, "unknown", "Unknown"],
    ["draft", null, "unknown", "Unknown"],
    ["", null, "unknown", "Unknown"],
  ];
  for (const [status, started, state, label] of table) {
    assertEquals(campaignState({ status, started_at: started }), { state, label }, `${status}/${started}`);
  }
});

Deno.test("S-7 Cancel is refused once sending started; a cancel stores who and audits it", async () => {
  // Between batches: queued, processing_started_at null, started_at set.
  const between = fakeDb({ campaign: campaignRow({ status: "queued", processing_started_at: null }) });
  await assertRejects(
    () => cancelCampaign(between.client, { campaignId: CAMPAIGN }, { id: ADMIN_ID, email: "a@mingla.test" }),
    Error, "campaign_not_cancellable",
  );
  assertEquals(current(between).status, "queued");
  assertEquals(between.state.audits.length, 0);

  const scheduled = fakeDb({ campaign: campaignRow({ status: "scheduled", started_at: null, processing_started_at: null }) });
  const result = await cancelCampaign(scheduled.client, { campaignId: CAMPAIGN }, { id: ADMIN_ID, email: "a@mingla.test" });
  assertEquals((result as Row).status, "cancelled");
  assertEquals(current(scheduled).cancelled_by, ADMIN_ID);
  assertEquals(scheduled.state.audits.map((a) => [a.action, a.target_id, (a.metadata as Row).actor_user_id]), [["email_campaign_cancelled", CAMPAIGN, ADMIN_ID]]);
  await assertRejects(() => cancelCampaign(scheduled.client, { campaignId: "nope" }), Error, "campaign_id_invalid");
});

Deno.test("S-8 the detail page: exact, preview, rebuilt, failures, access", async () => {
  // Preview: not started yet, live blog post.
  const scheduled = fakeDb({ campaign: campaignRow({ status: "scheduled", started_at: null, processing_started_at: null, scheduled_for: "2026-11-15T08:00:00.000Z" }) });
  const preview = await getCampaignDetail(scheduled.client, { campaignId: CAMPAIGN }, { isAdmin: false });
  assertEquals(preview.view.kind, "preview");
  assertStringIncludes(preview.view.html, "Title A");
  assertEquals(preview.campaign.can_change, true);
  assertEquals(preview.campaign.created_by_name, "Abimbola A.");

  // Preview with a post that is no longer published: the page still opens, with a note.
  const gone = fakeDb({ campaign: campaignRow({ status: "scheduled", started_at: null }), blogTitle: null });
  const goneDetail = await getCampaignDetail(gone.client, { campaignId: CAMPAIGN }, { isAdmin: true });
  assertEquals(goneDetail.view.notes, [`blog_post_not_published:${POST_ID}`]);

  // Rebuilt from a saved blog snapshot (sent before copies existed).
  const withSnapshot = { ...blogBlock, snapshot: { slug: "old-story", title: "Saved snapshot title", summary: "s", categoryLabel: "Hosting", readMinutes: 3, coverUrl: null, coverAlt: "", versionId: "v0" } };
  const legacy = fakeDb({
    campaign: campaignRow({ status: "completed", body_document: { version: 1, blocks: [words, withSnapshot] } }),
    blogTitle: "A later live title",
  });
  const rebuilt = await getCampaignDetail(legacy.client, { campaignId: CAMPAIGN }, { isAdmin: true });
  assertEquals(rebuilt.view.kind, "rebuilt");
  assertEquals(rebuilt.view.notes, ["blog_from_saved_snapshot"]);
  assertStringIncludes(rebuilt.view.html, "Saved snapshot title");
  assertEquals(rebuilt.view.html.includes("A later live title"), false);

  // Rebuilt without a saved snapshot: resolved live, and it says so.
  const legacyLive = fakeDb({ campaign: campaignRow({ status: "completed" }), blogTitle: "Live title" });
  const live = await getCampaignDetail(legacyLive.client, { campaignId: CAMPAIGN }, { isAdmin: true });
  assertEquals(live.view.kind, "rebuilt");
  assertEquals(live.view.notes, ["blog_resolved_live"]);
  assertStringIncludes(live.view.html, "Live title");

  // A partial send with Resend 429s: the rate-limit code, the raw text kept apart.
  const partial = fakeDb({
    campaign: campaignRow({ status: "partial", sent_count: 1, failed_count: 3, last_error: null }),
    deliveries: [
      { id: "a", status: "accepted" },
      { id: "b", status: "failed", last_error: "Resend 429: Too many requests. You can only make 2 requests per second." },
      { id: "c", status: "failed", last_error: "Resend 429: Too many requests." },
      { id: "d", status: "failed", last_error: "Resend 422: invalid `to` field" },
    ],
  });
  const p = await getCampaignDetail(partial.client, { campaignId: CAMPAIGN }, { isAdmin: true });
  assertEquals(p.failure.summary_code, "rate_limited");
  assertEquals(p.failure.by_reason, [{ code: "rate_limited", count: 2 }, { code: "invalid_address", count: 1 }]);
  assertStringIncludes(String(p.failure.raw), "Resend 429");
  assertEquals(p.counts.accepted, 1);
  assertEquals(p.counts.failed, 3);

  // A campaign-level reason wins (the blog post was unpublished).
  const blogFailed = fakeDb({ campaign: campaignRow({ status: "failed", last_error: `blog_post_not_published:${POST_ID}` }) });
  assertEquals((await getCampaignDetail(blogFailed.client, { campaignId: CAMPAIGN }, { isAdmin: true })).failure.summary_code, "blog_post_not_published");

  // Cancelled: when and by whom.
  const cancelled = fakeDb({ campaign: campaignRow({ status: "cancelled", started_at: null, completed_at: "2026-11-13T10:20:00.000Z", cancelled_by: MEMBER_ID }) });
  const c = await getCampaignDetail(cancelled.client, { campaignId: CAMPAIGN }, { isAdmin: true });
  assertEquals([c.campaign.cancelled_at, c.campaign.cancelled_by_name, c.view.kind], ["2026-11-13T10:20:00.000Z", "Seth O.", "preview"]);

  // Only admins see sent emails (Seth, 13 Nov); a one-person send is masked for others.
  await assertRejects(() => getCampaignDetail(legacy.client, { campaignId: CAMPAIGN }, { isAdmin: false }), Error, "email_admin_only");
  assertEquals(errorStatus(new Error("email_admin_only")), 403);
  const person = fakeDb({ campaign: campaignRow({ status: "scheduled", started_at: null, recipient_type: "individual", recipient_email: "maya.okafor@example.com", audience: { mode: "person", email: "maya.okafor@example.com" } }) });
  const masked = await getCampaignDetail(person.client, { campaignId: CAMPAIGN }, { isAdmin: false });
  assertEquals(masked.campaign.to_label, "maya.o@…");
  assertEquals(JSON.stringify(masked).includes("maya.okafor@example.com"), false);
  assertEquals((await getCampaignDetail(person.client, { campaignId: CAMPAIGN }, { isAdmin: true })).campaign.to_label, "maya.okafor@example.com");

  // Unknown and invalid ids.
  await assertRejects(() => getCampaignDetail(fakeDb().client, { campaignId: CAMPAIGN }, { isAdmin: true }), Error, "campaign_not_found");
  await assertRejects(() => getCampaignDetail(fakeDb().client, { campaignId: "x' or 1=1" }, { isAdmin: true }), Error, "campaign_id_invalid");
  assertEquals(errorStatus(new Error("campaign_not_found")), 400);
  assertEquals(errorStatus(new Error("campaign_id_invalid")), 400);

  // The admin check fails closed.
  assertEquals(await isAdminCaller({ rpc: () => Promise.resolve({ data: true, error: null }) }), true);
  assertEquals(await isAdminCaller({ rpc: () => Promise.resolve({ data: "true", error: null }) }), false);
  assertEquals(await isAdminCaller({ rpc: () => Promise.resolve({ data: true, error: { message: "x" } }) }), false);
  assertEquals(await isAdminCaller({ rpc: () => Promise.reject(new Error("down")) }), false);
});

Deno.test("S-9 the list never carries the stored HTML or a bulk address", async () => {
  const listResult = {
    rows: [
      { id: CAMPAIGN, subject: "Lagos", status: "queued", started_at: null, recipient_type: "bulk", recipient_email: null, recipient_count: 10, skipped_count: 3, matched: 12, accepted: 0, failed: 0, has_snapshot: false },
      { id: "44190000-0000-4000-8000-0000000000e2", subject: "Welcome", status: "scheduled", started_at: null, recipient_type: "individual", recipient_email: "maya.okafor@example.com", recipient_count: 1, skipped_count: 0, has_snapshot: false },
    ],
    counts: { all: 2, scheduled: 1, sending: 1, sent: 0, attention: 0, cancelled: 0 },
    total: 2,
  };
  const db = fakeDb({ listResult });
  const out = await listCampaigns(db.client, { filter: "all", query: "100% off_x", page: 0 }, { isAdmin: false });
  const call = db.state.rpcCalls.find((c) => c.fn === "issue_4419_admin_email_list")!;
  assertEquals(call.params, { p_filter: "all", p_query: "%100\\% off\\_x%", p_admin: false, p_limit: 20, p_offset: 0 });
  assertEquals(out.counts, listResult.counts);
  assertEquals(out.rows[0].state, "sending");
  assertEquals(out.rows[0].state_label, "Starting");
  assertEquals(out.rows[0].will_receive, 7);
  assertEquals(out.rows[1].to_label, "maya.o@…");
  const text = JSON.stringify(out);
  for (const banned of ["rendered_html", "rendered_text", "rendered_document", "maya.okafor@example.com"]) {
    assertEquals(text.includes(banned), false, banned);
  }
  // A bad filter or page falls back, never errors.
  await listCampaigns(db.client, { filter: "'; drop", page: -3 }, { isAdmin: true });
  const second = db.state.rpcCalls.filter((c) => c.fn === "issue_4419_admin_email_list")[1];
  assertEquals((second.params as Row).p_filter, "all");
  assertEquals((second.params as Row).p_offset, 0);
  assertEquals((second.params as Row).p_admin, true);
  assertEquals(subjectSearchPattern("  "), null);
  assertEquals(subjectSearchPattern("a\\b"), "%a\\\\b%");
  assertEquals(maskEmail("ab@x.com"), "ab@…");
  assertEquals(maskEmail("nope"), null);
});

Deno.test("S-10 a test to yourself: your address only, [Test], no delivery row, five an hour", async () => {
  const fetch = withFetch();
  try {
    const stored = renderCampaignEmail("Lagos, {first_name}", [{ type: "rich_text", html: "<p>Hi {first_name}, stored words</p>" }] as never, { ...SAMPLE_RECIPIENT });
    const db = fakeDb({
      campaign: campaignRow({
        status: "completed", subject: "Lagos, {first_name}",
        rendered_at: "2026-11-13T09:00:01.000Z", rendered_subject: stored.subject, rendered_preheader: stored.preheader,
        rendered_html: stored.html, rendered_text: stored.text, render_sample: { ...SAMPLE_RECIPIENT },
        rendered_document: { version: 1, blocks: [{ type: "rich_text", html: "<p>Hi {first_name}, stored words</p>" }] },
      }),
      person: { user_id: ADMIN_ID, email: "abimbola@mingla.test", name: "Abimbola Adeyemi", first_name: "Abimbola" },
    });
    const now = Date.parse("2026-11-13T12:00:00Z");
    const result = await sendCampaignTest(db.client, { campaignId: CAMPAIGN }, { user: { id: ADMIN_ID, email: "Abimbola@Mingla.test" }, isAdmin: true }, now);
    assertEquals(result, { sent: true, to: "abimbola@mingla.test" });
    assertEquals(fetch.calls.length, 1);
    const sent = fetch.calls[0];
    assertEquals(sent.body.to, ["abimbola@mingla.test"]);
    assert(String(sent.body.subject).startsWith("[Test] "), String(sent.body.subject));
    assertStringIncludes(String(sent.body.html), "stored words");
    assertEquals(sent.body.headers, undefined, "no List-Unsubscribe on a test");
    assertEquals(sent.headers["Idempotency-Key"], `admin-email-test-${CAMPAIGN}-${ADMIN_ID}-${Math.floor(now / 60000)}`);
    assertEquals(db.state.deliveryInserts, 0);
    assertEquals(db.state.audits.at(-1)?.action, "email_campaign_test_sent");

    // Five an hour: four more go, the sixth is refused before any provider call.
    for (let i = 0; i < 4; i += 1) {
      await sendCampaignTest(db.client, { campaignId: CAMPAIGN }, { user: { id: ADMIN_ID, email: "abimbola@mingla.test" }, isAdmin: true }, now);
    }
    assertEquals(fetch.calls.length, 5);
    await assertRejects(
      () => sendCampaignTest(db.client, { campaignId: CAMPAIGN }, { user: { id: ADMIN_ID, email: "abimbola@mingla.test" }, isAdmin: true }, now),
      Error, "test_send_limit",
    );
    assertEquals(fetch.calls.length, 5);
    assertEquals(errorStatus(new Error("test_send_limit")), 400);

    // A non-admin may test a scheduled email only.
    await assertRejects(
      () => sendCampaignTest(db.client, { campaignId: CAMPAIGN }, { user: { id: MEMBER_ID, email: "m@mingla.test" }, isAdmin: false }, now),
      Error, "email_admin_only",
    );
    // No address, no send.
    await assertRejects(
      () => sendCampaignTest(db.client, { campaignId: CAMPAIGN }, { user: { id: MEMBER_ID, email: null }, isAdmin: true }, now),
      Error, "test_send_address_missing",
    );
  } finally { fetch.restore(); }
});

Deno.test("S-8b delivery errors map to plain codes (the SQL summary's twin)", () => {
  assertEquals(deliveryFailureCode("Resend 429: Too many requests"), "rate_limited");
  assertEquals(deliveryFailureCode("Resend 401: API key is invalid"), "provider_key");
  assertEquals(deliveryFailureCode("Resend 403: domain not verified"), "provider_key");
  assertEquals(deliveryFailureCode("Resend 422: invalid to"), "invalid_address");
  assertEquals(deliveryFailureCode("Resend 503: down"), "provider_down");
  assertEquals(deliveryFailureCode("TypeError: fetch failed"), "provider_down");
  assertEquals(deliveryFailureCode("boom"), "other");
  assertEquals(deliveryFailureCode(null), "other");
});

Deno.test("S-11 (Part B) engagement reaches the list and the page; a failed read never breaks them", async () => {
  const engagement = {
    accepted: 2, events: 5, delivered: 2, bounced: { hard: 0, soft: 0 }, complained: 0,
    opened_unique: 1, opened_total: 2, clicked_unique: 0, clicked_total: 0, top_links: [],
    tracking: { opens_seen: true, clicks_seen: false, clicks_seen_anywhere: false },
  };
  const db = fakeDb({
    campaign: campaignRow({ status: "completed" }),
    engagement,
    engagementCounts: [{ campaign_id: CAMPAIGN, delivered: 2, opened_unique: 1 }],
    listResult: { rows: [{ id: CAMPAIGN, subject: "Lagos", status: "completed", started_at: "2026-11-13T09:00:00Z", recipient_type: "bulk", recipient_count: 2, skipped_count: 0 }], counts: {}, total: 1 },
  });
  const detail = await getCampaignDetail(db.client, { campaignId: CAMPAIGN }, { isAdmin: true });
  assertEquals(detail.engagement, engagement);
  const list = await listCampaigns(db.client, {}, { isAdmin: true });
  assertEquals([list.rows[0].delivered, list.rows[0].opened_unique], [2, 1]);

  const down = fakeDb({
    campaign: campaignRow({ status: "completed" }),
    engagementError: true,
    listResult: { rows: [{ id: CAMPAIGN, subject: "Lagos", status: "completed" }], counts: {}, total: 1 },
  });
  assertEquals((await getCampaignDetail(down.client, { campaignId: CAMPAIGN }, { isAdmin: true })).engagement, null);
  const downList = await listCampaigns(down.client, {}, { isAdmin: true });
  assertEquals([downList.rows[0].delivered, downList.rows[0].opened_unique], [null, null]);
});
