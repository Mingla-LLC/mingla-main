#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ORCH-1157 Round-13 [rsvp-public-redesign / android-sheet-gap] — regression
 * suite for the iOS-mirroring "host reaches the physical screen bottom" fix in
 * BaseBottomSheet.tsx.
 *
 * Structural/source test (the @gorhom/bottom-sheet host is NOT mountable in this
 * harness — same approach as BaseBottomSheet.test.mjs and the locked
 * NotificationsSheet test; see SPEC §12).
 *
 * ROOT CAUSE (proven on a Samsung A72, [GAPDIAG]): with Expo-54 edge-to-edge,
 * Dimensions.get('window').height EXCLUDES the ~48dp system nav bar while
 * Dimensions.get('screen').height is the true physical screen. The inline
 * detail-sheet host was sized to the WINDOW height, so gorhom's opaque
 * backgroundStyle stopped ~48dp above the physical bottom and the Discover deck
 * showed through that band. iOS has no gap because there window == screen.
 *
 * THE FIX (Round-13): on Android with a nav-bar inset, size the inline host to
 * the PHYSICAL SCREEN height so gorhom's own opaque background paints over the
 * nav region — the iOS mirror. iOS keeps windowHeight (unchanged).
 *
 * What this suite asserts:
 *   T-1  The Android inline host height derives from Dimensions.get('screen').height
 *        (the physical-screen bound) — the load-bearing Round-13 mechanism.
 *   T-2  The host-height choice is Android-gated AND iOS keeps windowHeight
 *        (iOS must NOT be perturbed — it is already gap-free).
 *   T-3  The Round-12 full-screen RN-Modal wrap of the INLINE detail sheet is
 *        GONE: the inline path returns the bare `inlineHost` (single clean
 *        mechanism — no separate native window for inline sheets).
 *   T-4  The superseded `androidNavFiller` filler View is fully removed (no dead
 *        layered attempts left behind).
 *
 * FAILS-ON-REVERT: deleting the Round-13 host-height lines (restoring
 * `inlineContainerHeight = windowHeight + ...`) flips T-1 + T-2 → this suite
 * FAILS. Verified by true line-deletion (see IMPLEMENT report Round-13 section).
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

// ── T-1 — Android inline host height derives from the PHYSICAL SCREEN height ──
check('T-1 Android inline host uses Dimensions.get(screen).height', () => {
  assert.match(
    code,
    /Dimensions\.get\(\s*['"]screen['"]\s*\)\.height/,
    'expected the physical-screen height (Dimensions.get("screen").height) to feed the inline host height',
  );
  // The screen height must actually drive `inlineContainerHeight` (the value
  // gorhom measures), not be an unused read.
  assert.match(
    code,
    /const\s+inlineContainerHeight\s*=\s*baseHostHeight\s*\+/,
    'expected inlineContainerHeight to be built from baseHostHeight (the platform-branched bound)',
  );
});

// ── T-2 — Android-gated; iOS keeps windowHeight (must not be perturbed) ──────
check('T-2 host-height is Android-gated and iOS keeps windowHeight', () => {
  // The branch picks the physical-screen bound ONLY on Android (with a nav-bar
  // inset) and falls back to windowHeight everywhere else (iOS / gesture-nav).
  assert.match(
    code,
    /Platform\.OS\s*===\s*['"]android['"][\s\S]{0,80}insets\.bottom\s*>\s*0[\s\S]{0,160}physicalScreenHeight[\s\S]{0,80}:\s*windowHeight/,
    'expected the Android(+nav-bar) → physical-screen, else → windowHeight branch for the host height',
  );
});

// ── T-3 — the Round-12 inline RN-Modal wrap is GONE (one clean mechanism) ────
check('T-3 inline detail sheet returns the bare host (no Round-12 RN-Modal wrap)', () => {
  // The dead Round-12 gate const must be gone.
  assert.doesNotMatch(
    code,
    /androidNeedsFullScreenWindow/,
    'Round-12 androidNeedsFullScreenWindow gate must be removed (superseded by the host-height fix)',
  );
  // The inline path must terminate by returning the bare host.
  assert.match(
    code,
    /return\s+inlineHost\s*;/,
    'inline detail sheet must return the bare inlineHost (no full-screen RN-Modal wrap of the inline sheet)',
  );
});

// ── T-4 — the superseded androidNavFiller filler View is fully removed ───────
check('T-4 superseded androidNavFiller is fully removed', () => {
  // No filler const / JSX usage and no style entry should remain in real code.
  assert.doesNotMatch(
    code,
    /androidNavFiller\s*[:=]/,
    'the androidNavFiller filler (const or style) must be removed — host-height fix supersedes it',
  );
});

if (failures > 0) {
  console.error(`\nORCH-1157 Round-13 host-to-screen-bottom suite: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nORCH-1157 Round-13 host-to-screen-bottom suite PASSED: 4/4 assertions.');
