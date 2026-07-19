// ---------------------------------------------------------------
// ORCH-1399 [links-src-tracking-getapp-stack] — HAPPY-PATH regression test (T-3/T-5).
//
// Covers the sanitiser's contract for the inputs it is SUPPOSED to receive, plus the
// href builder. The adversarial half (every malformed/hostile input) is a separate
// file on a different angle: links-src.tester.test.ts (T-4).
//
// Run from mingla-marketing/ (the package has no jest — repo tsc+node pattern; tsc
// roots the emit at lib/, so the runnable JS lands in /tmp/o/__tests__/):
//   npx tsc lib/__tests__/links-src.test.ts --outDir /tmp/o --module commonjs \
//     --target es2020 --moduleResolution node && node /tmp/o/__tests__/links-src.test.js
// ---------------------------------------------------------------

import {
  LINKS_PID_PREFIX,
  LINKS_SRC_FALLBACK,
  buildOneLinkHref,
  linksAttribution,
  sanitizeLinksSrc,
  siteAttribution,
  toBioPid,
} from '../links-src'
import { BUSINESS_ONELINK_URL, EXPLORER_ONELINK_URL } from '../store-links'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  // ── T-3 the three named channels ────────────────────────────────────────────
  [
    'T-3: the named bio channels pass through unchanged',
    () => {
      for (const src of ['youtube', 'linkedin', 'seth']) {
        assert(sanitizeLinksSrc(src) === src, `${src} did not survive sanitisation: ${sanitizeLinksSrc(src)}`)
      }
    },
  ],
  // ── T-3 case/trim tolerance — bios are typed by humans ──────────────────────
  [
    'T-3: sanitisation lowercases and trims (bios are typed by humans)',
    () => {
      assert(sanitizeLinksSrc('YouTube') === 'youtube', `YouTube → ${sanitizeLinksSrc('YouTube')}`)
      assert(sanitizeLinksSrc('  YouTube  ') === 'youtube', `padded → ${sanitizeLinksSrc('  YouTube  ')}`)
      assert(sanitizeLinksSrc('LINKEDIN') === 'linkedin', `LINKEDIN → ${sanitizeLinksSrc('LINKEDIN')}`)
      // Dropping .toLowerCase() would emit pid=bio_YouTube — a SECOND media source
      // for the same channel, silently splitting the report in half.
      assert(sanitizeLinksSrc('YouTube') !== 'YouTube', 'lowercasing was dropped — bio_YouTube would split reporting from bio_youtube')
    },
  ],
  // ── T-3 the fail-safe ───────────────────────────────────────────────────────
  [
    'T-3: absent src falls safe to `direct` (never empty, never omitted)',
    () => {
      assert(sanitizeLinksSrc(undefined) === LINKS_SRC_FALLBACK, 'undefined did not fall back')
      assert(LINKS_SRC_FALLBACK === 'direct', `fallback drifted: ${LINKS_SRC_FALLBACK}`)
      assert(toBioPid(sanitizeLinksSrc(undefined)) === 'bio_direct', 'absent src does not produce bio_direct')
    },
  ],
  // ── T-3 the prefix is structural ────────────────────────────────────────────
  [
    'T-3: toBioPid roots every pid at the bio_ prefix (H-1)',
    () => {
      assert(toBioPid('youtube') === 'bio_youtube', `toBioPid: ${toBioPid('youtube')}`)
      assert(LINKS_PID_PREFIX === 'bio_', `prefix drifted: ${LINKS_PID_PREFIX}`)
      assert(toBioPid('youtube').startsWith(LINKS_PID_PREFIX), 'toBioPid does not root at LINKS_PID_PREFIX')
    },
  ],
  // ── T-5 the builder encodes via URLSearchParams ─────────────────────────────
  [
    'T-5: buildOneLinkHref produces a well-formed base+query with pid and c',
    () => {
      const href = buildOneLinkHref(EXPLORER_ONELINK_URL, {
        pid: 'bio_youtube',
        campaign: 'explorer_bio',
      })
      assert(href === `${EXPLORER_ONELINK_URL}?pid=bio_youtube&c=explorer_bio`, `href = ${href}`)
      // Parse it back — the emitted URL must be real, not merely string-shaped.
      const parsed = new URL(href)
      assert(parsed.searchParams.get('pid') === 'bio_youtube', `pid did not survive a round-trip: ${parsed.searchParams.get('pid')}`)
      assert(parsed.searchParams.get('c') === 'explorer_bio', `c did not survive a round-trip: ${parsed.searchParams.get('c')}`)
      assert(parsed.origin === 'https://go.usemingla.com', `origin drifted: ${parsed.origin}`)
    },
  ],
  // ── T-5 encoding is genuine, not decorative ─────────────────────────────────
  [
    'T-5: buildOneLinkHref ENCODES its values (URLSearchParams, not concat)',
    () => {
      // The sanitiser makes this unreachable in production; the builder is the SECOND
      // lock. Hand it a hostile value directly: manual concat would emit it raw and
      // break the URL; URLSearchParams percent-encodes it.
      const href = buildOneLinkHref(BUSINESS_ONELINK_URL, {
        pid: 'a&c=evil',
        campaign: 'business_bio',
      })
      assert(!href.includes('pid=a&c=evil'), `builder concatenated a raw value — query injection: ${href}`)
      assert(href.includes('a%26c%3Devil'), `builder did not percent-encode: ${href}`)
      // The real `c` must survive the injection attempt.
      assert(new URL(href).searchParams.get('c') === 'business_bio', 'an injected value overwrote the real campaign')
    },
  ],
  // ── T-5 the two attribution factories ───────────────────────────────────────
  [
    'T-5: linksAttribution carries the tab campaign and a bio_ pid',
    () => {
      const explorer = linksAttribution('youtube', 'explorer_bio')
      assert(explorer.pid === 'bio_youtube', `explorer pid = ${explorer.pid}`)
      assert(explorer.campaign === 'explorer_bio', `explorer campaign = ${explorer.campaign}`)
      const business = linksAttribution('youtube', 'business_bio')
      // The SAME src on the other tab: only `c` changes. This is SC-3 in miniature.
      assert(business.pid === 'bio_youtube', `business pid = ${business.pid}`)
      assert(business.campaign === 'business_bio', `business campaign = ${business.campaign}`)
    },
  ],
  [
    'T-5: siteAttribution uses the owned-media pid, NOT a bio_ one',
    () => {
      const nav = siteAttribution('business_nav')
      assert(nav.pid === 'mingla_web', `site pid = ${nav.pid}`)
      assert(!nav.pid.startsWith('bio_'), 'site surfaces must not claim bio_ provenance — they are not bio traffic')
      assert(nav.campaign === 'business_nav', `site campaign = ${nav.campaign}`)
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1399 links-src (happy-path)', () => {
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
  console.log(`\nAll ${cases.length} links-src happy-path tests passed`)
}
