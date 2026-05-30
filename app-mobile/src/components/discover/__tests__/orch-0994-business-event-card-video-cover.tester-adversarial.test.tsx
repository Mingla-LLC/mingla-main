// @ts-nocheck
/**
 * ORCH-0994 [Discover grid video covers render as solid color] — tester
 * adversarial regression test.
 *
 * DIFFERENT ANGLE from the implementor happy-path test (which proves video now
 * renders): this attacks the refactor's blast radius — that swapping the
 * image-only branch for EventCoverMedia did NOT (a) break the genuine no-media
 * hue-band fallback, or (b) leave orphaned dead code (the old hue helper,
 * the heroImage/heroBand styles) that would mislead future readers, or (c)
 * leave a second, competing cover-render path.
 *
 * Source-assertion test (matches the app-mobile regression pattern).
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

function runOrch0994VideoCoverAdversarial() {
  const src = readSource("src/components/discover/BusinessEventCard.tsx");

  // A-01: FALLBACK PRESERVED — the hue is forwarded so an event with no cover
  // (coverMediaUrl null) still gets EventCoverMedia's built-in colored band.
  // If `hue` were dropped, no-media events would render the package default
  // hue (25) instead of the event's own coverHue — a silent visual regression.
  assert.ok(
    src.includes("hue={data.coverHue}"),
    "EventCoverMedia must receive hue={data.coverHue} so the no-media fallback keeps the event's own band colour",
  );

  // A-02: NO ORPHANED DEAD CODE — the local hue-band helper was removed (its
  // job moved into EventCoverMedia's EventCover fallback). A lingering
  // `heroColorFromHue(` call site would mean a dead second band path survived.
  assert.ok(
    !src.includes("heroColorFromHue("),
    "the local heroColorFromHue helper/call must be fully removed (EventCoverMedia owns the fallback band)",
  );

  // A-03: NO ORPHANED STYLES — the old hero image/band style keys were removed.
  assert.ok(
    !/heroImage\s*:/.test(src) && !/heroBand\s*:/.test(src),
    "dead heroImage/heroBand style keys must be removed after the EventCoverMedia swap",
  );

  // A-04: SINGLE COVER PATH — exactly one cover renderer (EventCoverMedia), no
  // competing <Image>/<ExpoImage> cover element left behind.
  const eventCoverMediaCount = (src.match(/<EventCoverMedia/g) || []).length;
  assert.equal(
    eventCoverMediaCount,
    1,
    "there must be exactly one <EventCoverMedia cover renderer",
  );
  assert.ok(
    !src.includes("<ExpoImage") && !src.includes("<Image "),
    "no leftover <ExpoImage>/<Image> cover element may remain",
  );

  // A-05: grid cells use crop fill (videoContentFit="cover"); the "contain"
  // letterbox treatment is reserved for the full-bleed event hero, not the
  // fixed-size grid cell.
  assert.ok(
    src.includes('videoContentFit="cover"'),
    "grid cover must use videoContentFit=\"cover\" (crop-fill the fixed cell)",
  );
}

runOrch0994VideoCoverAdversarial();

if (typeof describe === "function") {
  describe("ORCH-0994 adversarial: cover refactor preserves fallback + leaves no dead code", () => {
    it("forwards hue, removes dead helper/styles, keeps a single crop-fill cover path", () => {
      runOrch0994VideoCoverAdversarial();
    });
  });
}
