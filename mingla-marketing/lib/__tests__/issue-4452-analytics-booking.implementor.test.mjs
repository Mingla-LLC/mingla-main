// #4452 §8 analytics (SC-165–167) and §2.8 in-form booking (SC-116).
//   AN-1 SC-165 every §8 event is in MARKETING_EVENT_NAMES; GA4 names and the funnel flag match the §8 table
//   AN-2 SC-167 payloads carry the fixed properties and the event's own extras only; no '@', no 7+ digit run
//   AN-3 SC-166 nothing is sent with analytics off (PostHog, GA4 and the funnel table all check first)
//   AN-4 every event fires from its place (source pins) and only through formEvent
//   BK-1 SC-116 the booking is built from the answers just sent (no retyping); host forms book on /schedule
//   BK-2 SC-116 slot_taken shows its message and reloads; a calendar outage links to /schedule/<audience>
// FAILS-ON-REVERT: renaming an event or dropping it from the allowlist fails AN-1;
// letting the email through safeValue fails AN-2; a slot_taken that does not reload fails BK-2.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { loader, MARKETING } from './issue-4452-ts-loader.mjs'

const L = loader('issue-4452-analytics-')
after(() => L.cleanup())
const ev = await L.load('forms/events')
const me = await L.load('marketing-events')
const bk = await L.load('forms/booking')
const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')

const SPEC = {
  popup_shown: ['popup_shown', true], form_viewed: ['form_viewed', true], form_started: ['form_started', true], form_step: ['form_step', true],
  form_error: ['form_error', true], form_submitted: ['generate_lead', false], form_submit_failed: [null, false], popup_closed: ['popup_closed', true],
  success_viewed: ['page_view', true], next_step: ['next_step', true], call_slot_selected: [null, false], call_booked_inform: ['book_appointment', false],
  site_block_clicked: [null, false], call_button_clicked: ['call_button_clicked', false], form_resumed: [null, false], tool_followup_shown: [null, false],
}

test('AN-1 SC-165 the catalogue: every event allowlisted, GA4 names and funnel flags as the table says', () => {
  assert.deepEqual(Object.keys(ev.FORM_EVENTS).sort(), Object.keys(SPEC).sort())
  for (const [name, [ga4, funnel]] of Object.entries(SPEC)) {
    assert.ok(me.MARKETING_EVENT_NAMES.includes(name), `${name} is allowlisted`)
    assert.equal(ev.FORM_EVENTS[name].ga4, ga4, `${name} GA4`)
    assert.equal(ev.FORM_EVENTS[name].funnel, funnel, `${name} funnel`)
  }
  assert.deepEqual([...ev.FIXED_PROPS], ['form_key', 'form_version', 'label', 'placement', 'page_path', 'spot', 'trigger', 'style', 'device', 'utm_source', 'utm_campaign', 'click_source'])
})

test('AN-2 SC-167 payloads: fixed properties plus the event extras, nothing personal', () => {
  const form = { form_key: 'creators', form_version: 3, label: 'creator', placement: 'popup', spot: 'popup' }
  const page = { page_path: '/creators', device: 'phone', utm_source: 'meta', utm_campaign: 'creators-lagos-nov', click_source: 'meta' }
  assert.deepEqual(ev.formEventProps('form_started', form, page, { first_field: 'email', email: 'ada@x.org', name: 'Ada' }),
    { form_key: 'creators', form_version: 3, label: 'creator', placement: 'popup', spot: 'popup', page_path: '/creators', device: 'phone', utm_source: 'meta', utm_campaign: 'creators-lagos-nov', click_source: 'meta', first_field: 'email' })
  assert.deepEqual(ev.formEventProps('popup_shown', form, null, { trigger: 'scroll_half', style: 'sheet' }), { form_key: 'creators', form_version: 3, label: 'creator', placement: 'popup', spot: 'popup', trigger: 'scroll_half', style: 'sheet' })
  for (const bad of ['ada@x.org', '+234 801 234 5678', '08012345678', '(555) 123-4567']) assert.equal(ev.safeValue(bad), undefined, bad)
  for (const ok of ['creators-lagos-nov', '/apply/creators/thanks', 'v3', 'camp-2026']) assert.equal(ev.safeValue(ok), ok, ok)
  assert.equal(ev.clickSourceOf('?gclid=abc'), 'google')
  assert.equal(ev.clickSourceOf('?fbclid=abc&utm_source=meta'), 'meta')
  assert.equal(ev.clickSourceOf('?utm_source=meta'), undefined)
  const sent = ev.formEventProps('form_error', form, page, { fields: 'email,phone', count: 2, source: 'client' })
  assert.ok(!JSON.stringify(sent).includes('@'))
})

test('AN-3 SC-166 nothing goes out with analytics off', () => {
  assert.match(read('components/forms/form-events.ts'), /if \(typeof window === 'undefined' \|\| !isMarketingAnalyticsOn\(\)\) return\n  void import\('\.\/form-events-send'\)/)
  assert.match(read('components/forms/form-events-send.ts'), /if \(typeof window === 'undefined' \|\| !isMarketingAnalyticsOn\(\)\) return\n  const props = formEventProps/)
  assert.match(read('lib/forms/submit.ts'), /export function trackFunnel[^\n]*\n  if \(typeof window === 'undefined' \|\| !isMarketingAnalyticsOn\(\)\) return/)
})

test('AN-4 every event fires from its place, and only through formEvent', () => {
  const renderer = read('components/forms/form-renderer.tsx')
  assert.match(renderer, /if \(entry\.intersectionRatio >= 0\.5\) \{\n\s+timer = timer \?\? setTimeout\(\(\) => \{\n\s+sent = true\n\s+formEvent\('form_viewed', ctx\)/)
  assert.match(renderer, /\}, 1000\)/)
  assert.match(renderer, /formEvent\('form_step', ctx, \{ step: at \+ 1, of: visibleFields\.length \}\)/)
  assert.match(renderer, /formEvent\('form_started', ctx, \{ first_field: key \}\)/)
  assert.match(renderer, /formEvent\('form_submitted', ctx, \{ deduped: outcome\.deduped \}\)/)
  assert.match(renderer, /formEvent\('form_submit_failed', ctx, \{ reason: outcome\.kind \}\)/)
  const host = read('components/forms/popup-host.tsx')
  assert.match(host, /formEvent\('popup_shown', ctxOf\(entry\), \{ trigger, style:/)
  assert.match(host, /formEvent\('popup_closed', ctxOf\(entry\), \{ how, had_answers: dirty\.current, stage:/)
  const booking = read('components/forms/inform-booking.tsx')
  assert.match(booking, /formEvent\('call_slot_selected', null\)/)
  assert.match(booking, /formEvent\('call_booked_inform', null\)/)
  assert.match(read('components/site/nav-call-link.tsx'), /formEvent\('call_button_clicked', null, \{ where: 'top_bar', dest: call\.href \}\)/)
  assert.match(read('components/forms/call-button-analytics.tsx'), /formEvent\('call_button_clicked', null, \{ where: 'cta_bar', dest:/)
  // #4636: the CTA bar lives in the `icpHero` block the template renders.
  assert.match(read('components/landing/icp-landing.tsx'), /<IcpHeroBlock\b/)
  assert.match(read('components/site-blocks/sections/icp-hero-block.tsx'), /data-call-button="cta_bar"/)
  assert.match(read('components/site-blocks/banner.tsx'), /formEvent\('site_block_clicked', null, \{ block: 'banner', dest_kind: kind \}\)/)
  assert.match(read('components/forms/virtual-page.ts'), /formEvent\('success_viewed', null, \{ screen:/)
  const names = Object.keys(SPEC).join('|')
  for (const file of ['components/forms/form-renderer.tsx', 'components/forms/popup-host.tsx', 'components/forms/success-screen.tsx', 'components/forms/inform-booking.tsx', 'components/site-blocks/banner.tsx', 'components/site-blocks/button-row.tsx', 'components/site/nav-call-link.tsx', 'app/apply/[slug]/thanks/thanks-client.tsx']) {
    assert.doesNotMatch(read(file), new RegExp(`captureMarketing\\('(${names})'`), `${file} sends a forms event around the catalogue`)
  }
})

const FIELDS = [
  { key: 'name', type: 'name' }, { key: 'email', type: 'email' }, { key: 'phone', type: 'phone' },
  { key: 'what_do_you_make', type: 'single', options: ['Video', 'Photo'] }, { key: 'your_main_social', type: 'social' },
  { key: 'city', type: 'dropdown', source: 'google_city' }, { key: 'consent', type: 'consent' },
]
const ANSWERS = { name: 'Ada Okafor', email: 'Ada@X.org ', phone: { country: 'NG', dial: '+234', number: '801 234 5678' }, what_do_you_make: 'Video', your_main_social: { platform: 'instagram', value: '@ada.makes' }, city: { label: 'Lagos, Nigeria', city: 'Lagos' } }

test('BK-1 SC-116 the booking comes from the answers just sent', () => {
  assert.deepEqual(bk.bookingFromAnswers(FIELDS, ANSWERS, 'creator'), {
    audience: 'creator', name: 'Ada Okafor', email: 'ada@x.org', phone: { dial: '+234', number: '801 234 5678' }, city: 'Lagos',
    social_platform: 'instagram', social_handle: '@ada.makes', makes: 'video',
  })
  assert.equal(bk.bookingFromAnswers(FIELDS, ANSWERS, 'host'), null, 'host calls need the venue: they book on /schedule')
  assert.equal(bk.bookingFromAnswers(FIELDS, { ...ANSWERS, city: undefined }, 'local'), null, 'no city: book on /schedule/locals')
  const inform = read('components/forms/inform-booking.tsx')
  assert.match(inform, /start: pick, name: basics\.name, email: basics\.email,/)
  assert.match(inform, /form_submission_id: submissionId/)
  assert.match(read('components/forms/form-renderer.tsx'), /onDone\?\.\(outcome, res\.first_name, bookingFromAnswers\(form\.fields, visible, form\.audience\)\)/)
  assert.match(read('lib/forms/booking.ts'), /let HANDOFF/, 'the answers stay in memory: never stored, never in the URL')
  assert.doesNotMatch(read('app/apply/[slug]/apply-client.tsx'), /sessionStorage\.setItem\([^)]*(email|phone)/)
})

test('BK-2 SC-116 slot_taken reloads with its message; the calendar down says where to book', () => {
  assert.equal(bk.SLOT_TAKEN, 'That time was just taken. Pick another.')
  assert.equal(bk.calendarDown('creator'), "We couldn't reach the calendar. Try again, or book at /schedule/creators.")
  assert.equal(bk.calendarDown('local'), "We couldn't reach the calendar. Try again, or book at /schedule/locals.")
  const inform = read('components/forms/inform-booking.tsx')
  assert.match(inform, /if \(res\.error === 'slot_taken'[^\n]*\{ setProblem\(SLOT_TAKEN\); setPick\(null\); void load\(\); return \}/)
  assert.match(inform, /if \(!res\.ok\) \{ setProblem\(calendarDown\(basics\.audience\)\); setSlots\(\[\]\); return \}/)
  const days = bk.slotsByDay([{ start: '2026-11-18T15:00:00Z', end: '' }, { start: '2026-11-17T09:00:00Z', end: '' }, { start: '2026-11-17T10:00:00Z', end: '' }], 'UTC')
  assert.deepEqual(days.map((d) => [d.day, d.slots.length]), [['2026-11-17', 2], ['2026-11-18', 1]])
  assert.equal(bk.bookedLine('2026-11-17T09:00:00Z', 'UTC'), 'Tue 17 Nov at 09:00')
})
