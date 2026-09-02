/**
 * #2589 stage-2 TESTER suite — the fallback share card, attacked.
 *
 * The implementor's happy suite proves the seven designed cases render. This one
 * only visits the places that suite does not: the exact ladder boundaries rather
 * than the middle of each band, the geometry BETWEEN the stamp and the title
 * rather than either one alone, the five real facts blobs that make the upstream
 * selector THROW, the de-duplication contract from the plate's side, a
 * behavioural privacy probe that a source grep cannot fake, and the two edges of
 * the 200 KB ceiling.
 *
 * FAILS-ON-REVERT (each proven by real line deletion, never by comment-out):
 *   A1  `titleMaxHeight = titleLH * s.titleLines` -> 66            RED
 *   A2  drop `+ STAMP_TITLE_CLEARANCE` from `stampBottom`          RED
 *   A3  unwrap `degradeTo`'s try/catch; or delete its console.warn RED
 *   A4  pass `facts` instead of `factsWithoutStamped(facts, stamp)`RED
 *       delete `!Array.isArray(stamp.consumedKeys)` from the guard RED
 *   A5  make `stampContent` read `source.venue`                    RED
 *   A6  `value.length > MAX` -> `>=`; drop the dimension check     RED
 *   A7  seed `fieldFor` with anything non-deterministic            RED
 *   A8  flip a byte in the provider workflow without re-banking    RED
 *
 * WHY THE WORKFLOW FILENAME IS ASSEMBLED FROM PARTS BELOW, NOT WRITTEN WHOLE:
 * `discoverWorkflowProviders()` in `.github/scripts/ci-batch/validate-manifest-v2.mjs`
 * scans every tracked non-workflow file for /[A-Za-z0-9_.-]+\.ya?ml/ and mints a
 * provider record for each match that names a real workflow. That record set is
 * sealed at a frozen count and digest, so a test file that spells a workflow
 * filename out in full breaks the required registry gate. A8b below guards this
 * file against exactly that regression.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SUITES_ADDED_SINCE_SEAL } from '../../.github/scripts/ci-batch/validate-manifest-v2.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);
const CI = require(path.join(ROOT, 'packages/card-identity'));
const PURE_PATH = path.join(ROOT, 'mingla-business/server/fallbackShareCard.js');
const RENDERER_PATH = path.join(ROOT, 'mingla-business/server/cardIdentityRenderer.js');
const pure = require(PURE_PATH);
const renderer = require(RENDERER_PATH);
const { selectPreviewFacts } = require(path.join(ROOT, 'packages/sharing'));
const sharp = require(path.join(ROOT, 'mingla-business/node_modules/sharp'));

const S = CI.SURFACES.s4Snippet;
const SCALE = 3;
const CEILING = renderer.MAX_CONTENT_SHARE_JPEG_BYTES;
/** 20pt of air between the stamp's bottom edge and a worst-case 2-line title. */
const CLEARANCE = 20;
/** The card's y=0..PLATE_TOP band holds the field, highlight, pill, stamp and title — everything #2589 added. */
const PLATE_TOP = S.h * SCALE - (S.bottomInset + S.plateH) * SCALE;

/** Flatten a React element tree into `{styles, strings}` so composition can be asserted without a rasteriser. */
function walk(node, out = { styles: [], strings: [] }) {
  if (node == null || node === false) return out;
  if (Array.isArray(node)) { for (const child of node) walk(child, out); return out; }
  if (typeof node === 'string') { if (node.trim()) out.strings.push(node); return out; }
  if (typeof node === 'number') { out.strings.push(String(node)); return out; }
  if (typeof node !== 'object') return out;
  if (node.props?.style) out.styles.push(node.props.style);
  if (node.props?.src) out.strings.push(String(node.props.src).slice(0, 24));
  walk(node.props?.children, out);
  return out;
}
const treeOf = (share) => walk(renderer.contentSharePortraitElement(share));
const titleStyle = (tree) => tree.styles.find((x) => x.fontWeight === 700 && typeof x.maxHeight === 'number' && x.wordBreak === 'break-word');
const stampStyle = (tree) => tree.styles.find((x) => x.position === 'absolute' && x.maxWidth === S.plateW * SCALE && x.flexDirection === 'column');
const plateStyle = (tree) => tree.styles.find((x) => x.width === S.plateW * SCALE && x.height === S.plateH * SCALE);
const factsRowStyle = (tree) => tree.styles.find((x) => x.fontSize === 13 * SCALE && x.maxHeight === 32 * SCALE);
/** Depth-first search for the first element whose style satisfies `predicate`. */
function findNode(node, predicate) {
  if (node == null || node === false) return null;
  if (Array.isArray(node)) { for (const child of node) { const hit = findNode(child, predicate); if (hit) return hit; } return null; }
  if (typeof node !== 'object') return null;
  if (node.props?.style && predicate(node.props.style)) return node;
  return findNode(node.props?.children, predicate);
}
/** The plate's fact-token row, read STRUCTURALLY off its own style, not guessed from the string list. */
const plateRow = (share) => findNode(renderer.contentSharePortraitElement(share), (style) => style.fontSize === 13 * SCALE && style.maxHeight === 32 * SCALE)?.props.children ?? null;
const cropAbovePlate = (buffer) => sharp(buffer).extract({ left: 0, top: 0, width: S.w * SCALE, height: PLATE_TOP }).raw().toBuffer();

/** Swap the pure layer's `stampContent` and hand back a renderer freshly bound to it. */
function withPatchedStamp(patch, run) {
  const original = pure.stampContent;
  pure.stampContent = patch;
  delete require.cache[RENDERER_PATH];
  try { return run(require(RENDERER_PATH)); }
  finally { pure.stampContent = original; delete require.cache[RENDERER_PATH]; require(RENDERER_PATH); }
}

/** Run `fn` with console.warn captured; returns `{ value, warnings }`. */
function capturingWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => { warnings.push(args.map((a) => String(a?.message ?? a)).join(' ')); };
  try { return { value: fn(), warnings }; } finally { console.warn = original; }
}

// ---------------------------------------------------------------------------

test('A1 the title rungs switch at EXACTLY 48/49 and 70/71, and the clip lands on a line boundary at each — 66 is wrong at three of four', () => {
  // `portraitTitleSize` is `count > 70 ? 23 : count > 48 ? 25 : 27`. The happy
  // suite samples 40/60/80, which sits in the middle of every band and cannot
  // see an off-by-one in either comparison. These four lengths sit ON both.
  const titleOfLength = (length) => 'Ab'.padEnd(length, 'c').slice(0, length);
  const RUNGS = [[48, 27, 33], [49, 25, 31], [70, 25, 31], [71, 23, 30]];
  for (const [length, expectedSize, expectedLH] of RUNGS) {
    const title = titleOfLength(length);
    assert.equal(Array.from(title).length, length, `fixture for ${length} is the wrong length`);
    const style = titleStyle(treeOf({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', facts: { schemaVersion: 1, kind: 'event', title, localDate: 'Aug 8, 2026', localTime: '8:00 PM' } }));
    assert.ok(style, `no title style at ${length} chars`);
    const lineHeight = Number(String(style.lineHeight).replace('px', ''));
    // Boundary: at 48 the 27pt rung must still hold and at 49 it must have gone.
    assert.equal(style.fontSize, expectedSize * SCALE, `${length} chars must pick the ${expectedSize}pt rung`);
    assert.equal(lineHeight, expectedLH * SCALE, `${length} chars line height`);
    assert.equal(style.maxHeight, lineHeight * S.titleLines, `${length} chars clip must be exactly ${S.titleLines} whole lines`);
    assert.equal(style.maxHeight % lineHeight, 0, `${length} chars clip leaves a partial line`);
  }
  // The reverted defect, stated as a value rather than as a property: three of
  // the four boundary rungs must NOT clip at 66. Reinstating the hardcode turns
  // this red on its own, independently of the divisibility check above.
  const clipAt = (length) => titleStyle(treeOf({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', facts: { schemaVersion: 1, kind: 'brand', title: titleOfLength(length) } })).maxHeight / SCALE;
  assert.deepEqual(RUNGS.map(([length]) => clipAt(length)), [66, 62, 62, 60], 'the clip must track the rung, not a constant');
  assert.equal(new Set(RUNGS.map(([length]) => clipAt(length))).size, 3, 'a single clip value across all rungs IS the #2589 defect');
});

test('A2 the stamp keeps its documented 20pt of air above a worst-case 2-line title at every rung, and never less', () => {
  // The happy suite asserts the stamp's CONTENT and the title's CLIP separately.
  // Nothing measures the gap between them, which is the one number that decides
  // whether a long title collides with the stamp on a real card.
  const measured = [];
  for (const [length, expectedRung] of [[10, 27], [49, 25], [71, 23]]) {
    const tree = treeOf({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', facts: { schemaVersion: 1, kind: 'event', title: 'Ab'.padEnd(length, 'c').slice(0, length), localDate: 'Aug 8, 2026', localTime: '8:00 PM' } });
    const title = titleStyle(tree);
    const stamp = stampStyle(tree);
    assert.ok(stamp, `${length} chars produced no stamp — the measurement below would be vacuous`);
    assert.equal(title.fontSize, expectedRung * SCALE, `${length} chars rung`);
    // Both are bottom-anchored, so the title's top edge is bottom + clip height.
    const gap = (stamp.bottom - title.bottom - title.maxHeight) / SCALE;
    assert.ok(gap >= CLEARANCE, `${length} chars leaves only ${gap}pt under the stamp, contract is ${CLEARANCE}pt`);
    measured.push(gap);
  }
  // WORST CASE IS EXACTLY THE CONTRACT. The 27pt rung has the tallest line
  // height, so it consumes the most of the reserved band; if the clearance term
  // is ever dropped this is the first case to collide.
  assert.equal(measured[0], CLEARANCE, 'the widest 2-line title must sit exactly 20pt under the stamp');
  assert.deepEqual(measured, [20, 24, 26], 'clearance must GROW as the rung shrinks, never shrink');
  // Anti-vacuity: the finder really is reading two different elements.
  const tree = treeOf({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', facts: { schemaVersion: 1, kind: 'event', title: 'Short', localDate: 'Aug 8, 2026' } });
  assert.notEqual(stampStyle(tree).bottom, titleStyle(tree).bottom, 'stamp and title resolved to the same element');
});

test('A3 five REAL malformed facts blobs each render a card instead of a 502, degrade to the documented empty plate, and are surfaced to logs', () => {
  // Every one of these throws out of `selectPreviewFacts` for a different
  // documented reason. Pre-#2589 any of them was an unhandled throw inside the
  // composition — a 502 with an empty body, so the link shared as a bare URL.
  const BLOBS = {
    schema_version_missing: { kind: 'event', title: 'Rooftop Sessions', localDate: 'Aug 8, 2026', localTime: '8:00 PM' },
    schema_version_unknown: { schemaVersion: 9, kind: 'event', title: 'Rooftop Sessions', localDate: 'Aug 8, 2026' },
    kind_not_in_the_union: { schemaVersion: 1, kind: 'nonsense', title: 'Rooftop Sessions' },
    title_blank: { schemaVersion: 1, kind: 'event', title: '', localDate: 'Aug 8, 2026' },
    field_the_schema_rejects: { schemaVersion: 1, kind: 'event', title: 'Rooftop Sessions', localDate: 'Aug 8, 2026', priceLabel: 'From 20' },
  };
  // Anti-vacuity: prove the upstream selector genuinely throws on each, or the
  // degradation being asserted below never had to happen.
  for (const [label, facts] of Object.entries(BLOBS)) {
    assert.throws(() => selectPreviewFacts(facts, 8), /invalid_share_facts:/, `${label} does not actually throw upstream`);
  }
  const healthy = treeOf({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', facts: { schemaVersion: 1, kind: 'event', title: 'Rooftop Sessions', localDate: 'Aug 8, 2026', localTime: '8:00 PM', venue: 'The Terrace' } });
  const healthyPlate = plateStyle(healthy);

  for (const [label, facts] of Object.entries(BLOBS)) {
    const { value: tree, warnings } = capturingWarnings(() => treeOf({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', facts }));
    const plate = plateStyle(tree);
    assert.ok(plate, `${label} produced no plate`);
    // The documented empty result: the kind label centres, the fact row is gone.
    assert.equal(plate.justifyContent, 'center', `${label} must centre the empty facts row`);
    assert.equal(factsRowStyle(tree), undefined, `${label} must render no fact tokens`);
    // Geometry does NOT move. `plateH` stays 78, so nothing derived from the
    // plate shifts and a degraded card is the same object as a healthy one.
    assert.deepEqual([plate.width, plate.height, plate.borderRadius], [healthyPlate.width, healthyPlate.height, healthyPlate.borderRadius], `${label} moved the plate`);
    // Surfaced to logs, never swallowed silently.
    assert.equal(warnings.length, 1, `${label} logged ${warnings.length} warnings`);
    assert.match(warnings[0], /^issue-2589 share card degraded \(facts\): invalid_share_facts:/, `${label} warning text`);
  }
  // PARTIAL, not total: four of the five still carry their identifying fact,
  // because the stamp reads the facts directly and does not go through the
  // selector that threw. A blanket "render nothing" fallback would lose this.
  const stamped = Object.entries(BLOBS).filter(([, facts]) => stampStyle(treeOf({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', facts })));
  assert.deepEqual(stamped.map(([label]) => label), ['schema_version_missing', 'schema_version_unknown', 'title_blank', 'field_the_schema_rejects']);
  // A healthy card logs NOTHING, so the warning assertions above cannot pass by
  // the renderer simply warning on every render.
  assert.deepEqual(capturingWarnings(() => treeOf({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', facts: { schemaVersion: 1, kind: 'event', title: 'Rooftop Sessions', localDate: 'Aug 8, 2026' } })).warnings, []);
});

test('A3b a malformed facts blob still produces a real, valid 1080x1350 JPEG end to end', async () => {
  // The capture is awaited INSIDE the swap: restoring console.warn before the
  // render settles would silently observe zero warnings and pass for free.
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => { warnings.push(args.map((a) => String(a?.message ?? a)).join(' ')); };
  let jpeg;
  try {
    jpeg = await renderer.renderContentSharePortraitJpeg({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', facts: { kind: 'event', title: 'Rooftop Sessions', localDate: 'Aug 8, 2026', localTime: '8:00 PM' }, media: null });
  } finally { console.warn = original; }
  assert.ok(jpeg.length > 0 && jpeg.length <= CEILING, `degraded card is ${jpeg.length} B`);
  assert.equal(await renderer.isValidContentSharePortraitJpeg(jpeg), true, 'degraded card must still validate');
  assert.ok(warnings.some((line) => line.startsWith('issue-2589 share card degraded')), 'degradation was not surfaced');
});

test('A4 a stamped fact never appears twice, and every consumedKeys shape that names nothing leaves the plate untouched', () => {
  // Read from the PLATE side. The happy suite asserts what `consumedKeys`
  // CONTAINS; nothing asserts that the plate actually re-selected without them,
  // which is the only thing a reader of the card can see.
  const PAIRS = [
    { label: 'event', shortCode: 'Aa0Bb1Cc2Dd3Ee4F', facts: { schemaVersion: 1, kind: 'event', title: 'Sunset Rooftop Sessions', localDate: 'Aug 8, 2026', localTime: '8:00 PM', venue: 'The Terrace', availability: 'Few left' }, coverless: 'The Terrace · Few left', covered: 'Aug 8, 2026 at 8:00 PM · The Terrace · Few left', once: '8:00 pm' },
    { label: 'trip', shortCode: 'Bb1Cc2Dd3Ee4Ff5G', facts: { schemaVersion: 1, kind: 'trip', title: 'Coastal Escape Weekend', dateRange: 'Sep 12, 2026 – Sep 14, 2026', destination: 'Lagos', duration: '3 days' }, coverless: 'Lagos · 3 days', covered: 'Lagos · Sep 12, 2026 – Sep 14, 2026 · 3 days', once: 'sep' },
    { label: 'curated', shortCode: 'Cc2Dd3Ee4Ff5Gg6H', facts: { schemaVersion: 1, kind: 'curated', title: 'A Slow Saturday in Peckham', stopCount: 3, area: 'Peckham', duration: '4 hours' }, coverless: 'Peckham', covered: '3 stops · Peckham · 4 hours', once: 'stop' },
  ];
  const POSTER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  for (const item of PAIRS) {
    const coverlessShare = { shortCode: item.shortCode, facts: item.facts };
    const coveredShare = { shortCode: item.shortCode, facts: item.facts, media: { posterUrl: POSTER } };
    assert.equal(plateRow(coverlessShare), item.coverless, `${item.label} coverless plate re-selected wrongly`);
    // COUNTER-CASE: a covered card has no stamp, so nothing is consumed and the
    // very same fact IS on the plate. The assertion above therefore cannot pass
    // by the selector simply never producing that fact.
    assert.equal(plateRow(coveredShare), item.covered, `${item.label} covered plate`);
    assert.ok(stampStyle(treeOf(coverlessShare)) && !stampStyle(treeOf(coveredShare)), `${item.label} stamp presence`);
    // The invariant, stated once: whichever layer owns the fact, the card shows
    // it in exactly ONE place. The stamped card must not repeat it on the plate.
    const occurrences = (share) => treeOf(share).strings.filter((value) => value.toLowerCase().includes(item.once)).length;
    assert.equal(occurrences(coverlessShare), 1, `${item.label} renders "${item.once}" ${occurrences(coverlessShare)} times on the coverless card`);
    assert.equal(occurrences(coveredShare), 1, `${item.label} renders "${item.once}" ${occurrences(coveredShare)} times on the covered card`);
  }

  // The guard's own truth table, driven through the renderer. Every shape that
  // names nothing must leave the fact set EXACTLY as the selector built it.
  const facts = PAIRS[0].facts;
  const FULL = 'Aug 8, 2026 at 8:00 PM · The Terrace · Few left';
  const stampFor = (consumedKeys) => () => ({ variant: 'label', ladder: [28, 24, 20], letterSpacing: 1.6, weight: 700, tabular: false, padding: [14, 18, 14], value: 'X', meta: '', size: 28, consumedKeys });
  const rowFor = (consumedKeys) => withPatchedStamp(stampFor(consumedKeys), (patched) => findNode(
    patched.contentSharePortraitElement({ shortCode: PAIRS[0].shortCode, facts }),
    (style) => style.fontSize === 13 * SCALE && style.maxHeight === 32 * SCALE,
  )?.props.children ?? null);
  for (const [label, shape] of [['empty array', []], ['a number', 5], ['null', null], ['a bare string', 'localDate'], ['an object', {}], ['a key not in facts', ['nope']]]) {
    assert.equal(rowFor(shape), FULL, `consumedKeys as ${label} must not disturb the plate`);
  }
  assert.equal(rowFor(['localDate', 'localTime']), 'The Terrace · Few left', 'a real key list must still remove its keys');
  // Anti-vacuity: the patch harness genuinely reached the renderer.
  assert.equal(withPatchedStamp(stampFor(['localDate']), (patched) => walk(patched.contentSharePortraitElement({ shortCode: PAIRS[0].shortCode, facts })).strings.includes('X')), true, 'patched stamp never rendered');
  // And the harness restored the real module.
  assert.equal(plateRow({ shortCode: PAIRS[0].shortCode, facts }), PAIRS[0].coverless, 'the stamp patch leaked out of its test');
});

test('A5 neither function #2589 added ever READS a location key, for any kind — a behavioural probe, not a source grep', () => {
  // The happy suite greps the source for `.venue` / `.area` / `.destination`.
  // That regex cannot see `source[key]`, a destructure, or a rename. A read-spy
  // can: it observes every property access the function actually performs.
  const WITHHELD = { venue: 'The Terrace', area: 'Peckham', destination: 'Lagos', locationText: '12 Foo Road', city: 'London', address: '12 Foo Road, London' };
  const BY_KIND = {
    event: { localDate: 'Aug 8, 2026', localTime: '8:00 PM' },
    rsvp_event: { localDate: 'Aug 8, 2026' },
    experience: { nextDate: 'Dec 1, 2026' },
    trip: { dateRange: 'Sep 12, 2026 – Sep 14, 2026' },
    curated: { stopCount: 3, duration: '4 hours' },
    place: { category: 'Bar' },
    venue: { category: 'Restaurant' },
    brand: { category: 'Live music' },
  };
  for (const [kind, extra] of Object.entries(BY_KIND)) {
    const read = new Set();
    const target = { schemaVersion: 1, kind, title: 'Sample Offering', ...extra, ...WITHHELD };
    const spy = new Proxy(target, {
      get(object, key) { if (typeof key === 'string') read.add(key); return object[key]; },
      has(object, key) { if (typeof key === 'string') read.add(key); return key in object; },
    });
    const stamp = pure.stampContent(spy);
    // Anti-vacuity: the spy must have observed real work, or "read nothing
    // withheld" would be true simply because the function was never entered.
    assert.ok(stamp, `${kind} produced no stamp — nothing was measured`);
    assert.ok(read.has('kind'), `${kind} spy observed no reads at all`);
    const leaked = [...read].filter((key) => key in WITHHELD);
    assert.deepEqual(leaked, [], `${kind} stamp read withheld location keys: ${leaked.join(', ')}`);
    // And nothing withheld reaches the rendered value either.
    const rendered = `${stamp.value} ${stamp.meta}`;
    for (const value of Object.values(WITHHELD)) assert.ok(!rendered.includes(value.toUpperCase()), `${kind} stamp printed ${value}`);
  }
  // `fieldFor` takes the short code and the theme colour. It has no parameter a
  // location could arrive through, and the same code yields the same field
  // whatever the offering is.
  assert.deepEqual(pure.fieldFor('Ff5Gg6Hh7Ii8Jj9K'), pure.fieldFor('Ff5Gg6Hh7Ii8Jj9K'));
  assert.equal(pure.fieldFor.length, 2, 'fieldFor grew a parameter a location could arrive through');
});

test('A5b the whole field/stamp/title band is PIXEL-identical whether the location is withheld or not', async () => {
  // #2489/#2587 withhold an address. Element-level geometry equality is already
  // covered; this asserts the far stronger claim at raster level — that not one
  // pixel above the plate moves when the withheld keys come back.
  const PAIRS = [
    ['event', { schemaVersion: 1, kind: 'event', title: 'Midsummer Supper', localDate: 'Nov 21, 2026', localTime: '7:30 PM', availability: 'Few left' }, { venue: 'The Terrace' }],
    ['trip', { schemaVersion: 1, kind: 'trip', title: 'Coastal Escape Weekend', dateRange: 'Sep 12, 2026 – Sep 14, 2026', duration: '3 days' }, { destination: 'Lagos' }],
    ['curated', { schemaVersion: 1, kind: 'curated', title: 'A Slow Saturday', stopCount: 3, duration: '4 hours' }, { area: 'Peckham' }],
  ];
  assert.equal(PLATE_TOP, 972, 'the measured band must stop exactly at the plate');
  for (const [label, facts, withheld] of PAIRS) {
    const gated = await renderer.renderContentSharePortraitPng({ shortCode: 'Ff5Gg6Hh7Ii8Jj9K', facts, media: null });
    const ungated = await renderer.renderContentSharePortraitPng({ shortCode: 'Ff5Gg6Hh7Ii8Jj9K', facts: { ...facts, ...withheld }, media: null });
    const [above, aboveUngated] = [await cropAbovePlate(gated), await cropAbovePlate(ungated)];
    assert.ok(above.equals(aboveUngated), `${label}: the field/stamp/title band moved when the location was supplied`);
    // COUNTER-CASE: the two cards are NOT simply the same image. The plate row
    // below the band does differ, so the equality above is a real measurement.
    assert.ok(!gated.equals(ungated), `${label}: the two renders are byte-identical, so the band check proves nothing`);
  }
});

test('A6 the ceiling holds at its exact boundary and the validator rejects everything that is not this card', async () => {
  // (a) Both sides of the byte ceiling, to the byte.
  const real = await renderer.renderContentSharePortraitJpeg({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', facts: { schemaVersion: 1, kind: 'event', title: 'Sunset Rooftop Sessions', localDate: 'Aug 8, 2026', localTime: '8:00 PM' }, media: null });
  const padTo = (length) => Buffer.concat([real, Buffer.alloc(length - real.length, 0)]);
  assert.ok(real.length < CEILING - 1, 'fixture is already at the ceiling; the boundary cases below cannot be built');
  assert.equal(await renderer.isValidContentSharePortraitJpeg(padTo(CEILING - 1)), true, 'one byte under the ceiling must pass');
  assert.equal(await renderer.isValidContentSharePortraitJpeg(padTo(CEILING)), true, 'EXACTLY the ceiling must pass — the bound is inclusive');
  assert.equal(await renderer.isValidContentSharePortraitJpeg(padTo(CEILING + 1)), false, 'one byte over the ceiling must fail');
  // (b) Everything that is not a 1080x1350 JPEG.
  const wrongShape = await sharp({ create: { width: 1080, height: 1080, channels: 3, background: '#eb7825' } }).jpeg({ quality: 70 }).toBuffer();
  const notJpeg = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#eb7825' } }).png().toBuffer();
  for (const [label, value] of [
    ['a square JPEG', wrongShape],
    ['a correctly sized PNG', notJpeg],
    ['an empty buffer', Buffer.alloc(0)],
    ['a truncated JPEG', real.subarray(0, Math.floor(real.length / 2))],
    ['random bytes', Buffer.alloc(5000, 7)],
    ['a string', real.toString('latin1')],
  ]) {
    assert.equal(await renderer.isValidContentSharePortraitJpeg(value), false, `${label} must be rejected`);
  }
});

test('A6b the worst card this design can produce still ships on the FIRST quality rung, with real headroom', async () => {
  // The happy suite measures the seven designed cases. This one deliberately
  // maximises every size driver at once: the longest title the ladder has a rung
  // for, in the widest glyph, plus a sold-out pill, the longest stamp value and
  // meta the ladder can build, and the curated sliver stack.
  const LONG = 'WWWWWWWWWW '.repeat(20).trim();
  const worst = { shortCode: 'Qq1Rr2Ss3Tt4Uu5V', facts: { schemaVersion: 1, kind: 'curated', title: LONG, stopCount: 12, duration: '8 hours 30 minutes', area: 'Peckham and Nunhead and East Dulwich', status: 'sold_out' }, media: null };
  assert.ok(Array.from(LONG).length > 70, 'the worst-case title must reach the smallest rung');
  const png = await renderer.renderContentSharePortraitPng(worst);
  assert.ok(png.length <= renderer.MAX_RENDERED_PNG_BYTES, `intermediate PNG is ${png.length} B`);
  const jpeg = await renderer.renderContentSharePortraitJpeg(worst);
  assert.ok(jpeg.length <= CEILING, `worst case is ${jpeg.length} B, ceiling ${CEILING}`);
  assert.equal(await renderer.isValidContentSharePortraitJpeg(jpeg), true);
  // The ladder's FIRST rung is what ships: a fallback card must never have to
  // trade quality for size. Re-encoding at 82 with the documented options
  // reproduces the shipped bytes exactly, which pins the head of the ladder AND
  // every encode option alongside it.
  const atTopRung = await sharp(png, { limitInputPixels: 20_000_000, failOn: 'error' })
    .flatten({ background: '#0C0E12' })
    .jpeg({ quality: 82, progressive: true, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
  assert.ok(jpeg.equals(atTopRung), `the shipped card is not the top quality rung (${jpeg.length} B vs ${atTopRung.length} B)`);
  // Anti-vacuity: a lower rung really would be smaller, so "equals the top rung"
  // is a discriminating statement rather than a tautology.
  const atLastRung = await sharp(png, { limitInputPixels: 20_000_000, failOn: 'error' })
    .flatten({ background: '#0C0E12' })
    .jpeg({ quality: 66, progressive: true, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
  assert.ok(atLastRung.length < atTopRung.length, 'the quality ladder does not change the encode at all');
});

test('A7 one short code renders one card FOREVER — the render is cached immutable, so it must be byte-deterministic', async () => {
  const share = { shortCode: 'Ee4Ff5Gg6Hh7Ii8J', facts: { schemaVersion: 1, kind: 'brand', title: 'Nightjar Collective', category: 'Live music' }, media: null };
  const first = await renderer.renderContentSharePortraitJpeg(share);
  const second = await renderer.renderContentSharePortraitJpeg(share);
  assert.ok(first.equals(second), 'two renders of one share produced different bytes');
  // COUNTER-CASE: a different short code must produce a different card, or the
  // equality above would hold for a renderer that ignores its input entirely.
  const other = await renderer.renderContentSharePortraitJpeg({ ...share, shortCode: 'Dd3Ee4Ff5Gg6Hh7I' });
  assert.ok(!first.equals(other), 'two different short codes produced identical cards');
});

test('A8 CI collects THIS suite, the 200-origin sealed baseline ratchets exactly, and this file cannot break the provider seal', () => {
  // The workflow filename is assembled, never spelled out — see the header note.
  const WORKFLOW_NAME = ['issue-1719-unified-sharing', 'yml'].join('.');
  const WORKFLOW_REL = `.github/workflows/${WORKFLOW_NAME}`;
  const SELF = 'scripts/issue-2589/fallback-share-card.tester.adversarial.test.mjs';
  const workflowSource = fs.readFileSync(path.join(ROOT, WORKFLOW_REL));

  // 1. Invoked by name. A test nobody runs is not a test.
  assert.ok(workflowSource.toString('utf8').includes(`node --test ${SELF}`), 'this suite is not invoked by the provider workflow');

  // 2. The manifest's origin inventory starts from the SEALED 200-entry baseline.
  //    Each suite in the canonical post-seal declaration adds one exact provenance
  //    claim. This is not a workflow-file count: the suite still rides the existing
  //    batch provider and no new issue workflow exists.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.github/ci-batch/MANIFEST.json'), 'utf8'));
  const SEALED_LEGACY_ORIGINS = 200;
  const expectedLegacyOriginCount = SEALED_LEGACY_ORIGINS + SUITES_ADDED_SINCE_SEAL.length;
  const assertExactLegacyOriginCount = (origins, label) => assert.equal(
    origins.length,
    expectedLegacyOriginCount,
    `${label}: legacy origin registry must equal the sealed 200 baseline plus exact declared post-seal provenance claims; this is not a workflow-file count`,
  );
  assertExactLegacyOriginCount(manifest.legacyOrigins, 'current manifest');

  // Exactness is load-bearing in BOTH directions. Remove the canonical #2897
  // suite's in-memory provenance claim and the 200-entry undercount must fail;
  // append one undeclared in-memory origin and the 202-entry overcount must fail.
  // Neither mutation writes a fixture or changes the repository.
  const declaredAgentGuard = SUITES_ADDED_SINCE_SEAL.find(({ issue }) => issue === 2897);
  assert.ok(declaredAgentGuard, 'canonical post-seal declaration no longer identifies the #2897 suite');
  const declaredClaimIndex = manifest.legacyOrigins.findIndex(
    (item) => item.replacementSuite === declaredAgentGuard.suite,
  );
  assert.notEqual(declaredClaimIndex, -1, 'the #2897 suite has no provenance claim to remove');
  const undercount = manifest.legacyOrigins.filter((_, index) => index !== declaredClaimIndex);
  assert.throws(
    () => assertExactLegacyOriginCount(undercount, 'declared-claim undercount mutant'),
    { name: 'AssertionError', actual: expectedLegacyOriginCount - 1, expected: expectedLegacyOriginCount },
    'removing the declared #2897 provenance claim must fail the exact-count contract',
  );
  const overcount = [
    ...manifest.legacyOrigins,
    { ...manifest.legacyOrigins[0], stem: 'issue-3017-undeclared-mutant' },
  ];
  assert.throws(
    () => assertExactLegacyOriginCount(overcount, 'undeclared-origin overcount mutant'),
    { name: 'AssertionError', actual: expectedLegacyOriginCount + 1, expected: expectedLegacyOriginCount },
    'appending one undeclared provenance origin must fail the exact-count contract',
  );

  // 3. The manifest's content hash of the provider workflow is CURRENT.
  //    `validate-manifest-v2` fails closed on drift, so editing the workflow
  //    without re-banking this is a red required gate. Re-derived, never copied.
  const origin = manifest.legacyOrigins.find((item) => `${item.stem}.${item.extension}` === WORKFLOW_NAME);
  assert.ok(origin, 'provider workflow is not a registered origin');
  assert.equal(origin.workflowMetadata.sourceSha256, crypto.createHash('sha256').update(workflowSource).digest('hex'), 'the registered workflow hash no longer matches the workflow on disk');

  // 4. The registered path scope re-runs this suite when the code it guards moves.
  const globs = origin.workflowMetadata.pathScope;
  const matches = (file) => globs.some((glob) => new RegExp(`^${glob.split('**').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('.*')}$`).test(file));
  for (const file of [SELF, 'mingla-business/server/fallbackShareCard.js', 'mingla-business/server/cardIdentityRenderer.js']) {
    assert.ok(matches(file), `${file} is not selected by the provider workflow's path scope`);
  }
  assert.equal(matches('supabase/functions/manage-stay-inventory/index.ts'), false, 'path matcher accepts everything');

  // 5. PROVIDER-SEAL HYGIENE. `discoverWorkflowProviders()` mints a provider
  //    record for any tracked non-workflow file naming a real workflow file, and
  //    that record set is frozen. This file must therefore never spell one out.
  const selfSource = fs.readFileSync(path.join(HERE, path.basename(SELF)), 'utf8');
  const workflowFilenames = new Set(fs.readdirSync(path.join(ROOT, '.github/workflows')).filter((name) => /\.ya?ml$/.test(name)));
  const spelledOut = [...new Set(selfSource.match(/[A-Za-z0-9_.-]+\.ya?ml/g) || [])].filter((name) => workflowFilenames.has(name));
  assert.deepEqual(spelledOut, [], `this file names ${spelledOut.join(', ')} in full, which mints a provider record and breaks the frozen registry seal`);
  // Anti-vacuity: the matcher above genuinely recognises a real workflow name.
  assert.ok(workflowFilenames.has(WORKFLOW_NAME) && /[A-Za-z0-9_.-]+\.ya?ml/.test(WORKFLOW_NAME), 'the seal check cannot recognise a workflow filename at all');
});
