// ORCH-1191 — the consumer app root background must be the canonical dark sheet
// base (#0c0e12), NOT pure #000. The deck-card detail sheets mount in a separate
// `wrapInRNModal` OS overlay window; when gorhom's sheet bg stops short of the
// physical bottom, the strip below it is the app ROOT showing through the
// transparent modal (an in-modal filler cannot escape the modal frame). At
// #0c0e12 that strip blends with the dark detail sheets instead of rendering as a
// jarring pure-black band. Device-verified on the Samsung A72 (deck-card path):
// the y=2068..2264 band measured (12,14,18) with zero (0,0,0) pixels.
//
// Fails-on-revert: flip the root back to "#000000" and the first assertion fails.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(__dirname, '../../app/index.tsx');
const src = readFileSync(indexPath, 'utf8');

// Isolate the `rootView:` style block.
const m = src.match(/rootView:\s*\{[^}]*\}/);
assert.ok(m, 'rootView style block must exist in app/index.tsx');
const block = m[0];

test('ORCH-1191: rootView uses the dark sheet base #0c0e12', () => {
  assert.match(
    block,
    /backgroundColor:\s*["']#0c0e12["']/,
    'rootView.backgroundColor must be "#0c0e12" so the wrapInRNModal sheet bottom strip blends',
  );
});

test('ORCH-1191: rootView is NOT pure #000 (the regressed black band)', () => {
  assert.doesNotMatch(
    block,
    /backgroundColor:\s*["']#000(000)?["']/,
    'rootView must not be pure black — that is the pure-#000 band ORCH-1191 fixed',
  );
});
