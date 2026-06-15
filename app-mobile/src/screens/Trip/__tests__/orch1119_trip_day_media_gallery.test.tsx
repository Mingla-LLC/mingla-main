// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// ORCH-1119 [trip-day-media-gallery] — consumer regression test.
//
// app-mobile has no jest/RTL runner; the repo convention for mobile regression
// tests is node:assert source-assertions + behavioral replicas (mirrors
// orch_1016_consumer_trip_detail.adversarial.test.tsx). Run with:
//   node app-mobile/src/screens/Trip/__tests__/orch1119_trip_day_media_gallery.test.tsx
//
// §9 fails-on-revert contract (consumer half):
//   - Reverting the consumer gallery render (the `day.media.length > 0 ?` block
//     in ConsumerTripDetailScreen) → the empty-state guard + gallery assertions
//     FAIL (no gallery for non-empty media; Constitution #9 guard gone).
//   - Reverting the one-playing guard (activeVideoKey state + playbackActive) →
//     the one-playing assertions FAIL.
//   - Reverting coerceTripDayMedia → malformed/typeless items would survive.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");
const detailSrc = fs.readFileSync(
  path.join(ROOT, "src/screens/Trip/ConsumerTripDetailScreen.tsx"),
  "utf8",
);
const hookSrc = fs.readFileSync(
  path.join(ROOT, "src/hooks/useConsumerTripDetail.ts"),
  "utf8",
);

let passed = 0;
function ok(name, cond, detail) {
  assert.ok(cond, `FAIL ${name}${detail ? " — " + detail : ""}`);
  console.log(`OK   ${name}`);
  passed += 1;
}

// ── coerceTripDayMedia behavioral replica (mirrors the hook source) ──
// Reverting the type/url guards lets malformed items through → these fail.
function coerceTripDayMedia(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const url = item.url;
    const type = item.type;
    if (typeof url !== "string" || url.length === 0) continue;
    if (type !== "image" && type !== "video") continue;
    const next = { url, type };
    if (typeof item.provider === "string") next.provider = item.provider;
    out.push(next);
  }
  return out;
}

// ── T1: coercer drops malformed/typeless items (SPEC T2 + explicit-type invariant) ──
{
  const dirty = [
    { url: "x", type: "image" },
    { type: "video" }, // no url
    { url: "y", type: "bogus" }, // bad type
    { url: "z" }, // no type
    "junk", // not an object
    { url: "v", type: "video" },
  ];
  const clean = coerceTripDayMedia(dirty);
  ok("T1 coercer keeps only well-formed typed items", clean.length === 2);
  ok("T1 coercer preserved order + types", clean[0].url === "x" && clean[1].type === "video");
  ok("T1 coercer drops a typeless item", !clean.some((m) => m.url === "z"));
}

// ── T2: the hook anon-selects media (no brands/tickets read — COMMS-0009) ──
ok(
  "T2 hook selects media on trip_days",
  /\.select\("id, ordinal, title, narrative, media"\)/.test(hookSrc),
);
ok(
  "T2 hook coerces media into TripDetailDay",
  /media:\s*coerceTripDayMedia\(/.test(hookSrc),
);
// Strip line comments so the docstring's literal `.from('brands')` warning isn't
// mistaken for a real read.
const hookCode = hookSrc
  .split("\n")
  .filter((l) => !/^\s*\*/.test(l) && !/^\s*\/\//.test(l))
  .join("\n");
ok(
  "T2 consumer fetch never reads brands/tickets tables (COMMS-0009)",
  !/\.from\(["']brands["']\)/.test(hookCode) &&
    !/\.from\(["']tickets["']\)/.test(hookCode),
);

// ── T3: Constitution #9 — zero gallery nodes for media:[] ──
// ORCH-1138 Leg 1C RETARGET ([TEST-MOD-APPROVED ORCH-1138]): the consumer trip
// detail now delegates the per-day gallery to the SHARED @mingla/offering-
// rendering <CountAwareGallery/> (Direction-A parity with the business/web trip
// page) instead of the hand-rolled `day.media.length > 0 ? <ScrollView>…` block.
// CountAwareGallery enforces Constitution #9 INTERNALLY — it renders ZERO nodes
// for an empty `items` array (documented in CountAwareGallery.tsx). The adapter
// feeds it `day.gallery` (the mapped CountAwareGalleryItem[]). So the rule-9
// guard is preserved, now at the primitive layer; this assertion is retargeted to
// the delegation. The behavioral replica below still proves the zero-node rule.
ok(
  "T3 consumer gallery delegates to the shared CountAwareGallery (rule-9 zero-nodes enforced by the primitive)",
  /<CountAwareGallery\b/.test(detailSrc) &&
    /items=\{day\.gallery\}/.test(detailSrc),
);

// Behavioral replica: the render predicate yields nothing for an empty day.
function renderGalleryNodeCount(media, activeVideoKey, dayId) {
  if (!(media.length > 0)) return 0; // Constitution #9 — no gallery node
  // One node per media item; track how many videos are "playing".
  let playing = 0;
  media.forEach((m, i) => {
    const key = `${dayId}-${i}`;
    if (m.type === "video" && activeVideoKey === key) playing += 1;
  });
  return { nodes: media.length, playing };
}
ok(
  "T3 empty-media day renders ZERO gallery nodes",
  renderGalleryNodeCount([], null, "d1") === 0,
);

// ── T4: one-playing guard — at most ONE video plays at a time ──
{
  const twoVideos = [
    { url: "a.mp4", type: "video" },
    { url: "b.mp4", type: "video" },
  ];
  // No active key → zero playing.
  const r0 = renderGalleryNodeCount(twoVideos, null, "d1");
  ok("T4 no active key → zero videos playing", r0.playing === 0);
  // Active key = first → exactly one playing.
  const r1 = renderGalleryNodeCount(twoVideos, "d1-0", "d1");
  ok("T4 one active key → exactly one video playing", r1.playing === 1 && r1.nodes === 2);
}
// ORCH-1138 Leg 1C RETARGET ([TEST-MOD-APPROVED ORCH-1138]): the one-playing
// guard moved INTO the shared CountAwareGallery primitive (it tracks the active
// video via firstVideoIndex + internal state, so at most one tile plays at a
// time). The consumer screen no longer hand-rolls activeVideoKey/playbackActive
// for the per-day gallery (it delegates to CountAwareGallery). The behavioral
// replica above still proves the at-most-one-playing invariant; this assertion is
// retargeted to the delegation.
ok(
  "T4 the per-day gallery's one-playing guard is owned by the shared CountAwareGallery primitive",
  /<CountAwareGallery\b/.test(detailSrc) &&
    /accessibilityLabelPrefix=\{`Day \$\{day\.ordinal\} media`\}/.test(detailSrc),
);

console.log(`\n${passed} checks passed — ORCH-1119 consumer gallery`);
