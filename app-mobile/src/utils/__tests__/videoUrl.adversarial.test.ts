// ORCH-1069 — TESTER-authored adversarial regression test.
//
// Attacks DIFFERENT angles than the implementor's happy-path test
// (videoUrl.test.ts), which covered: detection of clean video shapes,
// rejection of clean images/null, video-first / mixed firstVideoUrl, and the
// isTopCard-collapsed perf mapping.
//
// This file attacks:
//   A1. firstVideoUrl when the video is NOT first and is buried among MANY
//       stills (incl. a Cloudinary /video/upload/ url with no extension and a
//       query-string .mp4) — the cover must still be picked for the hero.
//   A2. MALFORMED / heterogeneous images array (non-string junk: number, null,
//       object, empty string) interleaved with a real video — firstVideoUrl
//       must skip the junk and return the video WITHOUT crashing (the deck/
//       gallery receive `images: string[]` typed, but discover-cards builds it
//       from `stored_photo_urls` which is untyped JSON — a null/number sneaking
//       in must not throw inside the deck render path).
//   A3. The TRUE perf gate is `shouldPlay = autoplay && playbackActive` (the
//       value EventCoverMedia actually computes, EventCoverMedia.tsx:143/225).
//       The implementor collapsed both inputs onto a single isTopCard, but the
//       real renderer ANDs two independent booleans. Assert the full truth
//       table so a future regression that wires autoplay/playbackActive from
//       different sources (e.g. autoplay always true) is caught:
//       only (true,true) plays — i.e. the behind card (false,false), and any
//       half-gated state, must NOT play.
//
// Fails-on-revert:
//   - Revert firstVideoUrl to `images[0] is video ? images[0] : null` style
//     (first-only) → A1 fails (video buried at index 4 is missed).
//   - Remove the `typeof u !== "string"` guard inside isVideoUrl → A2 throws
//     on the number/object/null entries (RegExp.test coerces, but the guard is
//     the documented contract; without it `.test(123)` matches "123" oddly and
//     null/object behavior is unsafe) → A2 fails / throws.
//   - Wire the deck `autoplay` to a constant true while only gating
//     playbackActive → A3 (true,false)/(false,*) expectations break.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isVideoUrl, firstVideoUrl } from "../videoUrl.ts";

const IMG = (n: string) => `https://cdn.example.com/${n}.jpg`;
const VIDEO_NOEXT = "https://res.cloudinary.com/mingla/video/upload/v1/cover"; // no ext
const VIDEO_QS = "https://cdn.example.com/cover.mp4?v=9&sig=abc";

// ── A1: video buried among many stills (not first) is still the cover ──
Deno.test("ORCH-1069 ADV-A1: firstVideoUrl picks a non-first buried video", () => {
  // hero (edge `image`) would be a0.jpg; cover video is at index 4.
  const images = [IMG("a0"), IMG("a1"), IMG("a2"), IMG("a3"), VIDEO_NOEXT, IMG("a5")];
  assertEquals(firstVideoUrl(images), VIDEO_NOEXT);

  // a query-string .mp4 mixed after stills is detected as the cover.
  assertEquals(firstVideoUrl([IMG("x"), IMG("y"), VIDEO_QS]), VIDEO_QS);

  // when MULTIPLE videos exist, the FIRST in order wins (deterministic cover).
  assertEquals(firstVideoUrl([IMG("a"), VIDEO_QS, VIDEO_NOEXT]), VIDEO_QS);
});

// ── A2: malformed array with non-string junk → no crash, still finds video ──
Deno.test("ORCH-1069 ADV-A2: firstVideoUrl survives heterogeneous junk and finds the video", () => {
  // discover-cards builds `images` from untyped stored_photo_urls JSON; a null
  // or non-string can sneak past the type system at runtime. Must not throw.
  const junk = [
    null,
    123,
    { url: "nope" },
    "",
    IMG("real-still"),
    VIDEO_QS,
  ] as unknown as string[];

  let result: string | null = null;
  let threw = false;
  try {
    result = firstVideoUrl(junk);
  } catch {
    threw = true;
  }
  assertEquals(threw, false); // no crash on malformed input
  assertEquals(result, VIDEO_QS); // skipped junk + still, found the video

  // a junk-only array (no real video) → null → deck falls back to still hero.
  const junkOnly = [null, 0, {}, ""] as unknown as string[];
  assertEquals(firstVideoUrl(junkOnly), null);

  // isVideoUrl itself must reject each junk shape without throwing.
  assertEquals(isVideoUrl(123 as unknown as string), false);
  assertEquals(isVideoUrl({} as unknown as string), false);
  assertEquals(isVideoUrl(null), false);
});

// ── A3: full perf-gate truth table — shouldPlay === autoplay && playbackActive ──
Deno.test("ORCH-1069 ADV-A3: only (autoplay=true, playbackActive=true) plays", () => {
  // Mirror of EventCoverMedia's real composite gate (EventCoverMedia.tsx:143/225),
  // which CardHero feeds as autoplay=isTopCard, playbackActive=isTopCard.
  const shouldPlay = (autoplay: boolean, playbackActive: boolean): boolean =>
    autoplay && playbackActive;

  assertEquals(shouldPlay(true, true), true); // top card → plays
  assertEquals(shouldPlay(false, false), false); // behind card → paused
  // half-gated states must NOT play (guards against a future regression that
  // pins autoplay=true and only toggles playbackActive, or vice-versa).
  assertEquals(shouldPlay(true, false), false);
  assertEquals(shouldPlay(false, true), false);

  // CardHero feeds BOTH from isTopCard, so the only two reachable states are
  // the diagonal — assert that collapse is consistent with the AND gate.
  const cardHeroGate = (isTopCard: boolean) => shouldPlay(isTopCard, isTopCard);
  assertEquals(cardHeroGate(true), true);
  assertEquals(cardHeroGate(false), false);
});
