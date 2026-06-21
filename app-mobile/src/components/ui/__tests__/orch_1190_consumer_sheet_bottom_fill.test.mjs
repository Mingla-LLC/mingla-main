#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1190 [consumer-sheet-bottom-fill] — regression suite for the OPAQUE
 * bottom-strip filler in BaseBottomSheet.tsx that closes the residual #000 root
 * band at the bottom of the INLINE detail sheets (consumer experience / event /
 * trip), on BOTH platforms.
 *
 * Structural/source test (the @gorhom/bottom-sheet host is NOT mountable in this
 * harness — same approach as BaseBottomSheet.test.mjs and the ORCH-1157 Round-13
 * suite; see SPEC §12).
 *
 * ROOT CAUSE the ORCH-1157 Round-13 host-height fix could not close alone (proven
 * on-device, Samsung A72 SM-A725F, 3-button nav, 1080×2400): gorhom's opaque
 * `backgroundStyle` paints ONLY the DraggableView, and its painted region does
 * not deterministically reach the host's physical bottom — it tracks gorhom's own
 * containerHeight onLayout (which can resolve to the WINDOW height under Expo-54
 * edge-to-edge even when our host View is the SCREEN height), the snap %, and
 * `bottomInset`. Wherever the paint stops short, the TRANSPARENT inline host let
 * the PURE #000 app-root background show through (y≈2068→2264, ~65dp). Seth
 * confirmed the same home-indicator-region gap on iOS.
 *
 * THE FIX (ORCH-1190): an OPAQUE filler View painted with the sheet's OWN bg color
 * (resolvedBackgroundStyle.backgroundColor, default #0c0e12), absolutely pinned to
 * the BOTTOM of the inline host, rendered as the FIRST child of the host so it
 * sits BEHIND `{sheet}`. It spans ONLY the bottom strip (safeBottomInset + buffer)
 * so it covers the residual #000 band on both the screen-height (Android nav-bar)
 * and window-height (iOS home-indicator) paths WITHOUT painting over the backdrop
 * dim region above the sheet (the deck stays visible). pointerEvents="none" so it
 * never steals a pan/tap.
 *
 * What this suite asserts:
 *   T-1  A `bottomFiller` View exists and is a SIBLING of {sheet} inside the
 *        inline host (NOT inside gorhom's <BottomSheet> body — preserves ORCH-1043
 *        direct-child viewport invariant).
 *   T-2  It renders BEFORE {sheet} in the inline host (first child = painted
 *        behind the sheet via source order; gorhom bg wins where it paints).
 *   T-3  Its color is the sheet's OWN background color (resolvedBackgroundStyle),
 *        NOT a hardcoded literal divorced from the theme — so it can never mismatch
 *        the sheet and can never be the #000 root.
 *   T-4  It is BOTTOM-pinned (position:absolute, left/right/bottom:0) and a BOUNDED
 *        bottom strip (height derived from the bottom inset, never the full host),
 *        so it cannot bleed into the backdrop region above the sheet.
 *   T-5  It is pointerEvents="none" (never intercepts pan-to-dismiss / backdrop
 *        press / floating reserve bar).
 *
 * FAILS-ON-REVERT: deleting the `bottomFiller` View / its `styles.bottomFiller`
 * entry, or moving it AFTER {sheet}, or giving it a full-host height, flips one or
 * more of T-1..T-4 → this suite FAILS.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// app-mobile/src/components/ui/__tests__ → repo root is 6 levels up.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

/** Strip block + line comments so assertions match real CODE, never prose. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const SRC = 'app-mobile/src/components/ui/BaseBottomSheet.tsx';
const raw = read(SRC);
const code = stripComments(raw);

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}

// ── T-1 — a bottomFiller View exists as a SIBLING of {sheet} in the inline host ─
check('T-1 bottomFiller is a sibling of {sheet} inside the inline host', () => {
  // The const must exist.
  assert.match(
    code,
    /const\s+bottomFiller\s*=\s*\(\s*<View/,
    'expected a `const bottomFiller = (<View …/>)` opaque bottom-strip filler',
  );
  // Both {bottomFiller} and {sheet} must be rendered inside the inline host View.
  const hostStart = code.indexOf('const inlineHost = (');
  assert.ok(hostStart >= 0, 'inlineHost render block not found');
  const hostEnd = code.indexOf('return inlineHost', hostStart);
  assert.ok(hostEnd > hostStart, 'inlineHost block end not found');
  const hostBlock = code.slice(hostStart, hostEnd);
  assert.ok(
    /\{bottomFiller\}/.test(hostBlock),
    '{bottomFiller} must be rendered inside the inline host',
  );
  assert.ok(
    /\{sheet\}/.test(hostBlock),
    '{sheet} must be rendered inside the inline host',
  );
  // The filler must NOT be a child of the gorhom <BottomSheet> body (which lives
  // in the `body` useMemo, BEFORE `const sheet = (`). Guard: the filler const is
  // declared in the inline-host render path, after `const sheet = (`.
  const sheetDecl = code.indexOf('const sheet = (');
  const fillerDecl = code.indexOf('const bottomFiller = (');
  assert.ok(
    sheetDecl >= 0 && fillerDecl > sheetDecl,
    'bottomFiller must be declared AFTER `const sheet` (in the inline-host path, not inside gorhom body)',
  );
});

// ── T-2 — bottomFiller renders BEFORE {sheet} (painted behind via source order) ─
check('T-2 bottomFiller renders before {sheet} (behind it via source order)', () => {
  const hostStart = code.indexOf('const inlineHost = (');
  const hostEnd = code.indexOf('return inlineHost', hostStart);
  const hostBlock = code.slice(hostStart, hostEnd);
  const fillerIdx = hostBlock.indexOf('{bottomFiller}');
  const sheetIdx = hostBlock.indexOf('{sheet}');
  assert.ok(fillerIdx >= 0 && sheetIdx >= 0, '{bottomFiller} and {sheet} must both render in the host');
  assert.ok(
    fillerIdx < sheetIdx,
    '{bottomFiller} must render BEFORE {sheet} so it paints BEHIND the sheet (first sibling = lowest z)',
  );
});

// ── T-3 — color is the sheet's OWN background, never a divorced literal/#000 ────
check('T-3 filler color derives from the sheet background color', () => {
  assert.match(
    code,
    /bottomFillerColor\s*=\s*[\s\S]{0,160}resolvedBackgroundStyle[\s\S]{0,80}backgroundColor/,
    'bottomFillerColor must be derived from resolvedBackgroundStyle.backgroundColor (the sheet bg, default #0c0e12)',
  );
  // The filler must apply that color, not a hardcoded #000.
  assert.match(
    code,
    /backgroundColor:\s*bottomFillerColor/,
    'the bottomFiller View must paint with bottomFillerColor',
  );
  assert.doesNotMatch(
    code,
    /bottomFiller[\s\S]{0,200}backgroundColor:\s*['"]#0{3,6}['"]/,
    'the bottomFiller must NEVER paint #000 (that is the root band it is closing)',
  );
});

// ── T-4 — bottom-pinned + bounded strip (never the full host height) ───────────
check('T-4 bottomFiller is bottom-pinned and a bounded strip', () => {
  // The style entry must be absolute + bottom-anchored, edge-to-edge horizontally.
  assert.match(
    code,
    /bottomFiller:\s*\{[\s\S]*?position:\s*['"]absolute['"][\s\S]*?bottom:\s*0[\s\S]*?\}/,
    'styles.bottomFiller must be position:absolute pinned to bottom:0',
  );
  assert.match(
    code,
    /bottomFiller:\s*\{[\s\S]*?left:\s*0[\s\S]*?right:\s*0[\s\S]*?\}/,
    'styles.bottomFiller must span left:0/right:0 (full width)',
  );
  // Height is a BOUNDED strip derived from the bottom inset (not the full host /
  // not a percentage / not inlineContainerHeight).
  assert.match(
    code,
    /bottomFillerHeight\s*=\s*safeBottomInset\s*\+/,
    'bottomFillerHeight must be a bounded strip = safeBottomInset + buffer (never the full host)',
  );
  // The filler JSX must apply the bounded `bottomFillerHeight`, NOT the full-host
  // `inlineContainerHeight`. Scope the assertion to the filler const block.
  const fillerStart = code.indexOf('const bottomFiller = (');
  const fillerEnd = code.indexOf('const inlineHost = (', fillerStart);
  assert.ok(fillerStart >= 0 && fillerEnd > fillerStart, 'bottomFiller JSX block not found');
  const fillerBlock = code.slice(fillerStart, fillerEnd);
  assert.match(
    fillerBlock,
    /height:\s*bottomFillerHeight/,
    'the bottomFiller View must apply the bounded bottomFillerHeight',
  );
  assert.doesNotMatch(
    fillerBlock,
    /height:\s*inlineContainerHeight/,
    'the bottomFiller must NOT take the full inline-host height (it would cover the backdrop dim region)',
  );
});

// ── T-5 — pointerEvents="none" (never steals pan/tap) ──────────────────────────
check('T-5 bottomFiller is pointerEvents="none"', () => {
  assert.match(
    code,
    /const\s+bottomFiller\s*=\s*\([\s\S]{0,200}pointerEvents=["']none["']/,
    'the bottomFiller View must be pointerEvents="none" so it never intercepts pan-to-dismiss / backdrop press / reserve bar',
  );
});

if (failures > 0) {
  console.error(`\nORCH-1190 consumer-sheet-bottom-fill suite: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nORCH-1190 consumer-sheet-bottom-fill suite PASSED: 5/5 assertions.');
