/**
 * Issue #1706 — a plan reads as a sequence in time, and every travel figure
 * says it is an estimate.
 *
 * #4347 wave 3 — REWRITTEN. PlanTimeline (the RN-Animated Starts at / Ends
 * near spine) is DELETED: the plan now shows a clock arrival time beside every
 * stop card, legs between them, and an "Ends near" line — all from one arrival
 * model. The protections are kept and re-pointed: the estimator is real
 * arithmetic, the plan gets its timeline and a place keeps Details, the motion
 * plays once and never loops, Reduce Motion shows the END state, every travel
 * figure is labelled an estimate, a missing leg is null (never invented), and
 * the strings exist in every locale.
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

const MODAL = read('app-mobile/src/components/ExpandedCardModal.tsx');
const BODY = read('app-mobile/src/components/expandedCard/CuratedPlanBody.tsx');
const SUMMARY = read('app-mobile/src/components/expandedCard/PlanSummary.tsx');
const MOTION = read('app-mobile/src/components/expandedCard/planMotion.ts');
const MODEL = read('app-mobile/src/components/expandedCard/curatedPlanModel.ts');
const STOPS = read('app-mobile/src/components/expandedCard/StopList.tsx');
const MUTATE = read('app-mobile/src/utils/mutateCuratedCard.ts');

test('U-1 the haversine estimator exists, and is real arithmetic', () => {
  assert.match(MUTATE, /export function haversineKm\(/, 'U-1: haversineKm is gone');
  assert.match(MUTATE, /export function estimateTravelMinutes\(/, 'U-1: estimateTravelMinutes is gone');
  const fn = /export function estimateTravelMinutes\([\s\S]*?\n\}/.exec(MUTATE)[0];
  for (const mode of ['walking', 'driving', 'transit', 'biking']) {
    assert.match(fn, new RegExp(`${mode}:`), `U-1: no speed for ${mode}`);
  }
  assert.match(fn, /speed/, 'U-1: the estimator has no speed term');
  assert.match(MUTATE, /R = 6371/, 'U-1: the haversine no longer uses the earth radius');
  // The plan's "You -> stop 1" leg is that estimator, not a new one.
  assert.match(MODEL, /estimateTravelMinutes\(haversineKm\(/, 'U-1: the plan builds its own travel figure');
});

test('U-2 the plan gets the timeline, and a single place does NOT', () => {
  assert.match(MODAL, /<CuratedPlanBody/, 'U-2: the plan body is not mounted');
  assert.match(BODY, /<ArrivalTime at=\{tl\.arrival\}/, 'U-2: the plan shows no clock time per stop');
  assert.match(BODY, /const timeline = planTimeline\(stops, start, fallbackMode\)/, 'U-2: the plan does not read the one arrival model');
  assert.match(MODEL, /curatedArrivalTimes\(stops, start\)/, 'U-2: the plan model left the arrival model the schedule check uses');
  assert.match(BODY, /cards:expanded\.ends_near/, 'U-2: the plan lost its Ends near');
  // A place's Details keeps its fact rows; the plan never mounts them.
  assert.match(MODAL, /<PracticalDetailsSection/, 'U-2: the single place lost its Details rows');
  assert.equal(/<PracticalDetailsSection/.test(BODY), false, 'U-2: a plan renders place Details');
});

test('U-3 the motion runs ONCE and is not a loop', () => {
  for (const [name, src] of [['planMotion', MOTION], ['PlanSummary', SUMMARY]]) {
    assert.equal(/withRepeat\(|Animated\.loop\(/.test(src), false, `U-3: ${name} loops an animation`);
  }
  // The entrance and route-draw hooks start their timing from a mount-only effect.
  assert.match(MOTION, /Mount-only: an entrance plays once\./, 'U-3: the entrance is no longer mount-only');
  assert.equal(/from 'react-native'[\s\S]{0,40}Animated/.test(MOTION + SUMMARY), false, 'U-3: the RN Animated engine is back');
});

test('U-4 reduced motion SKIPS TO THE END rather than hiding the plan', () => {
  // A reduced-motion user must see the finished route, not an un-drawn one: the
  // shared values START at 1 under Reduce Motion and never animate.
  const starts = MOTION.match(/useSharedValue\(reduced \? 1 : 0\)/g) ?? [];
  assert.ok(starts.length >= 3, `U-4: only ${starts.length} motion hooks start at the end state under Reduce Motion`);
  const branches = MOTION.match(/if \(reduced\) \{\s*progress\.value = 1;\s*return;\s*\}/g) ?? [];
  assert.ok(branches.length >= 3, 'U-4: a motion hook animates under Reduce Motion');
});

test('U-6 EVERY travel figure on the sheet carries the disclosure', () => {
  // The legs between cards, the Getting there rows and the Getting around tile.
  assert.match(BODY, /`\$\{minutesMode\(tl\.leg\.minutes, tl\.leg\.mode\)\} · \$\{estimated\}`/, 'U-6: a leg between cards is not labelled estimated');
  assert.match(BODY, /value: `\$\{minutesMode\(fromViewer, mode\)\} · \$\{estimated\}`/, 'U-6: You -> stop 1 is not labelled estimated');
  assert.match(BODY, /value: minutesMode\(travel, mode\), sub: estimated/, 'U-6: the Getting around tile is not labelled estimated');
  assert.match(BODY, /const estimated = t\('cards:expanded\.estimated'\)/, 'U-6: the plan has no disclosure string');
  assert.match(STOPS, /connectorEstimated/, 'U-6: the companion connector does not disclose its estimate');
  assert.match(STOPS, /expanded\.estimated/, 'U-6: the connector has no disclosure string');
});

test('U-7 the leg is null rather than invented when the plan has no figure', () => {
  const leg = MODEL.slice(MODEL.indexOf('leg:\n'), MODEL.indexOf('leg:\n') + 300);
  assert.match(leg, /t\.legMinutes !== null && t\.legMinutes > 0/, 'U-7: a missing figure is not guarded');
  assert.match(leg, /: null,/, 'U-7: a missing leg is not null');
  assert.equal(/minutes:\s*\d/.test(leg), false, 'U-7: a literal minute count was introduced');
});

test('U-8 the route strip renders nothing when there is nothing to draw', () => {
  assert.match(SUMMARY, /\{route\.length > 1 \? \(/, 'U-8: a one-stop plan still draws a route');
});

test('U-9 the disclosure string exists in every locale', () => {
  const dir = resolve(ROOT, 'app-mobile/src/i18n/locales');
  const locales = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const missing = [];
  for (const loc of locales) {
    const p = join(dir, loc, 'cards.json');
    if (!existsSync(p)) continue;
    const json = JSON.parse(readFileSync(p, 'utf8'));
    for (const k of ['expanded.estimated', 'expanded.ends_near', 'plan.ends_near_value', 'plan.minutes_mode']) {
      if (typeof json[k] !== 'string' || json[k].trim() === '') missing.push(`${loc}/${k}`);
    }
  }
  assert.deepEqual(missing, [], `U-9: missing ${missing.join(', ')}`);
});
