// ---------------------------------------------------------------
// ORCH-1220 [Explorer "All of it" = SELECT-ALL] — implementor happy-path
// regression for the pure `nextInterest` reducer.
//
// Proves the select-all contract the modal ships:
//   - tapping "All of it" while NOT everything selected → selects ALL 5;
//   - tapping "All of it" while everything selected      → clears everything;
//   - individually selecting every specific pill auto-includes 'all';
//   - deselecting any specific pill removes 'all';
//   - specific pills toggle independently + preserve enum order;
//   - the array stays length-gated for Next (≥1) and round-trips the enum.
//
// Written for a Jest / Vitest harness (describe/it/expect). The marketing
// package has no test runner wired (mirrors lib/city-decks.test.ts), so this
// also ships a self-contained Node-assert runner block at the bottom — used to
// prove fails-on-revert for the ORCH-1220 select-all contract:
//   npx tsc lib/explorer-interest.ts lib/explorer-interest.test.ts --outDir /tmp/o \
//     --module commonjs --target es2020 && node /tmp/o/explorer-interest.test.js
// (Also runnable directly under Deno: `deno test lib/explorer-interest.test.ts`
//  after switching the imports to `.ts` — but this file targets the tsc path so
//  Next's typecheck stays green.)
// ---------------------------------------------------------------

import {
  ALL_SELECTED,
  ALL_VALUE,
  SPECIFIC_INTERESTS,
  allSpecificSelected,
  nextInterest,
} from './explorer-interest'

const ALL_FIVE = [...SPECIFIC_INTERESTS, ALL_VALUE]

// Minimal expect shim so this file runs under Node assert when no harness is
// present (same approach as lib/city-decks.test.ts).
function expectFn(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected) {
        throw new Error(`expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`)
      }
    },
    toEqual(expected: unknown) {
      const a = JSON.stringify(actual)
      const e = JSON.stringify(expected)
      if (a !== e) throw new Error(`expected ${a} to equal ${e}`)
    },
    toContain(item: unknown) {
      if (!Array.isArray(actual) || !actual.includes(item)) {
        throw new Error(`expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}`)
      }
    },
    notToContain(item: unknown) {
      if (Array.isArray(actual) && actual.includes(item)) {
        throw new Error(`expected ${JSON.stringify(actual)} NOT to contain ${JSON.stringify(item)}`)
      }
    },
  }
}

const cases: ReadonlyArray<[string, () => void]> = [
  [
    "tapping 'All of it' from empty → selects ALL 5 (incl. 'all')",
    () => {
      const next = nextInterest([], ALL_VALUE)
      expectFn(next).toEqual([...ALL_SELECTED])
      expectFn(next.length).toBe(5)
      expectFn(next).toContain('places')
      expectFn(next).toContain(ALL_VALUE)
    },
  ],
  [
    "tapping 'All of it' when everything selected → CLEARS everything",
    () => expectFn(nextInterest(ALL_FIVE, ALL_VALUE)).toEqual([]),
  ],
  [
    "tapping 'All of it' from a partial selection → selects ALL 5",
    () => expectFn(nextInterest(['events'], ALL_VALUE)).toEqual([...ALL_SELECTED]),
  ],
  [
    "individually selecting every specific pill auto-includes 'all'",
    () => {
      let state: string[] = []
      for (const v of SPECIFIC_INTERESTS) state = nextInterest(state, v)
      expectFn(state).toEqual([...ALL_SELECTED])
      expectFn(allSpecificSelected(state)).toBe(true)
    },
  ],
  [
    "deselecting ANY specific pill removes 'all'",
    () => {
      const next = nextInterest([...ALL_SELECTED], 'places')
      expectFn(next).notToContain(ALL_VALUE)
      expectFn(next).notToContain('places')
      expectFn(next).toEqual(['events', 'trips', 'experiences'])
      expectFn(allSpecificSelected(next)).toBe(false)
    },
  ],
  [
    'specific pills toggle independently + preserve enum order',
    () => {
      let state = nextInterest([], 'trips') // ['trips']
      state = nextInterest(state, 'places') // order preserved → ['places','trips']
      expectFn(state).toEqual(['places', 'trips'])
      state = nextInterest(state, 'trips') // toggle trips off
      expectFn(state).toEqual(['places'])
    },
  ],
  [
    'array is length-gated for Next (≥1) — empty after full clear, ≥1 with a pill',
    () => {
      expectFn(nextInterest(ALL_FIVE, ALL_VALUE).length).toBe(0)
      expectFn(nextInterest([], 'events').length >= 1).toBe(true)
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('nextInterest (ORCH-1220 "All of it" select-all)', () => {
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
