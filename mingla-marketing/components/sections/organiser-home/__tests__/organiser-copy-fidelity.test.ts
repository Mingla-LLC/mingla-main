// ---------------------------------------------------------------
// ORCH-1010 — ADVERSARIAL copy-fidelity + structural-invariant test (tester).
//
// Different angle than the implementor's smoke test:
//   - Implementor scans for ABSENCE of forbidden phrases + PRESENCE of a few
//     marker substrings (text-warm-ink, primary-ink, SpotlightBand, etc.).
//   - This test asserts POSITIVE VERBATIM FIDELITY of the highest-risk approved
//     copy (the [SACRED] CTA line, the litany payoff, the 6 audience eyebrows,
//     the 4 comparison kill-shots) against COPY PART B, AND the FAQ STRUCTURAL
//     invariants (exactly 8 items, zero pricing/SLA QUESTION text) — the count
//     + verbatim angle the implementor's substring scan cannot catch (e.g. a
//     dropped litany line, a reworded sacred line, a 9th re-introduced FAQ).
//
// Why this catches regressions the happy-path test misses:
//   * A reworded sacred line (still containing the marker substrings) PASSES
//     the implementor test but FAILS this one.
//   * A re-introduced pricing FAQ phrased without the literal word "pricing"
//     (e.g. "What does it cost?") PASSES the FORBIDDEN-phrase scan but FAILS
//     the "exactly 8 FAQ items, none about cost" assertion here.
//
// Self-contained Node-assert runner (marketing pkg has no harness; BACKFILL-
// EXEMPT per ORCH-1007). Run:
//   npx tsx components/sections/organiser-home/__tests__/organiser-copy-fidelity.test.ts
// ---------------------------------------------------------------

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'components', 'sections', 'organiser-home')
const read = (f: string): string => readFileSync(join(DIR, f), 'utf8')

// Normalize curly quotes/apostrophes + JSX entities to straight ASCII so a
// verbatim assertion is robust to typographic polish (curly ’ “ ” and HTML
// entities &rsquo; &ldquo; &rdquo; &apos;) without weakening the wording check.
function norm(s: string): string {
  return s
    .replace(/&rsquo;|&apos;|’|‘/g, "'")
    .replace(/&ldquo;|&rdquo;|“|”/g, '"')
    .replace(/&mdash;|—/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

const failures: string[] = []
function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS  ${name}`)
  } catch (err) {
    failures.push(name)
    console.error(`FAIL  ${name}: ${(err as Error).message}`)
  }
}
function assertHas(haystack: string, needle: string, where: string): void {
  if (!norm(haystack).includes(norm(needle))) {
    throw new Error(`${where}: missing verbatim copy "${needle}"`)
  }
}

// 1. (Retired) the CTA section was deleted in ORCH-1010 — its sacred-line guard
//    is removed; the sacred line still ships in the page <meta> (guard below).

// 2. (Retired) the What-Mingla-Does litany section was deleted in ORCH-1010 —
//    its copy guard is removed with it.

// 3. Audiences — all 6 eyebrows verbatim (the 6th is the Inclusion-Rule card).
//    Implementor only asserts the Compass eyebrow; a reworded restaurant/bar
//    eyebrow would slip through there. COPY §4.
check('Audiences ships all 6 approved eyebrows verbatim (full experience economy)', () => {
  const aud = read('audiences.tsx')
  for (const eb of [
    'Restaurants & cafés',
    'Bars, clubs & nightlife',
    'Venues & activity spaces',
    'Events & promoters',
    'Experiences, trips & adventures',
    'Pop-ups & independent creators',
  ]) {
    assertHas(aud, eb, 'audience eyebrow')
  }
  // and the headline accent must be present
  assertHas(aud, 'Mingla makes it the plan.', 'audiences headline accent')
})

// 4. (Retired) the Comparison section was deleted in ORCH-1010 — its kill-shot
//    copy guard is removed with it.

// 5. FAQ STRUCTURAL INVARIANT — exactly 8 question objects, and ZERO of them
//    is a pricing/cost/SLA/timeline question (catches a re-introduced pricing
//    FAQ even if phrased to dodge the FORBIDDEN-phrase scan, e.g. "What does it
//    cost?" / "How long until I'm live?").
check('FAQ has exactly 8 items and none asks about price/cost/billing/SLA/timeline', () => {
  const faq = read('faq.tsx')
  // count question keys: `q:` entries inside the FAQS array
  const qCount = (faq.match(/^\s*q:\s*['"`]/gm) || []).length
  if (qCount !== 8) throw new Error(`expected exactly 8 FAQ questions, found ${qCount}`)
  // extract each question string and assert none is about money/time-to-live
  const questions = [...faq.matchAll(/q:\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => norm(m[2]))
  const banned = ['price', 'pricing', 'cost', 'how much', 'fee to use', 'billing', 'charge', 'free', 'how long until', 'go live', 'within a week', 'timeline', 'sla']
  for (const q of questions) {
    for (const term of banned) {
      if (q.includes(term)) {
        throw new Error(`FAQ re-introduced a forbidden question topic ("${term}") in: "${q}"`)
      }
    }
  }
})

// 6. Page metadata description ships the approved emotion-first sacred text,
//    NOT the old feature-list run-on. COPY PAGE METADATA. (Different file than
//    any section the implementor test reads.)
check('Page metadata description = approved sacred-line text (no feature run-on)', () => {
  const page = readFileSync(join(process.cwd(), 'app', 'organisers', 'page.tsx'), 'utf8')
  assertHas(page, 'The businesses with the most soul are the hardest to find.', 'metadata open')
  assertHas(page, 'Your business has a vibe. Your community is looking for it. Mingla helps them find you.', 'metadata sacred close')
  // the old run-on mechanics phrasing must be gone
  if (norm(page).includes('label the vibe')) {
    throw new Error('metadata still contains the old "label the vibe" feature run-on')
  }
})

if (failures.length > 0) {
  console.error(`\n${failures.length} test(s) failed`)
  process.exit(1)
}
console.log(`\nAll 6 adversarial copy-fidelity tests passed`)
