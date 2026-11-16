// #4452 §6.5–6.8 (SC-139–142): the four full reports, redesigned.
//   TR-1 SC-141 every section each report rendered before is still rendered, in the same
//        order: origin/main's report view and the redesigned one are rendered with the same
//        full fixture, and each redesigned section's heading (data-section) is found in
//        main's page in the same order; every heading main rendered is accounted for
//   TR-2 SC-142 venues without after_url: the slider's after side is the live preview page of
//        the run; with neither image, the rewritten words before and after, no slider
//   TR-3 SC-140 the pricing category has no default, a pick is required, and the report says "You told us"
//   TR-4 SC-139 an unpriced trip (status, or the same rule on an older report) says "We couldn't
//        price this trip yet." and has no "$0" (no money at all), no cost sheet, no margin ladder
//   TR-5 §6.7 the newly shown data renders when present (and hides when absent)
//   TR-6 §6.7 the frame: Night-field hero first, then the sections, the offer, the two-button
//        action bar and the share links; the situation's CTA and "You told us"
// FAILS-ON-REVERT: moving a section (e.g. the grades above the vibe card) or dropping one
// fails TR-1; dropping the afterFrame branch fails TR-2; restoring CATEGORIES[0] as the
// default fails TR-3; making tripIsUnpriced return false fails TR-4.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { MARKETING } from './issue-4452-ts-loader.mjs'
import { TOOL_STUBS, tsxRenderer } from './issue-4452-tsx-render.mjs'
import { EVENT, PRICING, TRIP, TRIP_UNPRICED, VENUE } from './issue-4452-tool-report-fixtures.mjs'

const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const STUBS = { ...TOOL_STUBS, '@/lib/growth-tools-submit': 'module.exports = { submitGrowthToolsGate: async () => ({ ok: true }), searchCities: async () => ({ ok: true, cities: [] }) }' }
const VIEWS = {
  venues: ['app/tools/venues/ReportView.tsx', 'ReportView', VENUE],
  events: ['app/tools/events/EventReportView.tsx', 'EventReportView', EVENT],
  trips: ['app/tools/trips/TripReportView.tsx', 'TripReportView', TRIP],
  pricing: ['app/tools/pricing/PricingReportView.tsx', 'PricingReportView', PRICING],
}

// The baseline: origin/main's views (before the redesign), read from git.
let mainSource = null
try {
  mainSource = (rel) => {
    if (!Object.values(VIEWS).some(([f]) => f === rel)) return null
    return execFileSync('git', ['show', `origin/main:mingla-marketing/${rel}`], { cwd: MARKETING, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  }
  mainSource(VIEWS.venues[0])
} catch {
  mainSource = null
}
const NEW = tsxRenderer('issue-4452-reports-new-', { stubs: STUBS })
const MAIN = mainSource ? tsxRenderer('issue-4452-reports-main-', { stubs: STUBS, source: mainSource }) : null
after(() => { NEW.cleanup(); MAIN?.cleanup() })

const renderNew = (tool, report, runId = 'run-1') => {
  const [file, name] = VIEWS[tool]
  return NEW.render(NEW.React.createElement(NEW.load(file)[name], { report, runId }))
}
const sections = (html) => [...html.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1].replace(/&#x27;/g, '’').replace(/&amp;/g, '&'))
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '’').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ')

// Blocks main labelled with a <p> rather than a heading (their label text in main's page).
const MAIN_LABEL = {
  'The bottom line': 'The bottom line',
  'Your ad-spend plan': 'Your profit-max ad plan',
  'Perfect timing': 'Perfect timing',
  'The price you should charge': 'The price you should charge',
  'Filling the seats': 'Fill the rest with promo',
  'You vs': 'You vs',
}

test('TR-1 SC-141 every section main rendered is still rendered, in main’s order', { skip: MAIN ? false : 'no origin/main in this checkout' }, () => {
  for (const [tool, [file, name, fixture]] of Object.entries(VIEWS)) {
    const mainHtml = text(MAIN.render(MAIN.React.createElement(MAIN.load(file)[name], { report: fixture, runId: 'run-1', initialGated: false })))
    const mainHeadings = [...MAIN.render(MAIN.React.createElement(MAIN.load(file)[name], { report: fixture, runId: 'run-1', initialGated: false })).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)]
      .map((m) => text(m[1]).trim().replace(/^You vs .*/, 'You vs'))
    const got = sections(renderNew(tool, fixture))
    let at = -1
    for (const id of got) {
      const label = MAIN_LABEL[id] ?? id
      const pos = mainHtml.indexOf(label, at + 1)
      assert.ok(pos > at, `${tool}: "${id}" is out of main's order (or new) in ${JSON.stringify(got)}`)
      at = pos
    }
    for (const h of mainHeadings) assert.ok(got.includes(h), `${tool}: main rendered "${h}", the redesign lost it (${JSON.stringify(got)})`)
  }
})

test('TR-1b the redesigned order, written out (the binding list in §6.7)', () => {
  assert.deepEqual(sections(renderNew('venues', VENUE)), ['Your vibe card', 'Site health check', 'Mingla already knows you', 'The grades', 'Your Google listing', 'What your customers say', 'Your fixes', 'Who’s eating your Friday nights', 'You vs', 'Where you already win', 'How to outrank them', 'Your homepage, redesigned'])
  assert.deepEqual(sections(renderNew('events', EVENT)), ['The bottom line', 'How your room fills', 'Your ad-spend plan', 'Pick your spend', 'What’s driving your turnout', 'Who you’re up against that night', 'Similar events, real turnouts', 'Weather', 'Demand right now', 'How to pull a bigger crowd', 'Your event as a Mingla listing'])
  assert.deepEqual(sections(renderNew('trips', TRIP)), ['The bottom line', 'Your cost sheet (per person)', 'What to charge', 'Perfect timing', 'Signature experiences — all included', 'Your day-by-day plan', 'Where they’ll stay', 'What comparable trips charge', 'Filling the seats', 'Pick your promo spend', 'What’s shaping this quote', 'Weather', 'Demand right now', 'How to sell it out & lift margin', 'Your trip as a bookable Mingla page'])
  assert.deepEqual(sections(renderNew('pricing', PRICING)), ['The bottom line', 'Your true cost per head', 'The price you should charge', 'What comparable experiences charge', 'What’s shaping your price', 'Demand right now', 'How to reprice without losing bookings'])
})

test('TR-2 SC-142 the venue before / after without after_url', () => {
  const live = renderNew('venues', { ...VENUE, screenshot: { ...VENUE.screenshot, after_url: null } }, 'abc-123')
  assert.match(live, /data-before-after="live"/)
  assert.match(live, /<iframe src="\/venue-preview\?run_id=abc-123"[^>]*sandbox="allow-scripts allow-same-origin"/)
  const image = renderNew('venues', VENUE)
  assert.match(image, /data-before-after="image"/)
  assert.doesNotMatch(image, /<iframe/)
  const copy = renderNew('venues', { ...VENUE, screenshot: { image_url: null, og_image_url: null, after_url: null } })
  assert.match(copy, /data-before-after="copy"/)
  assert.doesNotMatch(copy, /data-slider|<iframe/)
  assert.match(text(copy), /Rewritten by Mingla Experience Raleigh’s iconic Angus Barn Steakhouse/)
  const src = read('app/tools/venues/ReportView.tsx')
  assert.doesNotMatch(src, /render\/image/)
  assert.ok(fs.existsSync(path.join(MARKETING, 'app/venue-preview/page.tsx')), 'the existing preview page (no new service)')
})

test('TR-3 SC-140 the pricing category: no default, required, and shown back', () => {
  const intake = read('app/tools/pricing/PricingAuditExperience.tsx')
  assert.match(intake, /const \[category, setCategory\] = useState\(''\)/)
  assert.doesNotMatch(intake, /useState\(CATEGORIES\[0\]\)/)
  assert.match(intake, /if \(!category\) missing\.push\('what kind it is'\)/)
  assert.match(intake, /role="radiogroup" aria-label="Type"/)
  assert.match(text(renderNew('pricing', PRICING)), /You told us: Workshop \/ class/)
})

test('TR-4 SC-139 an unpriced trip is honest: no $0, no money, no cost sheet or margin ladder', () => {
  for (const report of [TRIP_UNPRICED, { ...TRIP_UNPRICED, pricing_status: undefined }]) {
    const html = renderNew('trips', report)
    const t = text(html)
    assert.match(t, /We couldn’t price this trip yet\./)
    assert.match(t, /Live prices for Ibiza, Spain didn’t come back\. Your plan, hotels and activities are below; prices will follow when we can check them\./)
    assert.doesNotMatch(t, /\$\s?0(?![\d.,])/, 'no "$0" text')
    assert.doesNotMatch(t, /\$\d/, 'no $ figures at all')
    const s = sections(html)
    assert.ok(!s.includes('Your cost sheet (per person)') && !s.includes('What to charge'), 'the cost sheet and the margin ladder are hidden')
    assert.ok(s.includes('Your day-by-day plan') && s.includes('Signature experiences — all included') && s.includes('Where they’ll stay'), 'the plan, experiences and hotels stay')
  }
  assert.doesNotMatch(text(renderNew('trips', TRIP)), /couldn’t price/, 'a priced trip shows its price')
  assert.match(text(renderNew('trips', TRIP)), /\$1,550/)
})

test('TR-5 §6.7 the newly shown data renders when present', () => {
  const v = text(renderNew('venues', VENUE))
  assert.match(v, /Today The Angus Barn Steakhouse, a Raleigh icon/, 'venues: rewritten_hero before')
  const e = renderNew('events', EVENT)
  assert.match(text(e), /Why: Built-in foot traffic at the jetty\./, 'events: fixes[].why')
  assert.match(e, /data-new="source_note">Terraform Jetty venue bookings</, 'events: comparables[].source_note')
  assert.match(text(e), /Why go Sail past the Lekki-Ikoyi Link Bridge at night/, 'events: listing why go')
  assert.match(text(e), /Best for Couples and small groups/)
  assert.match(e, /cruise\.jpg/, 'events: the listing cover')
  const t = text(renderNew('trips', TRIP))
  assert.match(t, /Included 5 nights in boutique hotels/)
  assert.match(t, /Not included International flights/)
  assert.match(t, /Your price .*\$1,550 .*Classic Japan Cherry Blossom Tour · Japan Journeys/, 'trips: comparables to scale against your price')
  const p = text(renderNew('pricing', PRICING))
  assert.match(p, /You today .*\$20 .*Your new price .*\$65 .*Weaver Street Market/, 'pricing: comps to scale with current and recommended')
  assert.match(p, /2 hours · their booking page/, 'pricing: source_note')
  // Absent data hides, never shows an empty block.
  const bare = renderNew('events', { ...EVENT, comparables: [], competitors: [], weather: undefined, demand_read: '', factors: [], fixes: [] })
  assert.deepEqual(sections(bare), ['The bottom line', 'How your room fills', 'Your ad-spend plan', 'Pick your spend', 'Your event as a Mingla listing'])
})

test('TR-6 §6.7 the frame: hero, sections, offer, action bar, share links; situations', () => {
  for (const [tool, , fixture] of Object.values(VIEWS).map((v, i) => [Object.keys(VIEWS)[i], ...v.slice(1)])) {
    const html = renderNew(tool, fixture)
    const hero = html.indexOf('data-hero=')
    const first = html.indexOf('data-section=')
    const offer = html.indexOf('data-offer=')
    const bar = html.indexOf('data-action-bar=')
    assert.ok(hero > -1 && hero < first && first < offer && offer < bar, `${tool}: hero → sections → offer → action bar`)
    const t = text(html.slice(bar))
    assert.match(t, /Want this done for you\? .* Get Mingla Host Book a 20-minute call/)
    assert.match(t, /This link works for 30 days\. .*Run it again/)
    assert.match(html, /<a class="a2" href="\/schedule\?icp=(restaurants|events|trips|experiences)"/)
  }
  const noSite = text(renderNew('venues', { ...VENUE, venue: { ...VENUE.venue, website: '' }, screenshot: { image_url: null, og_image_url: null, after_url: null }, site_signals: { checks: [] }, followup: { reason: 'no_website', found_via: 'instagram' } }))
  assert.match(noSite, /Make my free Mingla page/)
  assert.match(noSite, /You told us: people find you on Instagram\./)
  assert.match(noSite, /No website on Google/)
  assert.match(text(renderNew('events', { ...EVENT, followup: { reason: 'free_rsvp', rsvp_goal: 400, no_shows: 'lots' } })), /Set up RSVPs on Mingla/)
  assert.match(text(renderNew('trips', { ...TRIP, followup: { reason: 'group_over_15', coach: true, rooms: 'twin' } })), /Turn this into a bookable trip/)
  assert.match(text(renderNew('pricing', { ...PRICING, followup: { reason: 'free_today', session_cost: 370, deposit: 'probably' } })), /Start charging with Mingla/)
  assert.doesNotMatch(text(renderNew('venues', VENUE)), /Make my free Mingla page/, 'no situation, no scenario CTA')
})
