/**
 * ISSUE-927 QA — TESTER ADVERSARIAL suite #2 (RUNTIME, full-stack local).
 *
 * The implementor's create-fn suite is a source-contract suite. This one
 * EXECUTES the real admin-ad-create-campaign edge function in-process (its
 * std/http serve binds :8000 on import) against three local mock servers:
 * a PostgREST/GoTrue-shaped Supabase mock, a Reddit Ads API mock (token mint
 * + campaigns/ad_groups/structured-post jobs/ads + PATCH rollback), and a
 * TikTok Marketing API mock (tool/region, UPLOAD_BY_URL, the three creates,
 * status read, status/update rollback). No live platform is ever touched;
 * no real DB is ever touched.
 *
 * Runtime pins (each a live-fire request through the REAL branch code):
 *   REDDIT
 *   r1. validate_only → named-skipped-layers, ZERO reddit-bound requests
 *       (token mint included — cold cache), ZERO DB writes.
 *   r2. full chain success — wire ORDER (campaign → geo-validate → ad group →
 *       structured-post job → poll → ad), configured_status:"PAUSED" on ALL
 *       THREE create bodies, conversion_pixel_id on the ad group, the ad's
 *       click_url = canonical dest (never the OneLink), utm_campaign carries
 *       the pre-minted DB row id, DB rows persisted PAUSED ×3 + audit.
 *   r3. HOSTILE INJECTION fuzz — configured_status/status/conversion_pixel_id
 *       injected at body top-level AND through targeting.passthrough.reddit:
 *       every create body still carries PAUSED, the pixel stays the
 *       connection's own, and no "ACTIVE" reaches the wire.
 *   r4. forced failure at EVERY chain step → 502 naming the step, rollback =
 *       PATCH configured_status:"DELETED" in REVERSE creation order over the
 *       entities that exist, orphaned t3_ post recorded, ZERO ad-tree DB rows.
 *   r5. DB-persist failure AFTER a successful chain → platform rollback PATCH
 *       + 500 db_persist_failed_platform_rolled_back.
 *   r6. (builder-level runtime) conversion_pixel_id rides the CBO campaign
 *       body unconditionally; the ad-group builder fails CLOSED without one.
 *   TIKTOK
 *   t1. validate_only → named-skipped-layers, ZERO tiktok-bound requests,
 *       ZERO DB writes.
 *   t2. full chain success — operation_status:"DISABLE" on ALL THREE create
 *       bodies, schedule_start_time is a UTC+0 "YYYY-MM-DD HH:MM:SS" string
 *       within minutes of now (a local-tz bug would be hours off), the ad's
 *       landing_page_url = canonical dest, DB rows persisted PAUSED ×3.
 *   t3. CBO — bid_type present (BID_TYPE_NO_BID default) on the ad-group
 *       body pre-call; the campaign body carries the budget.
 *   t4. forced failures: campaign step (no rollback target), ad-group + ad
 *       steps (campaign/status/update operation_status:"DELETE"), and the
 *       geo_unavailable 422 naming the country with ZERO create calls.
 *   SNAPCHAT (hardening + D-3)
 *   s1. prototype-chain keys fail CLOSED on the creative-type map + CTA
 *       allowlist (constructor/toString/__proto__/hasOwnProperty/valueOf).
 *   s2. the RMW strip list drops the server-echoed legacy `objective`.
 *   s3. profile fail-close 424 snapchat_profile_missing (no secret), then the
 *       honest 422 creative_not_uploaded when the #866 ref is absent — both
 *       with ZERO DB writes and zero platform calls.
 *
 * Run: deno test --allow-env --allow-read --allow-net supabase/functions/_shared/__tests__/issue927_tester_adversarial_runtime.test.ts
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
// adChannel MUST evaluate before reddit.ts (adapter-registry cycle — the same
// order every shipped consumer uses).
import "../adChannel.ts";
import {
  buildRedditAdGroupBody,
  buildRedditCampaignBody,
  resetRedditBackoffForTests,
  resetRedditTokenCacheForTests,
  setRedditSleepForTests,
} from "../reddit.ts";
import {
  snapchatAdTypeForCreativeType,
  snapchatStripReadOnlyFields,
  validateSnapchatCta,
} from "../snapchat.ts";

// ── Shared request-log types ──────────────────────────────────────────────────

interface LoggedRequest {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

// ── Mock Supabase (GoTrue + PostgREST subset the branches touch) ──────────────

interface MockDbState {
  adminRow: Record<string, unknown> | null;
  connections: Record<string, Record<string, unknown> | null>;
  eventRow: Record<string, unknown> | null;
  adCreativeRow: Record<string, unknown> | null;
  refRow: Record<string, unknown> | null;
  /** table name whose INSERT should 500 (r5). */
  failInsertTable: string | null;
  writes: LoggedRequest[];
  reads: LoggedRequest[];
}

const db: MockDbState = {
  adminRow: { id: "admin-1" },
  connections: {},
  eventRow: null,
  adCreativeRow: null,
  refRow: null,
  failInsertTable: null,
  writes: [],
  reads: [],
};

function resetDb(): void {
  db.adminRow = { id: "admin-1" };
  db.connections = {
    reddit: {
      id: "conn-reddit-1",
      platform: "reddit",
      lane: "consumer",
      connected: true,
      status: "connected",
      external_account_id: "a2_qaacct",
      token_env_var: null,
      extra: {
        reddit_profile_id: "t2_qaprof",
        reddit_funding_instrument_id: "fi_qa_1",
        reddit_pixel_id: "px_qa_1",
      },
    },
    tiktok: {
      id: "conn-tiktok-1",
      platform: "tiktok",
      lane: "consumer",
      connected: true,
      status: "connected",
      external_account_id: "7000000000000000001",
      token_env_var: null,
      extra: { identity_type: "TT_USER", identity_id: "identity-qa-1" },
    },
    snapchat: {
      id: "conn-snap-1",
      platform: "snapchat",
      lane: "consumer",
      connected: true,
      status: "connected",
      external_account_id: "snap-acct-1",
      token_env_var: null,
      extra: {},
    },
  };
  db.eventRow = { id: "ev-1", brand_slug: "velvet-lounge", slug: "friday-live", status: "live" };
  db.adCreativeRow = null;
  db.refRow = null;
  db.failInsertTable = null;
  db.writes = [];
  db.reads = [];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function parseBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    return await req.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function tableRowFor(table: string, params: URLSearchParams): unknown {
  switch (table) {
    case "admin_users":
      return db.adminRow;
    case "ad_connections": {
      const platform = (params.get("platform") ?? "").replace(/^eq\./, "");
      return db.connections[platform] ?? null;
    }
    case "business_public_events_view":
      return db.eventRow;
    case "business_public_brands_view":
      return null;
    case "ad_creatives":
      return db.adCreativeRow;
    case "ad_creative_platform_refs":
      return db.refRow;
    case "ad_campaigns":
      return null; // idempotency probe — never a replay in this suite
    default:
      return null;
  }
}

const supabaseMock = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/auth/v1/user") {
    return json({
      id: "00000000-0000-4000-8000-0000000000aa",
      aud: "authenticated",
      role: "authenticated",
      email: "admin@usemingla.com",
      created_at: "2026-01-01T00:00:00Z",
      app_metadata: {},
      user_metadata: {},
    });
  }
  const restMatch = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
  if (!restMatch) return json({ message: `unmocked path ${url.pathname}` }, 404);
  const table = restMatch[1];

  if (req.method === "GET") {
    db.reads.push({ method: "GET", path: url.pathname + url.search, body: null });
    return json(tableRowFor(table, url.searchParams));
  }
  if (req.method === "POST") {
    const body = await parseBody(req);
    db.writes.push({ method: "POST", path: url.pathname, body });
    if (db.failInsertTable === table) {
      return json({ message: "forced db failure (qa927)", code: "QA500" }, 500);
    }
    const row = { id: (body?.id as string) ?? crypto.randomUUID(), ...body };
    return json(row, 201);
  }
  if (req.method === "DELETE") {
    db.writes.push({ method: "DELETE", path: url.pathname + url.search, body: null });
    return new Response(null, { status: 204 });
  }
  return json({ message: "unmocked method" }, 405);
});

// ── Mock Reddit Ads API ───────────────────────────────────────────────────────

interface RedditMockState {
  failAt: "" | "campaign" | "ad_group" | "creative" | "ad";
  api: LoggedRequest[];
}

const reddit: RedditMockState = { failAt: "", api: [] };

const redditMock = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;
  const raw = await parseBody(req);
  // redditRequest wraps create/update bodies as { data: body }.
  const data = (raw?.data ?? raw) as Record<string, unknown> | null;
  reddit.api.push({ method: req.method, path, body: data });

  if (path === "/token") {
    return json({ access_token: "qa-reddit-token", expires_in: 86400, scope: "ads.read ads.write" });
  }
  if (path === "/ad_accounts/a2_qaacct/campaigns" && req.method === "POST") {
    if (reddit.failAt === "campaign") return json({ error: { message: "forced campaign failure (qa927)" } }, 400);
    return json({ data: { id: "101" } }, 201);
  }
  if (path === "/targeting/geolocations_validations" || path === "/targeting/keyword_validations") {
    return json({ data: [] });
  }
  if (path === "/ad_accounts/a2_qaacct/ad_groups" && req.method === "POST") {
    if (reddit.failAt === "ad_group") return json({ error: { message: "forced ad_group failure (qa927)" } }, 400);
    return json({ data: { id: "202" } }, 201);
  }
  if (path === "/profiles/t2_qaprof/structured_posts/jobs" && req.method === "POST") {
    return json({ data: { job_id: "job-qa-1" } }, 201);
  }
  if (path === "/structured_posts/jobs/job-qa-1" && req.method === "GET") {
    if (reddit.failAt === "creative") {
      return json({ data: { status: "CLIENT_ERROR", errors: [{ message: "forced creative failure (qa927)" }] } });
    }
    return json({ data: { status: "SUCCESS", post_id: "t3_qapost1" } });
  }
  if (path === "/ad_accounts/a2_qaacct/ads" && req.method === "POST") {
    if (reddit.failAt === "ad") return json({ error: { message: "forced ad failure (qa927)" } }, 400);
    return json({
      data: { id: "303", effective_status: "PENDING_REVIEW", preview_url: "https://ads.reddit.example/preview/1" },
    }, 201);
  }
  if (req.method === "PATCH" && /^\/(campaigns|ad_groups|ads)\/\d+$/.test(path)) {
    return json({ data: {} });
  }
  return json({ error: { message: `unmocked reddit path ${req.method} ${path}` } }, 500);
});

// ── Mock TikTok Marketing API ─────────────────────────────────────────────────

interface TikTokMockState {
  failAt: "" | "campaign" | "ad_group" | "ad";
  geoMissing: boolean;
  api: LoggedRequest[];
}

const tiktok: TikTokMockState = { failAt: "", geoMissing: false, api: [] };

const tiktokMock = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;
  const body = await parseBody(req);
  tiktok.api.push({ method: req.method, path, body });

  const fail = (msg: string) => json({ code: 40002, message: msg, request_id: "qa-req-1" });

  if (path === "/open_api/v1.3/tool/region/") {
    const regions = tiktok.geoMissing
      ? [{ location_id: "2635167", region_code: "FR", level: "COUNTRY" }]
      : [{ location_id: "6252001", region_code: "US", level: "COUNTRY" }];
    return json({ code: 0, message: "OK", data: { region_info: regions } });
  }
  if (path === "/open_api/v1.3/file/image/ad/upload/") {
    return json({ code: 0, message: "OK", data: { image_id: "img-qa-1", material_id: "mat-qa-1" } });
  }
  if (path === "/open_api/v1.3/campaign/create/") {
    if (tiktok.failAt === "campaign") return fail("forced campaign failure (qa927)");
    return json({ code: 0, message: "OK", data: { campaign_id: "111" } });
  }
  if (path === "/open_api/v1.3/adgroup/create/") {
    if (tiktok.failAt === "ad_group") return fail("forced adgroup failure (qa927)");
    return json({ code: 0, message: "OK", data: { adgroup_id: "222" } });
  }
  if (path === "/open_api/v1.3/ad/create/") {
    if (tiktok.failAt === "ad") return fail("forced ad failure (qa927)");
    return json({ code: 0, message: "OK", data: { ad_ids: ["333"] } });
  }
  if (path === "/open_api/v1.3/campaign/get/") {
    return json({
      code: 0,
      message: "OK",
      data: { list: [{ campaign_id: "111", operation_status: "DISABLE", secondary_status: "CAMPAIGN_STATUS_DISABLE" }] },
    });
  }
  if (path === "/open_api/v1.3/campaign/status/update/") {
    return json({ code: 0, message: "OK", data: {} });
  }
  return fail(`unmocked tiktok path ${req.method} ${path}`);
});

// ── Env + edge-fn boot (env MUST precede the import — module-level reads) ─────

const supabasePort = (supabaseMock.addr as Deno.NetAddr).port;
const redditPort = (redditMock.addr as Deno.NetAddr).port;
const tiktokPort = (tiktokMock.addr as Deno.NetAddr).port;

Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${supabasePort}`);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "qa-service-key");
Deno.env.set("BUSINESS_WEB_ORIGIN", "https://business.qa927.example");
Deno.env.set("REDDIT_ADS_CLIENT_ID", "qa-client");
Deno.env.set("REDDIT_ADS_CLIENT_SECRET", "qa-secret");
Deno.env.set("REDDIT_ADS_REFRESH_TOKEN", "qa-refresh");
Deno.env.set("REDDIT_ADS_TOKEN_URL", `http://127.0.0.1:${redditPort}/token`);
Deno.env.set("REDDIT_ADS_API_BASE", `http://127.0.0.1:${redditPort}`);
Deno.env.set("TIKTOK_ACCESS_TOKEN", "qa-tiktok-token");
Deno.env.set("TIKTOK_GRAPH_BASE", `http://127.0.0.1:${tiktokPort}`);
Deno.env.delete("SNAPCHAT_PROFILE_ID");

setRedditSleepForTests(() => Promise.resolve());
resetRedditTokenCacheForTests();
resetRedditBackoffForTests();

// Importing the edge fn starts its std/http server on :8000.
await import("../../admin-ad-create-campaign/index.ts");

const EDGE_URL = "http://127.0.0.1:8000/";

async function waitForEdge(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(EDGE_URL, { method: "OPTIONS" });
      await res.text();
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("edge fn did not come up on :8000");
}
await waitForEdge();

async function callCreate(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(EDGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Opaque non-JWT fixture: the mock edge auth decides admin-ness, so the
      // value is arbitrary. Kept non-token-shaped so secret scanners don't flag it.
      Authorization: "Bearer qa-admin-test-fixture-not-a-real-token",
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

function resetAll(): void {
  resetDb();
  reddit.failAt = "";
  reddit.api = [];
  tiktok.failAt = "";
  tiktok.geoMissing = false;
  tiktok.api = [];
  resetRedditBackoffForTests();
}

const T = { sanitizeOps: false, sanitizeResources: false, sanitizeExit: false };

const redditBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  platform: "reddit",
  lane: "consumer",
  name: "QA927 Reddit — Friday Live",
  objective: "TRAFFIC",
  budget: { type: "daily", amount_cents: 2000 },
  targeting: { countries: ["US"] },
  destination: { page_type: "event", brand_slug: "velvet-lounge", entity_slug: "friday-live" },
  creative: {
    headline: "Friday Live at Velvet Lounge",
    image_url: "https://cdn.qa927.example/creative.jpg",
  },
  ...over,
});

const tiktokBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  platform: "tiktok",
  lane: "consumer",
  name: "QA927 TikTok — Friday Live",
  objective: "TRAFFIC",
  budget: { type: "daily", amount_cents: 2000 },
  targeting: { countries: ["US"], age_min: 21, age_max: 45 },
  destination: { page_type: "event", brand_slug: "velvet-lounge", entity_slug: "friday-live" },
  creative: {
    ad_text: "Friday Live at Velvet Lounge",
    image_url: "https://cdn.qa927.example/creative.jpg",
  },
  ...over,
});

const adTreeWrites = () =>
  db.writes.filter((w) =>
    w.method === "POST" &&
    ["/rest/v1/ad_campaigns", "/rest/v1/ad_sets", "/rest/v1/ads"].includes(w.path)
  );

const auditWrites = () => db.writes.filter((w) => w.path === "/rest/v1/ad_status_events");

// ══ r1 / t1 — validate gates FIRST (cold token cache proves zero mint) ════════

Deno.test({
  name: "927-QA r1: reddit validate_only — named-skipped-layers, ZERO reddit-bound requests (token mint included), ZERO DB writes",
  ...T,
  fn: async () => {
    resetAll();
    resetRedditTokenCacheForTests();
    const { status, body } = await callCreate(redditBody({ validate_only: true }));
    assertEquals(status, 200);
    assertEquals(body.validated, false);
    const layers = (body.skipped_layers as Record<string, unknown>[]).map((l) => l.layer);
    assertEquals(layers, ["campaign", "ad_group", "creative", "ad"]);
    assertEquals(reddit.api.length, 0, "a validate_only run may NEVER touch Reddit (not even the token mint)");
    assertEquals(db.writes.length, 0, "a validate_only run may NEVER write the DB");
  },
});

Deno.test({
  name: "927-QA t1: tiktok validate_only — named-skipped-layers, ZERO tiktok-bound requests, ZERO DB writes",
  ...T,
  fn: async () => {
    resetAll();
    const { status, body } = await callCreate(tiktokBody({ validate_only: true }));
    assertEquals(status, 200);
    assertEquals(body.validated, false);
    const layers = (body.skipped_layers as Record<string, unknown>[]).map((l) => l.layer);
    assertEquals(layers, ["campaign", "ad_group", "ad"]);
    assertEquals(tiktok.api.length, 0, "a validate_only run may NEVER touch TikTok (geo/upload/create)");
    assertEquals(db.writes.length, 0);
  },
});

// ══ r2 — reddit full chain: wire order + PAUSED ×3 + pixel + dest policy ══════

Deno.test({
  name: "927-QA r2: reddit full chain — wire order, configured_status PAUSED ×3, ad-group pixel, canonical click_url, PAUSED DB rows",
  ...T,
  fn: async () => {
    resetAll();
    resetRedditTokenCacheForTests();
    const { status, body } = await callCreate(redditBody());
    assertEquals(status, 200, JSON.stringify(body));

    // Wire order (token first — cold cache — then the §3 chain).
    const paths = reddit.api.map((r) => `${r.method} ${r.path}`);
    assertEquals(paths[0], "POST /token");
    const order = [
      "POST /ad_accounts/a2_qaacct/campaigns",
      "POST /targeting/geolocations_validations",
      "POST /ad_accounts/a2_qaacct/ad_groups",
      "POST /profiles/t2_qaprof/structured_posts/jobs",
      "GET /structured_posts/jobs/job-qa-1",
      "POST /ad_accounts/a2_qaacct/ads",
    ];
    const indices = order.map((step) => paths.indexOf(step));
    for (const [i, at] of indices.entries()) {
      assert(at >= 0, `missing wire step: ${order[i]} (saw: ${paths.join(" | ")})`);
      if (i > 0) assert(at > indices[i - 1], `wire order broken: ${order[i]} came before ${order[i - 1]}`);
    }

    // The three create bodies: PAUSED explicit on every one.
    const campaignBody = reddit.api.find((r) => r.path.endsWith("/campaigns"))!.body!;
    const adGroupBody = reddit.api.find((r) => r.path.endsWith("/ad_groups"))!.body!;
    const adBody = reddit.api.find((r) => r.path.endsWith("/ads"))!.body!;
    assertEquals(campaignBody.configured_status, "PAUSED");
    assertEquals(adGroupBody.configured_status, "PAUSED");
    assertEquals(adBody.configured_status, "PAUSED");

    // GR-12: the pixel rides the ad group, from the CONNECTION extras.
    assertEquals(adGroupBody.conversion_pixel_id, "px_qa_1");
    assertEquals(campaignBody.funding_instrument_id, "fi_qa_1");
    assertEquals(campaignBody.is_campaign_budget_optimization, false);

    // Destination policy: click_url = canonical page, never the OneLink.
    const clickUrl = String(adBody.click_url ?? "");
    assertStringIncludes(clickUrl, "https://business.qa927.example/e/velvet-lounge/friday-live");
    assert(!clickUrl.includes("go.usemingla.com"), "the OneLink must NEVER be the Reddit click_url");
    assertEquals(adBody.post_id, "t3_qapost1");

    // The pre-minted DB row id rides utm_campaign (click_url_query_parameters
    // — §3.5) AND is the persisted row id; utm_content carries the {{AD_ID}}
    // serve-time macro.
    const campaignInsert = db.writes.find((w) => w.path === "/rest/v1/ad_campaigns")!.body!;
    const queryParams = adBody.click_url_query_parameters as { name: string; value: string }[];
    const utmCampaign = queryParams.find((p) => p.name === "utm_campaign");
    assertEquals(utmCampaign?.value, String(campaignInsert.id), "utm_campaign must be the pre-minted DB row id");
    assert(queryParams.some((p) => p.value === "{{AD_ID}}"), "the {{AD_ID}} macro must ride the query params");

    // DB rows: PAUSED ×3, platform label reddit, smart link stored not sent.
    const adSetInsert = db.writes.find((w) => w.path === "/rest/v1/ad_sets")!.body!;
    const adInsert = db.writes.find((w) => w.path === "/rest/v1/ads")!.body!;
    assertEquals(campaignInsert.status, "PAUSED");
    assertEquals(campaignInsert.platform, "reddit");
    assertEquals(adSetInsert.status, "PAUSED");
    assertEquals(adInsert.status, "PAUSED");
    assertStringIncludes(String(campaignInsert.dest_smart_link), "pid=reddit_ads");
    assert(
      !JSON.stringify(campaignBody).includes("go.usemingla.com") &&
        !JSON.stringify(adGroupBody).includes("go.usemingla.com"),
      "the OneLink may never reach a Reddit create body",
    );
    assertEquals(adTreeWrites().length, 3);
    const audit = auditWrites();
    assertEquals(audit.length, 1);
    assertEquals(audit[0].body!.action, "create");
    assertEquals(audit[0].body!.to_status, "PAUSED");
  },
});

// ══ r3 — hostile injection fuzz ═══════════════════════════════════════════════

Deno.test({
  name: "927-QA r3: hostile injections (top-level + passthrough) cannot flip PAUSED or swap the pixel — no ACTIVE on the wire",
  ...T,
  fn: async () => {
    resetAll();
    const { status } = await callCreate(redditBody({
      status: "ACTIVE",
      configured_status: "ACTIVE",
      conversion_pixel_id: "px_EVIL",
      targeting: {
        countries: ["US"],
        passthrough: {
          reddit: {
            configured_status: "ACTIVE",
            conversion_pixel_id: "px_EVIL",
            funding_instrument_id: "fi_EVIL",
            keywords: ["velvet lounge"],
          },
        },
      },
    }));
    assertEquals(status, 200);
    const creates = reddit.api.filter((r) =>
      r.method === "POST" &&
      /(\/campaigns|\/ad_groups|\/ads)$/.test(r.path)
    );
    assertEquals(creates.length, 3);
    for (const c of creates) {
      assertEquals(c.body!.configured_status, "PAUSED", `${c.path} must stay PAUSED under hostile injection`);
      const flat = JSON.stringify(c.body);
      assert(!flat.includes('"ACTIVE"'), `${c.path}: injected ACTIVE reached the wire`);
      assert(!flat.includes("px_EVIL"), `${c.path}: injected pixel id reached the wire`);
      assert(!flat.includes("fi_EVIL"), `${c.path}: injected funding instrument reached the wire`);
    }
    const adGroupBody = creates.find((c) => c.path.endsWith("/ad_groups"))!.body!;
    assertEquals(adGroupBody.conversion_pixel_id, "px_qa_1", "the pixel must stay the connection's own");
    // The allowlisted passthrough key DID ride (control: the drop is selective,
    // not a dead passthrough) — and was validated on the wire first.
    const targeting = adGroupBody.targeting as Record<string, unknown>;
    assertEquals(targeting.keywords, ["velvet lounge"]);
    assert(
      reddit.api.some((r) => r.path === "/targeting/keyword_validations"),
      "allowlisted keywords must be validated pre-create",
    );
    assert(!("configured_status" in targeting), "passthrough configured_status must be dropped by the allowlist");
  },
});

// ══ r4 — forced failure at EVERY step: reverse-order PATCH DELETED ════════════

Deno.test({
  name: "927-QA r4a: campaign-step failure — 502, nothing to roll back, ZERO ad-tree rows",
  ...T,
  fn: async () => {
    resetAll();
    reddit.failAt = "campaign";
    const { status, body } = await callCreate(redditBody());
    assertEquals(status, 502);
    assertEquals(body.error, "reddit_create_failed");
    assertEquals(body.step, "campaign");
    assertEquals(reddit.api.filter((r) => r.method === "PATCH").length, 0);
    assertEquals(adTreeWrites().length, 0, "a failed create may NEVER leave DB rows");
    assertEquals(auditWrites().length, 1);
  },
});

Deno.test({
  name: "927-QA r4b: ad_group-step failure — rollback PATCHes DELETED on the campaign only",
  ...T,
  fn: async () => {
    resetAll();
    reddit.failAt = "ad_group";
    const { status, body } = await callCreate(redditBody());
    assertEquals(status, 502);
    assertEquals(body.step, "ad_group");
    assertEquals(body.rolled_back, true);
    const patches = reddit.api.filter((r) => r.method === "PATCH");
    assertEquals(patches.map((p) => p.path), ["/campaigns/101"]);
    assertEquals(patches[0].body!.configured_status, "DELETED");
    assertEquals(adTreeWrites().length, 0);
  },
});

Deno.test({
  name: "927-QA r4c: creative-step (job CLIENT_ERROR) — reverse-order rollback: ad_group THEN campaign, provider verdict verbatim",
  ...T,
  fn: async () => {
    resetAll();
    reddit.failAt = "creative";
    const { status, body } = await callCreate(redditBody());
    assertEquals(status, 502);
    assertEquals(body.step, "creative");
    assertEquals(body.rolled_back, true);
    const patches = reddit.api.filter((r) => r.method === "PATCH");
    assertEquals(
      patches.map((p) => p.path),
      ["/ad_groups/202", "/campaigns/101"],
      "rollback must run in REVERSE creation order",
    );
    for (const p of patches) assertEquals(p.body!.configured_status, "DELETED");
    assertStringIncludes(JSON.stringify(body.detail), "forced creative failure (qa927)");
    assertEquals(adTreeWrites().length, 0);
  },
});

Deno.test({
  name: "927-QA r4d: ad-step failure — reverse-order rollback + the orphaned t3_ post is RECORDED in the audit row",
  ...T,
  fn: async () => {
    resetAll();
    reddit.failAt = "ad";
    const { status, body } = await callCreate(redditBody());
    assertEquals(status, 502);
    assertEquals(body.step, "ad");
    const patches = reddit.api.filter((r) => r.method === "PATCH");
    assertEquals(patches.map((p) => p.path), ["/ad_groups/202", "/campaigns/101"]);
    assertEquals(adTreeWrites().length, 0);
    const audit = auditWrites();
    assertEquals(audit.length, 1);
    const externalIds = audit[0].body!.external_ids as Record<string, unknown>;
    assertEquals(externalIds.orphaned_post_id, "t3_qapost1", "§7.2: the orphaned post must be recorded");
    assertEquals(externalIds.profile_id, "t2_qaprof");
  },
});

// ══ r5 — DB persist failure AFTER platform success → platform rollback ════════

Deno.test({
  name: "927-QA r5: DB-persist failure after a successful chain — platform PATCH DELETED + 500 db_persist_failed_platform_rolled_back",
  ...T,
  fn: async () => {
    resetAll();
    db.failInsertTable = "ad_campaigns";
    const { status, body } = await callCreate(redditBody());
    assertEquals(status, 500);
    assertEquals(body.detail, "db_persist_failed_platform_rolled_back");
    const patches = reddit.api.filter((r) => r.method === "PATCH");
    assertEquals(patches.map((p) => p.path), ["/campaigns/101"], "the generic-envelope hook rolls the campaign back");
    assertEquals(patches[0].body!.configured_status, "DELETED");
    const audit = auditWrites();
    assertEquals(audit.length, 1);
    assertEquals(audit[0].body!.action, "rollback");
  },
});

// ══ r6 — builder-level runtime: the CBO campaign carries the pixel ════════════

Deno.test({
  name: "927-QA r6: buildRedditCampaignBody CBO carries conversion_pixel_id unconditionally; the ad-group builder fails CLOSED without one",
  ...T,
  fn: () => {
  const cbo = buildRedditCampaignBody({
    name: "QA927 CBO",
    objective: "TRAFFIC",
    fundingInstrumentId: "fi_qa_1",
    isCbo: true,
    goalType: "DAILY_SPEND",
    goalValueCents: 5000,
    bidStrategy: "MAXIMIZE_VOLUME",
    bidType: "CPC",
    startTime: new Date().toISOString(),
    conversionPixelId: "px_qa_1",
  });
  assertEquals(cbo.conversion_pixel_id, "px_qa_1", "GR-12: pixel on EVERY CBO campaign body");
  assertEquals(cbo.configured_status, "PAUSED");

  const nonCbo = buildRedditCampaignBody({
    name: "QA927 non-CBO",
    objective: "TRAFFIC",
    fundingInstrumentId: "fi_qa_1",
    isCbo: false,
    conversionPixelId: "px_qa_1",
  });
  assert(!("conversion_pixel_id" in nonCbo), "non-CBO campaign: pixel lives on the ad group");

  let threw = false;
  try {
    buildRedditAdGroupBody({
      campaignExternalId: "101",
      name: "QA927 group",
      budgetCents: 2000,
      conversionPixelId: "",
      startTime: new Date().toISOString(),
      targeting: { geolocations: ["US"] },
    });
  } catch (err) {
    threw = true;
    assertStringIncludes(String(err), "conversion_pixel_id is required");
  }
  assert(threw, "an ad group without a pixel must fail CLOSED in the builder");
  },
});

// ══ t2 — tiktok full chain: DISABLE ×3 + UTC schedule + canonical landing ═════

Deno.test({
  name: "927-QA t2: tiktok full chain — operation_status DISABLE ×3, UTC+0 schedule string, canonical landing_page_url, PAUSED DB rows",
  ...T,
  fn: async () => {
    resetAll();
    const { status, body } = await callCreate(tiktokBody());
    assertEquals(status, 200, JSON.stringify(body));

    const paths = tiktok.api.map((r) => `${r.method} ${r.path}`);
    const order = [
      "GET /open_api/v1.3/tool/region/",
      "POST /open_api/v1.3/file/image/ad/upload/",
      "POST /open_api/v1.3/campaign/create/",
      "POST /open_api/v1.3/adgroup/create/",
      "POST /open_api/v1.3/ad/create/",
    ];
    const indices = order.map((step) => paths.indexOf(step));
    for (const [i, at] of indices.entries()) {
      assert(at >= 0, `missing wire step: ${order[i]} (saw: ${paths.join(" | ")})`);
      if (i > 0) assert(at > indices[i - 1], `wire order broken at ${order[i]}`);
    }

    const campaignBody = tiktok.api.find((r) => r.path.endsWith("campaign/create/"))!.body!;
    const adGroupBody = tiktok.api.find((r) => r.path.endsWith("adgroup/create/"))!.body!;
    const adBody = tiktok.api.find((r) => r.path.endsWith("ad/create/"))!.body!;
    assertEquals(campaignBody.operation_status, "DISABLE");
    assertEquals(adGroupBody.operation_status, "DISABLE");
    assertStringIncludes(JSON.stringify(adBody), '"operation_status":"DISABLE"');

    // A1.1(a): the schedule string is UTC+0 "YYYY-MM-DD HH:MM:SS" — parse it
    // AS UTC and it must sit within minutes of now (a local-tz emission on
    // this machine would be ~4h off).
    const schedule = String(adGroupBody.schedule_start_time ?? "");
    assert(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(schedule),
      `schedule_start_time not the UTC+0 format: "${schedule}"`,
    );
    const asUtc = new Date(schedule.replace(" ", "T") + "Z").getTime();
    assert(
      Math.abs(Date.now() - asUtc) < 10 * 60 * 1000,
      `schedule_start_time "${schedule}" is not UTC-now (off by ${
        Math.round((Date.now() - asUtc) / 60000)
      } min — a local-timezone emission)`,
    );

    // ABO default: budget on the ad group, none on the campaign; no bid_type
    // unless CBO or explicitly sent.
    assert(!("budget" in campaignBody), "ABO: the campaign body must not carry a budget");
    assertEquals(adGroupBody.budget_mode, "BUDGET_MODE_DAY");
    assertEquals(adGroupBody.budget, 20);
    assert(!("bid_type" in adGroupBody), "ABO without an explicit bid_type sends none");

    // Geo: the resolved numeric id — never the ISO code.
    assertEquals(adGroupBody.location_ids, ["6252001"]);

    // Destination policy on the ad.
    const adFlat = JSON.stringify(adBody);
    assertStringIncludes(adFlat, "https://business.qa927.example/e/velvet-lounge/friday-live");
    assert(!adFlat.includes("go.usemingla.com"), "the OneLink may never be the TikTok landing page");
    assertStringIncludes(adFlat, "__CAMPAIGN_ID__");
    assertEquals((adBody.creatives as Record<string, unknown>[])[0].image_ids, ["img-qa-1"]);

    // DB rows PAUSED ×3 + audit.
    const campaignInsert = db.writes.find((w) => w.path === "/rest/v1/ad_campaigns")!.body!;
    assertEquals(campaignInsert.platform, "tiktok");
    assertEquals(campaignInsert.status, "PAUSED");
    assertStringIncludes(String(campaignInsert.dest_smart_link), "pid=tiktok_ads");
    assertEquals(adTreeWrites().length, 3);
    assertEquals(auditWrites().length, 1);
  },
});

// ══ t3 — CBO: bid_type REQUIRED pre-call (builder default) ════════════════════

Deno.test({
  name: "927-QA t3: CBO — the ad-group body carries bid_type (BID_TYPE_NO_BID default) and the campaign carries the budget",
  ...T,
  fn: async () => {
    resetAll();
    const { status } = await callCreate(tiktokBody({
      budget: { type: "daily", amount_cents: 5000, level: "campaign" },
    }));
    assertEquals(status, 200);
    const campaignBody = tiktok.api.find((r) => r.path.endsWith("campaign/create/"))!.body!;
    const adGroupBody = tiktok.api.find((r) => r.path.endsWith("adgroup/create/"))!.body!;
    assertEquals(campaignBody.budget_mode, "BUDGET_MODE_DAY");
    assertEquals(campaignBody.budget, 50);
    assertEquals(campaignBody.operation_status, "DISABLE");
    assertEquals(
      adGroupBody.bid_type,
      "BID_TYPE_NO_BID",
      "A1.1(b): bid_type is REQUIRED under CBO — the builder must default it pre-call",
    );
    assert(!("budget" in adGroupBody) || adGroupBody.budget === undefined || adGroupBody.budget === null,
      "CBO: the ad group must not carry its own budget");
  },
});

// ══ t4 — tiktok forced failures + the geo 422 ═════════════════════════════════

Deno.test({
  name: "927-QA t4a: tiktok campaign-step failure — 502, no rollback target, ZERO ad-tree rows",
  ...T,
  fn: async () => {
    resetAll();
    tiktok.failAt = "campaign";
    const { status, body } = await callCreate(tiktokBody());
    assertEquals(status, 502);
    assertEquals(body.error, "tiktok_create_failed");
    assertEquals(body.step, "campaign");
    assert(!tiktok.api.some((r) => r.path.endsWith("status/update/")), "nothing exists to roll back");
    assertEquals(adTreeWrites().length, 0);
    assertEquals(auditWrites().length, 1);
  },
});

Deno.test({
  name: "927-QA t4b: tiktok ad_group-step failure — campaign/status/update operation_status DELETE (cascade rollback)",
  ...T,
  fn: async () => {
    resetAll();
    tiktok.failAt = "ad_group";
    const { status, body } = await callCreate(tiktokBody());
    assertEquals(status, 502);
    assertEquals(body.step, "ad_set");
    assertEquals(body.rolled_back, true);
    const rollback = tiktok.api.find((r) => r.path.endsWith("campaign/status/update/"));
    assert(rollback, "the rollback hook must fire");
    assertEquals(rollback!.body!.operation_status, "DELETE");
    assertEquals(rollback!.body!.campaign_ids, ["111"]);
    assertEquals(adTreeWrites().length, 0);
  },
});

Deno.test({
  name: "927-QA t4c: tiktok ad-step failure — rollback DELETE cascades; ZERO ad-tree rows",
  ...T,
  fn: async () => {
    resetAll();
    tiktok.failAt = "ad";
    const { status, body } = await callCreate(tiktokBody());
    assertEquals(status, 502);
    assertEquals(body.step, "ad");
    const rollback = tiktok.api.find((r) => r.path.endsWith("campaign/status/update/"));
    assert(rollback, "the rollback hook must fire");
    assertEquals(adTreeWrites().length, 0);
  },
});

Deno.test({
  name: "927-QA t4d: geo_unavailable — loud 422 NAMING the country, zero create calls, zero DB writes",
  ...T,
  fn: async () => {
    resetAll();
    tiktok.geoMissing = true;
    const { status, body } = await callCreate(tiktokBody());
    assertEquals(status, 422);
    assertEquals(body.error, "geo_unavailable");
    assertStringIncludes(String(body.detail), "US");
    assert(
      !tiktok.api.some((r) => /(campaign|adgroup|ad)\/create\/$/.test(r.path)),
      "an unavailable geo must fail BEFORE any create call",
    );
    assertEquals(adTreeWrites().length, 0);
    assertEquals(db.writes.length, 0);
  },
});

// ══ s1/s2 — snapchat hardening one-liners, attacked at runtime ════════════════

Deno.test({
  name: "927-QA s1: prototype-chain keys fail CLOSED on the creative-type map AND the CTA allowlist",
  ...T,
  fn: () => {
  for (const hostile of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    let threw = false;
    try {
      snapchatAdTypeForCreativeType(hostile);
    } catch (err) {
      threw = true;
      assert(
        !String(err).includes("TypeError"),
        `creative-type map: "${hostile}" must fail CLOSED with the named error, not a TypeError`,
      );
    }
    assert(threw, `creative-type map: "${hostile}" must throw (fail closed), got a value back`);

    const cta = validateSnapchatCta(hostile, "BUY_TICKETS");
    assertEquals(cta.ok, false, `CTA allowlist: "${hostile}" must be rejected`);
    if (!cta.ok) {
      assertEquals(cta.detail, "invalid_cta", `CTA allowlist: "${hostile}" must be a clean invalid_cta`);
    }
  }
  // Positive control — the real key still resolves.
  assertEquals(snapchatAdTypeForCreativeType("WEB_VIEW"), "REMOTE_WEBPAGE");
  assertEquals(validateSnapchatCta("WEB_VIEW", "BUY_TICKETS").ok, true);
  },
});

Deno.test({
  name: "927-QA s2: the RMW strip list drops the server-echoed legacy `objective` (and keeps writable fields)",
  ...T,
  fn: () => {
  const stripped = snapchatStripReadOnlyFields({
    name: "QA927 campaign",
    objective: "WEB_CONVERSION", // Snap's read-back echo of the deprecated legacy key
    status: "PAUSED",
  });
  assert(!("objective" in stripped), "the legacy objective must be stripped from echoed bodies");
  assertEquals(stripped.name, "QA927 campaign");
  },
});

// ══ s3 — snapchat fail-closes: profile 424, then the honest D-3 422 ═══════════

Deno.test({
  name: "927-QA s3: snapchat — 424 snapchat_profile_missing without the secret; honest 422 creative_not_uploaded when the #866 ref is absent; ZERO DB writes",
  ...T,
  fn: async () => {
    resetAll();
    Deno.env.delete("SNAPCHAT_PROFILE_ID");
    const snapBody = {
      platform: "snapchat",
      lane: "consumer",
      name: "QA927 Snap — Friday Live",
      objective: "TRAFFIC",
      budget: { type: "daily", amount_cents: 2000 },
      targeting: { countries: ["US"] },
      destination: { page_type: "event", brand_slug: "velvet-lounge", entity_slug: "friday-live" },
      creative: {
        headline: "Friday Live",
        brand_name: "Velvet Lounge",
        creative_library_id: "11111111-2222-4333-8444-555555555555",
      },
    };

    // (a) No profile anywhere → 424 fail-close, zero provider calls.
    const first = await callCreate(snapBody);
    assertEquals(first.status, 424);
    assertEquals(first.body.error, "snapchat_profile_missing");
    assertEquals(db.writes.length, 0);

    // (b) Profile seeded, library row exists, NO ready platform ref → the
    // honest D-3 422 — never a silent failure, never a create.
    Deno.env.set("SNAPCHAT_PROFILE_ID", "qa-snap-profile-1");
    try {
      db.adCreativeRow = {
        id: "11111111-2222-4333-8444-555555555555",
        kind: "image",
        content_hash: "hash-1",
        duration_seconds: null,
      };
      db.refRow = null; // the #866 upload leg never ran
      const second = await callCreate(snapBody);
      assertEquals(second.status, 422);
      assertEquals(second.body.error, "creative_not_uploaded");
      assertEquals(db.writes.length, 0, "an unuploaded creative must not write ANY row");
    } finally {
      Deno.env.delete("SNAPCHAT_PROFILE_ID");
    }
  },
});
