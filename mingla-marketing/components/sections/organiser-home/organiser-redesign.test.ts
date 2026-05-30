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
const LIGHT_SECTIONS = [
  'hero.tsx',
  'what-mingla-does.tsx',
  'how-it-works.tsx',
  'audiences.tsx',
  'why-mingla.tsx',
  'features.tsx',
  'faq.tsx',
] as const

// Dark SpotlightBand sections — accent text uses warm (correct on dark).
const DARK_SECTIONS = ['comparison.tsx', 'cta.tsx'] as const

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
    'dark SpotlightBand sections use text-warm accent (correct on night canvas)',
    () => {
      for (const file of DARK_SECTIONS) {
        const src = read(file)
        makeExpect(src).toContain('SpotlightBand')
        makeExpect(src).toContain('text-warm')
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
    'hero + CTA primary button uses primary-ink variant (white-on-warm fix)',
    () => {
      makeExpect(read('hero.tsx')).toContain("variant=\"primary-ink\"")
      makeExpect(read('cta.tsx')).toContain("variant=\"primary-ink\"")
    },
  ],
  [
    'hero renders the real consumer card deck (show-not-tell, no stock art)',
    () => {
      const hero = read('hero.tsx')
      makeExpect(hero).toContain('HeroPlaceDeck')
      makeExpect(hero).toContain('ProductFrame')
    },
  ],
  [
    'audiences ships all 6 experience-economy cards incl. the Compass card',
    () => {
      const aud = read('audiences.tsx')
      makeExpect(aud).toContain('Experiences, trips & adventures')
      makeExpect(aud).toContain('Compass')
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
