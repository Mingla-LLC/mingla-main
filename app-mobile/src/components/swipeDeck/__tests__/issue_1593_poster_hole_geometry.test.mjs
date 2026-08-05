// Issue #1593 — the poster layer's photo box and the interactive card's transparent
// hero hole are the SAME rectangle drawn in two React trees. They must be single-sourced.
//
// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN UNDER ISSUE #1609 [TEST-MOD-APPROVED #1609].
//
// The INVARIANT is unchanged and still ACTIVE: the poster photo box and the face hero
// hole must be one rectangle with one source of truth. What changed is the MECHANISM.
//
//   #1593's mechanism (measure-and-copy): both trees shared `styles.imageContainer`
//   (`flex: 0.88`), which Yoga resolved to 689.00pt in the poster tree (one child,
//   grow-sum 0.88) and 667.67pt in the face tree (two children, the tray claiming
//   min-content). The 21.33pt overhang composited through the tray's
//   rgba(255,255,255,0.85) as a pale bar. #1593 repaired it by MEASURING the face
//   hole via onLayout and copying that number to the poster through a
//   `heroHoleHeight` prop and a pure `posterPhotoBoxOverride(role, h)` function.
//
//   #1609's mechanism (identical by construction): the hero is full-bleed and the
//   tray is deleted, so there is no flex axis left to disagree about. Both trees use
//   ONE axis-free style, `styles.heroFill` = `{...StyleSheet.absoluteFillObject}`.
//   `cardInner` is `flex: 1` with a definite height in both trees, so an absolute
//   fill resolves to exactly `cardInner`'s box in both — sibling-independent, with no
//   measurement pass and no runtime coupling at all. Delta is 0.00pt by construction
//   rather than by agreement.
//
// The tests that executed `posterPhotoBoxOverride` and traced
// producer -> prop -> pure function -> poster box are therefore GONE: every one of
// those code paths is deleted (`deckPosterGeometry.ts`, the `heroHoleHeight` prop and
// state, `styles.imageContainer`, `styles.cardDetails`). They are replaced below by
// the successor structural proof. This is a mechanism migration, NOT a weakening —
// the enforcement is strictly stronger, because "no flex axis exists" is checkable
// statically whereas "two measured numbers agree" was only checkable at runtime.
//
// The deeper contrast/scrim half of #1609 is enforced separately by
// issue_1609_collapsed_card_scrim_and_geometry.test.mjs, which the same workflow runs.
// ─────────────────────────────────────────────────────────────────────────────
//
// VACUITY DISCIPLINE (unchanged). Seven guards on this deck have been found hollow
// (#1607). Every extraction below asserts an EXACT expected count BEFORE it inspects
// any content, finding zero targets is a FAILURE, and source lookups run on
// comment-stripped source.
//
// CLAIMS — T-9 mechanically asserts that each of these is really enforced in this file.
//   CLAIM: one-axis-free-hero-style-shared-by-both-trees
//   CLAIM: hero-has-no-flex-axis-key
//   CLAIM: superseded-plumbing-is-absent
//   CLAIM: exactly-one-stage-call-site
//   CLAIM: exactly-one-poster-photo-box
//   CLAIM: swap-set-still-exactly-two-styles
//   CLAIM: poster-carries-no-key-prop
//   CLAIM: poster-remains-non-interactive
//   CLAIM: mutant-anchors-are-byte-intact
//   CLAIM: workflow-requires-and-executes-both-guards
//   CLAIM: successor-guard-is-registered

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const IMPLEMENTOR_GUARD =
  'app-mobile/src/components/swipeDeck/__tests__/issue_1593_poster_hole_geometry.test.mjs';
const ADVERSARIAL_GUARD =
  'app-mobile/src/components/swipeDeck/__tests__/'
  + 'issue_1593_poster_hole_geometry.adversarial.test.mjs';
const SUCCESSOR_GUARD =
  'app-mobile/src/components/swipeDeck/__tests__/'
  + 'issue_1609_collapsed_card_scrim_and_geometry.test.mjs';
const GUARD_FILES = [IMPLEMENTOR_GUARD, ADVERSARIAL_GUARD];

const urls = {
  swipeable: new URL('../../SwipeableCards.tsx', import.meta.url),
  stage: new URL('../DeckSwipeStage.tsx', import.meta.url),
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
// T-1 / T-2 / T-3 / T-4 — the SUCCESSOR contract (#1609).
//
// The invariant is now enforced structurally rather than numerically, because the
// mechanism it guards is structural: there is no measurement to compare.
// ---------------------------------------------------------------------------

test('T-1 exactly ONE axis-free hero style exists, and both trees are handed it', () => {
  const code = stripCommentsAndStrings(source.swipeable);

  const heroFillDecls = [...code.matchAll(/\bheroFill:\s*\{/g)];
  assert.equal(
    heroFillDecls.length,
    1,
    'one-axis-free-hero-style-shared-by-both-trees: expected exactly ONE `heroFill:` style '
    + `declaration in SwipeableCards, found ${heroFillDecls.length} — zero means this guard `
    + 'would pass by finding nothing, and two means the trees can be handed different objects',
  );

  // The face tree applies it directly.
  const faceUses = [...code.matchAll(/style=\{styles\.heroFill\}/g)];
  assert.ok(
    faceUses.length >= 1,
    'one-axis-free-hero-style-shared-by-both-trees: no face-tree node applies '
    + 'styles.heroFill — the face hero would compute its own box again',
  );

  // The poster tree is handed the SAME object through the stage prop.
  const posterProps = [...code.matchAll(/posterHeroStyle=\{/g)];
  assert.equal(
    posterProps.length,
    1,
    'exactly-one-stage-call-site: expected exactly ONE posterHeroStyle={ call site, found '
    + `${posterProps.length}`,
  );
  const propText = code.slice(posterProps[0].index, posterProps[0].index + 200);
  assert.match(
    propText,
    /styles\.heroFill/,
    'one-axis-free-hero-style-shared-by-both-trees: the poster tree must receive '
    + 'styles.heroFill — the SAME style object the face tree uses. Two separately-authored '
    + 'hero styles is precisely how the poster and the face diverged in #1593',
  );
  console.log(`T-1 examined ${heroFillDecls.length} hero style, ${faceUses.length} face uses, ${posterProps.length} poster prop`);
});

test('T-2 the hero style has NO flex-axis key and no explicit height', () => {
  const src = stripComments(source.swipeable);
  const idx = src.indexOf('heroFill: {');
  assert.ok(idx > 0, 'VACUITY: heroFill style not found for body extraction');
  const body = src.slice(idx, matchDelimiter(src, src.indexOf('{', idx)) + 1);
  assert.ok(body.length > 20, `VACUITY: extracted heroFill body is implausibly short (${body.length})`);

  assert.match(
    body,
    /StyleSheet\.absoluteFillObject/,
    'hero-has-no-flex-axis-key: heroFill must spread StyleSheet.absoluteFillObject. That is '
    + 'the whole mechanism: an absolute fill is resolved against the parent box, not against '
    + 'its siblings, so the two trees cannot disagree',
  );
  for (const [key, why] of [
    ['flex', 'a flex-axis key resolves differently under different sibling sets — 689.00pt in '
      + 'the poster tree vs 667.67pt in the face tree — which IS #1593'],
    ['height', 'an explicit height re-introduces an independently computed box'],
    ['flexGrow', 'flexGrow is the same axis key under another name'],
    ['flexBasis', 'flexBasis is the same axis key under another name'],
  ]) {
    assert.doesNotMatch(
      body,
      new RegExp(`\\b${key}\\s*:`),
      `hero-has-no-flex-axis-key: heroFill gained a \`${key}:\` key — ${why}`,
    );
  }
});

test('T-3 the superseded #1593 plumbing is absent from both trees', () => {
  const swipeable = stripCommentsAndStrings(source.swipeable);
  const stage = stripCommentsAndStrings(source.stage);

  for (const [label, code] of [['SwipeableCards', swipeable], ['DeckSwipeStage', stage]]) {
    for (const dead of [
      'posterPhotoBoxOverride',
      'heroHoleHeight',
      'imageContainerStyle',
      'IMAGE_SECTION_RATIO',
      'DETAILS_SECTION_RATIO',
    ]) {
      assert.ok(
        !code.includes(dead),
        `superseded-plumbing-is-absent: ${label} still references ${dead}. #1609 removes the `
        + 'flex-axis disagreement entirely, so the measure-and-copy plumbing is dead code — '
        + 'layering the redesign on top of it violates Constitution rule 8 (subtract before '
        + 'adding), and `deckPosterGeometry.ts` no longer exists to import',
      );
    }
    // The white tray is the other half of the sibling problem.
    assert.ok(
      !code.includes('styles.cardDetails'),
      `superseded-plumbing-is-absent: ${label} still references styles.cardDetails — the tray `
      + 'is the SECOND child that made the face tree resolve a different hero height',
    );
  }
});

test('T-4 exactly one poster photo box exists, and it applies the passed style', () => {
  const stage = stripCommentsAndStrings(source.stage);

  const posterBoxes = openingTags(stage, 'View').filter((tag) => (
    tag.text.includes('props.posterHeroStyle')
  ));
  assert.equal(
    posterBoxes.length,
    1,
    'exactly-one-poster-photo-box: expected exactly ONE poster photo box <View> carrying '
    + `props.posterHeroStyle, found ${posterBoxes.length} — zero means this guard would pass `
    + 'by finding nothing',
  );
  // It must apply the prop ALONE — no second style that could reintroduce an axis key.
  assert.doesNotMatch(
    posterBoxes[0].text,
    /style=\{\s*\[/,
    'exactly-one-poster-photo-box: the poster box composes an ARRAY of styles. RN flattens '
    + 'later-wins, so a second entry could silently re-add a flex axis on top of the shared '
    + 'hero style. Pass the single shared style',
  );
  console.log(`T-4 examined ${posterBoxes.length} poster photo box`);
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

  // #1609's successor guard must be REQUIRED and EXECUTED by this same job — otherwise
  // the scrim half of the invariant has no gate at all.
  assert.ok(
    blocks.some((b) => b.includes(`test -f ${SUCCESSOR_GUARD}`)),
    `successor-guard-is-registered: no run step does \`test -f\` on ${SUCCESSOR_GUARD}. `
    + "#1609 superseded #1593's mechanism; if its guard is not required here, the mechanism "
    + 'migration silently dropped a gate',
  );
  assert.ok(
    blocks.some((b) => /node --test/.test(b) && b.includes(SUCCESSOR_GUARD)),
    `successor-guard-is-registered: no \`node --test\` step executes ${SUCCESSOR_GUARD}`,
  );

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
