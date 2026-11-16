// #4452 §6 (free tools), the parts built in pass 2:
//   TR-1 SC-141 each report keeps every DocHeading it rendered at the baseline, in the same order
//   TR-2 SC-142 venues without after_url: the slider's after side is the live preview page of the run;
//               with neither image, the rewritten words before and after, no slider
//   TR-3 SC-140 the pricing category has no default, a pick is required, and the report says "You told us"
// FAILS-ON-REVERT: dropping the afterFrame branch fails TR-2; restoring CATEGORIES[0] as the default fails TR-3.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { MARKETING } from './issue-4452-ts-loader.mjs'

const read = (rel) => fs.readFileSync(path.join(MARKETING, rel), 'utf8')
const headings = (src) => [...src.matchAll(/<DocHeading[^>]*>([^<]*)/g)].map((m) => m[1].trim())

// Captured from origin/main before any redesign (T-6.7a): the binding order.
const BASELINE = {
  'app/tools/venues/ReportView.tsx': ['Your vibe card', 'Site health check', '', 'The grades', 'Your Google listing', 'What your customers say', 'Your fixes', 'Who&rsquo;s eating your Friday nights', 'You vs {headToHead.competitor}', 'Where you already win', 'How to outrank them', 'Your homepage, redesigned'],
  'app/tools/events/EventReportView.tsx': ['Your ad-spend plan', 'Your ad-spend plan', 'What a promo budget could add', 'How your room fills', 'Pick your spend', 'Weather', 'What’s driving your turnout', 'Who you’re up against that night', 'Similar events, real turnouts', 'Demand right now', 'How to pull a bigger crowd', 'Your event as a Mingla listing'],
  'app/tools/trips/TripReportView.tsx': ['Your cost sheet (per person)', 'What to charge', 'Your day-by-day plan', 'Signature experiences — all included', 'Filling the seats', 'Pick your promo spend', 'Weather', 'Where they’ll stay', 'What comparable trips charge', 'What’s shaping this quote', 'Demand right now', 'How to sell it out & lift margin', 'Your trip as a bookable Mingla page'],
  'app/tools/pricing/PricingReportView.tsx': ['Your true cost per head', 'What comparable experiences charge', 'What’s shaping your price', 'Demand right now', 'How to reprice without losing bookings'],
}

test('TR-1 SC-141 every baseline section is still rendered, in order', () => {
  for (const [file, want] of Object.entries(BASELINE)) {
    const got = headings(read(file))
    let i = 0
    for (const h of got) if (h === want[i]) i += 1
    assert.equal(i, want.length, `${file}: the baseline order ${JSON.stringify(want)} is not a subsequence of ${JSON.stringify(got)}`)
  }
})

test('TR-2 SC-142 the venue before / after without after_url', () => {
  const src = read('app/tools/venues/ReportView.tsx')
  assert.match(src, /const afterFrame = !afterImage && runId \? `\/venue-preview\?run_id=\$\{encodeURIComponent\(runId\)\}` : null/)
  assert.match(src, /\{siteImage && \(afterImage \|\| afterFrame\) \? \(/)
  assert.match(src, /<iframe\n\s+src=\{afterFrame\}[\s\S]*?sandbox="allow-scripts allow-same-origin"/)
  assert.match(src, /\) : rewritten \? \(\n\s+\/\/ #4452 §6\.8: neither image: the words before and after, no slider\./)
  assert.doesNotMatch(src, /render\/image/)
  assert.ok(fs.existsSync(path.join(MARKETING, 'app/venue-preview/page.tsx')), 'the existing preview page (no new service)')
})

test('TR-3 SC-140 the pricing category: no default, required, and shown back', () => {
  const intake = read('app/tools/pricing/PricingAuditExperience.tsx')
  assert.match(intake, /const \[category, setCategory\] = useState\(''\)/)
  assert.doesNotMatch(intake, /useState\(CATEGORIES\[0\]\)/)
  assert.match(intake, /if \(!category\) missing\.push\('what kind it is'\)/)
  assert.match(intake, /role="radiogroup" aria-label="Type"/)
  assert.match(read('app/tools/pricing/PricingReportView.tsx'), />You told us: \{e\.category\}</)
})
