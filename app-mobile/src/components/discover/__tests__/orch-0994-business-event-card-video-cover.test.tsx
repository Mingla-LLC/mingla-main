// @ts-nocheck
/**
 * ORCH-0994 [Discover grid video covers render as solid color] — implementor
 * happy-path regression test.
 *
 * Bug: the Discover business-event card rendered covers through an image-only
 * ExpoImage and explicitly EXCLUDED video (`data.coverMediaType !== "video"`),
 * so any video cover fell through to the solid hue band ("solid color" report).
 *
 * Fix: route the cover through the shared `@mingla/event-rendering`
 * `EventCoverMedia`, which plays video (muted/looping), animates GIFs, shows
 * images, and renders its own hue-band fallback when there is no media.
 *
 * This is a source-assertion test (the established app-mobile regression
 * pattern — see orch-0945-dead-end-render.test.tsx). It asserts the rendering
 * contract at the source level so it runs without RN render / expo-video infra.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function resolveRepoFile(relPath) {
  const direct = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(direct)) return direct;
  return path.resolve(process.cwd(), "app-mobile", relPath);
}

function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), "utf8");
}

function runOrch0994VideoCoverHappyPath() {
  const src = readSource("src/components/discover/BusinessEventCard.tsx");

  // T-01: the shared video-capable renderer is imported from the shared package.
  assert.match(
    src,
    /import\s*\{\s*EventCoverMedia\s*\}\s*from\s*["']@mingla\/event-rendering["']/,
    "BusinessEventCard must import EventCoverMedia from @mingla/event-rendering",
  );

  // T-02: the cover is rendered through EventCoverMedia.
  assert.ok(
    src.includes("<EventCoverMedia"),
    "BusinessEventCard must render <EventCoverMedia for the cover",
  );

  // T-03: the media URL + type are forwarded so EventCoverMedia can decide
  // image/gif/video presentation (the type is what unlocks video playback).
  assert.ok(
    src.includes("mediaUrl={data.coverMediaUrl}"),
    "EventCoverMedia must receive mediaUrl={data.coverMediaUrl}",
  );
  assert.ok(
    src.includes("mediaType={data.coverMediaType}"),
    "EventCoverMedia must receive mediaType={data.coverMediaType}",
  );

  // [FAILS-ON-REVERT KEY] T-04: the pre-fix code excluded video with the guard
  // `data.coverMediaType !== "video"`, dropping video covers to the hue band.
  // Reverting the fix re-introduces this guard → this assertion fails.
  assert.ok(
    !src.includes('coverMediaType !== "video"'),
    "BusinessEventCard must NOT exclude video covers via `coverMediaType !== \"video\"`",
  );

  // [FAILS-ON-REVERT KEY] T-05: the pre-fix code rendered covers via the
  // image-only ExpoImage. Reverting re-adds the expo-image import → fails.
  assert.ok(
    !/from\s*["']expo-image["']/.test(src),
    "BusinessEventCard must NOT import the image-only expo-image for covers",
  );
}

runOrch0994VideoCoverHappyPath();

// Jest-visible wrapper (also runs as a plain node script).
if (typeof describe === "function") {
  describe("ORCH-0994: Discover business-event card renders video covers", () => {
    it("routes covers through EventCoverMedia and no longer excludes video", () => {
      runOrch0994VideoCoverHappyPath();
    });
  });
}
