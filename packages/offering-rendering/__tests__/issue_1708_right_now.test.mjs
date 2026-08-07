/**
 * Issue #1708 — weather, travel and busyness on a business experience's page.
 *
 * Seth's decision of 2026-08-07, after I corrected the routing: a business
 * experience keeps its OWN page — it has ticketing, occurrence pickers, a guest
 * list and a reserve flow a place sheet has no business carrying — and what
 * crosses over from the place sheet is the INTELLIGENCE.
 *
 * The load-bearing constraint is cross-surface. `ExperienceOfferingBody` is
 * shared with the public web offering page
 * (I-PUBLIC-TRIP-OFFERING-ALL-SURFACE-PARITY), and I-MOR-0827 forbids the
 * package reaching into an app's services. Weather needs only coordinates
 * (Open-Meteo: no key, no login) and works everywhere; the travel estimate needs
 * the VIEWER's position, which the web page has never asked for. So the block is
 * DATA supplied by the surface, every row independently optional, and web is
 * permanently in the no-travel state by design rather than by accident.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const BODY = read('packages/offering-rendering/ExperienceOfferingBody.tsx');
const INDEX = read('packages/offering-rendering/index.ts');
const SCREEN = read('app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx');

test('V-1 the block is DATA on the shared body, not a node and not a fetch', () => {
  assert.match(BODY, /export interface RightNowFacts/, 'V-1: the contract is gone');
  assert.match(BODY, /rightNow\?: RightNowFacts \| null;/, 'V-1: the body takes no rightNow prop');
  assert.match(INDEX, /RightNowFacts/, 'V-1: the type is not exported, so no surface can build one');

  // I-MOR-0827 — the package must not reach into an app's services. If it
  // fetched its own weather, the web page would inherit a dependency it cannot
  // satisfy and the parity contract would break at runtime, not at build.
  for (const banned of ['weatherService', 'busynessService', 'app-mobile/src']) {
    assert.equal(
      BODY.includes(banned), false,
      `V-1: the shared body references ${banned} — the package cannot reach into an app`,
    );
  }
});

test('V-2 every row is independently optional — that is what makes web honest', () => {
  // Web supplies weather and busyness and omits travel. If the rows were gated
  // together, the web page would show nothing or show a fabricated travel row.
  for (const row of ['weather', 'travel', 'busyness']) {
    assert.match(
      BODY, new RegExp(`\\{rightNow\\.${row} \\? \\(`),
      `V-2: the ${row} row is not independently gated`,
    );
  }
  // And the whole section disappears when there is nothing at all.
  assert.match(
    BODY, /\{rightNow && \(rightNow\.weather \|\| rightNow\.travel \|\| rightNow\.busyness\) \? \(/,
    'V-2: an empty Right now section still renders its heading and rule',
  );
});

test('V-3 the estimate is disclosed', () => {
  // Same rule as #1706 and the same reason: traffic was deleted from the place
  // sheet for rendering a computed figure unlabelled beside a real one. This is
  // that number under a different roof.
  assert.match(BODY, /estimated\?: boolean;/, 'V-3: the contract carries no estimate flag');
  assert.match(BODY, /\{rightNow\.estimated \?/, 'V-3: the block never discloses the estimate');
});

test('V-4 the app supplies it, and fabricates nothing when it cannot', () => {
  assert.match(SCREEN, /rightNow=\{rightNow\}/, 'V-4: the consumer screen does not pass the block');
  assert.match(SCREEN, /weatherService\s*\n?\s*\.getWeatherForecast\(/, 'V-4: no weather is fetched');
  assert.match(SCREEN, /haversineKm\(/, 'V-4: the travel figure is not the haversine estimate');

  // No coordinates -> no weather. Not a placeholder, not a default city.
  assert.match(
    SCREEN, /if \(rightNowLat == null \|\| rightNowLng == null\) \{\s*\n\s*setRightNowWeather\(null\);/,
    'V-4: a coordinate-less experience gets something other than null weather',
  );
  // No viewer -> no travel row. This is the WEB page's permanent state.
  assert.match(
    SCREEN, /if \(viewerLocation\?\.lat != null && viewerLocation\?\.lng != null/,
    'V-4: the travel figure is computed without checking the viewer has a position',
  );
  // Nothing at all -> no block.
  assert.match(SCREEN, /if \(!rightNowWeather && !travel\) return null;/, 'V-4: an empty block is still handed to the body');
  // And the estimate flag tracks the travel row rather than being hardcoded on.
  assert.match(SCREEN, /estimated: travel !== null,/, 'V-4: the disclosure does not track the figure it discloses');
});

test('V-5 the fetch cannot leak or fight itself', () => {
  const effect = SCREEN.slice(SCREEN.indexOf('let cancelled = false;'), SCREEN.indexOf('let cancelled = false;') + 1200);
  assert.ok(effect.length > 0, 'V-5: the weather effect is gone');
  assert.match(effect, /if \(cancelled \|\| !w\) return;/, 'V-5: a late resolve can setState after unmount');
  assert.match(effect, /return \(\) => \{ cancelled = true; \};/, 'V-5: the effect has no cleanup');
  assert.match(effect, /\.catch\(/, 'V-5: a failed weather fetch is unhandled');
});

test('V-6 Right now sits before About', () => {
  // It answers "is it worth leaving the house", which the reader decides before
  // reading the prose, not after — the same position it holds on the place sheet.
  const rn = BODY.indexOf('experience-body-right-now');
  const about = BODY.indexOf('experience-body-about');
  assert.ok(rn > 0 && about > 0, 'V-6: one of the two sections is gone');
  assert.ok(rn < about, 'V-6: Right now renders after About');
});
