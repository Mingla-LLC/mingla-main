// ---------------------------------------------------------------
// ORCH-1327 [links tab switcher swing] — HAPPY-PATH regression test.
//
// Proves the /links Explorer/Business switcher highlight is ONE persistent,
// x-animated bg-warm pill (no framer shared-layout / mount-unmount projection):
// links-experience.tsx contains `initial={false}`, `animate={{ x`, exactly one
// `rounded-full bg-warm` pill, the `reduced` + `{ duration: 0 }` reduced-motion
// branch, and the roving `tabIndex={selected ? 0 : -1}`.
//
// The marketing package has NO jest/vitest runner wired — this is a SOURCE-level
// pin run via the repo's tsc+node pattern (mirrors business-getapp-cta.test.ts).
// Run from mingla-marketing/:
//   npx tsc components/marketing/__tests__/links-tab-switcher.test.ts \
//     --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/links-tab-switcher.test.js
//
// Fails-on-revert: restoring the old conditionally-mounted `layoutId` pill removes
// `initial={false}` / `animate={{ x` and re-adds `layoutId`, so those assertions
// throw.
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'

const SWITCHER = path.resolve(
  process.cwd(),
  'components/marketing/links-experience.tsx',
)

const src = fs.readFileSync(SWITCHER, 'utf8')

const count = (re: RegExp): number => (src.match(re) ?? []).length

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  [
    'the highlight pill is PERSISTENT (initial={false}, exactly once)',
    () => {
      assert(/initial=\{false\}/.test(src), 'switcher missing initial={false} (pill no longer persistent)')
      assert(count(/initial=\{false\}/g) === 1, `expected exactly ONE persistent pill, got ${count(/initial=\{false\}/g)} initial={false}`)
    },
  ],
  [
    'the pill animates its horizontal x (animate={{ x: … }})',
    () => {
      assert(/animate=\{\{ x:/.test(src), 'switcher missing animate={{ x: … }} (pill does not slide horizontally)')
    },
  ],
  [
    'exactly ONE bg-warm sliding pill (rounded-full bg-warm) is rendered',
    () => {
      assert(/rounded-full bg-warm/.test(src), 'switcher missing the rounded-full bg-warm pill')
      assert(count(/rounded-full bg-warm/g) === 1, `expected exactly ONE bg-warm pill, got ${count(/rounded-full bg-warm/g)}`)
    },
  ],
  [
    'reduced-motion snaps the pill instantly ({ duration: 0 } tied to reduced)',
    () => {
      assert(/reduced/.test(src), 'switcher no longer references `reduced` (reduced-motion source lost)')
      assert(/\{ duration: 0 \}/.test(src), 'switcher missing the { duration: 0 } reduced-motion transition')
    },
  ],
  [
    'the roving tabindex is preserved (tabIndex={selected ? 0 : -1})',
    () => {
      assert(
        /tabIndex=\{selected \? 0 : -1\}/.test(src),
        'switcher lost the roving tabIndex={selected ? 0 : -1}',
      )
    },
  ],
  [
    'NO framer shared-layout `layoutId` remains (the swing is gone)',
    () => {
      assert(!/layoutId/.test(src), 'switcher still contains `layoutId` — the mount/unmount swing regressed')
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1327 links tab switcher persistent pill (happy-path)', () => {
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
  console.log(`\nAll ${cases.length} links-tab-switcher happy-path tests passed`)
}
