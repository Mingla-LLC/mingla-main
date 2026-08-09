/**
 * Issue #1714 implementor happy path.
 *
 * Imports the real package selectors and independently composites every named
 * boundary across the contract's 41-point photo sweep. The existing oracle
 * owns the broad invariant; this suite pins the approved token map, measured
 * values, compatibility aliases, and honest build verdicts.
 */
import test from 'node:test';
// Append-only attribution: #1615 made the S4/S5/S6 verdict arrays' prior state false.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const CI = require_('../index.js');

const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const PHOTO_SWEEP = Array.from({ length: 41 }, (_, i) => (255 * i) / 40);

function toLinear(channel8) {
  const c = channel8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function ratio(a, b) {
  const values = [luminance(a), luminance(b)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

function composite(foreground, alpha, background) {
  return foreground.map((channel, i) => channel * alpha + background[i] * (1 - alpha));
}

function backdrop(photo, scrimAlpha) {
  return composite(BLACK, scrimAlpha, [photo, photo, photo]);
}

function glassPlate(background, underAlpha) {
  return composite(
    CI.PLATE.liftRgb,
    CI.PLATE.liftAlpha,
    composite(CI.PLATE.underRgb, underAlpha, background),
  );
}

function measuredSurface(surfaceKey) {
  const surface = CI.SURFACES[surfaceKey];
  const scrimHeight = CI.surfaceScrimHeight(surfaceKey);
  const plateScrimAlpha = CI.rampAlphaAtDepth(CI.plateTopDepth(surfaceKey), scrimHeight);
  const underAlpha = CI.plateUnderAlpha(plateScrimAlpha);
  const plateBoundary = CI.surfacePlateBoundary(surfaceKey);
  let plateWorst = Infinity;
  const plateFills = [];

  for (const photo of PHOTO_SWEEP) {
    const background = backdrop(photo, plateScrimAlpha);
    const fill = surface.opaqueOnly
      ? CI.PLATE.fallbackSolidRgb
      : glassPlate(background, underAlpha);
    plateFills.push(fill);
    const edge = composite(plateBoundary.rgb, plateBoundary.alpha, background);
    plateWorst = Math.min(plateWorst, Math.max(ratio(fill, background), ratio(edge, background)));
  }

  const sliverBoundary = CI.surfaceSliverBoundary(surfaceKey);
  const slivers = CI.SLIVER.offsets.map((offset, i) => {
    const depth = surface.bottomInset + surface.plateH + offset + surface.sliver.height / 2;
    const fillAlpha = i === 1 && surface.sliver.alpha2
      ? surface.sliver.alpha2
      : surface.sliver.alpha;
    let worst = Infinity;
    for (const photo of PHOTO_SWEEP) {
      const background = backdrop(photo, CI.rampAlphaAtDepth(depth, scrimHeight));
      const core = surface.sliver.forcedOpaque
        ? WHITE
        : composite(WHITE, fillAlpha, background);
      const edge = composite(sliverBoundary.rgb, sliverBoundary.alpha, background);
      worst = Math.min(worst, Math.max(ratio(core, background), ratio(edge, background)));
    }
    return worst;
  });

  return { plate: plateWorst, plateFills, slivers };
}

test('H-1 every descriptor selects the approved named boundary classes', () => {
  // [TEST-MOD-APPROVED #1615] The approved portrait amendment adds a dedicated
  // boundary and makes both share outputs consume it; prior selectors are obsolete.
  const expected = {
    s1Single: ['standard', 'none'],
    s1Curated: ['standard', 'none'],
    s2Grid: ['compact', 'compact'],
    s3Chat: ['compact', 'compact'],
    s4Snippet: ['portrait', 'none'],
    s5Og: ['portrait', 'none'],
    s6Phone: ['standard', 'none'],
    s7Expanded: ['standard', 'none'],
  };

  assert.deepEqual(Object.keys(CI.SURFACES), Object.keys(expected));
  for (const [surfaceKey, selectors] of Object.entries(expected)) {
    assert.deepEqual(
      [CI.SURFACES[surfaceKey].plateBoundary, CI.SURFACES[surfaceKey].sliverBoundary],
      selectors,
      `H-1 ${surfaceKey}: descriptor selected the wrong boundary class`,
    );
    assert.equal(CI.surfacePlateBoundary(surfaceKey), CI.PLATE.boundaries[selectors[0]]);
    assert.equal(CI.surfaceSliverBoundary(surfaceKey), CI.SLIVER.boundaries[selectors[1]]);
  }
});

test('H-2 the approved boundary tokens and compatibility aliases are exact', () => {
  // [TEST-MOD-APPROVED #1615] The new portrait class is additive and must not
  // mutate the standard/compact/legacy opaque compatibility tokens.
  assert.deepEqual(CI.PLATE.boundaries, {
    standard: { color: 'rgba(255,255,255,0.38)', rgb: [255, 255, 255], alpha: 0.38, width: 1 },
    compact: { color: 'rgba(255,255,255,0.86)', rgb: [255, 255, 255], alpha: 0.86, width: 1 },
    ogOpaque: { color: 'rgba(255,255,255,0.48)', rgb: [255, 255, 255], alpha: 0.48, width: 1 },
    portrait: { color: 'rgba(255,255,255,0.42)', rgb: [255, 255, 255], alpha: 0.42, width: 1 },
  });
  assert.deepEqual(CI.SLIVER.boundaries, {
    none: { color: 'rgba(0,0,0,0)', rgb: [0, 0, 0], alpha: 0, width: 0 },
    compact: { color: 'rgba(0,0,0,0.56)', rgb: [0, 0, 0], alpha: 0.56, width: 0.5 },
  });
  assert.equal(CI.PLATE.border, CI.PLATE.boundaries.standard.color);
  assert.equal(CI.PLATE.borderRgb, CI.PLATE.boundaries.standard.rgb);
  assert.equal(CI.PLATE.borderAlpha, CI.PLATE.boundaries.standard.alpha);
  assert.equal(CI.PLATE.borderWidth, CI.PLATE.boundaries.standard.width);
});

test('H-3 every descriptor reproduces the approved 41-point measurements', () => {
  // [TEST-MOD-APPROVED #1615] S4/S5 were re-derived as the one approved 4:5
  // portrait; these are its published boundary/sliver measurements.
  const expected = {
    s1Single: [3.240777, 3.803902, 3.751396],
    s1Curated: [3.240777, 3.803902, 3.751396],
    s2Grid: [3.239219, 3.295325, 3.300602],
    s3Chat: [3.217715, 3.254745, 3.263288],
    s4Snippet: [3.380046, 3.503273, 3.348354],
    s5Og: [3.380046, 3.503273, 3.348354],
    s6Phone: [3.240777, 3.803902, 3.751396],
    s7Expanded: [3.240777, 3.803902, 3.751396],
  };

  for (const [surfaceKey, values] of Object.entries(expected)) {
    const measured = measuredSurface(surfaceKey);
    const actual = [measured.plate, ...measured.slivers].map((value) => Number(value.toFixed(6)));
    assert.deepEqual(actual, values, `H-3 ${surfaceKey}: 41-point measurement drifted`);
    actual.forEach((value) => assert.ok(value >= 3, `H-3 ${surfaceKey}: ${value}:1 misses 3:1`));
  }
});

test('H-4 S5 is measured through the same portrait glass path as S4', () => {
  // [TEST-MOD-APPROVED #1615] The landscape opaque-only S5 was superseded by
  // byte/geometry parity with the portrait S4; opaque fallback remains available.
  const s5 = CI.SURFACES.s5Og;
  assert.notEqual(s5.opaqueOnly, true);
  assert.deepEqual(CI.PLATE.fallbackSolidRgb, [53, 56, 63]);
  const measured = measuredSurface('s5Og');
  assert.equal(Number(measured.plate.toFixed(6)), 3.380046);
  assert.ok(measured.plateFills.some((fill) => fill !== CI.PLATE.fallbackSolidRgb));
});

test('H-5 S1 and S7 retain their standard boundary and measured continuity', () => {
  for (const surfaceKey of ['s1Single', 's1Curated', 's7Expanded']) {
    assert.equal(CI.SURFACES[surfaceKey].plateBoundary, 'standard');
    assert.equal(Number(measuredSurface(surfaceKey).plate.toFixed(6)), 3.240777);
  }
  assert.equal(CI.PLATE.targetLstar, 23.5);
  assert.equal(CI.PLATE.lift, 'rgba(255,255,255,0.12)');
  assert.deepEqual(CI.PLATE.underRgb, [12, 14, 18]);
  assert.equal(CI.PLATE.fallbackSolid, 'rgb(53,56,63)');
});

test('H-6 verdicts are exact after #1615 builds S4/S5/S6', () => {
  // [TEST-MOD-APPROVED #1615] The old exact arrays became false when real
  // renderer/page files shipped; the reason and authorization live here.
  const oracle = readFileSync(new URL('./card_identity_single_source.test.mjs', import.meta.url), 'utf8');
  const declaration = (name) => {
    const match = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\);`).exec(oracle);
    assert.ok(match, `H-6: could not read ${name} verdict declaration`);
    return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]);
  };

  assert.deepEqual(declaration('BUILT'), ['s1Single', 's1Curated', 's4Snippet', 's5Og', 's6Phone', 's7Expanded']);
  assert.deepEqual(declaration('DESIGNED'), ['s2Grid', 's3Chat']);
  assert.match(oracle, /const KNOWN_OPEN = \{\};/);
});
