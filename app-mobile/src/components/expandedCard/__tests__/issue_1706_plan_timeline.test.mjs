/**
 * Issue #1706 — a plan's Details is a drawn timeline, and every travel figure
 * says it is an estimate.
 *
 * Seth: "Details section should show an animated vertical timeline." And, on the
 * estimate: "We had a haversine or something like this that showed an estimate
 * lets show it. confirm we have it. When we show it lets say indicate its an
 * estimate."
 *
 * WE DO HAVE IT: `haversineKm` + `estimateTravelMinutes` in
 * `utils/mutateCuratedCard.ts`, with real per-mode speeds and a detour factor.
 * This suite confirms that (the "confirm we have it" half is an assertion, not a
 * sentence in a report) and then asserts the disclosure, which is the condition
 * of the number being on the sheet at all.
 *
 * WHY THE DISCLOSURE IS LOAD-BEARING. Traffic was deleted from this sheet three
 * weeks ago because `getTrafficHeuristic` returned `${10 + extraMin} min` from
 * nothing but the clock and rendered it UNLABELLED beside a real Mapbox reading
 * in the identical row. A haversine figure is a different thing — computed from
 * two real coordinates, reproducible — but it is still not a measurement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../../..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const TL = read('app-mobile/src/components/expandedCard/PlanTimeline.tsx');
const MODAL = read('app-mobile/src/components/ExpandedCardModal.tsx');
const STOPS = read('app-mobile/src/components/expandedCard/StopList.tsx');
const MUTATE = read('app-mobile/src/utils/mutateCuratedCard.ts');

test('U-1 the haversine estimator exists, and is real arithmetic', () => {
  // "confirm we have it" — as an assertion rather than a claim in a report.
  assert.match(MUTATE, /export function haversineKm\(/, 'U-1: haversineKm is gone');
  assert.match(MUTATE, /export function estimateTravelMinutes\(/, 'U-1: estimateTravelMinutes is gone');
  // Real per-mode speeds, not one number for everything.
  const fn = /export function estimateTravelMinutes\([\s\S]*?\n\}/.exec(MUTATE)[0];
  for (const mode of ['walking', 'driving', 'transit', 'biking']) {
    assert.match(fn, new RegExp(`${mode}:`), `U-1: no speed for ${mode}`);
  }
  assert.match(fn, /6371/.test(MUTATE) ? /speed/ : /speed/, 'U-1: the estimator has no speed term');
  assert.match(MUTATE, /R = 6371/, 'U-1: the haversine no longer uses the earth radius');
});

test('U-2 the plan gets the timeline, and a single place does NOT', () => {
  assert.match(MODAL, /<PlanTimeline/, 'U-2: the timeline is not mounted');
  const mount = MODAL.slice(MODAL.indexOf('<PlanTimeline') - 200, MODAL.indexOf('<PlanTimeline'));
  assert.match(mount, /isCuratedCard \? \(/, 'U-2: the timeline is not gated on the curated branch');
  // A place's Details keeps its fact rows — address, hours, phone and website
  // are attributes with no order among them.
  assert.match(MODAL, /<PracticalDetailsSection/, 'U-2: the single place lost its Details rows');
});

test('U-3 the animation runs ONCE and is not a loop', () => {
  // An indefinitely animating element inside a scrollable sheet is a permanent
  // frame cost and a permanent distraction. #1576 is this deck's standing lesson.
  assert.equal(/Animated\.loop\(/.test(TL), false, 'U-3: the timeline animation loops');
  assert.match(TL, /Animated\.sequence\(\[/, 'U-3: the steps no longer settle in order');
  assert.match(TL, /useNativeDriver: true/, 'U-3: the animation runs on the JS thread');
  assert.equal(/useNativeDriver: false/.test(TL), false, 'U-3: a driver was moved onto the JS thread');
});

test('U-4 reduced motion SKIPS TO THE END rather than disabling the timeline', () => {
  // A reduced-motion user must see the finished timeline, not an un-drawn one —
  // the spine starts at scaleY 0, so "no animation" would mean "no spine".
  assert.match(TL, /AccessibilityInfo\.isReduceMotionEnabled\(\)/, 'U-4: reduced motion is not honoured');
  const branch = TL.slice(TL.indexOf('if (reduced)'), TL.indexOf('if (reduced)') + 200);
  assert.match(branch, /settle\(\)/, 'U-4: reduced motion leaves the timeline un-drawn');
  const settle = /const settle = \(\): void => \{[\s\S]*?\};/.exec(TL);
  assert.ok(settle, 'U-4: the settle helper is gone');
  for (const v of ['draw', 'nodeA', 'nodeB']) {
    assert.match(settle[0], new RegExp(`${v}\\.setValue\\(1\\)`), `U-4: ${v} is not settled to its end state`);
  }
  // ...and a rejected query must also land on the finished state, not a blank one.
  assert.match(TL, /\.catch\(\(\) => \{[\s\S]{0,200}settle\(\)/, 'U-4: a failed reduced-motion query leaves it blank');
});

test('U-5 the animation is torn down on unmount', () => {
  const cleanup = /return \(\) => \{[\s\S]*?\};/.exec(TL.slice(TL.indexOf('React.useEffect')));
  assert.ok(cleanup, 'U-5: the effect has no cleanup');
  assert.match(cleanup[0], /cancelled = true/, 'U-5: a late async resolve can setValue after unmount');
  assert.match(cleanup[0], /stopAnimation\(\)/, 'U-5: the drivers keep running after unmount');
});

test('U-6 EVERY travel figure on the sheet carries the disclosure', () => {
  // The same number appears in two places. One labelled and one not is worse
  // than neither, because it implies the unlabelled one IS measured.
  assert.match(TL, /leg\?\.estimated \?/, 'U-6: the timeline leg does not disclose its estimate');
  assert.match(TL, /expanded\.estimated/, 'U-6: the timeline has no disclosure string');
  assert.match(STOPS, /connectorEstimated/, 'U-6: the stop connector does not disclose its estimate');
  assert.match(STOPS, /expanded\.estimated/, 'U-6: the connector has no disclosure string');
});

test('U-7 the leg is null rather than invented when the plan has no figure', () => {
  const memo = MODAL.slice(MODAL.indexOf('const planTimelineLeg'), MODAL.indexOf('const planTimelineLeg') + 900);
  assert.ok(memo.length > 0, 'U-7: the leg derivation is gone');
  assert.match(memo, /if \(typeof minutes !== 'number' \|\| !\(minutes > 0\)\) return null;/, 'U-7: a missing figure is not guarded');
  assert.match(memo, /estimated: true/, 'U-7: the leg does not declare itself an estimate');
  // No default minutes anywhere.
  assert.equal(/minutes:\s*\d/.test(memo), false, 'U-7: a literal minute count was introduced');
});

test('U-8 the timeline renders nothing when there is nothing to draw', () => {
  assert.match(
    TL, /if \(!hasStart && !hasEnd\) return null;/,
    'U-8: a plan with neither end still draws an empty spine',
  );
});

test('U-9 the disclosure string exists in every locale', () => {
  const dir = resolve(ROOT, 'app-mobile/src/i18n/locales');
  const locales = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const missing = [];
  for (const loc of locales) {
    const p = join(dir, loc, 'cards.json');
    if (!existsSync(p)) continue;
    const json = JSON.parse(readFileSync(p, 'utf8'));
    for (const k of ['expanded.estimated', 'expanded.starts_at', 'expanded.ends_near']) {
      if (typeof json[k] !== 'string' || json[k].trim() === '') missing.push(`${loc}/${k}`);
    }
  }
  assert.deepEqual(missing, [], `U-9: missing ${missing.join(', ')}`);
});
