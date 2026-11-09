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

/**
 * MODIFIED under #1700 — [TEST-MOD-APPROVED #1700].
 *
 * S-1 compared the sheet's scrim against the deck's using the CANONICAL plate depths. The scrim
 * is now solved from the tallest silhouette, so the comparison read 316 !== 346 and failed a
 * correct change. The property — both surfaces resolve the SAME height at every hero height —
 * is unchanged; only which silhouette defines it moved.
 *
 * Recorded here, in the file, so the next reader finds the reason beside the
 * assertion rather than in a commit message they will not go looking for.
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
  // #4347 wave 3 — the plan's body and its stop card replace the hero, the
  // plan's StopList rows, the old plan timeline and conditions section (all deleted).
  planbody: 'app-mobile/src/components/expandedCard/CuratedPlanBody.tsx',
  stopcard: 'app-mobile/src/components/expandedCard/PlanStopCard.tsx',
  plate: 'app-mobile/src/components/deckCardPlate.tsx',
  facts: 'app-mobile/src/components/expandedCard/expandedCardFacts.ts',
  actions: 'app-mobile/src/components/expandedCard/ActionButtons.tsx',
  stops: 'app-mobile/src/components/expandedCard/StopList.tsx',
  details: 'app-mobile/src/components/expandedCard/PracticalDetailsSection.tsx',
  swipeable: 'app-mobile/src/components/SwipeableCards.tsx',
  // The collapsed deck card — the OTHER caller of the one span producer (S-5).
  swipecurated: 'app-mobile/src/components/CuratedExperienceSwipeCard.tsx',
  // #4347 wave 1 — the deck face's binding of the redesigned deck producer.
  curatedface: 'app-mobile/src/components/deckCard/curatedFace.ts',
  // The two derived-data shapes S-6b classifies exhaustively.
  cardtypes: 'app-mobile/src/types/expandedCardTypes.ts',
  // The chat trimmer that used to invent a per-stop duration (S-9).
  messaging: 'app-mobile/src/services/messagingService.ts',
  // The only surface a curated stop's photos still render on (S-6b).
  lightbox: 'app-mobile/src/components/ImageLightbox.tsx',
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
  // #4347 wave 1 — REWRITTEN, SAME PROTECTION. The deck card now prints a
  // kicker above its title and the sheet hero does not, so the deck solves its
  // scrim one clause deeper (it is the darker, more legible of the two). The
  // continuity that matters is unchanged and asserted: same plate depth, same
  // title depth, and the plate composites to the same L* 23.5 on both (T-11 in
  // the package oracle measures that through an independent model).
  assert.equal(CI.plateTopDepth('s7Expanded'), CI.plateTopDepth('s1Single'), 'S-1: plate depth drift');
  assert.equal(CI.titleTopDepth('s7Expanded'), CI.titleTopDepth('s1Single'), 'S-1: title depth drift');
  assert.ok(
    CI.surfaceScrimHeight('s1Single') >= CI.surfaceScrimHeight('s7Expanded'),
    'S-1: the deck card scrim is shallower than the sheet\'s — the deck lost its kicker clause.',
  );

  // And it must hold at EVERY hero height the clamp can produce, because S7 is
  // the first surface whose height is not fixed.
  // #1700 — the TALLEST silhouette's depths, not the canonical plate's. The
  // scrim is solved from the deepest-reaching composition a surface can render
  // (a two-line facts row), so comparing against the canonical depths here made
  // this assert 316 !== 346 and go red for a scrim that had just been made
  // CORRECT. The property — sheet and deck resolve the same height at every hero
  // height — is unchanged; only which silhouette defines it moved.
  const tallestLines = CI.surfaceSilhouettes('s7Expanded').at(-1);
  const dPlate = CI.plateTopDepthForLines('s7Expanded', tallestLines);
  const dTitle = CI.titleTopDepthForLines('s7Expanded', tallestLines);
  const heights = [600, 648, 731, 787, 874, 1200].map((sheet) => CI.expandedHeroHeight(sheet));
  assert.ok(new Set(heights).size >= 3, 'S-1 (vacuity): the sampled sheet heights collapse to one hero height');
  for (const h of heights) {
    assert.equal(
      CI.scrimHeight(dPlate, dTitle, h),
      CI.surfaceScrimHeight('s7Expanded'),
      `S-1: at heroH ${h} the sheet's scrim stops being one device-invariant number.`,
    );
    assert.ok(h >= CI.S7_HERO_MIN && h <= CI.S7_HERO_MAX, `S-1: heroH ${h} escaped its clamp`);
  }
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

test('S-3c ActionButtons renders the pinned bar and nothing that moved off it', () => {
  const actions = stripComments(read('actions'));
  // #4347 wave 2/3 — REWRITTEN: the in-flow band is gone (the plan was its last
  // user); the bar is the pinned row, and it still carries the Reserve slot.
  assert.match(actions, /styles\.pinnedRow\b/, 'S-3c: the pinned action row is gone');
  assert.equal(/styles\.band\b/.test(actions), false, 'S-3c: the retired in-flow band is back');
  assert.match(actions, /\{reserve\}/, 'S-3c: the Reserve slot is gone from the bar');
  assert.equal(/showVisitButton|onVisitPress|onRemoveVisitPress|visitScaleAnim/.test(actions), false,
    'S-3c: the never-rendered Been-there button is back in ActionButtons.');
  assert.equal(/openingHoursSection|showAllHours|parsedOpeningHours/.test(actions), false,
    'S-3c: the hours table is back in the action component.');
  assert.equal(/policiesButton|handlePoliciesAndReservations/.test(actions), false,
    'S-3c: the "Policies & Reservations" slab is back.');
  assert.match(actions, /handleSchedule\b/, 'S-3c (vacuity): scheduling was removed, not re-homed');
  assert.match(actions, /handleSave\b/, 'S-3c (vacuity): saving was removed, not re-homed');
});
// ─────────────────────────────────────────────────────────────────────────────
// S-4 · ONE SPINE, ONE POSITION, NO NESTED SCROLLABLES
// ─────────────────────────────────────────────────────────────────────────────

test('S-4 the commitment actions sit in the SAME place on both branches', () => {
  const modal = stripComments(read('modal'));
  // #4347 wave 3 — REWRITTEN. The defect is the actions landing MID-SCROLL.
  // Both branches now pin them to the sheet's bottom edge: exactly two mounts
  // (place bar, plan bar), both pinned, both inside the sticky footer, and
  // NONE in the scroll body.
  const mounts = modal.match(/<ActionButtons\b/g) ?? [];
  assert.equal(mounts.length, 2, `S-4: the modal mounts <ActionButtons> ${mounts.length} times (place + plan pinned bars expected)`);
  const pinned = modal.match(/<ActionButtons\s+variant="pinned"/g) ?? [];
  assert.equal(pinned.length, 2, 'S-4: an ActionButtons mount is not the pinned bar');
  const footer = modal.indexOf('stickyFooter={');
  const body = modal.indexOf('<InAppBrowserProvider>');
  for (let at = modal.indexOf('<ActionButtons'); at >= 0; at = modal.indexOf('<ActionButtons', at + 1)) {
    assert.ok(at > footer && at < body, 'S-4: an action bar renders inside the scroll body (mid-scroll again)');
  }
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
  for (const key of ['modal', 'planbody', 'stopcard', 'stops', 'details', 'actions']) {
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
  // #4347 wave 2 — REWRITTEN: the body strip is gone; the sheet body has NO
  // horizontal list, and the gallery at the top owns exactly two fixed-height
  // ones (pager + thumbnails), never one per row.
  const horizontals = modal.match(/\bhorizontal\b/g) ?? [];
  assert.equal(horizontals.length, 0, `S-4c: the sheet body has ${horizontals.length} horizontal scrollables again.`);
  const gallery = stripComments(fs.readFileSync(path.join(REPO, 'app-mobile/src/components/expandedCard/PlaceGallery.tsx'), 'utf8'));
  assert.equal((gallery.match(/\bhorizontal\b/g) ?? []).length, 2, 'S-4c: the gallery is not exactly the pager and the thumbnail row');
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
  for (const key of ['stops', 'details', 'planbody', 'stopcard', 'actions']) {
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
// S-6 · NO FIELD OUTLIVES ITS RENDER SITE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every row here is a field the pipeline still PRODUCES and the sheet must
 * still SHOW. #1605 P1-3 and the enumeration that followed it.
 *
 * THIS RULE IS A LIST, AND A LIST CANNOT FIND WHAT NOBODY LISTED. Its exact
 * boundary — what it covers, what it does not, and the second rule (`S-6b`)
 * that closes the discovery half for two specific shapes — is written out in
 * full above `S-6b` below. Read it before trusting either.
 *
 * `producer` is a probe that must match at least one module OTHER than the
 * consumer — that is the vacuity guard, and it is the important half: if a
 * field is genuinely retired from every producer, this rule tells you to delete
 * the row rather than passing silently on a field nobody writes.
 *
 * `consumer` + `renders` is the render site. Deleting it fails this rule.
 */
const S6_CARRIED = [
  {
    what: 'the picnic Shopping List',
    producer: /\bshoppingList\s*[:,]/,
    // #4347 wave 3 — the plan's supplies render in the plan body.
    consumer: 'app-mobile/src/components/expandedCard/CuratedPlanBody.tsx',
    renders: /<SuppliesList\b[\s\S]{0,80}items=\{/,
    why:
      'It rendered on `main` at :990-992 via PicnicShoppingList, is NOT in the spec\'s deletion list, '
      + 'and five producers still carry the field — cardConverters, savedCardToExpandedCardData, '
      + 'holidayCardToExpandedCardData, collabSaveCard and calendarService. Keeping the data, the '
      + 'calendar column and the collab copy while rendering it nowhere is the worst of the three '
      + 'available outcomes.',
  },
  {
    // #4347 wave 3 — the crowd is no longer BusynessData (nothing renders it):
    // it is the typical curve, and its disclosure is the "Usually …" wording
    // and the "typical, not live" note on every surface that shows it.
    what: "the typical crowd's disclosure",
    producer: /\bcrowd_then_\$\{|\bcrowdLevel\(/,
    consumer: 'app-mobile/src/components/expandedCard/CuratedPlanBody.tsx',
    renders: [/cards:plan\.crowd_then_\$\{/, /cards:plan\.conditions_note/],
    why:
      'The crowd is a compile-time VENUE_POPULARITY curve. Rendered without "Usually" and the '
      + '"typical, not live" note it would be a fabrication that reads as a measurement (Constitution 9).',
  },
  {
    what: "a curated stop's own booking page",
    producer: /\bwebsite\s*:/,
    consumer: 'app-mobile/src/components/expandedCard/CuratedPlanBody.tsx',
    renders: /stop\.website/,
    why:
      'CuratedStop.website is populated by the generator and rendered on `main` as a per-stop '
      + '"Policies & Reservations" row. With no reader it is a booking link the user cannot reach.',
  },
  {
    what: "a curated stop's photos past the first",
    producer: /\bimageUrls\s*[:?]/,
    consumer: 'app-mobile/src/components/expandedCard/curatedPlanModel.ts',
    renders: /stop\.imageUrls/,
    why:
      'A stop carries up to five photos. The deleted StopImageGallery was ImageLightbox\'s only '
      + 'entry point in the whole app, so losing it made every photo past the cover undisplayable.',
  },
  {
    what: "a companion stop's TYPE label — the row's only subtitle",
    producer: /\btype:\s*s\.placeType\b|\btype:\s*string;/,
    consumer: 'app-mobile/src/components/expandedCard/expandedCardFacts.ts',
    renders: /companionTypeLabel\(stop\.type\)/,
    why:
      '`get-companion-stops` writes `type: row.primary_type || "casual_food"` on every row and '
      + '`cardConverters.ts:116` writes `type: s.placeType`. `CompanionStopsSection` turned it into '
      + "the row's ONLY subtitle through a 20-entry label map. After that component was deleted the "
      + 'field had producers and no reader, and a companion row carried a bare star and nothing else.',
  },
  {
    what: "a companion stop's reviewCount",
    producer: /\breviewCount\s*[:?]/,
    consumer: 'app-mobile/src/components/expandedCard/expandedCardFacts.ts',
    renders: /stop\.reviewCount/,
    why:
      'A rating with no sample size is the weakest number on the sheet, and `companion_stops.'
      + 'reviews_count` is translated in all 29 locales — the copy was already paid for and the '
      + 'render site was the only missing part.',
  },
  {
    what: 'the companion rows going through the shared meta producer at all',
    producer: /\bcompanionStops:\s*(?:Array<|card\.stops|strollData)/,
    consumer: 'app-mobile/src/components/ExpandedCardModal.tsx',
    renders: /companionStopMeta\(companion/,
    why:
      'The type label and the review count are only restored if the COMPANION rows call the shared '
      + 'producer — the grocery row calls it too, and a probe that only saw the grocery call would '
      + 'pass with the companion rows back on a bare star.',
  },
  {
    what: "a curated stop's OPTIONAL flag",
    producer: /\boptional:\s*(?:true|original\.optional|stopDef\.optional)\b/,
    consumer: 'app-mobile/src/components/expandedCard/CuratedPlanBody.tsx',
    /*
      BOTH render sites, and the pair is the point. The visible Chip is what a
      sighted user reconciles "2 stops" against; the accessibility branch is
      what a VoiceOver user reconciles it against, since the index chip is
      `accessibilityElementsHidden` and an optional stop has no ordinal to
      announce. A probe that accepted either would go green with one of them
      deleted — which is exactly what happened the first time this row was
      written, and the revert harness caught it.
    */
    // #4347 wave 3 — the stop card's "Optional" tag, and the unnumbered
    // route / navigator label (an optional stop announces its NAME, no ordinal).
    renders: [/ordinal === null\) tags\.push\(t\('cards:expanded\.optional'\)\)/, /ordinal: timeline\[i\]\?\.ordinal \?\? null/],
    why:
      '`generate-curated-experiences` emits `optional: true` stops (:501/:529/:575) and the plate '
      + 'counts `planVisibleStops`, which excludes them. The list rendered every stop identically, so '
      + 'a live card showed "2 stops" above three indistinguishable rows — two numbers about the same '
      + 'plan, both right, disagreeing on one screen.',
  },
  {
    what: "the viewer's own distance on a chat-mounted card",
    producer: /setViewerDistance\s*\(/,
    // The producer and the consumer are the SAME module here, and that is the
    // point: the modal computes this value itself and then had no reader for
    // it. Every other row's producer must be a different file.
    producedInPlace: true,
    consumer: 'app-mobile/src/components/ExpandedCardModal.tsx',
    // #4347 wave 2/3 — the place's "From you" tile reads it (the plate is gone).
    renders: /viewerDistance !== null\s*\?\s*parseAndFormatDistance\(`\$\{viewerDistance\} km`/,
    why:
      'A chat-mounted card is BY DEFINITION one with no `card.distance` (`isChatMounted` is defined '
      + 'as `!card.travelTime && !card.distance`), so those cards showed no distance at all while the '
      + 'modal computed one and dropped it.',
  },
];

test('S-6 every field the pipeline still produces has somewhere to render', () => {
  // THE SECOND SILENT DELETION IS WHY THIS RULE EXISTS.
  //
  // Wave 4 deleted six components. Two features went with them and neither was
  // in the spec's deletion list: the cover-video unmute control (CI caught it,
  // not review) and the picnic Shopping List (the tester caught it). The shape
  // is always the same — the DATA survives, every producer keeps writing it,
  // and the render site quietly disappears — and it is invisible in review
  // because the diff that removes it looks like a component deletion.
  //
  // A field with producers and no consumers is that bug. This rule states the
  // pairing for every field this wave restored, so re-deleting one is a red
  // test rather than a discovery three weeks later.
  for (const row of S6_CARRIED) {
    const producers = [...TREE]
      .filter(([file, src]) =>
        (row.producedInPlace === true || file !== row.consumer) && row.producer.test(src))
      .map(([file]) => file);
    assert.ok(
      producers.length > 0,
      `S-6 (vacuity): nothing in the tree produces ${row.what} any more (${row.producer}). If the `
      + 'field is genuinely retired, DELETE this row and the render site together — a rule guarding a '
      + 'field nobody writes is a rule that passes for the wrong reason.',
    );

    const consumer = TREE.get(row.consumer);
    assert.ok(consumer, `S-6 (vacuity): ${row.consumer} was not swept`);
    // A row may name MORE THAN ONE render site, and then ALL of them are
    // required — a field rendered visually and announced separately has two
    // places to lose it from.
    for (const probe of Array.isArray(row.renders) ? row.renders : [row.renders]) {
    assert.match(
      consumer,
      probe,
      `S-6: ${producers.length} module(s) still produce ${row.what} and ${row.consumer} no longer `
      + `renders it (${probe}).\n\n${row.why}\n\nRestore the render site, or remove the field from `
      + `all ${producers.length} producers in the same change. Keeping the data and dropping the `
      + 'render is the one option that is never right.',
    );
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// S-6b · EVERY FIELD OF TWO SHAPES IS CLASSIFIED — RENDERED, OR NOT AND WHY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WHAT S-6 DOES AND DOES NOT COVER — the honest boundary, because a false
 * guarantee is worse than a stated gap.
 *
 * S-6 above is a LIST. It pins a render site for each field this programme has
 * already lost once, which makes re-deleting one a red test. What it cannot do
 * is DISCOVER the next one: a field nobody has thought about is a field with no
 * row, and no row means no assertion. Three features vanished this way — the
 * cover-video unmute control, the picnic Shopping List, and the Traffic row —
 * and the third was found by enumeration, not by a gate.
 *
 * S-6b closes that for two shapes, and only two. It PARSES the field list out
 * of the type declaration and requires every field to appear in exactly one of
 * two ledgers: RENDERED (with a probe naming the file and the expression that
 * renders it) or NOT_RENDERED (with a written reason). A ledger row for a field
 * that no longer exists fails it too, so the ledger cannot rot.
 *
 * WHAT "A FIELD ADDED WITHOUT A DECISION FAILS" MEANS, EXACTLY — the first cut
 * of this rule claimed it and did not deliver it (#1605 retest P1-A). It now
 * holds for every declaration form this codebase writes, and the self-check at
 * the top of the test proves the matcher still sees each of them:
 *
 *     …?: string;                 ✓  bare identifier, optional
 *     readonly …: string;         ✓  THE HOUSE STYLE in the files this wave wrote
 *     "…": string;                ✓  quoted key, either quote
 *     readonly …?: { … };         ✓  modifier + optional + object type
 *     …(): void;                  ✓  method members
 *     […: string]: unknown;       LOUD FAIL — see `typeFields`
 *
 * NOTE FOR ANYONE EDITING THIS FILE: the tester's `A-5` cross-checks that every
 * field it parses out of these two shapes is NAMED SOMEWHERE IN THIS FILE. So do
 * NOT write a plausible field identifier into a comment or a fixture here — it
 * would satisfy `A-5` for a field that has no ledger row and blunt the tripwire.
 * That is why the forms above use `…` and the self-check below uses Greek.
 *

 * IT DOES NOT COVER:
 *   * `ExpandedCardData` as a whole — ~90 fields across nine card shapes, many
 *     consumed outside this sheet. Classifying it here would either be a wall
 *     of NOT_RENDERED rows nobody maintains, or a false claim about surfaces
 *     this suite does not read;
 *   * any field of `CuratedStop`, `WeatherData`, `PicnicData` or `StrollData`
 *     other than the companion-stop element below;
 *   * a field consumed only through a spread (`{...stop}`) — the probes are
 *     literal, so a render site that never names the field reads as absent;
 *   * anything outside `app-mobile` — `mingla-business` and the edge functions
 *     are swept by neither S-6 nor S-6b.
 *
 * The two shapes it does cover are the two where this wave actually lost
 * fields: `BusynessData` (the Traffic row) and the companion-stop element (the
 * type label and the review count).
 */

/*
  THE MATCHER WAS DEFEATABLE BY THIS CODEBASE'S OWN HOUSE STYLE — #1605 retest P1-A.

  The first cut of this extractor matched `/^([A-Za-z_$][\w$]*)\??\s*:/` at a
  statement start. A field with a LEADING MODIFIER or a QUOTED KEY never matched,
  and the walk then ran on to the next `;` with `atStatementStart = false`, so the
  field was not merely mis-parsed — it was INVISIBLE. Measured on a throwaway
  copy, one added field at a time, nothing else changed:

      …?: string;             on BusynessData          22 pass / 1 fail  ← caught
      readonly …: string;     on BusynessData          23 pass / 0 fail  ← INVISIBLE
      "…": string;            on BusynessData          23 pass / 0 fail  ← INVISIBLE
      readonly …: string;     on the companion element 23 pass / 0 fail  ← INVISIBLE

  `readonly` is not an exotic form here. It is the house style in the files this
  wave WROTE: every field of `FactsOptions` and `CuratedFactsOptions` in
  `expandedCardFacts.ts`, of `StopListStop` in `StopList.tsx`, and of
  `MetaSpanInput` in `deckCardPlate.tsx`. So the rule written to stop "a live
  field with producers and no decision" was green for the most likely way the
  next one would arrive — the exact bug class, arriving through the guard.

  Widened below to the four declaration forms, plus method signatures, plus a
  LOUD REFUSAL on an index signature: `[key: string]: unknown` makes exhaustive
  classification impossible, and a rule that claims exhaustiveness must say so
  rather than quietly classify the one member it can see. The widening is
  self-checked inside `S-6b` itself, so it cannot be narrowed back in silence.
*/

/** A member key, tolerating modifiers, quoted keys, `?`, and method syntax. */
const S6B_NAMED = new RegExp(
  '^(?:(?:readonly|public|protected|private|declare|abstract|static|override)\\s+)*'
  + '(?:(["\'])([A-Za-z_$][\\w$]*)\\1|([A-Za-z_$][\\w$]*))'
  + '\\s*\\??\\s*(?::|(?:<[^<>]*>)?\\s*\\()',
);

/** Top-level member keys of a brace-delimited type body. */
function typeFields(body, label) {
  const fields = [];
  let depth = 0;
  let i = 0;
  let atStatementStart = true;
  while (i < body.length) {
    const ch = body[i];
    // Checked BEFORE the depth walk swallows the `[`, or an index signature is
    // as invisible as a `readonly` field used to be.
    if (depth === 0 && atStatementStart && ch === '[') {
      assert.fail(
        `S-6b: ${label} declares an INDEX SIGNATURE or a computed key. This rule claims that every `
        + 'field of the shape is classified; with an index signature the shape has no enumerable '
        + 'field list at all, so that claim cannot be true and must not be made. Either give the '
        + 'shape named fields, or delete this shape from S6B_SHAPES and say in the header that it is '
        + 'no longer exhaustively classified.',
      );
    }
    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') { depth += 1; i += 1; continue; }
    if (ch === '}' || ch === ')' || ch === ']' || ch === '>') { depth -= 1; i += 1; atStatementStart = true; continue; }
    if (ch === ';' || ch === ',' || ch === '\n') { i += 1; atStatementStart = true; continue; }
    if (/\s/.test(ch)) { i += 1; continue; }
    if (depth === 0 && atStatementStart) {
      const m = S6B_NAMED.exec(body.slice(i));
      if (m) {
        fields.push(m[2] ?? m[3]);
        // Stop BEFORE the trailing `:` / `(` so the depth walk still sees it.
        i += m[0].length - 1;
        atStatementStart = false;
        continue;
      }
    }
    atStatementStart = false;
    i += 1;
  }
  assert.ok(
    fields.length > 0,
    `S-6b (vacuity): parsed ZERO fields out of ${label}. The extractor is pointed at the wrong text, `
    + 'so every classification below is asserting nothing.',
  );
  return fields;
}

/** The body between `openerRe`'s match and its balancing brace. */
function typeBody(source, openerRe, label) {
  const m = openerRe.exec(source);
  assert.ok(m, `S-6b (vacuity): ${label} could not be located — re-point this rule, do not delete it.`);
  const open = source.indexOf('{', m.index);
  assert.notEqual(open, -1, `S-6b (vacuity): ${label} has no body.`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  assert.fail(`S-6b (vacuity): ${label}'s body is unbalanced.`);
  return '';
}

// #4347 wave 3 — BusynessData left this ledger: the old conditions section (its only
// reader) is deleted and nothing on the sheet renders that shape any more; the
// crowd is the typical curve via placeSheetModel / curatedPlanModel (see S-7).
const S6B_SHAPES = [
  {
    label: 'the companion-stop element (expandedCardTypes.ts)',
    src: 'cardtypes',
    opener: /companionStops:\s*Array<\s*\{/,
    rendered: {
      // The modal builds a StopListStop from each companion; these are the
      // expressions that read the field by name.
      name: ['modal', /name:\s*companion\?\.name/],
      imageUrl: ['modal', /imageUrl:\s*companion\?\.imageUrl/],
      address: ['modal', /address:\s*companion\?\.address/],
      id: ['modal', /companion\?\.id/],
      rating: ['facts', /stop\.rating/],
      reviewCount: ['facts', /stop\.reviewCount/],
      type: ['facts', /companionTypeLabel\(stop\.type\)/],
    },
    notRendered: {
      location:
        'The lat/lng pair. Directions open from the ADDRESS string (`openDirectionsForAddress`), '
        + 'which is what the row already renders, so the coordinate has no second use here. It is '
        + 'read by the map surfaces, not by the sheet.',
      placeId:
        'The Google place id. It is an identity key, not a fact about the place — the row keys on '
        + '`companion.id` and nothing on this sheet resolves a place by placeId.',
    },
  },
];

test('S-6b every field of the two shapes this wave lost fields from is classified', () => {
  /*
    THE MATCHER'S OWN SELF-CHECK — first, because everything below it is only
    worth what the extractor can see. The previous matcher passed this file's
    23 rules with a `readonly` URL field sitting unclassified on `BusynessData`;
    the forms below are the ones that were measured, and the index-signature
    refusal is asserted to actually throw. Greek names, deliberately — see the
    A-5 note in the header.
  */
  const probe = typeFields(
    'readonly alpha: string;\n'
    + '"beta": number;\n'
    + "'gamma'?: boolean;\n"
    + 'delta?: string;\n'
    + 'epsilon: number;\n'
    + 'readonly zeta?: { theta: string };\n'
    + 'eta(): void;\n',
    'S-6b self-check',
  );
  assert.deepEqual(
    [...probe].sort(),
    ['alpha', 'beta', 'delta', 'epsilon', 'eta', 'gamma', 'zeta'],
    'S-6b (vacuity): the field matcher no longer sees every declaration form this codebase writes, so '
    + `"a field added without a decision fails" is false again. Saw: ${JSON.stringify(probe)}. A `
    + '`readonly` field is the house style in `expandedCardFacts.ts`, `StopList.tsx` and '
    + '`deckCardPlate.tsx` — a matcher blind to it is blind to the most likely next field.',
  );
  assert.throws(
    () => typeFields('[ix: string]: unknown;\n', 'S-6b index-signature self-check'),
    /INDEX SIGNATURE/,
    'S-6b (vacuity): an index signature no longer fails the extractor, so a shape with no enumerable '
    + 'field list would be reported as fully classified.',
  );

  for (const shape of S6B_SHAPES) {
    const source = stripComments(read(shape.src));
    const fields = typeFields(typeBody(source, shape.opener, shape.label), shape.label);

    const classified = [
      ...Object.keys(shape.rendered),
      ...Object.keys(shape.notRendered),
    ].sort();

    assert.deepEqual(
      [...fields].sort(),
      classified,
      `S-6b: ${shape.label}'s fields and its classification ledger disagree.\n`
      + `    declared in the type : ${[...fields].sort().join(', ')}\n`
      + `    classified here      : ${classified.join(', ')}\n\n`
      + 'A field in the type and NOT in the ledger is the bug this rule exists for: it has producers '
      + 'and nobody has decided whether the sheet shows it. Add it to `rendered` with the expression '
      + 'that renders it, or to `notRendered` with the reason it does not. A field in the ledger and '
      + 'NOT in the type means the field was deleted and its row went stale — delete the row too.',
    );

    for (const [field, [key, probe]] of Object.entries(shape.rendered)) {
      const consumer = stripComments(read(key));
      assert.match(
        consumer,
        probe,
        `S-6b: ${shape.label}.${field} is classified RENDERED, but ${SRC[key]} no longer matches `
        + `${probe}. Either the render site moved (re-point the probe) or it was deleted — in which `
        + 'case this is the third feature to vanish by having its render site removed while every '
        + 'producer kept writing the field, and the field must be reclassified or removed at source.',
      );
    }

    for (const [field, why] of Object.entries(shape.notRendered)) {
      assert.ok(
        typeof why === 'string' && why.trim().length >= 80,
        `S-6b: ${shape.label}.${field} is classified NOT RENDERED with no real reason. "Not rendered" `
        + 'is a decision and it has to be written down, or the ledger is a list of shrugs.',
      );
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// S-8 · THE TRAFFIC ROW IS DELETED AT BOTH ENDS — DATA AND COPY
// ─────────────────────────────────────────────────────────────────────────────

const S8_DEAD_BUSYNESS_KEYS = ['traffic', 'clear_roads', 'clear', 'moderate', 'heavy', 'busy', 'estimated'];

test('S-8 nothing produces, types, fetches or translates traffic any more', () => {
  // WHY THIS RULE IS A DELETION AND NOT A RESTORATION.
  //
  // `main` rendered a Traffic row — car icon, condition chip, travel time, its
  // own loading state. Wave 4 deleted the ROW and left the PRODUCER, so a
  // third-party Directions round-trip fired on every expanded-card open for a row
  // nobody saw, and the field sat in two type files with zero consumers.
  //
  // Restoring it would have restored a fabrication: the fallback arm returned
  // `${10 + extraMin} min` from the clock alone, and it fired whenever the
  // routing token was unset, location permission was denied or the request
  // failed. The real arm restated the distance span the plate already carries
  // (D-2: "14 min" beside "6.7 mi" is the same fact twice). So the producer
  // went with the row, and this rule keeps both ends deleted together.
  // #4347 wave 3 — the busyness service itself is DELETED (its last reader,
  // the plan's old conditions row, went in wave 3), so the producer cannot come
  // back by accident inside it. The rule now holds on the whole app tree.
  assert.deepEqual(
    fs.readdirSync(path.join(APP, 'src/services')).filter((f) => /^busyness/i.test(f)),
    [],
    'S-8: the deleted busyness service is back. Its only reader is gone; a revived service fetches for nobody.',
  );
  const directions = [...TREE].filter(([, src]) => /\/directions\//.test(src)).map(([file]) => file);
  assert.deepEqual(
    directions,
    [],
    'S-8: something fetches a Directions route again. That was one third-party round-trip per '
    + 'expanded-card open, for a row that does not exist.',
  );
  for (const dead of ['fetchTraffic', 'getTrafficHeuristic', 'TrafficInfo']) {
    const back = [...TREE].filter(([, src]) => src.includes(dead)).map(([file]) => file);
    assert.deepEqual(back, [], `S-8: \`${dead}\` is back in ${back.join(', ')}.`);
  }

  // …and nowhere else in the app either.
  const holdouts = [...TREE]
    .filter(([, src]) => /\btrafficInfo\b|\btrafficCondition\b|\bcurrentTravelTime\b/.test(src))
    .map(([file]) => file);
  assert.deepEqual(
    holdouts,
    [],
    `S-8: ${holdouts.length} module(s) still name a traffic field: ${holdouts.join(', ')}.`,
  );

  // THE COPY GOES WITH THE CODE. Five keys were left orphaned in 29 locale
  // files; two more (`busy`, `estimated`) belonged to the deleted
  // BusynessSection's own rows.
  const localeDir = path.join(REPO, 'app-mobile/src/i18n/locales');
  const locales = fs.readdirSync(localeDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  assert.ok(
    locales.length >= 29,
    `S-8 (vacuity): found ${locales.length} locales. The sweep is meant to cover all of them.`,
  );
  for (const locale of locales) {
    const file = path.join(localeDir, locale, 'expanded_details.json');
    if (!fs.existsSync(file)) continue;
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    const busyness = json.busyness ?? {};
    for (const dead of S8_DEAD_BUSYNESS_KEYS) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(busyness, dead),
        false,
        `S-8: ${locale}/expanded_details.json still carries \`busyness.${dead}\`, which nothing reads. `
        + 'Orphaned copy is how a deleted feature looks half-alive to the next person to open the file.',
      );
    }
    // Vacuity: the file really was parsed and the surviving key is still there.
    assert.ok(
      Object.prototype.hasOwnProperty.call(busyness, 'busy_level'),
      `S-8 (vacuity): ${locale}/expanded_details.json has no \`busyness.busy_level\`, so either the `
      + 'sweep deleted a live key or this rule is reading the wrong file.',
    );
    // The companion subtitle is the opposite case — copy that was orphaned and
    // is now CONSUMED again. It must survive in every locale.
    assert.ok(
      typeof json.companion_stops?.subtitle === 'string'
      && json.companion_stops.subtitle.trim().length > 0,
      `S-8: ${locale}/expanded_details.json lost \`companion_stops.subtitle\`, which the stroll's `
      + 'companion list renders. It is the only thing that tells the user those numbered rows are '
      + 'alternatives to begin at rather than a sequence to walk.',
    );
    assert.ok(
      typeof json.companion_stops?.reviews_count === 'string',
      `S-8: ${locale}/expanded_details.json lost \`companion_stops.reviews_count\`.`,
    );
  }
  const modal = stripComments(read('modal'));
  assert.match(
    modal,
    /companion_stops\.subtitle/,
    'S-8 (vacuity): the sheet no longer reads companion_stops.subtitle, so the locale assertion above '
    + 'is protecting copy nobody renders.',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// S-10 · A STOP'S PHOTOS DECODE IN A WINDOW, NOT ALL AT ONCE
// ─────────────────────────────────────────────────────────────────────────────

test('S-10 the lightbox mounts a window around the current page, not every page', () => {
  // `StopImageGallery` — deleted this wave — mounted an `<Image>` for the
  // current page and its immediate neighbours only, so a five-photo stop
  // decoded at most three. Its photos now open in `ImageLightbox` instead,
  // which mounted EVERY page at once: five full-screen `resizeMode="contain"`
  // decodes the moment it becomes visible, on a phone, inside a sheet.
  //
  // That per-slide lazy load is the one capability of the deleted component
  // that its replacement did not carry, and it is the kind of loss that never
  // shows up in a screenshot — it shows up as a dropped frame on a mid-range
  // Android. So it is carried here, and executed here.
  const lightbox = stripComments(read('lightbox'));

  const window_ = executable(
    lightbox,
    /\{\s*(Math\.abs\(\s*index\s*-\s*currentIndex\s*\)\s*<=\s*\d+)\s*\?/,
    'S-10 lightbox mount window',
    ['index', 'currentIndex'],
  );
  // Five photos, sitting on the first: the neighbour is warm, the rest are not.
  assert.equal(window_.fn(0, 0), true, 'S-10: the CURRENT page is not mounted.');
  assert.equal(window_.fn(1, 0), true, 'S-10: the next page is not mounted, so a paging swipe reveals '
    + 'an empty frame before the decode starts — worse than the eager mount this replaced.');
  for (const far of [2, 3, 4]) {
    assert.equal(
      window_.fn(far, 0),
      false,
      `S-10: page ${far} of a five-photo stop is still mounted while page 0 is showing, via `
      + `\`${window_.expr}\`. That is the eager mount back: every full-screen image decoded at once.`,
    );
  }
  // Symmetric — paging backwards must be warm too.
  assert.equal(window_.fn(3, 4), true, 'S-10: the PREVIOUS page is not mounted; the window is one-sided.');

  // Vacuity: the pages must still be full-width, or the window would silently
  // break the paging offsets rather than the decode count.
  assert.match(
    lightbox,
    /imageContainer:\s*\{\s*width:\s*SCREEN_WIDTH/,
    'S-10 (vacuity): the page container is no longer a fixed SCREEN_WIDTH, so an unmounted page would '
    + 'collapse and every scroll offset — including `initialIndex` — would land on the wrong photo.',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// S-9 · NO PRODUCER INVENTS A PER-STOP DURATION, SO `> 0` IS A REAL TEST
// ─────────────────────────────────────────────────────────────────────────────

test('S-9 a rendered "N min here" is a value a producer really carried', () => {
  // #1605 P2-4, twice reported. `stopMetaText`'s guard is
  // `typeof minutes === 'number' && minutes > 0`, and its comment claimed that
  // protected the row from `cardConverters`' invented 60. It did not, and could
  // not: `> 0` cannot distinguish an invented 60 from a real one.
  //
  // The comment also named the wrong file. `cardConverters.ts:132`'s `duration:
  // 60` is a strollData TIMELINE step — a different field on a different object,
  // which has never reached a stop's `estimatedDurationMinutes`. The ONE
  // producer that ever wrote a fabricated value onto the field this guard reads
  // was the chat trimmer: `Number(s.estimatedDurationMinutes) || 45`.
  //
  // So the fix is subtraction, not a better guard: with no producer inventing,
  // `> 0` IS the complete test rather than a proxy for one. This rule pins the
  // subtraction, because the guard silently stops being sufficient the moment
  // any producer starts filling the field in.
  const messaging = stripComments(read('messaging'));

  const trimmed = evaluable(
    messaging,
    /estimatedDurationMinutes:\s*([\s\S]{0,240}?),\s*\n\s*stopLabel:/,
    'S-9 chat trimmer',
    ['s'],
  );
  assert.equal(
    trimmed.fn({}),
    undefined,
    `S-9: a chat-shared stop with NO duration still arrives carrying one, via \`${trimmed.expr}\`. `
    + 'That invented number renders as "N min here" — an estimate of how long to spend somewhere that '
    + 'nobody ever made (Constitution 9), and the reason the expanded card\'s own guard could not be '
    + 'honest about what it protects.',
  );
  assert.equal(
    trimmed.fn({ estimatedDurationMinutes: 0 }),
    undefined,
    'S-9: a ZERO duration is still being replaced with an invented one — `|| 45` in a new shape.',
  );
  assert.equal(
    trimmed.fn({ estimatedDurationMinutes: 45 }),
    45,
    'S-9 (vacuity): a REAL 45-minute stop no longer survives the trimmer, so the assertions above are '
    + 'passing because the field is always dropped rather than because it is never invented.',
  );
  assert.equal(
    trimmed.fn({ estimatedDurationMinutes: 60 }),
    60,
    'S-9 (vacuity): a real 60 does not survive the trimmer.',
  );

  // …and the field must be OPTIONAL on the wire, or the trimmer cannot express
  // "absent" and would be forced back into inventing something.
  assert.match(
    messaging,
    /estimatedDurationMinutes\?:\s*number;/,
    'S-9: TrimmedCuratedStop.estimatedDurationMinutes is required again. A required numeric field has '
    + 'no way to say "unknown", which is exactly how the `|| 45` got there.',
  );

  // The guard itself, executed, at the values that matter.
  const facts = stripComments(read('facts'));
  const dur = executable(
    facts,
    /const minutes = stop\.estimatedDurationMinutes;\s*if \(([^)]+)\) parts\.push/,
    'S-9 stop duration guard',
    ['minutes'],
  );
  for (const v of [undefined, null, 0, -1, NaN, '45']) {
    assert.equal(
      dur.fn(v),
      false,
      `S-9: duration ${String(v)} still renders via \`${dur.expr}\`.`,
    );
  }
  assert.equal(dur.fn(45), true, 'S-9 (vacuity): a real 45-minute stop renders nothing.');

  // And the guard must be documented against the producer that ACTUALLY writes
  // this field. The first version of this comment named `cardConverters`, whose
  // 60 goes onto a strollData TIMELINE step and has never reached a stop — so
  // the guard's stated purpose could not be checked against anything. The
  // enumeration is the documentation, and `messagingService` is its subject.
  const factsRaw = fs.readFileSync(path.join(REPO, SRC.facts), 'utf8');
  const guardAt = factsRaw.indexOf('const minutes = stop.estimatedDurationMinutes;');
  assert.ok(guardAt > 0, 'S-9 (vacuity): the stop-duration guard could not be located in the source.');
  const rationale = factsRaw.slice(guardAt, factsRaw.indexOf('parts.push(minutesLabel', guardAt));
  assert.ok(
    rationale.length > 400,
    'S-9 (vacuity): the guard carries no rationale at all between the read and the push.',
  );
  assert.match(
    rationale,
    /messagingService/,
    'S-9: the stop-duration guard no longer names `messagingService` as the producer whose invention '
    + 'it depends on being gone. That is the only file that ever wrote a fabricated value onto this '
    + 'field, and a guard that is sufficient ONLY because a specific producer stopped inventing has to '
    + 'say which one, or nobody can tell when it stops being sufficient.',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// S-7 · BUSYNESS IS AN ESTIMATE AND THE ROW SAYS SO
// ─────────────────────────────────────────────────────────────────────────────

test('S-7 no synthesised busyness percentage renders as a measurement', () => {
  // #4347 wave 3 — REWRITTEN. The old conditions section (the only reader of
  // BusynessData) is deleted; every crowd value on the sheet is now the typical
  // curve, turned into a WORD by `crowdLevel` and shown as "Usually …". The
  // fabrication this rule exists for is a percentage or the advice string
  // ("Not busy (3%) — great time to visit!") reaching the screen, so: no file
  // that renders crowd reads BusynessData at all, and every crowd string a
  // surface can show starts with the typical-not-live wording.
  const surfaces = [
    'app-mobile/src/components/expandedCard/WhenYoudGo.tsx',
    'app-mobile/src/components/expandedCard/CuratedPlanBody.tsx',
    'app-mobile/src/components/expandedCard/PlanSections.tsx',
    'app-mobile/src/components/expandedCard/PlanStopCard.tsx',
    'app-mobile/src/components/expandedCard/curatedPlanModel.ts',
  ];
  for (const rel of surfaces) {
    const src = stripComments(fs.readFileSync(path.join(REPO, rel), 'utf8'));
    assert.ok(src.length > 400, `S-7 (vacuity): ${rel} was not read`);
    assert.equal(/currentPopularity|busyness\.message|getVenueBusyness|BusynessData/.test(src), false,
      `S-7: ${rel} reads the synthesised busyness percentage / advice again.`);
  }
  const en = JSON.parse(fs.readFileSync(path.join(APP, 'src/i18n/locales/en/cards.json'), 'utf8'));
  for (const level of ['quiet', 'steady', 'busy', 'packed']) {
    assert.match(en[`plan.crowd_then_${level}`], /^Usually /, `S-7: the plan's crowd chip for ${level} is not worded as typical`);
    assert.match(en[`sheet.crowd_usually_${level}`], /^Usually /, `S-7: the place's crowd for ${level} is not worded as typical`);
  }
  assert.match(en['plan.conditions_note'], /typical, not live/, 'S-7: the plan no longer says its crowd is typical, not live');
});
// ─────────────────────────────────────────────────────────────────────────────
// S-5 · THE STOP COUNT IS CONTINUOUS — deck and sheet count a plan the same way
// ─────────────────────────────────────────────────────────────────────────────

test('S-5 the deck and the sheet count a plan\'s stops the same way', async () => {
  // #4347 wave 3 — REWRITTEN. The sheet no longer draws the plate (it opens on
  // the gallery), so "the same span array on both surfaces" has no second
  // surface. The defect this rule was written for — the deck saying "2 stops"
  // and the opened sheet saying "3 stops" for the same plan — is still real,
  // and it is executed here: the deck's count (curatedDeckSpans, over
  // planVisibleStops) and the sheet's count (countedStops / stopOrdinals, the
  // Stops tile and the numbers on the stop cards) must agree on every shape.
  const body = stripComments(read('planbody'));
  assert.match(body, /const counted = countedStops\(stops\)/, 'S-5: the Stops tile no longer counts through countedStops');
  assert.match(body, /ordinal: timeline\[i\]\?\.ordinal \?\? null/, 'S-5: the route strip no longer numbers through the timeline ordinals');
  const deckDefiners = [...TREE]
    .filter(([, src]) => /export\s+function\s+curatedDeckSpans\b/.test(src))
    .map(([file]) => file);
  assert.deepEqual(deckDefiners, ['app-mobile/src/components/expandedCard/expandedCardFacts.ts'],
    `S-5: ${deckDefiners.length} module(s) define curatedDeckSpans`);

  const { curatedDeckSpans } = await import(pathToFileURL(path.join(REPO, SRC.facts)).href);
  const { countedStops, stopOrdinals } = await import(
    pathToFileURL(path.join(REPO, 'app-mobile/src/components/expandedCard/curatedPlanModel.ts')).href
  );
  const stop = (optional) => ({ placeName: 'x', optional, priceMin: 0, priceMax: 0, priceTier: 'chill', estimatedDurationMinutes: 30 });
  const shapes = {
    mixed: [stop(false), stop(true), stop(false)],
    allOptional: [stop(true), stop(true), stop(true)],
    plain: [stop(false), stop(false)],
  };
  for (const [name, stops] of Object.entries(shapes)) {
    const spans = curatedDeckSpans({ stops, estimatedDurationMinutes: 90, experienceType: 'romantic' }, {
      spendLevelLabel: (l) => l, freeLabel: 'Free', stopCountLabel: (n) => `${n} stops`, awayLabel: (m) => `${m} away`,
    });
    const deckCount = Number(/^(\d+) stops$/.exec(spans[0].text)[1]);
    assert.equal(countedStops(stops), deckCount, `S-5: ${name} — the sheet counts ${countedStops(stops)} stops, the deck ${deckCount}`);
    const max = Math.max(...stopOrdinals(stops).map((n) => n ?? 0));
    assert.equal(max, deckCount, `S-5: ${name} — the largest stop number on the sheet (${max}) is not the count the deck states`);
  }
});
// ─────────────────────────────────────────────────────────────────────────────
// S-11 · THE ORDINAL MACHINE, EXECUTED — every statement of it, from source
// ─────────────────────────────────────────────────────────────────────────────

/**
 * THE ORDINAL COUNTER WAS UNGATED — corrected here.
 *
 * S-6 pins the optional stop's two RENDER SITES (the visible chip and the a11y
 * branch), which is what makes deleting the marker a red test. Nothing gated the
 * NUMBERING, so the pre-fix hole could be restored in one character:
 *
 *     - indexLabel: isOptional ? '' : String(planOrdinal),
 *     + indexLabel: isOptional ? '' : String(i + 1),
 *
 * and the suite stayed at 23 pass / 0 fail. That revert is the original defect:
 * rows read 1, (Optional), 3 while the plate says "2 stops" — the same plan,
 * two numbers, one screen.
 *
 * So this rule lifts ALL FOUR statements of the machine out of the modal — the
 * main-stop count, the `isOptional` predicate, the counter bump and the
 * `indexLabel` expression — assembles them into the real loop and runs it over a
 * swept domain, with the plate's number coming from the REAL `planVisibleStops`.
 * Re-implementing any one of them here is how a rule ends up agreeing with
 * itself, so none of them is re-implemented.
 *
 * THE ALL-OPTIONAL SHAPE IS IN THE DOMAIN, and it is the shape the dead
 * `planMainStopCount > 0` conjunct used to leave broken (#1605 retest P2-C):
 * counted from `planVisibleStops`, whose fallback returns the full set, the
 * conjunct could never be false, so an all-optional plan said "3 stops" over
 * three unnumbered `Optional` rows. The modal now counts the non-optional stops
 * directly, which makes the guard live; restoring the fallback makes this rule
 * red rather than making the divergence latent again.
 */
test('S-11 the stops the sheet numbers are exactly the stops it counts', async () => {
  // #4347 wave 3 — RE-POINTED (not deleted): the plan's numbering moved from
  // StopList rows to the stop cards, route strip and navigator, all of which
  // read `stopOrdinals`. Optional stops carry NO number (they are tagged
  // Optional), main stops are 1..N contiguous, and an all-optional plan
  // numbers every stop.
  const { stopOrdinals, countedStops } = await import(
    pathToFileURL(path.join(REPO, 'app-mobile/src/components/expandedCard/curatedPlanModel.ts')).href
  );
  assert.deepEqual(stopOrdinals([{}, { optional: true }, {}]), [1, null, 2]);
  assert.deepEqual(stopOrdinals([{ optional: true }, { optional: true }]), [1, 2]);
  assert.deepEqual(stopOrdinals([{ optional: true }, {}, { optional: true }, {}]), [null, 1, null, 2]);
  assert.equal(countedStops([{}, { optional: true }, {}]), 2);
  const nav = stripComments(read('modal'));
  assert.match(nav, /ordinal: planOrdinals\[i\] \?\? null/, 'S-11: the navigator numbers stops some other way');
});
// ─────────────────────────────────────────────────────────────────────────────
// S-5b · THE BRAND-EXPERIENCE FLAG IS DERIVED, NOT ASSUMED
// ─────────────────────────────────────────────────────────────────────────────

/**
 * S-5 ABOVE GATES THE PASS-THROUGH AND NOT THE DERIVATION — corrected here.
 *
 * S-5 hands `curatedPlanSpans` an options object built from the call site's real
 * literal, but the VALUE of `isBrandExperience` comes from this file's `s5Deps`
 * stub. So deleting `isBrandExperience: isBrandExperiencePlan` from the call site
 * turns `USD 4500` into `Free` and S-5 goes red — correctly — while neutering the
 * DERIVATION itself:
 *
 *     - const isBrandExperiencePlan: boolean = (() => { … recovery … })();
 *     + const isBrandExperiencePlan: boolean = false;
 *
 * left the suite at 23 pass / 0 fail. That is the exact shape of ORCH-1065 BUG-1
 * — the sheet prints "Free" over a paid experience — and it was the one input
 * whose derivation IS the defect.
 *
 * This rule closes it from the other end: it LIFTS the real recovery expression
 * out of the modal, EXECUTES it over the truth table the recovery is supposed to
 * implement, and then feeds the DERIVED answer — never a literal — through the
 * real producer with the real call-site options literal. A derivation pinned to
 * `false` fails the first row; one pinned to `true` fails the negative rows; a
 * derivation that stops reading the brand attribution fails the structural row.
 */
test('S-5b the sheet DERIVES the brand-experience flag, and the Spend tile follows it', async () => {
  // #4347 wave 3 — RE-POINTED from the plate's money span to the Spend tile.
  // ORCH-1065 BUG-1: a brand experience's stops carry price 0, so summing
  // them prints "Free" over a paid experience. The sheet derives the flag from
  // the brand attribution (Likes re-tags a saved experience `curated`) and
  // hands it to the same price decision the plate used.
  const modal = stripComments(read('modal'));
  assert.match(modal, /const isBrandExperiencePlan: boolean = \(\(\) => \{/, 'S-5b: the sheet no longer derives the flag');
  assert.match(modal, /curatedPlanPriceLabel\(planCard, \{[\s\S]{0,400}isBrandExperience: isBrandExperiencePlan/, 'S-5b: the Spend tile ignores the flag');
  const { curatedPlanPriceLabel } = await import(pathToFileURL(path.join(REPO, SRC.facts)).href);
  const experience = {
    stops: [{ priceMin: 0, priceMax: 0, priceTier: 'chill' }, { priceMin: 0, priceMax: 0, priceTier: 'chill' }],
    totalPriceMin: 100000, totalPriceMax: 100000, currency: 'NGN',
  };
  const opts = (brand) => ({
    formatMoney: (p) => `money:${p.min}:${p.sourceCurrency}`,
    spendLevelLabel: (l) => `level:${l}`,
    freeLabel: 'Free',
    isBrandExperience: brand,
  });
  assert.equal(curatedPlanPriceLabel(experience, opts(true)), 'money:100000:NGN', 'S-5b: a paid experience does not show its own money');
  assert.notEqual(curatedPlanPriceLabel(experience, opts(true)), 'Free');
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
