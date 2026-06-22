// ORCH-1192 — the consumer EXPERIENCE and EVENT detail sheets must render in the
// full-screen RN-Modal window (`wrapInRNModal`), the SAME host the ExpandedCardModal
// place/curated expanded cards use.
//
// Root cause (device-proven on a Samsung A72): the plain INLINE BaseBottomSheet host
// makes gorhom mis-measure the sheet ~63dp short on the deck-card mount. That left a
// band of the app root showing below the body AND clipped the float reserve bar to a
// 1px sliver (invisible + untappable → "can't buy"). navigationBarTranslucent on the
// RN-Modal gives gorhom the true edge-to-edge screen, so the sheet fills to the
// physical bottom: no band, reserve bar visible & tappable. A debug-green root tint
// confirmed the band WAS the root; a green float-pill wrapper confirmed the clip.
//
// And: when the detail sheet is wrapInRNModal, its reserve SUB-sheets must ALSO be
// wrapInRNModal to z-stack ABOVE it (same as TicketCartSheet) — otherwise the picker
// renders behind the modal and the reserve flow is dead. Device-verified: tapping
// Reserve opens the day → time picker correctly above the modal.
//
// Fails-on-revert: drop any `wrapInRNModal` below and the matching assertion fails.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../..');

const read = (rel) => readFileSync(resolve(root, rel), 'utf8');

// The main detail render mounts BaseBottomSheet with scrollMode="view" + a pinned
// cover; that instance MUST carry wrapInRNModal. We assert the prop co-occurs with
// the seed/found title accessibilityLabel block (the main render, not a state cap).
test('ORCH-1192: experience detail sheet is wrapInRNModal', () => {
  const src = read('screens/Experience/ConsumerExperienceDetailScreen.tsx');
  assert.match(src, /wrapInRNModal\n\s*accessibilityLabel=\{seed\.title\}/);
});

test('ORCH-1192: event detail sheet is wrapInRNModal', () => {
  const src = read('screens/Event/ConsumerEventDetailScreen.tsx');
  assert.match(src, /wrapInRNModal\n\s*accessibilityLabel=\{fnd\.title\}/);
});

test('ORCH-1192: experience reserve picker z-stacks above the modal (wrapInRNModal)', () => {
  const src = read('components/expandedCard/ExperienceReservePicker.tsx');
  assert.match(src, /\bwrapInRNModal\b/);
});

test('ORCH-1192: experience occurrence picker z-stacks above the modal (wrapInRNModal)', () => {
  const src = read('components/expandedCard/ExperienceOccurrencePicker.tsx');
  assert.match(src, /\bwrapInRNModal\b/);
});
