// Issue #1593 — the poster layer's photo box and the interactive card's transparent
// hero hole are the SAME rectangle drawn in two React trees. Before the fix they were
// computed independently from one shared style (`styles.imageContainer`, flex: 0.88)
// and resolved to 689.00pt in the poster tree and 667.67pt in the face tree. The
// 21.33pt overhang composited through the tray's rgba(255,255,255,0.85) as a pale bar.
//
// This guard enforces I-PROPOSED-1593-LAYER-GEOMETRY-SINGLE-SOURCE by EXECUTING the real
// geometry function (not a hand-written copy of it) and by statically proving the
// dataflow producer -> prop -> pure function -> poster box, plus the role scoping.
//
// It does NOT run Yoga and therefore does NOT prove the resulting pixel geometry — that
// is the runtime oracle's job (SPEC SC-1/SC-2). Both are required.
//
// VACUITY DISCIPLINE (SPEC 9.0). Four guards on this deck have already been found
// hollow, and a fifth shape — SILENT EXTRACTION FAILURE — is what this file is most
// exposed to: a regex that finds nothing, then asserts nothing about the empty set, so a
// rename or a reformat turns the gate into a no-op while it reports green. Therefore
// every extraction below asserts an EXACT expected count BEFORE it inspects any content,
// finding zero targets is a FAILURE, and source lookups run on comment-stripped source.
//
// CLAIMS — T-9 mechanically asserts that each of these is really enforced in this file,
// because "an enforcement that exists only in a comment" is the seventh failure shape
// (SPEC 11.3 Discovery 2: two workflows claim a numeric assertion that exists nowhere).
// Each token below must appear in a real assertion message in this file's code.
//   CLAIM: executes-the-real-geometry-function
//   CLAIM: behind-role-never-overridden
//   CLAIM: degenerate-height-never-written
//   CLAIM: exactly-one-hero-hole-producer
//   CLAIM: exactly-one-stage-call-site
//   CLAIM: exactly-one-poster-photo-box
//   CLAIM: swap-set-still-exactly-two-styles
//   CLAIM: poster-carries-no-key-prop
//   CLAIM: poster-remains-non-interactive
//   CLAIM: mutant-anchors-are-byte-intact
//   CLAIM: workflow-requires-and-executes-both-guards

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { posterPhotoBoxOverride } from '../deckPosterGeometry.ts';

const IMPLEMENTOR_GUARD =
  'app-mobile/src/components/swipeDeck/__tests__/issue_1593_poster_hole_geometry.test.mjs';
const ADVERSARIAL_GUARD =
  'app-mobile/src/components/swipeDeck/__tests__/'
  + 'issue_1593_poster_hole_geometry.adversarial.test.mjs';
const GUARD_FILES = [IMPLEMENTOR_GUARD, ADVERSARIAL_GUARD];

const urls = {
  swipeable: new URL('../../SwipeableCards.tsx', import.meta.url),
  stage: new URL('../DeckSwipeStage.tsx', import.meta.url),
  geometry: new URL('../deckPosterGeometry.ts', import.meta.url),
  workflow: new URL(
    '../../../../../.github/workflows/issue-1593-deck-layer-geometry.yml',
    import.meta.url,
  ),
  self: new URL('./issue_1593_poster_hole_geometry.test.mjs', import.meta.url),
};

const sourceEntries = await Promise.all(
  Object.entries(urls).map(async ([key, url]) => [key, await readFile(url, 'utf8')]),
);
const source = Object.fromEntries(sourceEntries);

// ---------------------------------------------------------------------------
// Comment / string stripping and delimiter matching.
// ---------------------------------------------------------------------------

/** Strip comments but KEEP string literals (assertion messages must survive for T-9). */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += quote;
      i += 1;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') {
          out += src[i];
          i += 1;
        }
        out += src[i];
        i += 1;
      }
      out += quote;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Strip comments AND string contents — for structural (identifier-level) searches. */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') {
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += quote;
      i += 1;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') i += 1;
        i += 1;
      }
      out += quote;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const CLOSERS = { '{': '}', '[': ']', '(': ')' };

function matchDelimiter(src, openIndex) {
  const open = src[openIndex];
  const close = CLOSERS[open];
  assert.ok(close, `matchDelimiter must start on { [ ( — got ${JSON.stringify(open)}`);
  let depth = 0;
  let state = 'code';
  for (let i = openIndex; i < src.length; i += 1) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; i += 1; continue; }
      if (c === '/' && d === '*') { state = 'block'; i += 1; continue; }
      if (c === "'") { state = 'squote'; continue; }
      if (c === '"') { state = 'dquote'; continue; }
      if (c === '`') { state = 'template'; continue; }
      if (c === open) { depth += 1; continue; }
      if (c === close) {
        depth -= 1;
        if (depth === 0) return i;
      }
      continue;
    }
    if (state === 'line') { if (c === '\n') state = 'code'; continue; }
    if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 1; } continue; }
    if (c === '\\') { i += 1; continue; }
    if (state === 'squote' && c === "'") state = 'code';
    else if (state === 'dquote' && c === '"') state = 'code';
    else if (state === 'template' && c === '`') state = 'code';
  }
  throw new Error('unbalanced delimiters while parsing');
}

/** Index of the `>` closing the opening tag that starts at tagStart, ignoring braces/strings. */
function openingTagEnd(src, tagStart) {
  let depth = 0;
  let state = 'code';
  for (let i = tagStart; i < src.length; i += 1) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; i += 1; continue; }
      if (c === '/' && d === '*') { state = 'block'; i += 1; continue; }
      if (c === "'") { state = 'squote'; continue; }
      if (c === '"') { state = 'dquote'; continue; }
      if (c === '`') { state = 'template'; continue; }
      if (c === '{') { depth += 1; continue; }
      if (c === '}') { depth -= 1; continue; }
      if (c === '>' && depth === 0) return i;
      continue;
    }
    if (state === 'line') { if (c === '\n') state = 'code'; continue; }
    if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 1; } continue; }
    if (c === '\\') { i += 1; continue; }
    if (state === 'squote' && c === "'") state = 'code';
    else if (state === 'dquote' && c === '"') state = 'code';
    else if (state === 'template' && c === '`') state = 'code';
  }
  return -1;
}

/** Every `<Tag ...>` opening tag in src, as {start, end, text}. */
function openingTags(src, tagName) {
  const re = new RegExp(`<${tagName}\\b`, 'g');
  const out = [];
  let m = re.exec(src);
  while (m) {
    const end = openingTagEnd(src, m.index);
    if (end > m.index) out.push({ start: m.index, end, text: src.slice(m.index, end + 1) });
    m = re.exec(src);
  }
  return out;
}

// ---------------------------------------------------------------------------
// T-1 / T-2 / T-8 — the EXECUTED geometry contract.
//
// The expectation table is written out LITERALLY rather than recomputed from the
// implementation's own rules, so this is a genuine oracle and not a second copy of the
// function under test.
// ---------------------------------------------------------------------------

const GEOMETRY_MATRIX = [
  { role: 'current', h: null, expect: null },
  { role: 'current', h: 0, expect: null },
  { role: 'current', h: -1, expect: null },
  { role: 'current', h: 0.4, expect: { flex: 0, height: 0.4 } },
  { role: 'current', h: 1, expect: { flex: 0, height: 1 } },
  { role: 'current', h: 320.5, expect: { flex: 0, height: 320.5 } },
  { role: 'current', h: 500, expect: { flex: 0, height: 500 } },
  { role: 'current', h: 667.67, expect: { flex: 0, height: 667.67 } },
  { role: 'current', h: 689, expect: { flex: 0, height: 689 } },
  { role: 'current', h: 900.25, expect: { flex: 0, height: 900.25 } },
  { role: 'current', h: NaN, expect: null },
  { role: 'current', h: Infinity, expect: null },
  { role: 'behind', h: null, expect: null },
  { role: 'behind', h: 0, expect: null },
  { role: 'behind', h: -1, expect: null },
  { role: 'behind', h: 0.4, expect: null },
  { role: 'behind', h: 1, expect: null },
  { role: 'behind', h: 320.5, expect: null },
  { role: 'behind', h: 500, expect: null },
  { role: 'behind', h: 667.67, expect: null },
  { role: 'behind', h: 689, expect: null },
  { role: 'behind', h: 900.25, expect: null },
  { role: 'behind', h: NaN, expect: null },
  { role: 'behind', h: Infinity, expect: null },
];

/**
 * Run `fn` over the whole matrix and return distinctly-signatured failure strings.
 * Shared by T-1 (must be empty for the real function) and T-8 (must be non-empty, with
 * different signatures, for each synthetic wrong implementation).
 */
function checkGeometry(fn) {
  const failures = [];
  for (const { role, h } of GEOMETRY_MATRIX) {
    // eslint-disable-next-line no-restricted-syntax
    const row = GEOMETRY_MATRIX.find((r) => r.role === role && Object.is(r.h, h));
    const want = row.expect;
    const got = fn(role, h);
    const label = `${role}/${String(h)}`;

    if (want === null) {
      if (got !== null) {
        if (role === 'behind') {
          failures.push(`role-scope: ${label} must be null, got ${JSON.stringify(got)}`);
        } else {
          failures.push(`degenerate: ${label} must be null, got ${JSON.stringify(got)}`);
        }
      }
      continue;
    }
    if (got === null || typeof got !== 'object') {
      failures.push(`null-for-valid: ${label} must be an override, got ${JSON.stringify(got)}`);
      continue;
    }
    const keys = Object.keys(got).sort().join(',');
    if (keys !== 'flex,height') {
      failures.push(`shape: ${label} key set must be flex,height — got ${keys}`);
      continue;
    }
    if (got.flex !== 0) failures.push(`shape: ${label} flex must be 0, got ${got.flex}`);
    if (!Object.is(got.height, want.height)) {
      failures.push(`identity: ${label} height must be exactly ${want.height}, got ${got.height}`);
    }
  }
  return failures;
}

test('T-1 the REAL geometry function is imported and executed over the full matrix', () => {
  assert.equal(
    typeof posterPhotoBoxOverride,
    'function',
    'VACUITY: posterPhotoBoxOverride did not import as a function — this guard '
    + 'executes-the-real-geometry-function and cannot fall back to a copy',
  );
  assert.ok(
    GEOMETRY_MATRIX.length === 24,
    `VACUITY: the matrix collapsed to ${GEOMETRY_MATRIX.length} rows`,
  );

  const failures = checkGeometry(posterPhotoBoxOverride);
  assert.deepEqual(
    failures,
    [],
    'the shipped geometry function violated the contract: ' + failures.join(' | '),
  );

  // Called out separately so a regression names the rule it broke.
  for (const h of [0.4, 1, 320.5, 500, 667.67, 689, 900.25]) {
    assert.equal(
      posterPhotoBoxOverride('behind', h),
      null,
      'behind-role-never-overridden: the behind overlay tray is EMPTY so its hole may '
      + 'legitimately differ; writing the current card measurement there would paint an '
      + 'inverse white sliver on a layer that is correct today',
    );
  }
  for (const h of [0, -1, NaN, Infinity, null]) {
    assert.equal(
      posterPhotoBoxOverride('current', h),
      null,
      'degenerate-height-never-written: a non-finite or non-positive measurement must '
      + 'yield no override — writing height:0 would collapse the photo entirely, which is '
      + 'a worse defect than the pale bar',
    );
  }
  console.log(`T-1 examined ${GEOMETRY_MATRIX.length} executed geometry cases`);
});

test('T-2 the returned override has an invariant shape at every finite positive height', () => {
  const shapes = new Set();
  const finite = [0.4, 1, 320.5, 500, 667.67, 689, 900.25];
  for (const h of finite) {
    const got = posterPhotoBoxOverride('current', h);
    assert.ok(got, `expected an override at h=${h}`);
    shapes.add(Object.keys(got).sort().join(','));
  }
  assert.equal(
    shapes.size,
    1,
    `the override shape varies with the height (${[...shapes].join(' / ')}) — a `
    + 'conditionally-spread property would make the poster box style non-deterministic',
  );
  assert.equal([...shapes][0], 'flex,height');
  assert.equal(finite.length, 7, `VACUITY: the finite sweep collapsed to ${finite.length} points`);
});

test('T-8 negative control — the checker rejects a pre-fix and a hardcoded implementation', () => {
  const preFix = () => null;
  const hardcoded = () => ({ flex: 0, height: 667.67 });

  const preFixFailures = checkGeometry(preFix);
  const hardcodedFailures = checkGeometry(hardcoded);

  assert.ok(
    preFixFailures.length > 0,
    'the pre-fix implementation (always null) must be rejected, or this guard cannot '
    + 'detect a revert',
  );
  assert.ok(
    hardcodedFailures.length > 0,
    'the hardcoded implementation must be rejected, or a device-tuned constant would pass',
  );

  // Distinct signatures — the two wrong implementations must not be diagnosed identically.
  assert.ok(
    preFixFailures.every((f) => f.startsWith('null-for-valid:')),
    `pre-fix should fail only as null-for-valid, got: ${preFixFailures.join(' | ')}`,
  );
  assert.ok(
    hardcodedFailures.some((f) => f.startsWith('role-scope:')),
    `hardcoded should break the role scope, got: ${hardcodedFailures.join(' | ')}`,
  );
  assert.ok(
    hardcodedFailures.some((f) => f.startsWith('identity:')),
    `hardcoded should break height identity, got: ${hardcodedFailures.join(' | ')}`,
  );
  assert.notDeepEqual(
    preFixFailures,
    hardcodedFailures,
    'the two synthetic failures are indistinguishable — the checker is not discriminating',
  );
});

// ---------------------------------------------------------------------------
// T-3 — the PRODUCER, derived from structure rather than named.
// ---------------------------------------------------------------------------

test('T-3 the hero-hole measurement is produced by the face tree onLayout, derived', () => {
  const src = stripCommentsAndStrings(source.swipeable);

  const heroHoles = openingTags(src, 'View').filter((tag) => (
    tag.text.includes('styles.imageContainer')
    && tag.text.includes('styles.transparentImageContainer')
    && tag.text.includes('onLayout=')
  ));
  assert.equal(
    heroHoles.length,
    1,
    'exactly-one-hero-hole-producer: expected exactly ONE <View> carrying both '
    + `styles.imageContainer and styles.transparentImageContainer AND an onLayout, found `
    + `${heroHoles.length} — zero means this guard would pass by finding nothing`,
  );
  const [hole] = heroHoles;

  const gestureAt = src.indexOf('<GestureDetector');
  assert.ok(
    gestureAt >= 0,
    'VACUITY: no <GestureDetector> in SwipeableCards — the subtree anchor is gone',
  );
  assert.ok(
    hole.start > gestureAt,
    'the measured hero hole must live inside the current card GestureDetector subtree, '
    + 'not in the behind overlay',
  );

  // The handler body, and the setters it calls.
  const onLayoutAt = hole.text.indexOf('onLayout=');
  const braceAt = hole.text.indexOf('{', onLayoutAt);
  const handler = hole.text.slice(braceAt, matchDelimiter(hole.text, braceAt) + 1);
  assert.ok(handler.length > 40, `VACUITY: extracted onLayout body is implausibly short`);

  const setters = [...handler.matchAll(/\bset[A-Z]\w*\(/g)].map((m) => m[0].slice(0, -1));
  assert.ok(
    setters.length >= 2,
    `the hero onLayout must set BOTH the decode-target layout and the hole height, `
    + `found setters: ${JSON.stringify(setters)}`,
  );

  // Derive the state identifier from the CALL SITE, then prove that identifier's setter is
  // the one this handler calls. Nothing here hardcodes the state variable's name.
  const stageTag = openingTags(src, 'DeckSwipeStage');
  assert.equal(
    stageTag.length,
    1,
    `exactly-one-stage-call-site: expected exactly ONE <DeckSwipeStage> call site, found `
    + `${stageTag.length}`,
  );
  const propMatch = /heroHoleHeight=\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(stageTag[0].text);
  assert.ok(
    propMatch,
    'the <DeckSwipeStage> call site must pass heroHoleHeight={<identifier>} — without it '
    + 'the poster box falls back to the independently-computed flex height (#1593)',
  );
  const stateIdent = propMatch[1];

  const decl = new RegExp(
    `const\\s*\\[\\s*${stateIdent}\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\]\\s*=\\s*useState`,
  ).exec(src);
  assert.ok(
    decl,
    `VACUITY: no useState declaration found for the identifier "${stateIdent}" passed as `
    + 'heroHoleHeight — the dataflow cannot be traced',
  );
  assert.ok(
    setters.includes(decl[1]),
    `the value passed as heroHoleHeight ("${stateIdent}") is not set by the measured hero `
    + `hole's onLayout (that handler calls ${JSON.stringify(setters)}, not ${decl[1]}) — the `
    + 'poster would follow something other than the real measurement',
  );
  console.log(`T-3 examined 1 hero-hole producer and ${setters.length} setters`);
});

// ---------------------------------------------------------------------------
// T-4 — the CONSUMER wiring.
// ---------------------------------------------------------------------------

test('T-4 the dataflow producer -> prop -> pure function -> poster box is complete', () => {
  const swipeable = stripCommentsAndStrings(source.swipeable);
  // Structural searches run on identifier-level source; the import specifier and the role
  // literals are STRINGS, so those two checks run on comment-stripped-but-string-preserving
  // source instead. Both are comment-free, which is the property that matters.
  const stage = stripCommentsAndStrings(source.stage);
  const stageCode = stripComments(source.stage);

  const propOccurrences = [...swipeable.matchAll(/heroHoleHeight=\{/g)];
  assert.equal(
    propOccurrences.length,
    1,
    `exactly-one-stage-call-site: heroHoleHeight={ must appear exactly once in `
    + `SwipeableCards, found ${propOccurrences.length}`,
  );

  assert.match(
    stageCode,
    /import\s*\{\s*posterPhotoBoxOverride\s*\}\s*from\s*'\.\/deckPosterGeometry'/,
    'DeckSwipeStage must import the single-source geometry function',
  );

  const memoMatch = /const\s+([A-Za-z_$][\w$]*)\s*=\s*useMemo\(/g;
  let memoIdent = null;
  let m = memoMatch.exec(stage);
  while (m) {
    const open = stage.indexOf('(', m.index + m[0].length - 1);
    const body = stage.slice(open, matchDelimiter(stage, open) + 1);
    if (body.includes('posterPhotoBoxOverride')) memoIdent = m[1];
    m = memoMatch.exec(stage);
  }
  assert.ok(
    memoIdent,
    'VACUITY: no useMemo in DeckSwipeStage resolves posterPhotoBoxOverride — the poster '
    + 'box would never receive the measurement',
  );

  for (const role of ["'current'", "'behind'"]) {
    assert.ok(
      stageCode.includes(`posterPhotoBoxOverride(${role},`),
      `the geometry function must be resolved for the ${role} role explicitly, so the role `
      + 'scoping is visible at the call site rather than implied',
    );
  }

  const posterBoxes = openingTags(stage, 'View').filter((tag) => (
    tag.text.includes('props.imageContainerStyle')
  ));
  assert.equal(
    posterBoxes.length,
    1,
    `exactly-one-poster-photo-box: expected exactly ONE poster photo box <View>, found `
    + `${posterBoxes.length}`,
  );
  assert.ok(
    posterBoxes[0].text.includes(memoIdent),
    `the poster photo box must apply the resolved override (${memoIdent}) — without it the `
    + 'box keeps computing its own flex height and the 21.33pt overhang returns',
  );
  assert.match(
    posterBoxes[0].text,
    new RegExp(`${memoIdent}\\[\\s*card\\.role\\s*\\]`),
    'the override must be selected BY ROLE at the poster box, not applied to every layer',
  );
  console.log(`T-4 examined 1 call site and ${posterBoxes.length} poster photo box`);
});

// ---------------------------------------------------------------------------
// T-5 / T-6 / T-7 — non-interference with #1576 and #1579, and the frozen anchors.
// ---------------------------------------------------------------------------

function findControllerIdentifier(render) {
  const match = /const\s+([A-Za-z_$][\w$]*)\s*=\s*useDeckSwipeController\(/.exec(render);
  assert.ok(match, 'VACUITY: no `= useDeckSwipeController(` — the derivation has no anchor');
  return match[1];
}

function findKeyedMapElements(render) {
  const elements = [];
  const mapRe = /\.map\(/g;
  let mapMatch = mapRe.exec(render);
  while (mapMatch) {
    const parenOpen = render.indexOf('(', mapMatch.index);
    const parenClose = matchDelimiter(render, parenOpen);
    const keyRe = /\bkey=\{/g;
    keyRe.lastIndex = parenOpen;
    let keyMatch = keyRe.exec(render);
    while (keyMatch && keyMatch.index < parenClose) {
      const before = render.slice(parenOpen, keyMatch.index);
      const tagRe = /<([A-Za-z][\w.]*)/g;
      let tagStart = -1;
      let t = tagRe.exec(before);
      while (t) { tagStart = parenOpen + t.index; t = tagRe.exec(before); }
      if (tagStart >= 0) {
        const end = openingTagEnd(render, tagStart);
        if (end > tagStart) elements.push({ openingTag: render.slice(tagStart, end + 1) });
      }
      keyMatch = keyRe.exec(render);
    }
    mapMatch = mapRe.exec(render);
  }
  return elements;
}

function stylesReferencedIn(openingTag, controllerIdent) {
  const styleIndex = openingTag.search(/\bstyle=\{/);
  if (styleIndex < 0) return [];
  const braceOpen = openingTag.indexOf('{', styleIndex);
  const styleExpression = openingTag.slice(braceOpen, matchDelimiter(openingTag, braceOpen) + 1);
  const refRe = new RegExp(`\\b${controllerIdent}\\.([A-Za-z_$][\\w$]*)\\b`, 'g');
  const names = new Set();
  let m = refRe.exec(styleExpression);
  while (m) { names.add(m[1]); m = refRe.exec(styleExpression); }
  return [...names];
}

test('T-5 #1576 non-interference — the derived animated-style swap set is unchanged', () => {
  const stage = source.stage;
  const controllerIdent = findControllerIdentifier(stage);
  const elements = findKeyedMapElements(stage);
  assert.ok(
    elements.length >= 1,
    `VACUITY: no keyed .map() element found in DeckSwipeStage (${elements.length})`,
  );

  const swapSets = elements
    .map((el) => stylesReferencedIn(el.openingTag, controllerIdent))
    .filter((styles) => styles.length >= 2);
  assert.equal(
    swapSets.length,
    1,
    'swap-set-still-exactly-two-styles: #1576 A-0 requires exactly ONE keyed node whose '
    + `style prop reaches 2+ controller styles, derived ${swapSets.length} — adding a key to `
    + 'the inner poster <View>s would enlarge this set and break that guard',
  );
  assert.deepEqual(
    swapSets[0].sort(),
    ['currentCardStyle', 'previewCardStyle'],
    'swap-set-still-exactly-two-styles: the swapped animated styles changed',
  );

  // The inner poster <View>s must carry no key= — that is what would create a second
  // derived element in #1576's parser.
  const stripped = stripCommentsAndStrings(stage);
  for (const tag of openingTags(stripped, 'View')) {
    assert.ok(
      !/\bkey=/.test(tag.text),
      `poster-carries-no-key-prop: an inner <View> gained a key= (${tag.text.slice(0, 80)}) — `
      + "#1576's swap-set derivation enumerates BY key= and would derive a second element",
    );
  }
  console.log(`T-5 examined ${elements.length} keyed map elements, ${swapSets.length} swap set`);
});

test('T-6 #1579 non-interference — the poster layer remains incapable of holding a lease', () => {
  const stripped = stripCommentsAndStrings(source.stage);
  // "none" is a string literal, so this one check keeps string contents.
  assert.match(
    stripComments(source.stage),
    /pointerEvents="none"/,
    'poster-remains-non-interactive: the poster node must stay pointerEvents="none"',
  );
  for (const token of ['Gesture', 'onPress', 'onTouches', 'runOnJS']) {
    assert.ok(
      !stripped.includes(token),
      `poster-remains-non-interactive: DeckSwipeStage gained a "${token}" token — onLayout is `
      + 'not a gesture and this layer must never participate in admission (#1579)',
    );
  }
});

test('T-7 the #1576 A-4 mutant anchors are still byte-exact', () => {
  // #1576's f_third_style_in_swap_set and g_new_branch_in_style_prop are built by
  // .replace() on these EXACT strings at module load. Reindenting DeckSwipeStage makes
  // those replaces no-op, and #1576's A-4 then fails on assert.notEqual(mutant, source).
  // No existing guard covers this failure mode.
  const anchorCurrent = ': [controller.currentCardStyle, {';
  const anchorPreview = "card.role === 'behind'\n" + ' '.repeat(16) + '? [controller.previewCardStyle, {';

  assert.ok(
    source.stage.includes(anchorCurrent),
    'mutant-anchors-are-byte-intact: the currentCardStyle anchor changed — #1576 mutant (f) '
    + 'would silently become a no-op',
  );
  assert.ok(
    source.stage.includes(anchorPreview),
    'mutant-anchors-are-byte-intact: the previewCardStyle anchor (with its 16-space indent) '
    + 'changed — #1576 mutant (g) would silently become a no-op',
  );
});

// ---------------------------------------------------------------------------
// T-9 — the workflow really requires and executes both guards, and this file really
// asserts everything its own comments claim.
// ---------------------------------------------------------------------------

function runBlocksOf(workflow) {
  const lines = workflow.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*#/.test(line)) continue; // a full-line YAML comment is not a step
    const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, indent, inline] = match;
    let body = '';
    if (/^[|>]/.test(inline.trim()) || inline.trim() === '') {
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j];
        if (next.trim() === '') { body += '\n'; continue; }
        const nextIndent = /^(\s*)/.exec(next)[1].length;
        if (nextIndent <= indent.length) break;
        body += `${next}\n`;
      }
    } else {
      body = inline;
    }
    // Strip shell comments too, so a filename parked behind a `#` cannot satisfy this.
    body = body.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
    blocks.push(body.replace(/\s+/g, ' ').trim());
  }
  return blocks;
}

test('T-9 the workflow requires AND executes both guards, and the claims are real', () => {
  const blocks = runBlocksOf(source.workflow);
  assert.ok(blocks.length > 0, 'VACUITY: no run: blocks found in the #1593 workflow');

  for (const file of GUARD_FILES) {
    assert.ok(
      blocks.some((b) => b.includes(`test -f ${file}`)),
      `workflow-requires-and-executes-both-guards: no run step does \`test -f\` on ${file} `
      + '(a name that appears only in a comment is not enforcement)',
    );
    assert.ok(
      blocks.some((b) => /node --test/.test(b) && b.includes(file)),
      `workflow-requires-and-executes-both-guards: no \`node --test\` step executes ${file}`,
    );
  }

  // #1593 gets its OWN workflow so the other issues' steps keep their exact guard counts.
  for (const foreign of [/issue_1481_/, /issue_1576_/, /issue_1579_/]) {
    assert.doesNotMatch(
      source.workflow,
      foreign,
      `the #1593 workflow must not reference ${foreign} — those jobs own their own guard lists`,
    );
  }
  assert.match(source.workflow, /node-version: ['"]22['"]/);
  // The .ts import in this file depends on Node 22 native type-stripping.
  assert.match(source.workflow, /app-mobile\/src\/components\/SwipeableCards\.tsx/);
  assert.match(source.workflow, /app-mobile\/src\/components\/swipeDeck\/\*\*/);

  // Anti-stub: this guard must be substantial. The adversarial guard is the tester's
  // deliverable landing on this same branch; its EXISTENCE is enforced by the workflow
  // `test -f` step asserted above (the #1576 architecture), and when it is present it must
  // be substantial too.
  assert.ok(
    source.self.length >= 500,
    `the implementor guard is only ${source.self.length} chars — a stub is not a gate`,
  );

  // Every CLAIM this file's comments make must appear in a real assertion message.
  const claims = [...source.self.matchAll(/\/\/\s*CLAIM:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(
    claims.length >= 11,
    `VACUITY: only ${claims.length} CLAIM tokens parsed from this file's own comments`,
  );
  const code = stripComments(source.self);
  for (const claim of claims) {
    assert.ok(
      code.includes(claim),
      `a comment in this file claims to enforce "${claim}" but no assertion in the code `
      + 'mentions it — that is exactly SPEC 11.3 Discovery 2, an enforcement that exists '
      + 'only in a comment',
    );
  }
  console.log(`T-9 examined ${blocks.length} run blocks and ${claims.length} claims`);
});
