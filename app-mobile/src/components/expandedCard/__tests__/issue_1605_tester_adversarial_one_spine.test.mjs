/**
 * #1605 wave 4 — TESTER ADVERSARIAL. A different angle from the implementor's
 * `issue_1605_expanded_card_one_spine.test.mjs`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * The implementor's `S-3` sweeps every `.ts`/`.tsx` under `app-mobile` for a
 * three-part signature that must all co-occur IN ONE FILE:
 *
 *     reads visited state  AND  owns a press  AND  writes-or-prompts
 *
 * That catches the shape it was tested against (a component that calls
 * `useHasVisited` + `useRecordVisit` + `<Pressable>` itself). It does NOT catch
 * either of the two neighbouring shapes a real second control would take, both
 * of which this tester built and ran against `S-3` at e22d883b3 with 14/14
 * still green:
 *
 *   (1) THE SERVICE-LAYER CONTROL, one file. `hasVisited()` + `recordVisit()`
 *       imported straight from `services/visitService` instead of through the
 *       hooks. `S-3`'s WRITE probe only knows `useRecordVisit` / `useRemoveVisit`
 *       / the `'record-visit'` key / `openPlaceReviewRequest` / `removeVisit.mutate`,
 *       so a bare `recordVisit(...)` is invisible to it. `tsc` is clean on it.
 *
 *   (2) THE HOOK-SPLIT CONTROL, two files. The component reads and presses; a
 *       sibling `useXToggle.ts` does the write. This is the ordinary idiomatic
 *       React refactor, so it is the shape a second control is MOST likely to
 *       arrive in by accident. Neither file carries all three parts.
 *
 * A-1 below closes both by (a) knowing the service-layer write symbols and
 * (b) following ONE import hop into modules that own no press of their own.
 *
 * A-2 and A-3 attack the continuity claim from the data side rather than the
 * height side: the implementor samples six SHEET HEIGHTS at one span shape; this
 * sweeps the whole SPAN-COUNT domain and the coverless surface, because the
 * plate has to be the same object for every card in the pool, not only for the
 * four-span one that happened to be on screen.
 *
 * Every rule CALLS the real functions or EXECUTES over the real tree. Nothing
 * here greps for a name it expects to be absent, and every rule carries an
 * anti-vacuity check so it fails rather than passing on an empty set.
 */

/**
 * MODIFIED under #1700 — [TEST-MOD-APPROVED #1700].
 *
 * A-2b — identical to S-1 above, and changed for the same reason and in the same way.
 *
 * Recorded here, in the file, so the next reader finds the reason beside the
 * assertion rather than in a commit message they will not go looking for.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(__dirname, '../../../..');
const REPO = path.resolve(APP, '..');
const require_ = createRequire(import.meta.url);

/** The real package. The functions themselves, not a copy of their numbers. */
const CI = require_(path.join(REPO, 'packages/card-identity/index.js'));

/** Comments out, string literals in — a grep that hits a comment passes on a revert (#1633). */
function stripComments(src) {
  let out = '';
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (inLine) {
      if (c === '\n') { inLine = false; out += c; }
      i += 1;
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') { inBlock = false; i += 2; continue; }
      if (c === '\n') out += c;
      i += 1;
      continue;
    }
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && n === '/') { inLine = true; i += 2; continue; }
    if (c === '/' && n === '*') { inBlock = true; i += 2; continue; }
    out += c;
    i += 1;
  }
  return out;
}

/** Every source `.ts`/`.tsx` under app-mobile, stripped. Tests excluded. */
function appTree() {
  const out = new Map();
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
      out.set(path.relative(REPO, abs).split(path.sep).join('/'), stripComments(fs.readFileSync(abs, 'utf8')));
    }
  };
  walk(path.join(APP, 'src'));
  walk(path.join(APP, 'app'));
  return out;
}

const TREE = appTree();

/** Resolve a RELATIVE specifier from `fromKey` onto a key that exists in TREE. */
function resolveLocal(fromKey, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.join(path.posix.dirname(fromKey), spec);
  for (const cand of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (TREE.has(cand)) return cand;
  }
  return null;
}

/** Direct local imports of a module, as TREE keys. */
function localImports(key) {
  const src = TREE.get(key) ?? '';
  const out = new Set();
  const re = /(?:from\s*|require\(\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const r = resolveLocal(key, m[1]);
    if (r !== null) out.add(r);
  }
  return [...out];
}

// ─────────────────────────────────────────────────────────────────────────────
// A-1 · THE VISITED-CONTROL POPULATION, ONE IMPORT HOP DEEP
// ─────────────────────────────────────────────────────────────────────────────

/** Owns a press of its own. */
const PRESSES = /onPress\s*=|<Pressable\b|<TouchableOpacity\b|TrackedTouchableOpacity\b/;
/** Reads whether this place has been visited. */
const READS = /\buseHasVisited\b|\buseMyVisits\b|\bhasVisited\b|\bisVisited\b/;
/**
 * Writes the visit, or opens the prompt that writes it. Includes the SERVICE
 * functions, not only the hooks — `services/visitService` exports `recordVisit`
 * and `removeVisit`, and a control that calls them directly is a control.
 */
const WRITES =
  /\buseRecordVisit\b|\buseRemoveVisit\b|\brecordVisit\b|\bremoveVisit\b|['"]record-visit['"]|\bopenPlaceReviewRequest\b/;

/** The modules that OWN the visit read/write surface. They own no press. */
const SURFACE_MODULES = [
  'app-mobile/src/hooks/useVisits.ts',
  'app-mobile/src/services/visitService.ts',
];

test('A-1 exactly one module is a Been-here CONTROL, following one import hop', () => {
  const offenders = [];
  for (const [file, src] of TREE) {
    if (SURFACE_MODULES.includes(file)) continue;   // the surface, not a control
    if (!PRESSES.test(src)) continue;               // owns no press: not a control
    if (!READS.test(src)) continue;                 // knows nothing about visits

    let writes = WRITES.test(src);
    if (!writes) {
      // ONE HOP, and only into modules that own no press of their own — i.e. a
      // hook or a helper this component delegates its write to. That is the
      // shape a hook-split second control takes, and it is invisible to any
      // rule that requires all three parts in one file.
      for (const dep of localImports(file)) {
        if (SURFACE_MODULES.includes(dep)) continue;
        const depSrc = TREE.get(dep) ?? '';
        if (PRESSES.test(depSrc)) continue;         // another component, not a delegate
        if (WRITES.test(depSrc)) { writes = true; break; }
      }
    }
    if (writes) offenders.push(file);
  }

  assert.deepEqual(
    offenders.sort(),
    ['app-mobile/src/components/SwipeableCards.tsx'],
    `A-1: ${offenders.length} module(s) are a Been-here control: ${offenders.join(', ')}.\n\n`
    + 'There must be exactly ONE and it must be SwipeableCards.tsx, whose exported BeenHereControl the '
    + 'expanded hero mounts. This rule differs from S-3 in two ways that matter: it knows the SERVICE '
    + 'write functions (`recordVisit` / `removeVisit`), and it follows one import hop into a module that '
    + 'owns no press — so neither a control that skips the hooks nor a control whose write lives in a '
    + 'sibling `useXToggle.ts` can hide from it. If you are adding a surface, MOUNT the existing control.',
  );

  // Anti-vacuity, three ways: the sweep ran, the surface modules exist, and the
  // three probes still match the ONE real control — otherwise this rule passes
  // because its regexes are broken, not because the tree is clean.
  assert.ok(TREE.size > 200, `A-1 (vacuity): the sweep found only ${TREE.size} files`);
  for (const m of SURFACE_MODULES) {
    assert.ok(TREE.has(m), `A-1 (vacuity): ${m} is not in the tree, so the exclusion list is stale`);
  }
  const owner = TREE.get('app-mobile/src/components/SwipeableCards.tsx');
  assert.ok(
    PRESSES.test(owner) && READS.test(owner) && WRITES.test(owner),
    'A-1 (vacuity): the signature no longer matches the one real control, so it could not match a copy',
  );
});

test('A-1b the sheet can still REACH that one control — the six doorless entry points depend on it', () => {
  // S-3b asserts the import STRING. This asserts the resolved GRAPH EDGE, so a
  // re-export or a moved file is followed rather than evaded — and it is the
  // edge that makes Been-here reachable from Likes, Calendar, chat, both collab
  // sheets and a friend's profile, none of which have a collapsed card behind
  // them.
  const modal = 'app-mobile/src/components/ExpandedCardModal.tsx';
  assert.ok(TREE.has(modal), 'A-1b (vacuity): the modal is not in the tree');
  const deps = localImports(modal);
  assert.ok(
    deps.includes('app-mobile/src/components/SwipeableCards.tsx'),
    'A-1b: the expanded sheet no longer imports the module that owns the one Been-here control, so the '
    + 'plate on the sheet has a hole where the deck card has a button.',
  );
  const modalSrc = TREE.get(modal);
  assert.match(
    modalSrc,
    /<BeenHereControl\b/,
    'A-1b: the sheet imports the control but never mounts it — an import is not a render.',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// A-2 · THE PLATE IS THE SAME OBJECT FOR EVERY CARD, NOT ONLY THE ONE ON SCREEN
// ─────────────────────────────────────────────────────────────────────────────

test('A-2 the sheet and the deck card resolve the same plate at every span count', () => {
  const s1 = CI.SURFACES.s1Single;
  const s7 = CI.SURFACES.s7Expanded;
  assert.ok(s7, 'A-2 (vacuity): s7Expanded is not in SURFACES, so nothing below is being compared');

  // The plate's own geometry is what `scrimHeight` reads, so equality here is
  // what FORCES equality of the scrim, the derived under-layer and every ratio.
  for (const key of ['bottomInset', 'sideInset', 'plateH', 'plateR', 'gap', 'titleSize', 'titleLH', 'titleLines', 'titleInset', 'metaSize']) {
    assert.equal(
      s7[key],
      s1[key],
      `A-2: s7Expanded.${key} (${s7[key]}) differs from s1Single.${key} (${s1[key]}). The plate on the `
      + 'sheet is then a DIFFERENT rectangle from the one the user just tapped, and the continuity is '
      + 'decorative rather than measured.',
    );
  }

  // And the DERIVED presentation must agree across the whole data domain, not
  // just the four-span card. A card with no meta line at all takes the alternate
  // 64pt silhouette; if the two surfaces disagreed about when that applies, the
  // plate would change shape on expand for the sparsest cards in the pool.
  const shapes = [
    [],
    [{ kind: 'rating', text: '★ 4.7' }],
    [{ kind: 'rating', text: '★ 4.7' }, { kind: 'fact', text: '21.1 mi' }],
    [{ kind: 'rating', text: '3 stops' }, { kind: 'fact', text: '1h 44m' }, { kind: 'fact', text: 'Free' }],
    [{ kind: 'rating', text: '★ 4.7' }, { kind: 'fact', text: '21.1 mi' }, { kind: 'fact', text: '££' }, { kind: 'tail', text: 'Icebreakers' }],
  ];
  const heights = new Set();
  for (const spans of shapes) {
    // The ONE alternate silhouette in the system: no meta line -> PLATE_H_NO_META.
    const h = spans.length > 0 ? s1.plateH : CI.PLATE_H_NO_META;
    heights.add(h);
    // The scrim for THIS plate height must be the same number on both surfaces.
    const d7Plate = s7.bottomInset + h;
    const d7Title = s7.bottomInset + h + s7.gap + s7.titleLines * s7.titleLH;
    const d1Plate = s1.bottomInset + h;
    const d1Title = s1.bottomInset + h + s1.gap + s1.titleLines * s1.titleLH;
    assert.equal(
      CI.scrimHeight(d7Plate, d7Title, CI.expandedHeroHeight(874)),
      CI.scrimHeight(d1Plate, d1Title, s1.h),
      `A-2: at ${spans.length} span(s) the sheet and the deck card resolve different scrims.`,
    );
  }
  assert.equal(
    heights.size,
    2,
    `A-2 (vacuity): the span shapes produced ${heights.size} plate height(s); the domain must exercise `
    + 'BOTH the 96pt meta silhouette and the alternate no-meta one, or this rule only tested one of them.',
  );
});

test('A-2b the variable hero height cannot invalidate the scrim, at any sheet height', () => {
  const want = CI.surfaceScrimHeight('s1Single');
  // #1700 — the TALLEST silhouette's depths, not the canonical plate's. The
  // scrim is solved from the deepest-reaching composition a surface can render
  // (a two-line facts row), so comparing against the canonical depths here made
  // this assert 316 !== 346 and go red for a scrim that had just been made
  // CORRECT. The property — sheet and deck resolve the same height at every hero
  // height — is unchanged; only which silhouette defines it moved.
  const tallestLines = CI.surfaceSilhouettes('s7Expanded').at(-1);
  const dPlate = CI.plateTopDepthForLines('s7Expanded', tallestLines);
  const dTitle = CI.titleTopDepthForLines('s7Expanded', tallestLines);

  // Every hero height the clamp can produce, from a degenerate sheet height to
  // an absurdly tall one. The implementor samples six plausible devices; this
  // samples the DOMAIN, including 0 and 4000, because `expandedHeroHeight` is
  // handed a measured value and a measured value can be anything.
  const heights = [0, -1, 1, 400, 600, 648, 731, 787, 874, 1200, 4000].map((s) => CI.expandedHeroHeight(s));
  assert.ok(new Set(heights).size >= 3, 'A-2b (vacuity): the sampled sheet heights collapse to one hero height');
  for (const h of heights) {
    assert.ok(
      h >= CI.S7_HERO_MIN && h <= CI.S7_HERO_MAX,
      `A-2b: heroH ${h} escaped its clamp [${CI.S7_HERO_MIN}, ${CI.S7_HERO_MAX}]`,
    );
    assert.equal(
      CI.scrimHeight(dPlate, dTitle, h),
      want,
      `A-2b: at heroH ${h} the sheet's scrim stops matching the deck card's, so every contrast ratio in `
      + 'the S7 column stops being device-invariant.',
    );
  }
});

test('A-2c the COVERLESS hero is shorter than the scrim, so it must not draw one', () => {
  // This is the one height that can actually make `scrimHeight`'s `min(H, cardH)`
  // clamp bind, and it is the case nobody sampled: the coverless slab is 232pt
  // against a 316pt scrim. A gradient there would be silently TRUNCATED, and
  // every ratio in §7.1 would be void on exactly the surface that has no
  // photograph to justify a gradient in the first place.
  const coverless = CI.expandedCoverlessHeroHeight();
  const scrim = CI.surfaceScrimHeight('s7Expanded');
  assert.ok(
    coverless < scrim,
    `A-2c (vacuity): the coverless hero (${coverless}) is no longer shorter than the scrim (${scrim}), `
    + 'so this rule is not testing the case it exists for.',
  );
  assert.notEqual(
    CI.scrimHeight(CI.plateTopDepth('s7Expanded'), CI.titleTopDepth('s7Expanded'), coverless),
    scrim,
    `A-2c (vacuity): the clamp did not bind at ${coverless}pt, so a truncated scrim is not the hazard `
    + 'this rule assumes.',
  );

  // So the coverless branch draws NO gradient. Delimited structurally: the
  // branch is the block that returns the slab, and it must contain no
  // LinearGradient of its own.
  const hero = stripComments(
    fs.readFileSync(path.join(REPO, 'app-mobile/src/components/expandedCard/ExpandedCardHero.tsx'), 'utf8'),
  );
  const at = hero.indexOf('if (coverless)');
  assert.ok(at > 0, 'A-2c (vacuity): could not delimit the coverless branch, so the assertion is about nothing');
  const end = hero.indexOf('return (', hero.indexOf('}', hero.indexOf('  }', at)));
  const block = hero.slice(at, end > at ? end : hero.length);
  assert.ok(
    block.includes('coverlessSlab'),
    'A-2c (vacuity): the delimited block is not the coverless branch',
  );
  assert.equal(
    /LinearGradient|RAMP\./.test(block),
    false,
    'A-2c: the coverless hero draws a scrim. At 232pt it is CLIPPED by the 316pt scrim height, so the '
    + 'gradient the contrast table was measured on is not the gradient on screen — and there is no '
    + 'photograph under it to need one.',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// A-3 · THE COVERLESS HERO IS BIG ENOUGH FOR THE OBJECT IT HAS TO HOLD
// ─────────────────────────────────────────────────────────────────────────────

test('A-3 the coverless slab cannot clip the plate or the title it is shaped around', () => {
  const s7 = CI.SURFACES.s7Expanded;
  const h = CI.expandedCoverlessHeroHeight();

  // The composition the slab has to hold, computed from the descriptor rather
  // than read off the design doc: the plate sits `bottomInset` above the bottom,
  // the title's baseline block sits `gap` above the plate, and it is two lines.
  const needed = s7.bottomInset + CI.SURFACES.s1Single.plateH + s7.gap + s7.titleLines * s7.titleLH;
  assert.ok(
    h >= needed,
    `A-3: the coverless hero is ${h}pt but the plate + gap + two title lines need ${needed}pt. A card `
    + 'with no photograph would have its title clipped by the top of its own sheet — and the coverless '
    + 'state is the ONE state where nothing else on screen could explain the missing text.',
  );
  // It must not be so tall that it is a slab with a hole in it either: the whole
  // point of §8.3 is ONE object, not a plate floating on a field of grey.
  assert.ok(
    h - needed <= 64,
    `A-3: the coverless hero is ${h}pt against a ${needed}pt composition — ${h - needed}pt of bare slab `
    + 'above the title makes it a panel the plate sits on rather than one object.',
  );

  // The hero must actually USE it, on the coverless branch, from the package.
  const hero = stripComments(
    fs.readFileSync(path.join(REPO, 'app-mobile/src/components/expandedCard/ExpandedCardHero.tsx'), 'utf8'),
  );
  assert.ok(hero.length > 400, 'A-3 (vacuity): the hero source did not read');
  assert.match(
    hero,
    /expandedCoverlessHeroHeight/,
    'A-3: the hero no longer takes its coverless height from the package, so the slab and the plate it '
    + 'is shaped around can drift apart.',
  );
});
