import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Issue #1576 — the promoted deck card renders black.
//
// WHY THIS GUARD ASSERTS THE CAUSE AND NOT THE SYMPTOM.
// The symptom oracle is the mean luminance of the settled card's photo band on a
// running simulator. There is no simulator on a CI runner, so the symptom cannot be
// asserted headlessly. The CAUSE is mechanical and fully checkable from source:
// DeckSwipeStage.tsx swaps ONE keyed, deliberately non-remounting poster node between
// `previewCardStyle` (while behind) and `currentCardStyle` (once current). Reanimated
// writes animated props straight to the native node and does NOT restore properties
// written by a style that has been detached, so any property written by one style and
// absent from the other stays stamped at its last value for the life of the node.
// `previewCardStyle` writes `opacity: 0` at rest; before the fix `currentCardStyle`
// wrote no `opacity` at all, so every promoted poster stayed at opacity 0 — a black card.
//
// THIS GUARD IS DELIBERATELY NOT A TOKEN MATCH. A `/opacity/` regex over the file is the
// unfalsifiable-test shape: a comment, or an unrelated `opacity` in a neighbouring style
// (likeIndicatorStyle and passIndicatorStyle both have one), satisfies it while the bug is
// fully present. Instead this extracts each `useAnimatedStyle` object literal by
// comment-aware brace matching, EVALUATES it in a sandbox with a real clamped
// `interpolate` and the real SWIPE_COMMIT_* constants read from source, and compares the
// resulting property KEY SETS across a sweep of positionX. A commented-out `opacity: 1` is
// invisible to the JS parser and therefore cannot satisfy it — proven by T-6b.
//
// See I-PROPOSED-1576-ANIMATED-STYLE-SWAP-KEY-PARITY in docs/INVARIANT_REGISTRY.md.

const urls = {
  controller: new URL('../useDeckSwipeController.ts', import.meta.url),
  stage: new URL('../DeckSwipeStage.tsx', import.meta.url),
  commit: new URL('../../../utils/swipeCommit.ts', import.meta.url),
  workflow: new URL('../../../../../.github/workflows/issue-1576-deck-promoted-card.yml', import.meta.url),
};

const sourceEntries = await Promise.all(
  Object.entries(urls).map(async ([key, url]) => [key, await readFile(url, 'utf8')]),
);
const source = Object.fromEntries(sourceEntries);

// The two styles that one persistent keyed node can swap between. Derived by NAME here on
// purpose: this is the implementor guard and it asserts the pair it knows. The tester's
// adversarial guard derives the swap set from DeckSwipeStage's render instead, so a future
// third style or new branch is caught by that one rather than this one.
const SWAP_SET = ['currentCardStyle', 'previewCardStyle'];

// Rest, both opacity knees (+/-16), the minDx floor (+/-40), both commit distances
// (+/-120), mid-drag (+/-240), and beyond screen width (+/-500 — the exit range, where a
// committed card flies off). A property that is correct at rest but wrong during the exit
// would still be a black card mid-flight.
const SWEEP = [-500, -240, -120, -40, -16, -1, 0, 1, 16, 40, 120, 240, 500];

const SCREEN_WIDTH = 402; // iPhone 17 logical width; the oracle sim for this issue.

// ---------------------------------------------------------------------------
// Real constants, read from the real module. Hardcoding them here would let the
// guard silently drift away from the thresholds the product actually animates on.
// ---------------------------------------------------------------------------
function readConstant(name) {
  const match = source.commit.match(new RegExp(`export const ${name} = (-?[0-9.]+)`));
  assert.ok(match, `VACUITY: ${name} not found in swipeCommit.ts — the guard cannot calibrate`);
  return Number(match[1]);
}

const SWIPE_COMMIT_DISTANCE = readConstant('SWIPE_COMMIT_DISTANCE');
const SWIPE_COMMIT_MIN_DX = readConstant('SWIPE_COMMIT_MIN_DX');

// ---------------------------------------------------------------------------
// Comment- and string-aware brace matching.
//
// A naive brace counter reads braces inside comments and template literals. The rotate
// term is a template literal containing `${...}`, and the fix ships an explanatory comment
// INSIDE the object literal, so both cases are live in this exact file. Templates are
// treated as opaque to the closing backtick (no nested-template case exists on this path).
// ---------------------------------------------------------------------------
function matchingBraceIndex(src, openIndex) {
  assert.equal(src[openIndex], '{', 'matchingBraceIndex must start on an opening brace');
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
      if (c === '{') { depth += 1; continue; }
      if (c === '}') {
        depth -= 1;
        if (depth === 0) return i;
      }
      continue;
    }
    if (state === 'line') {
      if (c === '\n') state = 'code';
      continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; i += 1; }
      continue;
    }
    if (c === '\\') { i += 1; continue; }
    if (state === 'squote' && c === "'") state = 'code';
    else if (state === 'dquote' && c === '"') state = 'code';
    else if (state === 'template' && c === '`') state = 'code';
  }
  throw new Error('unbalanced braces while extracting a style body');
}

function extractStyleBody(src, name) {
  const declaration = new RegExp(
    `const\\s+${name}\\s*=\\s*useAnimatedStyle\\(\\s*\\(\\s*\\)\\s*=>\\s*\\(\\s*\\{`,
  );
  const match = declaration.exec(src);
  assert.ok(match, `VACUITY: could not locate ${name} — the guard would pass by finding nothing`);
  const open = match.index + match[0].length - 1; // the '{' of the returned object literal
  const close = matchingBraceIndex(src, open);
  const body = src.slice(open, close + 1);
  assert.ok(body.length > 20, `VACUITY: extracted ${name} body is implausibly short`);
  return body;
}

// ---------------------------------------------------------------------------
// Worklet sandbox: real clamped linear interpolate, stubbed shared values.
// ---------------------------------------------------------------------------
function interpolate(x, inputRange, outputRange) {
  if (x <= inputRange[0]) return outputRange[0];
  if (x >= inputRange[inputRange.length - 1]) return outputRange[outputRange.length - 1];
  for (let i = 0; i < inputRange.length - 1; i += 1) {
    if (x >= inputRange[i] && x <= inputRange[i + 1]) {
      const t = (x - inputRange[i]) / (inputRange[i + 1] - inputRange[i]);
      return outputRange[i] + t * (outputRange[i + 1] - outputRange[i]);
    }
  }
  throw new Error('interpolate: unreachable');
}

function evalStyle(body, positionXValue) {
  const positionX = { value: positionXValue };
  const positionY = { value: 0 };
  const options = { screenWidth: SCREEN_WIDTH };
  const Extrapolation = { CLAMP: 'clamp' };
  const fn = new Function(
    'positionX', 'positionY', 'options', 'interpolate', 'Extrapolation',
    'SWIPE_COMMIT_DISTANCE', 'SWIPE_COMMIT_MIN_DX',
    `return (${body});`,
  );
  const result = fn(
    positionX, positionY, options, interpolate, Extrapolation,
    SWIPE_COMMIT_DISTANCE, SWIPE_COMMIT_MIN_DX,
  );
  assert.ok(
    result && typeof result === 'object',
    'VACUITY: a style body evaluated to a non-object',
  );
  return result;
}

const keysAt = (body, x) => Object.keys(evalStyle(body, x)).sort().join(',');

// ---------------------------------------------------------------------------
// THE CHECKER. Runs over any source text, so the negative controls in T-6 run the
// exact same code path the real assertions do. Returns the list of violations.
// ---------------------------------------------------------------------------
function checkSource(src) {
  const failures = [];
  const bodies = SWAP_SET.map((name) => [name, extractStyleBody(src, name)]);

  // Each style's key set must be position-invariant. This is what kills a
  // conditionally-spread property such as `...(positionX.value !== 0 && { opacity: 1 })`,
  // which would satisfy a naive at-rest check while leaving the promoted node
  // unstamped at exactly the position that matters.
  for (const [name, body] of bodies) {
    const sets = new Set(SWEEP.map((x) => keysAt(body, x)));
    if (sets.size !== 1) {
      failures.push(`${name} key set varies with positionX: ${[...sets].join(' | ')}`);
    }
  }

  // THE INVARIANT: every style in the swap set writes the same property keys.
  for (const x of SWEEP) {
    const sets = bodies.map(([name, body]) => `${name}={${keysAt(body, x)}}`);
    const distinct = new Set(bodies.map(([, body]) => keysAt(body, x)));
    if (distinct.size !== 1) {
      failures.push(`key-set mismatch at positionX=${x}: ${sets.join(' ')}`);
      break;
    }
  }

  // Behavioural pin: the promoted card is fully opaque at every position, including
  // the off-screen exit range.
  const currentBody = bodies.find(([name]) => name === 'currentCardStyle')[1];
  for (const x of SWEEP) {
    const value = evalStyle(currentBody, x).opacity;
    if (value !== 1) {
      failures.push(`currentCardStyle.opacity=${value} at positionX=${x}, expected 1`);
      break;
    }
  }

  return failures;
}

const realBodies = Object.fromEntries(
  SWAP_SET.map((name) => [name, extractStyleBody(source.controller, name)]),
);

test('T-0 the swap set this guard asserts is the one the stage actually swaps', () => {
  // Not a derivation (that is the adversarial guard's job) — a cheap anchor so this guard
  // cannot keep passing about a pair the product no longer uses.
  assert.match(source.stage, /props\.posterCards\.map\(/);
  assert.match(source.stage, /key=\{card\.id\}/);
  for (const name of SWAP_SET) {
    assert.match(
      source.stage,
      new RegExp(`controller\\.${name}`),
      `${name} is no longer attached in DeckSwipeStage — this guard is asserting a dead pair`,
    );
  }
  assert.ok(SWEEP.length >= 13, 'VACUITY: the position sweep was emptied');
});

test('T-1 currentCardStyle writes opacity 1 at every swept position', () => {
  const observed = SWEEP.map((x) => evalStyle(realBodies.currentCardStyle, x).opacity);
  assert.deepEqual(
    observed,
    SWEEP.map(() => 1),
    'the promoted poster must be explicitly opaque at rest, mid-drag and off-screen',
  );
});

test('T-2 the preview ramp is preserved and was not flattened by the fix', () => {
  const preview = realBodies.previewCardStyle;
  assert.equal(evalStyle(preview, 0).opacity, 0, 'behind card is invisible at rest');
  assert.equal(evalStyle(preview, SWIPE_COMMIT_DISTANCE).opacity, 1, 'fully revealed at +commit');
  assert.equal(evalStyle(preview, -SWIPE_COMMIT_DISTANCE).opacity, 1, 'fully revealed at -commit');
  // The ramp is monotonic away from rest, so the behind card genuinely fades in.
  assert.ok(evalStyle(preview, 16).opacity > evalStyle(preview, 0).opacity);
  assert.ok(evalStyle(preview, SWIPE_COMMIT_MIN_DX).opacity > evalStyle(preview, 16).opacity);
});

test('T-3 the two role-swappable styles have identical key sets at every swept position', () => {
  for (const x of SWEEP) {
    assert.equal(
      keysAt(realBodies.currentCardStyle, x),
      keysAt(realBodies.previewCardStyle, x),
      `key-set asymmetry at positionX=${x} — a property written by one style and not the `
      + 'other stays stamped on the promoted node forever',
    );
  }
  assert.equal(keysAt(realBodies.currentCardStyle, 0), 'opacity,transform');
});

test('T-4 each style key set is position-invariant (no conditionally spread property)', () => {
  for (const name of SWAP_SET) {
    const sets = new Set(SWEEP.map((x) => keysAt(realBodies[name], x)));
    assert.equal(
      sets.size,
      1,
      `${name} omits a property at some positions: ${[...sets].join(' | ')}`,
    );
  }
});

test('T-5 the transform terms are unchanged by the fix', () => {
  for (const name of SWAP_SET) {
    const style = evalStyle(realBodies[name], 40);
    assert.ok(Array.isArray(style.transform), `${name}.transform must still be an array`);
  }
  const current = evalStyle(realBodies.currentCardStyle, 40);
  assert.equal(current.transform.length, 3, 'translateX, translateY, rotate');
  assert.equal(current.transform[0].translateX, 40);
  assert.equal(current.transform[1].translateY, 0);
  // The rotate interpolation still clamps to +/-12deg at half the screen width.
  assert.equal(evalStyle(realBodies.currentCardStyle, SCREEN_WIDTH / 2).transform[2].rotate, '12deg');
  assert.equal(evalStyle(realBodies.currentCardStyle, -SCREEN_WIDTH / 2).transform[2].rotate, '-12deg');
  assert.equal(evalStyle(realBodies.currentCardStyle, 0).transform[2].rotate, '0deg');
  assert.equal(evalStyle(realBodies.previewCardStyle, 0).transform.length, 1, 'scale only');
  assert.equal(evalStyle(realBodies.previewCardStyle, 0).transform[0].scale, 0.965);
});

test('T-6 the real source passes and both negative controls are rejected', () => {
  assert.deepEqual(checkSource(source.controller), [], 'the shipped source must pass');

  // T-6a — a synthetic copy of the PRE-FIX shape: currentCardStyle omits opacity entirely.
  // This is the exact defect that shipped, and the checker must reject it.
  const preFix = [
    'const currentCardStyle = useAnimatedStyle(() => ({',
    '  transform: [',
    '    { translateX: positionX.value },',
    '    { translateY: positionY.value },',
    "    { rotate: interpolate(positionX.value, [-options.screenWidth / 2, "
      + '-SWIPE_COMMIT_DISTANCE, 0, SWIPE_COMMIT_DISTANCE, options.screenWidth / 2], '
      + "[-12, -6, 0, 6, 12], Extrapolation.CLAMP) + 'deg' },",
    '  ],',
    '}), [options.screenWidth]);',
    'const previewCardStyle = useAnimatedStyle(() => ({',
    '  opacity: interpolate(positionX.value, [-SWIPE_COMMIT_DISTANCE, -16, 0, 16, '
      + 'SWIPE_COMMIT_DISTANCE], [1, 0.12, 0, 0.12, 1], Extrapolation.CLAMP),',
    '  transform: [{ scale: interpolate(positionX.value, [-SWIPE_COMMIT_DISTANCE, 0, '
      + 'SWIPE_COMMIT_DISTANCE], [1, 0.965, 1], Extrapolation.CLAMP) }],',
    '}));',
  ].join('\n');

  const preFixFailures = checkSource(preFix);
  assert.ok(preFixFailures.length > 0, 'the pre-fix shape must be rejected');
  assert.ok(
    preFixFailures.some((line) => line.includes('key-set mismatch')),
    `expected a key-set mismatch, got: ${preFixFailures.join(' | ')}`,
  );
  assert.ok(
    preFixFailures.some((line) => line.includes('currentCardStyle.opacity=undefined')),
    `expected an undefined-opacity failure, got: ${preFixFailures.join(' | ')}`,
  );

  // T-6b — THE TOKEN-MATCH CONTROL. `opacity: 1` is present in the file, and even inside
  // the object literal, but only as a comment. A `/opacity/` grep passes this. The
  // evaluating checker must still reject it, because the JS parser never sees it.
  const commentedOut = preFix.replace(
    'const currentCardStyle = useAnimatedStyle(() => ({',
    'const currentCardStyle = useAnimatedStyle(() => ({\n  // opacity: 1,',
  );
  assert.match(commentedOut, /opacity: 1/, 'the control must satisfy a naive token match');
  const commentedFailures = checkSource(commentedOut);
  assert.ok(
    commentedFailures.some((line) => line.includes('currentCardStyle.opacity=undefined')),
    `a commented-out fix must be rejected, got: ${commentedFailures.join(' | ')}`,
  );
});

test('T-7 the issue workflow requires and executes both #1576 guards', () => {
  for (const filename of [
    'issue_1576_promoted_card_opacity.test.mjs',
    'issue_1576_promoted_card_opacity.adversarial.test.mjs',
  ]) {
    assert.match(source.workflow, new RegExp(filename.replaceAll('.', '\\.')));
  }
  assert.match(source.workflow, /test -f/);
  assert.match(source.workflow, /node --test/);
  // #1576 gets its own workflow precisely so #1481's "all eight" step stays exactly eight.
  assert.doesNotMatch(source.workflow, /issue_1481_/);
});
