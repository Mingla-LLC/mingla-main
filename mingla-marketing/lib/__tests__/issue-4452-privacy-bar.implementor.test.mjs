// #4452 T-2.14a (SC-128): the privacy strip fix, by source.
// MINGLA-INVARIANT: I-4452-PRIVACY-BAR-PINNED | issue #4452 | the root viewport has viewportFit 'cover' and the privacy strip is fixed at bottom:0 with the safe-area inset height.
//   - the root layout exports viewport { viewportFit: 'cover' } (so iOS Safari
//     reports a real safe-area inset), and
//   - BAR_CSS keeps the strip fixed at bottom:0 with the inset height, on its own
//     compositing layer, with no transition on bottom.
// The toolbar behaviour itself is proven on the iOS simulator (SC-127, manual).
// Run from mingla-marketing/: node --test lib/__tests__/issue-4452-privacy-bar.implementor.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const layout = fs.readFileSync(path.join(ROOT, 'app/layout.tsx'), 'utf8')
const banner = fs.readFileSync(path.join(ROOT, 'components/marketing/consent-banner.tsx'), 'utf8')

test('the root viewport opts into viewport-fit=cover', () => {
  assert.match(layout, /export const viewport: Viewport = \{[^}]*viewportFit: 'cover'[^}]*\}/)
  assert.match(layout, /width: 'device-width'/)
})

test('the strip is fixed to bottom:0 with the safe-area inset height and its own layer', () => {
  const mps = banner.match(/\.mps\{[^}]*\}/)?.[0] ?? ''
  assert.match(mps, /position:fixed/)
  assert.match(mps, /bottom:0;/)
  // [TEST-MOD-APPROVED #2331] The strip is exactly the band token, and the token
  // is the safe-area-aware 28px + inset (clamped at 0), from the first paint.
  assert.match(mps, /height:var\(--mingla-privacy-strip\)/)
  assert.match(banner, /:root\{\$\{PRIVACY_STRIP_PROPERTY\}:calc\(28px \+ max\(env\(safe-area-inset-bottom,0px\),0px\)\)\}/)
  assert.match(banner, /PRIVACY_STRIP_PROPERTY = '--mingla-privacy-strip'/)
  assert.match(mps, /z-index:2147483000/)
  assert.match(mps, /transform:translateZ\(0\)/)
  assert.doesNotMatch(mps, /transition/)
})
