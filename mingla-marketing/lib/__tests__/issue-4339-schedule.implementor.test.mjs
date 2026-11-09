// #4339 phase 3 — implementor regression test for Book a call (/schedule).
//
// Source mode (default, no install): runs the real lib/booking-social.ts with
// node's TypeScript type stripping against the fixture table the
// growth-tools-book Deno suite also asserts (lib/booking-social.fixtures.json),
// and reads the page source.
// Built mode (ISSUE_4339_BUILT=1 after `npm run build`, Chrome installed): runs
// the whole flow in a real browser at 375 px, with ONLY the growth-tools-book
// requests stubbed through the DevTools Fetch domain (no network, no booking):
// day → time → details → confirm → "You're booked.", and captures the payload.
//
// Pins:
//   - the eight ICPs; `?icp=<slug>` from every Host landing page preselects it;
//   - the handle: leading @ stripped, no spaces, platform characters only, a
//     pasted profile URL kept only from that platform's domain (same table as
//     the server);
//   - Name, Email, ICP and social required; venue and website optional, the
//     website a real address when given;
//   - the booking sends icp, social_platform, social_handle, website and the
//     #3601 `source` through bookCall;
//   - the page is on the site nav + canonical footer with the brand faces, and
//     the old /schedule frame (bg-smoke, GlassNav-free top bar, old Footer) is gone.
//
// Run from mingla-marketing/ (Node 22.13+):
//   node --test lib/__tests__/issue-4339-schedule.implementor.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { after, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CHROME, hydratedExpr, typeExpr, withBrowser } from './issue-4339-browser-harness.mjs'

const MARKETING = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const code = (source) => source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const BUILT = process.env.ISSUE_4339_BUILT === '1'

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4339-schedule-'))
after(() => fs.rmSync(out, { recursive: true, force: true }))
fs.writeFileSync(path.join(out, 'booking-social.mjs'), stripTypeScriptTypes(read('lib/booking-social.ts')))
const social = await import(pathToFileURL(path.join(out, 'booking-social.mjs')).href)
const fixtures = JSON.parse(read('lib/booking-social.fixtures.json'))

const LANDING_SLUGS = [...read('content/host-landing/icps.ts').matchAll(/^  ([a-z]+): \{$/gm)].map((m) => m[1])

test('the eight ICPs, and every Host landing page slug preselects its own', () => {
  assert.deepEqual(
    social.BOOKING_ICPS.map((o) => o.value),
    ['events', 'trips', 'experiences', 'restaurants', 'hotels', 'art', 'play', 'other'],
  )
  assert.deepEqual(LANDING_SLUGS, ['events', 'trips', 'experiences', 'restaurants', 'hotels', 'art', 'play'])
  for (const slug of LANDING_SLUGS) assert.equal(social.icpFromParam(slug), slug, `/schedule?icp=${slug}`)
  assert.match(code(read('components/landing/icp-landing.tsx')), /return `\/schedule\?icp=\$\{encodeURIComponent\(slug\)\}`/, 'Talk to the team sends the ICP')
  for (const bad of [null, '', 'venue', '__proto__', 'EVENTS ']) {
    assert.equal(social.icpFromParam(bad), bad === 'EVENTS ' ? 'events' : '', String(bad))
  }
})

test('the shared fixture table: every valid social builds its link, every invalid one is refused (same table as the server)', () => {
  assert.ok(fixtures.valid.length >= 14 && fixtures.invalid.length >= 12)
  for (const [platform, input, url] of fixtures.valid) assert.equal(social.socialProfileUrl(platform, input), url, `${platform} ${JSON.stringify(input)}`)
  for (const [platform, input] of fixtures.invalid) assert.equal(social.socialProfileUrl(platform, input), null, `${platform} ${JSON.stringify(input)}`)
  // The server's own copy of the rules reads the same table.
  const server = fs.readFileSync(path.join(MARKETING, '../supabase/functions/growth-tools-book/issue_4339_booking_context.implementor.test.ts'), 'utf8')
  assert.match(server, /mingla-marketing\/lib\/booking-social\.fixtures\.json/)
})

test('required and optional fields', () => {
  const ok = { name: 'Ada', email: 'ada@bluenote.com', icp: 'hotels', socialPlatform: 'instagram', socialHandle: '@bluenote', venue: '', website: '' }
  assert.deepEqual(social.bookingErrors(ok), {})
  assert.deepEqual(Object.keys(social.bookingErrors({ ...ok, icp: '' })), ['icp'])
  assert.deepEqual(Object.keys(social.bookingErrors({ ...ok, socialHandle: '' })), ['social'])
  assert.deepEqual(Object.keys(social.bookingErrors({ ...ok, socialHandle: 'blue note' })), ['social'])
  assert.deepEqual(Object.keys(social.bookingErrors({ ...ok, website: 'not a site' })), ['website'])
  assert.deepEqual(social.bookingErrors({ ...ok, website: 'bluenote.com', venue: 'Blue Note' }), {}, 'venue and website are optional')
  assert.deepEqual(Object.keys(social.bookingErrors({ ...ok, name: 'A', email: 'x' })), ['name', 'email'])
  assert.match(social.bookingErrors({ ...ok, socialPlatform: 'tiktok', socialHandle: 'blue note' }).social, /TikTok/)
})

test('the page sends the new fields and the #3601 source through bookCall, and reads ?icp', () => {
  const client = code(read('app/schedule/ScheduleClient.tsx'))
  assert.match(client, /const presetIcp = icpFromParam\(params\.get\('icp'\)\)/)
  assert.match(client, /useState<string>\(presetIcp\)/)
  for (const field of ['icp,', 'social_platform: socialPlatform,', 'social_handle: socialHandle.trim\\(\\),', "website: website.trim\\(\\) \\|\\| undefined,", 'source,', "venue: venue.trim\\(\\) \\|\\| undefined,", 'report_url: reportUrl \\|\\| undefined,']) {
    assert.match(client, new RegExp(`await bookCall\\(\\{[\\s\\S]*${field}[\\s\\S]*\\}\\)`), `bookCall carries ${field}`)
  }
  assert.match(client, /const source = \(params\.get\('source'\) \?\? 'direct'\)\.slice\(0, 40\)/, '#3601 source default kept')
  assert.match(client, /fetchBookingSlots\(\)/, 'live slots')
  // #4339: Book a call's transport is lib/booking-call.ts (re-exported by growth-tools-submit).
  const submit = code(read('lib/booking-call.ts'))
  assert.match(code(read('lib/growth-tools-submit.ts')), /export \{\s*bookCall,\s*fetchBookingSlots,/)
  // #4339 calls: the host shape is one arm of BookCallInput (audience absent).
  assert.match(submit, /export async function bookCall\(input: BookCallInput\)/)
  assert.match(submit, /audience\?: undefined\s+icp: string\s+social_platform: string\s+social_handle: string[\s\S]*website\?: string/)
  // The design's flow and states.
  for (const marker of ['data-schedule-days', 'data-schedule-slots', 'data-schedule-form', 'data-schedule-confirm', 'data-schedule-done']) {
    assert.match(client, new RegExp(marker), marker)
  }
  assert.match(client, /You’re booked\./)
  assert.match(client, /your time zone · 20 min/)
  assert.match(client, /Grab 20 minutes <em>with Mingla\.<\/em>/)
})

test('the page is on the site nav, the canonical footer and the brand faces; the old frame is gone', () => {
  const page = code(read('app/schedule/page.tsx'))
  assert.match(page, /from '@\/app\/site-fonts'/)
  assert.match(page, /className=\{`\$\{landingSerif\.variable\} \$\{landingSans\.variable\} \$\{landingMono\.variable\}`\}/)
  assert.match(page, /<SitePage surface="host">/)
  const layout = code(read('app/schedule/layout.tsx'))
  assert.doesNotMatch(layout, /bg-smoke|<Footer|<header|mingla-wordmark\.svg/, 'no old frame')
  assert.match(layout, /return children/)
  const css = code(read('components/site/pages.css'))
  assert.match(css, /\[data-landing\] \.days \{[^}]*overflow-x: auto;/, 'the day chips swipe')
  assert.match(css, /\[data-landing\] \.slots button \{[^}]*min-height: 44px;/, '44px time targets')
})

test('built + Chrome: the whole booking flow at 375 px, growth-tools-book stubbed', { skip: !BUILT || !CHROME || typeof WebSocket !== 'function' }, async () => {
  const day = (d) => {
    const at = new Date(Date.now() + d * 86400000)
    at.setUTCHours(15, 0, 0, 0)
    return at
  }
  const slots = [2, 3].flatMap((d) => [0, 20, 40].map((m) => {
    const start = new Date(day(d).getTime() + m * 60000)
    return { start: start.toISOString(), end: new Date(start.getTime() + 20 * 60000).toISOString() }
  }))
  const booked = []
  let refuseSocial = true
  await withBrowser(MARKETING, async (page) => {
    await page.stub('*growth-tools-book*', (request) => {
      const body = JSON.parse(request.postData ?? '{}')
      if (body.action === 'slots') return { status: 200, body: { slots, tz: 'America/New_York' } }
      booked.push(body)
      if (refuseSocial) {
        refuseSocial = false
        return { status: 400, body: { error: 'validation', field: 'social' } }
      }
      return { status: 200, body: { ok: true, start: body.start, event_url: null, meet_url: 'https://meet.google.com/abc-defg-hij' } }
    })
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true })
    await page.send('Page.navigate', { url: `${page.origin}/schedule?icp=hotels&source=venue_grader&venue=Blue%20Note` })
    await page.until(hydratedExpr('[data-schedule-days] button'), '/schedule did not load the slots')
    assert.equal(await page.evaluate(`document.querySelectorAll('[data-schedule-days] button').length`), 2)
    assert.equal(await page.evaluate(`document.documentElement.scrollWidth===innerWidth`), true, 'no sideways scroll at 375')
    // Second day, then a time.
    await page.evaluate(`document.querySelectorAll('[data-schedule-days] button')[1].click()`)
    await page.until(`document.querySelectorAll('[data-schedule-days] button')[1].getAttribute('aria-pressed')==='true'`, 'day did not select')
    await page.evaluate(`document.querySelectorAll('[data-schedule-slots] button')[1].click()`)
    await page.until(`!!document.querySelector('[data-schedule-form]')`, 'details did not open')
    assert.equal(await page.evaluate(`document.querySelector('[data-field="icp"]').value`), 'hotels', '?icp preselects')
    assert.equal(await page.evaluate(`[...document.querySelectorAll('[data-schedule-form] input')].find(i=>i.placeholder==='Optional').value`), 'Blue Note', '?venue prefills')
    // A bad handle is caught before anything is sent.
    await page.evaluate(typeExpr('[data-field="name"]', 'Ada Lovelace'))
    await page.evaluate(typeExpr('[data-field="email"]', 'ada@bluenote.com'))
    await page.evaluate(typeExpr('[data-field="social"]', 'blue note'))
    await page.evaluate(`document.querySelector('[data-schedule-confirm]').click()`)
    await page.until(`document.querySelector('[data-field="social"]').getAttribute('aria-invalid')==='true'`, 'the bad handle was not flagged')
    assert.equal(booked.length, 0, 'nothing sent with a bad handle')
    // A good one; the server refuses it once (field: social) and the page says so.
    await page.evaluate(typeExpr('[data-schedule-platform]', 'tiktok'))
    await page.evaluate(typeExpr('[data-field="social"]', '@bluenote'))
    await page.evaluate(typeExpr('[data-field="website"]', 'bluenote.com'))
    await page.evaluate(`document.querySelector('[data-schedule-confirm]').click()`)
    await page.until(`document.querySelector('[data-field="social"]')?.getAttribute('aria-invalid')==='true'`, 'the server refusal was not shown on the field')
    assert.equal(booked.length, 1)
    // Fix by retyping, then book.
    await page.evaluate(typeExpr('[data-field="social"]', 'bluenote'))
    await page.evaluate(`document.querySelector('[data-schedule-confirm]').click()`)
    await page.until(`!!document.querySelector('[data-schedule-done]')`, 'You’re booked did not show')
    assert.match(await page.evaluate(`document.querySelector('[data-schedule-done]').textContent`), /You’re booked\.[\s\S]*ada@bluenote\.com/)
    assert.equal(booked.length, 2)
    const sent = booked[1]
    assert.equal(sent.action, 'book')
    assert.equal(sent.start, slots[4].start)
    assert.equal(sent.icp, 'hotels')
    assert.equal(sent.social_platform, 'tiktok')
    assert.equal(sent.social_handle, 'bluenote')
    assert.equal(sent.website, 'bluenote.com')
    assert.equal(sent.venue, 'Blue Note')
    assert.equal(sent.source, 'venue_grader', '#3601 source attribution')
    assert.equal(sent.name, 'Ada Lovelace')
    assert.equal(sent.email, 'ada@bluenote.com')
  })
})
