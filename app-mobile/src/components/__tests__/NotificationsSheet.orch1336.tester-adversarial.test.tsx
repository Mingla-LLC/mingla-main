// @ts-nocheck
/**
 * ORCH-1336 [notifications-sheet-gap] — TESTER adversarial regression guard.
 *
 * Independent last-line-of-defense guard. It attacks DIFFERENT angles than the
 * implementor's happy-path guard (NotificationsSheet.orch1336.test.tsx, which
 * asserts C1 null-when-online regex / C2 no-flex-style / C3 no-gap-JSX / C4
 * offline-testID / C5 offline style+locale / C6 no-gorhom). This guard instead
 * proves:
 *
 *   A — OFFLINE-BANNER PARITY: the offline banner IS the intrinsic-height wrapper
 *       itself (style + testID co-located on the SAME <View>), NOT nested inside a
 *       flex:1 gap wrapper, and styles.offlineBanner is not a flex:1 owner — so the
 *       banner sits at the top at intrinsic height and can never reopen the gap.
 *   B — INVARIANT BOUNDARY: exactly ONE flex:1 layout owner governs the populated
 *       body region. The deleted second owner (notificationsBody) is enumerated out
 *       of the StyleSheet's flex:1 owner set AND is unreferenced by renderBody.
 *   C — ONLINE-POPULATED SHORT-CIRCUIT (order proof): a bare `return null;` sits
 *       AFTER the empty-online branch and BEFORE the offline banner — so the online
 *       populated path emits zero markup above the section list. (Order mechanism,
 *       not the happy-path guard's single anchored regex.)
 *   D — NO COLLATERAL REGRESSION: the three non-populated branches (loading skeleton,
 *       error, empty-online) and their center/skeleton style owners are untouched.
 *   E — THE LIST STILL RENDERS: isPopulated still gates `sections` into scrollProps
 *       and renderBody() is still the sheet's children slot (the fix did not starve
 *       the list).
 *
 * Source-static, node:assert convention — app-mobile has NO jest / no
 * @testing-library/react-native (the sibling *.test.tsx files are the same style;
 * the sheet cannot render headlessly because BaseBottomSheet pulls native gorhom).
 * Comments are stripped first so the fix's own explanatory comment (which mentions
 * `styles.notificationsBody` / `flex:1` / `@gorhom`) can never fake or mask a check.
 *
 * FAILS-ON-REVERT: restoring the pre-fix source (empty flex:1 notificationsBody
 * wrapper, offline banner nested inside it, no testID, no return-null) fails A1 +
 * B1 + B2 + C1 below. Verified FAIL-then-PASS against the fix commit — see
 * TEST_ORCH-1336_NOTIFICATIONS_TOP_ALIGN.md for the console evidence.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FAILS_ON_REVERT_COMMIT = '8d0b201e47a96f41af78483c2ded318515fa6622';

function resolveRepoFile(relPath) {
  const appMobilePath = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(appMobilePath)) return appMobilePath;
  return path.resolve(process.cwd(), 'app-mobile', relPath);
}

function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), 'utf8');
}

// Strip block + line comments. `[^:]` before `//` preserves `://` in real code.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Slice the renderBody() arrow function body (non-greedy to its own `\n  };`).
function sliceRenderBody(src) {
  const m = src.match(/const renderBody = \(\) => \{[\s\S]*?\n {2}\};/);
  assert.ok(m, 'PRE: renderBody() arrow function must exist and be sliceable');
  return m[0];
}

// Enumerate every StyleSheet key whose (flat) block declares `flex: 1`.
function flexOneOwners(src) {
  return [...src.matchAll(/(\w+):\s*\{[^{}]*flex:\s*1[^{}]*\}/g)].map((m) => m[1]);
}

function runTesterAdversarial1336() {
  const sheet = stripComments(readSource('src/components/NotificationsSheet.tsx'));
  const body = sliceRenderBody(sheet);

  assert.equal(
    FAILS_ON_REVERT_COMMIT,
    '8d0b201e47a96f41af78483c2ded318515fa6622',
    'PRE: fails-on-revert anchor must be the ORCH-1336 fix commit',
  );

  // ── ANGLE A — OFFLINE-BANNER PARITY (fails-on-revert) ──────────────────────
  // The offline banner must BE the intrinsic-height wrapper itself: the SAME
  // <View> carries style={styles.offlineBanner} AND the testID. Pre-fix, the
  // banner was NESTED inside <View style={styles.notificationsBody}> (flex:1) —
  // exactly what re-opened the gap. Co-located style+testID proves it is the
  // top-level intrinsic banner, not a flex-split child.
  assert.match(
    body,
    /<View\s+style=\{styles\.offlineBanner\}\s+testID="notifications-offline-banner-wrap">/,
    'A1: offline banner must be the intrinsic offlineBanner View itself (style + testID co-located), NOT nested in a flex:1 wrapper',
  );
  assert.ok(
    !flexOneOwners(sheet).includes('offlineBanner'),
    'A2: styles.offlineBanner must not declare flex:1 (banner is intrinsic height, cannot split the sheet and reopen the gap)',
  );

  // ── ANGLE B — EXACTLY ONE flex:1 BODY OWNER (invariant boundary, fails-on-revert)
  // The deleted second flex:1 owner (notificationsBody) must be enumerated OUT of
  // the StyleSheet's flex:1 owner set, and must be unreferenced by renderBody. The
  // sole flex:1 owner of the populated body region is BaseBottomSheet's list.
  const owners = flexOneOwners(sheet);
  assert.ok(
    !owners.includes('notificationsBody'),
    `B1: notificationsBody must not be a flex:1 style owner — found flex:1 owners [${owners.join(', ')}]`,
  );
  assert.doesNotMatch(
    body,
    /styles\.notificationsBody/,
    'B2: renderBody must not reference styles.notificationsBody (no flex:1 sibling above the section list)',
  );

  // ── ANGLE C — ONLINE-POPULATED SHORT-CIRCUITS TO null (order proof, fails-on-revert)
  // Different mechanism than the happy-path guard's anchored regex: prove ORDER —
  // `return null;` sits AFTER the empty-online branch and BEFORE the offline banner,
  // so online+populated emits zero markup above the list.
  const iEmpty = body.indexOf('notifications.length === 0 && !isOffline');
  const iNull = body.indexOf('return null;');
  const iBanner = body.indexOf('notifications-offline-banner-wrap');
  assert.ok(iEmpty !== -1, 'C-pre: empty-online branch must still exist in renderBody');
  assert.ok(iBanner !== -1, 'C-pre: offline banner must still exist in renderBody');
  assert.ok(
    iNull !== -1,
    'C1: renderBody must contain a bare `return null;` (the online-populated short-circuit)',
  );
  assert.ok(
    iEmpty < iNull && iNull < iBanner,
    'C2: `return null;` must sit AFTER the empty-online branch and BEFORE the offline banner (online+populated renders nothing above the list)',
  );

  // ── ANGLE D — NO COLLATERAL REGRESSION TO THE 3 NON-POPULATED STATES ────────
  assert.match(
    body,
    /if \(isLoading && notifications\.length === 0\) return renderSkeleton\(\);/,
    'D1: loading branch (skeleton) must be untouched',
  );
  assert.match(body, /if \(isError\) \{/, 'D2: error branch must be untouched');
  assert.match(
    body,
    /if \(notifications\.length === 0 && !isOffline\) \{/,
    'D3: empty-online branch must be untouched',
  );
  for (const key of ['centerState', 'skeletonContainer', 'emptyIconCircle', 'retryButton']) {
    assert.match(
      sheet,
      new RegExp(`${key}:\\s*\\{`),
      `D4: style ${key} (non-populated states) must be preserved`,
    );
  }

  // ── ANGLE E — THE LIST STILL RENDERS (isPopulated gates sections in) ────────
  assert.match(
    sheet,
    /const isPopulated = !\(isLoading && notifications\.length === 0\)\s*&& !isError\s*&& !\(notifications\.length === 0 && !isOffline\);/,
    'E1: isPopulated gate must be intact (list renders only when notifications exist)',
  );
  assert.match(
    sheet,
    /scrollProps=\{\s*isPopulated\s*\?\s*\{\s*sections,/,
    'E2: sections must be gated into scrollProps by isPopulated so the list still renders',
  );
  assert.match(
    sheet,
    /scrollMode="sectionlist"/,
    'E3: the sheet must still drive BaseBottomSheet in sectionlist mode',
  );
  assert.match(
    sheet,
    /\{renderBody\(\)\}/,
    'E4: renderBody() must still be the sheet children slot',
  );
}

if (require.main === module) {
  try {
    runTesterAdversarial1336();
    console.log(
      `PASS ORCH-1336 tester adversarial suite (A/B/C/D/E angles); fails-on-revert anchor ${FAILS_ON_REVERT_COMMIT}`,
    );
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runTesterAdversarial1336 };
