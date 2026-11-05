#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1049 [collab Matches sheet bottom bleed] structural regression.
 *
 * Bug: the collab "Matches" sheet (SavedToSessionCardsSheet) renders
 * CompactCollabBottomSheet in scrollMode="view". The BaseBottomSheet primitive
 * only injects its bottom safe-area inset on scroll/list/sticky-footer bodies —
 * NOT on view-mode bodies (consumer-composed). So the SwipeableSessionCards deck
 * (flex:1, alignItems:"stretch") stretched its cards to the very bottom of the
 * sheet, bleeding under the iOS home indicator / Android nav-gesture area at the
 * taller snap point.
 *
 * Fix: SavedToSessionCardsSheet reserves the bottom safe-area inset on the
 * savedCardsBody container so the inset REDUCES the deck's effective height
 * (paddingBottom on the flex parent), keeping cards flush ABOVE the safe area at
 * both snap points on iOS + Android. Policy mirrors the primitive:
 * Math.max(insets.bottom, 16).
 *
 * This check locks that the inset is read from useSafeAreaInsets and applied as
 * paddingBottom on the matched-cards container inside the Matches sheet.
 */

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

// [TEST-MOD-APPROVED #4261] the chat's Matches sheet is now PlanMatchesSheet
// (SavedToSessionCardsSheet was removed). The same rule holds there: its
// view-mode body reserves the bottom safe-area inset (floor 16) so the cards
// sit above the home indicator / nav area at both snap points.
const source = read("app-mobile/src/components/chat/PlanMatchesSheet.tsx");

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const sheetStart = source.indexOf("export function PlanMatchesSheet");
assert.ok(sheetStart >= 0, "PlanMatchesSheet must exist in PlanMatchesSheet.tsx");
const sheetEnd = source.indexOf("const styles = StyleSheet.create", sheetStart);
const sheetBody = sheetEnd > sheetStart ? source.slice(sheetStart, sheetEnd) : source.slice(sheetStart);

check(
  "G-00 PlanMatchesSheet is the Matches sheet (view-mode body)",
  /t\("chat:matches_title"\)/.test(sheetBody) && /scrollMode="view"/.test(sheetBody),
  "PlanMatchesSheet must be the Matches sheet with a view-mode body.",
);

check(
  "G-01 useSafeAreaInsets imported",
  /import\s*\{[^}]*useSafeAreaInsets[^}]*\}\s*from\s*["']react-native-safe-area-context["']/.test(source),
  "PlanMatchesSheet.tsx must import useSafeAreaInsets from react-native-safe-area-context.",
);

check(
  "G-02/G-03 the sheet body reserves Math.max(insets.bottom, 16) as paddingBottom",
  /const\s+insets\s*=\s*useSafeAreaInsets\(\)/.test(sheetBody) &&
    /style=\{\[\s*styles\.sheetBody\s*,\s*\{\s*paddingBottom:\s*Math\.max\(\s*insets\.bottom\s*,\s*16\s*\)\s*\}\s*\]\}/.test(sheetBody),
  "The Matches body must reserve the bottom safe-area inset as paddingBottom so cards sit ABOVE the safe area.",
);

// ----------------------------------------------------------------------------

const failures = checks.filter((c) => !c.pass);
for (const c of checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"} [${c.name}]`);
  if (!c.pass) console.log(`     ${c.detail}`);
}

if (failures.length > 0) {
  console.error(
    `\nORCH-1049 matches-sheet bottom-inset check FAILED (${failures.length}/${checks.length}).`,
  );
  process.exit(1);
}

console.log(
  `\nORCH-1049 matches-sheet bottom-inset check PASSED (${checks.length}/${checks.length}).`,
);
