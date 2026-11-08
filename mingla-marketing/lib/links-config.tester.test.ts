// ---------------------------------------------------------------
// ORCH-1317 → #4318 — regression guard for the /links static data.
//
// #4318 retired the two-tab model (and with it the per-tab CTA hrefs and the
// per_surface / neutral / explorer_only social scopes this file used to pin).
// What is static now is the social row, so this pins it to Seth's approved set
// (feedback 16, 7 Nov 2026): exactly seven @usemingla accounts, in order, no X
// and no @minglahost, and no store / OneLink / host-web URL in the config.
//
// Run from mingla-marketing/ (repo tsc+node pattern):
//   npx tsc lib/links-config.tester.test.ts lib/links-config.ts --outDir /tmp/o \
//     --module commonjs --target es2020 --moduleResolution node \
//     && node /tmp/o/links-config.tester.test.js
// ---------------------------------------------------------------

import { LINKS_CITY_COOKIE, LINKS_SOCIAL_HANDLE, LINKS_SOCIALS } from './links-config'

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const APPROVED: ReadonlyArray<[string, string]> = [
  ['Instagram', 'www.instagram.com'],
  ['TikTok', 'www.tiktok.com'],
  ['Threads', 'www.threads.com'],
  ['Snapchat', 'www.snapchat.com'],
  ['YouTube', 'www.youtube.com'],
  ['Facebook', 'www.facebook.com'],
  ['LinkedIn', 'www.linkedin.com'],
]

const cases: ReadonlyArray<[string, () => void]> = [
  ['exactly the seven approved networks, in order', () => {
    assert(LINKS_SOCIALS.length === 7, `expected 7 socials, got ${LINKS_SOCIALS.length}`)
    APPROVED.forEach(([label, host], i) => {
      const s = LINKS_SOCIALS[i]
      assert(s.label === label, `social[${i}] is ${s.label}, expected ${label}`)
      assert(new URL(s.href).host === host, `${label} must live on ${host}, got ${s.href}`)
    })
  }],
  ['every social is the one @usemingla account set', () => {
    assert(LINKS_SOCIAL_HANDLE === 'usemingla', 'the handle is usemingla')
    for (const s of LINKS_SOCIALS) {
      assert(s.href.startsWith('https://'), `${s.label} must be https`)
      assert(new URL(s.href).pathname.toLowerCase().includes('usemingla'), `${s.label} must point at usemingla: ${s.href}`)
    }
  }],
  ['X and every @minglahost account are retired', () => {
    for (const s of LINKS_SOCIALS) {
      assert(!/(^|\.)x\.com$|twitter\.com/.test(new URL(s.href).host), `X is retired: ${s.href}`)
      assert(!/minglahost/i.test(s.href), `@minglahost is retired: ${s.href}`)
    }
  }],
  ['no store, OneLink or host-web URL in the config', () => {
    for (const s of LINKS_SOCIALS) {
      assert(!/apps\.apple\.com|play\.google\.com|usemingla\.com\/|go\.usemingla\.com|biz\.usemingla\.com|host\.usemingla\.com/.test(s.href), `${s.label} carries a destination URL`)
    }
  }],
  ['the remembered-city cookie is named for /links', () => {
    assert(LINKS_CITY_COOKIE === 'mingla_links_city', 'cookie name')
  }],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('#4318 /links static data (guard)', () => {
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
  console.log(`\nAll ${cases.length} links-config tests passed`)
}
