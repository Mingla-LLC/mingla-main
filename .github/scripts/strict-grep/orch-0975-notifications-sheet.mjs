#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Strict-grep gate - ORCH-0975 [Consumer notifications sheet redesign].
 *
 * C1: NotificationsSheet must be a bottom-sheet (not React Native Modal).
 *     META-ORCH-0991 Wave A repoint [TEST-MOD-APPROVED META-ORCH-0991]:
 *     NotificationsSheet now consumes the shared BaseBottomSheet primitive
 *     (scrollMode="sectionlist") instead of importing @gorhom/bottom-sheet
 *     directly — the gorhom import + BottomSheetSectionList moved into
 *     BaseBottomSheet.tsx (sole permitted gorhom consumer per
 *     I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER). C1 now asserts:
 *       (a) NotificationsSheet.tsx does NOT import RN Modal,
 *       (b) NotificationsSheet.tsx imports BaseBottomSheet + passes
 *           scrollMode="sectionlist",
 *       (c) BaseBottomSheet.tsx imports @gorhom/bottom-sheet + references
 *           BottomSheetSectionList.
 * C2: notifications.json must not contain the removed filters namespace.
 * C3: notifications.json must contain categoryLabels for per-card pills.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

let failures = 0;

function fail(check, message) {
  failures += 1;
  console.error(`FAIL [${check}] ${message}`);
}

function ok(check, message) {
  console.log(`OK   [${check}] ${message}`);
}

function readRequired(relativePath) {
  const absolutePath = path.join(REPO_ROOT, relativePath);
  try {
    return fs.readFileSync(absolutePath, "utf8");
  } catch (error) {
    fail("FATAL", `Could not read ${relativePath}: ${error.message}`);
    return null;
  }
}

const sheetPath = "app-mobile/src/components/NotificationsSheet.tsx";
const sheetSource = readRequired(sheetPath);
const basePath = "app-mobile/src/components/ui/BaseBottomSheet.tsx";
const baseSource = readRequired(basePath);

if (sheetSource !== null && baseSource !== null) {
  const reactNativeImports = [...sheetSource.matchAll(
    /import\s+\{([\s\S]*?)\}\s+from\s+['"]react-native['"]/g,
  )];
  const importsRnModal = reactNativeImports.some((match) =>
    /\bModal\b/.test(match[1] ?? ""),
  ) || /<Modal\b/.test(sheetSource);

  // META-ORCH-0991 Wave A: gorhom now lives in BaseBottomSheet. Match the
  // BaseBottomSheet IMPORT STATEMENT (not a comment mention) in NotificationsSheet.
  const importsBaseBottomSheet =
    /import\s+\{[^}]*\bBaseBottomSheet\b[^}]*\}\s+from\s+['"][^'"]*BaseBottomSheet['"]/.test(
      sheetSource,
    );
  const passesSectionlist = /scrollMode=["']sectionlist["']/.test(sheetSource);

  if (importsRnModal) {
    fail(
      "C1: no-RN-Modal",
      "NotificationsSheet.tsx imports RN Modal - must consume BaseBottomSheet instead per ORCH-0975 + META-ORCH-0991 invariant.",
    );
  } else if (!importsBaseBottomSheet) {
    fail(
      "C1: no-RN-Modal",
      "NotificationsSheet.tsx must import BaseBottomSheet per META-ORCH-0991 (sole gorhom consumer).",
    );
  } else if (!passesSectionlist) {
    fail(
      "C1: no-RN-Modal",
      'NotificationsSheet.tsx must pass scrollMode="sectionlist" to BaseBottomSheet for date-grouped list parity.',
    );
  } else if (!/from\s+['"]@gorhom\/bottom-sheet['"]/.test(baseSource)) {
    fail(
      "C1: no-RN-Modal",
      "BaseBottomSheet.tsx must import from @gorhom/bottom-sheet (the sole permitted gorhom consumer).",
    );
  } else if (!/\bBottomSheetSectionList\b/.test(baseSource)) {
    fail(
      "C1: no-RN-Modal",
      "BaseBottomSheet.tsx must reference BottomSheetSectionList for sectionlist scrollMode parity.",
    );
  } else {
    ok(
      "C1: no-RN-Modal",
      'NotificationsSheet consumes BaseBottomSheet (scrollMode="sectionlist"); gorhom + BottomSheetSectionList live in BaseBottomSheet.tsx',
    );
  }
}

const localeFiles = [];
const localesRoot = path.join(REPO_ROOT, "app-mobile", "src", "i18n", "locales");
for (const lang of fs.readdirSync(localesRoot).sort()) {
  const candidate = path.join(localesRoot, lang, "notifications.json");
  if (fs.existsSync(candidate)) localeFiles.push(candidate);
}

for (const localeFile of localeFiles) {
  const rel = path.relative(REPO_ROOT, localeFile);
  const localeJson = JSON.parse(fs.readFileSync(localeFile, "utf8"));

  if (localeJson.filters !== undefined) {
    fail(
      "C2: no-filters-locale",
      `${rel} must not contain a "filters" namespace per ORCH-0975.`,
    );
  }

  const labels = localeJson.categoryLabels;
  const hasAllLabels =
    labels !== undefined &&
    labels.social !== undefined &&
    labels.sessions !== undefined &&
    labels.messages !== undefined &&
    labels.all !== undefined;

  if (!hasAllLabels) {
    fail(
      "C3: categoryLabels-exists",
      `${rel} must contain categoryLabels.social/sessions/messages/all per ORCH-0975.`,
    );
  }
}

if (!failures) {
  ok("C2: no-filters-locale", `filters namespace absent from ${localeFiles.length} notification locale files`);
  ok("C3: categoryLabels-exists", `categoryLabels namespace present in ${localeFiles.length} notification locale files`);
}

if (failures > 0) {
  console.error(`\nORCH-0975 strict-grep failed with ${failures} failure(s).`);
  process.exit(1);
}

console.log("\nORCH-0975 strict-grep passed.");
