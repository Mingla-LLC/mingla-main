#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0904 [Consumer solo-mode deck uses GPS location up to 5 minutes stale —
 * driving users filter against where they WERE, not where they ARE]
 *
 * Tester-authored ADVERSARIAL regression check. Attacks DIFFERENT angles than
 * the implementor's happy-path script (`orch-0904-regression-check.mjs`).
 *
 * SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0904_SOLO_MODE_STALE_GPS.md §5.2
 * QA REPORT: Mingla_Artifacts/reports/QA_ORCH-0904_SOLO_MODE_STALE_GPS_REPORT.md
 *
 * The happy-path script verifies "the fix is present and structurally correct."
 * This adversarial script verifies the fix CANNOT BE QUIETLY WEAKENED without
 * blowing a regression gate. Each TA-NN attacks a specific weakening vector:
 *
 *   TA-01 — drift via "consolidation" of solo + collab branches into a helper
 *   TA-02 — weakening the strict-equality `useGpsLocation === true` guard
 *   TA-03 — substituting a truthy check for the `typeof === 'number'` type guard
 *   TA-04 — removing the try/catch around the GPS resolve (silent crash)
 *   TA-05 — drift of query-key tuples between cache-writer + cache-reader
 *   TA-06 — reversing GPS resolve vs onSave call (snapshot semantics broken)
 *   TA-07 — moving setQueryData AFTER any refresh-key bump (race-prone ordering)
 *   TA-08 — relaxing the solo guard so GPS resolves even when custom coords set
 *
 * [FAILS-ON-REVERT KEY] anchors: TA-02 + TA-04 per SPEC §5.2.
 *   TA-02 — weakening the `useGpsLocation === true` guard makes TA-02 RED.
 *   TA-04 — removing the solo-branch try/catch makes TA-04 RED.
 *
 * Run: cd app-mobile && node scripts/ci/orch-0904-adversarial-check.mjs
 * Exit 0 on PASS; exit 1 on any FAIL.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_MOBILE_ROOT = path.resolve(__dirname, '../..');

const PREFERENCES_SHEET = path.join(
  APP_MOBILE_ROOT,
  'src/components/PreferencesSheet.tsx',
);
const APP_HANDLERS = path.join(
  APP_MOBILE_ROOT,
  'src/components/AppHandlers.tsx',
);
const USE_USER_LOCATION = path.join(
  APP_MOBILE_ROOT,
  'src/hooks/useUserLocation.ts',
);

const prefsSrc = fs.readFileSync(PREFERENCES_SHEET, 'utf-8');
const appHandlersSrc = fs.readFileSync(APP_HANDLERS, 'utf-8');
const useLocSrc = fs.readFileSync(USE_USER_LOCATION, 'utf-8');

let failures = 0;

/**
 * @param {string} id
 * @param {string} label
 * @param {boolean} ok
 * @param {string=} hint
 */
function check(id, label, ok, hint) {
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`${tag} ${id} ${label}`);
  if (!ok) {
    failures += 1;
    if (hint) console.error(`     ↳ ${hint}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TA-01 — Collab branch NOT mistakenly modified / consolidated away
//   Different angle than happy-path T-06 (which only checks collab block exists).
//   Adversarial: the collab branch must contain its OWN await-getCurrentLocation
//   call separate from solo's. If a future refactor consolidates both branches
//   into a shared helper (`resolveFreshGps`), the literal `collabLat` assignment
//   chain disappears — TA-01 RED. Defends against drift-via-consolidation.
// ─────────────────────────────────────────────────────────────────────────────
{
  const collabHasOwnAwait =
    /if\s*\(\s*useGpsLocation\s*&&\s*collabLat\s*==\s*null\s*\)\s*\{[\s\S]{0,200}?await\s+enhancedLocationService\.getCurrentLocation\(\)/
      .test(prefsSrc);
  const collabHasLatAssignAfterAwait =
    /collabLat\s*=\s*gps\.latitude/.test(prefsSrc);
  const collabHasLngAssignAfterAwait =
    /collabLng\s*=\s*gps\.longitude/.test(prefsSrc);
  // Two distinct getCurrentLocation call sites must exist (solo + collab),
  // not a single shared call inside a helper.
  const totalAwaitSites = (
    prefsSrc.match(/await\s+enhancedLocationService\.getCurrentLocation\(\)/g) ??
    []
  ).length;

  check(
    'TA-01',
    'Collab branch retains its OWN GPS-resolve call (defends against drift-via-helper-consolidation)',
    collabHasOwnAwait &&
      collabHasLatAssignAfterAwait &&
      collabHasLngAssignAfterAwait &&
      totalAwaitSites >= 2,
    'Expected collab branch to retain its own await enhancedLocationService.getCurrentLocation() followed by collabLat = gps.latitude + collabLng = gps.longitude, AND at least 2 total await-getCurrentLocation call sites in PreferencesSheet (one solo, one collab). Found ' +
      totalAwaitSites +
      ' call site(s). If a future refactor consolidates both branches, this gate flags it.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TA-02 [FAILS-ON-REVERT KEY] — Custom-location path NOT polluted
//   Adversarial: the setQueryData block in AppHandlers MUST gate on
//   `preferences.useGpsLocation === true` (strict equality). Truthy gating
//   (`if (preferences.useGpsLocation)`) would write GPS coords to a
//   custom-location user's cache slot the moment freshGpsLat/Lng leak
//   through (e.g. from a future refactor that always populates the fields).
//   The strict-equality guard is the load-bearing safety. TA-02 RED if the
//   guard is weakened or removed.
// ─────────────────────────────────────────────────────────────────────────────
{
  const strictEqualityPresent =
    /preferences\.useGpsLocation\s*===\s*true/.test(appHandlersSrc);

  // Hostile patterns we must NOT see inside the setQueryData block guard.
  // Extract the conditional that immediately precedes the
  // `queryClient.setQueryData([` line and scan it for forbidden patterns.
  const setQueryDataBlockMatch = appHandlersSrc.match(
    /if\s*\([\s\S]{0,400}?\)\s*\{\s*queryClient\.setQueryData\(\s*\[\s*['"]userLocation['"]/,
  );
  const guardSrc = setQueryDataBlockMatch ? setQueryDataBlockMatch[0] : '';
  // Forbidden: truthy `preferences.useGpsLocation` without `=== true`.
  // Match `preferences.useGpsLocation` NOT followed by `===` on the same line.
  const truthyOnlyPattern =
    /preferences\.useGpsLocation\s*(&&|\)|$)/m;
  // Pull each line that mentions useGpsLocation in the guard and check it has
  // `=== true` somewhere on that line.
  const guardLines = guardSrc.split('\n');
  const offendingLines = guardLines.filter(
    (ln) =>
      ln.includes('preferences.useGpsLocation') &&
      !ln.includes('preferences.useGpsLocation === true') &&
      !ln.includes('preferences.useGpsLocation !== true'),
  );
  const noWeakeningInGuard = offendingLines.length === 0;

  check(
    'TA-02',
    '[FAILS-ON-REVERT KEY] setQueryData guard uses strict `useGpsLocation === true` only — no weakened truthy gating',
    strictEqualityPresent && noWeakeningInGuard,
    'Expected the setQueryData block enclosing if(...) to contain preferences.useGpsLocation === true AND no other line in the guard that references preferences.useGpsLocation without the strict-equality check. Offending lines: ' +
      JSON.stringify(offendingLines) +
      '. Weakening this guard would let custom-location users get GPS coords written to their cache slot, breaking their saved address.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TA-03 — Zero-coord (equator / prime meridian) users still trigger cache write
//   Adversarial: search the AppHandlers source for any forbidden truthy /
//   non-zero pattern on freshGpsLat or freshGpsLng. Only
//   `typeof X === 'number'` is acceptable.
// ─────────────────────────────────────────────────────────────────────────────
{
  const typeofGuardsPresent =
    /typeof\s+preferences\.freshGpsLat\s*===\s*['"]number['"]/.test(
      appHandlersSrc,
    ) &&
    /typeof\s+preferences\.freshGpsLng\s*===\s*['"]number['"]/.test(
      appHandlersSrc,
    );

  // Forbidden patterns — any of these is an instant RED.
  const forbiddenPatterns = [
    /!!\s*preferences\.freshGpsLat/,
    /!!\s*preferences\.freshGpsLng/,
    // truthy short-circuit: `preferences.freshGpsLat &&` without typeof
    // (allow `typeof preferences.freshGpsLat === 'number' &&` form)
    /\bpreferences\.freshGpsLat\s*&&/,
    /\bpreferences\.freshGpsLng\s*&&/,
    /preferences\.freshGpsLat\s*>\s*0/,
    /preferences\.freshGpsLng\s*>\s*0/,
    /preferences\.freshGpsLat\s*!==\s*0/,
    /preferences\.freshGpsLng\s*!==\s*0/,
    /preferences\.freshGpsLat\s*!=\s*null/,
    /preferences\.freshGpsLng\s*!=\s*null/,
  ];

  const violations = forbiddenPatterns
    .map((re, i) => (re.test(appHandlersSrc) ? `pattern[${i}] ${re}` : null))
    .filter(Boolean);

  check(
    'TA-03',
    'No truthy / non-zero / non-null guards on freshGpsLat/Lng (zero-coord users at equator + prime meridian still trigger cache write)',
    typeofGuardsPresent && violations.length === 0,
    'Expected ONLY typeof preferences.freshGpsLat === "number" style guard on the fresh-coord fields. Violations: ' +
      JSON.stringify(violations) +
      '. Any truthy/!=null/>0/!==0 guard breaks zero-coord users (equator latitude 0.0; prime meridian longitude 0.0). Boundary class verified by happy-path T-07; THIS test attacks the inverse — that no forbidden pattern exists anywhere in AppHandlers.tsx.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TA-04 [FAILS-ON-REVERT KEY] — Solo-branch GPS-resolve failure does NOT block save
//   Adversarial: the solo branch MUST contain a `try { ... } catch {}` block
//   around the getCurrentLocation call. Removing the catch would let a GPS
//   failure bubble and abort the entire `await Promise.resolve(onSave(...))`
//   chain, breaking Apply for users in bad GPS state.
// ─────────────────────────────────────────────────────────────────────────────
{
  // Locate the solo branch by its unique identifier `soloFreshGpsLat`. Within
  // ~600 chars of that decl, there MUST be a `try {` block containing the
  // await-getCurrentLocation call, followed by a `} catch` block. After the
  // catch closes, the onSave call must still execute.
  const soloDeclIdx = prefsSrc.indexOf('let soloFreshGpsLat');
  const soloBlock =
    soloDeclIdx >= 0 ? prefsSrc.substring(soloDeclIdx, soloDeclIdx + 1000) : '';

  const hasTry = /try\s*\{[\s\S]{0,200}?await\s+enhancedLocationService\.getCurrentLocation\(\)/.test(
    soloBlock,
  );
  const hasCatchAfterTry = /\}\s*catch\s*(\([^)]*\))?\s*\{/.test(soloBlock);
  // After the catch closes, an onSave invocation must still run within the
  // same solo block — this is the proof that failure ≠ Apply abort.
  const onSaveStillRuns =
    soloBlock.indexOf('catch') >= 0 &&
    soloBlock.indexOf('onSave(', soloBlock.indexOf('catch')) >= 0;

  check(
    'TA-04',
    '[FAILS-ON-REVERT KEY] Solo branch wraps GPS-resolve in try/catch AND still calls onSave after a GPS failure',
    hasTry && hasCatchAfterTry && onSaveStillRuns,
    'Expected solo branch to wrap await enhancedLocationService.getCurrentLocation() in try{...}catch{...}, and the onSave({...}) invocation to appear AFTER the catch within the same solo block. Without the catch, a GPS failure (location service disabled, permission revoked mid-flow) would reject the await and abort Apply entirely. hasTry=' +
      hasTry +
      ', hasCatchAfterTry=' +
      hasCatchAfterTry +
      ', onSaveStillRuns=' +
      onSaveStillRuns +
      '.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TA-05 — setQueryData key tuple in AppHandlers matches useUserLocation.ts:152 exactly
//   Adversarial: parse the tuple from useUserLocation.ts and assert each
//   element (in order) corresponds element-for-element to the literal tuple
//   in AppHandlers.tsx for solo + GPS-mode (`currentMode='solo'`,
//   `customLat=null`, `customLng=null`, `customLocation=null`,
//   `useGpsFlag=true`). If useUserLocation's tuple shape ever drifts, TA-05 RED.
// ─────────────────────────────────────────────────────────────────────────────
{
  // useUserLocation.ts query key — read the variable-form tuple
  const useLocTupleMatch = useLocSrc.match(
    /queryKey:\s*\[\s*(['"][^'"]+['"])\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\]/,
  );
  // Expected: ['userLocation', userId, currentMode, customLat, customLng, customLocation, useGpsFlag]
  const useLocOk =
    useLocTupleMatch !== null &&
    useLocTupleMatch[1].replace(/['"]/g, '') === 'userLocation' &&
    useLocTupleMatch[2] === 'userId' &&
    useLocTupleMatch[3] === 'currentMode' &&
    useLocTupleMatch[4] === 'customLat' &&
    useLocTupleMatch[5] === 'customLng' &&
    useLocTupleMatch[6] === 'customLocation' &&
    useLocTupleMatch[7] === 'useGpsFlag';

  // AppHandlers.tsx setQueryData tuple — literal-form for solo + GPS-mode
  const appHandlersTupleMatch = appHandlersSrc.match(
    /queryClient\.setQueryData\(\s*\[\s*(['"][^'"]+['"])\s*,\s*([^,]+?)\s*,\s*(['"][^'"]+['"])\s*,\s*(null)\s*,\s*(null)\s*,\s*(null)\s*,\s*(true)\s*\]/,
  );
  const appHandlersOk =
    appHandlersTupleMatch !== null &&
    appHandlersTupleMatch[1].replace(/['"]/g, '') === 'userLocation' &&
    appHandlersTupleMatch[2].trim() === 'user.id' &&
    appHandlersTupleMatch[3].replace(/['"]/g, '') === 'solo' &&
    appHandlersTupleMatch[4] === 'null' &&
    appHandlersTupleMatch[5] === 'null' &&
    appHandlersTupleMatch[6] === 'null' &&
    appHandlersTupleMatch[7] === 'true';

  // The shapes must align by element count + semantic position.
  const shapesAligned = useLocOk && appHandlersOk;

  check(
    'TA-05',
    'setQueryData key tuple in AppHandlers matches useUserLocation.ts:152 query-key shape element-for-element',
    shapesAligned,
    'useUserLocation tuple parsed: ' +
      JSON.stringify(useLocTupleMatch?.slice(1) ?? null) +
      ' (ok=' +
      useLocOk +
      '). AppHandlers tuple parsed: ' +
      JSON.stringify(appHandlersTupleMatch?.slice(1) ?? null) +
      ' (ok=' +
      appHandlersOk +
      '). The two tuples MUST match shape — if useUserLocation adds an 8th element or renames a slot, AppHandlers cache write hits a stale key. This gate flags drift on either side.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TA-06 — In the solo branch, `await enhancedLocationService.getCurrentLocation()`
//   appears BEFORE `await Promise.resolve(onSave(...))`.
//   Adversarial: snapshot semantics require GPS resolve to complete BEFORE
//   onSave triggers the downstream `handleSavePreferences` (which writes to
//   the query cache + bumps refresh-key). If they reverse, deck refetch fires
//   with stale cache before fresh coords arrive — race condition.
// ─────────────────────────────────────────────────────────────────────────────
{
  const soloDeclIdx = prefsSrc.indexOf('let soloFreshGpsLat');
  const soloBlock =
    soloDeclIdx >= 0 ? prefsSrc.substring(soloDeclIdx, soloDeclIdx + 1200) : '';

  const idxGpsResolve = soloBlock.indexOf(
    'await enhancedLocationService.getCurrentLocation()',
  );
  // onSave is invoked via `await Promise.resolve(\n            onSave(...))` —
  // anchor on `onSave({` which is unique to the spread-object call signature.
  const idxOnSave = soloBlock.indexOf('onSave({');

  const ordered = idxGpsResolve >= 0 && idxOnSave >= 0 && idxGpsResolve < idxOnSave;

  check(
    'TA-06',
    'In solo branch, GPS-resolve appears BEFORE onSave invocation (snapshot semantics)',
    ordered,
    'Solo branch: GPS-resolve idx=' +
      idxGpsResolve +
      ', onSave invocation idx=' +
      idxOnSave +
      ' (within solo-block substring). Snapshot semantics require GPS resolve to complete before onSave fires. If they reverse, the deck refetch races GPS resolution.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TA-07 — Every `setPreferencesRefreshKey((prev: number) => prev + 1)` call site
//   inside handleSavePreferences is preceded by a setQueryData(['userLocation', ...])
//   write.
//   Adversarial: extends happy-path T-03's single-pair ordering check. If
//   handleSavePreferences ever grows multiple refresh-key bumps (e.g. retry
//   logic), each one must be preceded by the setQueryData write — otherwise
//   one of them races stale cache.
// ─────────────────────────────────────────────────────────────────────────────
{
  // Find the handleSavePreferences body span. Anchor: the literal function
  // start `const handleSavePreferences = async`. End anchor: the next
  // `const handle` at the same indentation or end-of-file fallback.
  const hspStart = appHandlersSrc.indexOf(
    'const handleSavePreferences = async',
  );
  // Use a conservative span — anything within 6000 chars of hspStart counts
  // as "inside handleSavePreferences" (the function is ~150 lines).
  const hspBody =
    hspStart >= 0 ? appHandlersSrc.substring(hspStart, hspStart + 6500) : '';

  // Enumerate all refresh-key bump positions inside the body
  const refreshKeyRe =
    /setPreferencesRefreshKey\(\(prev:\s*number\)\s*=>\s*prev\s*\+\s*1\)/g;
  const refreshBumpPositions = [];
  let m;
  while ((m = refreshKeyRe.exec(hspBody)) !== null) {
    refreshBumpPositions.push(m.index);
  }

  // For each refresh-key bump, find the most-recent preceding
  // setQueryData(['userLocation' write inside the body. There MUST be one.
  const ordered = refreshBumpPositions.every((bumpIdx) => {
    const precedingSlice = hspBody.substring(0, bumpIdx);
    return /queryClient\.setQueryData\(\s*\[\s*['"]userLocation['"]/.test(
      precedingSlice,
    );
  });

  check(
    'TA-07',
    'Every refresh-key bump inside handleSavePreferences is preceded by a setQueryData(userLocation) write',
    refreshBumpPositions.length >= 1 && ordered,
    'Found ' +
      refreshBumpPositions.length +
      ' setPreferencesRefreshKey bump(s) inside handleSavePreferences. Each must be preceded by a setQueryData([userLocation, ...]) write. Ordered=' +
      ordered +
      '. If a future contributor adds a retry-path refresh-key bump WITHOUT also writing fresh coords first, that path races stale cache.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TA-08 — Solo branch's GPS-snapshot guard mirrors collab's:
//   `useGpsLocation && X?.lat == null` shape (both branches null-check the
//   pre-set custom coords before resolving fresh GPS).
//   Adversarial: if the solo guard ever drops the `selectedCoords?.lat == null`
//   half (becoming just `if (useGpsLocation)`), then a user with both GPS
//   mode AND saved custom coords would have their custom coords silently
//   overwritten by fresh GPS — confusing UX.
// ─────────────────────────────────────────────────────────────────────────────
{
  // Solo branch guard
  const soloGuardOk =
    /if\s*\(\s*useGpsLocation\s*&&\s*selectedCoords\?\.lat\s*==\s*null\s*\)/.test(
      prefsSrc,
    );
  // Collab branch guard
  const collabGuardOk =
    /if\s*\(\s*useGpsLocation\s*&&\s*collabLat\s*==\s*null\s*\)/.test(prefsSrc);
  // Hostile pattern: solo guard with just `if (useGpsLocation)` and no null-check.
  // We can't reliably detect "just useGpsLocation" via regex without false-positives
  // on legitimate uses elsewhere — instead we assert the solo block contains
  // BOTH `useGpsLocation &&` AND `selectedCoords?.lat == null` in proximity.
  const soloDeclIdx = prefsSrc.indexOf('let soloFreshGpsLat');
  const soloBlock =
    soloDeclIdx >= 0 ? prefsSrc.substring(soloDeclIdx, soloDeclIdx + 600) : '';
  const soloBlockHasFullGuard = /useGpsLocation\s*&&\s*selectedCoords\?\.lat\s*==\s*null/.test(
    soloBlock,
  );

  check(
    'TA-08',
    'Solo guard structure mirrors collab: `useGpsLocation && X?.lat == null` in BOTH branches',
    soloGuardOk && collabGuardOk && soloBlockHasFullGuard,
    'Expected BOTH guards: solo (useGpsLocation && selectedCoords?.lat == null) AND collab (useGpsLocation && collabLat == null). soloGuardOk=' +
      soloGuardOk +
      ', collabGuardOk=' +
      collabGuardOk +
      ', soloBlockHasFullGuard=' +
      soloBlockHasFullGuard +
      '. Dropping the null-check half would overwrite a user saved custom coords with fresh GPS — silent UX bug.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log('');
console.log(
  failures === 0
    ? 'PASS — ORCH-0904 adversarial regression check: 8/8 GREEN.'
    : `FAIL — ORCH-0904 adversarial regression check: ${8 - failures}/8 GREEN, ${failures} RED.`,
);
process.exit(failures > 0 ? 1 : 0);
