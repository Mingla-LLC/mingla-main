/**
 * ORCH-1028 REWORK §F-1/F-2 — responsive scroll-enablement regression test.
 *
 * Runs under Node's built-in test runner with type-stripping (this app has no jest):
 *   node --experimental-strip-types --test src/components/onboarding/__tests__/onboardingScrollPolicy.test.ts
 *
 * Guards the QA fix: on the smallest in-matrix device (iPhone SE 3, short viewport)
 * the `gender_identity` (8 options) and `intents` (6 subtitled cards) steps MUST be
 * scroll-enabled so the last option / subtitle clears the fixed bottom CTA bar, while
 * staying NON-scrollable on tall screens (no large-screen regression). Always-fixed
 * steps (welcome/celebration/collaborations/categories) stay fixed on every device.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
// prettier-ignore
// @ts-expect-error -- runtime .ts import for `node --experimental-strip-types`
import { resolveScrollEnabled } from '../onboardingScrollPolicy.ts'

const SHORT = true   // iPhone SE 3 (667pt) → viewport < 740pt
const TALL = false   // iPhone 12 mini-and-up / Android → viewport >= 740pt

// ── F-1: gender_identity must be scrollable on short, fixed on tall ──
test('F-1: gender_identity scroll-enabled on short viewport (SE 3) so 8th option is reachable', () => {
  assert.equal(resolveScrollEnabled('gender_identity', SHORT), true)
})

test('F-1: gender_identity stays fixed (non-scroll) on tall viewport — no large-screen regression', () => {
  assert.equal(resolveScrollEnabled('gender_identity', TALL), false)
})

// ── F-2: intents must be scrollable on short, fixed on tall ──
test('F-2: intents scroll-enabled on short viewport (SE 3) so the bottom-row subtitle is visible', () => {
  assert.equal(resolveScrollEnabled('intents', SHORT), true)
})

test('F-2: intents stays fixed (non-scroll) on tall viewport — no large-screen regression', () => {
  assert.equal(resolveScrollEnabled('intents', TALL), false)
})

// ── Always-fixed steps stay non-scrollable on every device ──
test('always-fixed steps stay non-scrollable regardless of viewport height', () => {
  for (const fixed of ['welcome', 'celebration', 'collaborations', 'categories'] as const) {
    assert.equal(resolveScrollEnabled(fixed, SHORT), false, `${fixed} should be fixed on short`)
    assert.equal(resolveScrollEnabled(fixed, TALL), false, `${fixed} should be fixed on tall`)
  }
})

// ── Default scrollable steps stay scrollable on every device ──
test('default steps (e.g. details/value_prop/location) remain scrollable on both viewports', () => {
  for (const scrollable of ['details', 'value_prop', 'location', 'transport', 'consent'] as const) {
    assert.equal(resolveScrollEnabled(scrollable, SHORT), true, `${scrollable} should scroll on short`)
    assert.equal(resolveScrollEnabled(scrollable, TALL), true, `${scrollable} should scroll on tall`)
  }
})
