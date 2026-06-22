#!/usr/bin/env node
/**
 * ORCH-1208 [cover-video bandwidth fix — Phase 1].
 *
 * Invariant I-PROPOSED-1208-NO-EAGER-VIDEO-PRELOAD (DRAFT): the shared web cover
 * `<video>` (the imperative element in EventCoverWebVideo) MUST set
 * `video.preload = "none"` and MUST NEVER set `preload = "auto"`, so a bot / SSR
 * / link-unfurler / desktop-WebKit (which shows a play button and never
 * auto-plays) does not eagerly download the whole .mp4. The cover renderer MUST
 * always be able to supply a poster for a video cover (the `video.poster`
 * assignment + the `deriveCoverPosterUrl` so_0 derivation exist and are wired).
 * The native CuratedExperienceSwipeCard cover MUST be gated by
 * `playbackActive={isTopCard}` (no bare always-on `autoplay` without a sibling
 * playbackActive gate), so an off-front / behind card never streams.
 *
 * Scope (LIVE code only — comments are stripped before scanning):
 *   - packages/offering-rendering/EventCoverMedia.tsx (web <video> path)
 *   - packages/offering-rendering/coverMediaPresentation.ts (poster derivation)
 *   - app-mobile/src/components/CuratedExperienceSwipeCard.tsx (native gate)
 *
 * Supports `--self-test` (asserts the gate trips on a synthetic violation) per
 * the established gate convention.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const COVER = "packages/offering-rendering/EventCoverMedia.tsx";
const PRESENTATION = "packages/offering-rendering/coverMediaPresentation.ts";
const CARD = "app-mobile/src/components/CuratedExperienceSwipeCard.tsx";

// Strip comments so an explanatory note never trips the gate — only LIVE code.
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

// Slice the EventCoverWebVideo region (the imperative web <video>) out of the
// shared cover module so the assertions target the WEB path specifically.
const sliceWeb = (src) => {
  const open = src.indexOf("const EventCoverWebVideo");
  const close = src.indexOf("const EventCoverNativeVideo", open + 1);
  if (open < 0 || close < 0) return null;
  return src.slice(open, close);
};

// scan(cover, presentation, card) → string[] of human-readable violations.
const scan = ({ cover, presentation, card }) => {
  const hits = [];

  const web = cover === null ? null : sliceWeb(cover);
  if (cover !== null) {
    if (web === null) {
      hits.push(
        `${COVER}: could not locate the EventCoverWebVideo web <video> region.`,
      );
    } else {
      // (1) preload="none" present.
      if (!/video\.preload\s*=\s*["']none["']/.test(web)) {
        hits.push(
          `${COVER}: web cover <video> must set video.preload = "none" (eager-fetch bandwidth fix).`,
        );
      }
      // (2) preload="auto" ABSENT (the eager-download regression).
      if (/preload\s*=\s*["']auto["']/.test(web)) {
        hits.push(
          `${COVER}: web cover <video> sets preload = "auto" — this eagerly downloads the whole .mp4 for bots/SSR/desktop-WebKit. Forbidden.`,
        );
      }
      // (3) the poster is wired on the imperative element.
      if (!/video\.poster\s*=/.test(web)) {
        hits.push(
          `${COVER}: web cover <video> must set video.poster = posterUrl so a non-playing context shows the still, not a downloaded video.`,
        );
      }
    }
  }

  // (4) the derivation helper exists + emits the so_0 first-frame .jpg.
  if (presentation !== null) {
    if (!/export const deriveCoverPosterUrl/.test(presentation)) {
      hits.push(
        `${PRESENTATION}: deriveCoverPosterUrl must be exported (the zero-dependency Cloudinary poster derivation).`,
      );
    }
    if (!/so_0/.test(presentation)) {
      hits.push(
        `${PRESENTATION}: deriveCoverPosterUrl must emit the Cloudinary so_0 (start-offset 0s) first-frame transform.`,
      );
    }
  }

  // (5) the native experience card gates streaming on isTopCard via playbackActive.
  if (card !== null) {
    if (!/playbackActive=\{isTopCard\}/.test(card)) {
      hits.push(
        `${CARD}: the cover EventCoverMedia must pass playbackActive={isTopCard} so an off-front/behind card never streams.`,
      );
    }
    // A bare `autoplay\n muted\n loop` with NO playbackActive sibling is the
    // pre-ORCH-1208 always-stream regression. Detect the bare `autoplay` token
    // (not `autoplay={isTopCard}`) inside the EventCoverMedia cover usage.
    if (/\bautoplay\s*\n\s*muted\s*\n\s*loop\b/.test(card)) {
      hits.push(
        `${CARD}: bare always-on "autoplay muted loop" on the cover without a playbackActive gate — re-introduces off-screen streaming. Use autoplay={isTopCard} playbackActive={isTopCard}.`,
      );
    }
  }

  return hits;
};

// --- self-test: prove the gate actually trips on a violation. ---
if (process.argv.includes("--self-test")) {
  const violations = scan({
    cover:
      'const EventCoverWebVideo = () => {\n  video.preload = "auto";\n};\nconst EventCoverNativeVideo = () => {};',
    presentation: "export const somethingElse = 1;",
    card: "<EventCoverMedia\n  autoplay\n  muted\n  loop\n/>",
  });
  // Expect at minimum: preload="none" missing, preload="auto" present,
  // poster missing, deriveCoverPosterUrl missing, so_0 missing,
  // playbackActive missing, bare autoplay-muted-loop present → >= 6.
  if (violations.length < 6) {
    console.error(
      "ORCH-1208 no-eager-video-preload gate SELF-TEST FAILED: gate did not detect the synthetic violations.",
      violations,
    );
    process.exit(1);
  }
  console.log(
    "ORCH-1208 no-eager-video-preload gate self-test passed (synthetic violations detected).",
  );
  process.exit(0);
}

const readOrNull = (rel) => {
  const path = join(root, rel);
  return existsSync(path) ? stripComments(readFileSync(path, "utf8")) : null;
};

const failures = scan({
  cover: readOrNull(COVER),
  presentation: readOrNull(PRESENTATION),
  card: readOrNull(CARD),
});

if (failures.length > 0) {
  console.error("ORCH-1208 I-PROPOSED-1208-NO-EAGER-VIDEO-PRELOAD gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("ORCH-1208 I-PROPOSED-1208-NO-EAGER-VIDEO-PRELOAD gate passed.");
