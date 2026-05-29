#!/usr/bin/env node
/**
 * ORCH-0805 strict-grep gate — I-PROPOSED-BE BRAND_COVER_MEDIA_HONORED.
 *
 * Enforces that the brand cover overhaul stays intact:
 *   - Storage bucket migration exists with public read + admin write policies.
 *   - Rules + service + provider services + hook + picker sheet all present.
 *   - BrandEditView no longer renders the 6-swatch hue picker.
 *   - Shared brand page renders covers via EventCoverMedia (ORCH-0964).
 *
 * Nine pattern checks (all must pass; any failure exits non-zero).
 * SPEC §11 originally enumerated 10 checks; Check 8 ("Photo upload lands in
 * a later cycle." negative grep) was dropped during implementation because
 * SPEC §15 explicitly defers the brand-avatar pencil fix to ORCH-0805-A.
 * Removing the avatar-deferral toast would have broken §15.
 *
 * Codified by ORCH-0805 SPEC §10 + §11.
 *
 * ORCH-0989 amendment: Check 6 + Check 8 repointed (NOT deleted) after the
 * brand cover picker was unified into the shared CoverPickerSheet/CoverPicker.
 * Check 6 now asserts coverProviderBrowseService (trending/curated) exists +
 * the two retired brand provider services are gone. Check 8 now asserts
 * CoverPickerSheet hosts <Sheet>+<CoverPicker> + the LOCKED tab ids
 * (library/gif/stock) + BrandCoverPickerSheet is gone. Per SPEC_ORCH-0989 §9.1.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const RULES_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "utils",
  "brandCoverRules.ts",
);
const SERVICE_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "services",
  "brandCoverService.ts",
);
// ORCH-0989 — the two brand provider services were retired and unified into
// coverProviderBrowseService.ts (trending/curated browse). Check 6 repoints
// here (provider browse stays gated) instead of asserting the deleted files.
const BROWSE_SERVICE_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "services",
  "coverProviderBrowseService.ts",
);
// ORCH-0989 — BrandCoverPickerSheet retired; the unified surface is
// CoverPickerSheet (Sheet host) + CoverPicker (3-tab gallery-first body).
const SHEET_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "components",
  "ui",
  "CoverPickerSheet.tsx",
);
const PICKER_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "components",
  "ui",
  "CoverPicker.tsx",
);
const EDIT_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "components",
  "brand",
  "BrandEditView.tsx",
);
// ORCH-0964 — cover rendering moved out of the mingla-business wrapper into the
// shared @mingla/event-rendering EventCoverMedia, mounted by the shared brand
// page. Check 9 now targets the shared page (single source of truth) so the gate
// reflects reality instead of failing on the stale wrapper path.
const PUBLIC_PATH = join(
  REPO_ROOT,
  "packages",
  "brand-rendering",
  "PublicBrandPage.tsx",
);

const failures = [];

function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// Check 1 — migration file present.
let migrationPath = "";
try {
  const entries = readdirSync(MIGRATIONS_DIR);
  const match = entries.find(
    (n) => /orch_0805.*brand_covers_storage\.sql$/.test(n),
  );
  if (match) {
    migrationPath = join(MIGRATIONS_DIR, match);
  } else {
    failures.push(
      "Check 1 FAIL: no migration file matching '*orch_0805*brand_covers_storage.sql' under supabase/migrations/",
    );
  }
} catch (err) {
  failures.push(`Check 1 FAIL: cannot read supabase/migrations/: ${err.message}`);
}

const migrationSrc = migrationPath ? readOrEmpty(migrationPath) : "";

// Check 2 — migration declares the bucket.
if (migrationSrc && !/INTO storage\.buckets[\s\S]+'brand_covers'/.test(migrationSrc)) {
  failures.push(
    "Check 2 FAIL: migration does not INSERT INTO storage.buckets for 'brand_covers'",
  );
}

// Check 3 — migration declares all 3 admin write policies.
const requiredPolicies = [
  "brand_covers_admin_write",
  "brand_covers_admin_update",
  "brand_covers_admin_delete",
];
for (const policyName of requiredPolicies) {
  if (migrationSrc && !migrationSrc.includes(policyName)) {
    failures.push(`Check 3 FAIL: migration missing policy '${policyName}'`);
  }
}

// Check 4 — rules module exports required symbols.
if (!existsSync(RULES_PATH)) {
  failures.push("Check 4 FAIL: brandCoverRules.ts missing");
} else {
  const src = readOrEmpty(RULES_PATH);
  const required = [
    "BrandCoverError",
    "BRAND_COVER_MAX_BYTES",
    "resolveBrandCoverContentType",
    "brandCoverStoragePath",
    "validateBrandCoverProviderUrl",
  ];
  for (const sym of required) {
    if (!new RegExp(`export\\s+(?:const|class|function|type)\\s+${sym}\\b`).test(src)) {
      failures.push(`Check 4 FAIL: brandCoverRules.ts must export ${sym}`);
    }
  }
}

// Check 5 — service module exports uploadBrandCover + BRAND_COVERS_BUCKET = "brand_covers".
if (!existsSync(SERVICE_PATH)) {
  failures.push("Check 5 FAIL: brandCoverService.ts missing");
} else {
  const src = readOrEmpty(SERVICE_PATH);
  if (!/export\s+const\s+uploadBrandCover\b/.test(src)) {
    failures.push("Check 5 FAIL: brandCoverService.ts must export uploadBrandCover");
  }
  if (!/BRAND_COVERS_BUCKET\s*=\s*"brand_covers"/.test(src)) {
    failures.push(
      "Check 5 FAIL: brandCoverService.ts must declare BRAND_COVERS_BUCKET = \"brand_covers\"",
    );
  }
}

// Check 6 (ORCH-0989 repoint) — the unified provider browse service exists and
// exports trending/curated. The retired brand provider duplicates must NOT
// reappear (subtract-before-add).
if (!existsSync(BROWSE_SERVICE_PATH)) {
  failures.push("Check 6 FAIL: coverProviderBrowseService.ts missing (ORCH-0989 unified browse)");
} else {
  const browseSrc = readOrEmpty(BROWSE_SERVICE_PATH);
  for (const sym of ["trendingGiphyCovers", "curatedPexelsCovers"]) {
    if (!new RegExp(`export\\s+const\\s+${sym}\\b`).test(browseSrc)) {
      failures.push(`Check 6 FAIL: coverProviderBrowseService.ts must export ${sym}`);
    }
  }
}
for (const retired of ["pexelsBrandCoverService.ts", "giphyBrandCoverService.ts"]) {
  if (existsSync(join(REPO_ROOT, "mingla-business", "src", "services", retired))) {
    failures.push(`Check 6 FAIL: ${retired} must be DELETED (ORCH-0989 unification)`);
  }
}

// Check 7 — BrandEditView.tsx does NOT contain COVER_HUE_TILES literal (the
// const declaration was removed; only an explanatory replacement comment
// references the name). The check fails on the const definition specifically.
const editSrc = readOrEmpty(EDIT_PATH);
if (/^\s*const\s+COVER_HUE_TILES\b/m.test(editSrc)) {
  failures.push(
    "Check 7 FAIL: BrandEditView.tsx still declares COVER_HUE_TILES const — must be removed (ORCH-0805 §8.2)",
  );
}

// Check 8 (NOTE: SPEC originally had a separate negative grep here for the
// "Photo upload lands in a later cycle." string. Dropped per §15 — the
// brand-avatar pencil deferral toast must stay until ORCH-0805-A ships.)

// Check 8 (ORCH-0989 repoint) — the unified CoverPickerSheet exists and hosts
// CoverPicker, which carries the LOCKED tab ids (library/gif/stock). We assert
// the tab ID literals (LOCKED in SPEC §4.3), NOT the display labels (designer-
// owned copy). BrandCoverPickerSheet must NOT reappear.
if (!existsSync(SHEET_PATH)) {
  failures.push("Check 8 FAIL: CoverPickerSheet.tsx missing (ORCH-0989 unified sheet)");
} else {
  const sheetSrc = readOrEmpty(SHEET_PATH);
  if (!/<Sheet\b/.test(sheetSrc) || !/<CoverPicker\b/.test(sheetSrc)) {
    failures.push("Check 8 FAIL: CoverPickerSheet.tsx must host <Sheet> + <CoverPicker>");
  }
}
if (!existsSync(PICKER_PATH)) {
  failures.push("Check 8 FAIL: CoverPicker.tsx missing");
} else {
  const pickerSrc = readOrEmpty(PICKER_PATH);
  for (const id of ['"library"', '"gif"', '"stock"']) {
    if (!pickerSrc.includes(id)) {
      failures.push(`Check 8 FAIL: CoverPicker.tsx must contain the LOCKED tab id ${id}`);
    }
  }
}
if (
  existsSync(
    join(REPO_ROOT, "mingla-business", "src", "components", "brand", "BrandCoverPickerSheet.tsx"),
  )
) {
  failures.push("Check 8 FAIL: BrandCoverPickerSheet.tsx must be DELETED (ORCH-0989 unification)");
}

// Check 9 (ORCH-0964) — shared brand page renders covers via EventCoverMedia
// (image + GIF + video; expo-image / expo-video under the hood) AND references
// coverMediaUrl on the hero.
const publicSrc = readOrEmpty(PUBLIC_PATH);
if (!/EventCoverMedia/.test(publicSrc)) {
  failures.push(
    "Check 9 FAIL: packages/brand-rendering/PublicBrandPage.tsx must render covers via EventCoverMedia (ORCH-0964)",
  );
}
if (!/coverMediaUrl/.test(publicSrc)) {
  failures.push(
    "Check 9 FAIL: packages/brand-rendering/PublicBrandPage.tsx must reference coverMediaUrl on the hero (ORCH-0805 §8.3 / ORCH-0964)",
  );
}

if (failures.length > 0) {
  console.error("ORCH-0805 strict-grep FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0805 strict-grep PASS — 9/9 checks.");
