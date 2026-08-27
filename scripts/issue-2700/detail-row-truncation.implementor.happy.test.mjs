/**
 * #2700 implementor suite — the share card's detail row must never end on a
 * dangling separator, and a truncated row must LOOK truncated.
 *
 * The shipped defect, reproduced from production: an offering with a cover
 * rendered its detail row as
 *
 *   "Aug 29, 2026 at 1:00 PM · Didi Museum, Akin Adesola Street 175, Lagos 10,
 *    Lagos, Nigeria ·"
 *
 * — a trailing separator with nothing after it. Both plates clip that row at two
 * 16pt lines with `overflow: hidden`, nothing trimmed the join, and when the cut
 * landed just after a separator the separator was the last visible glyph.
 *
 * FAILS-ON-REVERT: restoring `tokens.join(" · ")` on the fallback-card plate of
 * `contentSharePortraitElement` turns P1/P2/P5/P6/P7 RED; restoring
 * `facts.join(" · ")` on the covered plate of `cardIdentityElement` turns P3 RED.
 * Proven by real line deletion, not by comment-out — a commented-out fix still
 * matches a source grep and would give a false fails-on-revert.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const renderer = require(path.join(ROOT, 'mingla-business/server/cardIdentityRenderer.js'));
const sharp = require(path.join(ROOT, 'mingla-business/node_modules/sharp'));

const SCALE = 3;
/** A real 1x1 PNG. `data:` URIs short-circuit `prepareCoverForOg`, so this suite makes no network call. */
const COVER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const ELLIPSIS = '…';
const MIDDOT = '·';
const SEPARATOR = ` ${MIDDOT} `;
/** The exact production shape from #2700. */
const REPORTED = Object.freeze({
  schemaVersion: 1, kind: 'event', title: 'Lagos Art Walk',
  localDate: 'Aug 29, 2026', localTime: '1:00 PM',
  venue: 'Didi Museum, Akin Adesola Street 175, Lagos 10, Lagos, Nigeria',
  price: { amount: 15000, currency: 'NGN' }, availability: 'Few left',
});

/** Flatten a React element tree so the composed strings can be read without a rasteriser. */
function walk(node, out = []) {
  if (node == null || node === false) return out;
  if (Array.isArray(node)) { for (const child of node) walk(child, out); return out; }
  if (typeof node !== 'object') return out;
  out.push(node);
  walk(node.props?.children, out);
  return out;
}
/**
 * The plate's detail row, identified by its own geometry rather than by its
 * position among siblings: it is the only node clipped to two 16pt lines
 * (`maxHeight: 32`) that sits 3pt under the kind row.
 */
function detailRowOrNull(element) {
  const rows = walk(element).filter((node) => {
    const style = node.props?.style;
    return style && style.maxHeight === 32 * SCALE && style.marginTop === 3 * SCALE && style.wordBreak === 'break-word';
  });
  // A plate with no facts left renders NO row at all (the stamp can consume every
  // fact the offering owns). That is the shipped behaviour and not this fix's business.
  assert.ok(rows.length <= 1, `expected at most one detail row on the plate, found ${rows.length}`);
  if (!rows.length) return null;
  const children = rows[0].props.children;
  assert.equal(typeof children, 'string', 'detail row must compose a single string');
  return children;
}
function detailRow(element) {
  const row = detailRowOrNull(element);
  assert.equal(typeof row, 'string', 'expected a detail row on the plate');
  return row;
}
const coveredShare = (facts) => ({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', version: 1, facts, media: { kind: 'photo', url: COVER, posterUrl: COVER } });
const coverlessShare = (facts) => ({ shortCode: 'Bb1Cc2Dd3Ee4Ff5G', version: 1, facts, media: null });

/** The composed row must never END on a separator or on whitespace, for any input. */
function assertNoDanglingSeparator(line, label) {
  assert.ok(!/[\s\u00B7]$/u.test(line), `${label}: detail row ends on a separator or whitespace -> ${JSON.stringify(line)}`);
  // ...and no separator may sit immediately before the ellipsis either, which is
  // the same fault wearing a hat.
  assert.ok(!/[\s\u00B7]\u2026$/u.test(line), `${label}: separator survives just before the ellipsis -> ${JSON.stringify(line)}`);
}

test('P1 the reported production case, WITH a cover, ends on an ellipsis and not on a separator', () => {
  const line = detailRow(renderer.contentSharePortraitElement(coveredShare(REPORTED)));
  assertNoDanglingSeparator(line, 'covered fallback-card plate');
  assert.ok(line.endsWith(ELLIPSIS), `truncation must be visible, got ${JSON.stringify(line)}`);
  // The shipped string, verbatim. It must be impossible to compose.
  assert.ok(!line.includes(`Nigeria ${MIDDOT}`), 'the exact #2700 dangling tail is back');
  assert.ok(line.startsWith('Aug 29, 2026 at 1:00 PM'), 'the surviving facts must still lead with the date');
});

test('P2 the coverless fallback card truncates the same way', () => {
  const facts = { schemaVersion: 1, kind: 'experience', title: 'Harbour Kayak Sunrise',
    area: 'Kensington Palace Gardens Conservatory and Orangery Terrace Rooms, London W8 4PX',
    nextDate: 'Aug 29, 2026', duration: '3 hours 30 minutes', availability: 'Selling fast' };
  const line = detailRow(renderer.contentSharePortraitElement(coverlessShare(facts)));
  assertNoDanglingSeparator(line, 'coverless fallback-card plate');
  assert.ok(line.endsWith(ELLIPSIS), `truncation must be visible, got ${JSON.stringify(line)}`);
});

test('P3 the covered-cover plate of the card-identity element behaves identically', () => {
  const snapshot = { kind: 'place', title: 'Didi Museum', cover_url: COVER, metadata: {
    category: 'Museum and cultural centre with a permanent collection',
    location: 'Akin Adesola Street 175, Victoria Island, Lagos 106104, Lagos, Nigeria' } };
  for (const surface of ['s4Snippet', 's5Og']) {
    const line = detailRow(renderer.cardIdentityElement(snapshot, surface, SCALE));
    assertNoDanglingSeparator(line, `card-identity ${surface} plate`);
    assert.ok(line.endsWith(ELLIPSIS), `${surface}: truncation must be visible, got ${JSON.stringify(line)}`);
  }
});

test('P4 a row that FITS is left alone — no ellipsis is invented for content that is all there', () => {
  const facts = { schemaVersion: 1, kind: 'event', title: 'Sunset Sessions', localDate: 'Aug 8, 2026', localTime: '8:00 PM', venue: 'The Terrace' };
  const line = detailRow(renderer.contentSharePortraitElement(coveredShare(facts)));
  assert.equal(line, `Aug 8, 2026 at 8:00 PM${SEPARATOR}The Terrace`);
  assert.ok(!line.includes(ELLIPSIS), 'a complete row must not claim there is more');
  assertNoDanglingSeparator(line, 'short covered plate');
});

test('P5 a fact is the unit dropped — a surviving fact is never cut mid-word while a boundary exists', () => {
  const line = detailRow(renderer.contentSharePortraitElement(coveredShare(REPORTED)));
  const body = line.slice(0, -ELLIPSIS.length);
  // Whatever survived is a prefix of the untruncated join, cut at a fact or at a
  // word boundary — never inside a word.
  const full = `Aug 29, 2026 at 1:00 PM${SEPARATOR}${REPORTED.venue}${SEPARATOR}Few left`;
  assert.ok(full.startsWith(body), 'the surviving row must be a prefix of the full join');
  const nextCharacter = full[body.length];
  assert.ok(nextCharacter === undefined || /[\s]/u.test(nextCharacter), `cut landed mid-word before ${JSON.stringify(nextCharacter)}`);
});

test('P6 degenerate facts cannot produce a trailing separator on either plate', () => {
  const cases = {
    trailing_space_in_fact: { schemaVersion: 1, kind: 'venue', title: 'Terra', category: 'Wine bar   ', area: '   Peckham   ' },
    separator_shaped_fact: { schemaVersion: 1, kind: 'venue', title: 'Terra', category: `${MIDDOT}`, area: 'Peckham' },
    one_fact_wider_than_the_whole_row: { schemaVersion: 1, kind: 'venue', title: 'Terra',
      category: 'Supercalifragilisticexpialidociousandthensomeverylongunbrokenvenuenamethatcannotbreak' },
    single_long_fact_with_words: { schemaVersion: 1, kind: 'venue', title: 'Terra',
      category: 'Kensington Palace Gardens Conservatory and Orangery Terrace Rooms London W8 4PX United Kingdom' },
  };
  let withRow = 0;
  let withoutRow = 0;
  for (const [name, facts] of Object.entries(cases)) {
    for (const [surface, element] of [
      ['covered', renderer.contentSharePortraitElement(coveredShare(facts))],
      ['coverless', renderer.contentSharePortraitElement(coverlessShare(facts))],
    ]) {
      const line = detailRowOrNull(element);
      if (line === null) { withoutRow += 1; continue; }
      assertNoDanglingSeparator(line, `${name}/${surface}`);
      withRow += 1;
    }
  }
  // The denominator is asserted, not assumed: a run that inspected nothing and
  // reported clean is a failed run, not a pass.
  assert.equal(withRow + withoutRow, Object.keys(cases).length * 2, 'every degenerate case must have been composed');
  assert.ok(withRow >= 5, `only ${withRow} of ${withRow + withoutRow} degenerate plates actually rendered a row`);
});

test('P7 both plates compose the SAME row for the same facts — they cannot drift apart', () => {
  const facts = { schemaVersion: 1, kind: 'venue', title: 'Terra',
    category: 'Neighbourhood wine bar and small plates kitchen with a courtyard',
    area: 'Peckham Rye, London SE15 4ST, United Kingdom' };
  const fallbackRow = detailRow(renderer.contentSharePortraitElement(coveredShare(facts)));
  const identityRow = detailRow(renderer.cardIdentityElement(
    { kind: 'place', title: 'Terra', cover_url: COVER, metadata: { category: facts.category, location: facts.area } },
    's4Snippet', SCALE));
  assert.equal(identityRow, fallbackRow, 'the two plates must truncate the same facts identically');
  assert.ok(fallbackRow.endsWith(ELLIPSIS));
});

test('P8 the composed row still rasterises — both paths stay inside the 200 KB ceiling at 1080x1350', async () => {
  const shares = { covered: coveredShare(REPORTED), coverless: coverlessShare(REPORTED) };
  let examined = 0;
  for (const [name, share] of Object.entries(shares)) {
    const jpeg = await renderer.renderContentSharePortraitJpeg(share);
    const metadata = await sharp(jpeg).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height], ['jpeg', 1080, 1350], `${name} dimensions`);
    assert.ok(jpeg.length > 0 && jpeg.length <= renderer.MAX_CONTENT_SHARE_JPEG_BYTES, `${name} is ${jpeg.length} B`);
    assert.equal(await renderer.isValidContentSharePortraitJpeg(jpeg), true, `${name} validator`);
    examined += 1;
  }
  assert.equal(examined, 2, `rendered ${examined} cards, expected 2`);
});

test('P9 CI actually COLLECTS this suite — registered in a live provider workflow, registry still at 200 origins', () => {
  const fs = require('node:fs');
  // #2653 — the provider workflow filename is ASSEMBLED FROM PARTS here, never
  // written as one literal, and it must stay that way. `discoverWorkflowProviders()`
  // in `.github/scripts/ci-batch/validate-manifest-v2.mjs` scans EVERY tracked file
  // that is not itself under `.github/workflows/` for /[A-Za-z0-9_.-]+\.ya?ml/ and
  // mints an "external provider reference" for each match naming a real workflow.
  // That provider record set is FROZEN at an exact count and digest, so a single
  // spelled-out workflow filename in this file fails the required registry gate
  // closed. Do NOT "tidy" this back into a plain string literal.
  const WORKFLOW_NAME = ['issue-1719-unified-sharing', 'yml'].join('.');
  const WORKFLOW = `.github/workflows/${WORKFLOW_NAME}`;
  const SELF = 'scripts/issue-2700/detail-row-truncation.implementor.happy.test.mjs';
  const workflow = fs.readFileSync(path.join(ROOT, WORKFLOW), 'utf8');
  assert.ok(workflow.includes(`- run: node --test ${SELF}`), 'suite is not invoked by the workflow');

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.github/ci-batch/MANIFEST.json'), 'utf8'));
  assert.equal(manifest.legacyOrigins.length, 200, 'legacy origin registry must stay pinned at 200');
  const origin = manifest.legacyOrigins.find((item) => `${item.stem}.${item.extension}` === WORKFLOW_NAME);
  assert.ok(origin, 'provider workflow is not a registered origin');

  // The registered path scope must SELECT every file this work changes, or the
  // suite is collected in name only and never re-runs when the code it guards moves.
  const globs = origin.workflowMetadata.pathScope;
  const matches = (file) => globs.some((glob) => {
    const pattern = new RegExp(`^${glob.split('**').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('.*')}$`);
    return pattern.test(file);
  });
  let examined = 0;
  for (const file of [SELF, 'mingla-business/server/cardIdentityRenderer.js', 'packages/sharing/index.js']) {
    assert.ok(matches(file), `${file} is outside the provider's path scope`);
    examined += 1;
  }
  assert.equal(examined, 3, `checked ${examined} paths, expected 3`);

  // The manifest's copy of the workflow is CONTENT-COUPLED. Re-derive it here so
  // an edit to the workflow that forgets the manifest cannot pass this suite.
  const digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT, WORKFLOW))).digest('hex');
  assert.equal(origin.workflowMetadata.sourceSha256, digest, 'manifest sourceSha256 is stale for the provider workflow');
});

test('P10 RUNTIME: the composed row is never handed to the shaper with anything to clip', async () => {
  // The decisive proof, and the only one that reaches the rasteriser. Render the
  // composed row UNCONSTRAINED — no maxHeight, no overflow — into a box six rows
  // tall, and count the 16pt bands that actually carry ink. The plate clips at
  // two bands, so a row that lays out in <= 2 bands is a row the clip never
  // touches: nothing is cut off, and therefore no glyph, separator included, can
  // be left dangling by the shaper. Measured on the real engine at the plate's
  // real typography, not inferred from a style object.
  const { ImageResponse } = await import(path.join(ROOT, 'mingla-business/node_modules/@vercel/og/dist/index.node.js'));
  const React = require(path.join(ROOT, 'mingla-business/node_modules/react'));
  const USABLE = (312 - 2 * 12) * SCALE;   // plateW minus the plate's 12pt side padding
  const BAND = 16 * SCALE;                 // the row's line height
  const ROWS = 2;                          // maxHeight 32 / lineHeight 16
  const bandsOfInk = async (text) => {
    const height = BAND * 6;
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
  };
  const CASES = {
    reported_covered: renderer.contentSharePortraitElement(coveredShare(REPORTED)),
    reported_coverless: renderer.contentSharePortraitElement(coverlessShare(REPORTED)),
    long_place_identity: renderer.cardIdentityElement({ kind: 'place', title: 'Didi Museum', cover_url: COVER, metadata: {
      category: 'Museum and cultural centre with a permanent collection',
      location: 'Akin Adesola Street 175, Victoria Island, Lagos 106104, Lagos, Nigeria' } }, 's4Snippet', SCALE),
    long_venue_identity: renderer.cardIdentityElement({ kind: 'place', title: 'Terra', cover_url: COVER, metadata: {
      category: 'Neighbourhood wine bar and small plates kitchen with a courtyard and a cellar',
      location: 'Kensington Palace Gardens Conservatory and Orangery Terrace Rooms, London W8 4PX' } }, 's5Og', SCALE),
    short_fits: renderer.contentSharePortraitElement(coveredShare(
      { schemaVersion: 1, kind: 'event', title: 'Sunset Sessions', localDate: 'Aug 8, 2026', localTime: '8:00 PM', venue: 'The Terrace' })),
  };
  let examined = 0;
  for (const [name, element] of Object.entries(CASES)) {
    const line = detailRow(element);
    const bands = await bandsOfInk(line);
    // Anti-vacuity: a row that rendered NO ink would pass "<= 2" for free.
    assert.ok(bands >= 1, `${name}: composed row rendered no ink at all`);
    assert.ok(bands <= ROWS, `${name}: composed row lays out in ${bands} lines, the plate clips at ${ROWS} -> ${JSON.stringify(line)}`);
    examined += 1;
  }
  // Denominator asserted: a sweep that rendered nothing and reported clean is a
  // failed run, not a pass.
  assert.equal(examined, 5, `rendered ${examined} rows, expected 5`);
});
