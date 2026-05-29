#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression suite — META-ORCH-0991 Wave A [BaseBottomSheet primitive + 5-sheet
 * migration]. Structural/contract test (the @gorhom/bottom-sheet host is NOT
 * mountable in this harness — see SPEC §12; the locked NotificationsSheet test
 * uses the same source-structural approach).
 *
 * Asserts the load-bearing Wave-A contracts:
 *   T-A  BaseBottomSheet exists, default-exports + named-exports the component,
 *        is built on the VANILLA <BottomSheet> (no BottomSheetModalProvider /
 *        @gorhom/portal — preserves I-PROPOSED-BOTTOMSHEET-INLINE...).
 *   T-B  The primitive routes index === -1 → onClose internally, and threads
 *        scrollMode view/scroll/flatlist/sectionlist + wrapInRNModal + stickyFooter.
 *   T-C  The primitive consumes the additive design tokens (handleActive /
 *        a11yBackdropTint / centerDialog) and defines the SHEET_SPRING config.
 *   T-D  All 5 Wave-A sheets consume BaseBottomSheet and NONE imports gorhom
 *        directly (the sole-consumer invariant, structurally).
 *   T-E  NotificationsSheet passes scrollMode="sectionlist".
 *
 * FAILS-ON-REVERT anchor: 42bc0d336aab (HEAD after the 5th migration, before
 * this test). Reverting ANY of the 5 sheet migrations (re-adding its direct
 * gorhom import) flips T-D for that file → this suite FAILS. Reverting the
 * NotificationsSheet migration also flips T-E. Reverting the primitive removes
 * BaseBottomSheet.tsx → T-A FAILS. Verified by `git stash`/revert (see report).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app-mobile/src/components/ui/__tests__ → repo root is 6 levels up.
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");

const FAILS_ON_REVERT_COMMIT = "42bc0d336aab";

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/** True iff `source` has a real `import ... from '@gorhom/bottom-sheet'` (not a comment). */
function importsGorhom(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  return /^\s*import\b[\s\S]*?from\s+['"]@gorhom\/bottom-sheet['"]/m.test(stripped);
}

function run() {
  const BASE = "app-mobile/src/components/ui/BaseBottomSheet.tsx";
  const base = read(BASE);

  // ── T-A: primitive exists + vanilla inline + exports ──────────────────────
  assert.match(base, /export\s+default\s+BaseBottomSheet/, "T-A default export");
  assert.match(base, /export\s+const\s+BaseBottomSheet\b/, "T-A named export");
  assert.ok(importsGorhom(base), "T-A primitive imports @gorhom/bottom-sheet");
  assert.match(
    base,
    /import\s+BottomSheet\b/,
    "T-A built on the VANILLA default <BottomSheet> export",
  );
  // Strip comments so the doc-comment that NAMES the banned provider/portal
  // (to forbid it) does not itself trip the guard — we only ban real code use.
  const baseCode = base
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  assert.doesNotMatch(
    baseCode,
    /BottomSheetModalProvider|@gorhom\/portal/,
    "T-A must NOT reintroduce a provider/portal in code (ORCH-0828 inline-only invariant)",
  );

  // ── T-B: open/close routing + body modes + escape hatches ─────────────────
  assert.match(base, /index=\{visible\s*\?\s*initialIndex\s*:\s*-1\}/, "T-B declarative index");
  assert.match(base, /if\s*\(index\s*===\s*-1\)\s*onClose\(\)/, "T-B routes index -1 → onClose");
  assert.match(base, /wrapInRNModal/, "T-B wrapInRNModal escape hatch present");
  assert.match(base, /Modal as RNModal/, "T-B RN Modal z-stack wrap (ORCH-0908)");
  assert.match(base, /BottomSheetScrollView/, "T-B scroll mode container");
  assert.match(base, /BottomSheetSectionList/, "T-B sectionlist mode container");
  assert.match(base, /BottomSheetFlatList/, "T-B flatlist mode container");
  assert.match(base, /stickyFooter/, "T-B sticky footer slot");
  assert.match(base, /BackHandler\.addEventListener/, "T-B Android hardware-back for non-wrapped sheets");
  assert.match(base, /accessibilityViewIsModal/, "T-B VoiceOver modal boundary");

  // ── T-C: tokens + spring ───────────────────────────────────────────────────
  const ds = read("app-mobile/src/constants/designSystem.ts");
  assert.match(ds, /handleActive:\s*\{/, "T-C handleActive token block(s) added");
  assert.match(ds, /a11yBackdropTint:/, "T-C a11yBackdropTint token added");
  assert.match(ds, /centerDialog:\s*\{/, "T-C centerDialog token block added");
  // Additive only: the locked handle token + topRadius 28 must still be intact.
  assert.match(ds, /topRadius:\s*28/, "T-C locked topRadius 28 intact");
  assert.match(base, /useBottomSheetSpringConfigs/, "T-C SHEET_SPRING via gorhom spring hook");
  assert.match(base, /damping:\s*50/, "T-C spring damping 50 (zero-overshoot)");
  assert.match(base, /stiffness:\s*320/, "T-C spring stiffness 320");
  assert.match(base, /ReduceMotion\.System/, "T-C reduce-motion honored");

  // ── T-D: all 5 sheets consume BaseBottomSheet + none imports gorhom ────────
  const SHEETS = {
    CollabSessionChatBanners: "app-mobile/src/components/chat/CollabSessionChatBanners.tsx",
    TicketCartSheet: "app-mobile/src/components/expandedCard/TicketCartSheet.tsx",
    ExpandedBusinessEventSheet: "app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx",
    NotificationsSheet: "app-mobile/src/components/NotificationsSheet.tsx",
    ExpandedCardModal: "app-mobile/src/components/ExpandedCardModal.tsx",
  };
  for (const [name, rel] of Object.entries(SHEETS)) {
    const src = read(rel);
    assert.match(
      src,
      /import\s+\{[^}]*\bBaseBottomSheet\b[^}]*\}\s+from\s+['"][^'"]*BaseBottomSheet['"]/,
      `T-D ${name} imports BaseBottomSheet`,
    );
    assert.match(src, /<BaseBottomSheet\b/, `T-D ${name} renders <BaseBottomSheet>`);
    assert.ok(
      !importsGorhom(src),
      `T-D ${name} must NOT import @gorhom/bottom-sheet directly (sole consumer is BaseBottomSheet)`,
    );
  }

  // ── T-E: NotificationsSheet uses the sectionlist mode ──────────────────────
  assert.match(
    read(SHEETS.NotificationsSheet),
    /scrollMode=["']sectionlist["']/,
    "T-E NotificationsSheet passes scrollMode='sectionlist'",
  );

  // ── No-double-fire structural guard: a migrated sheet that keeps an onChange
  // passthrough must NOT also call onClose in it (primitive owns that). The two
  // sheets that pass onChange/onClose explicitly are checked.
  const ebes = read(SHEETS.ExpandedBusinessEventSheet);
  const handleChange = ebes.match(/const handleSheetChange[\s\S]*?\}\s*,\s*\[\s*\]\s*\)/);
  assert.ok(handleChange, "T-B handleSheetChange present in ExpandedBusinessEventSheet");
  assert.doesNotMatch(
    handleChange[0],
    /onClose\(\)/,
    "T-B ExpandedBusinessEventSheet onChange passthrough must NOT call onClose (no double-fire)",
  );
}

try {
  run();
  console.log(
    `PASS META-ORCH-0991 BaseBottomSheet Wave-A regression suite; fails-on-revert anchor ${FAILS_ON_REVERT_COMMIT}`,
  );
} catch (error) {
  console.error(error);
  process.exit(1);
}
