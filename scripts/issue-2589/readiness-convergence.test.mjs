/**
 * #2589 — the readiness check converges, and stops retrying a settled verdict.
 *
 * THE DEFECT. Readiness asserted that the served share page advertised EXACTLY
 * the version the client was holding — against a page whose own fetch re-derives
 * the offering and can mint the next version on its way past. Asked "is v1
 * ready?" it fetched the page, the fetch minted v2, it compared v1 to v2, failed,
 * slept 200 ms, ran the byte-identical comparison, failed identically, and
 * returned a transient error that disables the Share button. Deterministic,
 * non-converging, and it never times out — so no timeout ever surfaced it.
 * Reproduced live on 2026-08-25 in a single call with a before/after row
 * snapshot.
 *
 * WHAT IS ASSERTED HERE. The decision itself, and the client's handling of it.
 * The HTML fixtures are not invented: R0 pins them against the producer's own
 * template in `mingla-business/server/socialPreview.js`, so a fixture that drifts
 * from what the page really emits fails before anything else runs.
 *
 * FAILS-ON-REVERT. Restoring exact-version equality fails R1 and R2. Restoring
 * the unconditional second attempt fails R5.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { advertisedPortraitVersion, readinessVerdict } from "../../mingla-marketing/lib/content-share-readiness-verdict.ts";
import sharing from "../../packages/sharing/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

const CODE = "Aa0Bb1Cc2Dd3Ee4F";

/** The exact meta block a share page emits for one version. */
const ogBlock = (code, version) => [
  `<meta property="og:image" content="https://usemingla.com/og/s/${code}/v${version}-r2.jpg" />`,
  `<meta property="og:image:secure_url" content="https://usemingla.com/og/s/${code}/v${version}-r2.jpg" />`,
  '<meta property="og:image:type" content="image/jpeg" />',
  '<meta property="og:image:width" content="1080" />',
  '<meta property="og:image:height" content="1350" />',
].join("\n  ");

const pageHtml = (code, version) => [
  "<!doctype html><html><head>",
  `  <link rel="canonical" href="https://usemingla.com/s/${code}" />`,
  `  ${ogBlock(code, version)}`,
  "</head><body></body></html>",
].join("\n");

const ok = (code, version, requested) => readinessVerdict({
  code, requested, pageStatus: 200, imageStatus: 200, html: pageHtml(code, version),
});

test("R0 the fixtures match what the page producer actually emits", () => {
  // The producer builds og:image and og:image:secure_url from one `imageUrl`
  // with this exact tag shape. If that template changes, these fixtures are
  // fiction and every verdict below is asserted against nothing.
  const producer = read("mingla-business/server/socialPreview.js");
  assert.match(producer, /<meta property="og:image" content="\$\{escapeHtml\(imageUrl\)\}" \/>/);
  assert.match(producer, /<meta property="og:image:secure_url" content="\$\{escapeHtml\(imageUrl\)\}" \/>/);
  assert.match(producer, /<link rel="canonical" href="\$\{escapeHtml\(canonicalUrl\)\}" \/>/);
  // And the URL the client asks about is built by exactly one function.
  assert.equal(sharing.buildSharePortraitUrl(CODE, 7), `https://usemingla.com/og/s/${CODE}/v7-r2.jpg`);
  assert.equal(advertisedPortraitVersion(pageHtml(CODE, 7), CODE), 7);
});

test("R1 CONVERGENCE — a link whose page has already moved ahead is READY, and names the version", () => {
  // THE CASE THAT COULD NOT PASS BEFORE. The client holds v1 from create; the
  // readiness call's own page fetch minted v2; the page now advertises v2.
  const moved = ok(CODE, 2, 1);
  assert.equal(moved.state, "ready");
  assert.equal(moved.status, 200);
  assert.equal(moved.version, 2, "the caller cannot adopt a version the server did not name");
  assert.equal(moved.retryable, false);

  // Far ahead is still ready — the live link that motivated this issue was 88
  // versions past where a client that had been open for a while was holding.
  const farAhead = ok(CODE, 88, 40);
  assert.equal(farAhead.state, "ready");
  assert.equal(farAhead.version, 88);

  // And the ordinary case, unchanged.
  const level = ok(CODE, 5, 5);
  assert.equal(level.state, "ready");
  assert.equal(level.version, 5);
});

test("R2 a page BEHIND the caller is still transient, and is NOT retried", () => {
  const behind = ok(CODE, 4, 5);
  assert.equal(behind.state, "transient");
  assert.equal(behind.status, 502);
  assert.equal(behind.version, null);
  // Settled: re-reading the page is what moves it, so a second identical attempt
  // cannot improve this and can make it worse.
  assert.equal(behind.retryable, false);
});

test("R3 a page that is not this share's page is never ready", () => {
  const other = "Zz9Yy8Xx7Ww6Vv5U";
  // og:image for a DIFFERENT share code.
  assert.equal(readinessVerdict({
    code: CODE, requested: 1, pageStatus: 200, imageStatus: 200, html: pageHtml(other, 9),
  }).state, "transient");

  // canonical for a different code.
  assert.equal(readinessVerdict({
    code: CODE, requested: 1, pageStatus: 200, imageStatus: 200,
    html: pageHtml(CODE, 3).replace(`/s/${CODE}`, `/s/${other}`),
  }).state, "transient");

  // No og:image at all — a share with no cover renders no card.
  assert.equal(readinessVerdict({
    code: CODE, requested: 1, pageStatus: 200, imageStatus: 200,
    html: `<link rel="canonical" href="https://usemingla.com/s/${CODE}" />`,
  }).state, "transient");

  // The two tags disagreeing is a half-written page, not a ready one.
  const disagreeing = pageHtml(CODE, 3).replace(
    `<meta property="og:image:secure_url" content="https://usemingla.com/og/s/${CODE}/v3-r2.jpg" />`,
    `<meta property="og:image:secure_url" content="https://usemingla.com/og/s/${CODE}/v4-r2.jpg" />`,
  );
  assert.equal(readinessVerdict({ code: CODE, requested: 1, pageStatus: 200, imageStatus: 200, html: disagreeing }).state, "transient");
  assert.equal(advertisedPortraitVersion(disagreeing, CODE), null);

  // A revision other than the one the client builds is not this card.
  assert.equal(advertisedPortraitVersion(pageHtml(CODE, 3).replaceAll("-r2.jpg", "-r3.jpg"), CODE), null);
});

test("R4 terminal and absent still pass through, and are not retried", () => {
  for (const [pageStatus, imageStatus, state, status] of [
    [410, 200, "terminal", 410], [200, 410, "terminal", 410],
    [404, 200, "absent", 404], [200, 404, "absent", 404],
  ]) {
    const verdict = readinessVerdict({ code: CODE, requested: 1, pageStatus, imageStatus, html: "" });
    assert.equal(verdict.state, state, `${pageStatus}/${imageStatus}`);
    assert.equal(verdict.status, status);
    assert.equal(verdict.retryable, false);
  }
});

test("R5 only a transport-shaped failure is retryable — the settled comparison is not", () => {
  // A 500/502 from upstream genuinely can differ on a second attempt.
  const upstream = readinessVerdict({ code: CODE, requested: 1, pageStatus: 500, imageStatus: 200, html: "" });
  assert.equal(upstream.state, "transient");
  assert.equal(upstream.status, 503);
  assert.equal(upstream.retryable, true);

  // Every settled verdict is not retryable. This is the property that removes
  // the ~1 s the old code spent re-running a decision it had already made.
  for (const verdict of [ok(CODE, 2, 1), ok(CODE, 4, 5), readinessVerdict({ code: CODE, requested: 1, pageStatus: 410, imageStatus: 200, html: "" })]) {
    assert.equal(verdict.retryable, false);
  }

  // And the route retries on the verdict's own flag, not on a status code it
  // re-derives — so the two cannot drift apart.
  const route = read("mingla-marketing/lib/content-share-readiness.ts");
  assert.match(route, /if \(attempted\.verdict\.retryable\) \{/);
  assert.doesNotMatch(route, /result\.status === 502/);
});

test("R6 the client surfaces the version the server named, and never invents one", async () => {
  const body = (payload, status) => async () => new Response(JSON.stringify(payload), { status });

  const ready = await sharing.checkContentShareReadinessDetailed(CODE, 1, body({ state: "ready", version: 4 }, 200));
  assert.deepEqual(ready, { state: "ready", version: 4 });

  // A server that names nothing gets null, never a fabricated 1.
  const silent = await sharing.checkContentShareReadinessDetailed("Bb0Cc1Dd2Ee3Ff4G", 1, body({ state: "ready" }, 200));
  assert.deepEqual(silent, { state: "ready", version: null });

  // A server naming a version BEHIND the request is not trusted to move the
  // client backwards onto a version its own page has left.
  const backwards = await sharing.checkContentShareReadinessDetailed("Cc0Dd1Ee2Ff3Gg4H", 6, body({ state: "ready", version: 5 }, 200));
  assert.deepEqual(backwards, { state: "ready", version: null });

  // A body that is not JSON at all must not turn a ready into a throw.
  const garbage = await sharing.checkContentShareReadinessDetailed("Dd0Ee1Ff2Gg3Hh4I", 1, async () => new Response("<html>", { status: 200 }));
  assert.deepEqual(garbage, { state: "ready", version: null });

  // The state-only projection is exactly that — one implementation, two views.
  assert.equal(await sharing.checkContentShareReadiness("Ee0Ff1Gg2Hh3Ii4J", 1, body({ state: "ready", version: 9 }, 200)), "ready");
  assert.equal(await sharing.checkContentShareReadiness("Ff0Gg1Hh2Ii3Jj4K", 1, body({ state: "transient" }, 502)), "transient");
});

test("R7 both share sheets ADOPT the newer version rather than holding a dead one", () => {
  // The portrait URL the sheet carries is versioned. Accepting M > N without
  // adopting M leaves the sheet pointing at a number the page has moved past —
  // which is how a "ready" share still hands over a stale card.
  for (const relative of [
    "mingla-business/src/components/ui/ShareModalContent.tsx",
    "app-mobile/src/components/share/UnifiedShareProvider.tsx",
  ]) {
    const source = read(relative);
    assert.match(source, /checkContentShareReadinessDetailed\(prepared\.shortCode, prepared\.version\)/, relative);
    assert.match(source, /result\.state === 'ready' && result\.version !== null && result\.version > prepared\.version/, relative);
    assert.match(source, /s4Url: current\.media === null \? null : buildSharePortraitUrl\(current\.shortCode, result\.version\)/, relative);
  }
});
