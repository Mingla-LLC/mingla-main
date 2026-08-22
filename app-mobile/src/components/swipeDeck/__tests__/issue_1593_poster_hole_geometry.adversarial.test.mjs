// Issue #1593 — TESTER ADVERSARIAL guard.
//
// ─────────────────────────────────────────────────────────────────────────────
// REWRITTEN UNDER ISSUE #1609 [TEST-MOD-APPROVED #1609].
//
// THE INVARIANT IS UNCHANGED AND STILL ACTIVE.
// I-PROPOSED-1593-LAYER-GEOMETRY-SINGLE-SOURCE: the poster layer's photo box and the
// interactive card's hero are the SAME rectangle drawn in two React trees, and they must
// have ONE source of truth. Only the MECHANISM that satisfies it changed.
//
//   #1593's mechanism — MEASURE AND COPY. Both trees shared `styles.imageContainer`
//   (`flex: IMAGE_SECTION_RATIO` = 0.88). Yoga resolved that one style to 689.00pt in the
//   poster tree (one child, grow-sum 0.88) and to 667.67pt in the face tree (two children,
//   the white tray claiming min-content). The 21.33pt overhang composited through the
//   tray's rgba(255,255,255,0.85) as a pale bar in production. #1593 repaired it by
//   MEASURING the face hole via onLayout and copying that number to the poster through a
//   `heroHoleHeight` prop and a pure `posterPhotoBoxOverride(role, h)` function.
//
//   #1609's mechanism — IDENTICAL BY CONSTRUCTION. The hero is full-bleed and the white
//   tray is deleted, so there is no flex axis left to disagree about. Both trees are handed
//   ONE axis-free style, `styles.heroFill` = `{ ...StyleSheet.absoluteFillObject }`, and
//   both hang it directly off `styles.cardInner` (`flex: 1` inside the absolutely-positioned
//   `styles.card`, so its box is definite in both trees). An absolute fill resolves to
//   exactly its containing block regardless of how many siblings it has, so the two
//   rectangles are equal by construction — delta 0.00pt, no measurement pass, no runtime
//   coupling, nothing to get out of sync.
//
// EVERYTHING THIS FILE USED TO ATTACK IS DELETED: `deckPosterGeometry.ts` (the module this
// file used to import, which is why it failed at import), the `heroHoleHeight` prop and its
// useState, `styles.imageContainer`, `styles.cardDetails`, and the `imageContainerStyle`
// prop (renamed `posterHeroStyle`). The old X-1..X-4 attacked a dataflow that no longer
// exists. They are replaced below by attacks on the NEW mechanism's soft spots, which are
// different soft spots:
//
//   the old defect returns if `heroFill` regains ANY flex-axis key (X-2);
//   single-sourcing dies silently if the poster is handed a TWIN style object that happens
//     to look identical today (X-1) — no runtime symptom until the twin drifts;
//   the absolute fill silently re-anchors if either tree nests it under an extra wrapper,
//     or if the shared containing box stops being definite (X-3);
//   and the whole thing can be quietly re-broken by layering a geometry-carrying style on
//     top of the shared one at the poster only (X-2's layered check).
//
// The non-interference guards this file inherits (#1576 swap-set derivation, #1579
// non-interactivity, and the byte-exact #1576 mutant anchors) do NOT depend on the deleted
// mechanism and are preserved verbatim in behaviour, at X-6/X-7/X-8.
// ─────────────────────────────────────────────────────────────────────────────
//
// VACUITY DISCIPLINE. SEVEN guards on this deck have already been found hollow (#1607) —
// one satisfied by a comment, one matching an opening tag, one vacuous on ordering, one
// blind in the middle, one slicing on an anchor that does not exist, two workflows claiming
// assertions that exist nowhere, and one that reported 9/9 PASS against a mutation that
// fully restored the production defect. Therefore, in this file:
//
//   1. Every extraction asserts an EXACT expected count BEFORE it inspects any content.
//      Finding zero targets is a FAILURE, never a silent pass.
//   2. Every structural lookup runs on comment-stripped source. `imageContainer`,
//      `cardDetails` and `heroHoleHeight` all still appear in this repo — in COMMENTS —
//      so a token check on raw source would be both false-positive and unfalsifiable.
//   3. Every test prints the number of nodes it examined and asserts that count.
//   4. X-5 is a real mutation battery: the sources are copied to a scratch mirror, each
//      mutation is applied and PROVEN to have changed the file (`assert.notEqual`), and the
//      mutant must be rejected BOTH by the in-process checkers (with a signature distinct
//      from every other mutant's) AND by re-running this whole guard file as a subprocess
//      against the mirror. An anchor that has gone stale fails loudly rather than no-oping.
//
// CLAIMS — X-10 asserts each of these is really enforced in this file's own code.
//   CLAIM: one-hero-style-shared-by-both-trees
//   CLAIM: hero-style-carries-no-flex-axis
//   CLAIM: layered-poster-styles-carry-no-geometry
//   CLAIM: both-trees-share-one-containing-box
//   CLAIM: superseded-1593-plumbing-is-absent
//   CLAIM: mutants-rejected-with-distinct-signatures
//   CLAIM: swap-set-still-exactly-two-styles
//   CLAIM: poster-carries-no-key-prop
//   CLAIM: poster-remains-non-interactive
//   CLAIM: mutant-anchors-are-byte-intact
//   CLAIM: workflow-requires-and-executes-both-guards
//   CLAIM: both-named-guards-exist-and-are-non-stub

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// When this guard runs inside its own scratch mirror (X-5), the mutation battery must not
// recurse. Everything else still runs, which is the point: the mirror is how mutants die.
const IN_MIRROR = process.env.ISSUE_1609_ADVERSARIAL_MIRROR === '1';

const REL = {
  swipeable: 'app-mobile/src/components/SwipeableCards.tsx',
  stage: 'app-mobile/src/components/swipeDeck/DeckSwipeStage.tsx',
  implementor:
    'app-mobile/src/components/swipeDeck/__tests__/issue_1593_poster_hole_geometry.test.mjs',
  adversarial:
    'app-mobile/src/components/swipeDeck/__tests__/'
    + 'issue_1593_poster_hole_geometry.adversarial.test.mjs',
  workflow: '.github/ci-batch/MANIFEST.json',
};

// #1609 deleted this module outright. Its RESURRECTION is itself a regression signal: it
// would mean the measure-and-copy mechanism is being layered back under the redesign.
const DELETED_GEOMETRY_MODULE = 'app-mobile/src/components/swipeDeck/deckPosterGeometry.ts';

const SUCCESSOR_GUARD =
  'app-mobile/src/components/swipeDeck/__tests__/'
  + 'issue_1609_collapsed_card_scrim_and_geometry.test.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../../..');

function loadSources(root) {
  const out = { __root: root };
  for (const key of Object.keys(REL)) {
    out[key] = readFileSync(path.join(root, REL[key]), 'utf8');
  }
  out.workflow = typedSuiteWorkflow(out.workflow, 'issue-1593-deck-layer-geometry');
  return out;
}

function typedSuiteWorkflow(raw, id) {
  const registry = JSON.parse(raw); const suite = registry.suites.find((item) => item.id === id);
  const profile = registry.setupProfiles[suite.setupProfile];
  return [`node-version: "${profile.runtime.version}"`, `timeout-minutes: ${suite.timeoutSeconds / 60}`,
    'paths:', ...suite.originPaths, ...suite.steps.map((step) => `run: |\n  ${step.run.replaceAll('\n', '\n  ')}`)].join('\n');
}

const source = loadSources(REPO_ROOT);

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

/** Strip comments AND string contents — for structural (identifier-level) searches. */
function stripCommentsAndStrings(src) {
  return stripComments(src, { keepStrings: false });
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

/** Split the inside of a bracketed literal into top-level comma-separated parts. */
function topLevelParts(inner) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i += 1) {
    const c = inner[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      cur += c;
      i += 1;
      while (i < inner.length && inner[i] !== q) {
        cur += inner[i];
        if (inner[i] === '\\') { i += 1; cur += inner[i]; }
        i += 1;
      }
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

/** Top-level elements of an array literal source string (brackets included). */
function arrayElements(arraySrc) {
  const s = arraySrc.trim();
  if (!(s.startsWith('[') && s.endsWith(']'))) return null;
  return topLevelParts(s.slice(1, -1));
}

/** Top-level entries of an object literal source string (braces included). */
function objectEntries(objectSrc) {
  const s = objectSrc.trim();
  if (!(s.startsWith('{') && s.endsWith('}'))) return null;
  return topLevelParts(s.slice(1, -1));
}

/**
 * The children source of a `<Tag ...>` element, or null when it cannot be balanced.
 * Self-closing tags yield ''. Used to prove the poster hero is its container's ONLY child.
 */
function innerTextOf(src, tagName, tag) {
  if (src[tag.end - 1] === '/') return '';
  const start = tag.end + 1;
  let depth = 1;
  let i = start;
  const openRe = new RegExp(`<${tagName}(?=[\\s/>])`, 'g');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'g');
  while (i < src.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const o = openRe.exec(src);
    const c = closeRe.exec(src);
    if (!c) return null;
    if (o && o.index < c.index) {
      const oEnd = openingTagEnd(src, o.index);
      if (oEnd < 0) return null;
      if (src[oEnd - 1] !== '/') depth += 1;
      i = oEnd + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) return src.slice(start, c.index);
    i = c.index + c[0].length;
  }
  return null;
}

/** Map of `<View style={styles.NAME}>` (BARE, not an array) -> the tags using it. */
function bareStyleViewNames(strippedSrc) {
  const map = new Map();
  for (const tag of openingTags(strippedSrc, 'View')) {
    const expr = propExpression(tag.text, 'style');
    if (!expr) continue;
    const m = /^styles\.([A-Za-z_$][\w$]*)$/.exec(expr);
    if (!m) continue;
    if (!map.has(m[1])) map.set(m[1], []);
    map.get(m[1]).push(tag);
  }
  return map;
}

/**
 * The `const styles = StyleSheet.create({ ... })` object body, with an exact-count guard.
 * Scoped deliberately: SwipeableCards also declares TypeScript members and two other
 * StyleSheet.create blocks whose keys collide with style names (`card: {` appears as an
 * interface member at the top of the file), so a file-wide `name: {` search would extract
 * the wrong object and then "prove" things about it.
 */
function extractStylesBlock(strippedSrc, claim) {
  const re = /const\s+styles\s*=\s*StyleSheet\.create\(\s*\{/g;
  const hits = [...strippedSrc.matchAll(re)];
  if (hits.length !== 1) {
    return {
      failures: [
        `${claim}: expected exactly ONE \`const styles = StyleSheet.create({\` block in `
        + `SwipeableCards, found ${hits.length} — every style lookup below would be scoped to `
        + 'the wrong object',
      ],
      block: null,
    };
  }
  const open = strippedSrc.indexOf('{', hits[0].index + hits[0][0].length - 1);
  const close = matchDelimiter(strippedSrc, open);
  if (close < 0) {
    return {
      failures: [`${claim}: unbalanced braces while delimiting the styles block`],
      block: null,
    };
  }
  return { failures: [], block: strippedSrc.slice(open, close + 1) };
}

/** The body of `NAME: { ... }` inside the styles block, with an exact-count guard. */
function extractStyleBody(stylesBlockSrc, name, claim) {
  const failures = [];
  const strippedSrc = stylesBlockSrc;
  const re = new RegExp(`(?:^|\\n)[ \\t]*${name}:\\s*\\{`, 'g');
  const hits = [...strippedSrc.matchAll(re)];
  if (hits.length !== 1) {
    failures.push(
      `${claim}: expected exactly ONE \`${name}: {\` style declaration in SwipeableCards, `
      + `found ${hits.length} — zero targets would let this checker pass by finding nothing, `
      + 'which is the #1607 silent-extraction failure shape',
    );
    return { failures, entries: null, body: null };
  }
  const open = strippedSrc.indexOf('{', hits[0].index);
  const close = matchDelimiter(strippedSrc, open);
  if (close < 0) {
    failures.push(`${claim}: unbalanced braces while delimiting the ${name} style body`);
    return { failures, entries: null, body: null };
  }
  const body = strippedSrc.slice(open, close + 1);
  const entries = objectEntries(body);
  if (!entries) {
    failures.push(`${claim}: the ${name} style body did not parse as an object literal`);
    return { failures, entries: null, body };
  }
  return { failures, entries, body };
}

/**
 * Keys that make a style participate in its parent's layout algebra. ANY of them on the
 * shared hero style, or on a style layered over it, re-opens the two-tree disagreement:
 * a flex-axis key resolves against the sibling set (that is literally #1593), and an
 * explicit size or edge overrides the absolute fill's own resolution.
 */
const GEOMETRY_KEYS = new Set([
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf',
  'height', 'width', 'minHeight', 'maxHeight', 'minWidth', 'maxWidth', 'aspectRatio',
  'position', 'top', 'bottom', 'left', 'right',
  'margin', 'marginTop', 'marginBottom', 'marginVertical',
  'padding', 'paddingTop', 'paddingBottom', 'paddingVertical',
]);

function geometryKeysIn(entries) {
  const found = [];
  for (const entry of entries) {
    const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(entry);
    if (m && GEOMETRY_KEYS.has(m[1])) found.push(m[1]);
  }
  return found;
}

// ---------------------------------------------------------------------------
// The CHECKERS. Each is a pure function of the loaded sources returning failure
// strings, so X-5 can re-run every one of them against a mutated mirror in-process
// and compare exact signatures. The tests below assert each returns no failures.
// ---------------------------------------------------------------------------

/** Derive the ONE style object both trees share. Nothing here names `heroFill`. */
function deriveHeroStyle(src) {
  const failures = [];
  const code = stripCommentsAndStrings(src.swipeable);
  const stageTags = openingTags(code, 'DeckSwipeStage');
  if (stageTags.length !== 1) {
    failures.push(
      'one-hero-style-shared-by-both-trees: expected exactly ONE <DeckSwipeStage> call site '
      + `in SwipeableCards, found ${stageTags.length} — the shared style cannot be derived`,
    );
    return { failures, code };
  }
  const stageTag = stageTags[0];
  const expr = propExpression(stageTag.text, 'posterHeroStyle');
  if (!expr) {
    failures.push(
      'one-hero-style-shared-by-both-trees: the <DeckSwipeStage> call site passes no '
      + 'posterHeroStyle={...}. Without it the poster hero has no style at all and its box '
      + "collapses to its children's intrinsic size, which is not the face hero's rectangle",
    );
    return { failures, code, stageTag };
  }
  const elements = expr.startsWith('[') ? arrayElements(expr) : [expr];
  if (!elements || elements.length < 1) {
    failures.push(
      'one-hero-style-shared-by-both-trees: the posterHeroStyle expression '
      + `${JSON.stringify(expr)} yielded no style entries`,
    );
    return { failures, code, stageTag };
  }
  const names = [];
  for (const element of elements) {
    const m = /^styles\.([A-Za-z_$][\w$]*)$/.exec(element);
    if (!m) {
      failures.push(
        'one-hero-style-shared-by-both-trees: posterHeroStyle entry '
        + `${JSON.stringify(element)} is not a plain styles.<name> reference. An inline `
        + 'object literal here is a SECOND authored geometry that the face tree never sees, '
        + 'which is precisely the two-sources-of-truth shape #1593 was opened for',
      );
      continue;
    }
    names.push(m[1]);
  }
  if (failures.length > 0) return { failures, code, stageTag, elements };

  // Which of those styles does the FACE tree also apply, bare, to a <View>? Exactly one
  // must — that one IS the single source, derived rather than named.
  const faceMap = bareStyleViewNames(code);
  const shared = names.filter((n) => faceMap.has(n));
  if (shared.length !== 1) {
    failures.push(
      'one-hero-style-shared-by-both-trees: expected exactly ONE style object that the '
      + `poster tree and the face tree BOTH use, derived ${shared.length} from poster styles `
      + `${JSON.stringify(names)}. Two look-alike style objects (a "posterHeroFill" twin of `
      + '"heroFill") satisfy every visual check on the day they are written and then drift '
      + 'apart the first time one of them is edited — that is the #1593 defect with the '
      + 'measurement removed, and it has no runtime symptom until it does',
    );
    return { failures, code, stageTag, elements, names, faceMap };
  }
  const heroName = shared[0];
  return {
    failures,
    code,
    stageTag,
    elements,
    names,
    faceMap,
    heroName,
    layeredNames: names.filter((n) => n !== heroName),
  };
}

function checkSingleSourcedHeroStyle(src) {
  const d = deriveHeroStyle(src);
  const failures = [...d.failures];
  const examined = { stageCallSites: 0, posterStyleEntries: 0, faceHeroNodes: 0, posterHeroNodes: 0 };
  if (!d.heroName) return { failures, examined };

  examined.stageCallSites = 1;
  examined.posterStyleEntries = d.elements.length;

  const faceNodes = d.faceMap.get(d.heroName);
  examined.faceHeroNodes = faceNodes.length;
  if (faceNodes.length !== 1) {
    failures.push(
      `one-hero-style-shared-by-both-trees: expected exactly ONE face-tree <View> applying `
      + `styles.${d.heroName}, found ${faceNodes.length}`,
    );
  } else {
    const gestureAt = d.code.indexOf('<GestureDetector');
    if (gestureAt < 0) {
      failures.push(
        'one-hero-style-shared-by-both-trees: no <GestureDetector> in SwipeableCards — the '
        + 'current-card subtree anchor is gone and the face hero cannot be located',
      );
    } else if (faceNodes[0].start < gestureAt) {
      failures.push(
        'one-hero-style-shared-by-both-trees: the face hero sits OUTSIDE the current-card '
        + 'GestureDetector subtree. The rectangle this invariant is about is the promoted '
        + "card's, not the behind preview's",
      );
    }
  }

  const stageCode = stripCommentsAndStrings(src.stage);
  const posterNodes = openingTags(stageCode, 'View')
    .filter((t) => propExpression(t.text, 'style') === 'props.posterHeroStyle');
  examined.posterHeroNodes = posterNodes.length;
  if (posterNodes.length !== 1) {
    failures.push(
      'one-hero-style-shared-by-both-trees: expected exactly ONE <View> in DeckSwipeStage '
      + `whose style is exactly props.posterHeroStyle, found ${posterNodes.length}. An array `
      + 'here would let a second style win the cascade later-wins, and zero means the poster '
      + 'hero is unstyled',
    );
  }
  return { failures, examined, heroName: d.heroName, layeredNames: d.layeredNames };
}

function checkHeroStyleIsAxisFree(src) {
  const d = deriveHeroStyle(src);
  const examined = { heroStyleEntries: 0, layeredStyles: 0 };
  if (!d.heroName) {
    return {
      failures: [
        'hero-style-carries-no-flex-axis: the shared hero style could not be derived, so its '
        + 'axis-freedom is unverifiable — see the single-source checker',
      ],
      examined,
    };
  }
  const failures = [];
  const text = stripComments(src.swipeable, { keepStrings: true });
  const styles = extractStylesBlock(text, 'hero-style-carries-no-flex-axis');
  failures.push(...styles.failures);
  if (!styles.block) return { failures, examined };

  const hero = extractStyleBody(styles.block, d.heroName, 'hero-style-carries-no-flex-axis');
  failures.push(...hero.failures);
  if (hero.entries) {
    examined.heroStyleEntries = hero.entries.length;

    for (const key of geometryKeysIn(hero.entries)) {
      failures.push(
        `hero-style-carries-no-flex-axis: styles.${d.heroName} declares \`${key}\`. `
        + 'The shared hero style must resolve WITHOUT reference to its siblings. #1593 was '
        + 'exactly this: one style carrying `flex: 0.88` resolved to 689.00pt under the '
        + "poster's single child and 667.67pt under the face's two, and the 21.33pt overhang "
        + 'bled through the tray as a pale bar in production',
      );
    }

    const spreads = hero.entries.filter((e) => e.startsWith('...'));
    if (spreads.length !== 1) {
      failures.push(
        `hero-style-carries-no-flex-axis: styles.${d.heroName} must contain exactly ONE `
        + `spread, found ${spreads.length}`,
      );
    } else if (spreads[0] !== '...StyleSheet.absoluteFillObject') {
      failures.push(
        `hero-style-carries-no-flex-axis: styles.${d.heroName} spreads `
        + `${JSON.stringify(spreads[0])} rather than StyleSheet.absoluteFillObject. The `
        + 'absolute fill is the whole mechanism: it pins all four edges to the containing '
        + 'block, so both trees resolve to the same rectangle with no measurement at all',
      );
    }
  }

  examined.layeredStyles = d.layeredNames.length;
  for (const name of d.layeredNames) {
    const layered = extractStyleBody(
      styles.block, name, 'layered-poster-styles-carry-no-geometry',
    );
    failures.push(...layered.failures);
    if (!layered.entries) continue;
    for (const key of geometryKeysIn(layered.entries)) {
      failures.push(
        `layered-poster-styles-carry-no-geometry: styles.${name} is layered OVER the shared `
        + `hero style at the poster only, and it declares \`${key}\`. React Native flattens `
        + 'style arrays later-wins, so that key silently changes the poster rectangle and '
        + 'not the face one — the two layers disagree again, and only on the poster',
      );
    }
  }
  return { failures, examined, heroName: d.heroName };
}

function checkSharedContainingBox(src) {
  const failures = [];
  const examined = { faceContainingBoxes: 0, posterContainingBoxes: 0, posterChildViews: 0 };
  const code = stripCommentsAndStrings(src.swipeable);
  const text = stripComments(src.swipeable, { keepStrings: true });

  const stageTags = openingTags(code, 'DeckSwipeStage');
  if (stageTags.length !== 1) {
    failures.push(
      'both-trees-share-one-containing-box: expected exactly ONE <DeckSwipeStage> call site, '
      + `found ${stageTags.length}`,
    );
    return { failures, examined };
  }
  const tag = stageTags[0].text;

  const innerExpr = propExpression(tag, 'cardInnerStyle');
  const innerMatch = innerExpr && /^styles\.([A-Za-z_$][\w$]*)$/.exec(innerExpr);
  if (!innerMatch) {
    failures.push(
      'both-trees-share-one-containing-box: cardInnerStyle must be a plain styles.<name> '
      + `reference so both trees provably share ONE containing block, got `
      + `${JSON.stringify(innerExpr)}`,
    );
    return { failures, examined };
  }
  const innerName = innerMatch[1];

  const cardExpr = propExpression(tag, 'cardStyle');
  const cardMatch = cardExpr && /^styles\.([A-Za-z_$][\w$]*)$/.exec(cardExpr);
  if (!cardMatch) {
    failures.push(
      'both-trees-share-one-containing-box: cardStyle must be a plain styles.<name> '
      + `reference, got ${JSON.stringify(cardExpr)}`,
    );
    return { failures, examined };
  }

  // The face tree uses the SAME containing-box style: once for the behind preview face and
  // once for the promoted face. Both, because the promotion swap must not change geometry.
  const faceMap = bareStyleViewNames(code);
  const faceBoxes = faceMap.get(innerName) || [];
  examined.faceContainingBoxes = faceBoxes.length;
  if (faceBoxes.length !== 2) {
    failures.push(
      `both-trees-share-one-containing-box: expected exactly 2 face-tree <View>s applying `
      + `styles.${innerName} (the behind face and the promoted face), found `
      + `${faceBoxes.length}`,
    );
  }

  // `flex: 1` inside an absolutely-positioned card is what makes the containing block
  // DEFINITE. An absolute fill inside an indefinite box has nothing to fill.
  const styles = extractStylesBlock(text, 'both-trees-share-one-containing-box');
  failures.push(...styles.failures);
  if (!styles.block) return { failures, examined };
  const innerStyle = extractStyleBody(
    styles.block, innerName, 'both-trees-share-one-containing-box',
  );
  failures.push(...innerStyle.failures);
  if (innerStyle.entries && !innerStyle.entries.some((e) => /^flex\s*:\s*1$/.test(e))) {
    failures.push(
      `both-trees-share-one-containing-box: styles.${innerName} is no longer \`flex: 1\`. `
      + 'The absolute fill resolves against THIS box; if it stops filling the card, the two '
      + 'trees start resolving different rectangles again',
    );
  }

  const cardStyle = extractStyleBody(
    styles.block, cardMatch[1], 'both-trees-share-one-containing-box',
  );
  failures.push(...cardStyle.failures);
  if (cardStyle.entries) {
    const hasAbsolute = cardStyle.entries.some((e) => /^position\s*:\s*["']absolute["']$/.test(e));
    const hasTop = cardStyle.entries.some((e) => /^top\s*:/.test(e));
    const hasBottom = cardStyle.entries.some((e) => /^bottom\s*:/.test(e));
    if (!(hasAbsolute && hasTop && hasBottom)) {
      failures.push(
        `both-trees-share-one-containing-box: styles.${cardMatch[1]} must stay absolutely `
        + 'positioned with both top and bottom pinned. That is what gives the card — and '
        + 'therefore the hero — a definite height in BOTH trees without measuring anything',
      );
    }
  }

  // In the poster tree the hero must be the containing box's ONLY child. One extra wrapper
  // re-anchors the absolute fill to the wrapper and the two rectangles diverge silently.
  const stageCode = stripCommentsAndStrings(src.stage);
  const posterBoxes = openingTags(stageCode, 'View')
    .filter((t) => propExpression(t.text, 'style') === 'props.cardInnerStyle');
  examined.posterContainingBoxes = posterBoxes.length;
  if (posterBoxes.length !== 1) {
    failures.push(
      'both-trees-share-one-containing-box: expected exactly ONE <View> in DeckSwipeStage '
      + `whose style is exactly props.cardInnerStyle, found ${posterBoxes.length}`,
    );
    return { failures, examined };
  }
  const inner = innerTextOf(stageCode, 'View', posterBoxes[0]);
  if (inner === null) {
    failures.push(
      'both-trees-share-one-containing-box: could not balance the poster containing box '
      + 'element — its children cannot be enumerated',
    );
    return { failures, examined };
  }
  const childViews = openingTags(inner, 'View');
  examined.posterChildViews = childViews.length;
  if (childViews.length !== 1) {
    failures.push(
      'both-trees-share-one-containing-box: the poster containing box must have exactly ONE '
      + `child <View> — the hero — found ${childViews.length}. An intermediate wrapper `
      + 'becomes the absolute fill\'s new containing block, so the poster hero silently '
      + 'stops matching the face hero',
    );
  } else if (propExpression(childViews[0].text, 'style') !== 'props.posterHeroStyle') {
    failures.push(
      "both-trees-share-one-containing-box: the poster containing box's only child is not "
      + `the hero (style ${JSON.stringify(propExpression(childViews[0].text, 'style'))})`,
    );
  }
  return { failures, examined };
}

/**
 * #1609 DELETED the measure-and-copy mechanism rather than layering the redesign on top of
 * it. A half-migration — the new full-bleed hero PLUS a surviving measurement path — is the
 * worst of both: two sources of truth again, one of them invisible.
 */
const SUPERSEDED_TOKENS = [
  'heroHoleHeight',
  'posterPhotoBoxOverride',
  'deckPosterGeometry',
  'imageContainerStyle',
  'IMAGE_SECTION_RATIO',
  'DETAILS_SECTION_RATIO',
  'cardDetails',
  'transparentImageContainer',
];

function checkSupersededPlumbingAbsent(src) {
  const failures = [];
  const files = [
    ['SwipeableCards', stripCommentsAndStrings(src.swipeable)],
    ['DeckSwipeStage', stripCommentsAndStrings(src.stage)],
  ];
  for (const [label, code] of files) {
    for (const token of SUPERSEDED_TOKENS) {
      if (new RegExp(`\\b${token}\\b`).test(code)) {
        failures.push(
          `superseded-1593-plumbing-is-absent: ${label} references \`${token}\` in CODE. `
          + '#1609 removed the flex-axis disagreement entirely, so measuring one tree and '
          + 'copying the number to the other — and the white tray that made them disagree — '
          + 'are dead. Reviving either re-creates a second source of truth. (This check runs '
          + 'on comment-stripped source on purpose: these names still appear in comments '
          + 'documenting what was removed, and a raw-source check would be unfalsifiable.)',
        );
      }
    }
  }
  if (existsSync(path.join(src.__root, DELETED_GEOMETRY_MODULE))) {
    failures.push(
      'superseded-1593-plumbing-is-absent: deckPosterGeometry.ts is back on disk. That '
      + 'module IS the measure-and-copy mechanism; its return means the redesign is being '
      + 'stacked on top of what it replaced instead of replacing it',
    );
  }
  return { failures, examined: { filesScanned: files.length, tokensChecked: SUPERSEDED_TOKENS.length } };
}

// --- #1576 / #1579 non-interference (mechanism-independent, preserved verbatim) ---

function findControllerIdentifier(render) {
  const match = /const\s+([A-Za-z_$][\w$]*)\s*=\s*useDeckSwipeController\(/.exec(render);
  return match ? match[1] : null;
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
  const close = matchDelimiter(openingTag, braceOpen);
  if (close < 0) return [];
  const styleExpression = openingTag.slice(braceOpen, close + 1);
  const refRe = new RegExp(`\\b${controllerIdent}\\.([A-Za-z_$][\\w$]*)\\b`, 'g');
  const names = new Set();
  let m = refRe.exec(styleExpression);
  while (m) { names.add(m[1]); m = refRe.exec(styleExpression); }
  return [...names];
}

function check1576SwapSet(src) {
  const failures = [];
  const examined = { keyedMapElements: 0, swapSets: 0, innerViews: 0 };
  const stage = src.stage;
  const controllerIdent = findControllerIdentifier(stage);
  if (!controllerIdent) {
    failures.push(
      'swap-set-still-exactly-two-styles: no `= useDeckSwipeController(` in DeckSwipeStage — '
      + "#1576's derivation has no anchor",
    );
    return { failures, examined };
  }
  const elements = findKeyedMapElements(stage);
  examined.keyedMapElements = elements.length;
  if (elements.length < 1) {
    failures.push(
      'swap-set-still-exactly-two-styles: no keyed .map() element found in DeckSwipeStage',
    );
    return { failures, examined };
  }
  const swapSets = elements
    .map((el) => stylesReferencedIn(el.openingTag, controllerIdent))
    .filter((styles) => styles.length >= 2);
  examined.swapSets = swapSets.length;
  if (swapSets.length !== 1) {
    failures.push(
      'swap-set-still-exactly-two-styles: #1576 A-0 requires exactly ONE keyed node whose '
      + `style prop reaches 2+ controller styles, derived ${swapSets.length}`,
    );
    return { failures, examined };
  }
  const got = [...swapSets[0]].sort();
  const want = ['currentCardStyle', 'previewCardStyle'];
  if (got.join(',') !== want.join(',')) {
    failures.push(
      'swap-set-still-exactly-two-styles: the swapped animated styles changed to '
      + `${JSON.stringify(got)}`,
    );
  }
  const stripped = stripCommentsAndStrings(stage);
  const innerViews = openingTags(stripped, 'View');
  examined.innerViews = innerViews.length;
  if (innerViews.length < 1) {
    failures.push(
      'poster-carries-no-key-prop: no inner <View> found in DeckSwipeStage — this check '
      + 'would pass by finding nothing',
    );
  }
  for (const tag of innerViews) {
    if (/\bkey=/.test(tag.text)) {
      failures.push(
        `poster-carries-no-key-prop: an inner <View> gained a key= (${tag.text.slice(0, 60)}) `
        + "— #1576's swap-set derivation enumerates BY key= and would derive a second element",
      );
    }
  }
  return { failures, examined };
}

function check1579PosterNonInteractive(src) {
  const failures = [];
  const stripped = stripCommentsAndStrings(src.stage);
  const text = stripComments(src.stage, { keepStrings: true });
  if (!/pointerEvents="none"/.test(text)) {
    failures.push(
      'poster-remains-non-interactive: the poster node must stay pointerEvents="none". A '
      + 'poster that can take touches can take the admission lease #1579 protects',
    );
  }
  const tokens = ['Gesture', 'onPress', 'onTouches', 'runOnJS'];
  for (const token of tokens) {
    if (stripped.includes(token)) {
      failures.push(
        `poster-remains-non-interactive: DeckSwipeStage gained a "${token}" token — this `
        + 'layer must never participate in admission (#1579)',
      );
    }
  }
  return { failures, examined: { forbiddenTokens: tokens.length } };
}

function check1576MutantAnchors(src) {
  // #1576's f_third_style_in_swap_set and g_new_branch_in_style_prop are built by
  // .replace() on these EXACT strings at module load. Reindenting DeckSwipeStage makes
  // those replaces no-op, and #1576's A-4 then fails on assert.notEqual(mutant, source).
  const failures = [];
  const anchors = [
    [': [controller.currentCardStyle, {', 'f'],
    ["card.role === 'behind'\n" + ' '.repeat(16) + '? [controller.previewCardStyle, {', 'g'],
  ];
  for (const [anchor, label] of anchors) {
    if (!src.stage.includes(anchor)) {
      failures.push(
        `mutant-anchors-are-byte-intact: the #1576 mutant (${label}) anchor changed — that `
        + "battery's .replace() would silently become a no-op and #1576 would report green "
        + 'against a mutant it never applied',
      );
    }
  }
  return { failures, examined: { anchors: anchors.length } };
}

// --- The workflow really requires AND executes both guards ---

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

function checkWorkflow(src) {
  const failures = [];
  const blocks = runBlocks(src.workflow);
  const examined = { runBlocks: blocks.length, guardFiles: 3 };
  if (blocks.length !== 2) {
    failures.push(
      'workflow-requires-and-executes-both-guards: expected exactly 2 run: blocks in the '
      + `#1593 workflow (require, then execute), parsed ${blocks.length}`,
    );
    return { failures, examined };
  }
  for (const file of [REL.implementor, REL.adversarial, SUCCESSOR_GUARD]) {
    if (!blocks.some((b) => b.includes(`test -f ${file}`))) {
      failures.push(
        `workflow-requires-and-executes-both-guards: no run step does \`test -f\` on ${file} `
        + '(a name that appears only in a comment is not enforcement)',
      );
    }
    if (!blocks.some((b) => /node --test/.test(b) && b.includes(file))) {
      failures.push(
        `workflow-requires-and-executes-both-guards: no \`node --test\` step executes ${file}`,
      );
    }
  }
  if (!/node-version: ['"]22['"]/.test(src.workflow)) {
    failures.push(
      'workflow-requires-and-executes-both-guards: the job must pin Node 22 — the successor '
      + 'guard imports deckHeroConstants.ts and depends on native type-stripping',
    );
  }
  for (const needle of [
    /app-mobile\/src\/components\/SwipeableCards\.tsx/,
    /app-mobile\/src\/components\/swipeDeck\/\*\*/,
  ]) {
    if (!needle.test(src.workflow)) {
      failures.push(
        `workflow-requires-and-executes-both-guards: the paths filter is missing ${needle} — `
        + 'a gate that does not run on the files it protects is decoration',
      );
    }
  }
  for (const [label, key] of [['implementor', 'implementor'], ['adversarial', 'adversarial']]) {
    if (src[key].length < 500) {
      failures.push(
        `both-named-guards-exist-and-are-non-stub: the ${label} guard is only `
        + `${src[key].length} chars. Emptying a guard the workflow still runs turns a red `
        + 'gate green without changing a line of product code',
      );
    }
  }
  return { failures, examined };
}

const CHECKERS = [
  ['single-source', checkSingleSourcedHeroStyle],
  ['axis-free', checkHeroStyleIsAxisFree],
  ['containing-box', checkSharedContainingBox],
  ['plumbing', checkSupersededPlumbingAbsent],
  ['1576-swap-set', check1576SwapSet],
  ['1579-non-interactive', check1579PosterNonInteractive],
  ['1576-anchors', check1576MutantAnchors],
  ['workflow', checkWorkflow],
];

function runAllCheckers(src) {
  const out = [];
  for (const [name, fn] of CHECKERS) {
    try {
      for (const f of fn(src).failures) out.push(`${name} | ${f}`);
    } catch (e) {
      out.push(`${name} | THREW ${e.message}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// X-1 — the poster and the face are handed the SAME style OBJECT, derived not named.
// ---------------------------------------------------------------------------

test('X-1 exactly one style object is shared by the poster tree and the face tree, derived', () => {
  const r = checkSingleSourcedHeroStyle(source);
  assert.deepEqual(r.failures, [], r.failures.join('\n  '));
  assert.equal(r.examined.stageCallSites, 1, 'VACUITY: no stage call site was examined');
  assert.ok(
    r.examined.posterStyleEntries >= 1,
    `VACUITY: the poster hero style expression yielded ${r.examined.posterStyleEntries} entries`,
  );
  assert.equal(r.examined.faceHeroNodes, 1, 'VACUITY: the face hero node count is not 1');
  assert.equal(r.examined.posterHeroNodes, 1, 'VACUITY: the poster hero node count is not 1');
  console.log(
    `X-1 derived shared hero style "styles.${r.heroName}" from `
    + `${r.examined.posterStyleEntries} poster style entries; `
    + `${r.examined.faceHeroNodes} face node, ${r.examined.posterHeroNodes} poster node, `
    + `${r.layeredNames.length} layered poster-only style(s)`,
  );
});

// ---------------------------------------------------------------------------
// X-2 — that shared style has NO flex axis and no explicit box. This is the direct
// successor to the #1593 defect: `flex: 0.88` on this style IS the bug.
// ---------------------------------------------------------------------------

test('X-2 the shared hero style is an axis-free absolute fill, and nothing geometric is layered over it', () => {
  const r = checkHeroStyleIsAxisFree(source);
  assert.deepEqual(r.failures, [], r.failures.join('\n  '));
  assert.ok(
    r.examined.heroStyleEntries >= 1,
    `VACUITY: the hero style body parsed to ${r.examined.heroStyleEntries} entries — zero `
    + 'targets would let this test pass by inspecting nothing',
  );
  console.log(
    `X-2 examined styles.${r.heroName}: ${r.examined.heroStyleEntries} top-level entries, `
    + `plus ${r.examined.layeredStyles} poster-only layered style(s), against `
    + `${GEOMETRY_KEYS.size} forbidden geometry keys`,
  );
});

// ---------------------------------------------------------------------------
// X-3 — both trees hang the hero off the SAME definite-height box, as its only child.
// An absolute fill is only single-sourced if its containing block is.
// ---------------------------------------------------------------------------

test('X-3 both trees hang the hero off one shared definite-height containing box, as its only child', () => {
  const r = checkSharedContainingBox(source);
  assert.deepEqual(r.failures, [], r.failures.join('\n  '));
  assert.equal(r.examined.faceContainingBoxes, 2, 'VACUITY: face containing-box count is not 2');
  assert.equal(r.examined.posterContainingBoxes, 1, 'VACUITY: poster containing-box count is not 1');
  assert.equal(r.examined.posterChildViews, 1, 'VACUITY: poster child <View> count is not 1');
  console.log(
    `X-3 examined ${r.examined.faceContainingBoxes} face containing boxes, `
    + `${r.examined.posterContainingBoxes} poster containing box, `
    + `${r.examined.posterChildViews} poster child <View>`,
  );
});

// ---------------------------------------------------------------------------
// X-4 — the superseded mechanism is GONE, not layered underneath.
// ---------------------------------------------------------------------------

test('X-4 the superseded #1593 measure-and-copy plumbing is absent from both trees', () => {
  const r = checkSupersededPlumbingAbsent(source);
  assert.deepEqual(r.failures, [], r.failures.join('\n  '));
  assert.equal(r.examined.filesScanned, 2);
  assert.equal(
    r.examined.tokensChecked,
    SUPERSEDED_TOKENS.length,
    'VACUITY: the superseded-token list shrank',
  );
  assert.ok(
    SUPERSEDED_TOKENS.length >= 8,
    `VACUITY: only ${SUPERSEDED_TOKENS.length} superseded tokens are checked`,
  );
  console.log(
    `X-4 examined ${r.examined.filesScanned} files against `
    + `${r.examined.tokensChecked} superseded tokens, plus the deleted module path`,
  );
});

// ---------------------------------------------------------------------------
// X-5 — mutation battery. A guard nobody has tried to fool has unknown discriminating
// power. Each mutant proves its own anchor exists AND that the file really changed.
// ---------------------------------------------------------------------------

const MIRROR_FILES = Object.keys(REL);

const HERO_FILL_BLOCK = '  heroFill: {\n    ...StyleSheet.absoluteFillObject,\n  },';
const BACKDROP_BLOCK = "  posterHeroBackdrop: {\n    backgroundColor: '#1a1a2e',\n  },";
const POSTER_PROP = 'posterHeroStyle={[styles.heroFill, styles.posterHeroBackdrop]}';
const FACE_HERO_OPEN = '                  <View\n                    style={styles.heroFill}';
const POSTER_HERO_NODE = '<View style={props.posterHeroStyle}>{card.poster}</View>';
const POSTER_SUBTREE =
  '            <View style={props.cardInnerStyle}>\n'
  + '              <View style={props.posterHeroStyle}>{card.poster}</View>\n'
  + '            </View>';

const MUTANTS = [
  {
    // The #1593 defect class, restored in one token on the new mechanism.
    id: 'a_hero_fill_regains_flex_ratio',
    edits: [['swipeable', HERO_FILL_BLOCK, '  heroFill: {\n    flex: 0.88,\n  },']],
  },
  {
    id: 'b_hero_fill_gains_explicit_height',
    edits: [['swipeable', HERO_FILL_BLOCK,
      '  heroFill: {\n    ...StyleSheet.absoluteFillObject,\n    height: 667.67,\n  },']],
  },
  {
    id: 'c_hero_fill_regains_flex_grow',
    edits: [['swipeable', HERO_FILL_BLOCK, '  heroFill: {\n    flexGrow: 1,\n  },']],
  },
  {
    // The subtle one: a look-alike TWIN style for the poster. Identical today, geometry-free
    // today, and completely undetectable except by proving the two trees share ONE object.
    id: 'd_poster_gets_a_twin_style_object',
    edits: [
      ['swipeable', BACKDROP_BLOCK,
        '  posterHeroFill: {\n    ...StyleSheet.absoluteFillObject,\n  },\n' + BACKDROP_BLOCK],
      ['swipeable', POSTER_PROP,
        'posterHeroStyle={[styles.posterHeroFill, styles.posterHeroBackdrop]}'],
    ],
  },
  {
    id: 'e_layered_poster_style_gains_geometry',
    edits: [['swipeable', BACKDROP_BLOCK,
      "  posterHeroBackdrop: {\n    backgroundColor: '#1a1a2e',\n    height: '88%',\n  },"]],
  },
  {
    // The white tray comes back as a flex sibling.
    id: 'f_white_tray_sibling_reintroduced',
    edits: [
      ['swipeable', '  posterHeroBackdrop: {',
        "  cardDetails: {\n    flex: 0.12,\n    backgroundColor: 'rgba(255,255,255,0.85)',\n  },\n"
        + '  posterHeroBackdrop: {'],
      ['swipeable', FACE_HERO_OPEN,
        '                  <View style={styles.cardDetails} />\n' + FACE_HERO_OPEN],
    ],
  },
  {
    id: 'g_poster_hero_nested_under_a_wrapper',
    edits: [['stage', POSTER_SUBTREE,
      '            <View style={props.cardInnerStyle}>\n'
      + '              <View style={{ flex: 0.88 }}>\n'
      + '                <View style={props.posterHeroStyle}>{card.poster}</View>\n'
      + '              </View>\n'
      + '            </View>']],
  },
  {
    id: 'h_poster_hero_style_prop_dropped',
    edits: [['stage', POSTER_HERO_NODE, '<View>{card.poster}</View>']],
  },
  {
    id: 'i_containing_box_loses_flex_one',
    edits: [['swipeable', '  cardInner: {\n    flex: 1,', '  cardInner: {\n    flex: 0.88,']],
  },
  {
    id: 'j_measurement_plumbing_resurrected',
    edits: [['swipeable', '            ' + POSTER_PROP + '\n',
      '            ' + POSTER_PROP + '\n            heroHoleHeight={heroLayout.height}\n']],
  },
  {
    id: 'k_poster_view_gains_a_key_prop',
    edits: [['stage', '<View style={props.posterHeroStyle}>',
      '<View key={card.id} style={props.posterHeroStyle}>']],
  },
  {
    id: 'l_poster_becomes_touchable',
    edits: [['stage', 'pointerEvents="none"', 'pointerEvents="auto"']],
  },
  {
    id: 'm_1576_anchor_reindented',
    edits: [['stage', '                ? [controller.previewCardStyle, {',
      '              ? [controller.previewCardStyle, {']],
  },
  {
    id: 'n_workflow_stops_executing_this_guard',
    edits: [['workflow', 'test -f ' + REL.adversarial + '\\n', '']],
  },
  {
    id: 'o_implementor_guard_stubbed_out',
    replaceFile: ['implementor', '// gutted\n'],
  },
];

function buildMirror(mutant) {
  const dir = mkdtempSync(path.join(tmpdir(), 'issue1609-adv-'));
  for (const key of MIRROR_FILES) {
    const dst = path.join(dir, REL[key]);
    mkdirSync(path.dirname(dst), { recursive: true });
    cpSync(path.join(REPO_ROOT, REL[key]), dst);
  }
  for (const [key, from, to] of (mutant.edits || [])) {
    const p = path.join(dir, REL[key]);
    const before = readFileSync(p, 'utf8');
    assert.ok(
      before.includes(from),
      `mutants-rejected-with-distinct-signatures: mutant ${mutant.id} anchor missing in `
      + `${REL[key]}: ${JSON.stringify(from.slice(0, 70))}. A battery whose anchors have gone `
      + 'stale is a battery of no-ops that reports green — the #1607 failure this guard '
      + 'exists to avoid repeating.',
    );
    const after = before.replaceAll(from, to);
    assert.notEqual(
      after,
      before,
      `mutants-rejected-with-distinct-signatures: mutant ${mutant.id} did not change `
      + `${REL[key]} — a no-op .replace() cannot be "killed" by anything`,
    );
    writeFileSync(p, after);
  }
  if (mutant.replaceFile) {
    const [key, content] = mutant.replaceFile;
    const p = path.join(dir, REL[key]);
    const before = readFileSync(p, 'utf8');
    assert.notEqual(
      content,
      before,
      `mutants-rejected-with-distinct-signatures: mutant ${mutant.id} rewrote ${REL[key]} `
      + 'to its own current content',
    );
    writeFileSync(p, content);
  }
  return dir;
}

function runGuardInMirror(dir) {
  // A nested `node --test` INHERITS NODE_TEST_CONTEXT from this run and then emits the
  // child-reporter stream instead of TAP, so `# fail 0` never appears and every mutant
  // reads as "killed". That masking has already produced a false-green gate in this repo;
  // strip it, or this whole battery becomes a rubber stamp.
  const env = { ...process.env, ISSUE_1609_ADVERSARIAL_MIRROR: '1' };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(dir, REL.adversarial)], {
    encoding: 'utf8',
    env,
    timeout: 120000,
  });
  const stdout = r.stdout || '';
  return {
    green: r.status === 0 && /^# fail 0$/m.test(stdout),
    failing: [...stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map((m) => m[1]),
  };
}

test('X-5 mutation battery — every mutant is rejected, with a distinct failure signature', { skip: IN_MIRROR }, () => {
  assert.ok(
    MUTANTS.length >= 12,
    'mutants-rejected-with-distinct-signatures: this battery requires >= 12 mutants, have '
    + `${MUTANTS.length}`,
  );
  assert.equal(
    new Set(MUTANTS.map((m) => m.id)).size,
    MUTANTS.length,
    'mutants-rejected-with-distinct-signatures: mutant ids must be unique',
  );

  // Control: an UNMUTATED mirror must be green in-process AND as a subprocess, or every
  // "kill" below is meaningless.
  const controlDir = buildMirror({ id: 'control', edits: [] });
  const controlFailures = runAllCheckers(loadSources(controlDir));
  assert.deepEqual(
    controlFailures,
    [],
    'mutants-rejected-with-distinct-signatures: the UNMUTATED mirror already fails — '
    + `${controlFailures.join(' | ')}`,
  );
  const controlRun = runGuardInMirror(controlDir);
  assert.ok(
    controlRun.green,
    'mutants-rejected-with-distinct-signatures: the UNMUTATED mirror failed as a subprocess '
    + `(${controlRun.failing.join('; ')}) — the battery cannot distinguish anything`,
  );
  rmSync(controlDir, { recursive: true, force: true });

  const survivors = [];
  const signatures = new Map();

  for (const mutant of MUTANTS) {
    const dir = buildMirror(mutant);
    try {
      const failures = runAllCheckers(loadSources(dir));
      if (failures.length === 0) {
        survivors.push(`${mutant.id} (checkers)`);
        signatures.set(mutant.id, '<SURVIVED>');
        continue;
      }
      signatures.set(mutant.id, [...failures].sort().join(' || '));

      // And prove the GUARD FILE — the thing CI actually runs — rejects it too.
      const run = runGuardInMirror(dir);
      if (run.green) survivors.push(`${mutant.id} (guard subprocess)`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  assert.deepEqual(
    survivors,
    [],
    'mutants-rejected-with-distinct-signatures: these mutants were NOT rejected — '
    + `${survivors.join(', ')}`,
  );

  const distinct = new Set(signatures.values());
  assert.equal(
    distinct.size,
    MUTANTS.length,
    'mutants-rejected-with-distinct-signatures: this guard diagnosed '
    + `${MUTANTS.length} mutants with only ${distinct.size} distinct signature(s) — it is `
    + 'detecting "something changed" rather than what changed. Signatures: '
    + [...signatures.entries()].map(([k, v]) => `${k} => ${v.slice(0, 80)}`).join(' ; '),
  );

  console.log(`X-5 examined ${MUTANTS.length} mutants, 0 survivors, ${distinct.size} distinct signatures`);
  for (const [id, sig] of signatures) console.log(`    ${id}: ${sig.split(' | ')[0]}`);
});

// ---------------------------------------------------------------------------
// X-6 / X-7 / X-8 — non-interference with #1576 and #1579, and the frozen anchors.
// These do NOT depend on #1593's deleted mechanism and are preserved as-is.
// ---------------------------------------------------------------------------

test('X-6 #1576 non-interference — the derived animated-style swap set is unchanged', () => {
  const r = check1576SwapSet(source);
  assert.deepEqual(r.failures, [], r.failures.join('\n  '));
  assert.ok(r.examined.keyedMapElements >= 1, 'VACUITY: no keyed map elements examined');
  assert.equal(r.examined.swapSets, 1, 'VACUITY: the swap-set count is not 1');
  assert.ok(r.examined.innerViews >= 1, 'VACUITY: no inner <View> examined');
  console.log(
    `X-6 examined ${r.examined.keyedMapElements} keyed map elements, `
    + `${r.examined.swapSets} swap set, ${r.examined.innerViews} inner <View>s`,
  );
});

test('X-7 #1579 non-interference — the poster layer remains incapable of holding a lease', () => {
  const r = check1579PosterNonInteractive(source);
  assert.deepEqual(r.failures, [], r.failures.join('\n  '));
  assert.equal(r.examined.forbiddenTokens, 4, 'VACUITY: the forbidden-token list shrank');
  console.log(`X-7 examined ${r.examined.forbiddenTokens} forbidden interaction tokens`);
});

test('X-8 the #1576 A-4 mutant anchors in DeckSwipeStage are still byte-exact', () => {
  const r = check1576MutantAnchors(source);
  assert.deepEqual(r.failures, [], r.failures.join('\n  '));
  assert.equal(r.examined.anchors, 2, 'VACUITY: the anchor list shrank');
  console.log(`X-8 examined ${r.examined.anchors} byte-exact #1576 anchors`);
});

// ---------------------------------------------------------------------------
// X-9 — the workflow must REQUIRE and EXECUTE both guards. Comments do not gate.
// ---------------------------------------------------------------------------

test('X-9 the workflow requires AND executes both guards, and a commented mention does not count', () => {
  const r = checkWorkflow(source);
  assert.deepEqual(r.failures, [], r.failures.join('\n  '));
  assert.equal(r.examined.runBlocks, 2, 'VACUITY: the run-block count is not 2');

  // Negative control: the parser must NOT be satisfiable by a commented-out mention.
  const commented = runBlocks(
    'jobs:\n  x:\n    steps:\n      - run: |\n'
    + `          # test -f ${REL.adversarial}\n`
    + `          # node --test ${REL.adversarial}\n`,
  );
  assert.equal(commented.length, 1, 'VACUITY: the negative control parsed no run block');
  assert.ok(
    !commented[0].includes(`test -f ${REL.adversarial}`),
    'workflow-requires-and-executes-both-guards: the run-block parser accepts a filename '
    + 'parked behind a shell `#` — a commented gate would satisfy this test',
  );

  // #1593 gets its OWN workflow so the other issues' steps keep their exact guard counts.
  for (const foreign of [/issue_1481_/, /issue_1576_/, /issue_1579_/]) {
    assert.doesNotMatch(
      source.workflow,
      foreign,
      `the #1593 workflow must not reference ${foreign} — those jobs own their own guard lists`,
    );
  }
  console.log(`X-9 examined ${r.examined.runBlocks} run blocks, ${r.examined.guardFiles} guard files, 1 negative control`);
});

// ---------------------------------------------------------------------------
// X-10 — this file asserts everything its own comments claim (#1607 Discovery 2).
// ---------------------------------------------------------------------------

test('X-10 every CLAIM in this file’s header is really enforced in this file’s code', () => {
  const self = source.adversarial;
  const claims = [...self.matchAll(/\/\/\s*CLAIM:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(
    claims.length >= 12,
    `VACUITY: only ${claims.length} CLAIM tokens parsed from this file's own comments`,
  );
  assert.equal(new Set(claims).size, claims.length, 'CLAIM tokens must be unique');
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
  console.log(`X-10 examined ${claims.length} claims in the adversarial guard`);
});
