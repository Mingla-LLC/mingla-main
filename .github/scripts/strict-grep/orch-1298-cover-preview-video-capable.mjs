#!/usr/bin/env node
/**
 * ORCH-1298 [cover preview must be video-capable] — strict-grep gate (ORCH-1301
 * close-hardening): the brand-edit and trip-review/checkout cover previews MUST
 * render the cover through the shared, media-aware `EventCoverMedia`, NEVER
 * through a raw `Image`/`ExpoImage`/`RNImage` sourced from the cover URL.
 *
 * WHY: a VIDEO cover's `coverMediaUrl` is a Bunny …/play_720p.mp4. A raw
 * `<Image source={{ uri: <cover>MediaUrl }}>` cannot decode an mp4, so the
 * preview came up EMPTY/black after a successful video upload:
 *   - BrandEditView.tsx (ORCH-1298): `<ExpoImage source={{ uri: draft.coverMediaUrl }}>`
 *   - TripPreview.tsx / LegacyTripPreview (ORCH-1299): `<Image source={{ uri: trip.coverMediaUrl }}>`
 * The fix routes both through `EventCoverMedia` (image / gif / video / empty
 * hue fallback) — the same component every other authoring surface already uses.
 *
 * RULE (structural anti-recurrence) — for EACH target file, all must hold:
 *   A. `EventCoverMedia` is imported.
 *   B. a cover is bound to `EventCoverMedia` — a `mediaUrl={…coverMediaUrl…}`
 *      prop exists (only `EventCoverMedia` takes a `mediaUrl` prop; a raw Image
 *      takes `source`). Its absence means the cover no longer flows through the
 *      video-capable component.
 *   C. NO raw-image cover path — `source={{ uri: <…>coverMediaUrl }}` must NOT
 *      appear anywhere in the file. That JSX is an Image/ExpoImage/RNImage
 *      sourced straight from the cover URL, which black-screens a video cover.
 *
 * Scope note: TripPreview.tsx also renders a raw `<Image source={{ uri: m.url }}>`
 * for per-day GALLERY media — that is `m.url`, NOT a cover URL, so check C
 * (which matches only `…coverMediaUrl`) does not trip on it. Comment-stripped
 * first (the fix comments literally say "was a raw Image" and name coverMediaUrl
 * to explain the bug).
 *
 * Self-test: `node orch-1298-cover-preview-video-capable.mjs --self-test`
 * proves the gate PASSES on the fixed shape (EventCoverMedia + a permitted
 * gallery Image) and FAILS on (1) a raw Image cover with no EventCoverMedia,
 * (2) a re-introduced raw cover Image even when EventCoverMedia stays, and
 * (3) a missing EventCoverMedia import/binding.
 *
 * Exit: 0 = clean / self-test pass, 1 = violation.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// .github/scripts/strict-grep → up 3 = repo root (cwd-independent).
const REPO_ROOT = join(__dirname, "..", "..", "..");

const TARGETS = [
  "mingla-business/src/components/brand/BrandEditView.tsx",
  "mingla-business/src/components/trip/TripPreview.tsx",
];

/** Remove block comments + line comments (whole-line and trailing). The `[^:]`
 * guard before `//` preserves `https://` URLs inside string literals. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// A raw Image/ExpoImage/RNImage whose `source` is `{ uri: <word.>coverMediaUrl }`.
// The `[\w.]*` prefix accepts `trip.`/`draft.`/`brand.`/bare `coverMediaUrl`.
const RAW_COVER_IMAGE_SOURCE = /source=\{\{\s*uri:\s*[\w.]*coverMediaUrl\b/;
// A cover bound to EventCoverMedia (its `mediaUrl` prop — raw Image uses `source`).
const COVER_BOUND_TO_MEDIA = /mediaUrl=\{[\w.]*coverMediaUrl\b/;
const IMPORTS_EVENT_COVER_MEDIA =
  /import\s*\{[^}]*\bEventCoverMedia\b[^}]*\}\s*from\s*["'][^"']*EventCoverMedia["']/;

/** Scan one file's source. `label` is the file path for messages. */
function scan(src, label) {
  const failures = [];
  const s = stripComments(src);

  if (!IMPORTS_EVENT_COVER_MEDIA.test(s)) {
    failures.push(
      `${label} — A: does not import the video-capable EventCoverMedia. The ` +
        `cover preview must render through it so a video cover (Bunny mp4) ` +
        `displays (ORCH-1298/1299).`,
    );
  }

  if (!COVER_BOUND_TO_MEDIA.test(s)) {
    failures.push(
      `${label} — B: no cover is bound to EventCoverMedia (no ` +
        `\`mediaUrl={…coverMediaUrl}\` prop). The cover preview no longer flows ` +
        `through the media-aware component → a video cover renders empty ` +
        `(ORCH-1298/1299).`,
    );
  }

  if (RAW_COVER_IMAGE_SOURCE.test(s)) {
    failures.push(
      `${label} — C: the cover is rendered via a raw Image/ExpoImage/RNImage ` +
        `(\`source={{ uri: …coverMediaUrl }}\`). A raw Image cannot decode a ` +
        `video cover's …/play_720p.mp4 → black/empty preview. Render the cover ` +
        `through EventCoverMedia instead (ORCH-1298/1299).`,
    );
  }

  return failures;
}

// ---- npm wiring check: the gate must be wired into package.json so CI runs it.
function npmWiringFailures() {
  const failures = [];
  const pkgPath = join(REPO_ROOT, "mingla-business", "package.json");
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch (error) {
    failures.push(
      `ORCH-1298 wiring: cannot parse mingla-business/package.json: ${error.message}`,
    );
    return failures;
  }
  const script = pkg.scripts?.["test:orch-1298"];
  if (
    typeof script !== "string" ||
    !script.includes("orch-1298-cover-preview-video-capable.mjs")
  ) {
    failures.push(
      "ORCH-1298 wiring: mingla-business/package.json scripts[\"test:orch-1298\"] " +
        "must run `orch-1298-cover-preview-video-capable.mjs` (the gate) so CI " +
        "exercises this invariant.",
    );
  }
  return failures;
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const IMPORT = `import { EventCoverMedia } from "../ui/EventCoverMedia";`;
  const COVER = `<EventCoverMedia mediaUrl={trip.coverMediaUrl} mediaType={coverType} />`;
  // A permitted raw Image: per-day GALLERY media (m.url, NOT a cover URL).
  const GALLERY_IMAGE = `<Image source={{ uri: m.url }} resizeMode="cover" />`;
  const RAW_COVER = `<Image source={{ uri: trip.coverMediaUrl }} resizeMode="cover" />`;

  // GOOD — EventCoverMedia cover + a permitted gallery Image: PASS.
  const good = `${IMPORT}\nexport const T = () => (<View>\n  {/* fixed */}\n  ${COVER}\n  ${GALLERY_IMAGE}\n</View>);\n`;
  let f = scan(good, "GOOD");
  if (f.length !== 0) {
    console.error(
      "ORCH-1298 self-test FAIL: the fixed shape (EventCoverMedia cover + " +
        "gallery Image) reported failures:\n" + f.join("\n"),
    );
    process.exit(1);
  }

  // BAD 1 — raw Image cover, no EventCoverMedia at all: FAIL on A + B + C.
  const bad1 = `import { Image, View } from "react-native";\nexport const T = () => (<View>${RAW_COVER}</View>);\n`;
  f = scan(bad1, "BAD1");
  if (
    !f.some((m) => m.includes("— A:")) ||
    !f.some((m) => m.includes("— B:")) ||
    !f.some((m) => m.includes("— C:"))
  ) {
    console.error(
      "ORCH-1298 self-test FAIL: a raw-Image cover with no EventCoverMedia did " +
        "NOT trip A + B + C:\n" + f.join("\n"),
    );
    process.exit(1);
  }

  // BAD 2 — EventCoverMedia stays, but a raw cover Image is re-introduced
  // alongside it: FAIL on C (the sneaky partial-revert the impl test misses).
  const bad2 = `${IMPORT}\nexport const T = () => (<View>${COVER}${RAW_COVER}</View>);\n`;
  f = scan(bad2, "BAD2");
  if (!f.some((m) => m.includes("— C:")) || f.some((m) => m.includes("— A:")) || f.some((m) => m.includes("— B:"))) {
    console.error(
      "ORCH-1298 self-test FAIL: a re-introduced raw cover Image (with " +
        "EventCoverMedia still present) did NOT cleanly trip ONLY C:\n" +
        f.join("\n"),
    );
    process.exit(1);
  }

  // BAD 3 — a stripped-comment cannot mask a missing import/binding: FAIL A + B.
  const bad3 = `// EventCoverMedia mediaUrl={trip.coverMediaUrl} — comment only\nexport const T = () => (<View>${GALLERY_IMAGE}</View>);\n`;
  f = scan(bad3, "BAD3");
  if (!f.some((m) => m.includes("— A:")) || !f.some((m) => m.includes("— B:"))) {
    console.error(
      "ORCH-1298 self-test FAIL: a comment mentioning EventCoverMedia/coverMediaUrl " +
        "masked a missing import/binding (comment-stripping is broken):\n" +
        f.join("\n"),
    );
    process.exit(1);
  }

  console.log(
    "ORCH-1298 gate self-test PASS (4/4: fixed shape passes; raw-cover-no-media, " +
      "re-introduced raw cover, and comment-only each fail).",
  );
  process.exit(0);
}

// ---- Live mode
const failures = [];
for (const rel of TARGETS) {
  let src;
  try {
    src = readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch (err) {
    failures.push(`cannot read ${rel}: ${err.message}`);
    continue;
  }
  failures.push(...scan(src, rel));
}
failures.push(...npmWiringFailures());

if (failures.length > 0) {
  console.error(
    "ORCH-1298 gate FAIL — a cover preview no longer renders through the " +
      "video-capable EventCoverMedia:\n\n  - " +
      failures.join("\n  - ") +
      "\n\nA video cover's coverMediaUrl is a Bunny …/play_720p.mp4 that a raw " +
      "Image cannot decode. Render brand + trip cover previews through " +
      "EventCoverMedia. See ORCH-1298 / ORCH-1299.",
  );
  process.exit(1);
}

console.log(
  "ORCH-1298 gate PASS — BrandEditView + TripPreview render the cover through " +
    "EventCoverMedia (no raw Image on coverMediaUrl); video covers display.",
);
