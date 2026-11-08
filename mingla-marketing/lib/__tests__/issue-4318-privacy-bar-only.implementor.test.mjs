// #4318 section 7 (Seth): the bottom privacy bar is the ONE place people make
// and change their analytics and ads choice on usemingla.com. No page, footer
// or sheet carries a separate "Your privacy choices" link any more.
//
// That link was the only way back into the choices, so after a choice the bar
// folds to one icon-only "Privacy settings" button that reopens it, expanded,
// through the one reopen event. This suite pins both halves:
//   (a) no marketing source renders the retired link or its copy;
//   (b) the bar folds (and keeps its inset, so it covers nothing) and the
//       folded button reopens the switches, whose Save is the real choice.
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

test('(a) no marketing page, footer or sheet renders a separate privacy link', () => {
  assert.equal(fs.existsSync(path.join(MARKETING, 'components/marketing/privacy-choices-link.tsx')), false)
  const offenders = []
  for (const root of ['app', 'components', 'lib']) {
    for (const file of walk(path.join(MARKETING, root))) {
      const rel = path.relative(MARKETING, file)
      const source = code(fs.readFileSync(file, 'utf8'))
      if (/PrivacyChoicesLink|privacy-choices-link|ps-footer-privacy|openPrivacyChoices/.test(source)) offenders.push(rel)
      // The bar's own expanded heading is the one allowed place for the words.
      if (rel !== 'components/marketing/consent-banner.tsx' && /Your privacy choices/i.test(source)) offenders.push(`${rel} (copy)`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('(b) after a choice the bar folds to an icon-only Privacy settings button', () => {
  const banner = code(read('components/marketing/consent-banner.tsx'))
  // A saved choice no longer removes the bar: it renders the folded bar.
  assert.match(banner, /if \(!visible\) \{[\s\S]*data-testid="privacy-bar-folded"[\s\S]*aria-label="Privacy settings"/)
  // Icon only: the folded bar carries no words.
  const folded = banner.slice(banner.indexOf('data-testid="privacy-bar-folded"'), banner.indexOf('{toastNode}', banner.indexOf('data-testid="privacy-bar-folded"')))
  const words = [...folded.matchAll(/>\s*([^<>{}=]+?)\s*</g)].map((m) => m[1]).filter((t) => /[A-Za-z]/.test(t))
  assert.deepEqual(words, [])
  // It reopens through the one reopen event the bar listens to.
  assert.match(folded, /window\.dispatchEvent\(new Event\(PRIVACY_CHOICES_EVENT\)\)/)
  assert.match(banner, /window\.addEventListener\(PRIVACY_CHOICES_EVENT, open\)/)
  assert.match(banner, /setReopened\(true\)\s*setExpanded\(true\)/)
  // The folded bar is measured into the same inset, so it covers nothing.
  assert.match(banner, /if \(!mounted \|\| bar === null\) \{/)
  assert.match(banner, /\.mpb-mini\{padding-top:0;padding-bottom:env\(safe-area-inset-bottom,0px\)\}/)
})

test('(b) reopening shows the live switches and Save is the real choice', () => {
  const banner = code(read('components/marketing/consent-banner.tsx'))
  assert.match(banner, /if \(expanded\) setDraft\(\{ analytics: privacy\.analytics, ads: privacy\.ads \}\)/)
  assert.match(banner, /data-testid="privacy-bar-save" onClick=\{\(\) => choose\(draft\)\}/)
  assert.match(banner, /saveMarketingPrivacy\(choice\)/)
  assert.match(banner, /if \(choice\.analytics\) void posthogOptIn\(\)/)
})
