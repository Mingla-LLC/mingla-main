// #4452 T-2.10, T-2.11, T-2.12 (source), T-2.13: the call button routing
// table, the CTA bar's call half, the logo pill and the 'pages' revalidate tag.
// Run from mingla-marketing/: node --test lib/__tests__/issue-4452-cta.implementor.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { loader, MARKETING } from './issue-4452-ts-loader.mjs'
import { pageSource } from './issue-4636-page-source.mjs'

const L = loader('issue-4452-cta-')
after(L.cleanup)
const { callHrefFor } = await L.load('cta-destination')
const { revalidateTargetFor } = await L.load('revalidate-tag')
const read = (p) => fs.readFileSync(path.join(MARKETING, p), 'utf8')

test('T-2.11 SC-123 the call button goes where the design table says', () => {
  const table = [
    ['/', '/schedule', 'Book a 20-min call', 'Book a call'],
    ['/about', '/schedule', 'Book a 20-min call', 'Book a call'],
    ['/host/restaurants', '/schedule?icp=restaurants', 'Book a 20-min call', 'Book a call'],
    ['/host/play', '/schedule?icp=play', 'Book a 20-min call', 'Book a call'],
    ['/creators', '/schedule/creators', 'Talk to the Creators team', 'Talk to us'],
    ['/locals', '/schedule/locals', 'Talk to the Locals team', 'Talk to us'],
    ['/tools/venues', '/schedule?icp=restaurants'],
    ['/tools/events', '/schedule?icp=events'],
    ['/tools/trips', '/schedule?icp=trips'],
    ['/tools/pricing', '/schedule?icp=experiences'],
    ['/tools/venues/report', '/schedule?icp=restaurants'],
  ]
  for (const [p, href, label, short] of table) {
    const c = callHrefFor(p)
    assert.equal(c.href, href, p)
    if (label) assert.equal(c.label, label, p)
    if (short) assert.equal(c.short, short, p)
  }
  assert.equal(callHrefFor('/apply/creators', 'creator').href, '/schedule/creators')
  assert.equal(callHrefFor('/apply/x', 'local').href, '/schedule/locals')
  assert.equal(callHrefFor('/apply/x', 'host').href, '/schedule')
  assert.equal(callHrefFor('/host/not-an-icp').href, '/schedule')
})

test('T-2.11 the nav renders the call link before the hand-off CTA, with an aria-hidden calendar', () => {
  const nav = read('components/site/site-nav.tsx')
  assert.ok(nav.indexOf('<NavCallLink') < nav.indexOf('HostHandoffButton location="nav"'))
  const link = read('components/site/nav-call-link.tsx')
  assert.match(link, /aria-hidden="true"/)
  assert.match(link, /'call_button_clicked'/)
})

test('T-2.12 SC-124/125 the CTA bar text half is a "Book a call" link to /schedule?icp=; Get Mingla Host is unchanged', () => {
  // #4636: the hero is the `icpHero` block (icp-hero-block.tsx) fed by content/site-blocks/icp.ts.
  const icp = pageSource('components/landing/icp-landing.tsx')
  assert.match(icp, /<Link className="btn bring-call" href=\{d\.call\.to\} data-icp-event="icp_talk_to_team_clicked" data-call-button="cta_bar">\s*\{d\.call\.label\}\s*<\/Link>/)
  assert.match(icp, /call: \{ label: 'Book a call', to: scheduleHref\(slug\) \}/)
  assert.match(icp, /<HostHandoffButton location=\{d\.app\.track \?\? 'hero'\} className="btn white">\s*\{d\.app\.label\}\s*<\/HostHandoffButton>/)
  assert.match(icp, /app: \{ to: 'app:host', track: 'hero' \}/)
  assert.doesNotMatch(icp, /<span className="bring">\{d\.bring\}<\/span>/)
  const css = read('components/landing/landing.css')
  assert.match(css, /\.glassbar \.btn\.bring-call \{[^}]*min-height: 47px;[^}]*background: rgba\(255, 255, 255, 0\.14\);/s)
  assert.match(css, /\.glassbar \{[^}]*gap: 18px;[^}]*padding: 8px 8px 8px 20px;/s, 'the bar keeps its paddings and gap')
})

test('T-2.13 SC-126 the nav shows the white wordmark on an orange pill with aria-label "Mingla home"', () => {
  const nav = read('components/site/site-nav.tsx')
  assert.match(nav, /<Link className="brand" href=\{abs\('\/'\)\} aria-label="Mingla home">\s*<LogoPill \/>/)
  const pill = read('components/site/logo-pill.tsx')
  assert.match(pill, /mingla-wordmark-white\.svg" alt=""/)
  assert.match(read('components/site/site.css'), /\.logo-pill \{[^}]*background: #eb7825;/s)
})

test("T-2.10 SC-122 'pages' revalidates site-pages; unknown tags stay 400; blog and links unchanged", () => {
  assert.equal(revalidateTargetFor('{"tag":"pages"}'), 'pages')
  assert.equal(revalidateTargetFor(''), 'blog')
  assert.equal(revalidateTargetFor('{"tag":"links"}'), 'links')
  assert.equal(revalidateTargetFor('{"tag":"everything"}'), null)
  assert.match(read('app/api/blog/revalidate/route.ts'), /pages: SITE_PAGES_CACHE_TAG/)
})

test('SC-89 no new string in the #4452 files says 15-minute', () => {
  for (const p of ['components/site/nav-call-link.tsx', 'lib/cta-destination.ts', 'components/landing/icp-landing.tsx']) {
    assert.doesNotMatch(read(p), /15[- ]minute/i, p)
  }
})
