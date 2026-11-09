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
  // #4347 wave 3 — the plan's route strip / navigator announce the plan's stops.
  summary: 'app-mobile/src/components/expandedCard/PlanSummary.tsx',
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
  // [TEST-MOD-APPROVED #3281] #1672 / Round 1 PR 1d now preserves `cardType:
  // 'experience'` through savedCardToExpandedCardData (no curated stamp). The
  // money-span recovery below still runs; vacuity expects the FIXED discriminator.
  const mapped = savedCardToExpandedCardData(experienceCard);
  assert.ok(mapped, 'A-4 (vacuity): the mapper returned nothing.');
  assert.equal(
    mapped.cardType,
    'experience',
    'A-4 (vacuity): the mapper must keep `experience` (#3281 1d / #1672). If this is curated again, '
    + 'Book is gone on Likes and the Free-over-paid recovery is the only remaining safety net.',
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

  // ── 3 · the REAL price decision, with the DERIVED flag ─────────────────────
  // #4347 wave 3 — RE-POINTED: the plan sheet shows the price in its Spend
  // tile through `curatedPlanPriceLabel` (the plate is gone from the sheet).
  const { curatedPlanPriceLabel } = await import(
    path.join(APP, 'src/components/expandedCard/expandedCardFacts.ts')
  );
  const options = {
    formatMoney: (price) => `USD ${price.min}`,
    spendLevelLabel: (level) => level,
    freeLabel: 'Free',
    isBrandExperience: derived,
  };
  const shown = curatedPlanPriceLabel(mapped, options);
  assert.equal(shown, `USD ${ENVELOPE}`, `A-4: the Spend tile does not carry the experience's price. Got ${shown}`);

  // ── 4 · the negative control — the fixture really is discriminating ────────
  const wrong = curatedPlanPriceLabel(mapped, { ...options, isBrandExperience: false });
  assert.notEqual(wrong, shown, 'A-4 (vacuity): with the flag forced false the tile shows the same thing, so the fixture proves nothing.');

  // ── 5 · and the sheet must actually PASS the derived flag ──────────────────
  const call = modal.indexOf('curatedPlanPriceLabel(');
  assert.notEqual(call, -1, 'A-4 (vacuity): the sheet no longer prices the plan through `curatedPlanPriceLabel`.');
  const literal = balanced(modal, call, '{', '}', 'A-4 price options').text;
  assert.match(literal, /isBrandExperience\s*:\s*isBrandExperiencePlan/,
    'A-4: the sheet derives the flag and then does not pass it to the price decision.');
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
    // #4347 wave 3 — BusynessData left the S-6b ledger: nothing on the sheet
    // renders it (the old conditions section is deleted; the crowd is the typical curve).
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
  // #4347 wave 3 — RE-POINTED. Optional stops left StopList with the plan:
  // the plan announces its stops on the route strip / navigator (PlanSummary)
  // and StopList now serves the companion rows (numbered, or the SHOP word).
  // Both label expressions are lifted from source and RUN.
  const t = (_key, opts) => interpolate(opts?.defaultValue ?? (_key === 'cards:plan.route_stop_a11y' ? 'Go to stop {{number}}, {{name}}' : ''), opts);
  const present = (v) => typeof v === 'string' && v.trim().length > 0;

  const stops = stripComments(read('stops'));
  const at = stops.indexOf('accessibilityLabel=');
  assert.notEqual(at, -1, 'A-6 (vacuity): the companion row has no `accessibilityLabel` at all.');
  const expr = balanced(stops, at, '{', '}', 'A-6 accessibilityLabel').text;
  assert.match(expr, /indexLabel/, 'A-6 (vacuity): the sliced label expression does not read `indexLabel`.');
  const rowLabel = new Function('stop', 't', 'meta', `return (${detype(expr)});`);
  const numbered = rowLabel({ indexLabel: '3', name: 'Knightdale Station Park' }, t, ', ★ 4.8');
  assert.match(numbered, /Stop 3\b/, `A-6: a numbered row must announce its ordinal. Got ${JSON.stringify(numbered)}`);
  const shop = rowLabel({ indexLabel: 'SHOP', name: 'Lowes Foods of Knightdale' }, t, ', ★ 4.4');
  assert.doesNotMatch(shop, /Stop\s*\d/, `A-6: the picnic grocery row announces an ordinal. Got ${JSON.stringify(shop)}`);
  assert.match(shop, /Lowes Foods of Knightdale/, 'A-6: the shop row does not announce its name.');

  const summary = stripComments(read('summary'));
  const rat = summary.indexOf('accessibilityLabel={', summary.indexOf('function RouteStop'));
  assert.notEqual(rat, -1, 'A-6 (vacuity): the route stop has no accessibilityLabel.');
  const rexpr = balanced(summary, rat, '{', '}', 'A-6 route label').text;
  assert.match(rexpr, /ordinal !== null/, 'A-6 (vacuity): the route label does not branch on the ordinal.');
  const routeLabel = new Function('stop', 't', `return (${detype(rexpr)});`);
  const main = routeLabel({ ordinal: 2, name: 'Nike Art' }, t);
  assert.match(main, /stop 2\b/i, `A-6: a numbered plan stop does not announce its number. Got ${JSON.stringify(main)}`);
  const optional = routeLabel({ ordinal: null, name: 'Fresh Petals' }, t);
  assert.doesNotMatch(optional, /\d/, `A-6: an OPTIONAL plan stop announces an ordinal. Got ${JSON.stringify(optional)}`);
  assert.match(optional, /Fresh Petals/, 'A-6: the optional stop does not announce its name.');
  assert.equal(new Set([numbered, shop, main, optional]).size, 4, 'A-6 (vacuity): the arms are not branching.');
});
test('A-7 the largest ordinal on the plan always equals the count the deck states', async () => {
  // #4347 wave 3 — RE-POINTED from the modal's ordinal loop to `stopOrdinals`,
  // which numbers the stop cards, the route strip and the navigator. The deck
  // counts with `planVisibleStops`. Swept over the whole small domain — and the
  // all-optional plan is now INSIDE the equality (stopOrdinals numbers every
  // stop there), which closes the latent gap the previous version pinned.
  const { planVisibleStops } = await import(path.join(APP, 'src/components/expandedCard/expandedCardFacts.ts'));
  const { stopOrdinals } = await import(path.join(APP, 'src/components/expandedCard/curatedPlanModel.ts'));
  const DOMAIN = [[], [false], [true], [false, false], [false, true], [true, false], [true, true], [false, true, false], [true, true, true], [false, false, true, false, true]];
  let sawOptional = false;
  for (const flags of DOMAIN) {
    const stopsArr = flags.map((optional, i) => ({ placeId: `p${i}`, optional }));
    const plateCount = planVisibleStops(stopsArr).length;
    const ordinals = stopOrdinals(stopsArr);
    if (ordinals.includes(null)) sawOptional = true;
    const numbered = ordinals.filter((n) => n !== null);
    assert.equal(numbered.length, plateCount, `A-7: [${flags.join(',')}] — the deck says ${plateCount} and the plan numbers ${numbered.length}`);
    assert.deepEqual(numbered, Array.from({ length: plateCount }, (_, i) => i + 1), `A-7: [${flags.join(',')}] — not a contiguous 1..N`);
  }
  assert.ok(sawOptional, 'A-7 (vacuity): no stop in the swept domain was ever unnumbered.');
});
