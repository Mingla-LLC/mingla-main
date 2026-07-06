// ---------------------------------------------------------------
// ORCH-1319 [Explorer direct store links] — device-platform parity unit test (T-8).
//
// Pins that the detection extracted VERBATIM from the deleted explorer lead modal
// keeps its exact behavior (no drift): the iPad-as-Mac, Android, and desktop
// cases, plus the server UA-only variant + its documented iPad-as-Mac fallback.
//
// Written for a Jest / Vitest harness (describe/it/expect). The marketing package
// has no test runner wired (mirrors the repo's tsc+node test pattern), so this
// also ships a Node-assert runner block at the bottom — proves fails-on-revert:
//   npx tsc lib/device-platform.ts lib/device-platform.test.ts --outDir /tmp/o \
//     --module commonjs --target es2020 && node /tmp/o/device-platform.test.js
// ---------------------------------------------------------------

import {
  isIosDevice,
  resolvePlatform,
  resolvePlatformFromUa,
} from './device-platform'

// Representative user-agent strings.
const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const UA_IPAD_CLASSIC =
  'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
const UA_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
const UA_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const UA_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

function expectFn(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected) {
        throw new Error(
          `expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`,
        )
      }
    },
  }
}

const cases: ReadonlyArray<[string, () => void]> = [
  [
    'iPad-as-Mac (MacIntel + maxTouchPoints>1) resolves to ios',
    () => {
      expectFn(isIosDevice(UA_MAC, 'MacIntel', 5)).toBe(true)
      expectFn(resolvePlatform(UA_MAC, 'MacIntel', 5)).toBe('ios')
    },
  ],
  [
    'a real Mac (MacIntel + no touch) is NOT iOS → other',
    () => {
      expectFn(isIosDevice(UA_MAC, 'MacIntel', 0)).toBe(false)
      expectFn(resolvePlatform(UA_MAC, 'MacIntel', 0)).toBe('other')
    },
  ],
  [
    'classic iPhone / iPad UA resolves to ios',
    () => {
      expectFn(resolvePlatform(UA_IPHONE, 'iPhone', 5)).toBe('ios')
      expectFn(resolvePlatform(UA_IPAD_CLASSIC, 'iPad', 5)).toBe('ios')
    },
  ],
  [
    'Android UA resolves to android (client + server)',
    () => {
      expectFn(resolvePlatform(UA_ANDROID, '', 5)).toBe('android')
      expectFn(resolvePlatformFromUa(UA_ANDROID)).toBe('android')
    },
  ],
  [
    'Windows / desktop resolves to other (client + server)',
    () => {
      expectFn(resolvePlatform(UA_WINDOWS, 'Win32', 0)).toBe('other')
      expectFn(resolvePlatformFromUa(UA_WINDOWS)).toBe('other')
    },
  ],
  [
    'server UA-only: classic iPhone/iPad → ios; empty UA → other',
    () => {
      expectFn(resolvePlatformFromUa(UA_IPHONE)).toBe('ios')
      expectFn(resolvePlatformFromUa(UA_IPAD_CLASSIC)).toBe('ios')
      expectFn(resolvePlatformFromUa('')).toBe('other')
    },
  ],
  [
    "server UA-only caveat: iPad-as-Mac desktop UA (no iPad token) → other (safe QR-page fallback)",
    () => {
      expectFn(resolvePlatformFromUa(UA_MAC)).toBe('other')
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('device-platform (ORCH-1319 detection parity)', () => {
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
  console.log(`\nAll ${cases.length} device-platform tests passed`)
}
