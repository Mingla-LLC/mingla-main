#!/usr/bin/env node
/**
 * ORCH-0989 strict-grep gate — Unified cover picker sheet.
 *
 * Establishes the four NEW invariants (SPEC §11.2):
 *   - I-PROPOSED-UNIFIED-COVER-PICKER-SINGLE-SHEET
 *   - I-PROPOSED-COVER-PICKER-GALLERY-FIRST
 *   - I-PROPOSED-BRAND-COVER-VIDEO-VIA-SHARED-PIPELINE
 *   - (honors) I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED / Architecture-B no-`so_`.
 *
 * Seven assertions (SPEC §9.5). Any failure exits non-zero.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const failures = [];
const read = (rel) => {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch {
    return "";
  }
};
const exists = (rel) => existsSync(join(REPO_ROOT, rel));

// --- Assertion 1: CoverPickerSheet exists + renders <Sheet> + <CoverPicker> --
const SHEET = "mingla-business/src/components/ui/CoverPickerSheet.tsx";
if (!exists(SHEET)) {
  failures.push("A1 FAIL: CoverPickerSheet.tsx missing");
} else {
  const src = read(SHEET);
  if (!/<Sheet\b/.test(src) || !/<CoverPicker\b/.test(src)) {
    failures.push("A1 FAIL: CoverPickerSheet.tsx must render <Sheet> hosting <CoverPicker>");
  }
}

// --- Assertion 2: CoverPicker has the LOCKED tab ids library/gif/stock -------
const PICKER = "mingla-business/src/components/ui/CoverPicker.tsx";
if (!exists(PICKER)) {
  failures.push("A2 FAIL: CoverPicker.tsx missing");
} else {
  const src = read(PICKER);
  for (const id of ['"library"', '"gif"', '"stock"']) {
    if (!src.includes(id)) {
      failures.push(`A2 FAIL: CoverPicker.tsx must contain the LOCKED tab id ${id}`);
    }
  }
}

// --- Assertion 3: browse service — trending/curated, endpoints, no PEXELS key -
const BROWSE = "mingla-business/src/services/coverProviderBrowseService.ts";
if (!exists(BROWSE)) {
  failures.push("A3 FAIL: coverProviderBrowseService.ts missing");
} else {
  const src = read(BROWSE);
  for (const sym of ["trendingGiphyCovers", "curatedPexelsCovers"]) {
    if (!new RegExp(`export\\s+const\\s+${sym}\\b`).test(src)) {
      failures.push(`A3 FAIL: coverProviderBrowseService must export ${sym}`);
    }
  }
  if (!src.includes("https://api.giphy.com/v1/gifs/trending")) {
    failures.push("A3 FAIL: GIPHY trending must hit the direct client endpoint");
  }
  if (!src.includes("event-cover-pexels-curated")) {
    failures.push("A3 FAIL: Pexels curated must call event-cover-pexels-curated edge fn");
  }
  if (src.includes("PEXELS_API_KEY")) {
    failures.push("A3 FAIL: PEXELS_API_KEY must never be read client-side");
  }
}

// --- Assertion 4: curated edge fn — server key, /curated, no orientation -----
const CURATED = "supabase/functions/event-cover-pexels-curated/index.ts";
if (!exists(CURATED)) {
  failures.push("A4 FAIL: event-cover-pexels-curated/index.ts missing");
} else {
  const src = read(CURATED);
  if (!src.includes('Deno.env.get("PEXELS_API_KEY")')) {
    failures.push("A4 FAIL: curated edge fn must read PEXELS_API_KEY server-side");
  }
  if (!src.includes("https://api.pexels.com/v1/curated")) {
    failures.push("A4 FAIL: curated edge fn must hit https://api.pexels.com/v1/curated");
  }
  // /curated does NOT accept orientation — must not send it in the upstream params.
  if (/orientation/i.test(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""))) {
    failures.push("A4 FAIL: curated edge fn must NOT send orientation (curated has no such param)");
  }
}

// --- Assertion 5: retirement — three deleted files must not exist ------------
const RETIRED = [
  "mingla-business/src/components/brand/BrandCoverPickerSheet.tsx",
  "mingla-business/src/services/giphyBrandCoverService.ts",
  "mingla-business/src/services/pexelsBrandCoverService.ts",
];
for (const rel of RETIRED) {
  if (exists(rel)) {
    failures.push(`A5 FAIL: ${rel} must be DELETED (ORCH-0989 unification)`);
  }
}

// --- Assertion 6: brand-video migration + apply writes brands ---------------
let migrationFound = false;
let deterministicMigration = "";
try {
  const entries = readdirSync(join(REPO_ROOT, "supabase", "migrations"));
  migrationFound = entries.some((n) => /orch_0989.*brand_cover_video_target\.sql$/.test(n));
  const deterministicName = entries.find((n) => /issue_2715_deterministic_cover_video_jobs\.sql$/.test(n));
  if (deterministicName) deterministicMigration = read(`supabase/migrations/${deterministicName}`);
} catch {
  // fall through to failure below
}
if (!migrationFound) {
  failures.push("A6 FAIL: missing migration *orch_0989*brand_cover_video_target.sql");
}
const APPLY = "supabase/functions/event-cover-video-apply/index.ts";
const applySrc = read(APPLY);
if (!applySrc.includes("cover_video_apply_once")) {
  failures.push("A6 FAIL: event-cover-video-apply must delegate exact-once application to cover_video_apply_once");
}
if (!/UPDATE public\.brands SET[\s\S]*?cover_media_url/.test(deterministicMigration)) {
  failures.push("A6 FAIL: cover_video_apply_once migration must atomically update brand cover_media_url");
}

// --- Assertion 7: Architecture-B negative — no `so_` in any video edge fn ----
const VIDEO_FNS = [
  "supabase/functions/event-cover-video-upload-intent/index.ts",
  "supabase/functions/event-cover-video-source-uploaded/index.ts",
  "supabase/functions/event-cover-video-status/index.ts",
  "supabase/functions/event-cover-video-apply/index.ts",
  "supabase/functions/event-cover-video-cancel/index.ts",
  "supabase/functions/event-cover-video-webhook/index.ts",
  "supabase/functions/_shared/eventCoverVideo.ts",
];
for (const rel of VIDEO_FNS) {
  const src = read(rel);
  // `so_` is the Cloudinary start-offset (Architecture A). Architecture B uses
  // integer du_ with NO so_. Match the eager-token shape `so_` only.
  if (/\bso_\d|"so_|`so_|,so_/.test(src)) {
    failures.push(`A7 FAIL: ${rel} contains a Cloudinary so_ start-offset (Architecture-B forbids it)`);
  }
}

if (failures.length > 0) {
  console.error("ORCH-0989 strict-grep FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0989 strict-grep PASS — 7/7 assertions.");
