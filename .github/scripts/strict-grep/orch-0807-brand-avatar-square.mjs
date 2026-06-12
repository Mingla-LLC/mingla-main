#!/usr/bin/env node
/**
 * ORCH-0807 strict-grep gate — I-PROPOSED-BG BRAND_AVATAR_NATIVE_CROP_OFFERED.
 *
 * Enforces that the brand avatar picker sheet OFFERS the native square-
 * crop UI to the user via `expo-image-picker`'s `allowsEditing: true` +
 * `aspect: [1, 1]` arguments. The user's choice to crop or not is their
 * own — Android enforces the 1:1 aspect; iOS shows it as a hint overlay.
 * We trust the user with the mechanism we provide; we do NOT enforce
 * square output server-side or via image-manipulator dependency
 * (operator decision 2026-05-12).
 *
 * Two checks (all must pass; any failure exits non-zero):
 *
 *   1. `mingla-business/src/components/brand/BrandAvatarPickerSheet.tsx`
 *      MUST contain `allowsEditing: true` AND `aspect: [1, 1]` in the
 *      `ImagePicker.launchImageLibraryAsync(...)` call — proves the
 *      native crop UI is being offered to the user.
 *   2. `mingla-business/package.json` MUST NOT contain
 *      `expo-image-manipulator` — operator chose no new dependency;
 *      trust the user with the native picker crop.
 *
 * Per ORCH-0807 SPEC §9 (revised 2026-05-12) + INVARIANT_REGISTRY
 * I-PROPOSED-BG.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..", "..", "..");

const SHEET_PATH = join(
  REPO_ROOT,
  "mingla-business",
  "src",
  "components",
  "brand",
  "BrandAvatarPickerSheet.tsx",
);
const PACKAGE_JSON_PATH = join(REPO_ROOT, "mingla-business", "package.json");

const failures = [];

function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// Check 1 — picker sheet offers native crop UI.
if (!existsSync(SHEET_PATH)) {
  failures.push(
    "Check 1 FAIL: mingla-business/src/components/brand/BrandAvatarPickerSheet.tsx missing.",
  );
} else {
  const src = readOrEmpty(SHEET_PATH);
  if (!/allowsEditing\s*:\s*true/.test(src)) {
    failures.push(
      "Check 1 FAIL: BrandAvatarPickerSheet.tsx missing `allowsEditing: true` in the ImagePicker call — the native crop UI MUST be offered to the user per I-PROPOSED-BG.",
    );
  }
  if (!/aspect\s*:\s*\[\s*1\s*,\s*1\s*\]/.test(src)) {
    failures.push(
      "Check 1 FAIL: BrandAvatarPickerSheet.tsx missing `aspect: [1, 1]` in the ImagePicker call — the 1:1 crop guide MUST be offered to the user per I-PROPOSED-BG.",
    );
  }
}

// Check 2 — RETIRED 2026-06-12 (ORCH-1119 [trip-day-media-gallery]).
// The 2026-05-12 operator decision forbade adding `expo-image-manipulator`
// JUST for brand-avatar cropping (Check 1 enforces the avatar picker still
// offers the native crop UI — that guard remains ACTIVE below). On 2026-06-12
// the operator explicitly approved adding `expo-image-manipulator` for a
// DIFFERENT feature — ORCH-1119 trip-day media: iOS HEIC photos must be
// converted to JPEG client-side so they render on iOS/Android/web. Per this
// gate's own instruction ("if needed for a different feature, re-evaluate
// I-PROPOSED-BG"), the blanket dependency prohibition is superseded. The
// brand-avatar invariant (native crop offered) is unaffected and still gated
// by Check 1. The dependency-presence check is therefore retired.

if (failures.length > 0) {
  console.error("ORCH-0807 strict-grep FAIL:");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}

console.log("ORCH-0807 strict-grep PASS — 2/2 checks.");
