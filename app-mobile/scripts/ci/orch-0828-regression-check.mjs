#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0828 mobile-side regression check.
 *
 * Mirrors the in-repo CI script pattern used by ORCH-0749 / ORCH-0751 /
 * ORCH-0809 (no Jest infrastructure exists for app-mobile/; tests are Node
 * assertions against the on-disk source of truth).
 *
 * Asserts the REWORK contracts that aren't covered by edge-fn Deno tests:
 *
 *   FILTER GUARDS (R1 — proven root cause from brutal retest)
 *   T-01 `showEmpty` considers both `nightOutCards.length === 0` AND
 *        `businessEvents.length === 0` (was: TM-only — hid Big Party on
 *        Tonight whenever TM returned zero).
 *   T-02 `hasCache` considers both arrays.
 *   T-03 `showLoadingSkeleton` considers both arrays.
 *   T-04 `showFilterNoMatch` considers business events too.
 *
 *   SHEET PATTERN (R2 — probable root cause from brutal retest)
 *   T-05 ExpandedBusinessEventSheet imports default `BottomSheet` (NOT
 *        `BottomSheetModal`) from @gorhom/bottom-sheet.
 *   T-06 ExpandedBusinessEventSheet uses declarative
 *        `index={visible ? SHEET_INITIAL_INDEX : -1}` (NOT `present()`/`dismiss()` calls).
 *   T-07 ExpandedBusinessEventSheet wraps content in `BottomSheetScrollView`.
 *   T-08 ExpandedBusinessEventSheet uses canonical
 *        `glass.bottomSheet.snapPoints` design token.
 *   T-09 app/_layout.tsx does NOT import `BottomSheetModalProvider` and
 *        does NOT render `<BottomSheetModalProvider>`.
 *   T-10 ExpandedBusinessEventSheet uses `onChange` handler (not `onDismiss`).
 *
 *   DIAGNOSTIC (C1 — contributing factor from brutal retest)
 *   T-11 `[NightOutService] searchMerged` log includes `timezone`,
 *        `localStartEndDateTime`, and `segmentSlug` keys.
 *
 * Invariants codified:
 *   I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS  (T-01..T-04)
 *   I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS  (T-05..T-10)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
};

const discover = read("src/components/DiscoverScreen.tsx");
const sheet = read("src/components/expandedCard/ExpandedBusinessEventSheet.tsx");
const layout = read("app/_layout.tsx");
const service = read("src/services/nightOutExperiencesService.ts");

// ─── FILTER GUARDS ──────────────────────────────────────────────────────────

check(
  "T-01 showEmpty considers both nightOutCards AND businessEvents",
  /const\s+showEmpty\s*=[\s\S]{0,400}?nightOutCards\.length\s*===\s*0[\s\S]{0,200}?businessEvents\.length\s*===\s*0/.test(
    discover,
  ),
  "DiscoverScreen.tsx: `showEmpty` MUST include both `nightOutCards.length === 0` AND `businessEvents.length === 0` (I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS).",
);

check(
  "T-02 hasCache considers both arrays",
  /const\s+hasCache\s*=[\s\S]{0,200}?nightOutCards\.length\s*>\s*0[\s\S]{0,100}?\|\|[\s\S]{0,100}?businessEvents\.length\s*>\s*0/.test(
    discover,
  ),
  "DiscoverScreen.tsx: `hasCache` MUST be `nightOutCards.length > 0 || businessEvents.length > 0`.",
);

check(
  "T-03 showLoadingSkeleton considers both arrays empty",
  /const\s+showLoadingSkeleton\s*=[\s\S]{0,300}?nightOutCards\.length\s*===\s*0[\s\S]{0,200}?businessEvents\.length\s*===\s*0/.test(
    discover,
  ),
  "DiscoverScreen.tsx: `showLoadingSkeleton` MUST require BOTH arrays empty (otherwise an arrived businessEvents flash gets hidden behind a skeleton).",
);

check(
  "T-04 showFilterNoMatch considers business events",
  /const\s+showFilterNoMatch\s*=[\s\S]{0,500}?businessEvents\.length/.test(
    discover,
  ),
  "DiscoverScreen.tsx: `showFilterNoMatch` MUST reference businessEvents (cannot fire the no-match state when business events exist and would render).",
);

// ─── SHEET PATTERN ──────────────────────────────────────────────────────────

check(
  "T-05 ExpandedBusinessEventSheet imports default BottomSheet (not BottomSheetModal)",
  /import\s+BottomSheet\s*,\s*\{[\s\S]{0,300}?\}\s+from\s+["']@gorhom\/bottom-sheet["']/.test(
    sheet,
  ) && !/\bBottomSheetModal\b/.test(sheet),
  "ExpandedBusinessEventSheet.tsx: MUST import default `BottomSheet` from @gorhom/bottom-sheet (NOT `BottomSheetModal`). The portal pattern is forbidden by I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS.",
);

check(
  "T-06 ExpandedBusinessEventSheet uses declarative index prop",
  /<BottomSheet[\s\S]{0,500}?index=\{visible\s*\?\s*SHEET_INITIAL_INDEX\s*:\s*-1\}/.test(
    sheet,
  ),
  "ExpandedBusinessEventSheet.tsx: MUST use declarative `index={visible ? SHEET_INITIAL_INDEX : -1}` (NOT imperative `present()` / `dismiss()` calls).",
);

check(
  "T-07 ExpandedBusinessEventSheet wraps content in BottomSheetScrollView",
  /<BottomSheetScrollView/.test(sheet),
  "ExpandedBusinessEventSheet.tsx: MUST wrap PublicEventPage in `<BottomSheetScrollView>` so the library has measurable content from the first frame.",
);

check(
  "T-08 ExpandedBusinessEventSheet uses glass.bottomSheet.snapPoints token",
  /glass\.bottomSheet\.snapPoints/.test(sheet),
  "ExpandedBusinessEventSheet.tsx: MUST consume the canonical `glass.bottomSheet.snapPoints` design token (matches the TM/place sheet at ExpandedCardModal.tsx:1606).",
);

check(
  "T-09 app/_layout.tsx does NOT use BottomSheetModalProvider",
  !/BottomSheetModalProvider/.test(layout),
  "app/_layout.tsx: MUST NOT import or render `BottomSheetModalProvider`. The inline `<BottomSheet>` pattern does not need a provider.",
);

check(
  "T-10 ExpandedBusinessEventSheet uses onChange (not onDismiss)",
  /onChange=\{handleSheetChange\}/.test(sheet) &&
    !/onDismiss=/.test(sheet),
  "ExpandedBusinessEventSheet.tsx: MUST use `onChange={handleSheetChange}` (inline `BottomSheet` API). `onDismiss` is the `BottomSheetModal` API and is forbidden.",
);

// ─── DIAGNOSTIC LOG ────────────────────────────────────────────────────────

check(
  "T-11 searchMerged log includes timezone + localStartEndDateTime + segmentSlug",
  /\[NightOutService\]\s+searchMerged:[\s\S]{0,500}?timezone[\s\S]{0,500}?localStartEndDateTime[\s\S]{0,500}?segmentSlug/.test(
    service,
  ) ||
    /\[NightOutService\]\s+searchMerged:[\s\S]{0,500}?segmentSlug[\s\S]{0,500}?localStartEndDateTime[\s\S]{0,500}?timezone/.test(
      service,
    ),
  "nightOutExperiencesService.ts: `[NightOutService] searchMerged:` log MUST include `timezone`, `localStartEndDateTime`, and `segmentSlug` keys (order-independent) so runtime traces can verify what the client actually sent.",
);

// ─── REPORT ────────────────────────────────────────────────────────────────

let allPass = true;
console.log("\nORCH-0828 mobile regression check\n" + "=".repeat(40));
for (const c of checks) {
  const tag = c.pass ? "PASS" : "FAIL";
  console.log(`  [${tag}] ${c.name}`);
  if (!c.pass) {
    console.log(`         → ${c.detail}`);
    allPass = false;
  }
}
console.log();

if (!allPass) {
  console.error(
    `ORCH-0828 regression check FAILED: ${checks.filter((c) => !c.pass).length}/${checks.length} contracts violated.`,
  );
  process.exit(1);
}

console.log(`ORCH-0828 regression check PASS: ${checks.length}/${checks.length}.`);
