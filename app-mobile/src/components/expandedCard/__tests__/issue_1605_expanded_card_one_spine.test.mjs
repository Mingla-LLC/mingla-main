/**
 * #1605 wave 4 — THE EXPANDED CARD IS ONE SPINE. The executing gate.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS SHAPED THE WAY IT IS
 *
 * Seven open issues right now are about assertions that do not assert, and one
 * of them is the reason for S-3 below: a DELETE was reintroduced in a DIFFERENT
 * FILE under a DIFFERENT NAME and passed all 29 tests in its work item, because
 * every one of those tests named the old file and the old symbol.
 *
 * So nothing here greps for a name it expects to be absent. Every rule either
 *
 *   (a) CALLS the real function and checks the number it returns, or
 *   (b) EXTRACTS the real predicate from source and EXECUTES it against the
 *       values a real card produces, or
 *   (c) SWEEPS the whole app-mobile tree for a STRUCTURAL signature and asserts
 *       the population, so a rename or a move is caught rather than evaded.
 *
 * Each rule also carries an anti-vacuity check: if the anchor it slices on has
 * moved, it FAILS rather than passing on an empty string.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire, register } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Lets S-5 IMPORT AND RUN `expandedCardFacts.ts` rather than restate its
 * arithmetic. Two hooks only — extensionless relative resolution and an i18n
 * stub — so everything else in the graph is the real module. See the hooks
 * file's header for why nothing more is stubbed.
 */
register(pathToFileURL(path.join(__dirname, 'issue_1605_ts_resolve_hooks.mjs')));
const APP = path.resolve(__dirname, '../../../..');
const REPO = path.resolve(APP, '..');
const require_ = createRequire(import.meta.url);

/** THE REAL PACKAGE. Not a copy of its numbers — the functions themselves. */
const CI = require_(path.join(REPO, 'packages/card-identity/index.js'));

const SRC = {
  modal: 'app-mobile/src/components/ExpandedCardModal.tsx',
  hero: 'app-mobile/src/components/expandedCard/ExpandedCardHero.tsx',
  plate: 'app-mobile/src/components/deckCardPlate.tsx',
  facts: 'app-mobile/src/components/expandedCard/expandedCardFacts.ts',
  actions: 'app-mobile/src/components/expandedCard/ActionButtons.tsx',
  stops: 'app-mobile/src/components/expandedCard/StopList.tsx',
  details: 'app-mobile/src/components/expandedCard/PracticalDetailsSection.tsx',
  conditions: 'app-mobile/src/components/expandedCard/ConditionsSection.tsx',
  swipeable: 'app-mobile/src/components/SwipeableCards.tsx',
  // The collapsed deck card — the OTHER caller of the one span producer (S-5).
  swipecurated: 'app-mobile/src/components/CuratedExperienceSwipeCard.tsx',
};

const read = (key) => fs.readFileSync(path.join(REPO, SRC[key]), 'utf8');

/**
 * Comments out, string literals in. #1633: a grep that hits your own comment
 * passes on a revert, so every rule below reads the STRIPPED source.
 */
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

/** Every .ts/.tsx under app-mobile, tests excluded, stripped. */
function appTree() {
  const out = new Map();
  const walk = (dir) => {
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

test('S-0 VACUITY every scanned file was read and stripped to real code', () => {
  for (const key of Object.keys(SRC)) {
    const stripped = stripComments(read(key));
    assert.ok(
      stripped.length > 400,
      `S-0: ${SRC[key]} stripped to ${stripped.length} chars — it was not read, and every rule below `
      + 'would then be asserting about an empty string.',
    );
  }
  assert.ok(TREE.size > 200, `S-0: the tree sweep found only ${TREE.size} files — the walk is broken`);
});

// ─────────────────────────────────────────────────────────────────────────────
// S-1 · THE CONTINUITY IS ARITHMETIC. Executed, on the real functions.
// ─────────────────────────────────────────────────────────────────────────────

test('S-1 the sheet\'s hero renders the deck card\'s plate, at every hero height', () => {
  // The whole design rests on this: opening a card CONTINUES it. That is not an
  // impression to be eyeballed — the scrim formula reads only the plate's
  // card-local geometry, so identical plate geometry FORCES identical scrim,
  // alpha, under-layer and therefore identical contrast. Call it and check.
  assert.equal(
    CI.surfaceScrimHeight('s7Expanded'),
    CI.surfaceScrimHeight('s1Single'),
    'S-1: the sheet and the deck card resolve different scrim heights, so the plate the user was '
    + 'looking at is not the plate they get.',
  );
  assert.equal(
    CI.surfacePlateUnder('s7Expanded'),
    CI.surfacePlateUnder('s1Single'),
    'S-1: the derived under-layer alphas differ — two different-looking objects.',
  );

  // And it must hold at EVERY hero height the clamp can produce, because S7 is
  // the first surface whose height is not fixed.
  const dPlate = CI.plateTopDepth('s7Expanded');
  const dTitle = CI.titleTopDepth('s7Expanded');
  const heights = [600, 648, 731, 787, 874, 1200].map((sheet) => CI.expandedHeroHeight(sheet));
  assert.ok(new Set(heights).size >= 3, 'S-1 (vacuity): the sampled sheet heights collapse to one hero height');
  for (const h of heights) {
    assert.equal(
      CI.scrimHeight(dPlate, dTitle, h),
      CI.surfaceScrimHeight('s1Single'),
      `S-1: at heroH ${h} the sheet's scrim stops matching the deck card's.`,
    );
    assert.ok(h >= CI.S7_HERO_MIN && h <= CI.S7_HERO_MAX, `S-1: heroH ${h} escaped its clamp`);
  }
});

test('S-1b the hero MOUNTS, on both branches, from one call site', () => {
  const modal = stripComments(read('modal'));
  const mounts = modal.match(/<ExpandedCardHero\b/g) ?? [];
  assert.equal(
    mounts.length,
    1,
    `S-1b: the modal mounts <ExpandedCardHero> ${mounts.length} times. ONE mount is the entire point: `
    + 'two mounts is two compositions again, and zero means a curated plan is back to having no hero '
    + 'image at all (it had none before this wave — ImageGallery was gated behind !isCuratedCard).',
  );
  // And that one mount must NOT sit inside an isCurated branch.
  const at = modal.indexOf('<ExpandedCardHero');
  const before = modal.slice(Math.max(0, at - 900), at);
  assert.ok(
    !/isCuratedCard\s*(\?|&&)[^?&]*$/.test(before),
    'S-1b: the hero is gated on isCuratedCard. The branch is DATA (`curated={isCuratedCard}`), never '
    + 'composition — that is the one-line statement of this whole wave.',
  );
  assert.match(
    modal,
    /curated=\{isCuratedCard\}/,
    'S-1b: curated is no longer passed as DATA to the hero, so the sliver stack cannot be the whole '
    + 'curated identity.',
  );
});

test('S-1c the plate inverts its chevron on the sheet and only on the sheet', () => {
  const hero = stripComments(read('hero'));
  const plate = stripComments(read('plate'));
  assert.match(hero, /chevron="down"/, 'S-1c: the expanded hero no longer inverts the chevron. On the '
    + 'collapsed card it means "this opens"; on the sheet it must mean "this closes" — it is the only '
    + 'element whose MEANING differs between the two surfaces.');
  // Both literals must exist in the plate, or one of the two surfaces is drawing
  // an affordance that points the wrong way.
  assert.ok(plate.includes('name="chevron-up"'), 'S-1c: the plate lost the collapsed-card chevron');
  assert.ok(plate.includes('name="chevron-down"'), 'S-1c: the plate lost the expanded-sheet chevron');
});

// ─────────────────────────────────────────────────────────────────────────────
// S-2 · THE VACUITY PREDICATES, EXTRACTED AND EXECUTED
// ─────────────────────────────────────────────────────────────────────────────

/** Pull a guard out of source and make it runnable. Fails loudly if it moved. */
function executable(source, re, label, params) {
  const m = re.exec(source);
  assert.ok(
    m,
    `${label}: the guard could not be located. This rule EXECUTES the real predicate, so if it moved `
    + 'the rule is asserting nothing and must be re-pointed rather than deleted.',
  );
  const expr = m[1].trim();
  let fn;
  try {
    // eslint-disable-next-line no-new-func
    fn = new Function(...params, `return Boolean(${expr});`);
  } catch (e) {
    assert.fail(`${label}: the guard \`${expr}\` is not evaluable: ${e.message}`);
  }
  return { fn, expr };
}

/**
 * Same extraction, but returning the guard's RAW value rather than `Boolean(...)`.
 *
 * `executable()` cannot tell `null` from `false`, and for the open/closed badge
 * that is the entire distinction under test: `false` renders a red `Closed`
 * pill, `null` renders nothing.
 */
function evaluable(source, re, label, params) {
  const m = re.exec(source);
  assert.ok(
    m,
    `${label}: the expression could not be located. This rule EXECUTES real source, so if it moved `
    + 'the rule is asserting nothing and must be re-pointed rather than deleted.',
  );
  const expr = m[1].trim();
  let fn;
  try {
    // eslint-disable-next-line no-new-func
    fn = new Function(...params, `return (${expr});`);
  } catch (e) {
    assert.fail(`${label}: the expression \`${expr}\` is not evaluable: ${e.message}`);
  }
  return { fn, expr };
}

test('S-2 no fact on the plate is invented — every span guard runs and hides', () => {
  const facts = stripComments(read('facts'));

  // The star. An unrated place must produce NO span — not `★ 0.0`, which is what
  // #1669's first cut shipped when it replaced an invented 4.5 with an invented 0.
  const star = executable(
    facts,
    /if\s*\(([^)]*\brating\b[^)]*)\)\s*\{\s*spans\.push\(\{\s*kind:\s*'rating'/,
    'S-2 star',
    ['rating'],
  );
  for (const v of [undefined, null, 0, -1]) {
    assert.equal(star.fn(v), false, `S-2: rating ${String(v)} still produces a star span via \`${star.expr}\``);
  }
  for (const v of [0.1, 4.4, 5]) {
    assert.equal(star.fn(v), true, `S-2: a real rating of ${v} produces no star span`);
  }

  // The stop's "N min here". A SYNTHESISED duration is not a fact: cardConverters
  // invents 60 minutes a stop for a curated card.
  const dur = executable(
    facts,
    /if\s*\(([^)]*\bminutes\b[^)]*)\)\s*parts\.push\(minutesLabel\(minutes\)\)/,
    'S-2 stop duration',
    ['minutes'],
  );
  for (const v of [undefined, null, 0, -5, NaN, '45']) {
    assert.equal(dur.fn(v), false, `S-2: duration ${String(v)} still renders via \`${dur.expr}\``);
  }
  assert.equal(dur.fn(20), true, 'S-2: a real 20-minute stop renders nothing');
});

test('S-2b the travel connector and the open badge hide their missing input', () => {
  const stops = stripComments(read('stops'));

  // The connector between two stops. `cardConverters.ts:100-137` synthesises a
  // per-stop duration, so a connector that rendered unconditionally would put a
  // fabricated "60 min" pill between every pair of stops in the app.
  const connector = executable(
    stops,
    /\{i\s*>\s*0\s*&&\s*([^?]*travelMinutes[^?]*)\s*\?/,
    'S-2b connector',
    ['stop'],
  );
  for (const v of [undefined, null, 0, -3]) {
    assert.equal(
      connector.fn({ travelMinutes: v }),
      false,
      `S-2b: travelMinutes ${String(v)} still draws a connector via \`${connector.expr}\``,
    );
  }
  assert.equal(connector.fn({ travelMinutes: 12 }), true, 'S-2b: a real leg draws no connector');

  // The open/closed badge. It is computed against VENUE-local time or not at all
  // — a badge computed against the device clock is worse than no badge, and five
  // of six producers drop the offset.
  assert.match(
    stops,
    /useIsPlaceOpen\(stop\.openingHours\s*\?\?\s*null,\s*stop\.utcOffsetMinutes\)/,
    'S-2b: the stop badge no longer receives the venue UTC offset, so it is computed against the '
    + "DEVICE clock — a London user would read a Lagos venue's hours against London time.",
  );
});

/**
 * #1605 P1-5 — S-2b's badge half used to grep for `isOpen !== null ?` and
 * conclude "the badge hides when the offset is unknown". That is an assertion
 * that a PREDICATE IS WRITTEN, not that it DECIDES, and it was wrong: the real
 * `isPlaceOpenAt` returns `null` only when the HOURS are missing, and falls back
 * to the DEVICE clock (returning a confident boolean) when the OFFSET is
 * missing. A `Closed` pill rendered on both platforms against the simulator's
 * clock while this rule was green.
 *
 * So this rule now does three things instead of one grep:
 *   (1) IMPORTS the real `isPlaceOpenAt` and proves it returns a BOOLEAN at a
 *       null offset — the fact that makes an `isOpen !== null` gate impossible;
 *   (2) EXTRACTS each surface's real badge expression and EXECUTES it over both
 *       offset states, asserting the raw value (null vs boolean, which
 *       `Boolean(...)` would have flattened);
 *   (3) fails loudly if either expression cannot be located.
 */
test('S-2c the open/closed badge hides when the venue offset is unknown — executed, both surfaces', async () => {
  const { isPlaceOpenAt } = await import(
    path.join(REPO, 'app-mobile/src/utils/openingHoursUtils.ts')
  );

  const WEEK = [
    'Monday: 9:00 AM – 5:00 PM',
    'Tuesday: 9:00 AM – 5:00 PM',
    'Wednesday: 9:00 AM – 5:00 PM',
    'Thursday: 9:00 AM – 5:00 PM',
    'Friday: 9:00 AM – 5:00 PM',
    'Saturday: 9:00 AM – 5:00 PM',
    'Sunday: 9:00 AM – 5:00 PM',
  ];

  // (1) THE LOAD-BEARING FACT. With hours present and NO offset, the predicate
  // does not abstain — it answers, from the device clock.
  const noOffset = isPlaceOpenAt(WEEK, new Date(), null);
  assert.notEqual(
    noOffset,
    null,
    'S-2c (vacuity): isPlaceOpenAt now returns null at a null offset. If that is a deliberate fix, '
    + 'this rule must be re-pointed — but the render gates below must STILL read the offset, because '
    + 'a gate that depends on a downstream null is a gate that breaks the moment the downstream '
    + 'changes back.',
  );
  assert.equal(
    typeof noOffset,
    'boolean',
    `S-2c: isPlaceOpenAt returned ${String(noOffset)} for a null offset — expected a boolean, which is `
    + 'precisely why the badge cannot be gated on its return value.',
  );
  // …and it DOES abstain when the hours are missing, which is the only thing an
  // `isOpen !== null` gate ever hid.
  assert.equal(
    isPlaceOpenAt(null, new Date(), 60),
    null,
    'S-2c (vacuity): the predicate no longer abstains on missing hours, so it is not the predicate '
    + 'this rule believes it is testing.',
  );

  // (2) THE STOP ROW. Execute the real expression, both offset states.
  const stopGate = evaluable(
    stripComments(read('stops')),
    /const\s+isOpen\s*=\s*([^;]+);/,
    'S-2c stop badge',
    ['stop', 'isOpenComputed'],
  );
  assert.equal(
    stopGate.fn({ utcOffsetMinutes: null }, noOffset),
    null,
    `S-2c: with NO venue offset the stop row still resolves \`${stopGate.expr}\` to `
    + `${String(stopGate.fn({ utcOffsetMinutes: null }, noOffset))}, so it renders an open/closed pill `
    + 'computed against the DEVICE clock. #1683 owns the missing offset; not rendering a state we '
    + 'cannot compute is this wave\'s job.',
  );
  assert.equal(
    stopGate.fn({ utcOffsetMinutes: 60 }, true),
    true,
    'S-2c: with a REAL venue offset the stop row now hides the badge too — the fix over-corrected and '
    + 'the badge never renders at all.',
  );
  assert.equal(
    stopGate.fn({ utcOffsetMinutes: 0 }, false),
    false,
    'S-2c: offset 0 (UTC) is a REAL offset and must render `Closed`. A truthiness check instead of '
    + '`!= null` would drop every venue in London in winter.',
  );

  // (3) THE SINGLE PLACE'S DETAILS SECTION. Same defect, same file family — its
  // prop docblock has always PROMISED this behaviour without delivering it.
  const detailsGate = evaluable(
    stripComments(read('details')),
    /const\s+isOpen\s*=\s*([^;]+);/,
    'S-2c details badge',
    ['utcOffsetMinutes', 'isOpenComputed'],
  );
  assert.equal(
    detailsGate.fn(null, noOffset),
    null,
    `S-2c: Details still resolves \`${detailsGate.expr}\` to a boolean with no offset.`,
  );
  assert.equal(
    detailsGate.fn(undefined, noOffset),
    null,
    'S-2c: an UNDEFINED offset (the prop is optional) still renders the badge.',
  );
  assert.equal(detailsGate.fn(0, false), false, 'S-2c: Details drops the badge for UTC+0 venues.');
  assert.equal(detailsGate.fn(-300, true), true, 'S-2c: Details drops the badge for a real offset.');

  // Anti-vacuity: both extracted expressions must actually mention the offset,
  // or they are being satisfied by something other than the gate under test.
  assert.match(
    stopGate.expr,
    /utcOffsetMinutes/,
    'S-2c (vacuity): the stop expression does not read the offset at all',
  );
  assert.match(
    detailsGate.expr,
    /utcOffsetMinutes/,
    'S-2c (vacuity): the details expression does not read the offset at all',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// S-3 · THE DELETE THAT CANNOT COME BACK UNDER ANOTHER NAME
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Owns a press of its own. A module that presses nothing is not a control.
 */
const S3_PRESSES = /onPress\s*=|<Pressable\b|<TouchableOpacity\b|TrackedTouchableOpacity\b/;

/**
 * NAMES a visit write. The hooks, the SERVICE functions, the mutation key, the
 * prompt opener, and the table itself — because a control that reaches past all
 * four and writes `supabase.from('user_visits')` inline is still a control.
 */
const S3_WRITES =
  /\buseRecordVisit\b|\buseRemoveVisit\b|\brecordVisit\b|\bremoveVisit\b|['"]record-visit['"]|\bopenPlaceReviewRequest\b|['"]user_visits['"]/;

/**
 * The modules that DEFINE the visit read/write/prompt API. They own no press,
 * and merely importing one is not writing — a control has to NAME a write
 * symbol. Excluding them is what keeps `usePairedUserVisits` (a read, in
 * `PersonHolidayView`) and a bare type import of `VoluntaryPlaceReviewRequest`
 * (in `PostExperienceModal`) from being called controls.
 */
const S3_SURFACE_MODULES = [
  'app-mobile/src/hooks/useVisits.ts',
  'app-mobile/src/services/visitService.ts',
  'app-mobile/src/store/placeReviewRequestStore.ts',
];

/** Resolve a relative OR `@/`-aliased specifier onto a key that exists in TREE. */
function s3Resolve(fromKey, spec) {
  let base;
  if (spec.startsWith('.')) {
    base = path.posix.join(path.posix.dirname(fromKey), spec);
  } else if (spec.startsWith('@/')) {
    // tsconfig `"@/*": ["./*"]`, rooted at app-mobile.
    base = path.posix.join('app-mobile', spec.slice(2));
  } else {
    return null;
  }
  for (const cand of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (TREE.has(cand)) return cand;
  }
  return null;
}

/** Direct local imports of a module, as TREE keys. */
function s3Imports(key) {
  const src = TREE.get(key) ?? '';
  const out = new Set();
  const re = /(?:from\s*|require\(\s*)['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const r = s3Resolve(key, m[1]);
    if (r !== null) out.add(r);
  }
  return [...out];
}

/**
 * Can this module write a visit — ITSELF, or through the press-less modules it
 * delegates to, TRANSITIVELY?
 *
 * The traversal stops at any module that owns a press of its own (that is
 * another component, not a delegate) and at the surface modules (importing the
 * API is not calling it). Cycle-safe, depth-capped. Returns the path, so a
 * failure names the chain rather than only the file.
 */
function s3WritePath(file, seen, depth) {
  const src = TREE.get(file) ?? '';
  if (S3_WRITES.test(src)) return [file];
  if (depth <= 0) return null;
  for (const dep of s3Imports(file)) {
    if (seen.has(dep)) continue;
    if (S3_SURFACE_MODULES.includes(dep)) continue;
    if (S3_PRESSES.test(TREE.get(dep) ?? '')) continue;
    seen.add(dep);
    const rest = s3WritePath(dep, seen, depth - 1);
    if (rest !== null) return [file, ...rest];
  }
  return null;
}

const S3_DEPTH = 4;

/**
 * A REVIEW SINK, not a second Been-here control.
 *
 * `PostExperienceModal` presses "Submit" and that submit DOES write a visit —
 * `usePlaceReviews.useSubmitVoluntaryPlaceReview` →
 * `placeReviewService.submitVoluntaryPlaceReview` → `recordVisit`. It is the
 * far end of the ONE control's own flow (#1687: BeenHereControl →
 * `openPlaceReviewRequest` → this modal → the review + the visit), not a second
 * affordance for recording one.
 *
 * The distinction is STRUCTURAL rather than a name in an allowlist: a review
 * sink is a module that submits a place review. Both populations below are
 * pinned exactly, so a new sink is surfaced and has to be justified too — an
 * allowlist nobody can grow silently.
 */
const S3_REVIEW_SINK = /\buseSubmitVoluntaryPlaceReview\b|\bsubmitVoluntaryPlaceReview\b|['"]place_reviews['"]/;

/** Partition every press-owning module that can write a visit. */
function s3Populations(tree) {
  const controls = [];
  const sinks = [];
  const paths = new Map();
  for (const [file, src] of tree) {
    if (S3_SURFACE_MODULES.includes(file)) continue;
    if (!S3_PRESSES.test(src)) continue;
    const chain = s3WritePath(file, new Set([file]), S3_DEPTH);
    if (chain === null) continue;
    paths.set(file, chain.join(' -> '));
    if (S3_REVIEW_SINK.test(src)) sinks.push(file);
    else controls.push(file);
  }
  return { controls: controls.sort(), sinks: sinks.sort(), paths };
}

test('S-3 there is exactly ONE Been-here control in the whole app, across the MODULE GRAPH', () => {
  // THIS IS THE RULE THAT WOULD HAVE CAUGHT THE DELETE THAT CAME BACK.
  //
  // `ActionButtons` carried a complete, never-rendered Been-there button gated on
  // two props no caller ever passed. Deleting it by name is easy; keeping it
  // deleted is not, because the next implementation will live in another file
  // under another name. So this rule names NO symbol it expects to be absent.
  //
  // ------------------------------------------------------------------------
  // #1605 P1-1 — WHY THE FIRST VERSION OF THIS RULE WAS NOT THE GUARANTEE IT
  // CLAIMED, AND WHAT IT IS NOW
  //
  // Version 1 required THREE signals to co-occur IN ONE FILE: reads visited
  // state ∧ owns a press ∧ writes-or-prompts. The tester built two working
  // second Been-here controls that it scored 14/14 green:
  //
  //   A. the SERVICE-LAYER control, one file — `hasVisited` / `recordVisit`
  //      imported straight from `services/visitService` instead of through the
  //      hooks. The WRITE probe only knew the HOOK names.
  //   B. the HOOK-SPLIT control, two files — the component reads and presses, a
  //      sibling `useVisitedChipToggle.ts` does the write. Neither file carries
  //      all three parts. This is the most ordinary refactor there is, which
  //      makes it the shape a second control is most likely to arrive in BY
  //      ACCIDENT.
  //
  // A guard that requires N signals to co-occur in one file is defeated by the
  // most ordinary refactor there is. So the rule no longer looks at files. It
  // asks a question about the MODULE GRAPH:
  //
  //      does this module own a press, AND can it write a visit —
  //      itself, or through the press-less modules it delegates to?
  //
  // and it drops the READ requirement entirely, because a write-only "Been
  // there" button that never reads the state is still a second control. That
  // makes this rule strictly stronger than both version 1 and the tester's A-1
  // (which follows ONE hop and still requires a read).
  //
  // ------------------------------------------------------------------------
  // WHAT IT DOES NOT COVER — the honest boundary
  //
  //   * only RELATIVE and `@/`-aliased local imports are followed. A hop
  //     through a bare package specifier is not resolved;
  //   * `require(someVariable)` and a computed member access on a namespace
  //     import (`visits[key]()`) are not followed — though a namespace import
  //     whose member is named literally IS caught by the symbol probe;
  //   * the delegation chain is followed to depth 4;
  //   * only `.ts`/`.tsx` under `app-mobile/src` and `app-mobile/app` are
  //     swept — a control written in `.js`, in another workspace, or generated
  //     at runtime is invisible;
  //   * a control that writes a visit through a NEW service function this
  //     probe has never heard of, in a module that also owns the press, is
  //     invisible UNLESS it names one of the symbols above or the
  //     `user_visits` table.
  //
  // The last one is the residual hole and it cannot be closed by static
  // analysis alone. It is narrower than either defeat the tester proved.
  const { controls, sinks, paths } = s3Populations(TREE);

  assert.deepEqual(
    controls,
    ['app-mobile/src/components/SwipeableCards.tsx'],
    `S-3: ${controls.length} module(s) can press AND write a visit without being a review sink:\n`
    + controls.map((f) => `    ${paths.get(f)}`).join('\n')
    + '\n\nThere must be exactly ONE, and it must be SwipeableCards.tsx, whose exported BeenHereControl '
    + 'the expanded hero mounts. A second one — under any name, in any file, with the write extracted '
    + 'to any number of sibling hooks — is a second Been-here in a different shape at a different size '
    + 'with a different state machine, which is precisely what deleting ActionButtons\' never-rendered '
    + 'implementation prevented. If you are adding a new surface, MOUNT the existing control; do not '
    + 'write another.',
  );

  assert.deepEqual(
    sinks,
    ['app-mobile/src/components/PostExperienceModal.tsx'],
    `S-3: the review-sink population changed: ${sinks.join(', ')}.\n`
    + sinks.map((f) => `    ${paths.get(f)}`).join('\n')
    + '\n\nA review sink writes a visit as a CONSEQUENCE of submitting a review — it is the far end of '
    + 'the one control\'s own flow (#1687), not a second way to say "I was here". This list is pinned '
    + 'exactly so it cannot be grown quietly to smuggle a second control past the rule above.',
  );

  // Anti-vacuity, four ways. Without these the rule passes because its probes
  // are broken rather than because the tree is clean.
  const owner = TREE.get('app-mobile/src/components/SwipeableCards.tsx');
  assert.ok(owner, 'S-3 (vacuity): the owning module was not swept at all');
  assert.ok(
    S3_PRESSES.test(owner) && S3_WRITES.test(owner),
    'S-3 (vacuity): the signature no longer matches the ONE real control, so it could not match a copy',
  );
  for (const m of S3_SURFACE_MODULES) {
    assert.ok(TREE.has(m), `S-3 (vacuity): ${m} is not in the tree, so the exclusion list is stale`);
    assert.ok(
      S3_WRITES.test(TREE.get(m)) || m.endsWith('placeReviewRequestStore.ts'),
      `S-3 (vacuity): ${m} no longer names a write symbol — it is not the surface this rule believes`,
    );
  }
  // The graph walker must actually walk. If `s3Imports` resolved nothing, every
  // multi-file defeat would pass silently.
  const modalDeps = s3Imports('app-mobile/src/components/ExpandedCardModal.tsx');
  assert.ok(
    modalDeps.includes('app-mobile/src/components/SwipeableCards.tsx'),
    'S-3 (vacuity): the import resolver returned nothing useful for the modal, so the transitive half '
    + 'of this rule is asserting about an empty graph.',
  );
});

/**
 * S-3d — the guard's own defeat suite, RUN. #1605 P1-1.
 *
 * S-3 above is a claim about a property; this is the proof that the claim has
 * teeth. It injects each of the tester's two proven defeats as a VIRTUAL module
 * (never written to disk — nothing here touches the working tree) and asserts
 * the detector flags it. A guard whose own counter-examples are not executed is
 * a guard nobody can trust, which is the whole reason this rework exists.
 */
test('S-3d the population rule catches both proven defeats, plus two harder ones', () => {
  const OWNER = 'app-mobile/src/components/SwipeableCards.tsx';

  /** Run the detector over TREE plus some virtual modules, then restore. */
  const withVirtual = (modules) => {
    const added = [];
    for (const [key, src] of Object.entries(modules)) {
      assert.ok(!TREE.has(key), `S-3d: virtual module ${key} collides with a real one`);
      TREE.set(key, src);
      added.push(key);
    }
    try {
      return s3Populations(TREE).controls;
    } finally {
      for (const key of added) TREE.delete(key);
    }
  };

  // DEFEAT A — the service-layer control, ONE file. `S-3` v1 scored this 14/14.
  const A = 'app-mobile/src/components/expandedCard/BeenThereRow.tsx';
  assert.deepEqual(
    withVirtual({
      [A]:
        "import { hasVisited, recordVisit } from '../../services/visitService';\n"
        + 'export function BeenThereRow({ experienceId }) {\n'
        + '  const [visited, setVisited] = React.useState(false);\n'
        + '  React.useEffect(() => { hasVisited(experienceId).then(setVisited); }, [experienceId]);\n'
        + '  return <Pressable onPress={async () => { await recordVisit({ experienceId }); }} />;\n'
        + '}\n',
    }),
    [A, OWNER].sort(),
    'S-3d: the SERVICE-LAYER control is still invisible. The WRITE probe must know `recordVisit` and '
    + '`removeVisit`, not only the hooks.',
  );

  // DEFEAT B — the hook-split control, TWO files. Also 14/14 against v1.
  const B1 = 'app-mobile/src/components/expandedCard/VisitedChip.tsx';
  const B2 = 'app-mobile/src/components/expandedCard/useVisitedChipToggle.ts';
  assert.deepEqual(
    withVirtual({
      [B1]:
        "import { useHasVisited } from '../../hooks/useVisits';\n"
        + "import { useVisitedChipToggle } from './useVisitedChipToggle';\n"
        + 'export function VisitedChip({ id }) {\n'
        + '  const { data: visited } = useHasVisited(id);\n'
        + '  const toggle = useVisitedChipToggle(id);\n'
        + '  return <Pressable onPress={toggle} />;\n'
        + '}\n',
      [B2]:
        "import { useRecordVisit } from '../../hooks/useVisits';\n"
        + 'export function useVisitedChipToggle(id) {\n'
        + '  const record = useRecordVisit();\n'
        + '  return () => record.mutate({ experienceId: id });\n'
        + '}\n',
    }),
    [B1, OWNER].sort(),
    'S-3d: the HOOK-SPLIT control is still invisible. This is the most ordinary refactor there is, and '
    + 'a rule that requires all signals in one file cannot see it.',
  );

  // HARDER 1 — TWO hops. The write is a hook behind a hook.
  const C1 = 'app-mobile/src/components/expandedCard/WentHereButton.tsx';
  const C2 = 'app-mobile/src/components/expandedCard/useWentHere.ts';
  const C3 = 'app-mobile/src/components/expandedCard/useWentHereWrite.ts';
  assert.deepEqual(
    withVirtual({
      [C1]:
        "import { useWentHere } from './useWentHere';\n"
        + 'export function WentHereButton({ id }) {\n'
        + '  const go = useWentHere(id);\n'
        + '  return <TouchableOpacity onPress={go} />;\n'
        + '}\n',
      [C2]: "import { useWentHereWrite } from './useWentHereWrite';\n"
        + 'export const useWentHere = (id) => useWentHereWrite(id);\n',
      [C3]: "import { useRecordVisit } from '../../hooks/useVisits';\n"
        + 'export const useWentHereWrite = (id) => useRecordVisit();\n',
    }),
    [C1, OWNER].sort(),
    'S-3d: a TWO-hop delegation chain evades the rule — the tester\'s A-1 follows exactly one hop, and '
    + 'this rule exists to be stronger than that.',
  );

  // HARDER 2 — no read at all, and it skips every named symbol by writing the
  // table directly. A write-only control is still a control.
  const D = 'app-mobile/src/components/expandedCard/MarkVisited.tsx';
  assert.deepEqual(
    withVirtual({
      [D]:
        "import { supabase } from '../../services/supabase';\n"
        + 'export function MarkVisited({ id }) {\n'
        + "  return <Pressable onPress={() => supabase.from('user_visits').insert({ experience_id: id })} />;\n"
        + '}\n',
    }),
    [D, OWNER].sort(),
    'S-3d: a control that writes `user_visits` directly, reads nothing, and names no hook or service '
    + 'function is invisible.',
  );

  // HARDER 3 — a second control that ALSO submits a review, i.e. one that tries
  // to hide inside the review-sink partition. It changes the sink list, so it is
  // still surfaced: neither population can absorb a newcomer silently.
  const E = 'app-mobile/src/components/expandedCard/RateAndMark.tsx';
  const sinksWithE = (() => {
    TREE.set(
      E,
      "import { useSubmitVoluntaryPlaceReview } from '../../hooks/usePlaceReviews';\n"
      + "import { recordVisit } from '../../services/visitService';\n"
      + 'export function RateAndMark({ id }) {\n'
      + '  const submit = useSubmitVoluntaryPlaceReview();\n'
      + '  return <Pressable onPress={() => { recordVisit({ experienceId: id }); submit.mutate(); }} />;\n'
      + '}\n',
    );
    try {
      return s3Populations(TREE).sinks;
    } finally {
      TREE.delete(E);
    }
  })();
  assert.ok(
    sinksWithE.includes(E),
    'S-3d: a second control that also submits a review slips through BOTH populations. The review-sink '
    + 'list must be pinned exactly, not treated as an open allowlist.',
  );

  // …and the two known FALSE POSITIVES must stay unflagged, or the rule is
  // simply "everything is a control" and nobody will keep it.
  const clean = withVirtual({});
  assert.deepEqual(
    clean,
    [OWNER],
    `S-3d (vacuity): the clean tree flags ${clean.length} control(s): ${clean.join(', ')}. `
    + 'PersonHolidayView (which READS another user\'s visits through the surface module) and '
    + 'PostExperienceModal (which writes a visit only as the consequence of a review submit) must not '
    + 'be called controls — if they are, the surface-module exclusion or the review-sink partition has '
    + 'broken.',
  );
});

test('S-3b the control the sheet mounts is the SAME component, not a lookalike', () => {
  const modal = stripComments(read('modal'));
  const swipeable = stripComments(read('swipeable'));
  assert.match(
    swipeable,
    /export const BeenHereControl\b/,
    'S-3b: BeenHereControl is no longer exported, so the sheet cannot mount the same one.',
  );
  assert.match(
    modal,
    /import\s*\{\s*BeenHereControl\s*\}\s*from\s*["']\.\/SwipeableCards["']/,
    'S-3b: the sheet no longer imports the deck\'s Been-here control. Two copies drift; one cannot.',
  );
  assert.match(
    modal,
    /beenHere=\{[\s\S]{0,400}<BeenHereControl/,
    'S-3b: the hero is no longer given the Been-here control, so the plate on the sheet has a hole '
    + 'where the deck card has a button — and the six entry points with no collapsed card behind them '
    + '(Likes, Calendar, chat, both collab sheets, a friend\'s profile) go back to having no way to '
    + 'record a visit at all.',
  );
});

test('S-3c ActionButtons renders the BAND and nothing that moved off it', () => {
  const actions = stripComments(read('actions'));

  // The band itself must be there and fixed-height.
  assert.match(actions, /styles\.band\b/, 'S-3c: the action band is gone');
  assert.match(actions, /\{reserve\}/, 'S-3c: the Reserve slot is gone from the band');

  // And the four things that moved off it must not have come back HERE. Each is
  // asserted structurally rather than by its old copy string, because the copy
  // is the easiest thing to change while re-adding the element.
  assert.equal(
    /showVisitButton|onVisitPress|onRemoveVisitPress|visitScaleAnim/.test(actions),
    false,
    'S-3c: the never-rendered Been-there button is back in ActionButtons.',
  );
  assert.equal(
    /openingHoursSection|showAllHours|parsedOpeningHours/.test(actions),
    false,
    'S-3c: the hours table is back in the action component. Hours are a practical detail; they render '
    + 'in Details, which has ALWAYS accepted an openingHours prop it never rendered.',
  );
  assert.equal(
    /policiesButton|handlePoliciesAndReservations/.test(actions),
    false,
    'S-3c: the "Policies & Reservations" slab is back. It was a website link wearing a costume, and '
    + 'its handler bailed when normalizeWebsiteUrl returned null — a VISIBLE DEAD BUTTON.',
  );
  assert.equal(
    /shareIconButton|handleShare/.test(actions),
    false,
    'S-3c: Share is back in the band. It is an identity action and it lives on the plate.',
  );

  // The scheduling machinery must SURVIVE — this rule is about what moved, not
  // about gutting the component.
  assert.match(actions, /handleSchedule\b/, 'S-3c (vacuity): scheduling was removed, not re-homed');
  assert.match(actions, /handleSave\b/, 'S-3c (vacuity): saving was removed, not re-homed');
});

// ─────────────────────────────────────────────────────────────────────────────
// S-4 · ONE SPINE, ONE POSITION, NO NESTED SCROLLABLES
// ─────────────────────────────────────────────────────────────────────────────

test('S-4 the commitment actions sit in the SAME place on both branches', () => {
  const modal = stripComments(read('modal'));
  const mounts = modal.match(/<ActionButtons\b/g) ?? [];
  assert.equal(
    mounts.length,
    1,
    `S-4: the modal mounts <ActionButtons> ${mounts.length} times. TWO is the defect: the row was LAST `
    + 'on a single place and MID-SCROLL on a plan, with Weather, Busyness and Timeline rendered below '
    + 'it. One mount is what makes the position independent of what kind of card you opened.',
  );

  // And it must come BEFORE every reading section, on both branches.
  const band = modal.indexOf('<ActionButtons');
  for (const later of ['<CardInfoSection', '<ConditionsSection', '<PracticalDetailsSection', '<StopList']) {
    const at = modal.indexOf(later);
    assert.ok(at > band, `S-4: ${later} renders BEFORE the action band, so the band is mid-scroll again.`);
  }

  // The hero comes before everything.
  assert.ok(
    modal.indexOf('<ExpandedCardHero') < band,
    'S-4: the action band renders above the hero.',
  );
});

test('S-4b one section component per job — the curated fork is gone', () => {
  const modal = stripComments(read('modal'));
  for (const gone of ['CuratedPlanView', 'MultiStopPlanView', 'curatedStyles', 'StopOpenBadge']) {
    assert.equal(
      modal.includes(gone),
      false,
      `S-4b: ${gone} is back in the modal. It was the parallel composition — a plan shared 6 of ~16 `
      + 'slots with a single place, brought its own dark #1C1C1E header, and had no hero image at all.',
    );
  }
  // The dark header's fill must not reappear anywhere in the sheet's tree.
  for (const key of ['modal', 'hero', 'stops', 'details', 'conditions', 'actions']) {
    assert.equal(
      /#1C1C1E/i.test(stripComments(read(key))),
      false,
      `S-4b: the dark header fill is back in ${SRC[key]}.`,
    );
  }
});

test('S-4c no per-stop or per-alternative horizontal scrollable', () => {
  // The stops list was already flat. What nested were the PER-STOP image pager
  // and the alternatives strip — N+1 horizontal ScrollViews inside the sheet's
  // vertical scroll, each fighting gorhom's pan gesture.
  const stops = stripComments(read('stops'));
  assert.equal(
    /horizontal/.test(stops),
    false,
    'S-4c: the stop list carries a horizontal scrollable again. One per stop is N of them inside the '
    + "sheet's vertical scroll.",
  );
  const modal = stripComments(read('modal'));
  const horizontals = modal.match(/\bhorizontal\b/g) ?? [];
  assert.equal(
    horizontals.length,
    1,
    `S-4c: the sheet now has ${horizontals.length} horizontal scrollables. Exactly ONE is sanctioned — `
    + 'the body gallery strip, which is a single fixed-height list, not one per row.',
  );
});

test('S-4d the body carries no rejected colour', () => {
  // Each of these was measured and rejected. Naming the HEX is the point: a
  // re-added tint is a re-added failure, and the number is why.
  const REJECTED = [
    ['#9CA3AF', '2.54:1 as text'],
    ['#D97706', '3.19:1 as text'],
    ['#6366F1', 'white on it measures 4.47:1, below the 4.5 floor'],
    ['#EA580C', 'collapsed onto the one accent token'],
    ['#fef7f0', 'the orange section tint — four sections shouting in the same voice'],
  ];
  for (const key of ['stops', 'details', 'conditions', 'actions']) {
    const src = stripComments(read(key));
    for (const [hex, why] of REJECTED) {
      assert.equal(
        new RegExp(hex, 'i').test(src),
        false,
        `S-4d: ${SRC[key]} uses ${hex} again (${why}).`,
      );
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// S-5 · THE META LINE IS CONTINUOUS — one producer, called from both surfaces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull the object literal passed as a function's Nth argument, by brace
 * matching. Fails loudly if the call moved, so this rule cannot pass vacuously.
 */
function optionsLiteral(source, callee, label) {
  const at = source.indexOf(`${callee}(`);
  assert.notEqual(at, -1, `${label}: \`${callee}(\` does not appear at all.`);
  const open = source.indexOf('{', at);
  assert.notEqual(open, -1, `${label}: the call has no options object.`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  assert.fail(`${label}: the options object literal is unbalanced.`);
  return '';
}

/**
 * The stubs BOTH call sites are evaluated against. Identical for both, on
 * purpose — any surviving difference in the resulting spans is a difference the
 * CALLERS introduced, which is exactly the class of defect this rule exists for.
 */
const S5_DEPS = {
  accountPreferences: { currency: 'USD', measurementSystem: 'Imperial' },
  measurementSystem: 'Imperial',
  currencyCode: 'USD',
  isBrandExperience: false,
  formatCurrency: (amount, code) => `${code} ${amount}`,
  t: (key, opts) => {
    if (key === 'cards:swipeable.free') return 'Free';
    if (key === 'cards:expanded.stop_count') return `${opts?.count ?? 0} stops`;
    if (key === 'common:intent_picnic_dates') return 'Picnic Dates';
    return opts?.defaultValue ?? key;
  },
};

/** A plan with an OPTIONAL third stop — the exact shape that diverged. */
const S5_FIXTURE = {
  experienceType: 'picnic-dates',
  estimatedDurationMinutes: 104,
  totalPriceMin: 0,
  totalPriceMax: 0,
  stops: [
    { optional: false, priceMin: 0, priceMax: 0, distanceFromUserKm: 9.33 },
    { optional: false, priceMin: 0, priceMax: 0, distanceFromUserKm: 11.0 },
    { optional: true, priceMin: 12, priceMax: 20, distanceFromUserKm: 12.0 },
  ],
};

test('S-5 the curated meta line is produced ONCE and both surfaces render the same array', async () => {
  // THE CLAIM THE WHOLE WAVE RESTS ON IS THAT OPENING A CARD CONTINUES IT.
  //
  // The plate's GEOMETRY was gated (S-1, T-11) and measured identical on
  // device. Its CONTENTS were gated by nothing, and the tester caught them
  // changing on the very tap that is supposed to prove continuity:
  //
  //     collapsed   2 stops · 5.8 mi · 1h 23m · Free · Picnic Dates
  //     expanded    3 stops ·          1h 44m · Free · Picnic Dates
  //
  // Two builders — five spans from the non-optional stops in
  // CuratedExperienceSwipeCard, four from ALL of them in expandedCardFacts,
  // different duration and price rules, no distance. This rule closes it three
  // ways: exactly one producer exists, both surfaces call it, and BOTH CALL
  // SITES' OPTION OBJECTS are executed against the same card and compared.
  const modal = stripComments(read('modal'));
  const deck = stripComments(read('swipecurated'));
  const facts = stripComments(read('facts'));

  // (1) EXACTLY ONE PRODUCER, in the whole tree.
  const definers = [...TREE]
    .filter(([, src]) => /export\s+function\s+curatedPlanSpans\b/.test(src))
    .map(([file]) => file);
  assert.deepEqual(
    definers,
    ['app-mobile/src/components/expandedCard/expandedCardFacts.ts'],
    `S-5: ${definers.length} module(s) define curatedPlanSpans: ${definers.join(', ')}. Two producers `
    + 'is how the meta line diverged in the first place.',
  );

  // (2) BOTH surfaces call it, and NEITHER assembles spans of its own. The
  // second half is the important one: a caller that re-derives even ONE span
  // locally is a second producer wearing the first one's name.
  for (const [label, src] of [['the expanded sheet', modal], ['the collapsed deck card', deck]]) {
    assert.match(
      src,
      /curatedPlanSpans\s*\(/,
      `S-5: ${label} no longer calls the shared span producer.`,
    );
    assert.equal(
      /(?:const|let)\s+\w*[Ss]pans\w*\s*:\s*MetaSpanInput\[\]\s*=\s*\[\s*\]/.test(src),
      false,
      `S-5: ${label} assembles its own MetaSpanInput array again. Every curated span must come from `
      + 'curatedPlanSpans, or the two surfaces can disagree without either file looking wrong.',
    );
  }
  // The stop SELECTION is shared too — "which stops is this plan" decided twice
  // is what made the count differ.
  assert.match(
    deck,
    /planVisibleStops\s*\(/,
    'S-5: the deck card selects its visible stops locally again instead of through planVisibleStops.',
  );
  assert.equal(
    /filter\s*\(\s*\w+\s*=>\s*!\w+\.optional\s*\)/.test(deck),
    false,
    'S-5: the deck card re-implements the non-optional filter inline.',
  );

  // (3) EXECUTED. Import the REAL producer (through the resolver hooks beside
  // this file — nothing is stubbed except i18n) and run BOTH call sites'
  // option objects against the SAME card.
  const { curatedPlanSpans } = await import(
    pathToFileURL(path.join(REPO, SRC.facts)).href
  );

  const modalOpts = optionsLiteral(modal, 'curatedPlanSpans', 'S-5 sheet call site');
  const deckOpts = optionsLiteral(deck, 'curatedPlanSpans', 'S-5 deck call site');
  for (const [label, literal] of [['sheet', modalOpts], ['deck', deckOpts]]) {
    assert.ok(
      literal.includes('stopCountLabel') && literal.includes('formatMoney'),
      `S-5 (vacuity): the ${label} options literal does not look like the producer's options — the `
      + `extractor is slicing the wrong call. Got: ${literal.slice(0, 120)}`,
    );
  }

  const names = Object.keys(S5_DEPS);
  const build = (literal, label) => {
    let fn;
    try {
      // eslint-disable-next-line no-new-func
      fn = new Function(...names, `return (${literal});`);
    } catch (e) {
      assert.fail(`S-5: the ${label} options literal is not evaluable: ${e.message}`);
    }
    return fn(...names.map((n) => S5_DEPS[n]));
  };

  const fromSheet = curatedPlanSpans(S5_FIXTURE, build(modalOpts, 'sheet'));
  const fromDeck = curatedPlanSpans(S5_FIXTURE, build(deckOpts, 'deck'));

  assert.ok(
    fromSheet.length >= 4,
    `S-5 (vacuity): the producer returned ${fromSheet.length} spans for a full fixture — it is not `
    + 'producing anything, so the equality below would be trivially true.',
  );
  assert.deepEqual(
    fromDeck,
    fromSheet,
    'S-5: the SAME plan resolves different meta spans on the deck and on the sheet:\n'
    + `    deck   ${fromDeck.map((s) => s.text).join(' · ')}\n`
    + `    sheet  ${fromSheet.map((s) => s.text).join(' · ')}\n`
    + 'One tap apart, the plate must say the same thing. That is the whole claim.',
  );

  // (4) …and the array itself must be the one the design specifies: the count
  // is over the plan's NON-OPTIONAL stops (the same set `mutateCuratedCard`
  // computes every other aggregate over, and the same set the card's own title
  // is built from), the distance is present, and nothing is fabricated.
  assert.deepEqual(
    fromSheet.map((s) => s.text),
    ['2 stops', '5.8 mi', '1h 44m', 'Free', 'Picnic Dates'],
    'S-5: the produced spans are not the specified line. A 3 here means the optional stop is being '
    + "counted against the card's own title; a missing distance means the sheet lost it again.",
  );
  assert.deepEqual(
    fromSheet.map((s) => s.kind),
    ['rating', 'fact', 'fact', 'fact', 'tail'],
    'S-5: the span WEIGHTS changed. The leading 700 slot belongs to the fact that characterises a '
    + 'plan, and the tail is the vibe.',
  );

  // A single-stop plan has no count worth stating and falls back to distance;
  // a stopless one states neither rather than "0 stops" (Constitution 9).
  const single = curatedPlanSpans(
    { ...S5_FIXTURE, stops: [S5_FIXTURE.stops[0]] },
    build(modalOpts, 'sheet'),
  );
  assert.equal(single[0].text, '5.8 mi', 'S-5: a single-stop plan still leads with a stop count.');
  const none = curatedPlanSpans({ ...S5_FIXTURE, stops: [] }, build(modalOpts, 'sheet'));
  assert.equal(
    none.some((s) => /stops?/.test(s.text)),
    false,
    `S-5: a plan with no stops renders "${none.map((s) => s.text).join(' · ')}" — "0 stops" is a `
    + 'fabricated fact about a plan that has none.',
  );

  // Anti-vacuity on the producer itself: the file must still name the four
  // derivations, or the executed array above is coming from somewhere else.
  for (const needle of ['planVisibleStops', 'formatPlanDuration', 'curatedPriceLabel', 'distanceFromUserKm']) {
    assert.ok(facts.includes(needle), `S-5 (vacuity): the producer no longer contains ${needle}`);
  }
});

test('S-4e a plan gets Starts at / Ends near, and never a borrowed phone', () => {
  const details = stripComments(read('details'));
  assert.match(details, /plan\.startsAt/, 'S-4e: the plan branch lost Starts at');
  assert.match(details, /plan\.endsNear/, 'S-4e: the plan branch lost Ends near');
  // Ends near must be suppressed when it repeats the start.
  assert.match(
    details,
    /plan\.endsNear\s*!==\s*startsAt/,
    'S-4e: "Ends near" no longer hides when it repeats "Starts at" — that is the same fact twice, not '
    + 'a second fact.',
  );
  // The plan branch must return BEFORE the phone / website rows exist.
  const planReturn = details.indexOf('if (plan) {');
  // The plan branch RETURNS; `const hasAnything` is the first statement of the
  // single-place path, so it is the exact end of the block being asserted about.
  const singlePlace = details.indexOf('const hasAnything');
  assert.ok(
    planReturn > 0 && singlePlace > planReturn,
    'S-4e (vacuity): could not delimit the plan branch, so the assertion below is about nothing.',
  );
  const planBlock = details.slice(planReturn, singlePlace);
  assert.ok(planBlock.includes('plan.endsNear'), 'S-4e (vacuity): the delimited block is not the plan branch');
  assert.equal(
    /tel:|normalizedWebsite|weekdayLines\.map/.test(planBlock),
    false,
    'S-4e: a plan renders a phone, a website or an hours table. Promoting the first stop\'s phone '
    + "number to be \"the plan's phone\" is a lie about what the number reaches.",
  );
});
