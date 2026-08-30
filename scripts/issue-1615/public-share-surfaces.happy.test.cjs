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
  // [TEST-MOD-APPROVED #1615] The binding portrait amendment replaces the
  // superseded landscape S5 and makes S4/S5 consume one 4:5 descriptor.
  assert.deepEqual([ci.SURFACES.s4Snippet.w * 3, ci.SURFACES.s4Snippet.h * 3], [1080, 1350]);
  assert.deepEqual([ci.SURFACES.s5Og.w * 3, ci.SURFACES.s5Og.h * 3], [1080, 1350]);
  assert.deepEqual(ci.SURFACES.s4Snippet.sliver.insets, [12, 22]);
  assert.deepEqual(ci.SURFACES.s5Og.sliver.insets, [12, 22]);
  assert.equal(ci.SURFACES.s4Snippet.plateBoundary, "portrait");
});

test("H7 S6 uses web glass with the package fallback and truthful coverless metadata", () => {
  const renderer = read("mingla-business/server/cardIdentityRenderer.js");
  const preview = read("mingla-business/server/socialPreview.js");
  assert.match(renderer, /backdrop-filter:blur/);
  assert.match(renderer, /@supports not/);
  assert.match(preview, /imageUrl \? `<meta property="og:image"/);
  // [TEST-MOD-APPROVED #1615] Physical Samsung reason: the former coverless
  // card was placeholder artwork. The amended contract requires a truthful
  // information state with no visual-card or image metadata.
  assert.match(preview, /class="coverless-information"/);
  assert.doesNotMatch(preview, /class="share-cover coverless"/);
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
  // [TEST-MOD-APPROVED #2245] Was /"pathPrefix": "\/p"/. The prior assertion was
  // wrong: an Android `pathPrefix` is a raw STRING prefix, not a path-segment
  // match, so `"/p"` claimed `usemingla.com/privacy-policy` as well as the share
  // family — a page linked from both store listings and the site footer. On any
  // Android phone with Explorer installed, tapping it opened the app (which has
  // no `privacy-policy` route) instead of showing the policy.
  //
  // Nothing is lost by the slash, and this test's own next line is the proof:
  // it pins the AASA as "/p/*", the SLASHED family. Every other layer agrees —
  // `app-mobile/app/p/` holds only `[shareId].tsx` (no bare-/p route), the apex
  // web serves only `^/p/[a-f0-9]{36}$` (mingla-marketing/middleware.ts
  // PUBLIC_SHARE_PATH), and the sole emitter always writes `/p/${shareId}`
  // (oneLinkShare.ts buildFallbackShareUrl). The Android prefix was the one
  // layer wider than all of them. H10's subject — "opaque /p" — is the opaque
  // 36-hex SHARE ID, and it is untouched: this still asserts Android claims the
  // /p share family, now spelled the same way as the AASA it sits beside.
  assert.match(read("app-mobile/app.json"), /"pathPrefix": "\/p\/"/);
  assert.match(read("mingla-marketing/public/.well-known/apple-app-site-association"), /"\/p\/\*"/);
});

test("H11 ShareModal exposes create states and removes fabricated facts", () => {
  // [TEST-MOD-APPROVED #1719] The old state machine belonged to the removed
  // provider-grid/S4 modal. The app-wide provider owns synchronous open,
  // preparation, visible retry, and the truthful compact summary now.
  const source = read("app-mobile/src/components/share/UnifiedShareProvider.tsx");
  for (const fake of ["'4.8'", "'Amazing experience'", "share:card.nearby", "|| 'Afternoon'", "|| 'Weekend'", "|| 'This month'"]) assert.doesNotMatch(source, new RegExp(fake.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  // [TEST-MOD-APPROVED #1615] RETURN replaced the under-specified four-state
  // source pin with the binding lifecycle and forbids the old silent fallback.
  assert.match(source, /setVisible\(true\)[\s\S]*loadShare\(nextInput, token\)/);
  // [TEST-MOD-APPROVED #2589] `setPrepError(true)` was a boolean: it could record
  // THAT preparation failed but never WHY, so an unpublished offering (404), a
  // signed-out session (401) and a real outage (503) all rendered one string
  // beside a Retry that could not help two of them. The successor pins more, not
  // less — the reason is captured, a per-cause string exists for each of the four
  // reasons, and Retry is offered ONLY for the two a second attempt can change.
  assert.match(source, /setPrepFailure\(reason\)/);
  assert.match(source, /SHARE_FAILURE_COPY: Record<ContentShareFailureReason, string>/);
  for (const reason of ["not_public", "unauthorized", "unavailable", "unknown"]) {
    assert.match(source, new RegExp(`SHARE_FAILURE_COPY[\\s\\S]*\\b${reason}:`));
  }
  assert.match(source, /RETRYABLE_SHARE_FAILURES = new Set<ContentShareFailureReason>\(\['unavailable', 'unknown'\]\)/);
  assert.match(source, /RETRYABLE_SHARE_FAILURES\.has\(prepFailure\)[\s\S]*Retry share/);
  // [TEST-MOD-APPROVED #1719] Written reason: the redesigned 92px summary uses
  // the shared compact selector by design; the old selector name incorrectly
  // pinned the superseded large preview even though the truth/fact limit stays.
  assert.match(source, /selectCompactPreviewFacts\(prepared\.facts, 2\)/);
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
  // [TEST-MOD-APPROVED #1615] Physical Samsung reason: coverless legacy S6
  // must be honest information, not a generated dark card that implies art.
  assert.doesNotMatch(coverless, /property="og:image"|twitter:image|class="share-cover/); assert.match(coverless, /coverless-information/);
  const hostileCover = renderSharedCardHtml({ share_id:"ghi", kind:"place", title:"Safe", cover_url:"https://img.test/a'\"x.png", metadata:{}, stops:[] }, "https://go.usemingla.com/w36m?deep_link_sub1=ghi");
  assert.match(hostileCover, /<img class="share-cover-image" src="https:\/\/img\.test\/a&#39;&quot;x\.png"/);
  assert.doesNotMatch(hostileCover, /background-image:url/);
});

test("H16 real S4/S5 bytes are PNG at exact dimensions", async () => {
  const { renderCardIdentityPng } = require(path.join(ROOT, "mingla-business/server/cardIdentityRenderer.js"));
  const cover = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  // [TEST-MOD-APPROVED #1615] S5 now deliberately serves the same canonical
  // 1080x1350 portrait bytes/geometry as S4 under the approved amendment.
  for (const [surface, expected] of [["s4Snippet",[1080,1350]],["s5Og",[1080,1350]]]) {
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
  // [TEST-MOD-APPROVED #1615] Written reason: referral codes follow the
  // bounded `[A-Za-z0-9-]` contract; the old space-bearing `REF 3` fixture
  // required arbitrary query text to survive into AsyncStorage.
  const links = await import(path.join(ROOT, "app-mobile/src/services/sharedCardLinks.ts"));
  const created = {
    snapshot: { share_id: "share-3" },
    canonicalUrl: "https://usemingla.com/p/share-3",
    appUrl: "https://go.usemingla.com/w36m?pid=shared_card&deep_link_value=place&deep_link_sub1=share-3&af_sub1=REF-3",
    s4Url: null,
    s5Url: null,
  };
  const externalUrl = links.externalSharedCardUrl(created);
  assert.equal(externalUrl, created.canonicalUrl);
  assert.doesNotMatch(externalUrl, /^https:\/\/go\.usemingla\.com/);
  assert.match(created.appUrl, /^https:\/\/go\.usemingla\.com\/w36m\?/);
  assert.match(created.appUrl, /deep_link_sub1=share-3/);
  assert.match(created.appUrl, /af_sub1=REF-3/);
  assert.equal(links.referralCodeFromSharedCardAppUrl(created.appUrl), "REF-3");
  const modal = read("app-mobile/src/components/ShareModal.tsx");
  // [TEST-MOD-APPROVED #1615] Stage 6 replaces the legacy /p producer with the
  // typed /s adapter; the old externalSharedCardUrl assertion is now obsolete.
  // The binding also requires the sanitized planning preference to reach the
  // adapter, so the old two-argument source pin was incomplete.
  // [TEST-MOD-APPROVED #1719] The compatibility bridge now synchronously hands
  // identity/context to the one provider; preparation occurs after it opens.
  assert.match(modal, /openContentShare\(\{ kind, identity, messageContext: \{ planningPreference: dateTimePreferences \} \}\)/);
  assert.match(read("app-mobile/src/services/contentShareAdapter.ts"), /canonicalUrl=buildShortShareUrl|canonicalUrl\s*=\s*buildShortShareUrl/);
  assert.doesNotMatch(modal, /externalSharedCardUrl/);
  assert.doesNotMatch(modal, /created\s*\?\s*\{\s*type:.*shareId/s);
  const reader = read("app-mobile/src/services/sharedCardService.ts");
  assert.match(reader, /return \{ snapshot: body\.snapshot, appUrl: body\.appUrl \}/);
  const route = read("app-mobile/app/p/[shareId].tsx");
  assert.match(route, /AsyncStorage\.setItem\('@mingla_referral_code', referralCode\)/);
});

test("H20 share identity stays isolated from ordinary Business destination pages", () => {
  // [TEST-MOD-APPROVED #1960] The old assertions required share artwork on the
  // destination cover itself, causing duplicate titles and a gray identity plate.
  // Share renderers remain protected below; ordinary human routes must not opt in.
  const shell = read("packages/offering-rendering/ParallaxCoverShell.tsx");
  for (const needle of ["S6_PHONE", "S6_PLATE_BOUNDARY", "S6_PLATE.fallbackSolid", "DirectionCIdentityOverlay"]) assert.ok(shell.includes(needle), needle);
  const s6Runtime = read("packages/card-identity/s6.js");
  for (const needle of ["rgba(255,255,255,0.38)", "rgb(53,56,63)", "S6_PHONE"]) assert.ok(s6Runtime.includes(needle), needle);
  assert.match(read("packages/offering-rendering/PublicEventPage.tsx"), /<DirectionCIdentityOverlay/);
  for (const file of [
    "mingla-business/src/components/event/FoundationEventPreview.tsx",
    "mingla-business/src/components/event/PublicEventPage.tsx",
    "mingla-business/app/t/[brandSlug]/[tripSlug].tsx",
    "mingla-business/app/b/[brandSlug]/index.tsx",
    "mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx",
  ]) assert.doesNotMatch(read(file), /(?:useDirectionCIdentity\b|directionCIdentity=)/, file);
  for (const file of ["mingla-business/api/og-event.js", "mingla-business/api/og-trip.js", "mingla-business/api/og-brand.js", "mingla-business/api/og-venue.js"]) {
    assert.match(read(file), /renderCardIdentityPng/);
  }
  const explorer = read("app-mobile/app/s/[code].tsx");
  for (const needle of ["readContentShare", "buildSharePortraitUrl", "destinationPath"]) assert.ok(explorer.includes(needle), needle);
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

test("H26 usemingla owns stable content and legacy local proxy routes with no external rewrite", () => {
  const config = JSON.parse(read("mingla-marketing/vercel.json"));
  // [TEST-MOD-APPROVED #1615] The receiver-first amendment expands this exact manifest with /s;
  // retaining the former four-entry assertion would reject the required additive content routes.
  assert.deepEqual(config.rewrites.map((entry) => entry.source), [
    "/s/:code",
    // [TEST-MOD-APPROVED #1615] Physical WhatsApp did not render the former
    // oversized no-store PNG; the manifest now owns revision 2 JPEG delivery.
    "/og/s/:code/v:version-r2.jpg",
    "/api/content-share/:code",
    "/p/:shareId",
    "/share/:shareId.png",
    "/og/share/:shareId.png",
    "/api/shared-card/:shareId",
  ]);
  for (const route of config.rewrites) {
    assert.match(route.destination, /^\/api\/internal-share-proxy\//);
    assert.doesNotMatch(route.destination, /^https?:\/\//);
    assert.deepEqual(route.has, [{ type: "host", value: "route-manifest.invalid" }]);
  }
  for (const surface of ["page", "snippet", "og", "data"]) {
    assert.ok(fs.existsSync(path.join(ROOT, `mingla-marketing/app/api/internal-share-proxy/${surface}/[shareId]/route.ts`)));
  }
});

test("H26b middleware atomically rewrites public routes and strips spoofed internal markers", () => {
  const source = read("mingla-marketing/middleware.ts");
  assert.match(source, /requestHeaders\.delete\(INTERNAL_PROXY_HEADER\)/);
  assert.match(source, /requestHeaders\.set\(INTERNAL_PROXY_HEADER, process\.env\.SHARED_CARD_PROXY_SECRET \|\| ''\)[\s\S]*NextResponse\.rewrite\(url, \{ request: \{ headers: requestHeaders \} \}\)/);
  assert.match(source, /\/api\/internal-share-proxy\/data\/\$\{match\[1\]\}/);
  assert.match(source, /api\/internal-share-proxy\/\|/);
});

test("H27 marketing proxy forwards only its secret and preserves allowlisted responses", async () => {
  const { proxySharedCard } = await import(path.join(ROOT, "mingla-marketing/lib/shared-card-proxy.ts"));
  const previous = process.env.SHARED_CARD_PROXY_SECRET;
  process.env.SHARED_CARD_PROXY_SECRET = "proxy-secret";
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response("{\"snapshot\":{},\"appUrl\":\"https://go.usemingla.com/w36m\"}", {
      status: 200,
      headers: { "content-type": "application/json", "x-hostile-upstream": "must-not-pass" },
    });
  };
  const shareId = "a".repeat(36);
  const request = new Request(`https://usemingla.com/api/shared-card/${shareId}`, {
    headers: { "x-mingla-internal-share-route": "proxy-secret", authorization: "must-not-pass" },
  });
  const response = await proxySharedCard(request, shareId, "data", fetchImpl);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^application\/json/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("x-hostile-upstream"), null);
  assert.equal(calls[0].url, `https://host.usemingla.com/api/shared-card-data?shareId=${shareId}`);
  assert.deepEqual(calls[0].init.headers, { "x-mingla-shared-card-proxy": "proxy-secret" });
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.cache, "no-store");
  if (previous === undefined) delete process.env.SHARED_CARD_PROXY_SECRET; else process.env.SHARED_CARD_PROXY_SECRET = previous;
});

test("H28 marketing proxy fails closed before fetch and rejects bad upstream types/statuses", async () => {
  const { proxySharedCard } = await import(path.join(ROOT, "mingla-marketing/lib/shared-card-proxy.ts"));
  const shareId = "b".repeat(36);
  let fetches = 0;
  const never = async () => { fetches += 1; throw new Error("must not fetch"); };
  const previous = process.env.SHARED_CARD_PROXY_SECRET;
  delete process.env.SHARED_CARD_PROXY_SECRET;
  const marked = new Request("https://usemingla.com/p/x", { headers: { "x-mingla-internal-share-route": "proxy-secret" } });
  assert.equal((await proxySharedCard(marked, shareId, "page", never)).status, 503);
  process.env.SHARED_CARD_PROXY_SECRET = "proxy-secret";
  assert.equal((await proxySharedCard(new Request("https://usemingla.com/p/x"), shareId, "page", never)).status, 404);
  assert.equal(fetches, 0);
  const wrongType = await proxySharedCard(marked, shareId, "page", async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(wrongType.status, 502);
  const redirect = await proxySharedCard(marked, shareId, "page", async () => new Response(null, { status: 302 }));
  assert.equal(redirect.status, 502);
  const gone = await proxySharedCard(marked, shareId, "page", async () => new Response("ignored", { status: 410, headers: { "content-type": "text/html" } }));
  assert.equal(gone.status, 410);
  assert.match(gone.headers.get("cache-control"), /no-store/);
  if (previous === undefined) delete process.env.SHARED_CARD_PROXY_SECRET; else process.env.SHARED_CARD_PROXY_SECRET = previous;
});

test("H29 business entry handlers reject bypasses before downstream and accept the exact secret", async () => {
  const previous = process.env.SHARED_CARD_PROXY_SECRET;
  process.env.SHARED_CARD_PROXY_SECRET = "business-secret";
  const { createSharedCardHandler } = require(path.join(ROOT, "mingla-business/api/shared-card.js"));
  const { createSharedCardDataHandler } = require(path.join(ROOT, "mingla-business/api/shared-card-data.js"));
  const response = () => ({ statusCode: 200, headers: {}, setHeader(k,v){this.headers[k.toLowerCase()]=v;}, end(body){this.body=body;} });
  let reads = 0;
  const fetchSnapshot = async () => { reads += 1; return { status: 404, snapshot: null }; };
  for (const headers of [{}, { "x-mingla-shared-card-proxy": "wrong" }]) {
    const res = response();
    await createSharedCardHandler(fetchSnapshot)({ headers, query: { shareId: "a".repeat(36) } }, res);
    assert.equal(res.statusCode, 404);
  }
  assert.equal(reads, 0);
  const res = response();
  await createSharedCardDataHandler(fetchSnapshot)({ headers: { "x-mingla-shared-card-proxy": "business-secret" }, query: { shareId: "a".repeat(36) } }, res);
  assert.equal(reads, 1);
  assert.equal(res.statusCode, 404);
  assert.match(res.headers["cache-control"], /no-store/);
  const unavailable = response();
  await createSharedCardDataHandler(async () => ({ status: 503, snapshot: null }))({ headers: { "x-mingla-shared-card-proxy": "business-secret" }, query: { shareId: "a".repeat(36) } }, unavailable);
  assert.equal(unavailable.statusCode, 503);
  if (previous === undefined) delete process.env.SHARED_CARD_PROXY_SECRET; else process.env.SHARED_CARD_PROXY_SECRET = previous;
});

test("H30 business forwards the proxy secret to Edge without following redirects", async () => {
  const previousSecret = process.env.SHARED_CARD_PROXY_SECRET;
  const previousFetch = global.fetch;
  process.env.SHARED_CARD_PROXY_SECRET = "edge-secret";
  let captured;
  global.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({ snapshot: { title: "Real" }, appUrl: "https://go.usemingla.com/w36m" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const { fetchSharedCardSnapshot } = require(path.join(ROOT, "mingla-business/server/socialPreview.js"));
  const result = await fetchSharedCardSnapshot("c".repeat(36));
  assert.equal(result.status, 200);
  assert.equal(captured.init.headers["x-mingla-shared-card-proxy"], "edge-secret");
  assert.equal(captured.init.redirect, "manual");
  global.fetch = previousFetch;
  if (previousSecret === undefined) delete process.env.SHARED_CARD_PROXY_SECRET; else process.env.SHARED_CARD_PROXY_SECRET = previousSecret;
});

// [TEST-MOD-APPROVED #1615] Stage 6 intentionally adds the reviewed anonymous-public
// POST lane; H31 now pins its constant-time proxy proof while retaining bearer fallback.
test("H31 Edge authenticates GET and permits only proved server-created or bearer POST", () => {
  const source = read("supabase/functions/shared-card/index.ts");
  const getBlock = source.split('if (req.method !== "POST")')[0].split('if (req.method === "GET")')[1];
  const auth = getBlock.indexOf("constantTimeEqualSecret");
  assert.ok(auth >= 0);
  assert.ok(auth < getBlock.indexOf("createClient("));
  assert.ok(auth < getBlock.indexOf('rpc("consume_shared_card_rate_limit"'));
  assert.ok(auth < getBlock.indexOf('from("shared_card_snapshots")'));
  const postBlock = source.split('if (req.method !== "POST")')[1];
  assert.match(postBlock, /constantTimeEqualSecret\(providedProxySecret, expectedProxySecret\)/);
  assert.match(postBlock, /\^\[a-f0-9\]\{64\}\$\/\.test\(publicActor\)/);
  assert.match(postBlock, /db\.auth\.getUser\(jwt\)/);
  assert.match(postBlock, /if \(!serverCreated && !user\) return json\(\{ error: "unauthorized" \}, 401\)/);
});

test("H32 native anonymous read enters through usemingla.com and never direct Supabase", () => {
  const source = read("app-mobile/src/services/sharedCardService.ts");
  const readBlock = source.split("export async function readSharedCard")[1];
  assert.match(readBlock, /https:\/\/usemingla\.com\/api\/shared-card\//);
  assert.doesNotMatch(readBlock, /supabaseUrl|functions\/v1\/shared-card|getSupabaseFunctionHeaders/);
  assert.match(source.split("export async function createSharedCard")[1].split("export async function readSharedCard")[0], /supabase\.functions\.invoke/);
});

test("H33 proxy credential is standalone governed authority and excluded from runtime bundle", () => {
  const manifest = JSON.parse(read("supabase/secrets.manifest.json"));
  const record = manifest.secrets.find((entry) => entry.name === "SHARED_CARD_PROXY_SECRET");
  // [TEST-MOD-APPROVED #1770] The invitation-token pepper is a reviewed
  // standalone secret, so the exact cross-issue rollout baseline is now 88.
  assert.equal(manifest.rollout.expected_user_managed_count, 88);
  assert.equal(record.class, "authentication_secret");
  assert.deepEqual(record.readers, ["supabase/functions/shared-card/index.ts"]);
  assert.equal(record.issue, 1615);
  const runtime = manifest.secrets.find((entry) => entry.name === "MINGLA_RUNTIME_CONFIG_JSON");
  assert.equal(runtime.bundle_fields.some((entry) => /secret/i.test(entry.name)), false);
});

test("H34 production WebP collages yield to the authoritative renderable gallery photo", async () => {
  const { mapPlaceSnapshot } = await import(path.join(ROOT, "supabase/functions/shared-card/snapshot.ts"));
  const { prepareCoverForOg } = require(path.join(ROOT, "mingla-business/server/cardIdentityRenderer.js"));
  assert.match(read("mingla-business/server/cardIdentityRenderer.js"), /cardIdentityElement\(\{ \.\.\.snapshot, cover_url: await prepareCoverForOg\(snapshot\.cover_url\) \}, surfaceKey, scale\)/);
  const mapped = mapPlaceSnapshot({
    id: "pool-webp",
    google_place_id: "google-webp",
    name: "Real Garden",
    photo_collage_url: "https://cdn.test/real-collage.webp",
    stored_photo_urls: ["https://cdn.test/real-photo.jpg"],
  });
  assert.equal(mapped.coverUrl, "https://cdn.test/real-photo.jpg");
  const sharp = require(path.join(ROOT, "mingla-business/node_modules/sharp"));
  const webp = await sharp({ create: { width: 2, height: 2, channels: 4, background: "#eb7825" } }).webp().toBuffer();
  const converted = await prepareCoverForOg(
    "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/place-collages/real.webp",
    async () => new Response(webp, { status: 200, headers: { "content-type": "image/webp", "content-length": String(webp.length) } }),
  );
  assert.match(converted, /^data:image\/png;base64,/);
  assert.equal(Buffer.from(converted.split(",")[1], "base64").subarray(1, 4).toString(), "PNG");
});

test("H35 S4 scales the actual photo across the 1080px output, not only its layout box", async () => {
  const { renderCardIdentityPng } = require(path.join(ROOT, "mingla-business/server/cardIdentityRenderer.js"));
  const sharp = require(path.join(ROOT, "mingla-business/node_modules/sharp"));
  const orange = await sharp({ create: { width: 4, height: 4, channels: 4, background: "#eb7825" } }).png().toBuffer();
  const png = await renderCardIdentityPng({
    kind: "place",
    title: "Full width",
    cover_url: `data:image/png;base64,${orange.toString("base64")}`,
    metadata: {},
  }, "s4Snippet");
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const farRightTop = (100 * info.width + 900) * info.channels;
  assert.ok(data[farRightTop] > 180 && data[farRightTop + 1] > 70, `far-right photo pixel was ${Array.from(data.subarray(farRightTop, farRightTop + 3))}`);
});
