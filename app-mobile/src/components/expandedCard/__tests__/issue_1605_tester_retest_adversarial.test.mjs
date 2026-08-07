/**
 * #1605 wave 4 RETEST — the TESTER's second adversarial gate.
 *
 * ---------------------------------------------------------------------------
 * WHY A SECOND FILE, AND WHAT ANGLE IT TAKES
 *
 * The implementor's suite proves its rework by REVERTING THIRTEEN EDITS and
 * watching a rule go red. That is a good proof of the edits. It is not a proof
 * of the JOURNEY: every one of those thirteen reverts is applied to a fixture
 * the suite itself built, and three of the six behaviours this wave claims to
 * have fixed were never reachable at runtime in this environment at all.
 *
 * So this file attacks from the other end.
 *
 *   A-4  runs a brand experience through the REAL persistence mapper — the one
 *        that destroys the discriminator — and then through the REAL predicate
 *        and the REAL span producer, and asserts the money span. `S-5` hands
 *        `curatedPlanSpans` a hand-built card and hand-passes
 *        `isBrandExperience: true`, which is the one input whose derivation is
 *        the actual bug. A-4 never passes the flag; it makes the code derive it.
 *
 *   A-5  attacks `S-6b`'s FIELD EXTRACTOR rather than the fields. `S-6b` claims
 *        "a field added to either type without a decision fails". It does not:
 *        its matcher is `/^([A-Za-z_$][\w$]*)\??\s*:/` at statement start, so a
 *        field written with ANY leading modifier — `readonly`, which is the
 *        house style in `expandedCardFacts.ts`, `StopList.tsx` and
 *        `deckCardPlate.tsx` — is invisible, and so is a quoted key. A-5 parses
 *        the same two shapes with a modifier-tolerant matcher and requires
 *        every field it finds to be NAMED in the implementor's suite.
 *
 *   A-6  EXECUTES the stop row's real `accessibilityLabel` expression over the
 *        three row kinds. `S-6`'s probes match the expression's TEXT; a text
 *        match cannot tell you what the ternary chooses, and the whole point of
 *        the a11y fix is which branch a row takes.
 *
 *   A-7  ties the plate's count to the list's ordinals by executing BOTH real
 *        rules over a swept domain, so "2 stops" and the rows numbered 1..2 can
 *        never again be two different claims.
 *
 * Every rule is anti-vacuity guarded: if the anchor it slices on has moved, it
 * FAILS rather than passing on an empty string, and each fixture is asserted to
 * be discriminating before it is trusted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The same two hooks the implementor's suite uses — real modules, not models. */
register(pathToFileURL(path.join(__dirname, 'issue_1605_ts_resolve_hooks.mjs')));

const APP = path.resolve(__dirname, '../../../..');
const REPO = path.resolve(APP, '..');

const SRC = {
  modal: 'app-mobile/src/components/ExpandedCardModal.tsx',
  stops: 'app-mobile/src/components/expandedCard/StopList.tsx',
  busyness: 'app-mobile/src/services/busynessService.ts',
  cardtypes: 'app-mobile/src/types/expandedCardTypes.ts',
  suite: 'app-mobile/src/components/expandedCard/__tests__/issue_1605_expanded_card_one_spine.test.mjs',
};

const read = (key) => fs.readFileSync(path.join(REPO, SRC[key]), 'utf8');

/** Comments out, string literals in (#1633: a grep that hits your own comment lies). */
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

/** The balanced slice starting at the opener character `open` found from `from`. */
function balanced(source, from, open, close, label) {
  const start = source.indexOf(open, from);
  assert.notEqual(start, -1, `${label} (vacuity): opener \`${open}\` not found — re-point this rule.`);
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return { text: source.slice(start + 1, i), end: i };
    }
  }
  assert.fail(`${label} (vacuity): unbalanced ${open}${close}.`);
  return { text: '', end: -1 };
}

/**
 * Enough TypeScript removed for `new Function` to accept an expression lifted
 * out of a .tsx file. Only the forms that actually appear in the slices below —
 * deliberately narrow, because a general TS stripper here would be a second
 * compiler nobody maintains.
 */
function detype(expr) {
  return expr
    // `card as { cardType?: unknown; brandId?: unknown }`
    .replace(/\s+as\s+\{[^{}]*\}/g, '')
    // `x as string` / `x as never`
    .replace(/\s+as\s+[A-Za-z_$][\w$.]*/g, '')
    // `const c: Foo =` → `const c =`
    .replace(/(\bconst\s+[A-Za-z_$][\w$]*)\s*:\s*[A-Za-z_$][\w$.<>|\s]*?(\s*=)/g, '$1$2');
}

// ═════════════════════════════════════════════════════════════════════════════
// A-4 · A PAID EXPERIENCE NEVER READS "FREE" — THROUGH THE REAL MAPPER
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The bug (ORCH-1065 BUG-1, reopened by this wave's Likes path):
 *
 *   1. a right-swiped experience is persisted WHOLE — `savedCardsService.saveCard`
 *      writes `card_data: { ...card, dateAdded, source }`, so `cardType:
 *      'experience'`, `brandId`, `eventId`, the envelope totals and the stops
 *      all survive;
 *   2. `savedCardToExpandedCardData` hits its `Array.isArray(stops)` branch and
 *      spreads the payload with `cardType: "curated"` STAMPED OVER the real
 *      discriminator;
 *   3. the sheet therefore receives a brand experience wearing a curated tag,
 *      and every stop of a brand experience carries `price_cents: 0` because
 *      the all-in price is on the ENVELOPE.
 *
 * Sum the stops and you print "Free" over a paid experience. The recovery has
 * to be STRUCTURAL because the tag is gone by the time the sheet sees it.
 *
 * This rule builds the payload the way the app builds it, runs the REAL mapper,
 * executes the REAL recovery predicate lifted out of `ExpandedCardModal`, and
 * feeds the result to the REAL `curatedPlanSpans`. Nothing about
 * `isBrandExperience` is supplied by the test.
 */
test('A-4 a paid brand experience saved from the deck never prints Free on the sheet', async () => {
  const { savedCardToExpandedCardData } = await import(
    path.join(APP, 'src/components/utils/savedCardToExpandedCardData.ts')
  );
  const { curatedPlanSpans } = await import(
    path.join(APP, 'src/components/expandedCard/expandedCardFacts.ts')
  );

  // The shape `experienceCardToRecommendation` produces, spread by `saveCard`.
  const ENVELOPE = 45;
  const experienceCard = {
    cardType: 'experience',
    id: 'evt-9001',
    eventId: 'evt-9001',
    brandId: 'brand-7001',
    brandName: 'Smoke & Rhythm',
    eventSlug: 'rooftop-supper',
    experienceType: 'adventurous',
    title: 'Rooftop Supper Club',
    tagline: 'Four courses, one skyline',
    currency: 'USD',
    totalPriceMin: ENVELOPE,
    totalPriceMax: ENVELOPE,
    estimatedDurationMinutes: 135,
    stops: [
      {
        stopNumber: 1, placeId: 'p1', placeName: 'The Terrace', address: '1 Sky Way',
        priceMin: 0, priceMax: 0, distanceFromUserKm: 9.3, estimatedDurationMinutes: 0,
        rating: 0, reviewCount: 0, imageUrl: '', imageUrls: [],
      },
      {
        stopNumber: 2, placeId: 'p2', placeName: 'The Cellar', address: '2 Sky Way',
        priceMin: 0, priceMax: 0, distanceFromUserKm: 9.6, estimatedDurationMinutes: 0,
        rating: 0, reviewCount: 0, imageUrl: '', imageUrls: [],
      },
    ],
    dateAdded: '2026-08-07T00:00:00.000Z',
    source: 'swipe',
  };

  // ── the fixture must be able to tell the two answers apart ──────────────────
  const stopSum = experienceCard.stops.reduce((s, x) => s + x.priceMin + x.priceMax, 0);
  assert.equal(stopSum, 0, 'A-4 (vacuity): the fixture stops must sum to zero, or the bug cannot fire.');
  assert.ok(ENVELOPE > 0, 'A-4 (vacuity): the envelope must be non-zero, or Free would be the honest answer.');

  // ── 1 · the REAL persistence mapper ────────────────────────────────────────
  const mapped = savedCardToExpandedCardData(experienceCard);
  assert.ok(mapped, 'A-4 (vacuity): the mapper returned nothing.');
  assert.equal(
    mapped.cardType,
    'curated',
    'A-4 (vacuity): the mapper no longer destroys the `experience` discriminator, so the structural '
    + 'recovery this rule exercises is no longer the thing under test. That is a WELCOME change — but '
    + 're-point this rule at the new path rather than deleting it, because the money span is what matters.',
  );
  assert.equal(mapped.brandId, 'brand-7001', 'A-4: `brandId` did not survive persistence + mapping.');
  assert.equal(mapped.eventId, 'evt-9001', 'A-4: `eventId` did not survive persistence + mapping.');

  // ── 2 · the REAL recovery predicate, lifted out of the sheet and executed ──
  const modal = stripComments(read('modal'));
  const anchor = modal.indexOf('isBrandExperiencePlan');
  assert.notEqual(
    anchor,
    -1,
    'A-4 (vacuity): `isBrandExperiencePlan` is gone from ExpandedCardModal.tsx. Either the recovery was '
    + 'deleted — in which case a paid experience opened from Likes prints "Free" again — or it was renamed. '
    + 'Re-point this rule; do not delete it.',
  );
  const body = balanced(modal, anchor, '{', '}', 'A-4 recovery predicate').text;
  assert.match(
    body,
    /return/,
    'A-4 (vacuity): the sliced predicate has no `return`, so executing it would assert nothing.',
  );
  const recover = new Function('card', 'planStops', detype(body));
  const derived = recover(mapped, mapped.stops);
  assert.equal(
    derived,
    true,
    'A-4: the sheet CANNOT tell that this is a brand experience. `cardType` was overwritten by the Likes '
    + 'mapper, so the only recovery left is structural (`brandId` + `eventId` beside a stops array). With '
    + 'the flag false, `curatedPriceLabel` sums stops that all carry price 0 and the plate prints "Free" '
    + 'over a paid experience — ORCH-1065 BUG-1, on the money span.',
  );

  // ── 3 · the REAL span producer, with the DERIVED flag ──────────────────────
  const options = {
    measurementSystem: 'Imperial',
    formatMoney: (amount) => `USD ${amount}`,
    freeLabel: 'Free',
    stopCountLabel: (count) => `${count} stops`,
    intentLabel: (slug) => slug,
    isBrandExperience: derived,
  };
  const spans = curatedPlanSpans(mapped, options).map((s) => s.text);

  assert.ok(
    spans.includes(`USD ${ENVELOPE}`),
    `A-4: the plate does not carry the experience's price. spans = ${JSON.stringify(spans)}`,
  );
  assert.ok(
    !spans.includes('Free'),
    `A-4: the plate says FREE over a ${ENVELOPE}-dollar experience. spans = ${JSON.stringify(spans)}`,
  );

  // ── 4 · the negative control — the fixture really is discriminating ────────
  const wrong = curatedPlanSpans(mapped, { ...options, isBrandExperience: false }).map((s) => s.text);
  assert.ok(
    wrong.includes('Free'),
    'A-4 (vacuity): with the flag forced false the plate STILL does not say Free, so this fixture cannot '
    + 'distinguish the two answers and the assertion above proves nothing.',
  );

  // ── 5 · and the sheet must actually PASS the derived flag ──────────────────
  const call = modal.indexOf('curatedPlanSpans(');
  assert.notEqual(call, -1, 'A-4 (vacuity): the sheet no longer calls `curatedPlanSpans`.');
  const literal = balanced(modal, call, '{', '}', 'A-4 span options').text;
  assert.match(
    literal,
    /isBrandExperience\s*:\s*isBrandExperiencePlan/,
    'A-4: the sheet derives the flag and then does not pass it to the producer. Deriving it is only half '
    + 'the fix — the span is built from what the call site hands over.',
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// A-5 · S-6b's DISCOVERY HALF IS MODIFIER-BLIND
// ═════════════════════════════════════════════════════════════════════════════

/**
 * `S-6b` is the rule the rework offers as the answer to "a field nobody thought
 * about has no row, and no row means no assertion". It parses the field list out
 * of the type and requires every field in a ledger.
 *
 * Its matcher only fires at a STATEMENT START on a bare identifier followed by
 * `:`. So:
 *
 *     crowdSourceUrl?: string;            → caught     (S-6b red)
 *     readonly crowdSourceUrl: string;    → INVISIBLE  (S-6b 23 pass / 0 fail)
 *     "crowdSourceUrl": string;           → INVISIBLE  (S-6b 23 pass / 0 fail)
 *
 * `readonly` is not an exotic form. It is the house style in the files this very
 * wave wrote — `FactsOptions` and `CuratedFactsOptions` in `expandedCardFacts.ts`
 * mark every field `readonly`, and so do `StopListStop` in `StopList.tsx` and
 * `MetaSpanInput` in `deckCardPlate.tsx`. The next person to add a field to
 * `BusynessData` following the surrounding style adds an unclassified field and
 * the gate stays green.
 *
 * This rule re-parses the SAME two shapes with a matcher that tolerates leading
 * modifiers and quoted keys, and requires every field it finds to be NAMED
 * somewhere in the implementor's suite — which is where both ledgers live.
 */
function tolerantTypeBody(source, openerRe, label) {
  const m = openerRe.exec(source);
  assert.ok(m, `A-5 (vacuity): ${label} could not be located — re-point this rule, do not delete it.`);
  return balanced(source, m.index, '{', '}', `A-5 ${label}`).text;
}

/**
 * Top-level keys, tolerating `readonly` / `public` / `declare` prefixes and
 * quoted keys. Same depth walk as the rule it shadows, so the only difference
 * between the two answers is the matcher.
 */
function tolerantFields(body, label) {
  const fields = [];
  let depth = 0;
  let i = 0;
  let atStatementStart = true;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') { depth += 1; i += 1; continue; }
    if (ch === '}' || ch === ')' || ch === ']' || ch === '>') { depth -= 1; i += 1; atStatementStart = true; continue; }
    if (ch === ';' || ch === ',' || ch === '\n') { i += 1; atStatementStart = true; continue; }
    if (/\s/.test(ch)) { i += 1; continue; }
    if (depth === 0 && atStatementStart) {
      const m = /^(?:(?:readonly|public|declare|abstract)\s+)*(?:\[?["']?)([A-Za-z_$][\w$]*)["']?\]?\??\s*:/
        .exec(body.slice(i));
      if (m) {
        fields.push(m[1]);
        i += m[0].length;
        atStatementStart = false;
        continue;
      }
    }
    atStatementStart = false;
    i += 1;
  }
  assert.ok(fields.length > 0, `A-5 (vacuity): parsed ZERO fields out of ${label}.`);
  return fields;
}

test('A-5 every field of the two classified shapes is named in the gate, modifiers and all', () => {
  // The matcher must actually be tolerant, or this rule is the one it shadows.
  const probe = tolerantFields(
    'readonly alpha: string;\n"beta": number;\ngamma?: boolean;\n',
    'A-5 self-check',
  );
  assert.deepEqual(
    probe.sort(),
    ['alpha', 'beta', 'gamma'],
    'A-5 (vacuity): the tolerant matcher does not see a `readonly` or a quoted key, so it is no better '
    + 'than the matcher it exists to shadow.',
  );

  const suite = fs.readFileSync(path.join(REPO, SRC.suite), 'utf8');
  assert.match(
    suite,
    /S6B_SHAPES|S-6b/,
    'A-5 (vacuity): the implementor suite no longer carries the S-6b ledgers this rule cross-checks.',
  );

  const shapes = [
    {
      label: 'BusynessData (busynessService.ts)',
      body: tolerantTypeBody(
        stripComments(read('busyness')),
        /export interface BusynessData\s*\{/,
        'BusynessData',
      ),
      known: ['isBusy', 'busynessLevel', 'currentPopularity', 'popularTimes', 'message', 'isEstimated'],
    },
    {
      label: 'the companion-stop element (expandedCardTypes.ts)',
      body: tolerantTypeBody(
        stripComments(read('cardtypes')),
        /companionStops:\s*Array<\s*\{/,
        'companionStops element',
      ),
      known: ['id', 'name', 'location', 'address', 'rating', 'reviewCount', 'imageUrl', 'placeId', 'type'],
    },
  ];

  for (const shape of shapes) {
    const fields = tolerantFields(shape.body, shape.label);

    // Anti-vacuity: the shape this wave classified must still be in there.
    for (const expected of shape.known) {
      assert.ok(
        fields.includes(expected),
        `A-5 (vacuity): ${shape.label} no longer declares \`${expected}\`, so this rule is parsing the `
        + 'wrong text. Re-point it.',
      );
    }

    for (const field of fields) {
      assert.ok(
        new RegExp(`\\b${field}\\b`).test(suite),
        `A-5: ${shape.label}.${field} is declared on the type and is NAMED NOWHERE in `
        + `${SRC.suite}.\n\n`
        + 'S-6b claims "a field added to either type without a decision fails". It does not: its field '
        + 'matcher only fires on a bare identifier at a statement start, so a field written `readonly '
        + `${field}: …\` or \`"${field}": …\` is invisible to it and the gate stays green. That is the `
        + 'exact shape of the bug this wave exists to close — a live field with producers and no '
        + 'decision. Classify it in S-6b (RENDERED with its expression, or NOT-RENDERED with a reason), '
        + 'and widen S-6b\'s matcher so the next one cannot arrive the same way.',
      );
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// A-6 · THE STOP ROW'S ANNOUNCEMENT, EXECUTED — not matched as text
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Three announcements changed in this rework and two of them were WRONG before:
 * an optional stop announced "Stop 3" against a plate saying "2 stops", and the
 * picnic grocery row announced "Stop 0" — an ordinal that does not exist.
 *
 * `S-6`'s probes match the expression's TEXT. Text cannot tell you which arm of
 * a nested ternary a row takes, and the arm IS the fix. So this rule lifts the
 * real `accessibilityLabel` expression out of `StopList.tsx` and RUNS it, with a
 * `t` that interpolates the real defaultValue — which means the strings under
 * test are the ones the component ships.
 */
function interpolate(template, opts) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts?.[k] ?? ''));
}

test('A-6 no row announces an ordinal it does not have', () => {
  const stops = stripComments(read('stops'));
  const at = stops.indexOf('accessibilityLabel=');
  assert.notEqual(
    at,
    -1,
    'A-6 (vacuity): the stop row has no `accessibilityLabel` at all — every row would announce its raw '
    + 'subtree, which is the nested-Pressable failure this component was built to avoid.',
  );
  const expr = balanced(stops, at, '{', '}', 'A-6 accessibilityLabel').text;
  assert.match(expr, /stop\.optional/, 'A-6 (vacuity): the sliced label expression does not branch on `optional`.');
  assert.match(expr, /indexLabel/, 'A-6 (vacuity): the sliced label expression does not read `indexLabel`.');

  const t = (_key, opts) => interpolate(opts?.defaultValue ?? '', opts);
  const present = (v) => typeof v === 'string' && v.trim().length > 0;
  const label = new Function('stop', 't', 'present', `return (${detype(expr)});`);

  // ── a numbered row announces its OWN digit ────────────────────────────────
  const numbered = label(
    { optional: false, indexLabel: '3', name: 'Knightdale Station Park', meta: '★ 4.8 · 60 min here' },
    t, present,
  );
  assert.match(
    numbered,
    /Stop 3\b/,
    `A-6: a numbered row must announce its ordinal. Got ${JSON.stringify(numbered)}`,
  );
  assert.match(numbered, /Knightdale Station Park/, 'A-6: the numbered row does not announce its name.');

  // ── an OPTIONAL row announces the word, and NEVER an ordinal ──────────────
  const optional = label(
    { optional: true, indexLabel: '', name: 'Fresh Petals', meta: '★ 4.6' },
    t, present,
  );
  assert.doesNotMatch(
    optional,
    /Stop\s*\d/,
    'A-6: an OPTIONAL stop announces an ordinal. The plate counts non-optional stops only, so a row that '
    + 'announces "Stop 3" against a plate saying "2 stops" gives a screen-reader user two numbers that '
    + `cannot be reconciled. Got ${JSON.stringify(optional)}`,
  );
  assert.match(
    optional,
    /Optional/i,
    `A-6: an optional stop must say so. Got ${JSON.stringify(optional)}`,
  );
  assert.match(optional, /Fresh Petals/, 'A-6: the optional row does not announce its name.');

  // ── a WORD-CHIPPED row (the picnic grocery `SHOP`) announces no ordinal ───
  const shop = label(
    { optional: false, indexLabel: 'SHOP', name: 'Lowes Foods of Knightdale', meta: '★ 4.4 (128 reviews)' },
    t, present,
  );
  assert.doesNotMatch(
    shop,
    /Stop\s*\d/,
    'A-6: the picnic grocery row announces an ordinal. It carries `index: 0`, so the pre-rework label '
    + `said "Stop 0" — a position in a sequence it is not in. Got ${JSON.stringify(shop)}`,
  );
  assert.match(shop, /Lowes Foods of Knightdale/, 'A-6: the shop row does not announce its name.');

  // ── the fixture is discriminating: the three arms are three answers ───────
  assert.equal(
    new Set([numbered, optional, shop]).size,
    3,
    'A-6 (vacuity): the three row kinds produce the same announcement, so the branch under test is not '
    + 'branching and every assertion above is satisfied by one string.',
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// A-7 · THE PLATE'S COUNT AND THE LIST'S ORDINALS ARE ONE CLAIM
// ═════════════════════════════════════════════════════════════════════════════

/**
 * "2 stops" over three rows numbered 1, 2, 3 is the defect this wave's optional
 * chip exists to close, and it is a defect only because two rules disagreed. The
 * plate uses the REAL `planVisibleStops`; the list numbers with the modal's own
 * `isOptional` rule. This rule runs BOTH — the real function and the real
 * predicate lifted from the modal — across the whole small domain, and requires
 * the highest ordinal on screen to equal the number on the plate.
 *
 * SWEEPING FOUND A GAP, AND IT IS PINNED HERE RATHER THAN ASSUMED AWAY.
 *
 * The modal guards the marker with `stop.optional === true && planMainStopCount
 * > 0`, and `planMainStopCount` is `planVisibleStops(planStops).length`. That
 * guard reads as "do not mark rows optional when there are no MAIN stops" — but
 * `planVisibleStops` ends in `main.length > 0 ? main : all`, so for a non-empty
 * plan it never returns 0 and the second conjunct is unreachable-false. On an
 * ALL-optional plan the plate therefore says "3 stops" while all three rows are
 * chipped `Optional` and none is numbered — the same two-numbers-one-screen
 * defect the chip exists to close, inverted.
 *
 * The generator does not emit such a plan today (every type definition pairs the
 * optional Flowers stop with two required ones, and required stops are not
 * `dismissible`), so this is latent, not live. The equality is therefore
 * asserted over the reachable domain — every plan with at least one main stop —
 * and the dead conjunct is pinned separately, so it cannot be "fixed" by
 * accident or lost.
 */
test('A-7 the largest ordinal in the list always equals the count on the plate', async () => {
  const { planVisibleStops } = await import(
    path.join(APP, 'src/components/expandedCard/expandedCardFacts.ts')
  );

  const modal = stripComments(read('modal'));

  /*
    THE WHOLE ORDINAL MACHINE IS LIFTED, not modelled. Slicing only the
    `isOptional` predicate and re-implementing the counter around it is how a
    rule ends up agreeing with itself: reverting `String(planOrdinal)` to
    `String(i + 1)` — the pre-fix numbering, which skips a digit after an
    optional row — would then pass. All three statements come from source.
  */
  const mOptional = /const\s+isOptional\s*=\s*([^;]+);/.exec(modal);
  assert.ok(
    mOptional,
    'A-7 (vacuity): the modal no longer computes `isOptional` for a plan row, so either the optional '
    + 'marker was deleted (the plate and the list disagree again) or it moved. Re-point this rule.',
  );
  assert.match(
    mOptional[1],
    /optional/,
    'A-7 (vacuity): the sliced `isOptional` expression does not mention `optional`.',
  );

  const mBump = /if\s*\(!isOptional\)\s*([A-Za-z_$][\w$]*)\s*\+=\s*1;/.exec(modal);
  assert.ok(
    mBump,
    'A-7 (vacuity): the ordinal counter no longer advances only on non-optional rows. Re-point this rule.',
  );
  const counter = mBump[1];

  const mLabel = /indexLabel:\s*(isOptional[^,\n]+),/.exec(modal);
  assert.ok(
    mLabel,
    'A-7 (vacuity): the plan row no longer derives `indexLabel` from `isOptional`. Re-point this rule.',
  );
  assert.match(
    mLabel[1],
    new RegExp(`\\b${counter}\\b`),
    `A-7: the row's index chip does not read the ordinal counter (\`${counter}\`). If it numbers from the `
    + 'ARRAY INDEX instead, an optional row leaves a hole — rows read 1, (Optional), 3 while the plate '
    + 'says "2 stops". That is the pre-fix numbering.',
  );

  const ordinals = new Function(
    'stops', 'planMainStopCount',
    `let ${counter} = 0;\n`
    + 'return stops.map((stop, i) => {\n'
    + `  ${detype(`const isOptional = ${mOptional[1]};`)}\n`
    + `  if (!isOptional) ${counter} += 1;\n`
    + `  return ${detype(mLabel[1])};\n`
    + '});',
  );
  const isOptional = new Function('stop', 'planMainStopCount', `return (${detype(mOptional[1])});`);

  const mk = (flags) => flags.map((optional, i) => ({
    placeId: `p${i}`,
    optional,
    priceMin: 0,
    priceMax: 0,
  }));

  const DOMAIN = [
    [],
    [false],
    [true],
    [false, false],
    [false, true],
    [true, false],
    [true, true],
    [false, true, false],
    [true, true, true],
    [false, false, true, false, true],
  ];

  let sawOptionalRow = false;
  let sawReachablePlan = false;

  for (const flags of DOMAIN) {
    const stopsArr = mk(flags);
    const plateCount = planVisibleStops(stopsArr).length;

    // The modal's own ordinal loop — its statements, executed.
    const labels = ordinals(stopsArr, plateCount);
    if (stopsArr.some((stop) => isOptional(stop, plateCount))) sawOptionalRow = true;
    const numbered = labels.filter((l) => l !== '');

    // Every plan the generator can actually produce has at least one main stop.
    if (flags.some((optional) => optional === false)) {
      sawReachablePlan = true;
      assert.equal(
        numbered.length,
        plateCount,
        `A-7: [${flags.join(',')}] — the plate says ${plateCount} and the list numbers `
        + `${numbered.length} rows (${JSON.stringify(labels)}). Two numbers about the same plan, on one `
        + 'screen, that cannot both be read as true.',
      );
      assert.deepEqual(
        numbered,
        Array.from({ length: plateCount }, (_, i) => String(i + 1)),
        `A-7: [${flags.join(',')}] — the numbered rows are not the contiguous 1..${plateCount} the `
        + `plate's count is about. Got ${JSON.stringify(labels)}.`,
      );
    }

    // Whatever the shape, the ordinals that ARE handed out are a contiguous run
    // from 1 — an off-by-one here is what makes a row's chip and its
    // announcement disagree.
    assert.deepEqual(
      numbered,
      Array.from({ length: numbered.length }, (_, i) => String(i + 1)),
      `A-7: [${flags.join(',')}] — the ordinals are not contiguous from 1. Got ${JSON.stringify(labels)}.`,
    );
  }

  assert.ok(sawOptionalRow, 'A-7 (vacuity): no row in the swept domain was ever optional.');
  assert.ok(sawReachablePlan, 'A-7 (vacuity): no plan in the swept domain had a main stop.');

  /*
    THE DEAD CONJUNCT, PINNED.

    `planMainStopCount > 0` is written as though it could be false. It cannot:
    `planVisibleStops` falls back to the full set, so a non-empty plan always
    yields a positive count. Asserting the fallback here means that if anyone
    ever removes it — making the guard live and an all-optional plan number its
    rows — this rule tells them the guard's meaning just changed, instead of the
    change landing silently.
  */
  assert.equal(
    planVisibleStops([{ optional: true }, { optional: true }]).length,
    2,
    'A-7: `planVisibleStops` no longer falls back to the full set for an all-optional plan. That makes '
    + "the modal's `planMainStopCount > 0` conjunct LIVE for the first time, which changes what an "
    + 'all-optional plan renders. Intended or not, it is a behaviour change and it needs its own row.',
  );
  assert.ok(
    isOptional({ optional: true }, planVisibleStops([{ optional: true }]).length) === true,
    'A-7: an all-optional plan now numbers its rows. If that is the deliberate fix for the plate/list '
    + 'divergence on such a plan, extend the equality assertion above to the whole domain and delete '
    + 'this pin — do not leave both.',
  );
});
