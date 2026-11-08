// #4318 section 7 (Seth): one thin "Privacy & ad choices" strip at the very
// bottom of every usemingla.com page is the ONE place people make and change
// their analytics and ads choice. No first-visit banner, no OK prompt, no
// toast, and no separate "Your privacy choices" link on any page, footer or
// sheet. Analytics and ads stay on unless turned off (#4128).
//
// This suite pins:
//   (a) no marketing source renders the retired link or its copy, and the
//       privacy policy names the strip, not the retired footer link;
//   (b) the strip is server-rendered on every route from the root layout,
//       28px plus the safe area, holding the inset from the first paint;
//   (c) the strip opens the choices sheet; Save is the real choice (it turns
//       analytics on again), the strip reads "Saved" for 1.8s (aria-live),
//       and the sheet traps focus, closes on Escape and returns focus.
//
// Run from mingla-marketing/:
//   node --test lib/__tests__/issue-4318-privacy-bar-only.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) walk(full, out)
    else if (/\.(tsx?|jsx?|mjs|css)$/.test(name)) out.push(full)
  }
  return out
}

test('(a) no marketing page, footer or sheet renders a separate privacy link or its copy', () => {
  assert.equal(fs.existsSync(path.join(MARKETING, 'components/marketing/privacy-choices-link.tsx')), false)
  const offenders = []
  for (const root of ['app', 'components', 'lib']) {
    for (const file of walk(path.join(MARKETING, root))) {
      const rel = path.relative(MARKETING, file)
      const source = code(fs.readFileSync(file, 'utf8'))
      if (/PrivacyChoicesLink|privacy-choices-link|ps-footer-privacy|openPrivacyChoices/.test(source)) offenders.push(rel)
      if (/Your privacy choices|Ad privacy choices/i.test(source)) offenders.push(`${rel} (copy)`)
    }
  }
  assert.deepEqual(offenders, [])
  const policy = read('lib/privacyContent.ts')
  assert.match(policy, /You can opt out at any time from the “Privacy & ad choices” strip at the bottom of every page\./)
})

test('(b) the strip is server-rendered on every route and holds the inset from the first paint', () => {
  const layout = code(read('app/layout.tsx'))
  assert.match(layout, /<ConsentBanner \/>/)
  const banner = code(read('components/marketing/consent-banner.tsx'))
  // No mounted gate and no saved-choice gate: the strip is in the server HTML.
  assert.doesNotMatch(banner, /if \(!mounted\)|setMounted|const visible|privacy\.saved/)
  assert.match(banner, /<style id="mingla-privacy-bar-style" dangerouslySetInnerHTML=\{\{ __html: BAR_CSS \}\} \/>/)
  assert.match(banner, /:root\{\$\{PRIVACY_INSET_PROPERTY\}:calc\(28px \+ env\(safe-area-inset-bottom,0px\)\)\}/)
  assert.match(banner, /\.mps\{position:fixed;left:0;right:0;bottom:0;[^}]*height:calc\(28px \+ env\(safe-area-inset-bottom,0px\)\)/)
  assert.match(banner, /\.mps\{[^}]*background:#15171c;color:rgba\(255,255,255,\.9\)/)
  // No first-visit banner, OK, toast or folded icon.
  assert.doesNotMatch(banner, /privacy-bar-ok|privacy-bar-options|privacy-toast|privacy-bar-folded|Mingla uses cookies|Turn off all/)
})

test('(c) the strip opens the sheet; Save takes effect and shows Saved; focus is trapped and returned', () => {
  const banner = code(read('components/marketing/consent-banner.tsx'))
  assert.match(banner, /export const PRIVACY_STRIP_LABEL = 'Privacy & ad choices'/)
  assert.match(banner, /data-testid="privacy-strip"[\s\S]*onClick=\{\(\) => \(open \? close\(\) : window\.dispatchEvent\(new Event\(PRIVACY_CHOICES_EVENT\)\)\)\}/)
  assert.match(banner, /window\.addEventListener\(PRIVACY_CHOICES_EVENT, reopen\)/)
  // The switches start from what is running (or, once, from a sheet the visitor
  // opened before hydration, #4318).
  assert.match(banner, /setDraft\(adopted \?\? \{ analytics: privacy\.analytics, ads: privacy\.ads \}\)/)
  assert.match(banner, /saveMarketingPrivacy\(choice\)/)
  assert.match(banner, /if \(choice\.analytics\) void posthogOptIn\(\)/)
  assert.match(banner, /<span aria-live="polite"[^>]*>\s*\{saved \? PRIVACY_SAVED_LABEL : PRIVACY_STRIP_LABEL\}/)
  assert.match(banner, /const SAVED_MS = 1800/)
  assert.match(banner, /role="dialog"\s*aria-modal="true"/)
  assert.match(banner, /if \(event\.key === 'Escape'\)/)
  assert.match(banner, /if \(event\.key !== 'Tab'\) return/)
  assert.match(banner, /window\.requestAnimationFrame\(\(\) => stripRef\.current\?\.focus\(\)\)/)
})
