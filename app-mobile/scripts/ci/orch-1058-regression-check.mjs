#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1058 regression check — collab deck location chips + smarter no-overlap feedback.
 *
 * Behavioral, not source-scan: transpiles the REAL on-disk TypeScript source
 * with the typescript compiler API (the pure functions have no React Native
 * imports), then exercises the actual logic. This makes the test fail-on-revert
 * if the GPS privacy guard, the formatCityState formatter, or the 3-case
 * routing logic regresses.
 *
 * Covers the three load-bearing requirements:
 *   A. GPS transparency (CORRECTION 2026-06-02, operator-reversed) — a
 *      use_gps_location:true participant WITH a resolved location yields its
 *      "City, ST" (same format as an explicit-location participant), and a GPS
 *      participant with NO resolved fix yet yields the pending state. (The old
 *      "GPS never yields a city" privacy guard was removed.)
 *   B. formatCityState vectors + fallbacks (spec §2 worked examples).
 *   C. 3-case feedback routing — same-city (b) vs different-city (a) vs pending (c),
 *      routed via SAME_CITY_THRESHOLD_M = 60000.
 *
 * Mirrors the app-mobile CI pattern (no Jest infra; Node assertions). The TS
 * transpile keeps the test bound to the real source of truth.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Module from 'node:module';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

/**
 * Transpile a chunk of TypeScript source to CommonJS and evaluate it in an
 * isolated module sandbox, returning its exports. The chunk must have no
 * runtime imports (we only feed it dependency-free pure code).
 */
function evalTsChunk(tsSource, filename) {
  const js = ts.transpileModule(tsSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const m = new Module(filename);
  m._compile(js, filename);
  return m.exports;
}

// ---------------------------------------------------------------------------
// Load the REAL formatLocationLabel.ts (dependency-free) and evaluate it.
// ---------------------------------------------------------------------------
const labelSource = read('src/utils/formatLocationLabel.ts');
const labelMod = evalTsChunk(labelSource, 'formatLocationLabel.ts');
const { formatCityState, resolveParticipantLocationLabel, US_STATE_NAME_TO_CODE } = labelMod;

// ---------------------------------------------------------------------------
// Extract classifyIntersectionCase + its geometry helper + the threshold from
// the REAL collabDeadEndBannerService.ts source (the rest of that module has
// RN-coupled imports, so we lift only the dependency-free pure functions). The
// extracted text is the real source — editing the routing logic breaks this.
// ---------------------------------------------------------------------------
const serviceSource = read('src/services/collabDeadEndBannerService.ts');

function extract(re, label) {
  const m = serviceSource.match(re);
  assert.ok(m, `Could not extract ${label} from collabDeadEndBannerService.ts`);
  return m[0];
}

const thresholdDecl = extract(
  /export const SAME_CITY_THRESHOLD_M = \d+;/,
  'SAME_CITY_THRESHOLD_M',
);
const classifyFn = extract(
  /export function classifyIntersectionCase\([\s\S]*?\n\}\n/,
  'classifyIntersectionCase',
);
const haversineFn = extract(
  /function haversineMeters\([\s\S]*?\n\}\n/,
  'haversineMeters',
);

// Minimal type shims so the extracted TS transpiles standalone.
const shim = `
type NormalizedCollabParticipant = { id: string; name: string; hasAccepted?: boolean | null };
type CollabParticipantPrefs = Record<string, any>;
type IntersectionCase = 'different_cities' | 'same_city_tight' | 'waiting';
${thresholdDecl}
${haversineFn}
${classifyFn}
export { classifyIntersectionCase, SAME_CITY_THRESHOLD_M };
`;
const serviceMod = evalTsChunk(shim, 'collabClassify.ts');
const { classifyIntersectionCase, SAME_CITY_THRESHOLD_M } = serviceMod;

// ---------------------------------------------------------------------------
const checks = [];
const check = (name, fn) => {
  try {
    fn();
    checks.push({ name, pass: true });
  } catch (err) {
    checks.push({ name, pass: false, detail: err.message });
  }
};

// === A. GPS TRANSPARENCY (operator-reversed 2026-06-02) =====================
// The GPS user's resolved reverse-geocoded location lands at top-level
// prefs.location (verified against live participant_prefs); we now SHOW it as
// "City, ST" so the group can see where everyone actually is.
check('A-01 GPS user with resolved prefs.location yields its City, ST', () => {
  const resolved = resolveParticipantLocationLabel({
    prefs: {
      use_gps_location: true,
      // Live shape: resolved string at top-level `location`, custom_location null.
      location: 'Raleigh, Wake County, North Carolina, United States',
      custom_location: null,
      custom_lat: 35.7803977,
      custom_lng: -78.6390989,
    },
    isSelf: false,
  });
  assert.equal(resolved.kind, 'gps');
  assert.equal(resolved.label, 'Raleigh, NC');
});

check('A-02 GPS flapping fix to DC yields Washington, DC (transparency is the point)', () => {
  const resolved = resolveParticipantLocationLabel({
    prefs: {
      use_gps_location: true,
      location: 'Washington, District of Columbia, United States',
    },
    isSelf: false,
  });
  assert.equal(resolved.kind, 'gps');
  assert.equal(resolved.label, 'Washington, DC');
});

check('A-03 GPS self chip shows the same city (isSelf no longer changes a GPS label)', () => {
  const resolved = resolveParticipantLocationLabel({
    prefs: { use_gps_location: true, location: 'Washington, DC, USA' },
    isSelf: true,
  });
  assert.equal(resolved.kind, 'gps');
  assert.equal(resolved.label, 'Washington, DC');
});

check('A-04 GPS falls back to custom_location when prefs.location is absent', () => {
  const resolved = resolveParticipantLocationLabel({
    prefs: { use_gps_location: true, custom_location: 'London, Greater London, England, United Kingdom' },
  });
  assert.equal(resolved.kind, 'gps');
  assert.equal(resolved.label, 'London, UK');
});

check('A-05 GPS user with NO resolved fix yet yields the pending state, never blank/stale', () => {
  const resolved = resolveParticipantLocationLabel({
    prefs: { use_gps_location: true, custom_lat: 35.79, custom_lng: -78.74 },
  });
  assert.equal(resolved.kind, 'pending');
  assert.equal(resolved.label, 'Getting a fix…');
  assert.ok(!/Raleigh|Washington|,/.test(resolved.label), 'no stale city while pending');
});

// === B. formatCityState VECTORS + FALLBACKS (spec §2) =======================
const vectors = [
  ['Raleigh, Wake County, North Carolina, United States', 'Raleigh, NC'],
  ['Washington, District of Columbia, United States', 'Washington, DC'],
  ['Brooklyn, NY, USA', 'Brooklyn, NY'],
  ['London, Greater London, England, United Kingdom', 'London, UK'],
  ['Paris, Île-de-France, France', 'Paris, FR'],
  ['Lagos, Lagos State, Nigeria', 'Lagos'], // Nigeria not in country map → city-only
  ['Raleigh', 'Raleigh'], // city-only input
];
for (const [input, expected] of vectors) {
  check(`B formatCityState("${input}") === "${expected}"`, () => {
    assert.equal(formatCityState(input), expected);
  });
}

check('B-fallback US but no parseable state → city-only (never "United States")', () => {
  const out = formatCityState('Springfield, United States');
  assert.equal(out, 'Springfield');
  assert.ok(!/United States/.test(out));
});

check('B-fallback null/empty input → graceful "Location set"', () => {
  assert.equal(formatCityState(null), 'Location set');
  assert.equal(formatCityState(''), 'Location set');
});

check('B-resolve no-string-but-coords → "A pinned spot"', () => {
  const r = resolveParticipantLocationLabel({ prefs: { custom_lat: 1, custom_lng: 2 } });
  assert.equal(r.kind, 'place');
  assert.equal(r.label, 'A pinned spot');
});

check('B-resolve nothing set → "Location not set yet" / pending', () => {
  const r = resolveParticipantLocationLabel({ prefs: {} });
  assert.equal(r.kind, 'pending');
  assert.equal(r.label, 'Location not set yet');
});

check('B US_STATE_NAME_TO_CODE map exists with NC + DC', () => {
  assert.equal(US_STATE_NAME_TO_CODE['North Carolina'], 'NC');
  assert.equal(US_STATE_NAME_TO_CODE['District of Columbia'], 'DC');
  assert.equal(Object.keys(US_STATE_NAME_TO_CODE).length, 51); // 50 states + DC
});

// === C. 3-CASE FEEDBACK ROUTING =============================================
assert.equal(SAME_CITY_THRESHOLD_M, 60000, 'threshold must be 60km');

const p = (id) => ({ id, name: id, hasAccepted: true });

check('C-(a) DIFFERENT_CITIES — DC↔Raleigh (374km) routes different_cities', () => {
  const participants = [p('dc'), p('ral')];
  const prefs = {
    dc: { custom_lat: 38.9072, custom_lng: -77.0369 },
    ral: { custom_lat: 35.7796, custom_lng: -78.6382 },
  };
  const out = classifyIntersectionCase(participants, prefs, []);
  assert.equal(out.kind, 'different_cities');
});

check('C-(b) SAME_CITY_TIGHT — two points in one metro route same_city_tight', () => {
  const participants = [p('a'), p('b')];
  const prefs = {
    // ~3 km apart, well under 60km
    a: { custom_lat: 35.7796, custom_lng: -78.6382 },
    b: { custom_lat: 35.8000, custom_lng: -78.6500 },
  };
  const out = classifyIntersectionCase(participants, prefs, []);
  assert.equal(out.kind, 'same_city_tight');
});

check('C-(c) WAITING — pending GPS + only one known center routes waiting', () => {
  const participants = [p('settled'), p('pending')];
  const prefs = {
    settled: { custom_lat: 35.7796, custom_lng: -78.6382 },
    pending: {}, // no coords yet
  };
  const out = classifyIntersectionCase(participants, prefs, ['pending']);
  assert.equal(out.kind, 'waiting');
  assert.deepEqual(out.pendingIds, ['pending']);
});

check('C-(c) WAITING — participant with no coords at all is treated as pending', () => {
  const participants = [p('only')];
  const prefs = { only: {} };
  const out = classifyIntersectionCase(participants, prefs, []);
  assert.equal(out.kind, 'waiting');
});

check('C boundary — distance just over 60km is different_cities, just under is same_city', () => {
  const participants = [p('a'), p('b')];
  // ~0.7 deg lat ≈ 78km (>60) different; 0.4 deg ≈ 44km (<60) same
  const over = classifyIntersectionCase(participants, {
    a: { custom_lat: 35.0, custom_lng: -78.6 },
    b: { custom_lat: 35.7, custom_lng: -78.6 },
  }, []);
  const under = classifyIntersectionCase(participants, {
    a: { custom_lat: 35.0, custom_lng: -78.6 },
    b: { custom_lat: 35.4, custom_lng: -78.6 },
  }, []);
  assert.equal(over.kind, 'different_cities');
  assert.equal(under.kind, 'same_city_tight');
});

// ---------------------------------------------------------------------------
let failed = 0;
for (const c of checks) {
  if (c.pass) {
    console.log(`  PASS  ${c.name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${c.name}\n        ${c.detail}`);
  }
}
console.log(`\nORCH-1058: ${checks.length - failed}/${checks.length} checks passed.`);
if (failed > 0) {
  console.error(`ORCH-1058 regression check FAILED (${failed} failing).`);
  process.exit(1);
}
console.log('ORCH-1058 regression check PASSED.');
