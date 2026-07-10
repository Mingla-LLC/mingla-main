// @ts-nocheck
/**
 * ORCH-1336 [notifications-sheet-gap] — regression guard.
 *
 * Bug (Seth, screenshot-confirmed): in the Explorer notifications sheet, when
 * only a few notifications exist the single card floated mid-sheet with a large
 * empty band under the header instead of hugging the top.
 *
 * Root cause: the POPULATED + ONLINE branch of renderBody() returned an EMPTY
 * `<View style={styles.notificationsBody}>` where `notificationsBody` was
 * `{ flex: 1, minHeight: 0 }`. BaseBottomSheet (scrollMode="sectionlist")
 * renders `{header}{children}{BottomSheetSectionList (flex:1)}` as sibling
 * children, so two `flex:1` siblings (the empty wrapper + the list) split the
 * bounded height ~50/50 — the empty wrapper ate the top half (the gap) and the
 * list was pushed into the bottom half, floating its single card mid-sheet.
 *
 * Fix (approach A): the populated branch returns `null` when NOT offline, so it
 * contributes NO flex space above the list; the list then claims all remaining
 * height below the header and the notifications hug the top. The `flex:1`
 * `notificationsBody` style is deleted. The offline banner still renders ABOVE
 * the list, in its own intrinsic-height View (no flex:1), when offline.
 *
 * This is a source-static structural guard (app-mobile has NO jest / no
 * @testing-library/react-native — the sibling NotificationsSheet.test.tsx and
 * NotificationsSheet.tester-adversarial.test.tsx are the same style; the sheet
 * cannot be rendered headlessly because BaseBottomSheet pulls native gorhom).
 * It is deterministic and needs no layout engine.
 *
 * Fails-on-revert: restoring the old empty `flex:1` `notificationsBody` wrapper
 * (deleting the null-return guard) fails G1 + G2 + G3 + G4 below.
 * Verified fails-on-revert — see IMPLEMENTATION_ORCH-1336_NOTIFICATIONS_TOP_ALIGN.md
 * for the exact commit hash and the FAIL-then-PASS console evidence.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function resolveRepoFile(relPath) {
  const appMobilePath = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(appMobilePath)) return appMobilePath;
  return path.resolve(process.cwd(), 'app-mobile', relPath);
}

function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), 'utf8');
}

function runOrch1336Test() {
  const sheet = readSource('src/components/NotificationsSheet.tsx');

  // G1 — POSITIVE: the populated branch returns null when ONLINE (not offline),
  // so it contributes no flex space above the list. This is the top-align fix.
  assert.match(
    sheet,
    /if \(!\(isOffline && notifications\.length > 0\)\) \{\s*return null;\s*\}/,
    'G1 ORCH-1336: populated branch must return null when online so no flex:1 sibling sits above the section list',
  );

  // G2 — NEGATIVE: the empty flex:1 `notificationsBody` STYLE (the gap wrapper)
  // must be gone. Its return is the exact bug signature.
  assert.doesNotMatch(
    sheet,
    /notificationsBody:\s*\{[\s\S]*?flex:\s*1/,
    'G2 ORCH-1336: the flex:1 notificationsBody style must be deleted (it split the sheet height and opened the mid-sheet gap)',
  );

  // G3 — NEGATIVE: nothing renders the flex:1 wrapper above the list anymore.
  assert.doesNotMatch(
    sheet,
    /style=\{styles\.notificationsBody\}/,
    'G3 ORCH-1336: no JSX may render the flex:1 notificationsBody wrapper above the section list',
  );

  // G4 — POSITIVE: the offline banner is the ONLY thing this branch may render,
  // in an intrinsic-height wrapper carrying a testable id (present only offline).
  assert.match(
    sheet,
    /testID="notifications-offline-banner-wrap"/,
    'G4 ORCH-1336: the offline-banner wrapper must carry a stable testID so its presence/absence is assertable',
  );

  // G5 — PARITY GUARD: the offline banner must still render ABOVE the list when
  // offline (SC-19 parity preserved by the top-align fix).
  assert.match(
    sheet,
    /style=\{styles\.offlineBanner\}/,
    'G5 ORCH-1336: the offline banner View must still render (offline parity preserved)',
  );
  assert.match(
    sheet,
    /notifications:offline\.banner/,
    'G5 ORCH-1336: the offline banner must still render its localized copy',
  );

  // G6 — INVARIANT: the sole-gorhom-consumer invariant holds — NotificationsSheet
  // must NOT import @gorhom/bottom-sheet directly (BaseBottomSheet is the sole
  // consumer). The fix is consumer-side layout only and must not re-introduce it.
  assert.doesNotMatch(
    sheet,
    /import\s+[\s\S]*?from\s+['"]@gorhom\/bottom-sheet['"]/,
    'G6 ORCH-1336: NotificationsSheet must not import @gorhom/bottom-sheet (I-PROPOSED-BASE-BOTTOM-SHEET-SOLE-GORHOM-CONSUMER)',
  );
}

if (require.main === module) {
  try {
    runOrch1336Test();
    console.log('PASS ORCH-1336 notifications-sheet top-align regression guard (6 assertions)');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runOrch1336Test };
