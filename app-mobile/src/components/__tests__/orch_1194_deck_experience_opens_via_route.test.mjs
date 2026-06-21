// ORCH-1194 — the deck EXPERIENCE card opens via the /exp/ ROUTE (a navigation,
// like trips), NOT the in-place ExpandedCardModal mount.
//
// Root cause (device-proven): the in-deck ExpandedCardModal mount makes gorhom
// mis-measure the experience sheet ~63dp short → a black band below the body + a
// clipped, untappable reserve bar, on BOTH platforms. The /exp/ route mount — the
// SAME one trips and the cold deep-link use — measures the full screen correctly.
// A failed prior attempt (#600/ORCH-1192) wrapped the sheet in wrapInRNModal, which
// fixed the band on Android but broke the iOS taps AND the picker→cart flow (three
// stacked RN-Modals won't present). ORCH-1194 navigates to /exp/ instead and REVERTS
// the wrapInRNModal everywhere #600 added it — the route-mounted INLINE sheet fills
// (no band), the reserve bar floats + is tappable, and the picker/cart open as normal
// siblings. Device-verified on Samsung A72: band gone, reserve floats, day→time→party
// →cart opens ($70×2 = $140, Continue to Payment).
//
// Fails-on-revert: re-add wrapInRNModal, or revert the ExpandedCardModal navigation.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(__dirname, '../..');
const read = (rel) => readFileSync(resolve(srcRoot, rel), 'utf8');

test('ORCH-1194: ExpandedCardModal navigates the deck experience card to the /exp/ route', () => {
  const src = read('components/ExpandedCardModal.tsx');
  // useRouter imported + a navigation effect that pushes the /exp/ route.
  assert.match(src, /useRouter/);
  assert.match(
    src,
    /router\.push\(\s*`\/exp\/\$\{[^}]*brandSlug\}\/\$\{[^}]*eventSlug\}`/,
  );
  // The deck experience branch no longer renders the in-place sheet.
  assert.match(
    src,
    /if \(isExperienceCard\(businessEvent\)\) \{[\s\S]*?return null;[\s\S]*?\}/,
  );
});

test('ORCH-1194: experience + event detail sheets are INLINE (no wrapInRNModal)', () => {
  const exp = read('screens/Experience/ConsumerExperienceDetailScreen.tsx');
  const evt = read('screens/Event/ConsumerEventDetailScreen.tsx');
  assert.doesNotMatch(exp, /\bwrapInRNModal\b/);
  assert.doesNotMatch(evt, /\bwrapInRNModal\b/);
});

test('ORCH-1194: experience reserve pickers are INLINE (no wrapInRNModal)', () => {
  const rp = read('components/expandedCard/ExperienceReservePicker.tsx');
  const op = read('components/expandedCard/ExperienceOccurrencePicker.tsx');
  assert.doesNotMatch(rp, /\bwrapInRNModal\b/);
  assert.doesNotMatch(op, /\bwrapInRNModal\b/);
});
