// ---------------------------------------------------------------
// ORCH-1221 [Explorer "All of it" = SELECT-ALL] — TESTER adversarial regression.
//
// DIFFERENT ANGLE from the implementor's happy-path file
// (explorer-interest.test.ts). The implementor proved the canonical sequences;
// this file attacks the REPRESENTATION SEAM between the reducer and the modal.
//
// The modal derives the "All of it" chip's selected state from
// `SPECIFIC_INTERESTS.every((v) => interest.includes(v))` — i.e. INDEPENDENTLY
// of whether the stored array literally carries 'all'. The modal's own comment
// claims the chip is "robust to either representation". That is only TRUE if the
// reducer behaves correctly when `prev` arrives in a NON-CANONICAL shape:
//   - all specifics present but NO 'all' sentinel (e.g. the array was built by a
//     path that never appended 'all'); tapping a specific must still recompute
//     'all' correctly, and tapping "All of it" must still CLEAR (because every
//     specific is selected) — NOT add a duplicate 'all'.
//   - a STRAY 'all' present while NOT every specific is selected; the reducer
//     must drop the orphan 'all' on the next specific toggle (canonicalize), and
//     "All of it" must SELECT-ALL (every specific not yet selected).
//   - duplicate specifics in the input must collapse to a single canonical entry.
//
// It also pins ORDER-INVARIANCE (output order is always INTEREST_VALUES order,
// regardless of input order) and IDEMPOTENCE of the select-all clear, neither of
// which the happy-path file exercises.
//
// Real path (same as the implementor file — tsc → node):
//   npx tsc lib/explorer-interest.ts lib/explorer-interest.tester.test.ts \
//     --outDir /tmp/o --module commonjs --target es2020 --esModuleInterop \
//   && node /tmp/o/explorer-interest.tester.test.js
// ---------------------------------------------------------------

import {
  ALL_SELECTED,
  ALL_VALUE,
  INTEREST_VALUES,
  SPECIFIC_INTERESTS,
  allSpecificSelected,
  nextInterest,
} from './explorer-interest'

// Mirror the modal's INDEPENDENT derivation of the "All of it" chip state. If the
// reducer and this derivation ever disagree, the chip lies — the exact bug this
// test guards.
function modalAllChipSelected(interest: ReadonlyArray<string>): boolean {
  return SPECIFIC_INTERESTS.every((v) => interest.includes(v))
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg}: expected ${a} === ${e}`)
}
function truthy(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}
function noDup(arr: ReadonlyArray<string>, msg: string): void {
  if (new Set(arr).size !== arr.length) {
    throw new Error(`${msg}: duplicates in ${JSON.stringify(arr)}`)
  }
}

const cases: ReadonlyArray<[string, () => void]> = [
  [
    "ADVERSARIAL: prev has ALL specifics but NO 'all' sentinel → tapping 'All of it' CLEARS (idempotent select-all, not a stray-add)",
    () => {
      // Non-canonical: every specific present, sentinel absent.
      const nonCanonical = [...SPECIFIC_INTERESTS]
      truthy(allSpecificSelected(nonCanonical), 'precondition: all specifics present')
      truthy(
        modalAllChipSelected(nonCanonical),
        'modal would already show the all-chip as selected for this shape',
      )
      // Because every specific is selected, "All of it" must CLEAR — it must NOT
      // treat the missing 'all' as "not everything selected" and re-select.
      eq(nextInterest(nonCanonical, ALL_VALUE), [], 'all-of-it on all-specifics-no-sentinel must clear')
    },
  ],
  [
    "ADVERSARIAL: STRAY 'all' present while NOT all specifics selected → next specific toggle DROPS the orphan 'all'",
    () => {
      // Corrupt shape the UI's derive could produce a mismatch on: 'all' present
      // but only one specific selected.
      const stray = ['events', ALL_VALUE]
      truthy(!allSpecificSelected(stray), 'precondition: not every specific selected')
      // Toggle another specific on. The reducer rebuilds from the specifics set,
      // so the orphan 'all' must be gone (only re-appended when EVERY specific is on).
      const next = nextInterest(stray, 'trips')
      truthy(!next.includes(ALL_VALUE), `orphan 'all' must be dropped: ${JSON.stringify(next)}`)
      eq(next, ['events', 'trips'], 'canonical specifics, sentinel dropped')
    },
  ],
  [
    "ADVERSARIAL: STRAY 'all' while not-all-selected → tapping 'All of it' SELECTS ALL (not a clear)",
    () => {
      // allSpecificSelected ignores the sentinel, so a stray 'all' with <4
      // specifics must NOT count as 'everything selected' → select-all, not clear.
      const stray = ['places', ALL_VALUE]
      eq(nextInterest(stray, ALL_VALUE), [...ALL_SELECTED], 'stray-all + partial → select all')
    },
  ],
  [
    'ADVERSARIAL: duplicate specifics in prev collapse to a single canonical entry on toggle',
    () => {
      const dupes = ['events', 'events', 'places']
      const next = nextInterest(dupes, 'trips')
      noDup(next, 'output must be de-duplicated')
      // Order canonicalized to INTEREST_VALUES order: places, events, trips.
      eq(next, ['places', 'events', 'trips'], 'de-duped + canonical order')
    },
  ],
  [
    'ADVERSARIAL: output is ALWAYS INTEREST_VALUES order regardless of toggle order (order-invariance)',
    () => {
      // Toggle in reverse order; result must still be enum order.
      let s: string[] = []
      for (const v of ['experiences', 'trips', 'events', 'places']) s = nextInterest(s, v)
      const expectedOrder = INTEREST_VALUES.filter((v) => v !== ALL_VALUE)
      eq(
        s.filter((v) => v !== ALL_VALUE),
        [...expectedOrder],
        'specifics emitted in INTEREST_VALUES order regardless of input order',
      )
      // And once all four are on, the sentinel is appended LAST.
      eq(s[s.length - 1], ALL_VALUE, "'all' sentinel appended last when complete")
    },
  ],
  [
    "ADVERSARIAL: reducer and modal-derive NEVER disagree across a full toggle walk (the lying-chip guard)",
    () => {
      // Walk every specific on, then every specific off, re-deriving the chip
      // state the modal would show from the reducer output at each step. If the
      // stored-array 'all' presence ever disagrees with the derived state for a
      // FULLY-selected array, the chip is inconsistent.
      let s: string[] = []
      const order = [...SPECIFIC_INTERESTS]
      for (const v of order) {
        s = nextInterest(s, v)
        const derived = modalAllChipSelected(s)
        const storedAll = s.includes(ALL_VALUE)
        // When the array is fully selected the reducer canonicalizes by appending
        // 'all', so derived === storedAll must hold. (When partial, derived is
        // false and the reducer must not carry a stray 'all'.)
        truthy(
          derived === storedAll,
          `derived(${derived}) !== stored 'all'(${storedAll}) at ${JSON.stringify(s)}`,
        )
      }
      truthy(s.includes(ALL_VALUE) && modalAllChipSelected(s), 'fully selected → both true')
      // Now toggle them all back off; sentinel must vanish immediately on the
      // first removal and stay gone.
      for (const v of order) {
        s = nextInterest(s, v)
        truthy(!s.includes(ALL_VALUE), `sentinel must be absent while incomplete: ${JSON.stringify(s)}`)
        truthy(!modalAllChipSelected(s), 'derived all-chip must be false while incomplete')
      }
      eq(s, [], 'all toggled off → empty (Next re-gated)')
    },
  ],
  [
    'ADVERSARIAL: tapping a NON-enum value is contained to the specifics set (no crash, no enum corruption)',
    () => {
      // Defense: the modal only ever passes enum values, but the pure reducer
      // must not corrupt the canonical output if handed garbage — a bogus value
      // is not in SPECIFIC_INTERESTS, so it never lands in the ordered output.
      const next = nextInterest(['events'], 'totally_bogus_value')
      truthy(!next.includes('totally_bogus_value'), 'bogus value must not appear in canonical output')
      eq(next, ['events'], 'bogus toggle is a no-op on the canonical specifics')
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('nextInterest — ORCH-1221 TESTER adversarial (representation seam)', () => {
    for (const [name, fn] of cases) it(name, fn)
  })
} else {
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
    console.error(`\n${failures} adversarial test(s) failed`)
    process.exit(1)
  }
  // eslint-disable-next-line no-console
  console.log(`\nAll ${cases.length} ORCH-1221 tester adversarial tests passed`)
}
