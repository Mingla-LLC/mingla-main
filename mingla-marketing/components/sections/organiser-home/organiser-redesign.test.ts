// ---------------------------------------------------------------
// ORCH-1010 reality-anchor + contrast-discipline smoke test.
//
// Guards the binding invariants of the /organisers premium redesign by reading
// the actual section source files:
//   1. NO fabricated pricing/SLA copy survives (the two P0 honesty violations
//      the copy removed: performance-based pricing + one-week placements).
//   2. NO unshipped channel is marketed as live (SMS/RCS/push automation).
//   3. Accent TEXT on the LIGHT surface uses `text-warm-ink`, never bare
//      `text-warm`, in the light-surface sections (binding accessibility fix).
//   4. The dark SpotlightBand sections (comparison, cta) DO use `text-warm`
//      (correct on the night canvas).
//   5. The SACRED Business signature line ships verbatim in the CTA.
//   6. The primary CTA uses the `primary-ink` button variant (white-on-warm
//      contrast fix), never the old white-label `glass`/`primary` for the
//      hero/CTA "Partner with Mingla" buttons.
//
// Written for Jest/Vitest (describe/it/expect) with a self-contained Node-assert
// fallback (the marketing package has no test runner wired — BACKFILL-EXEMPT per
// ORCH-1007 precedent). Run directly with:
//   npx tsx components/sections/organiser-home/organiser-redesign.test.ts
// ---------------------------------------------------------------

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'components', 'sections', 'organiser-home')

function read(file: string): string {
  return readFileSync(join(DIR, file), 'utf8')
}

// Strip JS line + block comments so the forbidden-copy scan only inspects
// rendered copy, never a comment that legitimately names a removed phrase.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

// Light-surface sections (parchment/vellum) — accent text MUST be warm-ink.
// (hero.tsx moved to DARK after the ORCH-1010 booking-wall pivot.)
const LIGHT_SECTIONS = [
  'what-mingla-does.tsx',
  'how-it-works.tsx',
  'audiences.tsx',
  'features.tsx',
  'faq.tsx',
] as const

// Dark sections — accent text uses warm (correct on dark). The hero is now a
// full-bleed dark booking-wall section; comparison + cta are SpotlightBands.
const DARK_SECTIONS = ['hero.tsx', 'comparison.tsx', 'cta.tsx'] as const

// Fabricated / off-reality phrases that must NOT appear anywhere on the page.
const FORBIDDEN = [
  'performance-based',
  'charged when',
  'no flat fees',
  'within a week',
  'first placements',
  'push copy',
  'SMS',
  'RCS',
] as const

const ALL_FILES = [...LIGHT_SECTIONS, ...DARK_SECTIONS, 'comparison.tsx']

interface Expect {
  toBe(expected: unknown): void
  toContain(sub: string): void
  notToContain(sub: string): void
}
function makeExpect(actual: unknown): Expect {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`)
      }
    },
    toContain(sub) {
      if (typeof actual !== 'string' || !actual.includes(sub)) {
        throw new Error(`expected source to contain ${JSON.stringify(sub)}`)
      }
    },
    notToContain(sub) {
      if (typeof actual === 'string' && actual.includes(sub)) {
        throw new Error(`expected source NOT to contain ${JSON.stringify(sub)}`)
      }
    },
  }
}

const cases: ReadonlyArray<readonly [string, () => void]> = [
  [
    'no fabricated pricing / SLA / unshipped channel copy survives anywhere',
    () => {
      for (const file of [...LIGHT_SECTIONS, ...DARK_SECTIONS]) {
        const src = stripComments(read(file))
        for (const phrase of FORBIDDEN) {
          // case-insensitive scan of the visible copy
          if (src.toLowerCase().includes(phrase.toLowerCase())) {
            throw new Error(`${file} contains forbidden phrase "${phrase}"`)
          }
        }
      }
    },
  ],
  [
    'light-surface sections use text-warm-ink for accent text (not bare text-warm)',
    () => {
      for (const file of LIGHT_SECTIONS) {
        const src = stripComments(read(file))
        makeExpect(src).toContain('text-warm-ink')
        // bare `text-warm"` (closing quote) or `text-warm ` (space) would be the
        // illegible accent; allow only text-warm-ink and bg-warm/x utilities.
        const bareWarmText = /text-warm(?![-/])/g
        const offenders = src.match(bareWarmText)
        if (offenders) {
          throw new Error(`${file} uses bare text-warm (illegible on light): ${offenders.length} hit(s)`)
        }
      }
    },
  ],
  [
    'dark sections use the warm accent (correct on night canvas)',
    () => {
      // All dark sections use the warm accent on dark — as `text-warm` on the
      // SpotlightBands, or as the `bg-warm` headline container in the hero.
      for (const file of DARK_SECTIONS) {
        makeExpect(/(text|bg)-warm/.test(read(file))).toBe(true)
      }
      // The two SpotlightBand sections specifically render via <SpotlightBand>
      // (the hero is dark via its own full-bleed booking-wall + overlay).
      for (const file of ['comparison.tsx', 'cta.tsx']) {
        makeExpect(read(file)).toContain('SpotlightBand')
      }
    },
  ],
  [
    'CTA ships the SACRED Business signature line verbatim',
    () => {
      const cta = read('cta.tsx')
      makeExpect(cta).toContain('your business has a vibe')
      makeExpect(cta).toContain('your community is looking for it')
      makeExpect(cta).toContain('Mingla helps them find you')
    },
  ],
  [
    'CTA primary button uses primary-ink variant (white-on-warm fix)',
    () => {
      // Hero no longer carries a primary button (booking-wall pivot — single
      // glass PlayTile on the dark overlay). The CTA still owns the primary-ink.
      makeExpect(read('cta.tsx')).toContain("variant=\"primary-ink\"")
    },
  ],
  [
    'hero is the full-bleed booking-wall; the dashboard card lives in what-mingla-does',
    () => {
      // Operator pivot (ORCH-1010): the hero is a dark 3D booking-wall cover with
      // the headline over an overlay; the business growth-OS dashboard card moved
      // into what-mingla-does. Guard the current artifacts.
      makeExpect(read('hero.tsx')).toContain('HeroBookingWall')
      makeExpect(read('what-mingla-does.tsx')).toContain('HeroBusinessCards')
    },
  ],
  [
    'audiences ships the full experience economy as a right-drifting image marquee',
    () => {
      // Redesigned to image-background cards in a marquee (lucide Compass icon
      // dropped). Guard the experience-economy card + the marquee mechanism.
      const aud = read('audiences.tsx')
      makeExpect(aud).toContain('Experiences, trips & adventures')
      makeExpect(aud).toContain('mingla-marquee-x')
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1010 organiser redesign guards', () => {
    for (const [name, fn] of cases) {
      it(name, fn)
    }
  })
} else {
  // Node-assert fallback runner (no harness present).
  // Touch ALL_FILES so the variable is used even when the harness path runs.
  void ALL_FILES
  let failures = 0
  for (const [name, fn] of cases) {
    try {
      fn()
      // eslint-disable-next-line no-console
      console.log(`PASS  ${name}`)
    } catch (err) {
      failures += 1
      // eslint-disable-next-line no-console
      console.error(`FAIL  ${name}: ${(err as Error).message}`)
    }
  }
  if (failures > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n${failures} test(s) failed`)
    process.exit(1)
  }
  // eslint-disable-next-line no-console
  console.log(`\nAll ${cases.length} tests passed`)
}
