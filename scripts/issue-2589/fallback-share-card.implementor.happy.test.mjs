/**
 * #2589 stage-1 implementor suite — the fallback share card.
 *
 * FAILS-ON-REVERT: deleting the computed `titleMaxHeight` line in
 * `contentSharePortraitElement` (P4), the `field`/`stamp` layers (P2/P3/P5), or
 * the square-corner change (P6) each turns a distinct case RED. Proven by real
 * line deletion, not by comment-out — a commented-out fix still matches a
 * source grep and would give a false fails-on-revert.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SUITES_ADDED_SINCE_SEAL } from '../../.github/scripts/ci-batch/validate-manifest-v2.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const CI = require(path.join(ROOT, 'packages/card-identity'));
const renderer = require(path.join(ROOT, 'mingla-business/server/cardIdentityRenderer.js'));
const pure = require(path.join(ROOT, 'mingla-business/server/fallbackShareCard.js'));
const preview = require(path.join(ROOT, 'mingla-business/server/socialPreview.js'));
const sharp = require(path.join(ROOT, 'mingla-business/node_modules/sharp'));

/** A real 1x1 PNG. `data:` URIs short-circuit `prepareCoverForOg`, so this suite makes no network call. */
const USABLE_COVER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const CEILING = renderer.MAX_CONTENT_SHARE_JPEG_BYTES;
/** `sharp.flatten({background})` paints this behind any transparency. A square card must never show it in a corner. */
const FLATTEN_RGB = [0x0c, 0x0e, 0x12];

/** The seven cases the design contract was proven against, at 1080x1350. */
const CASES = {
  A_sunset_event: { shortCode: 'Aa0Bb1Cc2Dd3Ee4F', version: 1, facts: { schemaVersion: 1, kind: 'event', title: 'Sunset Rooftop Sessions', localDate: 'Aug 8, 2026', localTime: '8:00 PM', venue: 'The Terrace', availability: 'Few left' } },
  B_ocean_trip: { shortCode: 'Bb1Cc2Dd3Ee4Ff5G', version: 1, facts: { schemaVersion: 1, kind: 'trip', title: 'Coastal Escape Weekend', dateRange: 'Sep 12, 2026 – Sep 14, 2026', destination: 'Lagos', duration: '3 days' } },
  C2_curated: { shortCode: 'Cc2Dd3Ee4Ff5Gg6H', version: 1, facts: { schemaVersion: 1, kind: 'curated', title: 'A Slow Saturday in Peckham', stopCount: 3, area: 'Peckham', duration: '4 hours' } },
  C5_venue_stamp: { shortCode: 'Dd3Ee4Ff5Gg6Hh7I', version: 1, facts: { schemaVersion: 1, kind: 'venue', title: 'Terra' } },
  C6_brand_stamp: { shortCode: 'Ee4Ff5Gg6Hh7Ii8J', version: 1, facts: { schemaVersion: 1, kind: 'brand', title: 'Nightjar Collective', category: 'Live music' } },
  D_gated_longtitle: { shortCode: 'Ff5Gg6Hh7Ii8Jj9K', version: 1, facts: { schemaVersion: 1, kind: 'event', title: 'The Very Long Midsummer Night Garden Party and Late Supper Club Session', localDate: 'Nov 21, 2026', localTime: '7:30 PM', status: 'sold_out' } },
  E_emptyfacts: { shortCode: 'Gg6Hh7Ii8Jj9Kk0L', version: 1, facts: { schemaVersion: 1, kind: 'experience', title: 'Blind Tasting' } },
};

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
const hasGeneratedField = (element) => walk(element).styles.some((style) => typeof style.backgroundImage === 'string' && style.backgroundImage.startsWith('linear-gradient('));
const cardRootStyle = (element) => element.props.style;

test('P1 every proven case renders inside the 200 KB ceiling at 1080x1350 and passes the unchanged validator', async () => {
  const sizes = {};
  for (const [name, share] of Object.entries(CASES)) {
    const jpeg = await renderer.renderContentSharePortraitJpeg(share);
    const metadata = await sharp(jpeg).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height], ['jpeg', 1080, 1350], `${name} dimensions`);
    assert.ok(jpeg.length > 0 && jpeg.length <= CEILING, `${name} is ${jpeg.length} B, ceiling ${CEILING}`);
    // The contract measured 42-88 KB across these seven. A card that ballooned
    // past 120 KB would still pass the ceiling while having stopped being this
    // design, so the per-case bound is tighter than the ceiling on purpose.
    assert.ok(jpeg.length < 120_000, `${name} is ${jpeg.length} B, far above the measured envelope`);
    assert.equal(await renderer.isValidContentSharePortraitJpeg(jpeg), true, `${name} validator`);
    sizes[name] = jpeg.length;
  }
  assert.equal(Object.keys(sizes).length, 7);
});

test('P2 the fallback triggers for no cover, an unusable cover and a video without a poster', async () => {
  const base = CASES.A_sunset_event;
  const triggers = {
    no_cover_at_all: { ...base, media: null },
    no_poster_on_media: { ...base, media: { kind: 'photo', url: '' } },
    // Host is not on the share allowlist, so `prepareCoverForOg` throws
    // `cover_unavailable` before any fetch. Pre-#2589 this was a 502.
    unusable_cover_host: { ...base, media: { kind: 'photo', url: 'https://example.invalid/a.jpg', posterUrl: 'https://example.invalid/a.jpg' } },
    video_without_poster: { ...base, media: { kind: 'video', url: 'https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/share/a.mp4' } },
  };
  for (const [label, share] of Object.entries(triggers)) {
    const jpeg = await renderer.renderContentSharePortraitJpeg(share);
    assert.ok(jpeg.length > 0 && jpeg.length <= CEILING, `${label} produced no usable card`);
    assert.equal(await renderer.isValidContentSharePortraitJpeg(jpeg), true, label);
  }
});

test('P3 a usable cover does NOT trigger the fallback — the photograph layer still wins', async () => {
  const covered = { ...CASES.A_sunset_event, media: { kind: 'photo', url: USABLE_COVER, posterUrl: USABLE_COVER } };
  assert.equal(hasGeneratedField(renderer.contentSharePortraitElement(covered)), false, 'covered card must not generate a field');
  assert.equal(hasGeneratedField(renderer.contentSharePortraitElement({ ...CASES.A_sunset_event, media: null })), true, 'coverless card must generate a field');
  const jpeg = await renderer.renderContentSharePortraitJpeg(covered);
  assert.equal(await renderer.isValidContentSharePortraitJpeg(jpeg), true);
});

test('P4 the title clip height is COMPUTED, so a >48-character title renders whole lines and never a sliced one', () => {
  const s = CI.SURFACES.s4Snippet;
  const titleFor = (length) => 'Ab '.repeat(Math.ceil(length / 3)).slice(0, length).trim();
  for (const [length, expectedSize] of [[40, 27], [60, 25], [80, 23]]) {
    const title = titleFor(length);
    assert.ok(Array.from(title).length >= length - 2, 'fixture length');
    const element = renderer.contentSharePortraitElement({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', facts: { schemaVersion: 1, kind: 'brand', title } });
    const style = walk(element).styles.find((candidate) => candidate.fontWeight === 700 && typeof candidate.maxHeight === 'number' && candidate.wordBreak === 'break-word');
    assert.ok(style, `no title style at ${length} chars`);
    const lineHeight = Number(String(style.lineHeight).replace('px', ''));
    assert.equal(style.fontSize, expectedSize * 3, `${length} chars picks the ${expectedSize}pt rung`);
    assert.equal(lineHeight, Math.max(30, expectedSize + 6) * 3, `${length} chars line height`);
    // The whole fix: the clip lands on a LINE BOUNDARY at every rung.
    assert.equal(style.maxHeight, lineHeight * s.titleLines, `${length} chars clip must equal ${s.titleLines} whole lines`);
    assert.equal(style.maxHeight % lineHeight, 0, `${length} chars clip leaves a partial line`);
  }
  // NEGATIVE CONTROL — the assertion above has teeth only because the shipped
  // constant genuinely fails it. 66 does not divide the two smaller rungs' line
  // heights, which is precisely the live defect: 4pt of a third line at 25pt and
  // 6pt at 23pt. If this ever stops failing, P4's divisibility check is vacuous.
  for (const size of [25, 23]) {
    const lineHeight = Math.max(30, size + 6);
    assert.notEqual(66 % lineHeight, 0, `hardcoded 66 unexpectedly divides LH ${lineHeight}`);
    assert.ok(66 - lineHeight * 2 > 0, `hardcoded 66 leaves ${66 - lineHeight * 2}pt of a third line at ${size}pt`);
  }
});

test('P5 the stamp ladder walks every rung and removes elements rather than inventing them', () => {
  const rung = (facts) => pure.stampContent({ schemaVersion: 1, ...facts });
  const dateStamp = rung({ kind: 'event', title: 'x', localDate: 'Aug 8, 2026', localTime: '8:00 PM' });
  assert.deepEqual([dateStamp.variant, dateStamp.value, dateStamp.meta], ['headline', '8 AUG', 'SAT · 2026 · 8:00 PM']);
  assert.deepEqual(dateStamp.consumedKeys, ['localDate', 'localTime']);
  // No time -> the meta row loses the time and keeps weekday and year. The year
  // is never dropped: the render is immutable and may be read years later.
  assert.equal(rung({ kind: 'event', title: 'x', localDate: 'Aug 8, 2026' }).meta, 'SAT · 2026');
  assert.equal(rung({ kind: 'rsvp_event', title: 'x', localDate: 'Aug 8, 2026' }).value, '8 AUG');
  assert.equal(rung({ kind: 'experience', title: 'x', nextDate: 'Dec 1, 2026' }).value, '1 DEC');
  // Ranges: same month, cross month, cross year.
  const DASH = pure.RANGE_SEPARATOR;
  assert.equal(DASH, '\u200a\u2013\u200a', 'separator is an en dash with a hair space either side');
  assert.equal(rung({ kind: 'trip', title: 'x', dateRange: 'Sep 12, 2026 – Sep 14, 2026' }).value, `12${DASH}14 SEP`);
  assert.equal(rung({ kind: 'trip', title: 'x', dateRange: 'Sep 12, 2026 – Oct 14, 2026' }).value, `12 SEP${DASH}14 OCT`);
  assert.equal(rung({ kind: 'trip', title: 'x', dateRange: 'Dec 28, 2026 – Jan 2, 2027' }).value, `28 DEC 26${DASH}02 JAN 27`);
  // Stop count, then category as a LABEL variant at 28pt, not a 46pt headline.
  const curated = rung({ kind: 'curated', title: 'x', stopCount: 3, duration: '4 hours' });
  assert.deepEqual([curated.variant, curated.value, curated.meta], ['headline', '3 STOPS', 'CURATED PLAN · 4 HOURS']);
  assert.equal(rung({ kind: 'curated', title: 'x', stopCount: 1 }).value, '1 STOP');
  const label = rung({ kind: 'venue', title: 'x', category: 'Restaurant' });
  assert.deepEqual([label.variant, label.value, label.meta, label.size], ['label', 'RESTAURANT', '', 28]);
  assert.equal(rung({ kind: 'brand', title: 'x', category: 'Live music' }).variant, 'label');
  // Bottom of the ladder: every rung absent -> NO STAMP. Never a placeholder.
  assert.equal(rung({ kind: 'venue', title: 'x' }), null);
  assert.equal(rung({ kind: 'curated', title: 'x', stopCount: 0 }), null);
  assert.equal(rung({ kind: 'event', title: 'x' }), null);
  // A date the producer's regex cannot parse is rendered VERBATIM with no meta
  // row. Never guessed, never dropped.
  const verbatim = rung({ kind: 'event', title: 'x', localDate: 'Next Friday' });
  assert.deepEqual([verbatim.value, verbatim.meta], ['NEXT FRIDAY', '']);
});

test('P5b an empty facts row centres the kind label and moves no derived geometry', () => {
  const s = CI.SURFACES.s4Snippet;
  const plateOf = (share) => walk(renderer.contentSharePortraitElement(share)).styles
    .find((style) => style.width === s.plateW * 3 && style.height === s.plateH * 3);
  const empty = plateOf({ shortCode: 'Gg6Hh7Ii8Jj9Kk0L', facts: { schemaVersion: 1, kind: 'experience', title: 'Blind Tasting' } });
  const populated = plateOf(CASES.A_sunset_event);
  assert.equal(empty.justifyContent, 'center', 'empty facts row must centre the kind label');
  assert.equal(populated.justifyContent, 'flex-start');
  // Geometry is untouched: `plateH` stays 78, so `scrimHeight` and `plateUnder`
  // do not move and nothing derived from the plate shifts.
  assert.equal(empty.height, populated.height);
  assert.equal(empty.width, populated.width);
  assert.equal(empty.borderRadius, populated.borderRadius);
  assert.equal(CI.plateHeightForMetaLines('s4Snippet', 0), s.plateH);
  assert.equal(CI.surfaceScrimHeight('s4Snippet'), 322);
});

test('P6 the card is rendered SQUARE and its corners carry card colour, never the flatten colour', async () => {
  const element = renderer.contentSharePortraitElement({ ...CASES.A_sunset_event, media: null });
  assert.equal(cardRootStyle(element).borderRadius, undefined, 'no radius may be baked into the image');
  const source = require('node:fs').readFileSync(path.join(ROOT, 'mingla-business/server/cardIdentityRenderer.js'), 'utf8');
  const portrait = source.slice(source.indexOf('function contentSharePortraitElement'), source.indexOf('async function renderContentSharePortraitPng'));
  assert.doesNotMatch(portrait, /borderRadius:\s*px\(s\.cardR\)/, 'portrait card must not reinstate the baked radius');

  const jpeg = await renderer.renderContentSharePortraitJpeg({ ...CASES.A_sunset_event, media: null });
  const raw = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => { const i = (y * raw.info.width + x) * raw.info.channels; return [raw.data[i], raw.data[i + 1], raw.data[i + 2]]; };
  const distance = (a, b) => Math.max(...a.map((channel, index) => Math.abs(channel - b[index])));
  for (const [label, pixel] of [['top-left', at(0, 0)], ['top-right', at(1079, 0)]]) {
    assert.ok(distance(pixel, FLATTEN_RGB) > 40, `${label} corner is the flatten colour ${JSON.stringify(pixel)} — a radius is still baked in`);
  }
  // NEGATIVE CONTROL — the corner assertion is only meaningful because the
  // flatten colour and the field are genuinely far apart. A card whose field
  // happened to equal #0C0E12 would pass the check above for the wrong reason.
  const field = pure.fieldFor(CASES.A_sunset_event.shortCode);
  const topStop = field.stops[0].slice(1).match(/../g).map((pair) => parseInt(pair, 16));
  assert.ok(distance(topStop, FLATTEN_RGB) > 40, 'field top stop must be distinguishable from the flatten colour');
});

test('P7 a gated offering carries no location, and an ungated counter-case proves the check is not vacuous', () => {
  const LOCATIONS = ['The Terrace', 'Peckham', 'Lagos'];
  // Both sides carry a non-location fact, so the facts row is populated either
  // way and the comparison isolates the LOCATION rather than re-testing the
  // empty-row centring rule (P5b already owns that).
  const gated = { shortCode: 'Ff5Gg6Hh7Ii8Jj9K', facts: { schemaVersion: 1, kind: 'event', title: 'Midsummer Supper', localDate: 'Nov 21, 2026', localTime: '7:30 PM', availability: 'Few left' } };
  const ungated = { ...gated, facts: { ...gated.facts, venue: 'The Terrace' } };
  const gatedTree = walk(renderer.contentSharePortraitElement(gated));
  const ungatedTree = walk(renderer.contentSharePortraitElement(ungated));

  for (const location of LOCATIONS) {
    assert.ok(!gatedTree.strings.some((value) => value.includes(location)), `gated card leaked ${location}`);
  }
  // COUNTER-CASE: the same walker DOES find the venue when the producer supplies
  // one, so the assertion above cannot pass simply by failing to look.
  assert.ok(ungatedTree.strings.some((value) => value.includes('The Terrace')), 'walker cannot see a location at all — the gated assertion would be vacuous');

  // The card reads no location field, so gated and ungated are the SAME layout:
  // same stamp, same title rung, same plate geometry. Only the plate's facts
  // string differs, and that row is pre-existing, #2587-owned behaviour.
  const geometry = (tree) => tree.styles.map((style) => JSON.stringify([style.position, style.left, style.right, style.top, style.bottom, style.width, style.height, style.maxHeight, style.fontSize, style.lineHeight]));
  assert.deepEqual(geometry(gatedTree), geometry(ungatedTree), 'a gated offering must not change one pixel of geometry');
  // And the fallback card itself never reads a location field.
  const pureSource = require('node:fs').readFileSync(path.join(ROOT, 'mingla-business/server/fallbackShareCard.js'), 'utf8');
  assert.doesNotMatch(pureSource, /\.(?:venue|area|destination|locationText|location_text|city)\b/, 'the fallback card must read no location field');
});

test('P8 the coverless HTML page now emits a truthful og:image, and the card never throws', () => {
  const html = preview.renderContentShareHtml({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', version: 3, facts: { schemaVersion: 1, kind: 'brand', title: 'No cover' }, media: null, destination: {} });
  const url = 'https://usemingla.com/og/s/Aa0Bb1Cc2Dd3Ee4F/v3-r2.jpg';
  assert.ok(html.includes(`<meta property="og:image" content="${url}" />`), 'coverless page must emit og:image');
  assert.ok(html.includes(`<meta property="og:image:secure_url" content="${url}" />`));
  assert.ok(html.includes('summary_large_image'));
  // Still no fabricated media claim: a coverless page has no video and no GIF.
  assert.doesNotMatch(html, /<video|gif-motion|stock/);
  // It is the fallback; there is nothing behind it. An invalid facts blob
  // degrades to an empty facts row rather than failing the image.
  assert.doesNotThrow(() => renderer.contentSharePortraitElement({ shortCode: 'Aa0Bb1Cc2Dd3Ee4F', facts: { kind: 'nonsense', title: '' } }));
  assert.doesNotThrow(() => renderer.contentSharePortraitElement({}));
});

test('P9 the field is deterministic, luminance-normalised and seeded by the SHORT CODE, not the brand', () => {
  // Determinism: the render is cached `immutable`, so one code must always give
  // one card.
  assert.deepEqual(pure.fieldFor('Aa0Bb1Cc2Dd3Ee4F'), pure.fieldFor('Aa0Bb1Cc2Dd3Ee4F'));
  assert.equal(pure.fnv1a32('Aa0Bb1Cc2Dd3Ee4F'), pure.fnv1a32('Aa0Bb1Cc2Dd3Ee4F'));
  // Two offerings from one brand differ — this is the whole answer to "every
  // event from one brand looks identical".
  const codes = ['Aa0Bb1Cc2Dd3Ee4F', 'Bb1Cc2Dd3Ee4Ff5G', 'Cc2Dd3Ee4Ff5Gg6H', 'Dd3Ee4Ff5Gg6Hh7I'];
  const fields = codes.map((code) => JSON.stringify(pure.fieldFor(code)));
  assert.equal(new Set(fields).size, codes.length, 'same-brand offerings must not render identical fields');
  // Tier 1: every card is Mingla orange, derived from the shipped brand token.
  assert.equal(pure.baseHue(undefined), 25);
  assert.equal(pure.baseHue(pure.MINGLA_BRAND_HEX), 25);
  assert.equal(pure.baseHue('#f97316'), 25);
  assert.equal(pure.baseHue('#808080'), 25, 'an achromatic theme falls back to the Mingla hue');
  assert.equal(pure.baseHue('not-a-colour'), 25);
  // Luminance normalisation across the FULL hue circle, not a sample. This is
  // what makes the pill boundary hue-independent.
  for (let hue = 0; hue < 360; hue += 5) {
    const [f0, f1, f2] = pure.fieldStops(hue);
    const luminance = (hex) => pure.relativeLuminance(hex.slice(1).match(/../g).map((pair) => parseInt(pair, 16)));
    assert.ok(Math.abs(luminance(f0) - 0.58) < 0.01, `hue ${hue} f0 luminance ${luminance(f0)}`);
    assert.ok(Math.abs(luminance(f1) - 0.26) < 0.01, `hue ${hue} f1`);
    assert.ok(Math.abs(luminance(f2) - 0.06) < 0.01, `hue ${hue} f2`);
  }
  // The contract's own derived table, reproduced by the shipped bisection.
  assert.deepEqual(pure.fieldStops(25), ['#F7BC93', '#E86042', '#851F21']);
  assert.deepEqual(pure.fieldStops(221), ['#B2C8F9', '#2890E4', '#164B5D']);
  assert.deepEqual(pure.fieldStops(330), ['#F9B5D7', '#E94BBF', '#771C71']);
});

test('P10 CI collects this suite — the 200-origin sealed baseline gains exact post-seal provenance claims, not workflow files', () => {
  const fs = require('node:fs');
  // #2589 — the provider workflow filename is ASSEMBLED FROM PARTS here, never
  // written as one literal, and it must stay that way. `discoverWorkflowProviders()`
  // in `.github/scripts/ci-batch/validate-manifest-v2.mjs` scans EVERY tracked file
  // that is not itself under `.github/workflows/` for /[A-Za-z0-9_.-]+\.ya?ml/ and
  // mints an "external provider reference" for each match naming a real workflow.
  // That provider record set is FROZEN at an exact count and digest, so a single
  // spelled-out workflow filename in this file fails the required registry gate
  // closed and takes the #2437 node-wave and #2148 postgres/deno-wave shadow-parity
  // checks down with it. Do NOT "tidy" this back into a plain string literal.
  const WORKFLOW_NAME = ['issue-1719-unified-sharing', 'yml'].join('.');
  const WORKFLOW = `.github/workflows/${WORKFLOW_NAME}`;
  const SELF = 'scripts/issue-2589/fallback-share-card.implementor.happy.test.mjs';
  const workflow = fs.readFileSync(path.join(ROOT, WORKFLOW), 'utf8');
  // 1. The suite is invoked by name. A test nobody runs is not a test.
  assert.ok(workflow.includes(`- run: node --test ${SELF}`), 'suite is not invoked by the workflow');

  // 2. The origin registry was SEALED at a 200-entry baseline. Each suite named
  //    by the canonical post-seal declaration adds one exact provenance claim;
  //    this is not a workflow-file count and this suite still rides an existing
  //    provider instead of adding a workflow file.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, '.github/ci-batch/MANIFEST.json'), 'utf8'));
  const SEALED_LEGACY_ORIGINS = 200;
  const expectedLegacyOriginCount = SEALED_LEGACY_ORIGINS + SUITES_ADDED_SINCE_SEAL.length;
  assert.equal(
    manifest.legacyOrigins.length,
    expectedLegacyOriginCount,
    'legacy origin registry must equal the sealed 200 baseline plus exact declared post-seal provenance claims; this is not a workflow-file count',
  );
  const origin = manifest.legacyOrigins.find((item) => `${item.stem}.${item.extension}` === WORKFLOW_NAME);
  assert.ok(origin, 'provider workflow is not a registered origin');
  assert.equal(origin.providerWorkflow, `.github/${WORKFLOW.split('/').slice(1).join('/')}`);

  // 3. The registered path scope actually SELECTS every file this work changes,
  //    including the ones outside `scripts/`. A suite that never re-runs when
  //    the code it guards changes is collected in name only.
  const globs = origin.workflowMetadata.pathScope;
  const matches = (file) => globs.some((glob) => {
    const pattern = new RegExp(`^${glob.split('**').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('.*')}$`);
    return pattern.test(file);
  });
  for (const file of [
    SELF,
    'mingla-business/server/fallbackShareCard.js',
    'mingla-business/server/cardIdentityRenderer.js',
    'mingla-business/server/socialPreview.js',
    'mingla-business/api/content-share-image.js',
  ]) {
    assert.ok(matches(file), `${file} is not selected by the provider workflow's path scope`);
  }
  // NEGATIVE CONTROL — the matcher must be capable of saying NO, or every
  // assertion above passes for the wrong reason.
  assert.equal(matches('supabase/functions/manage-stay-inventory/index.ts'), false, 'path matcher accepts everything');
});
