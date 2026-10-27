// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// Issue #4114 Wave 7 — thumbnails, the daily allowance and the media card
// layout, driven behaviourally:
//   * thumbnails: an ordinary photo or video gets <conv>/<clientId>_thumb.jpg,
//     view once and files never do; the name is exactly what the database's
//     canonical-name regex accepts (read from the migration), and the once/
//     form is refused by it; thumbnails fit 480px;
//   * links for ordinary media last 7 days;
//   * D17: 200 MB per day — exactly 200 MB is allowed, a byte more is not, and
//     storage's chat_media_daily_limit text is recognised whatever its status;
//   * layout: cards are 72% of the width, the shape is clamped between 3:4 and
//     16:9, 14pt above and below media cards (1pt / 6pt for plain bubbles),
//     albums have up to 4 tiles with "+N" on the 4th, and consecutive photos of
//     one album (same sender) group, while view once, failures, other senders
//     and other albums never join.
//
// FAILS-ON-REVERT: drop the `_thumb.jpg` alternative from the migration regex,
// make shouldMakeThumbnail return true for view once, put SIGNED_URL_SECONDS
// back to one hour, delete the daily_limit branch of classifyUploadResponse,
// remove the clamp in clampMediaAspect, return the plain gap for media in
// bubbleBottomGap, or drop the sender check in groupAlbums — each fails here.

import {
  DAILY_CHAT_MEDIA_BYTES,
  SIGNED_URL_SECONDS,
  THUMB_MAX_EDGE,
  buildChatAttachmentPath,
  buildChatThumbPath,
  classifyUploadResponse,
  shouldMakeThumbnail,
  thumbResize,
  wouldExceedDailyLimit,
} from "../chatMedia.ts";
import {
  BUBBLE_GAP_CONTINUE,
  BUBBLE_GAP_GROUP_END,
  MEDIA_CARD_GAP,
  albumCardSize,
  albumTiles,
  bubbleBottomGap,
  bubbleTopGap,
  clampMediaAspect,
  formatMediaDuration,
  groupAlbums,
  mediaCardSize,
} from "../chatMediaLayout.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function eq(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const CONV = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CLIENT = "11111111-2222-4333-8444-555555555555";

// The database's canonical-name regex, read from the Wave 7 migration.
const migration = Deno.readTextFileSync(
  new URL("../../../../supabase/migrations/20271230064114_issue_4114_chat_media_guards.sql", import.meta.url),
);
const fnStart = migration.indexOf("FUNCTION public.issue_4114_chat_attachment_conversation");
const regexMatch = /p_name !~\s*'([^']+)'/.exec(migration.slice(fnStart));
assert(regexMatch, "the migration defines the canonical-name regex");
const canonical = new RegExp(regexMatch[1]);

Deno.test("#4114 W7: thumbnails sit next to ordinary media and match the database's names", () => {
  const thumb = buildChatThumbPath(CONV, CLIENT);
  eq(thumb, `${CONV}/${CLIENT}_thumb.jpg`, "thumbnail path");
  assert(canonical.test(thumb), "the database accepts the thumbnail name");
  assert(canonical.test(buildChatAttachmentPath(CONV, CLIENT, "mp4", false)), "and the video name");
  assert(!canonical.test(`${CONV}/once/${CLIENT}_thumb.jpg`), "never a thumbnail under once/");
  assert(!canonical.test(`${CONV}/${CLIENT}_thumb.png`), "only .jpg thumbnails");
  assert(!canonical.test(`${CONV}/${CLIENT}_thumb.jpg/x`), "nothing after the name");
  let threw = false;
  try {
    buildChatThumbPath("not-a-uuid", CLIENT);
  } catch {
    threw = true;
  }
  assert(threw, "bad ids are refused");
});

Deno.test("#4114 W7: view once and files never get a thumbnail", () => {
  eq(shouldMakeThumbnail("image", false), true, "photo");
  eq(shouldMakeThumbnail("video", false), true, "video");
  eq(shouldMakeThumbnail("image", true), false, "view-once photo");
  eq(shouldMakeThumbnail("video", true), false, "view-once video");
  eq(shouldMakeThumbnail("file", false), false, "file");
});

Deno.test("#4114 W7: thumbnails fit 480px and ordinary links last 7 days", () => {
  eq(THUMB_MAX_EDGE, 480, "thumbnail edge");
  eq(thumbResize(1600, 1200), { width: 480 }, "landscape");
  eq(thumbResize(1080, 1920), { height: 480 }, "portrait");
  eq(thumbResize(400, 300), null, "already small");
  eq(SIGNED_URL_SECONDS, 7 * 24 * 60 * 60, "7-day links");
});

Deno.test("#4114 W7: the daily allowance is 200 MB and its refusal is recognised", () => {
  const MB = 1024 * 1024;
  eq(DAILY_CHAT_MEDIA_BYTES, 200 * MB, "200 MB");
  eq(wouldExceedDailyLimit(190 * MB, 10 * MB), false, "exactly 200 MB is allowed");
  eq(wouldExceedDailyLimit(190 * MB, 10 * MB + 1), true, "a byte more is not");
  eq(wouldExceedDailyLimit(200 * MB, null), true, "at the limit, an unknown size is refused");
  eq(wouldExceedDailyLimit(0, null), false, "nothing used");
  eq(classifyUploadResponse(400, '{"message":"chat_media_daily_limit"}'), "daily_limit", "400 wrap");
  eq(classifyUploadResponse(500, '{"error":"DatabaseError","message":"chat_media_daily_limit"}'), "daily_limit", "500 wrap");
  eq(classifyUploadResponse(409, "The resource already exists"), "already_uploaded", "a retry still counts as done");
});

Deno.test("#4114 W7: media cards are 72% wide with the shape clamped between 3:4 and 16:9", () => {
  const screen = 390;
  const wide = mediaCardSize({ screenWidth: screen, mediaWidth: 4000, mediaHeight: 1000 });
  eq(wide.width, Math.round(screen * 0.72), "72% of the width");
  eq(wide.height, Math.round(wide.width / (16 / 9)), "panorama clamps to 16:9");
  const tall = mediaCardSize({ screenWidth: screen, mediaWidth: 1000, mediaHeight: 4000 });
  eq(tall.height, Math.round(tall.width / (3 / 4)), "tall clamps to 3:4");
  const square = mediaCardSize({ screenWidth: screen, mediaWidth: 1200, mediaHeight: 1200 });
  eq(square.height, square.width, "a square stays square");
  eq(clampMediaAspect(null, null), 4 / 3, "unknown size draws 4:3");
});

Deno.test("#4114 W7: 14pt around media cards; plain bubbles keep their tight grouping", () => {
  eq(MEDIA_CARD_GAP, 14, "14pt");
  eq(bubbleBottomGap({ kind: "media", nextKind: "plain", groupEnd: false }), 14, "under a card");
  eq(bubbleBottomGap({ kind: "plain", nextKind: "media", groupEnd: false }), 14, "above a card");
  eq(bubbleBottomGap({ kind: "plain", nextKind: "plain", groupEnd: false }), BUBBLE_GAP_CONTINUE, "inside a run");
  eq(bubbleBottomGap({ kind: "plain", nextKind: "plain", groupEnd: true }), BUBBLE_GAP_GROUP_END, "end of a run");
  eq(BUBBLE_GAP_CONTINUE, 1, "1pt");
  eq(bubbleTopGap({ kind: "media", previousKind: null }), 14, "a card at the top of the thread");
  eq(bubbleTopGap({ kind: "plain", previousKind: null }), 0, "a plain bubble at the top");
});

Deno.test("#4114 W7: albums show up to 4 tiles with +N on the 4th", () => {
  eq(albumTiles(2), [{ index: 0, overflow: 0 }, { index: 1, overflow: 0 }], "two");
  eq(albumTiles(4).map((tile) => tile.overflow), [0, 0, 0, 0], "four");
  eq(albumTiles(7), [
    { index: 0, overflow: 0 },
    { index: 1, overflow: 0 },
    { index: 2, overflow: 0 },
    { index: 3, overflow: 3 },
  ], "seven: +3 on the 4th");
  const two = albumCardSize(390, 2);
  const four = albumCardSize(390, 7);
  assert(four.height > two.height, "3+ photos take two rows");
  eq(two.width, Math.round(390 * 0.72), "albums are as wide as cards");
});

Deno.test("#4114 W7: photos of one album from one sender group; nothing else joins", () => {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    senderId: "ana",
    type: "image",
    albumId: "A",
    ...extra,
  });
  const runs = groupAlbums([
    row("t1", { type: "text", albumId: undefined }),
    row("p1"),
    row("p2"),
    row("p3"),
    row("b1", { senderId: "ben" }),
    row("o1", { viewOnce: true }),
    row("f1", { failed: true }),
    row("q1", { albumId: "B" }),
    row("q2", { albumId: "B" }),
    row("v1", { type: "video", albumId: "B" }),
  ]);
  eq(runs.map((run) => run.map((m) => m.id)), [
    ["t1"],
    ["p1", "p2", "p3"],
    ["b1"],
    ["o1"],
    ["f1"],
    ["q1", "q2"],
    ["v1"],
  ], "album runs");
  eq(formatMediaDuration(24_000), "0:24", "duration");
  eq(formatMediaDuration(3_725_000), "1:02:05", "past an hour");
  eq(formatMediaDuration(null), null, "no duration");
});
