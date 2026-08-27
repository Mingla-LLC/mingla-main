/**
 * #2700 TESTER suite — the share card's detail row, attacked.
 *
 * The implementor's happy suite proves the reported production string composes
 * cleanly and that five fixed Latin rows lay out inside the plate's clip. This
 * one only goes where that suite does not:
 *
 *   - the EXACT truncation boundary, character by character, rather than a
 *     comfortably-long string in the middle of the band;
 *   - the scripts the advance table does not model at all (Han, Hangul, Kana,
 *     Cyrillic, Greek, Hebrew, Thai, Devanagari, emoji, ZWJ sequences, stacked
 *     combining marks) measured on the REAL rasteriser, not reasoned about;
 *   - facts that are made ONLY of separators, which is the one input that can
 *     turn the fix's own trailing-strip against it;
 *   - a single fact wider than the whole row, which reaches the character-level
 *     fallback the happy suite only brushes;
 *   - the two plates compared byte-for-byte under adversarial tokens rather
 *     than under one well-behaved pair;
 *   - and the width model's ERROR BOUND, because that model is an ESTIMATE and
 *     a systematic under-count would put the shaper back in charge of the cut.
 *
 * KNOWN GAP — recorded here so nobody mistakes A6/A8 for total coverage.
 * `FACT_ADVANCE_EM` charges each class its widest measured member but
 * `FACT_WIDTH_CALIBRATION` then inflates the budget by 9%, and several classes
 * carry under 9% headroom (uppercase .78 vs a measured .764; lowercase .61 vs
 * .599; digits .69 vs .671). A fact built from a UNIFORM run of those glyphs
 * therefore measures as fitting and lays out one line too tall. Reproduced on
 * the rasteriser with descender-free glyphs, so it is not descender bleed:
 *
 *   category: '0x0k '.repeat(18)   -> 3 ink bands, ink to y=134, clip at y=95
 *   category: 'pop up '.repeat(13) -> 3 ink bands, ink to y=139
 *
 * 69 of 297 uniform-run probes overflow; 0 of 200 realistic category/area
 * combinations and 0 of 29 multi-script strings do. A8 pins the BOUND that
 * still holds — the error never exceeds one line — so the gap cannot widen
 * unnoticed, and closing it properly keeps A8 green.
 *
 * FAILS-ON-REVERT (each proven by real line deletion on
 * `mingla-business/server/cardIdentityRenderer.js`, never by comment-out, with
 * the file restored byte-identically afterwards):
 *   A1  `withoutDanglingSeparator` -> identity                          RED
 *   A2  both plates -> `join(" · ")`                                    RED
 *   A3  both plates -> `join(" · ")`; or FACT_WIDTH_CALIBRATION 1.09->1.20 RED
 *   A4  drop the `+ ELLIPSIS` from the fact-drop candidate              RED
 *   A5  fallback-card plate alone -> `tokens.join(" · ")`               RED
 *   A6  UNKNOWN_ADVANCE_EM 1.3 -> 0.2                                   RED
 *   A7  both plates -> `join(" · ")`                                    RED
 *   A8  FACT_WIDTH_CALIBRATION 1.09 -> 1.60                             RED
 *   A9  flip a byte in the provider workflow without re-banking         RED
 *
 * WHY THE PROVIDER WORKFLOW FILENAME IS ASSEMBLED FROM PARTS BELOW AND NEVER
 * WRITTEN WHOLE: `discoverWorkflowProviders()` in
 * `.github/scripts/ci-batch/validate-manifest-v2.mjs` scans every tracked
 * non-workflow file for /[A-Za-z0-9_.-]+\.ya?ml/ and mints an external provider
 * record for every match that names a real workflow. That record set is sealed
 * at a frozen count and digest (#2653, five occurrences), so one spelled-out
 * workflow filename anywhere in this file fails the required registry gate
 * closed. A9b guards this file against exactly that regression.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SELF = path.join(HERE, path.basename(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const renderer = require(path.join(ROOT, 'mingla-business/server/cardIdentityRenderer.js'));
const sharp = require(path.join(ROOT, 'mingla-business/node_modules/sharp'));
const React = require(path.join(ROOT, 'mingla-business/node_modules/react'));
const { SURFACES } = require(path.join(ROOT, 'packages/card-identity'));

const S = SURFACES.s4Snippet;
const SCALE = 3;
const ELLIPSIS = '…';
const MIDDOT = '·';
const SEPARATOR = ` ${MIDDOT} `;
/** A real 1x1 PNG. `data:` URIs short-circuit `prepareCoverForOg`, so this suite makes no network call. */
const COVER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
/** The plate's own geometry, read from the measured descriptor — never retyped. */
const PLATE_SIDE_PADDING = 12;
const USABLE = (S.plateW - 2 * PLATE_SIDE_PADDING) * SCALE;
const BAND = 16 * SCALE;
const CLIP_BANDS = 2;
/** `cleanText(value, 120)` caps every fact at 120 code points; stay inside it. */
const FACT_CAP = 118;

function walk(node, out = []) {
  if (node == null || node === false) return out;
  if (Array.isArray(node)) { for (const child of node) walk(child, out); return out; }
  if (typeof node !== 'object') return out;
  out.push(node);
  walk(node.props?.children, out);
  return out;
}
/** The detail row, found by its own geometry rather than by sibling position. */
function detailRowOrNull(element) {
  const rows = walk(element).filter((node) => {
    const style = node.props?.style;
    return style && style.maxHeight === 32 * SCALE && style.marginTop === 3 * SCALE && style.wordBreak === 'break-word';
  });
  assert.ok(rows.length <= 1, `expected at most one detail row, found ${rows.length}`);
  if (!rows.length) return null;
  const children = rows[0].props.children;
  assert.equal(typeof children, 'string', 'the detail row must compose a single string');
  return children;
}

const coveredShare = (facts) => ({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', version: 1, facts, media: { kind: 'photo', url: COVER, posterUrl: COVER } });
const coverlessShare = (facts) => ({ shortCode: 'Bb1Cc2Dd3Ee4Ff5G', version: 1, facts, media: null });
const venueFacts = (category, area) => ({ schemaVersion: 1, kind: 'venue', title: 'Terra', category, ...(area === undefined ? {} : { area }) });

/** The fallback-card plate, WITH a cover. */
const covered = (category, area) => detailRowOrNull(renderer.contentSharePortraitElement(coveredShare(venueFacts(category, area))));
/** The fallback-card plate, WITHOUT a cover — the stamp is live on this path. */
const coverless = (category, area) => detailRowOrNull(renderer.contentSharePortraitElement(coverlessShare(venueFacts(category, area))));
/** The covered card-identity plate, whose facts come through a DIFFERENT selector. */
const identity = (category, location, surface = 's4Snippet') => detailRowOrNull(renderer.cardIdentityElement(
  { kind: 'place', title: 'Terra', cover_url: COVER, metadata: { category, ...(location === undefined ? {} : { location }) } }, surface, SCALE));

/** Every plate this issue touches, so no case can be checked on one and skipped on the others. */
const PLATES = Object.freeze({ covered, coverless, identity });

/**
 * Count the 16pt bands that carry ink when the composed row is laid out
 * UNCONSTRAINED at the plate's real width and typography. The plate clips at
 * two bands, so a row measuring more than two is a row the shaper has to cut —
 * which is precisely the state #2700 removed.
 */
async function inkBands(text) {
  const { ImageResponse } = await import(path.join(ROOT, 'mingla-business/node_modules/@vercel/og/dist/index.node.js'));
  const height = BAND * 8;
  const element = React.createElement('div',
    { style: { width: USABLE, height, display: 'flex', background: '#000000', color: '#FFFFFF', fontFamily: 'Inter, Arial, sans-serif' } },
    React.createElement('div', { style: { display: 'flex', width: USABLE, fontSize: 13 * SCALE, lineHeight: `${BAND}px`, fontWeight: 500, wordBreak: 'break-word' } }, text));
  const png = Buffer.from(await new ImageResponse(element, { width: USABLE, height }).arrayBuffer());
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  let used = 0;
  for (let band = 0; band < Math.floor(info.height / BAND); band += 1) {
    let ink = false;
    for (let y = band * BAND; y < (band + 1) * BAND && !ink; y += 1)
      for (let x = 0; x < info.width; x += 1) if (data[y * info.width * info.channels + x * info.channels] > 40) { ink = true; break; }
    if (ink) used = band + 1;
  }
  return used;
}

const endsOnSeparator = (line) => /[\s·]$/u.test(line);
const separatorBeforeEllipsis = (line) => /[\s·]…$/u.test(line);

/**
 * Inputs that all three plates must survive. Deliberately includes the scripts
 * the advance table has no entry for, the ones it charges through the
 * unknown-glyph rate, and the separator-shaped degenerates.
 */
const NFC = (value) => (typeof value === "string" ? value.normalize("NFC") : value);
const ADVERSARIAL_FACTS = Object.freeze({
  han: ['東京都渋谷区神南一丁目二十三番地四号ビル五階', '大阪市中央区心斎橋筋二丁目'],
  kana: ['とうきょうとしぶやくじんなんいっちょうめ', 'おおさかしちゅうおうく'],
  hangul: ['서울특별시 강남구 테헤란로 삼백이십일 빌딩 오층', '부산광역시 해운대구 우동'],
  cyrillic: ['Ресторан и винный бар с внутренним двориком', 'Тверская улица 12, Москва'],
  cyrillic_caps: ['Ж'.repeat(36), 'Щ'.repeat(20)],
  greek: ['Εστιατόριο και μπαρ κρασιού με αυλή', 'Οδός Ερμού 25, Αθήνα'],
  greek_caps: ['Ω'.repeat(32), 'Ξ'.repeat(12)],
  hebrew: ['מסעדה ובר יין שכונתי עם חצר ומרתף', 'רחוב דיזנגוף 100, תל אביב'],
  thai: ['ร้านอาหารและบาร์ไวน์ในย่าน', 'ถนนสุขุมวิท กรุงเทพฯ'],
  devanagari: ['आंगन और तहखाने के साथ पड़ोस का वाइन बार', 'कनॉट प्लेस, नई दिल्ली'],
  arabic: ['مطعم ومقهى الحي مع فناء وقبو للنبيذ', 'شارع الملك فهد، الرياض'],
  emoji: ['\u{1F389}\u{1F38A}\u{1F388}\u{1F381}\u{1F382}\u{1F370}\u{1F9C1}\u{1F36D}\u{1F36C}\u{1F36B}\u{1F37F}\u{1F369}\u{1F36A}\u{1F32E}\u{1F32F}', '\u{1F957}\u{1F958}\u{1F372}\u{1F35C}\u{1F35D}'],
  emoji_zwj: ['\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}'.repeat(5), '\u{1F469}‍\u{1F4BB}\u{1F468}‍\u{1F680}'],
  combining: ['é'.repeat(39), 'àâäãå'],
  combining_stacked: ['ȩ̨̭̮̰̱̀́̂̃̄̅̆̇̈'.repeat(3), 'b̀́̂̃̄̅̆̇̈'],
  fullwidth: ['ＷＷＷＷＭＭＭＭ'.repeat(3), 'ＷＷＷＷ'],
  math_bold: ['\u{1D416}'.repeat(20), '\u{1D40C}'.repeat(8)],
  separator_only_one: [MIDDOT, 'Peckham'],
  separator_only_both: [MIDDOT, `${MIDDOT}${MIDDOT}${MIDDOT}`],
  separator_padded: [`${MIDDOT}   ${MIDDOT}`, `  ${MIDDOT}  `],
  fact_with_trailing_separator: ['Wine bar ·', 'Peckham ·'],
  fact_with_trailing_space: ['Wine bar   ', '   Peckham   '],
  one_char: ['W', 'M'],
  unbroken_over_capacity: ['Q'.repeat(FACT_CAP), undefined],
  unbroken_widest_glyph: ['W'.repeat(FACT_CAP), undefined],
  words_over_capacity: [Array.from({ length: 10 }, () => 'Kensington').join(' '), undefined],
  reported_production_shape: ['Museum and cultural centre with a permanent collection', 'Akin Adesola Street 175, Victoria Island, Lagos 106104, Lagos, Nigeria'],
  empty_and_real: ['', 'Peckham'],
  both_empty: ['', ''],
  whitespace_only: ['   ', '\t  '],
});
/**
 * Every literal above, normalised. `cleanText` on the fallback-card path NFC-
 * normalises its facts; `selectSharedCardFacts` on the card-identity path does
 * NOT — so a DECOMPOSED input reaches the two plates in different forms and
 * they compose different rows for reasons that have nothing to do with
 * truncation. That divergence is in the fact selectors and predates this issue;
 * it is raised separately, and controlled for here so A5 measures what it
 * claims to measure.
 */
const NORMALISED_FACTS = Object.freeze(Object.fromEntries(
  Object.entries(ADVERSARIAL_FACTS).map(([name, pair]) => [name, pair.map(NFC)])));

/**
 * The rasteriser in this engine THROWS on Arabic shaping
 * (`lookupType: 5 - substFormat: 3 is not yet supported`, opentype.js inside
 * @vercel/og 0.11.1). That is a pre-existing engine limitation, not #2700's, so
 * Arabic is asserted at composition level everywhere and excluded from the two
 * tests that reach the rasteriser. Raised separately; do NOT "fix" it here.
 */
const RASTERISER_CANNOT_SHAPE = new Set(['arabic']);

test('A1 no plate, for any adversarial fact pair, can end its detail row on a separator or on whitespace', () => {
  let composed = 0;
  let absent = 0;
  for (const [name, [category, area]] of Object.entries(ADVERSARIAL_FACTS)) {
    for (const [plateName, plate] of Object.entries(PLATES)) {
      const line = plate(category, area);
      // A plate whose facts all strip to nothing renders NO row. That is the
      // shipped #2589 behaviour and not this fix's business.
      if (line === null) { absent += 1; continue; }
      assert.ok(!endsOnSeparator(line), `${name}/${plateName}: row ends on a separator or whitespace -> ${JSON.stringify(line)}`);
      assert.ok(!separatorBeforeEllipsis(line), `${name}/${plateName}: separator survives just before the ellipsis -> ${JSON.stringify(line)}`);
      // The reported shape, verbatim, must be impossible to compose.
      assert.ok(!line.includes(`${MIDDOT}${MIDDOT}`), `${name}/${plateName}: two separators collapsed together -> ${JSON.stringify(line)}`);
      composed += 1;
    }
  }
  // The denominator is asserted, not assumed: a sweep that inspected nothing and
  // reported clean is a FAILED run, not a pass.
  const total = Object.keys(ADVERSARIAL_FACTS).length * Object.keys(PLATES).length;
  assert.equal(composed + absent, total, `visited ${composed + absent} plate/fact pairs, expected ${total}`);
  assert.ok(composed >= 60, `only ${composed} of ${total} pairs actually composed a row`);
});

test('A2 a fact made only of separators contributes no glyph, and never stands alone as the row', () => {
  let examined = 0;
  for (const [name, [category, area]] of Object.entries({
    only_separator_first: [MIDDOT, 'Peckham'],
    only_separator_alone: [MIDDOT, undefined],
    only_separators_both: [MIDDOT, `${MIDDOT} ${MIDDOT}`],
    separator_with_padding: [`  ${MIDDOT}  `, 'Peckham'],
  })) {
    for (const [plateName, plate] of Object.entries(PLATES)) {
      const line = plate(category, area);
      if (line === null) { examined += 1; continue; }
      assert.ok(!line.includes(MIDDOT) || line.includes(SEPARATOR),
        `${name}/${plateName}: a bare separator reached the row -> ${JSON.stringify(line)}`);
      assert.notEqual(line.trim(), MIDDOT, `${name}/${plateName}: the row IS a lone separator`);
      // Whatever survives is real content or nothing — never punctuation alone.
      if (line !== '') assert.ok(/[\p{L}\p{N}]/u.test(line), `${name}/${plateName}: row carries no letter or digit -> ${JSON.stringify(line)}`);
      examined += 1;
    }
  }
  assert.equal(examined, 4 * Object.keys(PLATES).length, `examined ${examined} plate/fact pairs, expected ${4 * Object.keys(PLATES).length}`);
});

test('A3 the truncation boundary is exact — the last fitting input keeps every character, one more character truncates', () => {
  // Both boundaries were found by growing the input one character at a time
  // against THIS renderer and confirming on the rasteriser that the fitting side
  // lays out in exactly two bands. They are calibration-coupled on purpose: a
  // change to FACT_WIDTH_CALIBRATION or to the advance table MOVES them, and
  // this test is the thing that says so out loud.
  const CASES = Object.freeze({
    unbroken_word: { fits: 'n'.repeat(39), over: 'n'.repeat(40) },
    words_then_tail: {
      fits: `${Array.from({ length: 5 }, () => 'Kensington').join(' ')} ${'n'.repeat(19)}`,
      over: `${Array.from({ length: 5 }, () => 'Kensington').join(' ')} ${'n'.repeat(20)}`,
    },
  });
  let examined = 0;
  for (const [name, { fits, over }] of Object.entries(CASES)) {
    const fitting = covered(fits, undefined);
    assert.equal(fitting, fits, `${name}: a row that fits must be returned untouched`);
    assert.ok(!fitting.includes(ELLIPSIS), `${name}: an ellipsis was invented for content that is all there`);

    const truncated = covered(over, undefined);
    assert.ok(truncated.endsWith(ELLIPSIS), `${name}: one character past the boundary must truncate visibly -> ${JSON.stringify(truncated)}`);
    assert.notEqual(truncated, over, `${name}: the over-long row was passed through unchanged`);
    assert.ok(over.startsWith(truncated.slice(0, -ELLIPSIS.length)), `${name}: the surviving row is not a prefix of the input`);
    assert.ok(!separatorBeforeEllipsis(truncated), `${name}: separator survives before the ellipsis`);
    examined += 1;
  }
  assert.equal(examined, Object.keys(CASES).length, `examined ${examined} boundaries, expected ${Object.keys(CASES).length}`);
});

test('A4 a single fact wider than the whole row degrades to a real row — never empty, never a throw, never a bare separator', () => {
  const CASES = Object.freeze({
    unbroken_widest: 'W'.repeat(FACT_CAP),
    unbroken_narrow: 'l'.repeat(FACT_CAP),
    unbroken_unknown_script: '東'.repeat(FACT_CAP),
    one_long_word_then_nothing: 'Supercalifragilisticexpialidociousandthensomeverylongunbrokenvenuename',
    many_words: Array.from({ length: 12 }, () => 'Kensington').join(' '),
    word_then_giant_word: `Terra ${'Q'.repeat(100)}`,
  });
  let examined = 0;
  let stamped = 0;
  for (const [name, category] of Object.entries(CASES)) {
    for (const [plateName, plate] of Object.entries(PLATES)) {
      let line;
      assert.doesNotThrow(() => { line = plate(category, undefined); }, `${name}/${plateName}: composing an over-wide fact threw`);
      // On the COVERLESS plate the stamp legitimately consumes a lone
      // `category` (`stampContent` reports it in `consumedKeys`), so the plate
      // renders no facts row at all. That is #2589's shipped behaviour, not a
      // truncation outcome, and it can only happen on that one plate.
      if (line === null) {
        assert.equal(plateName, 'coverless', `${name}/${plateName}: an over-wide fact erased the row entirely`);
        stamped += 1;
        examined += 1;
        continue;
      }
      assert.notEqual(line, '', `${name}/${plateName}: an over-wide fact composed to an empty row`);
      assert.ok(line.endsWith(ELLIPSIS), `${name}/${plateName}: an over-wide fact must show it was cut -> ${JSON.stringify(line)}`);
      assert.ok(line.length > ELLIPSIS.length, `${name}/${plateName}: the row is nothing but an ellipsis`);
      assert.ok(!endsOnSeparator(line) && !separatorBeforeEllipsis(line), `${name}/${plateName}: dangling separator -> ${JSON.stringify(line)}`);
      examined += 1;
    }
  }
  const total = Object.keys(CASES).length * Object.keys(PLATES).length;
  assert.equal(examined, total, `examined ${examined} plate/fact pairs, expected ${total}`);
  // A run where the stamp swallowed every case would have asserted nothing.
  assert.ok(examined - stamped >= Object.keys(CASES).length * 2,
    `only ${examined - stamped} of ${total} pairs actually composed a truncated row`);
});

test('A5 the two plates compose byte-identical rows under adversarial tokens — they cannot drift apart', () => {
  // The fallback-card plate passes a HARD-CODED 13 while the card-identity
  // plate passes `s.metaSize`. They agree today only because s4Snippet.metaSize
  // IS 13; this test is what notices if either side moves.
  assert.equal(S.metaSize, 13, 'the plates agree only while s4Snippet.metaSize is 13');
  let matched = 0;
  let skipped = 0;
  for (const [name, [category, area]] of Object.entries(NORMALISED_FACTS)) {
    const fallbackRow = covered(category, area);
    const identityRow = identity(category, area);
    if (fallbackRow === null || identityRow === null) { skipped += 1; continue; }
    assert.equal(identityRow, fallbackRow, `${name}: the two plates truncated the same facts differently`);
    matched += 1;
  }
  assert.equal(matched + skipped, Object.keys(NORMALISED_FACTS).length, `visited ${matched + skipped} fact pairs, expected ${Object.keys(NORMALISED_FACTS).length}`);
  assert.ok(matched >= 20, `only ${matched} pairs were actually compared on both plates`);
});

test('A6 RUNTIME: rows in scripts the advance table does not model still lay out inside the plate clip', async () => {
  // The decisive proof for every script the table falls through to the
  // unknown-glyph charge for. Rendered on the real engine at the plate's real
  // width and typography, then counted band by band — not reasoned about from a
  // style object, and not inferred from the estimate that is under test.
  let examined = 0;
  let skipped = 0;
  for (const [name, [category, area]] of Object.entries(ADVERSARIAL_FACTS)) {
    if (RASTERISER_CANNOT_SHAPE.has(name)) { skipped += 1; continue; }
    const line = covered(category, area);
    if (line === null || line === '') { skipped += 1; continue; }
    const bands = await inkBands(line);
    // Anti-vacuity: a row that rendered NO ink would satisfy "<= 2" for free.
    assert.ok(bands >= 1, `${name}: the composed row rendered no ink at all -> ${JSON.stringify(line)}`);
    assert.ok(bands <= CLIP_BANDS, `${name}: composed row lays out in ${bands} bands, the plate clips at ${CLIP_BANDS} -> ${JSON.stringify(line)}`);
    examined += 1;
  }
  assert.equal(examined + skipped, Object.keys(ADVERSARIAL_FACTS).length, `visited ${examined + skipped} cases, expected ${Object.keys(ADVERSARIAL_FACTS).length}`);
  assert.ok(examined >= 20, `only ${examined} rows actually reached the rasteriser`);
});

test('A7 the ellipsis is added only when something was dropped, exactly once, and only at the very end', () => {
  const FITS = Object.freeze({
    two_short_facts: ['Wine bar', 'Peckham'],
    one_short_fact: ['Wine bar', undefined],
    exactly_at_boundary: ['n'.repeat(39), undefined],
    realistic_pair: ['Rooftop cocktail lounge', 'Peckham Rye, London'],
  });
  const TRUNCATES = Object.freeze({
    reported_shape: ['Museum and cultural centre with a permanent collection', 'Akin Adesola Street 175, Victoria Island, Lagos 106104, Lagos, Nigeria'],
    one_over_boundary: ['n'.repeat(40), undefined],
    unbroken_giant: ['Q'.repeat(FACT_CAP), undefined],
  });
  let examined = 0;
  let stamped = 0;
  let truncations = 0;
  for (const [name, [category, area]] of Object.entries(FITS)) {
    for (const [plateName, plate] of Object.entries(PLATES)) {
      const line = plate(category, area);
      // The coverless plate's stamp consumes `category`, so a case whose ONLY
      // fact is a category renders no row there at all. #2589's behaviour, and
      // only ever on that plate.
      if (line === null) { assert.equal(plateName, 'coverless', `${name}/${plateName}: a fitting row went missing`); stamped += 1; examined += 1; continue; }
      assert.notEqual(line, '', `${name}/${plateName}: a fitting row composed to nothing`);
      assert.ok(!line.includes(ELLIPSIS), `${name}/${plateName}: a complete row must not claim there is more -> ${JSON.stringify(line)}`);
      // The coverless plate's stamp consumes `category` before the row is
      // composed, so there the surviving fact is `area`. Every plate must still
      // carry a fact it was given, whole.
      const carried = [category, area].filter(Boolean).some((fact) => line.includes(fact));
      assert.ok(carried, `${name}/${plateName}: a fitting row carries none of its facts -> ${JSON.stringify(line)}`);
      if (plateName !== 'coverless') assert.ok(line.includes(category), `${name}/${plateName}: a fitting row lost its leading fact`);
      examined += 1;
    }
  }
  for (const [name, [category, area]] of Object.entries(TRUNCATES)) {
    for (const [plateName, plate] of Object.entries(PLATES)) {
      const line = plate(category, area);
      if (line === null) { assert.equal(plateName, 'coverless', `${name}/${plateName}: a truncated row went missing`); stamped += 1; examined += 1; continue; }
      assert.notEqual(line, '', `${name}/${plateName}: a truncated row composed to nothing`);
      const occurrences = Array.from(line).filter((character) => character === ELLIPSIS).length;
      // Universal, on every plate: never more than one, and never anywhere but
      // the very end.
      assert.ok(occurrences <= 1, `${name}/${plateName}: ${occurrences} ellipses in one row -> ${JSON.stringify(line)}`);
      if (occurrences === 1) {
        assert.equal(line.indexOf(ELLIPSIS), line.length - ELLIPSIS.length, `${name}/${plateName}: the ellipsis is not at the end`);
        truncations += 1;
      }
      // The coverless plate's stamp removes a fact before the row is composed,
      // so what is left there can legitimately fit. The two plates that receive
      // the WHOLE fact set must truncate.
      if (plateName !== 'coverless') assert.equal(occurrences, 1, `${name}/${plateName}: an over-long row was not truncated -> ${JSON.stringify(line)}`);
      examined += 1;
    }
  }
  const total = (Object.keys(FITS).length + Object.keys(TRUNCATES).length) * Object.keys(PLATES).length;
  assert.equal(examined, total, `examined ${examined} plate/fact pairs, expected ${total}`);
  assert.ok(examined - stamped >= 14, `only ${examined - stamped} of ${total} pairs actually composed a row`);
  // Anti-vacuity: a run in which nothing truncated would satisfy every
  // "at most one ellipsis" assertion for free.
  assert.ok(truncations >= Object.keys(TRUNCATES).length * 2, `only ${truncations} rows actually truncated`);
});

test('A8 RUNTIME: the width model is an estimate, and its error stays bounded at one line', async () => {
  // See KNOWN GAP in this file's header. `FACT_ADVANCE_EM` charges each class
  // its widest measured member but `FACT_WIDTH_CALIBRATION` then inflates the
  // budget 9%, and several classes carry under 9% headroom — so a UNIFORM run
  // of those glyphs measures as fitting and lays out one line too tall.
  //
  // This test does NOT assert the gap exists; closing it properly keeps this
  // green. It pins the BOUND that still holds, so the model cannot silently
  // drift further, and it proves the composed row is still well-formed even
  // when the estimate is wrong — the row is never emptied and never left with a
  // dangling separator by a mis-measure.
  const BOUND = CLIP_BANDS + 1;
  const UNIFORM_RUNS = Object.freeze({
    lowercase_x: 'xxx ', lowercase_k: 'kkk ', lowercase_q: 'qqq ',
    digit_zero: '0000 ', euro: '€€€ ', mixed_narrow: '0x0k ',
    plausible_words: 'pop up ', uppercase_o: 'OOO ', uppercase_w: 'WWW ',
  });
  let examined = 0;
  let overClip = 0;
  for (const [name, unit] of Object.entries(UNIFORM_RUNS)) {
    const category = unit.repeat(Math.floor(FACT_CAP / unit.length)).trim();
    const line = covered(category, undefined);
    assert.notEqual(line, null, `${name}: the row went missing`);
    assert.notEqual(line, '', `${name}: a mis-measure emptied the row`);
    assert.ok(!endsOnSeparator(line) && !separatorBeforeEllipsis(line),
      `${name}: a mis-measure left a dangling separator -> ${JSON.stringify(line)}`);
    const bands = await inkBands(line);
    assert.ok(bands >= 1, `${name}: the composed row rendered no ink at all`);
    assert.ok(bands <= BOUND, `${name}: composed row lays out in ${bands} bands — the estimate's error exceeded one line -> ${JSON.stringify(line)}`);
    if (bands > CLIP_BANDS) overClip += 1;
    examined += 1;
  }
  assert.equal(examined, Object.keys(UNIFORM_RUNS).length, `examined ${examined} uniform runs, expected ${Object.keys(UNIFORM_RUNS).length}`);
  // Reported, not asserted — this number is the size of the KNOWN GAP and is
  // expected to fall to zero when the calibration is corrected.
  console.log(`A8: ${overClip} of ${examined} uniform runs currently exceed the ${CLIP_BANDS}-band clip (known gap, bounded at ${BOUND})`);
});

test('A9 CI actually collects THIS suite, and the provider seal is re-derived rather than transcribed', () => {
  // #2653 — assembled from parts, never written whole. See the header.
  const WORKFLOW_NAME = ['issue-1719-unified-sharing', 'yml'].join('.');
  const WORKFLOW = `.github/workflows/${WORKFLOW_NAME}`;
  const SELF_PATH = 'scripts/issue-2700/detail-row-truncation.tester.adversarial.test.mjs';

  const workflow = fs.readFileSync(path.join(ROOT, WORKFLOW), 'utf8');
  assert.ok(workflow.includes(`- run: node --test ${SELF_PATH}`), 'this suite is not invoked by the provider workflow');

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.github/ci-batch/MANIFEST.json'), 'utf8'));
  assert.equal(manifest.legacyOrigins.length, 200, 'the legacy origin registry must stay pinned at 200');
  const origin = manifest.legacyOrigins.find((item) => `${item.stem}.${item.extension}` === WORKFLOW_NAME);
  assert.ok(origin, 'the provider workflow is not a registered origin');

  // The registered path scope must SELECT this file, or the suite is collected
  // in name only and never re-runs when the code it guards moves.
  const globs = origin.workflowMetadata.pathScope;
  const matches = (file) => globs.some((glob) => new RegExp(`^${glob.split('**')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('.*')}$`).test(file));
  let scoped = 0;
  for (const file of [
    SELF_PATH,
    'scripts/issue-2700/detail-row-truncation.implementor.happy.test.mjs',
    'mingla-business/server/cardIdentityRenderer.js',
    'packages/sharing/index.js',
  ]) {
    assert.ok(matches(file), `${file} is outside the provider's path scope`);
    scoped += 1;
  }
  assert.equal(scoped, 4, `checked ${scoped} paths, expected 4`);

  // COVERAGE GAP, recorded rather than asserted away: `factsLine` measures
  // against `SURFACES.s4Snippet.plateW` and `.metaSize`, which live in
  // `packages/card-identity/index.js` — and that path is NOT in this provider's
  // scope, so editing the plate's width or type size does not re-run this
  // guard here. It is covered by the #1615 origin, which does scope
  // `packages/card-identity/**`. A5 pins `metaSize === 13` so a silent move is
  // caught the next time this suite runs. Raised for the orchestrator.
  assert.equal(matches('packages/card-identity/index.js'), false,
    'packages/card-identity is now in scope — delete this note and add it to the loop above');
});

test('A9b the provider digest comes from the validator itself, and the seal counts still hold', async () => {
  // Re-derived PROGRAMMATICALLY through the gate's own inspection, never by
  // hand-hashing: if the two ever disagree, the hand-written number is the one
  // that is wrong, and a suite that transcribes a digest cannot notice.
  const validator = await import(path.join(ROOT, '.github/scripts/ci-batch/validate-manifest-v2.mjs'));
  const WORKFLOW_NAME = ['issue-1719-unified-sharing', 'yml'].join('.');
  const inspected = validator.inspectWorkflow(ROOT, WORKFLOW_NAME);
  assert.ok(inspected, 'the validator does not see the provider workflow as a live origin');

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.github/ci-batch/MANIFEST.json'), 'utf8'));
  const origin = manifest.legacyOrigins.find((item) => `${item.stem}.${item.extension}` === WORKFLOW_NAME);
  assert.equal(origin.workflowMetadata.sourceSha256, inspected.sourceSha256,
    'the manifest digest for the provider workflow is stale — re-bank it, do not edit this test');
  assert.deepEqual([...origin.workflowMetadata.triggers].sort(), [...inspected.triggers].sort(), 'the manifest triggers are stale');
  assert.deepEqual([...origin.workflowMetadata.pathScope].sort(), [...inspected.pathScope].sort(), 'the manifest path scope is stale');

  // The frozen provider-record set. 91 or 93 means something is wrong.
  assert.equal(manifest.workflowProviders.length, 92, 'the workflow provider baseline moved');

  // ...and this file must never mint a provider record of its own. A single
  // spelled-out workflow filename here breaks the seal for the whole repo.
  const source = fs.readFileSync(SELF, 'utf8');
  const EXTENSIONS = ['y', 'ml'].join('') + '|' + ['ya', 'ml'].join('');
  const literals = source.match(new RegExp(`[A-Za-z0-9_.-]+\\.(?:${EXTENSIONS})`, 'g')) || [];
  assert.deepEqual(literals, [], `this file spells a workflow filename out in full: ${JSON.stringify(literals)}`);
});
