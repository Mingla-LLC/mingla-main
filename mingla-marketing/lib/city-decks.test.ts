// ---------------------------------------------------------------
// city-decks resolver regression test — ORCH-1001 location-aware hero.
//
// Asserts resolveCityKey's geo → city mapping + DC fallback. Written for a Jest
// or Vitest harness (describe/it/expect). The marketing package has no test
// runner wired yet (no jest/vitest in package.json), so this also ships with a
// self-contained Node assert runner block at the bottom that can be executed by
// transpiling this file + city-decks.ts to JS — used to prove fails-on-revert
// for the ORCH-1001 regression gate. When a harness lands, the describe/it
// blocks run directly.
// ---------------------------------------------------------------

import { resolveCityKey } from './city-decks'

// City centers (must match city-decks.ts).
const DC = { lat: '38.9072873', lng: '-77.0369274' }
const RAL = { lat: '35.7795897', lng: '-78.6381787' }
const LAG = { lat: '6.6137395', lng: '3.3552568' }

// Minimal expect shim so this file runs under Node assert when no harness is
// present; a real Jest/Vitest `expect` overrides this when the harness loads.
type Expectation = { toBe: (expected: unknown) => void }
const localExpect = (actual: unknown): Expectation => ({
  toBe(expected) {
    if (actual !== expected) {
      throw new Error(`Expected ${String(expected)}, got ${String(actual)}`)
    }
  },
})
const maybeExpect = (globalThis as { expect?: unknown }).expect
const expectFn: (actual: unknown) => Expectation =
  typeof maybeExpect === 'function'
    ? (maybeExpect as (a: unknown) => Expectation)
    : localExpect

const cases: Array<[string, () => void]> = [
  [
    'exact DC coords → dc',
    () => expectFn(resolveCityKey({ latitude: DC.lat, longitude: DC.lng })).toBe('dc'),
  ],
  [
    'exact Raleigh coords → raleigh',
    () => expectFn(resolveCityKey({ latitude: RAL.lat, longitude: RAL.lng })).toBe('raleigh'),
  ],
  [
    'exact Lagos coords → lagos',
    () => expectFn(resolveCityKey({ latitude: LAG.lat, longitude: LAG.lng })).toBe('lagos'),
  ],
  [
    'DC suburb (Arlington VA) → dc, not raleigh',
    () => expectFn(resolveCityKey({ latitude: '38.8799', longitude: '-77.1068' })).toBe('dc'),
  ],
  [
    'far city (London) → DC fallback (>250km from all)',
    () => expectFn(resolveCityKey({ latitude: '51.5074', longitude: '-0.1278' })).toBe('dc'),
  ],
  [
    'country NG without coords → lagos',
    () => expectFn(resolveCityKey({ country: 'NG' })).toBe('lagos'),
  ],
  [
    'no signals at all → DC fallback (local dev)',
    () => expectFn(resolveCityKey({})).toBe('dc'),
  ],
  [
    '?city=raleigh override wins over DC coords',
    () => expectFn(resolveCityKey({ override: 'raleigh', latitude: DC.lat, longitude: DC.lng })).toBe('raleigh'),
  ],
  [
    '?city=LAGOS override is case-insensitive',
    () => expectFn(resolveCityKey({ override: 'LAGOS' })).toBe('lagos'),
  ],
  [
    'unrecognized override is ignored → falls through to coords',
    () => expectFn(resolveCityKey({ override: 'paris', latitude: LAG.lat, longitude: LAG.lng })).toBe('lagos'),
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('resolveCityKey (ORCH-1001 location-aware)', () => {
    for (const [name, fn] of cases) {
      it(name, fn)
    }
  })
} else {
  // Node-assert fallback runner (no harness present).
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
