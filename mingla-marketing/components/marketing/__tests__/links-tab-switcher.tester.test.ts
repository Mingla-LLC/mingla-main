// ---------------------------------------------------------------
// ORCH-1327 [links tab switcher swing] — TESTER-ADVERSARIAL test.
//
// Different angle than the happy-path (which proves PRESENCE of the persistent
// pill). This proves the ABSENCE of the swing shape AND that the a11y survives:
//   (a) NO framer shared-layout `layoutId` anywhere (the cross-instance layout
//       projection that arced the pill is gone).
//   (b) NO `motion` element conditionally mounted inside a `selected ?` ternary
//       (the per-tab mount/unmount pill shape must never come back).
//   (c) the highlight pill is aria-hidden + pointer-events-none (decorative; taps
//       land on the buttons).
//   (d) the WAI-ARIA roving-tabindex tablist is intact: role="tablist"/"tab",
//       aria-selected, onTabKeyDown, and ArrowRight/ArrowLeft/Home/End nav.
//
// Comment-stripped (mirrors the ORCH-1327 strict-grep guard) so the informative
// code comments that legitimately NAME the removed shared-layout pill never trip
// the ABSENCE assertions.
//
// Run from mingla-marketing/ via the repo tsc+node pattern:
//   npx tsc components/marketing/__tests__/links-tab-switcher.tester.test.ts \
//     --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/links-tab-switcher.tester.test.js
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'

const SWITCHER = path.resolve(
  process.cwd(),
  'components/marketing/links-experience.tsx',
)

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const src = stripComments(fs.readFileSync(SWITCHER, 'utf8'))

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  // ── (a) the shared-layout projection is gone ────────────────────────────────
  [
    'no `layoutId` anywhere (the mount/unmount layout-projection swing is gone)',
    () => {
      assert(!/layoutId/.test(src), 'switcher still contains `layoutId` — the swing shape regressed')
    },
  ],
  // ── (b) no conditionally-mounted motion pill inside a `selected ?` ternary ───
  [
    'no motion element is conditionally mounted inside a `selected ?` ternary',
    () => {
      assert(
        !/\bselected\s*\?\s*\(?\s*<motion\.(span|div)/.test(src),
        'a motion element is conditionally mounted inside a `selected ?` ternary (per-tab mount/unmount pill regressed)',
      )
    },
  ],
  // ── (c) the pill is decorative (aria-hidden + pointer-events-none) ──────────
  [
    'the highlight pill is aria-hidden + pointer-events-none (decorative)',
    () => {
      assert(/aria-hidden="true"/.test(src), 'switcher pill/atmosphere lost aria-hidden')
      assert(/pointer-events-none absolute left-1 top-1 h-11 rounded-full bg-warm/.test(src), 'the bg-warm pill is not pointer-events-none / not the persistent absolute pill')
    },
  ],
  // ── (d) the WAI-ARIA roving-tabindex tablist is intact ──────────────────────
  [
    'the roving-tabindex tablist + arrow-key nav survive',
    () => {
      assert(/role="tablist"/.test(src), 'lost role="tablist"')
      assert(/role="tab"/.test(src), 'lost role="tab"')
      assert(/aria-selected=\{/.test(src), 'lost aria-selected')
      assert(/tabIndex=\{selected \? 0 : -1\}/.test(src), 'lost the roving tabIndex={selected ? 0 : -1}')
      assert(/onTabKeyDown/.test(src), 'lost the onTabKeyDown handler')
      for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
        assert(new RegExp(key).test(src), `onTabKeyDown no longer handles ${key}`)
      }
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1327 links tab switcher persistent pill (adversarial)', () => {
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
  console.log(`\nAll ${cases.length} links-tab-switcher adversarial tests passed`)
}
