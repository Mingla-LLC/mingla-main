// #4452 §6.1–6.3 (SC-131–136) on the client: the paper template, the adaptive
// follow-up questions and the research screen.
//   AD-1 SC-132–135 branching: which answer asks which question (and hides which field)
//   AD-2 the follow-up body is sent only when asked AND complete
//   AD-3 SC-136 without the new answers each tool's request body is today's
//   AD-4 tool_followup_shown: fired by the follow-up block, with only tool and reason
//   AD-5 §6.3 the research checklist never claims "done" before the response
//   AD-6 SC-131 the four tools render on the one paper template (Example card, 3 steps, field kit)
// FAILS-ON-REVERT: changing the trips threshold to 15 fails AD-1; dropping the
// `followupMissing(a).length > 0` guard fails AD-2; attaching `followup: null`
// in withFollowup fails AD-3; removing formEvent from FollowupBlock fails AD-4;
// letting researchProgress tick every item fails AD-5.
// Run from mingla-marketing/: node --test lib/__tests__/issue-4452-tool-adaptive.implementor.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, test } from 'node:test'
import { loader, MARKETING } from './issue-4452-ts-loader.mjs'

const L = loader('issue-4452-adaptive-')
after(L.cleanup)
const s = await L.load('tools/scenarios')
const ev = await L.load('forms/events')
const read = (p) => fs.readFileSync(path.join(MARKETING, p), 'utf8')
const EXPERIENCES = {
  venues: 'app/tools/venues/GraderExperience.tsx',
  events: 'app/tools/events/EventPredictorExperience.tsx',
  trips: 'app/tools/trips/TripQuoterExperience.tsx',
  pricing: 'app/tools/pricing/PricingAuditExperience.tsx',
}

test('AD-1 SC-132–135 each answer asks its question; the others do not', () => {
  // SC-132 venues: a Google pick with no website asks; a website (Google's or typed) does not.
  assert.equal(s.followupActive({ tool: 'venues', googlePick: true, googleWebsite: '', typedWebsite: '' }), true)
  assert.equal(s.followupActive({ tool: 'venues', googlePick: true, googleWebsite: 'https://a.example', typedWebsite: 'https://a.example' }), false)
  assert.equal(s.followupActive({ tool: 'venues', googlePick: true, googleWebsite: '', typedWebsite: 'mine.example' }), false)
  assert.equal(s.followupActive({ tool: 'venues', googlePick: false, googleWebsite: '', typedWebsite: '' }), false, 'manual entry is not "Google lists no website"')
  // SC-133 events: Free, RSVP only asks and hides the ticket price.
  assert.equal(s.followupActive({ tool: 'events', free: true }), true)
  assert.deepEqual(s.hiddenFields({ tool: 'events', free: true }), ['ticket_price'])
  assert.deepEqual(s.hiddenFields({ tool: 'events', free: false }), [])
  // SC-134 trips: 24 asks, 10 does not; the line is "over 15".
  assert.equal(s.followupActive({ tool: 'trips', groupSize: 24 }), true)
  assert.equal(s.followupActive({ tool: 'trips', groupSize: 10 }), false)
  assert.equal(s.followupActive({ tool: 'trips', groupSize: 15 }), false)
  assert.equal(s.followupActive({ tool: 'trips', groupSize: 16 }), true)
  // SC-135 pricing: Free right now asks and hides the current price.
  assert.equal(s.followupActive({ tool: 'pricing', free: true }), true)
  assert.deepEqual(s.hiddenFields({ tool: 'pricing', free: true }), ['current_price'])
  // The binding "asked because" copy (design TSC) and the scenario CTAs.
  assert.equal(s.SCENARIO.venues.tag, 'asked because Google lists no website')
  assert.equal(s.SCENARIO.events.tag, 'asked because it’s free')
  assert.equal(s.SCENARIO.trips.tag, 'asked because groups over 15 need transport')
  assert.equal(s.SCENARIO.pricing.tag, 'asked because it’s free today')
  assert.equal(s.nextStepCta('venues', 'no_website'), 'Make my free Mingla Host page')
  assert.equal(s.nextStepCta('events', 'free_rsvp'), 'Set up RSVPs on Mingla Host')
  assert.equal(s.nextStepCta('trips', 'group_over_15'), 'Turn this into a bookable trip on Mingla Host')
  assert.equal(s.nextStepCta('pricing', 'free_today'), 'Start charging with Mingla Host')
  assert.equal(s.nextStepCta('venues', null), 'Open my full report')
  // The page renders the question only when asked, with the tag.
  const g = read(EXPERIENCES.venues)
  assert.match(g, /\{noSite \? \(\n\s+<FollowupBlock tool="venues">[\s\S]*?label="Where do people find you today\?" why=\{SCENARIO\.venues\.tag\}/)
  const e = read(EXPERIENCES.events)
  assert.match(e, /\{asked \? \(\n\s+<FollowupBlock tool="events">[\s\S]*?label="RSVP goal"[\s\S]*?label="Had no-shows before\?"/)
  assert.match(e, /\{hidden\.includes\('ticket_price'\) \? \(/, 'the ticket price field is hidden for a free event')
  const t = read(EXPERIENCES.trips)
  assert.match(t, /\{asked \? \(\n\s+<FollowupBlock tool="trips">[\s\S]*?label="Coach between stops\?"[\s\S]*?label="Rooms"/)
  const p = read(EXPERIENCES.pricing)
  assert.match(p, /\{asked \? \(\n\s+<FollowupBlock tool="pricing">[\s\S]*?label="What does each session cost you\?"[\s\S]*?label="Would guests pay a deposit\?"/)
  assert.match(p, /\{hidden\.includes\('current_price'\) \? \(/)
})

test('AD-2 the follow-up body: only when asked and complete', () => {
  const big = { tool: 'trips', groupSize: 24 }
  assert.equal(s.followupBody(big, { tool: 'trips', coach: true, rooms: null }), null, 'incomplete: not sent')
  assert.deepEqual(s.followupBody(big, { tool: 'trips', coach: false, rooms: 'single' }), { coach: false, rooms: 'single' })
  assert.equal(s.followupBody({ tool: 'trips', groupSize: 10 }, { tool: 'trips', coach: true, rooms: 'twin' }), null, 'not asked: never sent')
  assert.deepEqual(s.followupBody({ tool: 'events', free: true }, { tool: 'events', rsvp_goal: '400', no_shows: 'lots' }), { rsvp_goal: 400, no_shows: 'lots' })
  assert.equal(s.followupBody({ tool: 'events', free: true }, { tool: 'events', rsvp_goal: '', no_shows: 'lots' }), null)
  assert.deepEqual(s.followupBody({ tool: 'pricing', free: true }, { tool: 'pricing', session_cost: '370.5', deposit: 'not_sure' }), { session_cost: 370.5, deposit: 'not_sure' })
  assert.deepEqual(s.followupBody({ tool: 'venues', googlePick: true, googleWebsite: '', typedWebsite: '' }, { tool: 'venues', found_via: 'whatsapp' }), { found_via: 'whatsapp' })
  assert.deepEqual(s.followupMissing({ tool: 'venues', found_via: null }), ['where people find you'])
})

test('AD-3 SC-136 without the new answers each request body is today’s', () => {
  const today = { title: 'Gig', category: 'Comedy', city: 'Lagos', venue_name: '', date: '2027-01-01', start_time: '20:00', indoor_outdoor: 'indoor', ticket_price: 20, capacity: 100, budget: 0, audience_size: null, lineup: null, currency: 'NGN' }
  const same = s.withFollowup(today, null)
  assert.equal(same, today, 'the same object, untouched')
  assert.deepEqual(Object.keys(same), Object.keys(today))
  assert.equal('followup' in same, false)
  assert.deepEqual(s.withFollowup(today, { rsvp_goal: 1, no_shows: 'few' }).followup, { rsvp_goal: 1, no_shows: 'few' })
  for (const tool of ['events', 'trips', 'pricing']) {
    assert.match(read(EXPERIENCES[tool]), /const input = withFollowup\(base, followupBody\(facts, answers\)\)/, `${tool}: the body goes through withFollowup`)
  }
  const g = read(EXPERIENCES.venues)
  assert.match(g, /\.\.\.\(followup \? \{ followup \} : \{\}\),/)
  assert.match(g, /website: followup \? '' : \(normalizedWebsite as string\),/)
  // The transport adds nothing of its own.
  const submit = read('lib/growth-tools-submit.ts')
  assert.match(submit, /\{\n\s+action: 'run',\n\s+input,\n\s+\.\.\.\(opts\?\.pid/)
})

test('AD-4 tool_followup_shown: tool and reason only, fired when the question shows', () => {
  for (const tool of ['venues', 'events', 'trips', 'pricing']) {
    const props = ev.formEventProps('tool_followup_shown', null, null, { ...s.followupShownProps(tool), found_via: 'instagram', rsvp_goal: 400 })
    assert.deepEqual(props, { tool, reason: s.SCENARIO[tool].reason }, `${tool}: no answer leaves the browser`)
  }
  assert.deepEqual(ev.FORM_EVENTS.tool_followup_shown, { ga4: null, funnel: false, extra: ['tool', 'reason'] })
  const tpl = read('app/tools/_template/ToolPage.tsx')
  assert.match(tpl, /export function FollowupBlock\(\{ tool, children \}[\s\S]*?useEffect\(\(\) => \{\n\s+formEvent\('tool_followup_shown', null, followupShownProps\(tool\)\)\n\s+\}, \[tool\]\)/)
  const events = read('lib/marketing-events.ts')
  assert.match(events, /'tool_followup_shown'/, 'PostHog allowlist carries the name')
})

test('AD-5 §6.3 the research screen ticks on time but never shows done early', () => {
  assert.deepEqual(s.researchProgress(0, 40000, 4, false), { ticked: 0, pct: 0 })
  assert.equal(s.researchProgress(20000, 40000, 4, false).ticked, 2)
  const late = s.researchProgress(10 * 60000, 40000, 4, false)
  assert.equal(late.ticked, 3, 'the last item waits for the response')
  assert.ok(late.pct < 100)
  assert.deepEqual(s.researchProgress(1000, 40000, 4, true), { ticked: 4, pct: 100 })
  assert.deepEqual(s.researchLines('events', true), ['Reading your date and city', 'Free event: estimating show-up rate', 'Checking similar past events', 'Working out the budget'])
  assert.deepEqual(s.researchLines('venues', false), s.TOOL_PAGE.venues.run)
  assert.equal(s.tripSituationLine(24, true, 'twin'), 'Group of 24: adding a coach and twin rooms')
  const tpl = read('app/tools/_template/ToolPage.tsx')
  assert.match(tpl, /Researching live · about 40 seconds/)
  assert.match(tpl, /\{emailKnown \? <p className="tp-tiny">You can leave this page\. We&rsquo;ll email the report too\.<\/p> : null\}/)
})

test('AD-6 SC-131 the four tools render on the one paper template', () => {
  const tpl = read('app/tools/_template/ToolPage.tsx')
  assert.match(tpl, /<span className="ex">Example<\/span>/)
  assert.match(tpl, /What you&rsquo;ll get/)
  assert.match(tpl, /<ol className="tp-steps"/)
  assert.match(tpl, /<span className="tp-pill">\{t\.pill\} · free<\/span>/)
  assert.match(tpl, /<h1>\{t\.h\} <em>\{t\.em\}<\/em><\/h1>/)
  assert.match(tpl, /import '@\/components\/forms\/forms\.css'/, 'the shared field kit')
  for (const [tool, file] of Object.entries(EXPERIENCES)) {
    const src = read(file)
    assert.match(src, new RegExp(`<ToolPage tool="${tool}"`), `${tool}: on the template`)
    assert.match(src, /className="fk-input/, `${tool}: the field kit`)
    assert.doesNotMatch(src, /glass-soft|bg-black\/30|text-white\/60/, `${tool}: no old dark-stage classes`)
    assert.equal(s.TOOL_PAGE[tool].steps.length, 3)
  }
  for (const tool of ['events', 'trips', 'pricing']) assert.match(read(EXPERIENCES[tool]), /<CitySearch /, `${tool}: Google city search`)
  assert.match(tpl, /<GoogleMapsAttribution \/>/)
  assert.match(read('app/tools/_template/tools.css'), /\.tools-stage\[data-tools-stage\] \{\n\s+background: #f5f4f0;/, 'the stage is paper')
})
