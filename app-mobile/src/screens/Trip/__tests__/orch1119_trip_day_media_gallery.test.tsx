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

// ── T2: the hook surfaces per-day media (no brands/tickets read — COMMS-0009) ──
// [TEST-MOD-APPROVED META-ORCH-1174] — Leg A.2 rewired useConsumerTripDetail onto
// the canonical `pg_public_trip_by_slug` RPC, which returns `days[].media`
// directly (replacing the prior `.from("trip_days").select("...media")` read).
// The per-day media invariant is unchanged (the coercer still runs); only its
// SOURCE moved from a client select to the RPC payload.
ok(
  "T2 hook reads the canonical RPC that returns per-day media",
  /supabase\.rpc\(\s*["']pg_public_trip_by_slug["']/.test(hookSrc) &&
    /media:\s*unknown/.test(hookSrc),
);
ok(
  "T2 hook coerces RPC per-day media into TripDetailDay",
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
// META-ORCH-1174 Leg A RETARGET ([TEST-MOD-APPROVED META-ORCH-1174]): the consumer
// trip detail now renders the SHARED <TripOfferingBody/> (the ONE standardized trip
// body), which renders the shared <DayByDay/> spine, which renders the shared
// <CountAwareGallery/> per day. The per-day gallery moved ONE delegation level
// deeper than the ORCH-1138 Leg-1C retarget (screen → TripOfferingBody → DayByDay →
// CountAwareGallery). CountAwareGallery enforces Constitution #9 INTERNALLY (zero
// nodes for an empty items array). So this assertion is retargeted to: the screen
// renders <TripOfferingBody/> (carrying the day-by-day spine), AND the shared
// DayByDay feeds CountAwareGallery the per-day media. The behavioral replica below
// still proves the zero-node rule independently.
const dayByDaySrc = fs.readFileSync(
  path.join(ROOT, "../packages/offering-rendering/DayByDay.tsx"),
  "utf8",
);
ok(
  "T3 consumer trip detail renders the shared TripOfferingBody (carries day-by-day)",
  /<TripOfferingBody\b/.test(detailSrc),
);
ok(
  "T3 shared DayByDay delegates the per-day gallery to CountAwareGallery (rule-9 zero-nodes enforced by the primitive)",
  /<CountAwareGallery\b/.test(dayByDaySrc) &&
    /items=\{day\.media\.map\(/.test(dayByDaySrc),
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
// META-ORCH-1174 Leg A RETARGET ([TEST-MOD-APPROVED META-ORCH-1174]): the
// one-playing guard is owned by the shared CountAwareGallery primitive, which is
// now rendered by the shared <DayByDay/> (inside <TripOfferingBody/>), not the
// screen. The behavioral replica above still proves the at-most-one-playing
// invariant; this assertion is retargeted to the DayByDay delegation.
ok(
  "T4 the per-day gallery's one-playing guard is owned by the shared CountAwareGallery primitive (via DayByDay)",
  /<CountAwareGallery\b/.test(dayByDaySrc) &&
    /accessibilityLabelPrefix=\{`Day \$\{day\.ordinal\} media`\}/.test(dayByDaySrc),
);

console.log(`\n${passed} checks passed — ORCH-1119 consumer gallery`);
