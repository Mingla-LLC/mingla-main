// ORCH-0985 — regression guard for the curated-stop "Replace" slug-parity bug.
//
// The bug: replace-curated-stop/index.ts kept its own hardcoded VALID_CATEGORIES
// whitelist (last touched ORCH-0434). The curated generator's slug universe later
// changed (ORCH-0599.4/0601: brunch_lunch_casual→brunch+casual_food,
// movies_theatre→movies+theatre, +hiking/+museum) but the whitelist did not, so
// tapping Replace on those stops 400-rejected ("Couldn't load alternatives").
//
// The invariant this test enforces:
//   (1) Every combo slug the generator can emit is accepted by the SINGLE slug
//       authority isValidComboSlug (COMBO_SLUG_TO_FILTER_SIGNAL). If someone adds
//       a new combo slug to the generator without registering it, this fails.
//   (2) The replace edge function validates THROUGH that authority and no longer
//       carries a private VALID_CATEGORIES whitelist. This fails on revert.

import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  isValidComboSlug,
  COMBO_SLUG_TO_FILTER_SIGNAL,
  isKnownRankSignal,
  EXPERIENCE_VIBE_RANK_SIGNALS,
} from './signalRankFetch.ts';

const GENERATOR_SRC_URL = new URL(
  '../generate-curated-experiences/index.ts',
  import.meta.url,
);
const REPLACE_FN_SRC_URL = new URL(
  '../replace-curated-stop/index.ts',
  import.meta.url,
);

// Extract every combo slug from the generator's `combos: [ ... ]` blocks.
// Line-scoped so taglines / role objects / unrelated arrays are never captured.
async function extractGeneratorComboSlugs(): Promise<string[]> {
  const src = await Deno.readTextFile(GENERATOR_SRC_URL);
  const slugs = new Set<string>();
  let inCombos = false;
  for (const line of src.split('\n')) {
    if (/^\s*combos:\s*\[/.test(line)) { inCombos = true; continue; }
    if (inCombos && /^\s*\],\s*$/.test(line)) { inCombos = false; continue; }
    if (inCombos) {
      for (const m of line.matchAll(/'([a-z_]+)'/g)) slugs.add(m[1]);
    }
  }
  return [...slugs];
}

Deno.test('every generator combo slug is accepted by the replace slug authority', async () => {
  const slugs = await extractGeneratorComboSlugs();
  assert(slugs.length > 0, 'failed to extract any combo slugs from the generator');
  const rejected = slugs.filter((s) => !isValidComboSlug(s));
  assertEquals(
    rejected,
    [],
    `generator emits slugs the replace path rejects: ${rejected.join(', ')}. ` +
      `Register them in COMBO_SLUG_TO_FILTER_SIGNAL (with verified place_scores).`,
  );
});

Deno.test('the 6 slugs the stale whitelist broke now resolve', () => {
  // brunch_lunch_casual→brunch+casual_food, movies_theatre→movies+theatre, +hiking/+museum
  for (const slug of ['casual_food', 'brunch', 'movies', 'theatre', 'hiking', 'museum']) {
    assert(isValidComboSlug(slug), `expected '${slug}' to be a valid combo slug`);
    assert(
      Object.prototype.hasOwnProperty.call(COMBO_SLUG_TO_FILTER_SIGNAL, slug),
      `'${slug}' missing from COMBO_SLUG_TO_FILTER_SIGNAL`,
    );
  }
});

Deno.test('replace-curated-stop validates via the single authority, not a private whitelist', async () => {
  const src = await Deno.readTextFile(REPLACE_FN_SRC_URL);
  // Fails on revert: the stale whitelist must not come back.
  assert(
    !/VALID_CATEGORIES\s*=\s*new\s+Set/.test(src),
    'replace-curated-stop reintroduced a private VALID_CATEGORIES whitelist — ' +
      'validate via isValidComboSlug (COMBO_SLUG_TO_FILTER_SIGNAL) instead.',
  );
  assert(
    src.includes('isValidComboSlug(categoryId)'),
    'replace-curated-stop must gate categoryId through isValidComboSlug',
  );
});

Deno.test('unknown slugs are still rejected (Constitution #3: no silent fallback)', () => {
  assertEquals(isValidComboSlug('casual_eats'), false); // the old bad client fallback
  assertEquals(isValidComboSlug('not_a_real_slug'), false);
  assertEquals(isValidComboSlug(''), false);
});

// ── ORCH-0985: vibe rank-signal pass-through ─────────────────────────────────

// Extract the RHS values of EXPERIENCE_RANK_SIGNAL_OVERRIDE from the generator.
async function extractGeneratorVibeSignals(): Promise<string[]> {
  const src = await Deno.readTextFile(GENERATOR_SRC_URL);
  const vibes = new Set<string>();
  let inBlock = false;
  for (const line of src.split('\n')) {
    if (/EXPERIENCE_RANK_SIGNAL_OVERRIDE\s*:/.test(line)) { inBlock = true; continue; }
    if (inBlock && /^\};/.test(line)) { inBlock = false; continue; }
    if (inBlock) {
      const m = line.match(/'[a-z_]+'\s*:\s*'([a-z_]+)'/); // 'slug': 'vibe'
      if (m) vibes.add(m[1]);
    }
  }
  return [...vibes];
}

Deno.test('every vibe signal the generator ranks by is a known rank signal', async () => {
  const vibes = await extractGeneratorVibeSignals();
  assert(vibes.length > 0, 'failed to extract any vibe signals from the generator');
  const unknown = vibes.filter((v) => !isKnownRankSignal(v));
  assertEquals(
    unknown,
    [],
    `generator ranks by signals the replace path rejects: ${unknown.join(', ')}. ` +
      `Add them to EXPERIENCE_VIBE_RANK_SIGNALS in signalRankFetch.ts.`,
  );
  // And the curated vibe set must be fully covered (sync guard, both directions
  // for the non-filter vibes).
  for (const vibe of EXPERIENCE_VIBE_RANK_SIGNALS) {
    assert(isKnownRankSignal(vibe), `vibe '${vibe}' should be a known rank signal`);
  }
});

Deno.test('isKnownRankSignal accepts vibes + filter signals, rejects bogus', () => {
  assert(isKnownRankSignal('romantic'));
  assert(isKnownRankSignal('icebreakers'));
  assert(isKnownRankSignal('lively'));
  assert(isKnownRankSignal('scenic'));
  assert(isKnownRankSignal('picnic_friendly'));
  assert(isKnownRankSignal('fine_dining')); // a filter signal value
  assertEquals(isKnownRankSignal('not_a_signal'), false);
  assertEquals(isKnownRankSignal(''), false);
});

Deno.test('replace-curated-stop validates + forwards the vibe rankSignal', async () => {
  const src = await Deno.readTextFile(REPLACE_FN_SRC_URL);
  assert(src.includes('isKnownRankSignal'), 'edge fn must validate rankSignal via isKnownRankSignal');
  assert(/rankSignal,?\s*$/m.test(src) || src.includes('rankSignal,'),
    'edge fn must forward rankSignal to fetchStopAlternatives');
});

// ── ORCH-0985: Replace mechanics (center-on-stop, decoupled radius, ordering) ──

Deno.test('replace-curated-stop centers on the stop being replaced, not a sibling centroid', async () => {
  const src = await Deno.readTextFile(REPLACE_FN_SRC_URL);
  assert(src.includes('const refLat = location.lat'), 'must center refLat on location (the replaced stop)');
  assert(src.includes('const refLng = location.lng'), 'must center refLng on location (the replaced stop)');
  // Fails on revert: the centroid-of-siblings logic was the Burning Coal root cause.
  assert(!src.includes('validSiblings'),
    'centroid-of-siblingStops logic must not return — it searched the wrong area');
});

Deno.test('stopAlternatives decouples search radius from travel mode and orders best-score-then-distance', async () => {
  const src = await Deno.readTextFile(new URL('./stopAlternatives.ts', import.meta.url));
  assert(src.includes('REPLACE_SEARCH_RADIUS_METERS'),
    'replace must use a fixed search radius, not a travel-mode-derived one');
  // Fails on revert: the walking 2.25km radius starved the result.
  assert(!/TRAVEL_SPEEDS_KMH\[travelMode\]/.test(src),
    'replace radius must not be derived from travelMode speed');
  assert(src.includes('SCORE_BAND') && src.includes('band(b._rankScore') ,
    'must order by score band first, distance tiebreaker');
});
