/* #1615 independent tester adversarial suite.
 *
 * This suite attacks different seams from the implementor happy path: spend
 * amplification, proxy-header spoofing, revocation cache drift, malformed deep
 * links, fabricated facts, injection, and cross-surface route/config drift.
 *
 * FAILS-ON-REVERT: after this suite is green, reverting the production
 * cross-owner predicate `.eq("profile_id", user.id)` in shared-card/index.ts
 * must make A4 fail; restore must return the suite to green.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const migration = () => read("supabase/migrations/20270225001615_issue_1615_public_share_snapshots.sql");
const edge = () => read("supabase/functions/shared-card/index.ts");

test("A1 public read throttling has bounded retention, not an immortal row per actor/window", () => {
  const sql = migration();
  assert.match(sql, /delete\s+from\s+public\.shared_card_rate_limits[\s\S]*(window_start|created_at)\s*</i,
    "rate-limit rows need an explicit time-bounded deletion path");
  assert.match(sql, /shared_card_rate_limits[\s\S]*(window_start|created_at)/i);
});

test("A2 read actor identity does not trust caller-controlled x-forwarded-for", () => {
  const source = edge();
  assert.doesNotMatch(source, /headers\.get\(["']x-forwarded-for["']\)/i,
    "raw clients can supply/rotate X-Forwarded-For unless the platform documents replacement");
  assert.match(source, /(sb-forwarded-for|cf-connecting-ip|platform[^\n]*rate.?limit|gateway[^\n]*rate.?limit)/i,
    "use a platform-authenticated actor source or a gateway-backed limiter");
});

test("A3 malformed, missing, expired and revoked IDs fail closed at the served boundary", () => {
  const source = edge();
  assert.match(source, /SHARE_RE\s*=\s*\/\^\[a-f0-9\]\{36\}\$\//);
  assert.match(source, /!SHARE_RE\.test\(shareId\)[\s\S]*404/);
  assert.match(source, /!data[\s\S]*404/);
  assert.match(source, /data\.revoked_at[\s\S]*expires_at[\s\S]*410/);
});

test("A4 curated creation is owner-bound and cannot read another user's saved card", () => {
  const source = edge();
  assert.match(source, /from\("saved_card"\)[\s\S]*\.eq\("id", savedCardId\)\.eq\("profile_id", user\.id\)\.maybeSingle\(\)/);
});

test("A5 revocation cannot drift behind shared-page or image CDN caches", () => {
  const pageApi = read("mingla-business/api/shared-card.js");
  const imageApi = read("mingla-business/api/shared-card-image.js");
  const preview = read("mingla-business/server/socialPreview.js");
  const sharedSources = `${pageApi}\n${imageApi}\n${preview}`;
  assert.match(sharedSources, /(no-store|private,\s*max-age=0)/i,
    "revoked/expired share responses must not remain publicly cacheable");
  assert.doesNotMatch(pageApi, /sendHtml\(/,
    "shared pages must not use the generic cacheable business-page sender");
  assert.doesNotMatch(imageApi, /sendPng\(/,
    "shared images must not use the generic cacheable business-image sender");
});

test("A6 a missing curated-stop fact disappears instead of becoming a fabricated Stop", () => {
  const { renderSharedCardHtml } = require(path.join(ROOT, "mingla-business/server/socialPreview.js"));
  const html = renderSharedCardHtml({
    share_id: "a".repeat(36), kind: "curated", title: "Real plan", cover_url: null,
    metadata: {}, stops: [{}, { title: "  " }, { title: "Real cafe" }],
  }, "https://go.usemingla.com/w36m?deep_link_sub1=x");
  assert.doesNotMatch(html, /<li>Stop<\/li>/);
  assert.doesNotMatch(html, /<li>\s*<\/li>/);
  assert.match(html, /<li>Real cafe<\/li>/);
});

test("A7 shared HTML escapes text, attributes and action payloads", () => {
  const { renderSharedCardHtml } = require(path.join(ROOT, "mingla-business/server/socialPreview.js"));
  const html = renderSharedCardHtml({
    share_id: "b".repeat(36), kind: "curated", title: '<script id="title-x">x</script>',
    cover_url: 'https://img.test/x" onerror="alert(1)',
    metadata: { category: '<img id="fact-x">', description: '<svg id="desc-x">', phone: '1" onclick="alert(1)' },
    stops: [{ title: '<iframe id="stop-x">' }],
  }, 'https://go.usemingla.com/w36m?x=" onclick="alert(1)');
  for (const id of ["title-x", "fact-x", "desc-x", "stop-x"]) assert.doesNotMatch(html, new RegExp(`<[^>]+id=["']${id}`));
  assert.doesNotMatch(html, /\sonerror="|\sonclick="/i);
  assert.match(html, /onerror=&quot;/i);
  assert.match(html, /onclick=&quot;/i);
  assert.match(html, /&lt;script/);
  assert.match(html, /&lt;iframe/);
});

test("A8 coverless truth omits all OG/Twitter image metadata and S4/S5 bytes", async () => {
  const { renderSharedCardHtml } = require(path.join(ROOT, "mingla-business/server/socialPreview.js"));
  const html = renderSharedCardHtml({ share_id: "c".repeat(36), kind: "place", title: "Plain", cover_url: null, metadata: {}, stops: [] }, "https://go.usemingla.com/w36m");
  assert.doesNotMatch(html, /(?:og:image|twitter:image)/);
  const { createSharedCardImageHandler } = require(path.join(ROOT, "mingla-business/api/shared-card-image.js"));
  const res = { statusCode: 200, setHeader() {}, end(body) { this.body = body; } };
  await createSharedCardImageHandler(async () => ({ status: 200, snapshot: { cover_url: null } }))({ query: { shareId: "c".repeat(36), surface: "s5" } }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body, undefined);
});

test("A9 OneLink rejects malformed and half-formed opaque share payloads", async () => {
  const { resolveOneLinkDestination } = await import(path.join(ROOT, "app-mobile/src/services/oneLinkResolver.ts"));
  const valid = "d".repeat(36);
  assert.deepEqual(resolveOneLinkDestination({ deep_link_value: "place", deep_link_sub1: valid }), { kind: "share", shareType: "place", shareId: valid });
  for (const bad of ["", "short", "g".repeat(36), "d".repeat(35), `${valid}/tail`, "../settings"])
    assert.equal(resolveOneLinkDestination({ deep_link_value: "curated", deep_link_sub1: bad }), null, bad);
  assert.equal(resolveOneLinkDestination({ deep_link_value: "", deep_link_sub1: valid }), null);
});

test("A10 canonical web, native App Link, OneLink, AASA and proxy routes agree on /p", () => {
  const mobile = read("app-mobile/app.json");
  const aasa = read("mingla-marketing/public/.well-known/apple-app-site-association");
  const marketing = JSON.parse(read("mingla-marketing/vercel.json"));
  const business = JSON.parse(read("mingla-business/vercel.json"));
  assert.match(mobile, /"pathPrefix"\s*:\s*"\/p"/);
  assert.match(aasa, /"\/p\/\*"/);
  assert.equal(marketing.rewrites[0].source, "/p/:shareId");
  assert.equal(business.rewrites[2].source, "/p/:shareId");
  assert.ok(fs.existsSync(path.join(ROOT, "app-mobile/app/p/[shareId].tsx")));
  assert.match(read("app-mobile/src/services/oneLinkShare.ts"), /go\.usemingla\.com/);
});

test("A11 bot and human S6 select the same ordered facts from the versioned snapshot", () => {
  const server = read("mingla-business/server/socialPreview.js");
  const native = read("app-mobile/app/p/[shareId].tsx");
  assert.match(server, /\[metadata\.category, metadata\.location, metadata\.price, metadata\.duration\]/);
  assert.match(native, /\[metadata\.category,\s*metadata\.location,\s*metadata\.price,\s*metadata\.duration\]/s,
    "native must not depend on JSON object insertion order");
  assert.match(edge(), /snapshot_version/);
});

test("A12 D8 stays default-off and only explicit override activates Direction C", () => {
  const renderer = read("mingla-business/server/cardIdentityRenderer.js");
  assert.match(renderer, /preview === "c" \|\| process\.env\.MINGLA_CARD_IDENTITY_OG_ENABLED === "true"/);
  assert.doesNotMatch(renderer, /MINGLA_CARD_IDENTITY_OG_ENABLED\s*!==\s*["']false/);
});

test("A13 duplicate share taps share one in-flight creation and all controls disable", () => {
  const modal = read("app-mobile/src/components/ShareModal.tsx");
  assert.match(modal, /if \(sharedCardPromiseRef\.current\) return sharedCardPromiseRef\.current/);
  assert.match(modal, /if \(isSharing\) return/);
  assert.ok((modal.match(/disabled=\{isSharing\}/g) || []).length >= 6);
});

test("A14 business entity routes and event checkout remain mounted beside share routes", () => {
  const vercel = read("mingla-business/vercel.json");
  for (const route of ["public-event", "public-trip", "public-brand", "public-venue", "og-event", "og-trip", "og-brand", "og-venue"])
    assert.match(vercel, new RegExp(route));
  const server = read("mingla-business/server/socialPreview.js");
  assert.match(server, /\/checkout\/\$\{encodeURIComponent\(row\.id\)\}/);
  for (const step of ["index.tsx", "buyer.tsx", "payment.tsx", "confirm.tsx"])
    assert.ok(fs.existsSync(path.join(ROOT, "mingla-business/app/checkout/[eventId]", step)), step);
});

test("A15 public snapshot responses strip owner, source IDs and nested stop IDs", async () => {
  const { publicSnapshotResponse } = await import(path.join(ROOT, "supabase/functions/shared-card/snapshot.ts"));
  const output = publicSnapshotResponse({ share_id: "e".repeat(36), kind: "curated", title: "Plan", metadata: {}, stops: [{ title: "Cafe", placeId: "private-stop" }], source_ids: { savedCardId: "private-card" }, owner_profile_id: "private-owner", attribution: { referralCode: "R" } });
  const serialized = JSON.stringify(output);
  for (const secret of ["private-stop", "private-card", "private-owner", "source_ids", "owner_profile_id", "placeId"])
    assert.doesNotMatch(serialized, new RegExp(secret));
});

test("A16 the shared fact selector executes in domain order and every renderer consumes it", () => {
  const metadata = {};
  metadata.duration = "2 hours";
  metadata.ignored = "must never render";
  metadata.price = "$20";
  metadata.location = "Durham";
  metadata.category = "Cafe";

  const identity = require(path.join(ROOT, "packages/card-identity"));
  assert.deepEqual(identity.selectSharedCardFacts(metadata), ["Cafe", "Durham"]);
  assert.deepEqual(identity.selectSharedCardFacts(metadata, 4), ["Cafe", "Durham", "$20", "2 hours"]);

  const cardRenderer = require(path.join(ROOT, "mingla-business/server/cardIdentityRenderer.js"));
  assert.deepEqual(cardRenderer.factsFor({ metadata }), ["Cafe", "Durham"]);
  const { renderSharedCardHtml } = require(path.join(ROOT, "mingla-business/server/socialPreview.js"));
  const html = renderSharedCardHtml({ share_id: "f".repeat(36), kind: "place", title: "Truth", cover_url: null, metadata, stops: [] }, "https://go.usemingla.com/w36m");
  assert.match(html, /Cafe · Durham/);
  assert.doesNotMatch(html, /must never render|2 hours · \$20/);

  const withoutComments = (source) => source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  const server = withoutComments(read("mingla-business/server/socialPreview.js"));
  const image = withoutComments(read("mingla-business/server/cardIdentityRenderer.js"));
  const native = withoutComments(read("app-mobile/app/p/[shareId].tsx"));
  assert.match(server, /require\("@mingla\/card-identity"\)/);
  assert.match(server, /const facts = selectSharedCardFacts\(metadata\)/);
  assert.match(image, /selectSharedCardFacts[\s\S]*require\("@mingla\/card-identity"\)/);
  assert.match(image, /return selectSharedCardFacts\(m\)/);
  assert.match(native, /import \{[^}]*selectSharedCardFacts[^}]*\} from '@mingla\/card-identity'/);
  assert.match(native, /const facts = selectSharedCardFacts\(metadata\)\.join\(' · '\)/);
  for (const source of [server, image, native]) assert.doesNotMatch(source, /Object\.values\(/);
});

test("A17 shared no-store headers execute on every success, missing, gone and error path", async () => {
  const { sendSharedHtml } = require(path.join(ROOT, "mingla-business/server/socialPreview.js"));
  const { createSharedCardImageHandler } = require(path.join(ROOT, "mingla-business/api/shared-card-image.js"));
  const response = () => ({
    statusCode: 200,
    headers: {},
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    end(body) { this.body = body; },
  });
  const assertNoStore = (res) => {
    assert.match(res.headers["cache-control"], /private[\s\S]*no-store/);
    assert.equal(res.headers["cdn-cache-control"], "no-store");
    assert.equal(res.headers["vercel-cdn-cache-control"], "no-store");
  };

  for (const status of [200, 404, 410, 500]) {
    const res = response();
    sendSharedHtml(res, "body", status);
    assert.equal(res.statusCode, status);
    assertNoStore(res);
  }

  const cases = [
    { fetch: async () => ({ status: 200, snapshot: { cover_url: "https://img.test/cover.jpg" } }), render: async () => Buffer.from("png"), status: 200 },
    { fetch: async () => ({ status: 404, snapshot: null }), render: async () => Buffer.from("unused"), status: 404 },
    { fetch: async () => ({ status: 410, snapshot: null }), render: async () => Buffer.from("unused"), status: 410 },
    { fetch: async () => { throw new Error("upstream"); }, render: async () => Buffer.from("unused"), status: 404 },
    { fetch: async () => ({ status: 200, snapshot: { cover_url: "https://img.test/cover.jpg" } }), render: async () => { throw new Error("render"); }, status: 404 },
  ];
  for (const entry of cases) {
    const res = response();
    await createSharedCardImageHandler(entry.fetch, entry.render)({ query: { shareId: "a".repeat(36), surface: "s5" } }, res);
    assert.equal(res.statusCode, entry.status);
    assertNoStore(res);
  }
});

test("A18 anonymous missing-ID spend and known-link availability are not protected by a resource-only post-read bucket", () => {
  const getBlock = edge()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1")
    .split('if (req.method !== "POST")')[0]
    .split('if (req.method === "GET")')[1];
  assert.ok(getBlock, "GET branch exists");
  const lookup = getBlock.indexOf('from("shared_card_snapshots")');
  const limiter = getBlock.indexOf('rpc("consume_shared_card_rate_limit"');
  assert.ok(lookup >= 0 && limiter >= 0, "snapshot lookup and limiter both exist");
  assert.ok(limiter < lookup,
    "shape-valid random missing IDs must be throttled before they spend a database lookup");
  assert.doesNotMatch(getBlock, /actorHash\(serviceKey,\s*`share:\$\{shareId\}`\)/,
    "a share-wide bucket lets one caller exhaust the link for every legitimate crawler and user");
});

test("A19 marketing owns no-store/status/content-type even when upstream fetch or body read rejects", async () => {
  const { proxySharedCard } = await import(path.join(ROOT, "mingla-marketing/lib/shared-card-proxy.ts"));
  const previous = process.env.SHARED_CARD_PROXY_SECRET;
  process.env.SHARED_CARD_PROXY_SECRET = "tester-proxy-secret";
  const shareId = "a".repeat(36);
  const marked = new Request(`https://usemingla.com/api/shared-card/${shareId}`, {
    headers: { "x-mingla-internal-share-route": "tester-proxy-secret" },
  });
  const assertOwnedFailure = async (fetchImpl) => {
    const response = await proxySharedCard(marked, shareId, "data", fetchImpl);
    assert.equal(response.status, 502);
    assert.match(response.headers.get("content-type"), /^application\/json/);
    assert.match(response.headers.get("cache-control"), /private[\s\S]*no-store/);
    assert.equal(response.headers.get("cdn-cache-control"), "no-store");
    assert.equal(response.headers.get("vercel-cdn-cache-control"), "no-store");
  };
  try {
    await assertOwnedFailure(async () => { throw new Error("network rejected"); });
    await assertOwnedFailure(async () => ({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      arrayBuffer: async () => { throw new Error("body rejected"); },
    }));
  } finally {
    if (previous === undefined) delete process.env.SHARED_CARD_PROXY_SECRET;
    else process.env.SHARED_CARD_PROXY_SECRET = previous;
  }
});
