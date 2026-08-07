/* #1615 implementor happy path.
 * FAILS-ON-REVERT: reverting the authoritative-source query in
 * supabase/functions/shared-card/index.ts makes H2/H3 fail; reverting the
 * S4/S5 renderer line makes H5-H8 fail; reverting `/p` routing makes H10 fail.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("H1 schema is opaque, versioned, expiring, revoked and service-only", () => {
  const sql = read("supabase/migrations/20270225001615_issue_1615_public_share_snapshots.sql");
  for (const needle of ["gen_random_bytes(18)", "snapshot_version", "expires_at", "revoked_at", "force row level security", "revoke all on public.shared_card_snapshots from anon, authenticated", "consume_shared_card_rate_limit"]) assert.match(sql, new RegExp(needle.replace(/[()]/g, "\\$&"), "i"));
});

test("H2 create accepts identities, then derives facts from authoritative sources", () => {
  const source = read("supabase/functions/shared-card/index.ts");
  assert.match(source, /from\("place_pool"\)\.select/);
  assert.match(source, /from\("saved_card"\).*\.eq\("profile_id", user\.id\)/s);
  assert.doesNotMatch(source, /title\s*=\s*clean\(raw\?\.title/);
  assert.doesNotMatch(source, /cover_url:\s*httpsUrl\(raw/);
});

test("H3 read boundary distinguishes malformed/missing from gone and rate limits", () => {
  const source = read("supabase/functions/shared-card/index.ts");
  assert.match(source, /SHARE_RE.*return json\(\{ error: "not_found" \}, 404\)/s);
  assert.match(source, /revoked_at.*expires_at.*return json\(\{ error: "gone" \}, 410\)/s);
  assert.match(source, /p_action: "read"/);
});

test("H4 URL owner declares canonical, S4 and S5 shapes", () => {
  const source = read("mingla-business/src/constants/publicUrls.ts");
  for (const name of ["sharedCardPublicUrl", "sharedCardSnippetUrl", "sharedCardOgImageUrl"]) assert.match(source, new RegExp(`export const ${name}`));
  assert.match(source, /EXPLORER_PUBLIC_ORIGIN = "https:\/\/usemingla\.com"/);
});

test("H5 shared renderer consumes descriptor, ramp, plate and both boundary selectors", () => {
  const source = read("mingla-business/server/cardIdentityRenderer.js");
  for (const needle of ["SURFACES[surfaceKey]", "RAMP.bottom", "PLATE.fallbackSolid", "surfacePlateBoundary(surfaceKey)", "surfaceSliverBoundary(surfaceKey)", "s.sliver.insets[index]"]) assert.ok(source.includes(needle), needle);
});

test("H6 S4/S5 dimensions, measured sliver insets, and white lockup are exact", () => {
  const ci = require(path.join(ROOT, "packages/card-identity"));
  assert.deepEqual([ci.SURFACES.s4Snippet.w * 3, ci.SURFACES.s4Snippet.h * 3], [1080, 1350]);
  assert.deepEqual([ci.SURFACES.s5Og.w, ci.SURFACES.s5Og.h], [1200, 630]);
  assert.deepEqual(ci.SURFACES.s4Snippet.sliver.insets, [25, 35]);
  assert.deepEqual(ci.SURFACES.s5Og.sliver.insets, [66, 76]);
  assert.match(read("mingla-business/server/cardIdentityRenderer.js"), /rgba\(255,255,255,0\.72\)/);
});

test("H7 S6 uses web glass with the package fallback and truthful coverless metadata", () => {
  const renderer = read("mingla-business/server/cardIdentityRenderer.js");
  const preview = read("mingla-business/server/socialPreview.js");
  assert.match(renderer, /backdrop-filter:blur/);
  assert.match(renderer, /@supports not/);
  assert.match(preview, /imageUrl \? `<meta property="og:image"/);
  assert.match(preview, /class="share-cover coverless"/);
});

test("H8 one snapshot feeds S4, S5, and S6 without duplicated data reads", () => {
  const vercel = JSON.parse(read("mingla-business/vercel.json"));
  const text = JSON.stringify(vercel.rewrites);
  assert.match(text, /shared-card-image\?shareId=:shareId&surface=s4/);
  assert.match(text, /shared-card-image\?shareId=:shareId&surface=s5/);
  assert.match(text, /shared-card\?shareId=:shareId/);
});

test("H9 venue bot metadata has its own handler and D8 is default-off with v=c override", () => {
  const vercel = read("mingla-business/vercel.json");
  assert.match(vercel, /public-venue\?brandSlug=:brandSlug&venueSlug=:venueSlug/);
  const renderer = read("mingla-business/server/cardIdentityRenderer.js");
  assert.match(renderer, /preview === "c" \|\| process\.env\.MINGLA_CARD_IDENTITY_OG_ENABLED === "true"/);
});

test("H10 native, OneLink, AASA and App Links all recognize opaque /p", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "app-mobile/app/p/[shareId].tsx")));
  assert.match(read("app-mobile/src/services/oneLinkResolver.ts"), /case 'place':[\s\S]*case 'curated':/);
  assert.match(read("app-mobile/src/services/oneLinkShare.ts"), /ONELINK_BRAND_DOMAIN = 'go\.usemingla\.com'/);
  assert.match(read("app-mobile/app.json"), /"pathPrefix": "\/p"/);
  assert.match(read("mingla-marketing/public/.well-known/apple-app-site-association"), /"\/p\/\*"/);
});

test("H11 ShareModal exposes create states and removes fabricated facts", () => {
  const source = read("app-mobile/src/components/ShareModal.tsx");
  for (const fake of ["'4.8'", "'Amazing experience'", "share:card.nearby", "|| 'Afternoon'", "|| 'Weekend'", "|| 'This month'"]) assert.doesNotMatch(source, new RegExp(fake.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /'idle' \| 'generating' \| 'success' \| 'error'/);
  assert.match(source, /Sharing the Mingla link instead/);
});

test("H12 S4/S5/S6 verdicts are BUILT only after their files exist", () => {
  const oracle = read("packages/card-identity/__tests__/card_identity_single_source.test.mjs");
  assert.match(oracle, /const BUILT = new Set\(\[[^\]]*'s4Snippet'[^\]]*'s5Og'[^\]]*'s6Phone'/);
});

test("H13 authoritative place and curated mappers execute over real-shaped inputs", async () => {
  const { mapPlaceSnapshot, mapCuratedSnapshot } = await import(path.join(ROOT, "supabase/functions/shared-card/snapshot.ts"));
  const place = mapPlaceSnapshot({ id:"pool-1", google_place_id:"google-1", name:"Real Cafe", address:"1 Main St", primary_type_display_name:"Cafe", rating:4.7, stored_photo_urls:["https://img.test/a.jpg"], opening_hours:{ weekday_text:["Mon 9–5"] }, editorial_summary:"Real description" });
  assert.deepEqual({ title:place.title, cover:place.coverUrl, category:place.metadata.category, description:place.metadata.description }, { title:"Real Cafe", cover:"https://img.test/a.jpg", category:"Cafe", description:"Real description" });
  const curated = mapCuratedSnapshot({ id:"saved-1", experience_id:"exp-1", title:"Real Plan", category:"Night out", image_url:"https://img.test/p.jpg", card_data:{ description:"Three true stops", stops:[{ title:"First", placeId:"g1" },{ title:"Second", placeId:"g2" }] } });
  assert.equal(curated.stops.length, 2); assert.equal(curated.stops[1].title, "Second"); assert.deepEqual(curated.sourceIds.stopPlaceIds, ["g1","g2"]); assert.equal(curated.metadata.description, "Three true stops");
});

test("H14 public response strips private IDs and builds the live w36m OneLink", async () => {
  const { publicSnapshotResponse } = await import(path.join(ROOT, "supabase/functions/shared-card/snapshot.ts"));
  const output = publicSnapshotResponse({ share_id:"abc", kind:"curated", title:"Plan", metadata:{}, stops:[{ title:"First", category:"Cafe", placeId:"nested-secret" }], source_ids:{ savedCardId:"secret", placePoolId:"secret2", googlePlaceId:"secret3" }, owner_profile_id:"owner", attribution:{ referralCode:"REF 1" }, revoked_at:null });
  const text = JSON.stringify(output);
  for (const secret of ["savedCardId", "placePoolId", "googlePlaceId", "placeId", "nested-secret", "secret", "owner_profile_id", "owner"]) assert.doesNotMatch(text, new RegExp(secret));
  assert.equal(output.appUrl, "https://go.usemingla.com/w36m?pid=shared_card&deep_link_value=curated&deep_link_sub1=abc&af_sub1=REF%201");
  assert.doesNotMatch(output.appUrl, /go\.usemingla\.com\/p\//);
});

test("H15 real S6 renderer escapes facts and conditionally emits canonical/image/actions", () => {
  const { renderSharedCardHtml } = require(path.join(ROOT, "mingla-business/server/socialPreview.js"));
  const html = renderSharedCardHtml({ share_id:"abc", kind:"place", title:"Cafe <script>", cover_url:"https://img.test/a.jpg", metadata:{ category:"Cafe", location:"Durham", description:"Safe <b>truth</b>", website:"https://cafe.test" }, stops:[] }, "https://go.usemingla.com/w36m?pid=shared_card&deep_link_value=place&deep_link_sub1=abc");
  assert.match(html, /Cafe &lt;script&gt;/); assert.match(html, /Safe &lt;b&gt;truth&lt;\/b&gt;/);
  assert.match(html, /<link rel="canonical" href="https:\/\/usemingla\.com\/p\/abc"/);
  // [TEST-MOD-APPROVED #1615] Written reason: the direct renderer fixture is
  // already-normalized snapshot data and intentionally carries no trailing `/`;
  // requiring one asserted URL normalization that this renderer does not own.
  assert.match(html, /og:image/); assert.match(html, /https:\/\/cafe\.test/); assert.match(html, /w36m\?pid=shared_card/);
  const coverless = renderSharedCardHtml({ share_id:"def", kind:"place", title:"Plain", cover_url:null, metadata:{}, stops:[] }, "https://go.usemingla.com/w36m?pid=shared_card&deep_link_value=place&deep_link_sub1=def");
  assert.doesNotMatch(coverless, /property="og:image"/); assert.match(coverless, /share-cover coverless/);
  const hostileCover = renderSharedCardHtml({ share_id:"ghi", kind:"place", title:"Safe", cover_url:"https://img.test/a'\"x.png", metadata:{}, stops:[] }, "https://go.usemingla.com/w36m?deep_link_sub1=ghi");
  assert.match(hostileCover, /<img class="share-cover-image" src="https:\/\/img\.test\/a&#39;&quot;x\.png"/);
  assert.doesNotMatch(hostileCover, /background-image:url/);
});

test("H16 real S4/S5 bytes are PNG at exact dimensions", async () => {
  const { renderCardIdentityPng } = require(path.join(ROOT, "mingla-business/server/cardIdentityRenderer.js"));
  const cover = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  for (const [surface, expected] of [["s4Snippet",[1080,1350]],["s5Og",[1200,630]]]) {
    const png = await renderCardIdentityPng({ kind:"curated", title:"Real Plan", cover_url:cover, metadata:{ category:"Plan", location:"Durham" } }, surface);
    assert.equal(png.subarray(1,4).toString(), "PNG"); assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)], expected);
  }
});

test("H17 image handler seam returns 404 without cover and image/png with real bytes", async () => {
  const { createSharedCardImageHandler } = require(path.join(ROOT, "mingla-business/api/shared-card-image.js"));
  const response = () => ({ statusCode:200, headers:{}, setHeader(k,v){this.headers[k]=v;}, end(body){this.body=body;} });
  const noCover = response(); await createSharedCardImageHandler(async()=>({ snapshot:{ cover_url:null } }))({ query:{ shareId:"abc", surface:"s4" } }, noCover); assert.equal(noCover.statusCode,404);
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const ok = response(); await createSharedCardImageHandler(async()=>({ snapshot:{ cover_url:"https://img.test/a.jpg" } }), async()=>png)({ query:{ shareId:"abc", surface:"s5" } }, ok);
  assert.equal(ok.statusCode,200); assert.equal(ok.headers["content-type"],"image/png"); assert.equal(ok.body,png);
});

test("H18 real OneLink producer/resolver carry place and curated shareId", async () => {
  const share = await import(path.join(ROOT, "app-mobile/src/services/oneLinkShare.ts"));
  const resolver = await import(path.join(ROOT, "app-mobile/src/services/oneLinkResolver.ts"));
  // [TEST-MOD-APPROVED #1615] Written reason: the old fixture used `share-2`,
  // which is not the endpoint's exact lowercase 36-hex opaque-ID contract and
  // incorrectly required the resolver to accept an impossible production ID.
  const placeId = "a".repeat(36);
  const curatedId = "b".repeat(36);
  assert.deepEqual(share.buildInviteUserParams({ channel:"copy", entity:{ type:"place", shareId:placeId }, referralCode:"REF" }), { deep_link_value:"place", deep_link_sub1:placeId, af_sub1:"REF" });
  assert.equal(share.buildFallbackShareUrl({ channel:"copy", entity:{ type:"curated", shareId:curatedId } }), `https://usemingla.com/p/${curatedId}`);
  assert.deepEqual(resolver.resolveOneLinkDestination({ deep_link_value:"curated", deep_link_sub1:curatedId, af_sub1:"REF" }), { kind:"share", shareType:"curated", shareId:curatedId, referralCode:"REF" });
});

test("H19 Explorer payload is canonical S5/S6 URL while CTA remains attributed w36m OneLink", async () => {
  const links = await import(path.join(ROOT, "app-mobile/src/services/sharedCardLinks.ts"));
  const created = {
    snapshot: { share_id: "share-3" },
    canonicalUrl: "https://usemingla.com/p/share-3",
    appUrl: "https://go.usemingla.com/w36m?pid=shared_card&deep_link_value=place&deep_link_sub1=share-3&af_sub1=REF%203",
    s4Url: null,
    s5Url: null,
  };
  const externalUrl = links.externalSharedCardUrl(created);
  assert.equal(externalUrl, created.canonicalUrl);
  assert.doesNotMatch(externalUrl, /^https:\/\/go\.usemingla\.com/);
  assert.match(created.appUrl, /^https:\/\/go\.usemingla\.com\/w36m\?/);
  assert.match(created.appUrl, /deep_link_sub1=share-3/);
  assert.match(created.appUrl, /af_sub1=REF%203/);
  assert.equal(links.referralCodeFromSharedCardAppUrl(created.appUrl), "REF 3");
  const modal = read("app-mobile/src/components/ShareModal.tsx");
  assert.match(modal, /if \(created\) return externalSharedCardUrl\(created\)/);
  assert.doesNotMatch(modal, /created\s*\?\s*\{\s*type:.*shareId/s);
  const reader = read("app-mobile/src/services/sharedCardService.ts");
  assert.match(reader, /return \{ snapshot: body\.snapshot, appUrl: body\.appUrl \}/);
  const route = read("app-mobile/app/p/[shareId].tsx");
  assert.match(route, /AsyncStorage\.setItem\('@mingla_referral_code', referralCode\)/);
});

test("H20 existing business human pages and bot S5 share Direction C identity", () => {
  const shell = read("packages/offering-rendering/ParallaxCoverShell.tsx");
  for (const needle of ["SURFACES.s6Phone", "surfacePlateBoundary(\"s6Phone\")", "PLATE.fallbackSolid", "DirectionCIdentityOverlay"]) assert.ok(shell.includes(needle), needle);
  assert.match(read("packages/offering-rendering/PublicEventPage.tsx"), /<DirectionCIdentityOverlay/);
  assert.match(read("mingla-business/src/components/event/FoundationEventPreview.tsx"), /directionCIdentity=\{\{/);
  assert.match(read("packages/brand-rendering/PublicBrandPage.tsx"), /directionCIdentity=\{useDirectionCIdentity/);
  assert.match(read("packages/brand-rendering/PublicVenueScreen.tsx"), /directionCIdentity=\{useDirectionCIdentity/);
  assert.match(read("mingla-business/src/components/trip/TripPreview.tsx"), /directionCIdentity=\{useDirectionCIdentity/);
  for (const file of ["mingla-business/api/og-event.js", "mingla-business/api/og-trip.js", "mingla-business/api/og-brand.js", "mingla-business/api/og-venue.js"]) {
    assert.match(read(file), /renderCardIdentityPng/);
  }
  assert.match(read("mingla-business/server/socialPreview.js"), /\/og\/venue\/\$\{encodeURIComponent\(canonicalBrandSlug\)\}/);
});

test("H21 limiter retains one atomic current bucket and has indexed stale cleanup", () => {
  const sql = read("supabase/migrations/20270225001615_issue_1615_public_share_snapshots.sql");
  assert.match(sql, /primary key \(actor_hash, action\)/i);
  assert.match(sql, /create index if not exists shared_card_rate_limits_window_start_idx[\s\S]*on public\.shared_card_rate_limits \(window_start\)/i);
  assert.match(sql, /delete from public\.shared_card_rate_limits[\s\S]*window_start < now\(\) - interval '2 days'/i);
  assert.match(sql, /on conflict \(actor_hash, action\) do update[\s\S]*window_start = excluded\.window_start[\s\S]*else 1/i);
  assert.doesNotMatch(sql, /primary key \(actor_hash, action, window_start\)/i);
});

test("H22 curated snapshot and public response omit untitled stops", async () => {
  const { mapCuratedSnapshot, publicSnapshotResponse } = await import(path.join(ROOT, "supabase/functions/shared-card/snapshot.ts"));
  const mapped = mapCuratedSnapshot({ id:"saved", title:"Plan", card_data:{ stops:[{ title:"  ", placeId:"missing-title" }, { title:"Museum", placeId:"real" }] } });
  assert.deepEqual(mapped.stops.map((stop) => stop.title), ["Museum"]);
  assert.deepEqual(mapped.sourceIds.stopPlaceIds, ["missing-title", "real"]);
  const output = publicSnapshotResponse({ share_id:"a".repeat(36), kind:"curated", title:"Plan", metadata:{}, stops:[{ title:"" }, { title:"Museum", category:"Art" }], source_ids:{}, owner_profile_id:"owner", attribution:{}, revoked_at:null });
  assert.deepEqual(output.snapshot.stops, [{ title:"Museum", category:"Art" }]);
});

test("H23 S4, S5 and S6 responses are private no-store on success and failure", async () => {
  const pageHandler = require(path.join(ROOT, "mingla-business/api/shared-card.js"));
  const { createSharedCardImageHandler } = require(path.join(ROOT, "mingla-business/api/shared-card-image.js"));
  const response = () => ({ statusCode:200, headers:{}, setHeader(k,v){this.headers[k.toLowerCase()]=v;}, end(body){this.body=body;} });
  const page = response(); await pageHandler({ query:{ shareId:"invalid" } }, page);
  assert.equal(page.statusCode, 404);
  for (const key of ["cache-control", "cdn-cache-control", "vercel-cdn-cache-control"]) assert.match(page.headers[key], /no-store/);
  const image = response(); await createSharedCardImageHandler(async()=>({ status:410, snapshot:null }))({ query:{ shareId:"a".repeat(36), surface:"s5" } }, image);
  assert.equal(image.statusCode, 410);
  for (const key of ["cache-control", "cdn-cache-control", "vercel-cdn-cache-control"]) assert.match(image.headers[key], /no-store/);
});

test("H24 native and OneLink resolution enforce exact lowercase opaque share IDs", async () => {
  const resolver = await import(path.join(ROOT, "app-mobile/src/services/oneLinkResolver.ts"));
  const valid = "c".repeat(36);
  assert.equal(resolver.isOpaqueShareId(valid), true);
  for (const invalid of ["c".repeat(35), "C".repeat(36), `${valid}-x`, "share-2", ""]) {
    assert.equal(resolver.isOpaqueShareId(invalid), false);
    assert.equal(resolver.resolveOneLinkDestination({ deep_link_value:"place", deep_link_sub1:invalid }), null);
  }
  assert.equal(resolver.resolveOneLinkDestination({ deep_link_value:"", deep_link_sub1:valid }), null);
  assert.deepEqual(resolver.resolveOneLinkDestination({ deep_link_value:"internal", deep_link_sub1:"mingla://saved" }), { kind:"internal", url:"mingla://saved" });
  assert.match(read("app-mobile/app/p/[shareId].tsx"), /if \(!isOpaqueShareId\(shareId\)\)/);
});

test("H25 one ordered selector owns facts across server renderers and native", () => {
  const ci = require(path.join(ROOT, "packages/card-identity"));
  const metadata = { duration:"2 hours", price:"$20", ignored:"wrong", location:"Durham", category:"Cafe" };
  assert.deepEqual(ci.selectSharedCardFacts(metadata), ["Cafe", "Durham"]);
  assert.deepEqual(ci.selectSharedCardFacts(metadata, 4), ["Cafe", "Durham", "$20", "2 hours"]);
  for (const file of ["mingla-business/server/cardIdentityRenderer.js", "mingla-business/server/socialPreview.js", "app-mobile/app/p/[shareId].tsx"]) {
    assert.match(read(file), /selectSharedCardFacts\((?:metadata|m)\)/, file);
    assert.doesNotMatch(read(file), /Object\.values\(metadata\)/, file);
  }
});
