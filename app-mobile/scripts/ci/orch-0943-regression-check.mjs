#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0943 happy-path regression checks.
 *
 * Structural tests are used here because app-mobile does not have a Jest script.
 * These checks pin the load-bearing source contracts for T-01..T-06.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_MOBILE_ROOT = path.resolve(__dirname, '../..');

const preferencesSheet = fs.readFileSync(
  path.join(APP_MOBILE_ROOT, 'src/components/PreferencesSheet.tsx'),
  'utf8',
);
const recommendationsContext = fs.readFileSync(
  path.join(APP_MOBILE_ROOT, 'src/contexts/RecommendationsContext.tsx'),
  'utf8',
);

let failures = 0;

function check(id, label, ok, hint) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${label}`);
  if (!ok) {
    failures += 1;
    if (hint) console.error(`     -> ${hint}`);
  }
}

const applyStart = preferencesSheet.indexOf('const handleApplyPreferences = useCallback(async () => {');
const applyEnd = preferencesSheet.indexOf('  }, [', applyStart);
const applyBlock = applyStart >= 0 && applyEnd > applyStart
  ? preferencesSheet.slice(applyStart, applyEnd)
  : '';

const autoResolveStart = applyBlock.indexOf('ORCH-0943 Fix B1');
const customLocationIdx = applyBlock.indexOf('const customLocationValue');
const autoResolveBlock = autoResolveStart >= 0 && customLocationIdx > autoResolveStart
  ? applyBlock.slice(autoResolveStart, customLocationIdx)
  : '';

check(
  'T-01',
  'auto-resolve success canonicalizes typed text and stores resolved coords before save',
  /geocodingService\.autocomplete\(searchLocation\)/.test(autoResolveBlock) &&
    /resolvedSuggestion\.fullAddress\s*\|\|\s*resolvedSuggestion\.displayName/.test(autoResolveBlock) &&
    /effectiveSelectedCoords\s*=\s*resolvedCoords/.test(autoResolveBlock) &&
    /setSelectedCoords\(effectiveSelectedCoords\)/.test(autoResolveBlock),
  'Expected the Apply handler to call autocomplete, use top suggestion text, assign local coords, and update UI state.',
);

check(
  'T-02',
  '[FAILS-ON-REVERT KEY] auto-resolved coords are threaded via local variables, not stale selectedCoords state',
  /custom_lat:\s*effectiveSelectedCoords\?\.lat\s*\?\?\s*null/.test(applyBlock) &&
    /custom_lng:\s*effectiveSelectedCoords\?\.lng\s*\?\?\s*null/.test(applyBlock) &&
    /let\s+collabLat:\s*number\s*\|\s*null\s*=\s*effectiveSelectedCoords\?\.lat\s*\?\?\s*null/.test(applyBlock) &&
    /let\s+collabLng:\s*number\s*\|\s*null\s*=\s*effectiveSelectedCoords\?\.lng\s*\?\?\s*null/.test(applyBlock),
  'Expected both solo payload fields and collabLat/collabLng initialization to read effectiveSelectedCoords.',
);

check(
  'T-03',
  'no-suggestion auto-resolve failure blocks save with the required toast',
  /if\s*\(\s*!resolvedSuggestion\s*\|\|\s*!resolvedCoords\s*\)\s*\{[\s\S]*toastManager\.warning\(\s*['"]Tap a suggestion to set your location\.['"]\s*,\s*3000\s*,?\s*\)[\s\S]*return;/.test(autoResolveBlock),
  'Expected failed resolution to reset isSavingRef, toast, and return before save construction.',
);

check(
  'T-04',
  'network/error auto-resolve failure warns and falls through to the same blocking toast',
  /catch\s*\(err\)\s*\{[\s\S]*console\.warn\(\s*['"]\[ORCH-0943\] auto-resolve failed['"]\s*,\s*err\s*\)/.test(autoResolveBlock) &&
    /toastManager\.warning\(\s*['"]Tap a suggestion to set your location\.['"]\s*,\s*3000\s*,?\s*\)/.test(autoResolveBlock),
  'Expected geocoder exceptions to be logged and then blocked by the shared failure branch.',
);

const r38Start = recommendationsContext.indexOf('ORCH-0446 R3.8 + ORCH-0943 Fix A');
const r38End = recommendationsContext.indexOf('// immediately kicks back to solo', r38Start);
const r38Block = r38Start >= 0 && r38End > r38Start
  ? recommendationsContext.slice(r38Start, r38End)
  : '';

check(
  'T-05',
  '[FAILS-ON-REVERT KEY] R3.8 GPS sync does not fire when use_gps_location is not true',
  /const\s+participantUseGps\s*=\s*boardSessionResult\.preferences\?\.use_gps_location/.test(r38Block) &&
    /if\s*\(\s*participantUseGps\s*!==\s*true\s*\)\s*return;/.test(r38Block) &&
    /boardSessionResult\.preferences\?\.use_gps_location/.test(
      r38Block.slice(r38Block.lastIndexOf('}, [')),
    ),
  'Expected the R3.8 effect to read session prefs, return unless true, and include the field in deps.',
);

check(
  'T-06',
  'R3.8 GPS sync still fires for GPS-mode participants with GPS coords payload',
  /supabase\.rpc\(\s*['"]upsert_participant_prefs['"][\s\S]*p_prefs:\s*\{[\s\S]*custom_lat:\s*userLocation\.lat[\s\S]*custom_lng:\s*userLocation\.lng/.test(r38Block),
  'Expected the guarded RPC to preserve the GPS-mode partial coord update.',
);

console.log('');
if (failures > 0) {
  console.error(`ORCH-0943 regression check FAILED: ${failures} failure(s).`);
  process.exit(1);
}

console.log('ORCH-0943 regression check PASS: T-01..T-06.');
