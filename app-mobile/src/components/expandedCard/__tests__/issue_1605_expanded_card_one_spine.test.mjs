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
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  assert.match(
    stops,
    /isOpen\s*!==\s*null\s*\?/,
    'S-2b: the badge no longer hides when the offset is unknown.',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// S-3 · THE DELETE THAT CANNOT COME BACK UNDER ANOTHER NAME
// ─────────────────────────────────────────────────────────────────────────────

test('S-3 there is exactly ONE Been-here control in the whole app, by SIGNATURE', () => {
  // THIS IS THE RULE THAT WOULD HAVE CAUGHT THE DELETE THAT CAME BACK.
  //
  // `ActionButtons` carried a complete, never-rendered Been-there button gated on
  // two props no caller ever passed. Deleting it by name is easy; keeping it
  // deleted is not, because the next implementation will live in another file
  // under another name. So this rule names NO symbol it expects to be absent.
  // It sweeps every source file in app-mobile and counts modules that carry the
  // STRUCTURAL signature of a visited-state control:
  //
  //     it reads the visited state   (useHasVisited / useMyVisits / hasVisited)
  //     AND it owns a press          (onPress= / Pressable / TouchableOpacity)
  //     AND it writes or prompts     (useRecordVisit / useRemoveVisit /
  //                                   record-visit / openPlaceReviewRequest)
  //
  // A copy under any name, in any file, matches all three.
  const READS = /\buseHasVisited\s*\(|\bisVisited\b|\bhasVisited\b/;
  const PRESSES = /onPress\s*=|<Pressable\b|<TouchableOpacity\b|TrackedTouchableOpacity\b/;
  const WRITES = /\buseRecordVisit\b|\buseRemoveVisit\b|['"]record-visit['"]|\bopenPlaceReviewRequest\s*\(|\bremoveVisit\.mutate\b/;

  const offenders = [];
  for (const [file, src] of TREE) {
    if (READS.test(src) && PRESSES.test(src) && WRITES.test(src)) offenders.push(file);
  }

  assert.deepEqual(
    offenders.sort(),
    ['app-mobile/src/components/SwipeableCards.tsx'],
    `S-3: ${offenders.length} module(s) carry the visited-control signature: ${offenders.join(', ')}.\n\n`
    + 'There must be exactly ONE, and it must be SwipeableCards.tsx, whose exported BeenHereControl '
    + 'the expanded hero mounts. A second one — under any name, in any file — is a second Been-here '
    + 'in a different shape at a different size with a different state machine, which is precisely '
    + 'what deleting ActionButtons\' never-rendered implementation prevented. If you are adding a new '
    + 'surface, MOUNT the existing control; do not write another.',
  );

  // Anti-vacuity: the three probes must actually be capable of matching, or this
  // rule passes because the regexes are wrong rather than because the tree is clean.
  const owner = TREE.get('app-mobile/src/components/SwipeableCards.tsx');
  assert.ok(owner, 'S-3 (vacuity): the owning module was not swept at all');
  assert.ok(READS.test(owner) && PRESSES.test(owner) && WRITES.test(owner),
    'S-3 (vacuity): the signature no longer matches the ONE real control, so it could not match a copy either');
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
