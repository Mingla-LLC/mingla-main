#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-0943 adversarial structural checks.
 *
 * These attack timing, bounds, whitespace, and strict-grep guard angles that
 * differ from the happy-path regression script.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_MOBILE_ROOT = path.resolve(__dirname, '../..');
const REPO_ROOT = path.resolve(APP_MOBILE_ROOT, '..');

const prefs = fs.readFileSync(
  path.join(APP_MOBILE_ROOT, 'src/components/PreferencesSheet.tsx'),
  'utf8',
);
const context = fs.readFileSync(
  path.join(APP_MOBILE_ROOT, 'src/contexts/RecommendationsContext.tsx'),
  'utf8',
);
const onboarding = fs.readFileSync(
  path.join(APP_MOBILE_ROOT, 'src/components/OnboardingFlow.tsx'),
  'utf8',
);

const applyStart = prefs.indexOf('const handleApplyPreferences = useCallback(async () => {');
const applyEnd = prefs.indexOf('  }, [', applyStart);
const applyBlock = prefs.slice(applyStart, applyEnd);
const autoResolveStart = applyBlock.indexOf('ORCH-0943 Fix B1');
const customLocationIdx = applyBlock.indexOf('const customLocationValue');
const autoResolveBlock = applyBlock.slice(autoResolveStart, customLocationIdx);

let failures = 0;

function check(id, label, ok, hint) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${label}`);
  if (!ok) {
    failures += 1;
    if (hint) console.error(`     -> ${hint}`);
  }
}

check(
  'T-A01',
  'race: Apply auto-resolves when debounce has not selected coords yet',
  /effectiveSelectedCoords\s*===\s*null/.test(autoResolveBlock) &&
    /await\s+geocodingService\.autocomplete\(searchLocation\)/.test(autoResolveBlock),
  'Expected Apply-time autocomplete to run from selectedCoords=null, independent of debounce state.',
);

check(
  'T-A02',
  'boundary: Apply-time auto-resolve is not tied to the 4-character debounce threshold',
  /searchLocation\.trim\(\)\.length\s*>\s*0/.test(autoResolveBlock) &&
    !/searchLocation\.trim\(\)\.length\s*>=\s*4/.test(autoResolveBlock),
  'Expected Apply guard to require only non-empty trimmed text, not the debounce threshold.',
);

check(
  'T-A03',
  'bounds: invalid autocomplete coordinates are rejected',
  /Math\.abs\(coords\.lat\)\s*<=\s*90/.test(autoResolveBlock) &&
    /Math\.abs\(coords\.lng\)\s*<=\s*180/.test(autoResolveBlock) &&
    /resolvedCoords\s*=\s*coords/.test(autoResolveBlock),
  'Expected lat/lng bounds validation before assigning resolvedCoords.',
);

check(
  'T-A04',
  'whitespace-only location does not trigger auto-resolve',
  /searchLocation\.trim\(\)\.length\s*>\s*0/.test(autoResolveBlock),
  'Expected trimmed length guard so spaces do not enter geocoding.',
);

check(
  'T-A05',
  'GPS-toggle race: non-GPS Apply path is the only auto-resolve trigger',
  /!\s*useGpsLocation/.test(autoResolveBlock) &&
    /customLocationValue\s*=\s*useGpsLocation\s*\?[\s\S]*:\s*effectiveSearchLocation\s*\|\|\s*null/.test(applyBlock),
  'Expected custom-location mode to resolve text and persist effectiveSearchLocation.',
);

const r38Start = context.indexOf('ORCH-0446 R3.8 + ORCH-0943 Fix A');
const r38End = context.indexOf('// immediately kicks back to solo', r38Start);
const r38Block = context.slice(r38Start, r38End);

check(
  'T-A06',
  'R3.8 partial upsert is guarded by the freshest session preferences dependency',
  /participantUseGps\s*!==\s*true/.test(r38Block) &&
    /boardSessionResult\.preferences\?\.use_gps_location/.test(
      r38Block.slice(r38Block.lastIndexOf('}, [')),
    ),
  'Expected guard and dependency to use boardSessionResult.preferences?.use_gps_location.',
);

const gateScript = path.join(
  REPO_ROOT,
  '.github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.mjs',
);
const gateSelfTest = path.join(
  REPO_ROOT,
  '.github/scripts/strict-grep/i-proposed-orch-0943-custom-coords-locked.test.mjs',
);

check(
  'T-A07',
  'strict-grep adversarial fixture fails unguarded partial coord writes',
  fs.existsSync(gateSelfTest) &&
    /fails pre-fix partial coord payload without guard/.test(fs.readFileSync(gateSelfTest, 'utf8')),
  'Expected self-test fixture that proves unguarded custom_lat/custom_lng partial payload fails.',
);

check(
  'T-A08',
  'strict-grep adversarial fixture passes guarded partial coord writes within 10 lines',
  fs.existsSync(gateSelfTest) &&
    /passes guarded GPS-mode partial coord payload/.test(fs.readFileSync(gateSelfTest, 'utf8')),
  'Expected self-test fixture that proves the ORCH-0943 R3.8 guard shape passes.',
);

check(
  'T-A09',
  'Onboarding partial-coord vector remains out of scope and unmodified for ORCH-0944',
  (() => {
    const start = onboarding.indexOf('PreferencesService.updateUserPreferences(user.id, {');
    const end = onboarding.indexOf('8000,', start);
    const saveBlock = start >= 0 && end > start ? onboarding.slice(start, end) : '';
    return /custom_location:\s*data\.manualLocation/.test(saveBlock) &&
      !/custom_lat:\s*data\.coordinates/.test(saveBlock) &&
      !/custom_lng:\s*data\.coordinates/.test(saveBlock);
  })(),
  'Expected OnboardingFlow save body to remain the known text-only follow-up vector; ORCH-0943 must not edit it.',
);

const gateRun = spawnSync(process.execPath, [gateScript], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
});
check(
  'T-A10',
  'strict-grep live-code gate passes after ORCH-0943 fixes',
  gateRun.status === 0 && /PASS/.test(gateRun.stdout),
  gateRun.stderr || gateRun.stdout,
);

console.log('');
if (failures > 0) {
  console.error(`ORCH-0943 adversarial check FAILED: ${failures} failure(s).`);
  process.exit(1);
}

console.log('ORCH-0943 adversarial check PASS: T-A01..T-A10.');
