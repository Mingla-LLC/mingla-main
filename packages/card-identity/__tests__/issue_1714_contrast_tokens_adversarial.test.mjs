/**
 * Issue #1714 independent tester adversarial guard.
 *
 * This suite searches between the primary oracle's 41 samples, attacks each
 * compensating layer independently with the rejected token values, and keeps
 * an unrendered descriptor out of BUILT. It deliberately shares no colour or
 * measurement helpers with the implementor suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const IDENTITY = require_('../index.js');

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
const FLOOR = 3;
const DENSE_STEPS = 100_000;
const DENSE_PHOTOS = Array.from(
  { length: DENSE_STEPS + 1 },
  (_, index) => (255 * index) / DENSE_STEPS,
);
const ORACLE_INTERVAL = 255 / 40;
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

function linear(channel) {
  const encoded = channel / 255;
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb) {
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

function contrast(first, second) {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function over(foreground, alpha, background) {
  return foreground.map(
    (channel, index) => channel * alpha + background[index] * (1 - alpha),
  );
}

function photoBackdrop(photo, scrimAlpha) {
  return over(BLACK, scrimAlpha, [photo, photo, photo]);
}

function translucentPlate(background, underAlpha) {
  const under = over(IDENTITY.PLATE.underRgb, underAlpha, background);
  return over(IDENTITY.PLATE.liftRgb, IDENTITY.PLATE.liftAlpha, under);
}

function densePlateBoundary(surfaceKey, boundaryAlpha) {
  const surface = IDENTITY.SURFACES[surfaceKey];
  const scrimHeight = IDENTITY.surfaceScrimHeight(surfaceKey);
  const scrimAlpha = IDENTITY.rampAlphaAtDepth(
    IDENTITY.plateTopDepth(surfaceKey),
    scrimHeight,
  );
  const underAlpha = IDENTITY.plateUnderAlpha(scrimAlpha);
  let worst = { ratio: Infinity, photo: NaN };

  for (const photo of DENSE_PHOTOS) {
    const background = photoBackdrop(photo, scrimAlpha);
    const fill = surface.opaqueOnly
      ? IDENTITY.PLATE.fallbackSolidRgb
      : translucentPlate(background, underAlpha);
    const edge = over(WHITE, boundaryAlpha, background);
    const visibleBoundary = Math.max(
      contrast(fill, background),
      contrast(edge, background),
    );
    if (visibleBoundary < worst.ratio) worst = { ratio: visibleBoundary, photo };
  }

  return worst;
}

function denseSliver(surfaceKey, sliverIndex, boundaryAlpha) {
  const surface = IDENTITY.SURFACES[surfaceKey];
  const scrimHeight = IDENTITY.surfaceScrimHeight(surfaceKey);
  const depth = surface.bottomInset
    + surface.plateH
    + IDENTITY.SLIVER.offsets[sliverIndex]
    + surface.sliver.height / 2;
  const scrimAlpha = IDENTITY.rampAlphaAtDepth(depth, scrimHeight);
  const fillAlpha = sliverIndex === 1 && surface.sliver.alpha2 != null
    ? surface.sliver.alpha2
    : surface.sliver.alpha;
  let worst = { ratio: Infinity, photo: NaN };

  for (const photo of DENSE_PHOTOS) {
    const background = photoBackdrop(photo, scrimAlpha);
    const core = surface.sliver.forcedOpaque
      ? WHITE
      : over(WHITE, fillAlpha, background);
    const edge = over(BLACK, boundaryAlpha, background);
    const visibleBoundary = Math.max(
      contrast(core, background),
      contrast(edge, background),
    );
    if (visibleBoundary < worst.ratio) worst = { ratio: visibleBoundary, photo };
  }

  return worst;
}

function distanceFromOracleSample(photo) {
  return Math.abs(photo - Math.round(photo / ORACLE_INTERVAL) * ORACLE_INTERVAL);
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n\r]*/g, '');
}

function sourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const path = `${root}/${entry}`;
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:js|mjs|cjs|ts|tsx)$/.test(entry)) files.push(path);
  }
  return files;
}

function rendererEvidence(surfaceKey) {
  const keyUse = new RegExp(
    `(?:SURFACES\\s*(?:\\.\\s*${surfaceKey}|\\[\\s*['\"]${surfaceKey}['\"]\\s*\\])|['\"]${surfaceKey}['\"])`,
  );
  return [
    `${REPO}/app-mobile/src`,
    `${REPO}/mingla-business`,
    `${REPO}/packages`,
  ].flatMap(sourceFiles).filter((path) => {
    if (path.includes('/card-identity/')) return false;
    const source = stripComments(readFileSync(path, 'utf8'));
    return keyUse.test(source)
      && /surfacePlateBoundary\s*\(/.test(source)
      && /surfaceSliverBoundary\s*\(/.test(source);
  });
}

function verdictSet(source, name) {
  const declaration = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\);`).exec(source);
  assert.ok(declaration, `A-4 could not read ${name}`);
  return new Set([...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]));
}

test('A-1 dense interstitial search keeps every corrected silhouette above 3:1', () => {
  for (const surfaceKey of ['s2Grid', 's3Chat', 's5Og']) {
    const plate = densePlateBoundary(
      surfaceKey,
      IDENTITY.surfacePlateBoundary(surfaceKey).alpha,
    );
    assert.ok(
      plate.ratio >= FLOOR,
      `A-1 ${surfaceKey} plate falls to ${plate.ratio}:1 at photo ${plate.photo}`,
    );
    for (const sliverIndex of [0, 1]) {
      const sliver = denseSliver(
        surfaceKey,
        sliverIndex,
        IDENTITY.surfaceSliverBoundary(surfaceKey).alpha,
      );
      assert.ok(
        sliver.ratio >= FLOOR,
        `A-1 ${surfaceKey} sliver ${sliverIndex + 1} falls to ${sliver.ratio}:1 at photo ${sliver.photo}`,
      );
    }
  }

  for (const surfaceKey of ['s2Grid', 's3Chat']) {
    const crossing = densePlateBoundary(
      surfaceKey,
      IDENTITY.surfacePlateBoundary(surfaceKey).alpha,
    );
    assert.ok(
      distanceFromOracleSample(crossing.photo) > 0.05,
      `A-1 ${surfaceKey} dense minimum did not exercise a crossing between the 41 oracle samples`,
    );
  }
});

test('A-2 rejected single-layer controls still fail independently', () => {
  // Append-only compliance clarification: #1615 replaced the obsolete opaque
  // landscape with a glass portrait. Its old .38 control no longer falsifies
  // the new geometry, while .30 does; the .42 production token stays exact.
  for (const surfaceKey of ['s2Grid', 's3Chat']) {
    const oldPlate = densePlateBoundary(surfaceKey, 0.38);
    assert.ok(
      oldPlate.ratio < FLOOR,
      `A-2 ${surfaceKey} compact plate control 0.38 unexpectedly passed at ${oldPlate.ratio}:1`,
    );
    const missingHairline = denseSliver(surfaceKey, 1, 0);
    assert.ok(
      missingHairline.ratio < FLOOR,
      `A-2 ${surfaceKey} second sliver unexpectedly passed without its dark hairline at ${missingHairline.ratio}:1`,
    );
  }

  // [TEST-MOD-APPROVED #1615] S5 is no longer the old opaque landscape; its
  // portrait geometry makes .38 narrowly pass, so the rejected .30 control is
  // the falsifier while the exact .42 token is pinned by the portrait suite.
  const oldOg = densePlateBoundary('s5Og', 0.30);
  assert.ok(
    oldOg.ratio < FLOOR,
    `A-2 s5Og portrait boundary control 0.30 unexpectedly passed at ${oldOg.ratio}:1`,
  );
});

test('A-3 selectors reject unknown surfaces and never resolve an unknown boundary key', () => {
  for (const [surfaceKey, descriptor] of Object.entries(IDENTITY.SURFACES)) {
    assert.ok(
      Object.hasOwn(IDENTITY.PLATE.boundaries, descriptor.plateBoundary),
      `A-3 ${surfaceKey} has unknown plate selector ${descriptor.plateBoundary}`,
    );
    assert.ok(
      Object.hasOwn(IDENTITY.SLIVER.boundaries, descriptor.sliverBoundary),
      `A-3 ${surfaceKey} has unknown sliver selector ${descriptor.sliverBoundary}`,
    );
    assert.equal(
      IDENTITY.surfacePlateBoundary(surfaceKey),
      IDENTITY.PLATE.boundaries[descriptor.plateBoundary],
    );
    assert.equal(
      IDENTITY.surfaceSliverBoundary(surfaceKey),
      IDENTITY.SLIVER.boundaries[descriptor.sliverBoundary],
    );
  }
  assert.throws(
    () => IDENTITY.surfacePlateBoundary('notASurface'),
    /unknown surface "notASurface"/,
  );
  assert.throws(
    () => IDENTITY.surfaceSliverBoundary('notASurface'),
    /unknown surface "notASurface"/,
  );
});

test('A-4 S2, S3, and S5 cannot be BUILT without a real selector-owning renderer', () => {
  const oracle = readFileSync(
    `${REPO}/packages/card-identity/__tests__/card_identity_single_source.test.mjs`,
    'utf8',
  );
  const built = verdictSet(oracle, 'BUILT');
  for (const surfaceKey of ['s2Grid', 's3Chat', 's5Og']) {
    const evidence = rendererEvidence(surfaceKey);
    assert.equal(
      built.has(surfaceKey),
      evidence.length > 0,
      built.has(surfaceKey)
        ? `A-4 ${surfaceKey} is marked BUILT but no non-test renderer consumes both boundary selectors`
        : `A-4 ${surfaceKey} has a selector-owning renderer but is still marked DESIGNED`,
    );
  }
});
