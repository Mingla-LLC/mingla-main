// ---------------------------------------------------------------
// ORCH-1319 [Explorer direct store links] — DOWNLOAD_URL contract unit test (T-7).
//
// The download QR encodes DOWNLOAD_URL. This pins the URL the QR must carry:
//   - it is an ABSOLUTE URL on the canonical origin (a phone scanner needs it),
//   - it ends in exactly `/download` with NO double slash (origin trailing-slash
//     stripped), and
//   - it equals `${SITE_ORIGIN}/download`.
//
// Pure module contract → no DOM. Runs via the repo's tsc+node pattern:
//   npx tsc lib/site.ts lib/site.test.ts --outDir /tmp/o --module commonjs \
//     --target es2020 && node /tmp/o/site.test.js
// ---------------------------------------------------------------

import { SITE_ORIGIN, DOWNLOAD_URL } from './site'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  [
    'DOWNLOAD_URL is an absolute https URL',
    () => assert(/^https?:\/\//.test(DOWNLOAD_URL), `not absolute: ${DOWNLOAD_URL}`),
  ],
  [
    'DOWNLOAD_URL ends in exactly /download (no double slash)',
    () => {
      assert(DOWNLOAD_URL.endsWith('/download'), `missing /download: ${DOWNLOAD_URL}`)
      assert(!/\/\/download$/.test(DOWNLOAD_URL), `double slash before download: ${DOWNLOAD_URL}`)
    },
  ],
  [
    'SITE_ORIGIN carries no trailing slash',
    () => assert(!SITE_ORIGIN.endsWith('/'), `trailing slash: ${SITE_ORIGIN}`),
  ],
  [
    'DOWNLOAD_URL === `${SITE_ORIGIN}/download`',
    () => assert(DOWNLOAD_URL === `${SITE_ORIGIN}/download`, `mismatch: ${DOWNLOAD_URL}`),
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('lib/site DOWNLOAD_URL (ORCH-1319)', () => {
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
  console.log(`\nAll ${cases.length} site tests passed`)
}
