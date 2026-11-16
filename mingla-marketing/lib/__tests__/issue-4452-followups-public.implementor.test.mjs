// #4452 follow-up — the production fixes on usemingla.com (no install needed).
//
//   PF-B6   /site-preview/<token> may be framed by Admin: the global header rule
//           skips it (X-Frame-Options cannot name another origin and a later
//           rule cannot remove it), its own rule is the same CSP builder with
//           Admin in frame-ancestors, no X-Frame-Options, and noindex. Every
//           other route keeps frame-ancestors 'self' + SAMEORIGIN.
//   PF-B9   the Venue Grader's picked-place text reads >= 4.5:1 on white.
//   PF-B10  a selected choice card's sub-label reads >= 4.5:1 on ink.
//   PF-B11  the "Asked because" tag wraps (never nowrap) inside the card.
//   PF-B12  the follow-up questions are visible from their first frame
//           (no opacity fade), and reduced motion turns the slide off.
//   PF-B13  /apply/<slug>/thanks and /booked are the 404 page for an unknown slug.
//   PF-B14  the /apply titles carry no "| Mingla" (the root template adds it once).
//   PF-B15  the city search sends the visitor's region from the browser language.
//
// FAILS-ON-REVERT: each block names the line it guards.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { MARKETING, loader } from './issue-4452-ts-loader.mjs'

const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const L = loader('issue-4452-followups-')
after(() => L.cleanup())

// WCAG relative luminance and contrast.
function hex(c) {
  const m = /^#([0-9a-f]{6})$/i.exec(c)
  assert.ok(m, `colour ${c}`)
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
}
function lum([r, g, b]) {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
function overInk(rgba) {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(rgba)
  assert.ok(m, `rgba ${rgba}`)
  const ink = hex('#111110')
  const a = Number(m[4])
  return [1, 2, 3].map((i, k) => Math.round(Number(m[i]) * a + ink[k] * (1 - a)))
}

test('PF-B6 /site-preview is framed by Admin only; every other route keeps its anti-framing headers', () => {
  const cfg = read('next.config.ts')
  // One CSP builder for both sets (a later script-src change reaches both).
  assert.equal((cfg.match(/"frame-ancestors 'self'"/g) || []).length, 1, 'one directive list')
  assert.match(cfg, /const previewCsp = contentSecurityPolicy\(SITE_PREVIEW_FRAME_ANCESTORS\.join\(' '\)\)/)
  const ancestors = /export const SITE_PREVIEW_FRAME_ANCESTORS = \[([\s\S]*?)\]\n/.exec(cfg)?.[1] ?? ''
  assert.match(ancestors, /'https:\/\/admin\.usemingla\.com'/)
  assert.doesNotMatch(ancestors, /\*\.vercel\.app|'\*'|https:\/\/\*/, 'no wildcard framer')
  assert.match(ancestors, /process\.env\.NODE_ENV === 'production' \? \[\] :/, 'local Admin origins only outside production')
  const preview = /export const sitePreviewHeaders = \[([\s\S]*?)\n\]/.exec(cfg)?.[1] ?? ''
  assert.doesNotMatch(preview, /X-Frame-Options/, 'no X-Frame-Options on the preview')
  assert.match(preview, /X-Robots-Tag', value: 'noindex, nofollow'/)
  assert.match(preview, /previewCsp\.enforced/)
  const global = /export const securityHeaders = \[([\s\S]*?)\n\]/.exec(cfg)?.[1] ?? ''
  assert.match(global, /X-Frame-Options', value: 'SAMEORIGIN'/)
  assert.match(cfg, /\{ source: SECURITY_HEADERS_SOURCE, headers: securityHeaders \}/)
  assert.match(cfg, /\{ source: SITE_PREVIEW_SOURCE, headers: sitePreviewHeaders \}/)
  const globalSource = /export const SECURITY_HEADERS_SOURCE = '([^']+)'/.exec(cfg)?.[1]
  const previewSource = /export const SITE_PREVIEW_SOURCE = '([^']+)'/.exec(cfg)?.[1]
  // Next's own matcher, when this checkout has Next installed (CI's no-install lane checks the shape above).
  let getPathMatch = null
  try {
    getPathMatch = createRequire(path.join(MARKETING, 'package.json'))('next/dist/shared/lib/router/utils/path-match').getPathMatch
  } catch {}
  if (getPathMatch) {
    const g = getPathMatch(globalSource)
    const p = getPathMatch(previewSource)
    for (const route of ['/', '/host/events', '/tools/venues', '/site-preview-x', '/apply/x/thanks']) assert.ok(g(route), `security headers on ${route}`)
    for (const route of ['/site-preview', '/site-preview/tok', '/site-preview/tok/x']) assert.equal(g(route), false, `no global rule on ${route}`)
    for (const route of ['/site-preview/tok']) assert.ok(p(route), `preview headers on ${route}`)
  }
})

test('PF-B9 the Venue Grader picked place reads >= 4.5:1; its name is ink', () => {
  const css = read('app/tools/_template/tools.css')
  const muted = /--tp-muted: (#[0-9a-f]{6});/i.exec(css)?.[1]
  assert.ok(ratio(hex(muted), hex('#ffffff')) >= 4.5, `muted ${muted} on white ${ratio(hex(muted), hex('#ffffff')).toFixed(2)}`)
  assert.ok(ratio(hex(muted), hex('#f5f4f0')) >= 4.5, 'muted on paper')
  assert.match(css, /\.tp-placecard b \{[^}]*color: var\(--tp-ink\)/)
})

test('PF-B10 a selected choice card sub-label reads >= 4.5:1 on ink (live forms, tools and the Admin kit preview)', () => {
  const css = read('components/forms/forms.css')
  const rule = /(:is\(\[data-landing\], :root\) \.fk-cards button\.on \.fk-opt[^{]*)\{ color: (rgba\([^)]+\)); \}/.exec(css)
  assert.ok(rule, 'the selected override exists')
  for (const sel of ['.fk-cards button.on .fk-opt', '.fk-cards button.on .fk-dim', '.fk-chips button.on .fk-dim', '.fk-seg button.on .fk-dim']) assert.ok(rule[1].includes(sel), sel)
  const r = ratio(overInk(rule[2]), hex('#111110'))
  assert.ok(r >= 4.5, `selected sub-label ${r.toFixed(2)}:1`)
  // The unselected pair stays AA too.
  assert.ok(ratio(hex('#66625a'), hex('#ffffff')) >= 4.5)
})

test('PF-B11 tool tags wrap inside the card', () => {
  const rule = /\.tp-tag \{([^}]*)\}/.exec(read('app/tools/_template/tools.css'))?.[1] ?? ''
  assert.doesNotMatch(rule, /white-space: nowrap/)
  assert.match(rule, /white-space: normal/)
  assert.match(rule, /max-width: 100%/)
})

test('PF-B12 the follow-up block is never invisible; reduced motion turns its motion off', () => {
  const css = read('app/tools/_template/tools.css')
  const adapt = /\.tp-adapt \{([^}]*)\}/.exec(css)?.[1] ?? ''
  const anim = /animation: ([\w-]+)/.exec(adapt)?.[1]
  const frames = new RegExp(`@keyframes ${anim} \\{([^\\n]*)\\}`).exec(css)?.[1] ?? ''
  assert.ok(frames, `keyframes ${anim}`)
  assert.doesNotMatch(frames, /opacity/, 'no fade: the questions show on their first frame')
  assert.doesNotMatch(adapt, /\bboth\b|backwards/, 'no fill that holds a hidden first frame')
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.tp-adapt \{ animation: none; \}/)
})

test('PF-B13/B14 /apply thanks and booked resolve the slug; titles name Mingla once', () => {
  for (const name of ['thanks', 'booked']) {
    const p = read(`app/apply/[slug]/${name}/page.tsx`)
    assert.match(p, /const r = await resolveApplySlug\(slug\)\n\s+if \(!r\) notFound\(\)/, `${name}: unknown slug is the 404`)
    assert.match(p, new RegExp(`permanentRedirect\\(\`/apply/\\$\\{r\\.redirect\\}/${name}\`\\)`), `${name}: an old slug moves`)
    assert.doesNotMatch(p, /\| Mingla/, `${name}: no doubled brand`)
  }
  const page = read('app/apply/[slug]/page.tsx')
  assert.doesNotMatch(page, /\| Mingla/)
  assert.match(page, /import \{ resolveApplySlug as resolve \} from '\.\/resolve'/, 'one resolver for the three pages')
  assert.match(read('app/layout.tsx'), /template: '%s — Mingla'/)
})

test('PF-B15 the city search sends the browser region as a hint', async () => {
  const { visitorRegion } = await L.load('visitor-region')
  assert.equal(visitorRegion(['en-NG']), 'NG')
  assert.equal(visitorRegion(['en', 'fr-CA']), 'CA')
  assert.equal(visitorRegion(['en']), null)
  assert.equal(visitorRegion(['not a tag!']), null)
  assert.match(read('lib/growth-tools-submit.ts'), /postGrowthTools\('growth-tools-geocode', region \? \{ q, region \} : \{ q \}, signal\)/)
  assert.match(read('components/forms/form-renderer.tsx'), /postGrowthTools\('growth-tools-geocode', region \? \{ q: q\.trim\(\), region \} : \{ q: q\.trim\(\) \}\)/)
})
