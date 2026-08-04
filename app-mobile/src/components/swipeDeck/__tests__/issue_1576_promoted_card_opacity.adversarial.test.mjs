import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Issue #1576 — TESTER ADVERSARIAL GUARD (SPEC section 8.2).
//
// HOW THIS DIFFERS FROM THE IMPLEMENTOR GUARD, AND WHY THAT MATTERS.
// issue_1576_promoted_card_opacity.test.mjs asserts a pair it knows BY NAME
// (`SWAP_SET = ['currentCardStyle', 'previewCardStyle']`). That is correct today and
// worthless tomorrow: if someone adds a THIRD animated style to the same keyed poster
// node, or adds a new conditional branch to its `style` prop, the hardcoded pair keeps
// passing while a brand-new asymmetry ships. The defect class in
// I-PROPOSED-1576-ANIMATED-STYLE-SWAP-KEY-PARITY is a property of the RENDER, so this
// guard reads the render.
//
// It therefore attacks three axes the implementor guard does not:
//
//   1. DERIVATION, not declaration. The swap set is discovered by parsing
//      DeckSwipeStage.tsx: find elements rendered inside a `.map()` that carry a stable
//      `key={...}`, walk EVERY branch of their `style` prop, and collect every controller
//      animated style referenced there. Whatever that yields is what gets parity-checked.
//      A third style or a new branch is caught automatically (test A-4 proves it, and
//      proves the hardcoded-pair approach misses it).
//
//   2. MUTATION TESTING OF THE CHECKER ITSELF. A guard nobody has tried to fool has
//      unknown discriminating power. A-3 and A-4 synthesize nine mutants — including the
//      five named in SPEC 8.2.2 — and require this checker to reject every one, each with
//      a specific failure signature. A checker that accepts any mutant fails the suite.
//
//   3. THE WIRING, PARSED STRUCTURALLY WITH COMMENTS STRIPPED. The implementor's T-7
//      asserts each guard filename appears SOMEWHERE in the workflow text. The workflow's
//      own explanatory comment block names the adversarial guard, so T-7 is satisfied by
//      that comment alone: delete both real references and T-7 still passes. A-5 parses
//      the `run:` blocks with comments removed and requires each guard to be BOTH
//      `test -f`'d AND passed to `node --test`, and its negative control (A-5b) is exactly
//      the workflow-with-comment-only mutant that a text search accepts.
//
// Runtime brightness (SC-1) is NOT asserted here — there is no simulator on a CI runner.
// It was measured separately by the tester on iOS and Android; this file guards the CAUSE.

const urls = {
  controller: new URL('../useDeckSwipeController.ts', import.meta.url),
  stage: new URL('../DeckSwipeStage.tsx', import.meta.url),
  commit: new URL('../../../utils/swipeCommit.ts', import.meta.url),
  workflow: new URL(
    '../../../../../.github/workflows/issue-1576-deck-promoted-card.yml',
    import.meta.url,
  ),
};

const sourceEntries = await Promise.all(
  Object.entries(urls).map(async ([key, url]) => [key, await readFile(url, 'utf8')]),
);
const source = Object.fromEntries(sourceEntries);

const GUARD_FILES = [
  'app-mobile/src/components/swipeDeck/__tests__/issue_1576_promoted_card_opacity.test.mjs',
  'app-mobile/src/components/swipeDeck/__tests__/'
    + 'issue_1576_promoted_card_opacity.adversarial.test.mjs',
];

const SCREEN_WIDTH = 402;

// ---------------------------------------------------------------------------
// A denser, deliberately different sweep than the implementor's 13 fixed points.
// Uniform coverage catches a conditional that only bites at an odd offset, and the
// seeded pseudo-random points catch one tuned to dodge round numbers. Seeded, so CI is
// deterministic.
// ---------------------------------------------------------------------------
function buildSweep() {
  const points = new Set();
  for (let x = -600; x <= 600; x += 25) points.add(x);
  for (const knee of [1, 15, 16, 17, 39, 40, 41, 119, 120, 121, SCREEN_WIDTH / 2]) {
    points.add(knee);
    points.add(-knee);
  }
  points.add(0);
  let seed = 1576;
  for (let i = 0; i < 24; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    points.add(Math.round(((seed / 2147483648) * 1200 - 600) * 100) / 100);
  }
  return [...points].sort((a, b) => a - b);
}

const SWEEP = buildSweep();

// ---------------------------------------------------------------------------
// Delimiter matching that is aware of comments, strings and template literals.
// All three are live on this path: the fix ships a comment INSIDE the object literal,
// and the rotate term is a template literal containing `${...}`.
// ---------------------------------------------------------------------------
const CLOSERS = { '{': '}', '[': ']', '(': ')' };

function matchDelimiter(src, openIndex) {
  const open = src[openIndex];
  const close = CLOSERS[open];
  assert.ok(close, `matchDelimiter must start on one of { [ ( — got ${JSON.stringify(open)}`);
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
  throw new Error('unbalanced delimiters while parsing');
}

// ---------------------------------------------------------------------------
// STEP 1 — DERIVE THE SWAP SET FROM THE RENDER.
//
// A swap set is the group of controller animated styles that can be attached, at
// different times, to ONE persistent host node. A node is persistent when it is rendered
// from a `.map()` under a stable `key`, because React then reconciles it by key across
// re-renders instead of remounting it. Every controller style reachable from any branch
// of that node's `style` prop is in the set.
// ---------------------------------------------------------------------------
function findControllerIdentifier(render) {
  const match = /const\s+([A-Za-z_$][\w$]*)\s*=\s*useDeckSwipeController\(/.exec(render);
  assert.ok(
    match,
    'VACUITY: no `= useDeckSwipeController(` in the render — the derivation has no anchor '
    + 'and every parity assertion below would pass by finding nothing',
  );
  return match[1];
}

function findKeyedMapElements(render) {
  const elements = [];
  const mapRe = /\.map\(/g;
  let mapMatch = mapRe.exec(render);
  while (mapMatch) {
    const parenOpen = render.indexOf('(', mapMatch.index);
    const parenClose = matchDelimiter(render, parenOpen);
    const region = { start: parenOpen, end: parenClose };

    const keyRe = /\bkey=\{/g;
    keyRe.lastIndex = region.start;
    let keyMatch = keyRe.exec(render);
    while (keyMatch && keyMatch.index < region.end) {
      // Walk back to the `<Tag` that opens the element carrying this key.
      const before = render.slice(region.start, keyMatch.index);
      const tagRe = /<([A-Za-z][\w.]*)/g;
      let tagStart = -1;
      let tagName = null;
      let t = tagRe.exec(before);
      while (t) {
        tagStart = region.start + t.index;
        tagName = t[1];
        t = tagRe.exec(before);
      }
      if (tagStart >= 0) {
        // Forward to the `>` that closes the opening tag, ignoring `>` inside
        // attribute expressions, strings and comments.
        let depth = 0;
        let end = -1;
        let state = 'code';
        for (let i = tagStart; i < render.length; i += 1) {
          const c = render[i];
          const d = render[i + 1];
          if (state === 'code') {
            if (c === '/' && d === '/') { state = 'line'; i += 1; continue; }
            if (c === '/' && d === '*') { state = 'block'; i += 1; continue; }
            if (c === "'") { state = 'squote'; continue; }
            if (c === '"') { state = 'dquote'; continue; }
            if (c === '`') { state = 'template'; continue; }
            if (c === '{') { depth += 1; continue; }
            if (c === '}') { depth -= 1; continue; }
            if (c === '>' && depth === 0) { end = i; break; }
            continue;
          }
          if (state === 'line') { if (c === '\n') state = 'code'; continue; }
          if (state === 'block') { if (c === '*' && d === '/') { state = 'code'; i += 1; } continue; }
          if (c === '\\') { i += 1; continue; }
          if (state === 'squote' && c === "'") state = 'code';
          else if (state === 'dquote' && c === '"') state = 'code';
          else if (state === 'template' && c === '`') state = 'code';
        }
        if (end > tagStart) {
          const openingTag = render.slice(tagStart, end + 1);
          const keyExpressionStart = render.indexOf('{', keyMatch.index);
          const keyExpression = render.slice(
            keyExpressionStart + 1,
            matchDelimiter(render, keyExpressionStart),
          ).trim();
          elements.push({ tagName, openingTag, keyExpression });
        }
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
  const styleExpression = openingTag.slice(
    braceOpen,
    matchDelimiter(openingTag, braceOpen) + 1,
  );
  const refRe = new RegExp(`\\b${controllerIdent}\\.([A-Za-z_$][\\w$]*)\\b`, 'g');
  const names = new Set();
  let m = refRe.exec(styleExpression);
  while (m) {
    names.add(m[1]);
    m = refRe.exec(styleExpression);
  }
  return [...names];
}

function deriveSwapSets(render) {
  const controllerIdent = findControllerIdentifier(render);
  const sets = [];
  for (const element of findKeyedMapElements(render)) {
    const styles = stylesReferencedIn(element.openingTag, controllerIdent);
    if (styles.length >= 2) {
      sets.push({ ...element, styles: styles.sort() });
    }
  }
  return sets;
}

// ---------------------------------------------------------------------------
// STEP 2 — EVALUATE THE DERIVED STYLES AND COMPARE KEY SETS.
// ---------------------------------------------------------------------------
function readConstant(name) {
  const match = source.commit.match(new RegExp(`export const ${name} = (-?[0-9.]+)`));
  assert.ok(match, `VACUITY: ${name} missing from swipeCommit.ts — the sandbox is uncalibrated`);
  return Number(match[1]);
}

const SWIPE_COMMIT_DISTANCE = readConstant('SWIPE_COMMIT_DISTANCE');
const SWIPE_COMMIT_MIN_DX = readConstant('SWIPE_COMMIT_MIN_DX');

function extractStyleBody(controllerSource, name) {
  const declaration = new RegExp(
    `const\\s+${name}\\s*=\\s*useAnimatedStyle\\(\\s*\\(\\s*\\)\\s*=>\\s*\\(\\s*\\{`,
  );
  const match = declaration.exec(controllerSource);
  assert.ok(
    match,
    `VACUITY: ${name} is referenced by the render but has no useAnimatedStyle declaration `
    + '— the parity check would silently cover nothing',
  );
  const open = match.index + match[0].length - 1;
  return controllerSource.slice(open, matchDelimiter(controllerSource, open) + 1);
}

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
  const fn = new Function(
    'positionX', 'positionY', 'options', 'interpolate', 'Extrapolation',
    'SWIPE_COMMIT_DISTANCE', 'SWIPE_COMMIT_MIN_DX',
    `return (${body});`,
  );
  const result = fn(
    { value: positionXValue }, { value: 0 }, { screenWidth: SCREEN_WIDTH },
    interpolate, { CLAMP: 'clamp' }, SWIPE_COMMIT_DISTANCE, SWIPE_COMMIT_MIN_DX,
  );
  assert.ok(result && typeof result === 'object', 'VACUITY: a style body evaluated to a non-object');
  return result;
}

const keysAt = (body, x) => Object.keys(evalStyle(body, x)).sort().join(',');

// THE CHECKER. Takes a render source and a controller source, derives the swap sets from
// the former, evaluates them out of the latter, and returns every violation found.
// Mutants run through this exact function, so the negative controls exercise the same code
// path as the real assertions.
function checkParity(renderSource, controllerSource) {
  const failures = [];
  const swapSets = deriveSwapSets(renderSource);

  if (swapSets.length === 0) {
    failures.push('no swap set derived from the render');
    return failures;
  }

  for (const swapSet of swapSets) {
    const bodies = swapSet.styles.map((name) => [name, extractStyleBody(controllerSource, name)]);

    // Each style's own key set must not depend on position. This is what kills
    // `...(positionX.value !== 0 && { opacity: 1 })`, which satisfies an at-rest check
    // while leaving the node unstamped at exactly the position that matters — rest.
    for (const [name, body] of bodies) {
      const sets = new Set(SWEEP.map((x) => keysAt(body, x)));
      if (sets.size !== 1) {
        failures.push(`${name} key set varies with positionX: ${[...sets].join(' | ')}`);
      }
    }

    // THE INVARIANT, checked pairwise and in BOTH directions, over the DERIVED set.
    // Bidirectional because a demotion (current -> behind on the same node) is reachable:
    // SwipeableCards restores a non-monotonic currentCardIndex on DeckContext change
    // (setCurrentCardIndex(state.currentCardIndex), setCurrentCardIndex(restoredIndex)),
    // so a card that is `current` can become `nextRec` and be re-rendered as `behind`
    // under the same key. Parity must therefore hold in both directions, not just for the
    // promotion that produced #1576.
    for (const x of SWEEP) {
      for (const [nameA, bodyA] of bodies) {
        for (const [nameB, bodyB] of bodies) {
          if (nameA === nameB) continue;
          const keysA = new Set(Object.keys(evalStyle(bodyA, x)));
          const keysB = new Set(Object.keys(evalStyle(bodyB, x)));
          const orphaned = [...keysA].filter((k) => !keysB.has(k));
          if (orphaned.length > 0) {
            failures.push(
              `key-set mismatch at positionX=${x}: ${nameA} writes {${orphaned.join(',')}} `
              + `which ${nameB} never writes — swapping ${nameA} -> ${nameB} leaves it stamped`,
            );
          }
        }
      }
      if (failures.length > 0) break;
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Mutant sources. The controller mutants are built by editing the REAL controller text,
// so they stay faithful to the shipped shape.
// ---------------------------------------------------------------------------
const realCurrentBody = extractStyleBody(source.controller, 'currentCardStyle');
const realPreviewBody = extractStyleBody(source.controller, 'previewCardStyle');

function replaceBody(controllerSource, name, newBody) {
  const old = extractStyleBody(controllerSource, name);
  return controllerSource.replace(old, newBody);
}

const mutants = {
  // SPEC 8.2.2(a) — the exact defect that shipped.
  a_opacity_deleted: {
    render: source.stage,
    controller: replaceBody(
      source.controller,
      'currentCardStyle',
      realCurrentBody.replace(/^\s*opacity: 1,$/m, ''),
    ),
    expect: /key-set mismatch/,
  },
  // SPEC 8.2.2(b) — a property added to previewCardStyle only. The asymmetry is now in
  // the OTHER direction, which a one-way check would miss.
  b_preview_only_property: {
    render: source.stage,
    controller: replaceBody(
      source.controller,
      'previewCardStyle',
      realPreviewBody.replace('{', '{\n    borderRadius: 24,'),
    ),
    expect: /previewCardStyle writes \{borderRadius\}/,
  },
  // SPEC 8.2.2(c) — conditionally spread, present everywhere EXCEPT rest.
  c_conditional_opacity: {
    render: source.stage,
    controller: replaceBody(
      source.controller,
      'currentCardStyle',
      realCurrentBody.replace(
        /^\s*opacity: 1,$/m,
        '    ...(positionX.value !== 0 && { opacity: 1 }),',
      ),
    ),
    expect: /key set varies with positionX/,
  },
  // SPEC 8.2.2(d) — transform dropped from previewCardStyle.
  d_transform_dropped: {
    render: source.stage,
    controller: replaceBody(
      source.controller,
      'previewCardStyle',
      realPreviewBody.replace(/transform: \[\{[\s\S]*?\}\],/, ''),
    ),
    expect: /key-set mismatch/,
  },
  // SPEC 8.2.2(e) — the token-match control: `opacity: 1` present, but commented out.
  // A /opacity/ grep over the file passes this. The evaluator never sees it.
  e_opacity_commented_out: {
    render: source.stage,
    controller: replaceBody(
      source.controller,
      'currentCardStyle',
      realCurrentBody.replace(/^\s*opacity: 1,$/m, '    // opacity: 1,'),
    ),
    expect: /key-set mismatch/,
  },
  // TESTER ADDITION (f) — a THIRD style joins the same keyed node, asymmetric. The
  // implementor's hardcoded pair cannot see this; the derived set must.
  f_third_style_in_swap_set: {
    render: source.stage.replace(
      ': [controller.currentCardStyle, {',
      ': [controller.currentCardStyle, controller.settleCardStyle, {',
    ),
    controller: `${source.controller}\n`
      + 'const settleCardStyle = useAnimatedStyle(() => ({\n'
      + '  transform: [{ scale: 1 }],\n'
      + '}));\n',
    expect: /key-set mismatch/,
  },
  // TESTER ADDITION (g) — a new conditional BRANCH inside the existing style prop,
  // rather than a new element. Same blind spot, different shape.
  g_new_branch_in_style_prop: {
    render: source.stage.replace(
      'card.role === \'behind\'\n                ? [controller.previewCardStyle, {',
      'card.role === \'settling\'\n                ? [controller.settleCardStyle, { zIndex: 1 }]\n'
      + '                : card.role === \'behind\'\n                ? [controller.previewCardStyle, {',
    ),
    controller: `${source.controller}\n`
      + 'const settleCardStyle = useAnimatedStyle(() => ({\n'
      + '  opacity: 1,\n'
      + '}));\n',
    expect: /key-set mismatch/,
  },
  // TESTER ADDITION (h) — opacity present but not 1 at every position. Parity alone is
  // satisfied (both write opacity); the promoted card would still be dimmed to nothing at
  // rest. Catches a "fix" that restores the key but not the value.
  h_opacity_zero_at_rest: {
    render: source.stage,
    controller: replaceBody(
      source.controller,
      'currentCardStyle',
      realCurrentBody.replace(
        /^\s*opacity: 1,$/m,
        '    opacity: interpolate(positionX.value, [-1, 0, 1], [1, 0, 1], Extrapolation.CLAMP),',
      ),
    ),
    expect: /currentCardStyle\.opacity/,
  },
};

// Mutant (h) is a VALUE defect, not a key defect, so the key-parity checker alone cannot
// see it. The behavioural pin below is what catches it, and it is applied to whatever the
// derivation says is the promoted style.
function checkPromotedOpacityValue(renderSource, controllerSource) {
  const failures = [];
  const swapSets = deriveSwapSets(renderSource);
  for (const swapSet of swapSets) {
    for (const name of swapSet.styles) {
      if (!/^current/.test(name)) continue;
      const body = extractStyleBody(controllerSource, name);
      for (const x of SWEEP) {
        const value = evalStyle(body, x).opacity;
        if (value !== 1) {
          failures.push(`${name}.opacity=${value} at positionX=${x}, expected 1`);
          break;
        }
      }
    }
  }
  return failures;
}

const checkAll = (renderSource, controllerSource) => [
  ...checkParity(renderSource, controllerSource),
  ...checkPromotedOpacityValue(renderSource, controllerSource),
];

// ---------------------------------------------------------------------------
// STEP 3 — THE WORKFLOW, PARSED STRUCTURALLY WITH COMMENTS STRIPPED.
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

function checkWorkflowWiring(workflow) {
  const failures = [];
  const blocks = runBlocksOf(workflow);
  if (blocks.length === 0) failures.push('no run: blocks found in the workflow');
  for (const file of GUARD_FILES) {
    if (!blocks.some((b) => b.includes(`test -f ${file}`))) {
      failures.push(`no run step does \`test -f\` on ${file}`);
    }
    if (!blocks.some((b) => /node --test/.test(b) && b.includes(file))) {
      failures.push(`no \`node --test\` run step executes ${file}`);
    }
  }
  return failures;
}

// ===========================================================================
// TESTS
// ===========================================================================

test('A-0 the derivation is anchored in a real, persistent, role-swapping node', () => {
  const swapSets = deriveSwapSets(source.stage);
  assert.equal(
    swapSets.length,
    1,
    `expected exactly one keyed .map() node whose style prop reaches 2+ controller styles, `
    + `derived ${swapSets.length}: ${JSON.stringify(swapSets.map((s) => s.styles))}`,
  );
  const [swapSet] = swapSets;

  assert.ok(
    swapSet.styles.length >= 2,
    'VACUITY: the derived swap set has fewer than 2 styles — nothing to compare',
  );

  // The parity requirement exists ONLY because this node survives the role change. If the
  // key ever became role-dependent the node would remount, and the rationale recorded in
  // I-PROPOSED-1576-ANIMATED-STYLE-SWAP-KEY-PARITY would no longer describe this render.
  assert.doesNotMatch(
    swapSet.keyExpression,
    /role/,
    'the poster key became role-dependent — the node would now remount on promotion, so '
    + 'this guard is no longer describing the shipped architecture and must be revisited',
  );

  assert.ok(SWEEP.length >= 80, `VACUITY: the sweep collapsed to ${SWEEP.length} points`);
});

test('A-1 every style in the DERIVED swap set has identical key sets, both directions', () => {
  assert.deepEqual(
    checkParity(source.stage, source.controller),
    [],
    'the shipped render + controller must be key-symmetric across the derived swap set',
  );
});

test('A-2 the promoted style is fully opaque at every swept position', () => {
  assert.deepEqual(
    checkPromotedOpacityValue(source.stage, source.controller),
    [],
    'the promoted poster must be opaque at rest, mid-drag and beyond screen width',
  );
});

test('A-3 the checker rejects every SPEC 8.2.2 controller mutant', () => {
  for (const name of [
    'a_opacity_deleted',
    'b_preview_only_property',
    'c_conditional_opacity',
    'd_transform_dropped',
    'e_opacity_commented_out',
    'h_opacity_zero_at_rest',
  ]) {
    const mutant = mutants[name];
    const failures = checkAll(mutant.render, mutant.controller);
    assert.ok(
      failures.length > 0,
      `mutant ${name} was ACCEPTED by the checker — the guard has no discriminating power`,
    );
    assert.ok(
      failures.some((line) => mutant.expect.test(line)),
      `mutant ${name} was rejected for the wrong reason. expected ${mutant.expect}, got: `
      + failures.join(' | '),
    );
  }
});

test('A-4 a third style or a new branch is caught ONLY because the set is derived', () => {
  for (const name of ['f_third_style_in_swap_set', 'g_new_branch_in_style_prop']) {
    const mutant = mutants[name];

    // The mutant really did change the render — otherwise this test is vacuous.
    assert.notEqual(mutant.render, source.stage, `mutant ${name} did not modify the render`);

    // The derivation must SEE the new style.
    const derived = deriveSwapSets(mutant.render);
    assert.ok(
      derived.some((s) => s.styles.includes('settleCardStyle')),
      `the derivation missed the third style in ${name}: `
      + JSON.stringify(derived.map((s) => s.styles)),
    );

    const failures = checkAll(mutant.render, mutant.controller);
    assert.ok(
      failures.some((line) => mutant.expect.test(line)),
      `mutant ${name} was not rejected: ${failures.join(' | ') || '(no failures at all)'}`,
    );

    // THE POINT OF THIS FILE: a guard that asserts the hardcoded pair sees nothing wrong
    // here, because currentCardStyle and previewCardStyle are still perfectly symmetric.
    const hardcodedPairStillClean = ['currentCardStyle', 'previewCardStyle'].every((styleName) => {
      const body = extractStyleBody(mutant.controller, styleName);
      return keysAt(body, 0) === 'opacity,transform';
    });
    assert.ok(
      hardcodedPairStillClean,
      `${name} should be invisible to a hardcoded-pair guard — if it is not, this test is `
      + 'no longer demonstrating the gap it exists to demonstrate',
    );
  }
});

test('A-5 the workflow requires AND executes both guards', () => {
  assert.deepEqual(
    checkWorkflowWiring(source.workflow),
    [],
    'the enforcement workflow must test -f and node --test both guard files',
  );
});

test('A-5b a workflow that only MENTIONS a guard in a comment is rejected', () => {
  // This is the implementor guard's T-7 blind spot, made concrete. T-7 asserts each
  // filename appears somewhere in the workflow text, and the workflow's own NOTE comment
  // names the adversarial guard — so both real references can be deleted while T-7 stays
  // green and the gate silently stops running this file.
  const adversarial = GUARD_FILES[1];
  const unwired = source.workflow
    .split('\n')
    .filter((line) => /^\s*#/.test(line) || !line.includes(adversarial))
    .join('\n');

  assert.ok(
    unwired.includes('issue_1576_promoted_card_opacity.adversarial.test.mjs'),
    'the control must still MENTION the adversarial guard, in a comment, or it proves nothing',
  );
  assert.ok(
    !runBlocksOf(unwired).some((b) => b.includes(adversarial)),
    'the control must have no executable reference left',
  );

  const failures = checkWorkflowWiring(unwired);
  assert.ok(
    failures.some((line) => line.includes('test -f'))
    && failures.some((line) => line.includes('node --test')),
    `an unwired-but-mentioned guard must be rejected on both counts, got: ${failures.join(' | ')}`,
  );
});

test('A-6 the guard files exist at the paths the workflow names', async () => {
  for (const file of GUARD_FILES) {
    const url = new URL(`../../../../../${file}`, import.meta.url);
    const text = await readFile(url, 'utf8');
    assert.ok(text.length > 500, `${file} is implausibly short to be a guard`);
  }
});
