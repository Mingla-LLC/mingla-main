// ---------------------------------------------------------------
// ORCH-1319 [explorer direct store links] — explorer-interest reducer REMOVED.
//
// This was the TESTER-authored adversarial suite for the ORCH-1219/1221
// interest-chips select-all reducer (`lib/explorer-interest.ts`), which backed
// the pre-launch "Get the app" 2-step lead form. ORCH-1319 retired that form at
// store launch (device-aware direct store links + desktop QR), so the reducer
// and its adversarial surface no longer exist.
//
// RETAINED (not deleted) per the append-only test policy (ORCH-0840); the
// original adversarial assertions were removed under [TEST-MOD-APPROVED ORCH-1319].
// Runs via the repo's tsc+node pattern.
// ---------------------------------------------------------------

function assertTester(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const testerCases: ReadonlyArray<[string, () => void]> = [
  [
    'explorer-interest adversarial suite intentionally removed by ORCH-1319 (reducer gone with the beta lead-form)',
    () => assertTester(true, 'removal is intentional'),
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('lib/explorer-interest tester suite (removed — ORCH-1319)', () => {
    for (const [name, fn] of testerCases) it(name, fn)
  })
} else {
  let failures = 0
  for (const [name, fn] of testerCases) {
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
  console.log(`\nAll ${testerCases.length} explorer-interest tester tests passed`)
}

export {}
