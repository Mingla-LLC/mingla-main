#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0904 [Consumer solo-mode deck uses GPS location up to 5 minutes stale —
 * driving users filter against where they WERE, not where they ARE]
 *
 * Happy-path regression check (structural, source-grep based).
 *
 * SPEC: Mingla_Artifacts/specs/SPEC_ORCH-0904_SOLO_MODE_STALE_GPS.md §5.1
 * INVESTIGATION: Mingla_Artifacts/reports/INVESTIGATION_ORCH-0904_SOLO_MODE_STALE_GPS.md
 *
 * Mirrors the .mjs structural-check pattern from ORCH-0901, ORCH-0854, etc.
 * Jest is unavailable in app-mobile; grep on source text is the strongest
 * anti-regression guard for fundamentally-structural bug classes like this
 * one (the fix exists, or it doesn't — both in PreferencesSheet.tsx solo
 * branch AND in AppHandlers.tsx setQueryData call). The tester will write
 * a separate adversarial script attacking DIFFERENT angles.
 *
 * [FAILS-ON-REVERT KEY] anchors: T-01 + T-03 per SPEC §5.1.
 *   T-01 — solo GPS-snapshot block in PreferencesSheet.tsx.
 *          Reverting the block makes T-01 RED.
 *   T-03 — setQueryData call ordering in AppHandlers.tsx.
 *          Moving setQueryData AFTER setPreferencesRefreshKey makes T-03 RED.
 *
 * Run: cd app-mobile && node scripts/ci/orch-0904-regression-check.mjs
 * Exit 0 on PASS; exit 1 on any FAIL.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_MOBILE_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(APP_MOBILE_ROOT, '..');

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
 * Assert a structural check on source text.
 * @param {string} id - test id (T-01..T-08)
 * @param {string} label - human-readable description
 * @param {boolean} ok - pass condition
 * @param {string} [hint] - failure hint
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
// T-01 [FAILS-ON-REVERT KEY] — solo branch resolves fresh GPS + threads
// freshGpsLat / freshGpsLng into onSave call
// ─────────────────────────────────────────────────────────────────────────────
{
  // The solo branch uses UNIQUE variable names (`soloFreshGpsLat`/`Lng`) that don't
  // exist in the collab branch (which uses `collabLat`/`Lng`). Anchor proximity on
  // those unique identifiers to avoid colliding with collab's GPS-resolve at ~line 863.
  const hasSoloVarDecls =
    /let\s+soloFreshGpsLat:\s*number\s*\|\s*null\s*=\s*null;/.test(prefsSrc) &&
    /let\s+soloFreshGpsLng:\s*number\s*\|\s*null\s*=\s*null;/.test(prefsSrc);
  const hasSoloLatAssign = /soloFreshGpsLat\s*=\s*gps\.latitude/.test(prefsSrc);
  const hasSoloLngAssign = /soloFreshGpsLng\s*=\s*gps\.longitude/.test(prefsSrc);
  const hasFreshGpsLatField = /freshGpsLat:\s*soloFreshGpsLat,/.test(prefsSrc);
  const hasFreshGpsLngField = /freshGpsLng:\s*soloFreshGpsLng,/.test(prefsSrc);

  // Proximity check anchored on the unique solo identifiers (won't collide with collab).
  const idxSoloDecl = prefsSrc.indexOf('let soloFreshGpsLat');
  const idxSoloLatAssign = prefsSrc.indexOf('soloFreshGpsLat = gps.latitude');
  const idxFreshLatField = prefsSrc.indexOf('freshGpsLat: soloFreshGpsLat,');
  const allFound = idxSoloDecl >= 0 && idxSoloLatAssign >= 0 && idxFreshLatField >= 0;
  const proximityOk =
    allFound &&
    Math.max(idxSoloDecl, idxSoloLatAssign, idxFreshLatField) -
      Math.min(idxSoloDecl, idxSoloLatAssign, idxFreshLatField) <
      2000;

  check(
    'T-01',
    '[FAILS-ON-REVERT KEY] PreferencesSheet solo branch: GPS resolve + freshGpsLat/Lng threaded into onSave',
    hasSoloVarDecls &&
      hasSoloLatAssign &&
      hasSoloLngAssign &&
      hasFreshGpsLatField &&
      hasFreshGpsLngField &&
      proximityOk,
    'Expected solo branch with `let soloFreshGpsLat`/`Lng` decls, `soloFreshGpsLat = gps.latitude` + `soloFreshGpsLng = gps.longitude` assignments, AND `freshGpsLat: soloFreshGpsLat,` + `freshGpsLng: soloFreshGpsLng,` fields threaded into onSave — all within the same handleApplyPreferences solo branch (<2000 chars). Missing the ORCH-0904 snapshot mirror of collab\'s lines 861-871.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// T-02 — AppHandlers.tsx contains setQueryData with the correct key tuple
// ─────────────────────────────────────────────────────────────────────────────
{
  // Match the multi-line setQueryData call with the literal key tuple. Allow
  // whitespace + line breaks between tokens. Anchor on the literal strings.
  const hasSetQueryDataCall = /queryClient\.setQueryData\s*\(/.test(appHandlersSrc);
  const hasCorrectKeyTuple =
    /\[\s*['"]userLocation['"]\s*,\s*user\.id\s*,\s*['"]solo['"]\s*,\s*null\s*,\s*null\s*,\s*null\s*,\s*true\s*\]/
      .test(appHandlersSrc);
  const hasCorrectValueShape =
    /\{\s*lat:\s*preferences\.freshGpsLat\s*,\s*lng:\s*preferences\.freshGpsLng\s*\}/
      .test(appHandlersSrc);

  check(
    'T-02',
    'AppHandlers setQueryData with [userLocation, user.id, solo, null, null, null, true] + {lat,lng} value',
    hasSetQueryDataCall && hasCorrectKeyTuple && hasCorrectValueShape,
    'Expected `queryClient.setQueryData([\'userLocation\', user.id, \'solo\', null, null, null, true], { lat: preferences.freshGpsLat, lng: preferences.freshGpsLng })` per SPEC §2 Change 2A.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// T-03 [FAILS-ON-REVERT KEY] — setQueryData call positioned BEFORE
// setPreferencesRefreshKey bump (race-free semantics)
// ─────────────────────────────────────────────────────────────────────────────
{
  const setQueryDataMatch = appHandlersSrc.match(
    /queryClient\.setQueryData\(\s*\[\s*['"]userLocation['"]/,
  );
  // Find the setPreferencesRefreshKey call inside handleSavePreferences. Use
  // a unique substring to anchor the right call (there may be other refs).
  const refreshKeyMatch = appHandlersSrc.match(
    /setPreferencesRefreshKey\(\(prev:\s*number\)\s*=>\s*prev\s*\+\s*1\)/,
  );
  const setQueryDataIdx = setQueryDataMatch?.index ?? -1;
  const refreshKeyIdx = refreshKeyMatch?.index ?? -1;
  const ordered =
    setQueryDataIdx >= 0 &&
    refreshKeyIdx >= 0 &&
    setQueryDataIdx < refreshKeyIdx;

  check(
    'T-03',
    '[FAILS-ON-REVERT KEY] AppHandlers setQueryData(userLocation) call appears BEFORE setPreferencesRefreshKey bump',
    ordered,
    `setQueryData idx=${setQueryDataIdx}, refresh-key bump idx=${refreshKeyIdx}. Race-free semantics require setQueryData FIRST so the deck refetch (triggered by refresh-key bump) reads the just-written fresh coords.`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// T-04 — useUserLocation.ts:155 staleTime unchanged (no global change)
// ─────────────────────────────────────────────────────────────────────────────
{
  const staleTimeUnchanged =
    /staleTime:\s*useGpsFlag\s*\?\s*5\s*\*\s*60\s*\*\s*1000\s*:\s*Infinity/
      .test(useLocSrc);

  check(
    'T-04',
    'useUserLocation.ts staleTime line preserved (no global staleTime change per SC-08)',
    staleTimeUnchanged,
    'Expected `staleTime: useGpsFlag ? 5 * 60 * 1000 : Infinity,` unchanged. If staleTime got globally changed, this ORCH widened scope beyond the SPEC.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// T-05 — useUserLocation.ts:152 query key unchanged (no key discriminator added)
// ─────────────────────────────────────────────────────────────────────────────
{
  const queryKeyUnchanged =
    /queryKey:\s*\[\s*['"]userLocation['"]\s*,\s*userId\s*,\s*currentMode\s*,\s*customLat\s*,\s*customLng\s*,\s*customLocation\s*,\s*useGpsFlag\s*\]/
      .test(useLocSrc);

  check(
    'T-05',
    'useUserLocation.ts query key preserved (no key discriminator added per SC-09)',
    queryKeyUnchanged,
    'Expected `queryKey: [\'userLocation\', userId, currentMode, customLat, customLng, customLocation, useGpsFlag]` unchanged. The cache write at AppHandlers.tsx MUST match this exact key shape.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// T-06 — collab GPS-snapshot block at PreferencesSheet.tsx:861-871 preserved
// ─────────────────────────────────────────────────────────────────────────────
{
  // The collab branch contains:
  //   if (useGpsLocation && collabLat == null) {
  //     try {
  //       const gps = await enhancedLocationService.getCurrentLocation();
  //       if (gps) {
  //         collabLat = gps.latitude;
  //         collabLng = gps.longitude;
  //       }
  //     } catch {}
  //   }
  const collabGuardOk = /if\s*\(\s*useGpsLocation\s*&&\s*collabLat\s*==\s*null\s*\)\s*\{/.test(
    prefsSrc,
  );
  const collabAssignsLatOk = /collabLat\s*=\s*gps\.latitude/.test(prefsSrc);
  const collabAssignsLngOk = /collabLng\s*=\s*gps\.longitude/.test(prefsSrc);

  check(
    'T-06',
    'PreferencesSheet collab branch GPS-snapshot block preserved (parity reference per SC-07)',
    collabGuardOk && collabAssignsLatOk && collabAssignsLngOk,
    'Expected collab branch at PreferencesSheet.tsx:861-871 untouched: `if (useGpsLocation && collabLat == null)` guard + `collabLat = gps.latitude` + `collabLng = gps.longitude` assignments. Solo branch must MIRROR this; collab must be UNCHANGED.',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// T-07 — type guard uses `typeof X === 'number'` not truthy check
// (zero-coord equator/prime-meridian users still trigger the cache write)
// ─────────────────────────────────────────────────────────────────────────────
{
  const typeofGuardLat = /typeof\s+preferences\.freshGpsLat\s*===\s*['"]number['"]/.test(
    appHandlersSrc,
  );
  const typeofGuardLng = /typeof\s+preferences\.freshGpsLng\s*===\s*['"]number['"]/.test(
    appHandlersSrc,
  );

  check(
    'T-07',
    'AppHandlers type guards use `typeof === "number"` (zero-coord edge case per SC-05)',
    typeofGuardLat && typeofGuardLng,
    'Expected `typeof preferences.freshGpsLat === \'number\'` AND `typeof preferences.freshGpsLng === \'number\'` (NOT truthy check — a valid lat/lng can be 0 at equator / prime meridian).',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// T-08 — useGpsLocation strict equality check (custom-location-pollution defense)
// ─────────────────────────────────────────────────────────────────────────────
{
  const strictEqualityGuard =
    /preferences\.useGpsLocation\s*===\s*true/.test(appHandlersSrc);

  check(
    'T-08',
    'AppHandlers gates setQueryData on `preferences.useGpsLocation === true` strict equality (per SC-04)',
    strictEqualityGuard,
    'Expected `preferences.useGpsLocation === true` strict-equality guard (NOT truthy `preferences.useGpsLocation` — defense-in-depth so custom-location users never get GPS coords written to the cache).',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log('');
console.log(
  failures === 0
    ? 'PASS — ORCH-0904 happy-path regression check: 8/8 GREEN.'
    : `FAIL — ORCH-0904 happy-path regression check: ${8 - failures}/8 GREEN, ${failures} RED.`,
);
process.exit(failures > 0 ? 1 : 0);
