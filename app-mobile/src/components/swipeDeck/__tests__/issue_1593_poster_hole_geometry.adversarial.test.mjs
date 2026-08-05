// Issue #1593 — TESTER ADVERSARIAL guard (SPEC 9.2).
//
// DIFFERENT AXIS FROM THE IMPLEMENTOR GUARD, ON PURPOSE.
// `issue_1593_poster_hole_geometry.test.mjs` proves three things: the pure function is
// correct (T-1, executed), a producer onLayout exists (T-3), and a consumer call site
// wires it (T-4). That is "strong at both ends". This guard attacks the MIDDLE — the two
// places where a one-token edit restores the production defect while all nine of those
// tests stay green.
//
// Both were demonstrated on device before this file was written (iPhone 17, iOS 26.5,
// dev client on Metro :8093):
//
//   M3  style array order reversed at the poster box:
//         [props.imageContainerStyle, posterPhotoBox[card.role]]
//      -> [posterPhotoBox[card.role], props.imageContainerStyle]
//      RN flattens later-wins, so styles.imageContainer's `flex: IMAGE_SECTION_RATIO`
//      overrides `flex: 0` and the box grows back to the flex height. MEASURED: the pale
//      band returned (31 violating rows at ~227.7 in the 30px below the boundary, versus
//      a single 240.00 hairline row when correct). The implementor guard reported 9/9 PASS.
//
//   M1  the producer writes the SEEDED ESTIMATE instead of the measurement:
//         setHeroHoleHeight(height) -> setHeroHoleHeight(heroLayout.height)
//      `heroLayout` is seeded with (SCREEN_HEIGHT - 280) * IMAGE_SECTION_RATIO for the
//      image DECODE target and is wrong by ~70pt until the first layout. SwipeableCards.tsx
//      carries a comment saying precisely this — and nothing asserted it. The implementor
//      guard derives WHICH SETTER the handler calls but never WHAT VALUE reaches it, so
//      M1 and its sibling M2 (`setHeroHoleHeight(width)`) both pass 9/9.
//
// An enforcement that lives only in a comment is the seventh hollow-guard shape on this
// deck (SPEC 11.3 Discovery 2). M1 is that shape sitting in the PRODUCT file rather than
// in a guard, which is why X-2 below turns that comment into an assertion.
//
// VACUITY DISCIPLINE (SPEC 9.0), applied to this file and to its own mutant battery:
//   1. Every extraction asserts an EXACT expected count BEFORE inspecting content; finding
//      zero targets is a FAILURE, never a pass.
//   2. Structural lookups run on comment-and-string-stripped source.
//   3. Every test prints the number of nodes it examined and asserts that count.
//   4. Every mutant asserts its own ANCHOR EXISTS before substituting. A mutation battery
//      whose anchors have silently gone stale is the #1481 failure (a guard slicing on a
//      comment anchor that does not exist in the file) wearing a different hat.
//
// CLAIMS — X-8 asserts each of these is really enforced in this file's code.
//   CLAIM: layer-pairs-derived-not-named
//   CLAIM: behind-pair-needs-issue-numbered-allowlist
//   CLAIM: measurement-not-estimate-reaches-the-poster
//   CLAIM: override-must-win-the-cascade
//   CLAIM: seeded-estimate-never-crosses-the-prop-boundary
//   CLAIM: mutants-rejected-with-distinct-signatures
//   CLAIM: implementor-guard-not-gutted
//   CLAIM: workflow-requires-and-executes-both-guards

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { posterPhotoBoxOverride } from '../deckPosterGeometry.ts';

// When this guard runs inside its own scratch mirror (X-5), the mutation battery must not
// recurse. Everything else still runs, which is the point: the mirror is how mutants die.
const IN_MIRROR = process.env.ISSUE_1593_ADVERSARIAL_MIRROR === '1';

const REL = {
  swipeable: 'app-mobile/src/components/SwipeableCards.tsx',
  stage: 'app-mobile/src/components/swipeDeck/DeckSwipeStage.tsx',
  geometry: 'app-mobile/src/components/swipeDeck/deckPosterGeometry.ts',
  implementor:
    'app-mobile/src/components/swipeDeck/__tests__/issue_1593_poster_hole_geometry.test.mjs',
  adversarial:
    'app-mobile/src/components/swipeDeck/__tests__/'
    + 'issue_1593_poster_hole_geometry.adversarial.test.mjs',
  workflow: '.github/workflows/issue-1593-deck-layer-geometry.yml',
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../../..');
const abs = (key) => path.join(REPO_ROOT, REL[key]);

const source = Object.fromEntries(
  await Promise.all(
    Object.keys(REL).map(async (k) => [k, await readFile(abs(k), 'utf8')]),
  ),
);

// ---------------------------------------------------------------------------
// Source utilities — written here rather than imported so this guard cannot be
// disarmed by editing a shared helper.
// ---------------------------------------------------------------------------

/** Replace comment bodies with spaces, preserving offsets and line structure. */
function stripComments(src, { keepStrings = true } = {}) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i += 1; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += quote;
      i += 1;
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') { out += keepStrings ? src[i] : ' '; i += 1; }
        if (i < n) { out += keepStrings ? src[i] : (src[i] === '\n' ? '\n' : ' '); i += 1; }
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

/** Index of the delimiter closing the one at `open`, or -1. Skips strings. */
function matchDelimiter(src, open) {
  const closer = CLOSERS[src[open]];
  if (!closer) return -1;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i += 1;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1; }
      continue;
    }
    if (c === src[open]) depth += 1;
    else if (c === closer) { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** End index of the opening tag beginning at `start` (the `>` of `<Tag ... >`). */
function openingTagEnd(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i += 1;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1; }
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) return i;
  }
  return -1;
}

/** Every `<Tag ...>` opening tag in `src`, as {start, end, text}. */
function openingTags(src, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
  let m = re.exec(src);
  while (m) {
    const end = openingTagEnd(src, m.index);
    if (end > m.index) out.push({ start: m.index, end, text: src.slice(m.index, end + 1) });
    m = re.exec(src);
  }
  return out;
}

/** The value expression of JSX prop `name` inside an opening tag, or null. */
function propExpression(tagText, name) {
  const re = new RegExp(`\\b${name}=\\{`);
  const m = re.exec(tagText);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchDelimiter(tagText, open);
  if (close < 0) return null;
  return tagText.slice(open + 1, close).trim();
}

/** Top-level comma-separated elements of an array literal source string. */
function arrayElements(arraySrc) {
  const s = arraySrc.trim();
  assert.ok(s.startsWith('[') && s.endsWith(']'), `not an array literal: ${s.slice(0, 60)}`);
  const inner = s.slice(1, -1);
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      cur += c;
      i += 1;
      while (i < inner.length && inner[i] !== q) { cur += inner[i]; if (inner[i] === '\\') { i += 1; cur += inner[i]; } i += 1; }
      cur += inner[i];
      continue;
    }
    if ('{[('.includes(c)) depth += 1;
    if ('}])'.includes(c)) depth -= 1;
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

// ---------------------------------------------------------------------------
// X-1 — A-1. Derive the layer pairs; do not name them. The `behind` pair is NOT
// single-sourced, and that must be an explicit, issue-numbered decision rather than
// silence. Silence in the middle is how "blind in the middle" happened.
// ---------------------------------------------------------------------------

// A role may appear here ONLY with an issue-numbered justification that is also present
// in the product source. Adding a row is a decision with a name on it.
const NOT_SINGLE_SOURCED_ALLOWLIST = {
  behind: {
    issue: '#1593',
    invariant: 'I-PROPOSED-1593-LAYER-GEOMETRY-SINGLE-SOURCE',
    reason:
      'the behind overlay renders its own EMPTY tray, so its hole may legitimately '
      + 'differ; writing the current card measurement there could paint an inverse white '
      + 'sliver on a layer that is correct today',
  },
};

test('X-1 every poster/face layer pair is derived, and any pair that is NOT single-sourced carries an issue-numbered allowlist entry', () => {
  const swipeable = stripComments(source.swipeable, { keepStrings: true });

  // Derive the roles from the posterCards array the stage is actually handed — never a
  // hardcoded ['current','behind'].
  const stageTags = openingTags(swipeable, 'DeckSwipeStage');
  assert.equal(
    stageTags.length,
    1,
    'layer-pairs-derived-not-named: expected exactly ONE <DeckSwipeStage> call site, found '
    + `${stageTags.length} — zero would let this guard pass by finding nothing`,
  );
  const posterCardsExpr = propExpression(stageTags[0].text, 'posterCards');
  assert.ok(
    posterCardsExpr,
    'layer-pairs-derived-not-named: no posterCards={...} on the stage call site — the role '
    + 'set cannot be derived',
  );
  const roles = [...posterCardsExpr.matchAll(/role:\s*'([a-zA-Z]+)'/g)].map((m) => m[1]);
  const roleSet = [...new Set(roles)].sort();
  assert.equal(
    roleSet.length,
    2,
    `layer-pairs-derived-not-named: expected exactly 2 distinct poster roles, derived `
    + `${JSON.stringify(roleSet)}`,
  );
  assert.deepEqual(roleSet, ['behind', 'current']);

  // Execute the real geometry function per derived role. A role that yields no override is
  // NOT single-sourced and must be allowlisted.
  const probe = 667.6666870117188;
  const notSingleSourced = [];
  for (const role of roleSet) {
    const got = posterPhotoBoxOverride(role, probe);
    if (got === null) { notSingleSourced.push(role); continue; }
    assert.deepEqual(
      Object.keys(got).sort(),
      ['flex', 'height'],
      `${role}: an override must be exactly {flex, height}; a missing flex:0 leaves the `
      + "inherited flex in charge and the box keeps its own height (RN's shorthand trap)",
    );
    assert.equal(got.flex, 0, `${role}: flex must be 0 so height is authoritative`);
    assert.ok(
      Object.is(got.height, probe),
      `${role}: height must be the measurement identically (got ${got.height}) — a rounded `
      + 'or recomputed value is a second computation, which is the defect',
    );
  }

  for (const role of notSingleSourced) {
    const entry = NOT_SINGLE_SOURCED_ALLOWLIST[role];
    assert.ok(
      entry,
      `behind-pair-needs-issue-numbered-allowlist: role "${role}" draws a poster box that is `
      + 'NOT single-sourced from the face measurement and has NO allowlist entry. Either '
      + 'single-source it or add an entry naming the issue and the reason.',
    );
    assert.match(entry.issue, /^#\d+$/, `allowlist entry for "${role}" needs an issue number`);
    assert.ok(
      source.geometry.includes(role) && source.geometry.includes(entry.invariant),
      `behind-pair-needs-issue-numbered-allowlist: the allowlist says "${role}" is exempt per `
      + `${entry.invariant}, but deckPosterGeometry.ts does not document that exemption — an `
      + 'allowlist the product source does not corroborate is an unreviewed decision',
    );
  }

  assert.deepEqual(
    notSingleSourced,
    ['behind'],
    'behind-pair-needs-issue-numbered-allowlist: exactly the behind pair is expected to be '
    + `exempt; derived ${JSON.stringify(notSingleSourced)}`,
  );
  console.log(`X-1 examined ${roleSet.length} derived poster roles, ${notSingleSourced.length} allowlisted`);
});

// ---------------------------------------------------------------------------
// X-2 — the MEASUREMENT, not an estimate, reaches the poster. Kills M1 and M2.
// The implementor guard proves the right SETTER is called. This proves the right VALUE
// is passed to it.
// ---------------------------------------------------------------------------

test('X-2 the hero-hole setter is fed the height from the layout event, not another state', () => {
  const src = stripComments(source.swipeable, { keepStrings: false });

  const holes = openingTags(src, 'View').filter((t) => (
    t.text.includes('styles.imageContainer')
    && t.text.includes('styles.transparentImageContainer')
    && t.text.includes('onLayout=')
  ));
  assert.equal(
    holes.length,
    1,
    'measurement-not-estimate-reaches-the-poster: expected exactly ONE measured hero hole '
    + `<View>, found ${holes.length}`,
  );

  const handler = propExpression(holes[0].text, 'onLayout');
  assert.ok(handler && handler.length > 40,
    'measurement-not-estimate-reaches-the-poster: the hero onLayout body is missing or '
    + `implausibly short (${handler ? handler.length : 0} chars)`);

  // Derive the setter name from the CALL SITE, exactly as the dataflow runs.
  const stageTags = openingTags(src, 'DeckSwipeStage');
  assert.equal(stageTags.length, 1, 'expected exactly ONE <DeckSwipeStage> call site');
  const propExpr = propExpression(stageTags[0].text, 'heroHoleHeight');
  assert.ok(
    propExpr,
    'measurement-not-estimate-reaches-the-poster: no heroHoleHeight={...} at the call site',
  );
  assert.match(
    propExpr,
    /^[A-Za-z_$][\w$]*$/,
    `seeded-estimate-never-crosses-the-prop-boundary: heroHoleHeight must be passed a plain `
    + `state identifier, got "${propExpr}" — a member expression such as heroLayout.height `
    + 'is the SEEDED DECODE ESTIMATE, wrong by ~70pt until first layout',
  );
  const decl = new RegExp(
    `const\\s*\\[\\s*${propExpr}\\s*,\\s*([A-Za-z_$][\\w$]*)\\s*\\]\\s*=\\s*useState`,
  ).exec(src);
  assert.ok(decl, `no useState declaration found for "${propExpr}"`);
  const setter = decl[1];

  // What does the handler actually pass to that setter?
  const callRe = new RegExp(`\\b${setter}\\s*\\(`, 'g');
  const args = [];
  let m = callRe.exec(handler);
  while (m) {
    const open = m.index + m[0].length - 1;
    const close = matchDelimiter(handler, open);
    assert.ok(close > open, `unbalanced call to ${setter}`);
    args.push(handler.slice(open + 1, close).trim());
    m = callRe.exec(handler);
  }
  assert.equal(
    args.length,
    1,
    `measurement-not-estimate-reaches-the-poster: expected exactly ONE ${setter}(...) call in `
    + `the hero onLayout, found ${args.length} ${JSON.stringify(args)}`,
  );
  const arg = args[0];

  // Accepted forms: (a) a direct member read ending `.layout.height`;
  //                 (b) an identifier destructured from `<something>.layout` as `height`.
  const directRead = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.layout\.height$/.test(arg);

  let destructuredOk = false;
  let boundNames = null;
  if (/^[A-Za-z_$][\w$]*$/.test(arg)) {
    const destructRe = /const\s*\{([^}]*)\}\s*=\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/g;
    let d = destructRe.exec(handler);
    while (d) {
      const [, pattern, rhs] = d;
      if (/(^|\.)layout$/.test(rhs)) {
        const map = {};
        for (const piece of pattern.split(',')) {
          const [prop, local] = piece.split(':').map((s) => s.trim());
          if (prop) map[prop] = (local || prop);
        }
        boundNames = map;
        if (map.height === arg) destructuredOk = true;
      }
      d = destructRe.exec(handler);
    }
  }

  assert.ok(
    directRead || destructuredOk,
    'measurement-not-estimate-reaches-the-poster: the hero-hole setter is called with '
    + `"${arg}", which is not the height from this layout event `
    + `(bindings seen: ${JSON.stringify(boundNames)}). Two real regressions look exactly `
    + 'like this and BOTH pass the implementor guard 9/9: `heroLayout.height` writes the '
    + 'seeded decode estimate (~70pt wrong until first layout, painting a white sliver on '
    + 'frame one), and `width` writes the wrong axis entirely. SwipeableCards.tsx already '
    + 'carries a comment saying heroLayout must not be used here; this is that comment '
    + 'turned into an assertion.',
  );
  console.log(`X-2 examined 1 hero-hole producer, 1 setter call, arg="${arg}"`);
});

// ---------------------------------------------------------------------------
// X-3 — the override must WIN the style cascade. Kills M3.
// ---------------------------------------------------------------------------

test('X-3 the poster photo box applies the override AFTER the base style so it wins', () => {
  const stage = stripComments(source.stage, { keepStrings: false });

  const boxes = openingTags(stage, 'View').filter((t) => t.text.includes('props.imageContainerStyle'));
  assert.equal(
    boxes.length,
    1,
    `override-must-win-the-cascade: expected exactly ONE poster photo box <View>, found `
    + `${boxes.length}`,
  );

  const styleExpr = propExpression(boxes[0].text, 'style');
  assert.ok(styleExpr, 'override-must-win-the-cascade: the poster photo box has no style prop');
  assert.ok(
    styleExpr.startsWith('['),
    'override-must-win-the-cascade: the poster box style must be an ARRAY so the override '
    + `can be layered over the base; got ${styleExpr.slice(0, 60)}`,
  );

  const elements = arrayElements(styleExpr);
  assert.ok(
    elements.length >= 2,
    `override-must-win-the-cascade: the poster box style array has ${elements.length} entry — `
    + 'the base style and the measured override must both be present',
  );

  const baseIdx = elements.findIndex((e) => e.includes('props.imageContainerStyle'));
  const overrideIdx = elements.findIndex((e) => /\[\s*card\.role\s*\]/.test(e));
  assert.ok(baseIdx >= 0, 'override-must-win-the-cascade: props.imageContainerStyle not in the array');
  assert.ok(
    overrideIdx >= 0,
    'override-must-win-the-cascade: no role-selected override entry (expected something '
    + 'indexed by [card.role]) in the poster box style array',
  );
  assert.ok(
    overrideIdx > baseIdx,
    'override-must-win-the-cascade: the measured override is at index '
    + `${overrideIdx} and the base style at index ${baseIdx}. React Native flattens style `
    + 'arrays LATER-WINS, so with this ordering styles.imageContainer\'s '
    + '`flex: IMAGE_SECTION_RATIO` overrides the override\'s `flex: 0`, the box grows back to '
    + 'its independently-computed flex height, and the 21.33pt overhang — the entire #1593 '
    + 'defect — returns. This was reproduced on device: the pale band came back while the '
    + 'implementor guard still reported 9/9 PASS.',
  );
  console.log(`X-3 examined 1 poster photo box, ${elements.length} style entries (base@${baseIdx}, override@${overrideIdx})`);
});

// ---------------------------------------------------------------------------
// X-4 — the seeded estimate must never cross the prop boundary at all.
// ---------------------------------------------------------------------------

test('X-4 the seeded decode-target state is never handed to the stage as layout input', () => {
  const src = stripComments(source.swipeable, { keepStrings: false });
  const stageTags = openingTags(src, 'DeckSwipeStage');
  assert.equal(stageTags.length, 1, 'expected exactly ONE <DeckSwipeStage> call site');
  const tag = stageTags[0].text;

  assert.ok(
    !/\bheroLayout\b/.test(tag),
    'seeded-estimate-never-crosses-the-prop-boundary: the <DeckSwipeStage> call site '
    + 'references heroLayout. That state is SEEDED with an estimate for the image decode '
    + 'target and is wrong by ~70pt until the first layout pass; using it as a layout input '
    + 'paints a white sliver on the first frame.',
  );

  // And the seed really is an estimate, not a measurement — if that ever stops being true
  // this test should be revisited rather than silently kept.
  assert.match(
    src,
    /useState\(\s*\{[^}]*height:\s*Math\.max\(\s*1\s*,\s*\(\s*SCREEN_HEIGHT\s*-\s*280\s*\)/,
    'seeded-estimate-never-crosses-the-prop-boundary: the heroLayout seed no longer matches '
    + 'the documented (SCREEN_HEIGHT - 280) * IMAGE_SECTION_RATIO estimate — re-derive '
    + 'whether it is now safe as a layout input before relaxing X-2/X-4',
  );
  console.log('X-4 examined 1 stage call site for seeded-estimate leakage');
});

// ---------------------------------------------------------------------------
// X-5 — mutation battery. A guard nobody has tried to fool has unknown discriminating
// power. Each mutant asserts its own anchor exists first.
// ---------------------------------------------------------------------------

const MIRROR_FILES = Object.keys(REL);

const MUTANTS = [
  {
    id: 'a_role_guard_deleted',
    edits: [['geometry', "  if (role !== 'current') return null;\n", '']],
  },
  {
    id: 'b_flex_zero_omitted',
    edits: [['geometry', 'return { flex: 0, height: measuredHoleHeight };',
      'return { height: measuredHoleHeight };']],
  },
  {
    id: 'c_hardcoded_height',
    edits: [['geometry', 'return { flex: 0, height: measuredHoleHeight };',
      'return { flex: 0, height: 667.67 };']],
  },
  {
    id: 'd_seeded_estimate_written',
    advOnly: true,
    edits: [['swipeable', 'if (height !== heroHoleHeight) setHeroHoleHeight(height);',
      'if (height !== heroHoleHeight) setHeroHoleHeight(heroLayout.height);']],
  },
  {
    id: 'e_zero_guard_inverted',
    edits: [['geometry', 'measuredHoleHeight <= 0', 'measuredHoleHeight < 0']],
  },
  {
    id: 'f_isfinite_removed',
    edits: [['geometry', '!Number.isFinite(measuredHoleHeight) || measuredHoleHeight <= 0',
      'measuredHoleHeight <= 0']],
  },
  {
    id: 'g_producer_onlayout_gutted',
    edits: [['swipeable', 'if (height !== heroHoleHeight) setHeroHoleHeight(height);', '']],
  },
  {
    id: 'h_prop_deleted_at_call_site',
    edits: [['swipeable', '            heroHoleHeight={heroHoleHeight}\n', '']],
  },
  {
    id: 'i_change_only_in_a_comment',
    edits: [['stage', '<View style={[props.imageContainerStyle, posterPhotoBox[card.role]]}>',
      '<View style={props.imageContainerStyle}>{/* posterPhotoBox[card.role] */}']],
  },
  {
    id: 'j_exported_function_renamed',
    edits: [
      ['geometry', 'export function posterPhotoBoxOverride(', 'export function posterPhotoBoxOverrideX('],
      ['stage', 'import { posterPhotoBoxOverride }', 'import { posterPhotoBoxOverrideX as posterPhotoBoxOverride }'],
    ],
  },
  {
    id: 'k_body_replaced_by_constant',
    edits: [['geometry', 'return { flex: 0, height: measuredHoleHeight };',
      'return { flex: 0, height: 500 };']],
  },
  {
    id: 'l_frozen_region_reindented',
    edits: [['stage', "                ? [controller.previewCardStyle, {",
      "              ? [controller.previewCardStyle, {"]],
  },
  {
    id: 'm_style_array_order_reversed',
    advOnly: true,
    edits: [['stage', '[props.imageContainerStyle, posterPhotoBox[card.role]]',
      '[posterPhotoBox[card.role], props.imageContainerStyle]']],
  },
  {
    id: 'n_wrong_axis_written',
    advOnly: true,
    edits: [['swipeable', 'if (height !== heroHoleHeight) setHeroHoleHeight(height);',
      'if (height !== heroHoleHeight) setHeroHoleHeight(width);']],
  },
];

function buildMirror(edits) {
  const dir = mkdtempSync(path.join(tmpdir(), 'issue1593-adv-'));
  for (const key of MIRROR_FILES) {
    const dst = path.join(dir, REL[key]);
    mkdirSync(path.dirname(dst), { recursive: true });
    cpSync(abs(key), dst);
  }
  for (const [key, from, to] of edits) {
    const p = path.join(dir, REL[key]);
    const src = readFileSync(p, 'utf8');
    assert.ok(
      src.includes(from),
      `mutants-rejected-with-distinct-signatures: mutant anchor missing in ${REL[key]}: `
      + `${JSON.stringify(from.slice(0, 70))}. A battery whose anchors have gone stale is a `
      + 'battery of no-ops that reports green — the exact #1481 failure this guard exists to '
      + 'avoid repeating.',
    );
    writeFileSync(p, src.replaceAll(from, to));
  }
  return dir;
}

function runGuard(dir, which) {
  // A nested `node --test` INHERITS NODE_TEST_CONTEXT from this run and then emits the
  // child-reporter stream instead of TAP, so `# fail 0` never appears and every mutant
  // reads as "killed". That masking has already produced a false-green gate in this repo;
  // strip it, or this whole battery becomes a rubber stamp.
  const env = { ...process.env, ISSUE_1593_ADVERSARIAL_MIRROR: '1' };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', path.join(dir, REL[which])], {
    encoding: 'utf8',
    env,
    timeout: 120000,
  });
  const stdout = r.stdout || '';
  const green = r.status === 0 && /^# fail 0$/m.test(stdout);
  const failing = [...stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]);
  return { green, failing, status: r.status };
}

test('X-5 mutation battery — every mutant is rejected, with a distinct signature', { skip: IN_MIRROR }, () => {
  assert.ok(
    MUTANTS.length >= 12,
    `mutants-rejected-with-distinct-signatures: SPEC 9.2 A-2 requires >=12 mutants, have `
    + `${MUTANTS.length}`,
  );
  const ids = new Set(MUTANTS.map((m) => m.id));
  assert.equal(ids.size, MUTANTS.length, 'mutant ids must be unique');

  // Control: an unmutated mirror must be GREEN, or every "kill" below is meaningless.
  const controlDir = buildMirror([]);
  const control = runGuard(controlDir, 'adversarial');
  assert.ok(
    control.green,
    'mutants-rejected-with-distinct-signatures: the UNMUTATED mirror failed '
    + `(${control.failing.join('; ')}) — the battery cannot distinguish anything`,
  );

  const survivors = [];
  const signatures = new Map();
  const advOnlyEvidence = [];

  for (const mutant of MUTANTS) {
    const dir = buildMirror(mutant.edits);
    const adv = runGuard(dir, 'adversarial');
    const impl = runGuard(dir, 'implementor');

    if (adv.green && impl.green) survivors.push(mutant.id);
    signatures.set(mutant.id, adv.green ? `(implementor-only kill)` : adv.failing.join('; '));

    if (mutant.advOnly) {
      assert.ok(
        !adv.green,
        `mutants-rejected-with-distinct-signatures: mutant ${mutant.id} is one this guard `
        + 'exists to catch, and this guard did NOT catch it',
      );
      advOnlyEvidence.push(`${mutant.id}: adversarial=KILLED implementor=${impl.green ? 'passed' : 'killed'}`);
    }
  }

  assert.deepEqual(
    survivors,
    [],
    'mutants-rejected-with-distinct-signatures: these mutants passed BOTH guards — '
    + `${survivors.join(', ')}`,
  );

  // Distinct signatures: the killed mutants must not all be diagnosed identically.
  const advKilled = [...signatures.entries()].filter(([, s]) => s !== '(implementor-only kill)');
  const distinct = new Set(advKilled.map(([, s]) => s));
  assert.ok(
    distinct.size >= Math.min(3, advKilled.length),
    'mutants-rejected-with-distinct-signatures: this guard diagnosed '
    + `${advKilled.length} mutants with only ${distinct.size} distinct message(s) — it is `
    + 'detecting "something changed" rather than what changed',
  );

  console.log(`X-5 examined ${MUTANTS.length} mutants, 0 survivors, ${distinct.size} distinct signatures`);
  for (const line of advOnlyEvidence) console.log(`    ${line}`);
});

// ---------------------------------------------------------------------------
// X-6 — the implementor guard must not be gutted. Its T-1 is the only thing that
// EXECUTES the geometry function; if that is replaced by a regex the whole gate hollows
// out while both files still exist and still run.
// ---------------------------------------------------------------------------

test('X-6 the implementor guard still executes the real module against a literal table', () => {
  const impl = source.implementor;
  assert.ok(
    impl.length >= 500,
    `implementor-guard-not-gutted: the implementor guard is only ${impl.length} chars`,
  );
  assert.match(
    impl,
    /import\s*\{\s*posterPhotoBoxOverride\s*\}\s*from\s*'\.\.\/deckPosterGeometry\.ts'/,
    'implementor-guard-not-gutted: the implementor guard no longer IMPORTS the real geometry '
    + 'module — if it re-implements the rule instead, it is testing its own copy',
  );

  const code = stripComments(impl, { keepStrings: false });
  const matrix = /const\s+GEOMETRY_MATRIX\s*=\s*\[/.exec(code);
  assert.ok(matrix, 'implementor-guard-not-gutted: GEOMETRY_MATRIX is gone');
  const open = code.indexOf('[', matrix.index);
  const body = code.slice(open, matchDelimiter(code, open) + 1);
  const rows = (body.match(/\{\s*role:/g) || []).length;
  assert.ok(
    rows >= 24,
    `implementor-guard-not-gutted: the literal expectation table collapsed to ${rows} rows `
    + '(expected >= 24) — a shrinking oracle is a weakening gate',
  );

  // The expectations must be LITERAL, not recomputed by calling the function under test.
  assert.ok(
    !/expect:\s*posterPhotoBoxOverride/.test(code),
    'implementor-guard-not-gutted: the expectation table calls the function under test to '
    + 'produce its own expectations — that is a tautology, not an oracle',
  );
  console.log(`X-6 examined the implementor guard: ${impl.length} chars, ${rows} literal matrix rows`);
});

// ---------------------------------------------------------------------------
// X-7 — A-9. The workflow must REQUIRE and EXECUTE both guards. Comments do not gate.
// ---------------------------------------------------------------------------

function runBlocks(workflow) {
  const lines = workflow.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*#/.test(lines[i])) continue;
    const m = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, indent, inline] = m;
    let body = '';
    if (inline.trim() === '' || /^[|>]/.test(inline.trim())) {
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].trim() === '') { body += '\n'; continue; }
        if (/^(\s*)/.exec(lines[j])[1].length <= indent.length) break;
        body += `${lines[j]}\n`;
      }
    } else body = inline;
    body = body.split('\n').map((l) => l.replace(/#.*$/, '')).join(' ');
    blocks.push(body.replace(/\s+/g, ' ').trim());
  }
  return blocks;
}

test('X-7 the workflow requires AND executes both guards, and a commented mention does not count', () => {
  const blocks = runBlocks(source.workflow);
  assert.ok(blocks.length > 0, 'VACUITY: no run: blocks parsed from the #1593 workflow');

  for (const key of ['implementor', 'adversarial']) {
    const file = REL[key];
    assert.ok(
      blocks.some((b) => b.includes(`test -f ${file}`)),
      `workflow-requires-and-executes-both-guards: no run step does \`test -f\` on ${file}`,
    );
    assert.ok(
      blocks.some((b) => /node --test/.test(b) && b.includes(file)),
      `workflow-requires-and-executes-both-guards: no \`node --test\` step executes ${file}`,
    );
  }

  // Negative control: the parser must NOT be satisfiable by a commented-out mention.
  const commented = runBlocks(
    'jobs:\n  x:\n    steps:\n      - run: |\n'
    + `          # test -f ${REL.adversarial}\n`
    + `          # node --test ${REL.adversarial}\n`,
  );
  assert.ok(
    !commented.some((b) => b.includes(`test -f ${REL.adversarial}`)),
    'workflow-requires-and-executes-both-guards: the run-block parser accepts a filename '
    + 'parked behind a shell `#` — a commented gate would satisfy this test',
  );

  assert.match(source.workflow, /node-version: ['"]22['"]/,
    'the .ts import in both guards depends on Node 22 native type-stripping');
  assert.match(source.workflow, /app-mobile\/src\/components\/SwipeableCards\.tsx/,
    'the paths filter must include SwipeableCards.tsx — this fix edits it, and a gate that '
    + 'does not run on the file it protects is decoration');
  assert.match(source.workflow, /app-mobile\/src\/components\/swipeDeck\/\*\*/);
  console.log(`X-7 examined ${blocks.length} run blocks + 1 negative control`);
});

// ---------------------------------------------------------------------------
// X-8 — this file asserts everything its own comments claim (SPEC 11.3 D-2).
// ---------------------------------------------------------------------------

test('X-8 every CLAIM in this file’s header is really enforced in this file’s code', () => {
  const self = source.adversarial;
  const claims = [...self.matchAll(/\/\/\s*CLAIM:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(
    claims.length >= 8,
    `VACUITY: only ${claims.length} CLAIM tokens parsed from this file's own comments`,
  );
  const code = stripComments(self, { keepStrings: true });
  for (const claim of claims) {
    assert.ok(
      code.includes(claim),
      `this file claims to enforce "${claim}" but no assertion message in its code mentions `
      + 'it — an enforcement that exists only in a comment is not an enforcement',
    );
  }
  assert.ok(
    self.length >= 500,
    `the adversarial guard is only ${self.length} chars — a stub is not a gate`,
  );
  console.log(`X-8 examined ${claims.length} claims in the adversarial guard`);
});
