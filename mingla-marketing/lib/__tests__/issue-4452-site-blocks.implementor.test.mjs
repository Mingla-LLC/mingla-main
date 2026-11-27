// #4452 T-2.2–2.4, T-2.5e, T-2.6, T-2.7c (pure parts): spots, blocks, pop-up rules,
// the client failure copy and the shared form contract the page uses.
// Run from mingla-marketing/: node --test lib/__tests__/issue-4452-site-blocks.implementor.test.mjs
// MINGLA-INVARIANT: I-4452-NO-BLOCKS-NO-CHANGE | issue #4452 | with no published content a page's HTML is unchanged (a spot with no block renders nothing).
// MINGLA-INVARIANT: I-4452-SITE-PAGE-REGISTRY | issue #4452 | every public route under app/** is in the site page registry or EXCLUDED with a reason (scripts/issue-4452-site-manifest.check.mjs).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { loader, MARKETING } from './issue-4452-ts-loader.mjs'
import { missingRoutes } from '../../scripts/issue-4452-site-manifest.check.mjs'

const L = loader('issue-4452-blocks-')
after(L.cleanup)
const m = await L.load('site-pages/model')
const o = await L.load('forms/outcome')
const c = await L.load('forms/contract')
const read = (p) => fs.readFileSync(path.join(MARKETING, p), 'utf8')

const FORM = { id: 'f1', key: 'creators', name: 'Creators', version: 2, audience: 'creator', slug: 'creators-apply', fields: [] }
const content = (pages) => ({ pages, forms: { f1: FORM }, form_pages: {} })

test('T-2.2 SC-92 a spot with no block renders nothing (the page is unchanged)', () => {
  assert.equal(m.blockForSpot(m.EMPTY_CONTENT, 'creators', 'after-steps', false), null)
  const spot = read('components/site-blocks/spot.tsx')
  const lazy = read('components/site-blocks/lazy.tsx')
  assert.match(spot, /if \(!block\) return null/)
  assert.match(lazy, /import \{ lazy, Suspense, type ComponentType \} from 'react'/)
  assert.doesNotMatch(lazy, /from 'next\/dynamic'/, 'empty spots do not ship the next/dynamic loader runtime')
  assert.match(lazy, /<Suspense fallback=\{null\}>/)
  const mount = read('components/forms/popup-mount.tsx')
  assert.match(mount, /if \(Object\.keys\(byPage\)\.length === 0\) return null/, 'no pop-up host markup without a pop-up')
  // every marked spot is one line on its page
  for (const [file, ids] of [
    ['app/creators/page.tsx', ['after-hero', 'after-clips', 'after-steps', 'before-footer']],
    ['app/locals/page.tsx', ['after-hero', 'after-steps', 'after-facts', 'before-footer']],
    ['components/landing/icp-landing.tsx', ['after-hero', 'after-features', 'before-faq', 'before-footer']],
  ]) {
    for (const id of ids) assert.match(read(file), new RegExp(`<Spot page=(\\{slug\\}|"[a-z]+") id="${id}" />`), `${file} ${id}`)
  }
})

test('T-2.3 a page block wins over an all-host-pages block; an archived form renders nothing (D-6)', () => {
  const shared = { id: 's', type: 'banner', spot: 'after-hero', all_host_pages: true, text: 'All', btn: 'Go', to: { kind: 'app' } }
  const own = { id: 'o', type: 'banner', spot: 'after-hero', text: 'Mine', btn: 'Go', to: { kind: 'app' } }
  assert.equal(m.blockForSpot(content({ 'host-template': { blocks: [shared] } }), 'trips', 'after-hero', true)?.id, 's')
  assert.equal(m.blockForSpot(content({ 'host-template': { blocks: [shared] }, trips: { blocks: [own] } }), 'trips', 'after-hero', true)?.id, 'o')
  assert.equal(m.blockForSpot(content({ 'host-template': { blocks: [shared] } }), 'creators', 'after-hero', false), null)
  const formBlock = { id: 'b', type: 'form', spot: 'after-steps', form_id: 'gone' }
  assert.equal(m.blockForSpot(content({ creators: { blocks: [formBlock] } }), 'creators', 'after-steps', false), null)
})

test('T-2.3b SC-94 a form_page button follows the form\'s current slug', () => {
  const c1 = content({})
  assert.equal(m.destHref({ kind: 'form_page', form_id: 'f1' }, c1), '/apply/creators-apply')
  c1.forms.f1 = { ...FORM, slug: 'creators-new' }
  assert.equal(m.destHref({ kind: 'form_page', form_id: 'f1' }, c1), '/apply/creators-new')
  assert.equal(m.destHref({ kind: 'url', href: 'javascript:alert(1)' }, c1), null)
  assert.equal(m.destHref({ kind: 'schedule_creators' }, c1), '/schedule/creators')
})

test('T-2.3c SC-95 a banner disappears after its Show until date', () => {
  const day = Date.UTC(2026, 10, 20, 12)
  assert.equal(m.bannerVisible('2026-11-20', day, false), true)
  assert.equal(m.bannerVisible('2026-11-19', day, false), false)
  assert.equal(m.bannerVisible('2026-11-19', Date.UTC(2026, 10, 20, 6), true), true, 'the server keeps it while it is still the 19th in UTC−12')
  assert.equal(m.bannerVisible(null, day, false), true)
})

test('T-2.4c SC-98 triggers: half the page; exit intent is desktop only', () => {
  assert.equal(m.reachedHalf(400, 800, 2400), true)
  assert.equal(m.reachedHalf(100, 800, 2400), false)
  const s = { trigger: 'exit_intent', freq: 'weekly', devices: 'all', style: 'centre' }
  assert.equal(m.effectiveTrigger(s, true), 'scroll_half')
  assert.equal(m.effectiveTrigger(s, false), 'exit_intent')
  assert.equal(m.effectiveTrigger({ ...s, devices: 'desktop' }, true), null)
})

test('T-2.4d SC-99 weekly: not again within 7 days of a close; a submit stops it for 180 days; broken storage once per load', () => {
  const now = Date.now()
  const base = { closedAt: null, doneAt: null, shownThisVisit: false, shownThisView: false, storageBroken: false }
  assert.equal(m.popupAllowed('weekly', base, now), true)
  assert.equal(m.popupAllowed('weekly', { ...base, closedAt: now - 6 * 86400000 }, now), false)
  assert.equal(m.popupAllowed('weekly', { ...base, closedAt: now - 8 * 86400000 }, now), true)
  assert.equal(m.popupAllowed('every_view', { ...base, doneAt: now - 100 * 86400000 }, now), false)
  assert.equal(m.popupAllowed('visit', { ...base, shownThisVisit: true }, now), false)
  assert.equal(m.popupAllowed('every_view', { ...base, storageBroken: true, shownThisView: true }, now), false)
  assert.equal(m.popupAllowed('weekly', { ...base, storageBroken: true }, now), true)
  assert.equal(m.popupBlockedPath('/schedule/creators'), true)
  assert.equal(m.popupBlockedPath('/tools/venues/report'), true)
  assert.equal(m.popupBlockedPath('/creators'), false)
})

test('T-2.4e/f SC-100/101 the dialog: four ways to close, the keep-going prompt, a focus trap, role=dialog + aria-modal', () => {
  // #4452 pass 2: the dialog's markup moved to popup-dialog.tsx (shared with the builder's preview);
  // the host keeps the triggers, Esc, the focus trap and the inert background.
  const host = read('components/forms/popup-host.tsx') + read('components/forms/popup-dialog.tsx')
  for (const how of ["'close_button'", "'not_now'", "'esc'", "'scrim'"]) assert.ok(host.includes(`close(${how})`) || host.includes(`onClose(${how})`), how)
  assert.match(host, /Close the form\? Your answers are kept on this device for 7 days\./)
  assert.match(host, /role="dialog" aria-modal="true" aria-labelledby="pu-title"/)
  assert.match(host, /e\.key === 'Tab'/)
  assert.match(host, /setAttribute\('inert', ''\)/)
  assert.match(host, /if \(confirmClose\) \{ setConfirmClose\(false\); return \}/, 'Esc on the prompt means Keep going')
})

test('T-2.5e SC-41 the failure copy keeps the answers and offers Try again', () => {
  assert.equal(o.FAILURE_COPY.network, 'No connection. Your answers are saved. Try again')
  assert.deepEqual(o.outcomeFor(429, { error: 'rate_limited' }), { ok: false, kind: 'rate_limited' })
  assert.deepEqual(o.outcomeFor(410, { error: 'form_closed' }), { ok: false, kind: 'form_closed' })
  assert.equal(o.outcomeFor(200, { ok: true, submission_id: 's', lead_event_id: 'creator_lead:form:s', deduped: false }).ok, true)
  assert.equal(o.outcomeFor(200, { ok: false }).ok, false, 'SC-113 success only after a real 200 body')
})

test('T-2.5 SC-107 the page validates with the shared contract (same codes as the server)', () => {
  const def = { v: 1, audience: 'creator', fields: [{ key: 'email', type: 'email', label: 'Email', required: true }], ads: { lead_on: true, goal: 'none' }, routing: { card: { on: false } } }
  assert.deepEqual(c.validateAnswers(def, { email: 'a@gmial.com' }, '2026-11-16').errors, [{ key: 'email', code: 'typo' }])
  assert.equal(c.emailTypoFix('a@gmial.com'), 'a@gmail.com')
  const r = read('components/forms/form-renderer.tsx')
  assert.match(r, /const show = touched \|\| props\.showErrors/, 'errors only after blur or Send')
})

test('T-2.7c SC-111 save and resume never restores consent', () => {
  const s = read('lib/forms/submit.ts')
  assert.match(s, /answers: stripConsent\(answers, consentKeys\)/)
  assert.match(s, /DRAFT_MS = 7 \* 24 \* 3_600_000/)
})

test('T-2.9b SC-120 a preview form never calls forms-submit', () => {
  const r = read('components/forms/form-renderer.tsx')
  assert.ok(r.indexOf('if (form.preview)') < r.indexOf('await postForm('))
  assert.match(read('app/site-preview/[token]/page.tsx'), /f\.preview = true/)
})

test('T-2.6a SC-117 /apply: an old slug 308s to the current one; unknown is the 404 page; noindex unless chosen', () => {
  const p = read('app/apply/[slug]/page.tsx')
  assert.match(p, /permanentRedirect\(`\/apply\/\$\{r\.redirect\}`\)/)
  assert.match(p, /if \(!r\) notFound\(\)/)
  assert.match(p, /robots: own\.index \? undefined : \{ index: false, follow: false \}/)
})

test('T-2.1 SC-90 every public route is in the site page registry or EXCLUDED (I-4452-SITE-PAGE-REGISTRY)', () => {
  const registry = JSON.parse(read('lib/site-pages/registry.json'))
  assert.deepEqual(missingRoutes(path.join(MARKETING, 'app'), registry), [])
  // Fail-on-revert: dropping a listed page from the registry is caught.
  const first = registry.pages.find((p) => p.path !== '/')
  assert.ok(first, 'the registry lists at least one page besides home')
  const dropped = { ...registry, pages: registry.pages.filter((p) => p.path !== first.path) }
  assert.ok(missingRoutes(path.join(MARKETING, 'app'), dropped).includes(first.path), `dropping ${first.path} must fail the check`)
})
