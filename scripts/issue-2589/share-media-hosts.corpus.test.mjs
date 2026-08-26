/**
 * #2589 — the share host allowlist, run through every owner from ONE corpus;
 * plus the content-type gate, the share mount, and the cause-specific copy.
 *
 * THE DEFECT. The allowlist named `i.giphy.com` and `media.giphy.com`. Giphy's
 * API returns neither for a picked GIF: search results and their `*_still`
 * posters are served from `media0.giphy.com` … `media4.giphy.com`. So the list
 * matched ZERO real Giphy URLs, and every GIF cover in production produced a
 * share with no card. It was hand-copied into THREE files, and the copies had
 * already drifted from one another.
 *
 * WHY A SHARED CORPUS RATHER THAN THREE SETS OF ASSERTIONS. A CommonJS module
 * (bundled into two React Native apps and a Node server) and a Deno ESM module
 * cannot share one file without a build step, so two executable owners is the
 * honest floor. What CAN be made impossible is DISAGREEMENT: one table of URLs,
 * one expected verdict each, run through both. A drift between them fails here
 * before it can reach production. The third file no longer owns a rule at all —
 * it delegates, and H3 proves it has no host literal left to drift with.
 *
 * FAILS-ON-REVERT. Restoring `media.giphy.com` as a literal in either owner
 * fails H1/H2. Removing `gif` from the content-type gate fails H4. Removing the
 * mount gate or the per-cause copy fails H5/H6.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharing from "../../packages/sharing/index.js";
import { publicMediaUrl } from "../../supabase/functions/_shared/contentShare.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

/**
 * ONE corpus, two owners. Every row states the verdict BOTH must reach.
 *
 * The `media0..4` rows are the live production shapes: the cover URLs and the
 * `_s` still posters Giphy's picker actually stores. The rejection rows are the
 * reason this is not simply a suffix match on `giphy.com` — a suffix match
 * admits any subdomain someone can get pointed at that zone, and this predicate
 * decides which URL Mingla will fetch, re-encode, and bake into an image served
 * with a one-year immutable cache header.
 */
const CORPUS = [
  // --- Giphy: the hosts that were silently rejected -----------------------
  ["https://media0.giphy.com/media/abc/giphy.gif", true, "Giphy shard 0"],
  ["https://media1.giphy.com/media/abc/giphy.gif", true, "Giphy shard 1"],
  ["https://media2.giphy.com/media/abc/giphy.gif", true, "Giphy shard 2"],
  ["https://media3.giphy.com/media/abc/giphy.gif", true, "Giphy shard 3"],
  ["https://media4.giphy.com/media/abc/giphy_s.gif", true, "Giphy shard 4 still poster"],
  ["https://media17.giphy.com/media/abc/giphy.gif", true, "Giphy may add shards; the digits are not enumerated"],
  ["https://media.giphy.com/media/abc/giphy.gif", true, "the historical host still matches — widening, not swapping"],
  ["https://i.giphy.com/abc.gif", true, "Giphy direct host"],
  // --- Giphy: what must still be refused ---------------------------------
  ["https://giphy.com/gifs/abc", false, "the bare zone is not a delivery host"],
  ["https://evil-giphy.com/media/abc.gif", false, "lookalike registrable domain"],
  ["https://giphy.com.attacker.net/media/abc.gif", false, "suffix-confusion domain"],
  ["https://media4.giphy.com.attacker.net/a.gif", false, "the shard name as a prefix of another zone"],
  ["https://mediax.giphy.com/media/abc.gif", false, "a non-numeric shard is not a Giphy delivery host"],
  ["https://sub.media4.giphy.com/a.gif", false, "a deeper label under a shard is not the shard"],
  ["https://media4.giphy.com:8443/a.gif", false, "an explicit port"],
  ["http://media4.giphy.com/media/abc/giphy.gif", false, "plaintext"],
  ["https://user:pw@media4.giphy.com/a.gif", false, "userinfo"],
  // --- the rest of the allowlist, pinned so this change did not widen it ---
  ["https://usemingla.com/og/brand/x.png", true, "first-party"],
  ["https://host.usemingla.com/og/brand/x.png", true, "first-party host origin"],
  ["https://images.pexels.com/photos/1/x.jpg", true, "Pexels stills"],
  ["https://videos.pexels.com/video-files/1/x.mp4", true, "Pexels video — allowed on BOTH owners; they used to disagree here"],
  ["https://vz-a16fce08-6c6.b-cdn.net/x/thumbnail.jpg", true, "Bunny delivery"],
  ["https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/covers/a.jpg", true, "Mingla storage, public prefix"],
  ["https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/sign/covers/a.jpg", false, "a signed storage path is not public"],
  ["https://gqnoajqerqhnvulmnyvv.supabase.co/rest/v1/events", false, "storage host, non-storage path"],
  ["https://attacker.example/a.jpg", false, "an arbitrary host"],
  ["not a url at all", false, "unparseable"],
];

test("H1 the Node/CommonJS owner agrees with the corpus", () => {
  for (const [url, expected, why] of CORPUS) {
    assert.equal(sharing.isPublicShareMediaUrl(url), expected, `${why}: ${url}`);
  }
});

test("H2 the Deno/edge owner agrees with the corpus — the two cannot disagree", () => {
  for (const [url, expected, why] of CORPUS) {
    assert.equal(publicMediaUrl(url) !== null, expected, `${why}: ${url}`);
  }
});

/**
 * A QUOTED host literal in CODE — i.e. a file deciding for itself which hosts
 * are allowed. Comments are stripped first on purpose: prose that NAMES a host
 * while explaining the defect is documentation, not a rule, and a gate that
 * cannot tell the difference would push the explanation out of the codebase.
 */
const QUOTED_HOST_LITERAL = /["'][a-z0-9.*-]*(?:giphy|pexels|b-cdn|supabase)\.[a-z]+["']/i;
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");
const codeOf = (relative) => stripComments(read(relative));

test("H3 there are exactly TWO owners, and the third file delegates", () => {
  // The edge's second copy is gone: the envelope validator imports the mapper's
  // predicate instead of restating it.
  const service = read("supabase/functions/_shared/contentShareService.ts");
  assert.match(service, /import \{ isPublicShareMediaHost,/);
  assert.match(service, /return isPublicShareMediaHost\(new URL\(value as string\)\)/);
  assert.doesNotMatch(stripComments(service), QUOTED_HOST_LITERAL, "the edge validator restated the host list again");

  // The web renderer's copy is gone: it calls the CommonJS owner.
  const renderer = read("mingla-business/server/cardIdentityRenderer.js");
  assert.match(renderer, /require\("\.\.\/\.\.\/packages\/sharing"\)/);
  assert.match(renderer, /isPublicShareMediaUrl\(value, bunnyHost \? \[bunnyHost\] : \[\]\)/);
  assert.doesNotMatch(stripComments(renderer), QUOTED_HOST_LITERAL, "the renderer restated the host list again");

  // And exactly two executable definitions remain, one per module system. Every
  // other file in this pipeline that could carry the rule is checked, so a
  // fourth copy cannot appear anywhere the defect has ever lived.
  const owners = [
    "packages/sharing/index.js",
    "supabase/functions/_shared/contentShare.ts",
  ];
  const deciders = [
    "packages/sharing/index.js",
    "packages/sharing/index.d.ts",
    "supabase/functions/_shared/contentShare.ts",
    "supabase/functions/_shared/contentShareService.ts",
    "mingla-business/server/cardIdentityRenderer.js",
    "mingla-marketing/lib/content-share-readiness.ts",
    "mingla-marketing/lib/content-share-readiness-verdict.ts",
    "mingla-marketing/lib/shared-card-proxy.ts",
  ].filter((relative) => QUOTED_HOST_LITERAL.test(codeOf(relative)));
  assert.deepEqual(deciders.sort(), owners.sort());

  // Both owners use the same shape of rule — `media` plus zero-or-more digits,
  // anchored at both ends. Not a suffix match.
  for (const relative of owners) {
    assert.match(read(relative), /\/\^media\[0-9\]\*\\\.giphy\\\.com\$\//, relative);
  }
});

test("H4 the content-type gate admits GIF — the second closed gate", () => {
  const renderer = read("mingla-business/server/cardIdentityRenderer.js");
  const match = /const PUBLIC_IMAGE_MIME = (\/\^image\\\/\(\?:[^/]+\)\(\?:;\|\$\)\/i);/.exec(renderer);
  assert.notEqual(match, null, "the content-type gate is no longer where it was");
  // eslint-disable-next-line no-eval -- the gate's own literal, read from source
  const mime = eval(match[1]);
  for (const accepted of ["image/gif", "image/gif;charset=binary", "IMAGE/GIF", "image/jpeg", "image/png", "image/webp", "image/avif"]) {
    assert.equal(mime.test(accepted), true, accepted);
  }
  // Video still has no path through this renderer and must not acquire one here.
  for (const refused of ["video/mp4", "image/svg+xml", "text/html", "application/octet-stream", "image/gifx"]) {
    assert.equal(mime.test(refused), false, refused);
  }
  // A GIF is composed from its still, and the still is what the card draws.
  assert.match(renderer, /STILL FIRST FRAME/);
  assert.match(renderer, /const poster = safeText\(media\?\.posterUrl\)/);
});

test("H5 the share mount refuses an offering the public cannot resolve", () => {
  const wrapper = read("mingla-business/src/components/ui/ShareModal.tsx");
  assert.match(wrapper, /export function offeringShareability/);

  // The rule matches the server's. The share edge admits public/discover/hidden —
  // `hidden` IS Unlisted and IS shareable by exact link — and refuses private and
  // unpublished. If that server gate is ever narrowed, this assertion is the
  // thing that notices.
  const edge = read("supabase/functions/_shared/contentShare.ts");
  assert.match(edge, /\["public", "discover"\]\.includes\(row\.visibility\) && row\.visibility !== "hidden"/);

  for (const [offering, shareable] of [
    [{ visibility: "public", publishedAt: "2026-01-01T00:00:00Z", status: "scheduled" }, true],
    [{ visibility: "unlisted", publishedAt: "2026-01-01T00:00:00Z", status: "live" }, true],
    [{ visibility: "public", publishedAt: "2026-01-01T00:00:00Z", status: "ended" }, true],
    [{ visibility: "private", publishedAt: "2026-01-01T00:00:00Z", status: "live" }, false],
    [{ visibility: "public", publishedAt: null, status: "scheduled" }, false],
    [{ visibility: "public", publishedAt: "2026-01-01T00:00:00Z", status: "draft" }, false],
    [{}, false],
  ]) {
    // Evaluated from the source so this suite needs no React Native runtime.
    const shareabilityOf = buildShareabilityFromSource(wrapper);
    const verdict = shareabilityOf(offering);
    assert.equal(verdict.shareable, shareable, JSON.stringify(offering));
    if (!shareable) assert.equal(typeof verdict.reason === "string" && verdict.reason.length > 0, true, "a refusal with no reason is a dead tap");
  }

  // Both organiser screens consult it, mount the sheet only when it passes, and
  // give the tap a reason when it does not.
  for (const relative of ["mingla-business/app/event/[id]/index.tsx", "mingla-business/app/rsvp/[id]/index.tsx"]) {
    const screen = read(relative);
    assert.match(screen, /offeringShareability\(\{/, relative);
    assert.match(screen, /if \(!shareability\.shareable\) \{\s*setToast\(\{ visible: true, message: shareability\.reason \}\);\s*return;/, relative);
    assert.match(screen, /\{shareability\.shareable \? \(\s*<ShareModal/, relative);
  }

  // And the kind is derived, not hardcoded: an RSVP shared as `event` makes the
  // edge query the wrong event_type, find nothing, and return the SAME 404 as an
  // unpublished offering.
  const eventScreen = read("mingla-business/app/event/[id]/index.tsx");
  assert.match(eventScreen, /const shareContentKind: ShareEntityKind = resolvedLiveEvent\?\.event_type === "rsvp"/);
  assert.match(eventScreen, /contentKind=\{shareContentKind\}/);
  assert.doesNotMatch(eventScreen, /contentKind="event"/);
});

test("H6 the failure copy distinguishes the causes, and Retry is offered only where it can work", () => {
  for (const [relative, reasonType] of [
    ["mingla-business/src/components/ui/ShareModalContent.tsx", "BusinessShareFailureReason"],
    ["app-mobile/src/components/share/UnifiedShareProvider.tsx", "ContentShareFailureReason"],
  ]) {
    const source = read(relative);
    assert.match(source, new RegExp(`SHARE_FAILURE_COPY: Record<${reasonType}, string>`), relative);
    // Four causes, four strings, all different — the whole point.
    const table = /SHARE_FAILURE_COPY[^=]*= \{([\s\S]*?)\n\};/.exec(source);
    assert.notEqual(table, null, relative);
    const strings = [...table[1].matchAll(/^\s*(not_public|unauthorized|unavailable|unknown): (["'])((?:\\.|(?!\2).)*)\2,/gm)]
      .map((match) => [match[1], match[3]]);
    assert.equal(strings.length, 4, `${relative}: ${table[1]}`);
    assert.equal(new Set(strings.map(([, value]) => value)).size, 4, `${relative}: two causes share a string`);
    // The generic string survives ONLY for the genuinely unknown cause.
    const byReason = Object.fromEntries(strings);
    assert.match(byReason.unknown, /Couldn't prepare this share/, relative);
    for (const reason of ["not_public", "unauthorized", "unavailable"]) {
      assert.doesNotMatch(byReason[reason], /Couldn't prepare this share/, `${relative}/${reason}`);
    }
    // Retry only where a second attempt can change the answer.
    assert.match(source, new RegExp(`RETRYABLE_SHARE_FAILURES = new Set<${reasonType}>\\(\\['unavailable', 'unknown'\\]\\)`), relative);
    assert.match(source, /RETRYABLE_SHARE_FAILURES\.has\(prep(Failure|Failure)\)|RETRYABLE_SHARE_FAILURES\.has\(failure\)/, relative);
  }

  // The reason is produced from the transport status, in one place per app, and
  // travels on the error object so the failure path imports nothing.
  for (const relative of [
    "mingla-business/src/services/contentShareAdapter.ts",
    "app-mobile/src/services/contentShareAdapter.ts",
  ]) {
    const adapter = read(relative);
    assert.match(adapter, /status === 401 \|\| status === 403 \? 'unauthorized'/, relative);
    assert.match(adapter, /status === 404 \? 'not_public'/, relative);
    assert.match(adapter, /status === 503 \? 'unavailable'/, relative);
    assert.match(adapter, /Object\.assign\(new Error\(`\$\{SHARE_FAILURE_PREFIX\}\$\{reason\}`\), \{ reason \}\)/, relative);
  }
});

/**
 * Evaluates `offeringShareability` out of its own source so this suite can
 * assert the real function without a React Native runtime. The extraction is
 * pinned: if the function is renamed or its shape changes, this throws rather
 * than silently testing nothing.
 */
function buildShareabilityFromSource(source) {
  const start = source.indexOf("export function offeringShareability(offering: {");
  assert.notEqual(start, -1, "offeringShareability is no longer where it was");
  const end = source.indexOf("\n}", source.indexOf("return { shareable: true };", start));
  assert.notEqual(end, -1, "offeringShareability's body is no longer where it was");
  const body = source
    .slice(start, end + 2)
    .replace("export function offeringShareability(offering: {", "return function offeringShareability(offering) { void 0; /*")
    .replace("}): OfferingShareability {", "*/");
  // eslint-disable-next-line no-new-func -- the predicate's own source, read from disk
  return new Function(body)();
}
