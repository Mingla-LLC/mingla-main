#!/usr/bin/env node
/**
 * ORCH-0805 strict-grep gate — I-PROPOSED-BE BRAND_COVER_MEDIA_HONORED.
 *
 * Enforces that the brand cover overhaul stays intact:
 *   - Storage bucket migration exists with public read + admin write policies.
 *   - Rules + service + provider services + hook + picker sheet all present.
 *   - BrandEditView no longer renders the 6-swatch hue picker.
 *   - PublicBrandPage hero uses expo-image when cover_media_url is set.
 *
 * Nine pattern checks (all must pass; any failure exits non-zero).
 * SPEC §11 originally enumerated 10 checks; Check 8 ("Photo upload lands in
 * a later cycle." negative grep) was dropped during implementation because
 * SPEC §15 explicitly defers the brand-avatar pencil fix to ORCH-0805-A.
 * Removing the avatar-deferral toast would have broken §15.
 *
 * Codified by ORCH-0805 SPEC §10 + §11.
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
const PEXELS_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "services",
  "pexelsBrandCoverService.ts",
);
const GIPHY_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "services",
  "giphyBrandCoverService.ts",
);
const SHEET_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "components",
  "brand",
  "BrandCoverPickerSheet.tsx",
);
const EDIT_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "components",
  "brand",
  "BrandEditView.tsx",
);
const PUBLIC_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "components",
  "brand",
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

// Check 6 — provider services exist.
if (!existsSync(PEXELS_PATH)) {
  failures.push("Check 6 FAIL: pexelsBrandCoverService.ts missing");
}
if (!existsSync(GIPHY_PATH)) {
  failures.push("Check 6 FAIL: giphyBrandCoverService.ts missing");
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

// Check 8 (renumbered) — picker sheet present and references all 3 tab labels.
if (!existsSync(SHEET_PATH)) {
  failures.push("Check 8 FAIL: BrandCoverPickerSheet.tsx missing");
} else {
  const src = readOrEmpty(SHEET_PATH);
  for (const label of ["Upload", "Pexels", "GIPHY"]) {
    if (!src.includes(label)) {
      failures.push(
        `Check 8 FAIL: BrandCoverPickerSheet.tsx must contain the tab label '${label}'`,
      );
    }
  }
}

// Check 9 — PublicBrandPage.tsx imports expo-image AND references coverMediaUrl.
const publicSrc = readOrEmpty(PUBLIC_PATH);
if (!/from\s+["']expo-image["']/.test(publicSrc)) {
  failures.push("Check 9 FAIL: PublicBrandPage.tsx must import from 'expo-image'");
}
if (!/coverMediaUrl/.test(publicSrc)) {
  failures.push(
    "Check 9 FAIL: PublicBrandPage.tsx must reference brand.coverMediaUrl on the hero (ORCH-0805 §8.3)",
  );
}

if (failures.length > 0) {
  console.error("ORCH-0805 strict-grep FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0805 strict-grep PASS — 9/9 checks.");
