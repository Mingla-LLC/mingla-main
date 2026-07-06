// ---------------------------------------------------------------
// ORCH-1319 [explorer direct store links] — explorer-interest reducer REMOVED.
//
// `lib/explorer-interest.ts` (the ORCH-1219/1221 interest-chips select-all
// reducer) backed the pre-launch "Get the app" 2-step lead form. That form was
// retired when Mingla went live on the App Store + Google Play — ORCH-1319
// replaced it with device-aware direct store links + a desktop QR. The reducer
// no longer exists, so there is nothing left to unit-test here.
//
// This file is RETAINED (not deleted) per the append-only test policy
// (ORCH-0840); its original reducer assertions were removed under
// [TEST-MOD-APPROVED ORCH-1319]. Runs via the repo's tsc+node pattern.
// ---------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  [
    'explorer-interest reducer intentionally removed by ORCH-1319 (beta lead-form retired at store launch)',
    () => assert(true, 'removal is intentional'),
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('lib/explorer-interest (removed — ORCH-1319)', () => {
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
    console.error(`\n${failures} test(s) failed`)
    process.exit(1)
  }
  // eslint-disable-next-line no-console
  console.log(`\nAll ${cases.length} explorer-interest tests passed`)
}

export {}
