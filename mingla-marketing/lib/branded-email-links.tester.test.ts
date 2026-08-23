// ---------------------------------------------------------------
// #2470 [branded marketing email links] — regression guard.
//
// WHY: every Mingla marketing email carried a raw
// `https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/marketing-track-click/<id>`
// link. Both builders accept a branded origin and fall back to the Supabase
// endpoint when none is configured — and neither variable had ever been
// provisioned, so the fallback WAS production. A link domain that shares
// nothing with the From domain is a standard spam signal, and reads as
// phishing to a human.
//
// This pins the three things that keep the branded path working: the rewrites
// that make `/m/:id` resolve, the secrets that make the builders emit it, and
// the opt-out page the tokenised rewrite must not disturb.
//
// Runs via the repo's tsc+node pattern (same as links-config.tester):
//   npx tsc lib/branded-email-links.tester.test.ts --outDir /tmp/o \
//     --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/branded-email-links.tester.test.js
// ---------------------------------------------------------------

import fs from 'node:fs'
import path from 'node:path'

// Resolve the repo root by walking up from the working directory. `__dirname`
// is wrong here: this file is compiled to a temp outDir before it runs, so it
// would point at the build output rather than the source tree.
function findRepoRoot(): string {
  let dir = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'supabase/secrets.manifest.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`could not locate the repo root from ${process.cwd()}`)
}

const root = findRepoRoot()
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8')

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const nextConfig = read('mingla-marketing/next.config.ts')
const manifest = read('supabase/secrets.manifest.json')

const cases: ReadonlyArray<[string, () => void]> = [
  [
    'proxies the click tracker from the apex so link domain matches sender domain',
    () => {
      assert(
        nextConfig.includes("source: '/m/:trackingId'"),
        'next.config.ts has no /m/:trackingId rewrite',
      )
      assert(
        nextConfig.includes('marketing-track-click/:trackingId'),
        '/m rewrite does not point at marketing-track-click',
      )
    },
  ],
  [
    'proxies the tokenised unsubscribe path',
    () => {
      assert(
        nextConfig.includes("source: '/unsubscribe/:token'"),
        'next.config.ts has no /unsubscribe/:token rewrite',
      )
      assert(
        nextConfig.includes('marketing-unsubscribe/:token'),
        'unsubscribe rewrite does not point at marketing-unsubscribe',
      )
    },
  ],
  [
    'leaves the human-facing opt-out page untouched',
    () => {
      // Only the tokenised SUB-path is proxied. `/unsubscribe` itself is a form
      // someone fills in without a token, and must keep rendering.
      assert(
        fs.existsSync(path.join(root, 'mingla-marketing/app/unsubscribe/page.tsx')),
        'the manual unsubscribe page was removed',
      )
      assert(
        !nextConfig.includes("source: '/unsubscribe'\n"),
        'a rewrite is swallowing the manual unsubscribe page',
      )
    },
  ],
  [
    'registers both origin secrets so the raw-endpoint fallback is never production',
    () => {
      assert(
        manifest.includes('MINGLA_TRACKING_LINK_ORIGIN'),
        'MINGLA_TRACKING_LINK_ORIGIN is not in the secrets manifest',
      )
      assert(
        manifest.includes('MINGLA_UNSUBSCRIBE_LINK_ORIGIN'),
        'MINGLA_UNSUBSCRIBE_LINK_ORIGIN is not in the secrets manifest',
      )
    },
  ],
  [
    'keeps the builders reading the branded origin',
    () => {
      assert(
        read('supabase/functions/_shared/marketingEmailRender.ts').includes(
          'MINGLA_TRACKING_LINK_ORIGIN',
        ),
        'marketingEmailRender no longer reads MINGLA_TRACKING_LINK_ORIGIN',
      )
      assert(
        read('supabase/functions/marketing-send/index.ts').includes(
          'MINGLA_UNSUBSCRIBE_LINK_ORIGIN',
        ),
        'marketing-send no longer reads MINGLA_UNSUBSCRIBE_LINK_ORIGIN',
      )
    },
  ],
]

{
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
  console.log(`\nAll ${cases.length} branded-email-link tests passed`)
}
