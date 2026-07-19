// ---------------------------------------------------------------
// ORCH-1399 [links-src-tracking-getapp-stack] — TESTER ADVERSARIAL test
// (independent QA leg — a DIFFERENT ANGLE from every implementor test).
//
// THE ANGLE: CAMPAIGN↔SURFACE BINDING. Every existing guard pins the
// DESTINATION side of attribution — T-7/orch-1399 R1/R2 pin the OneLink
// domains by identity, T-2/A-6 pin cross-app contamination, T-9 pins the
// anchor contract. NOTHING pins which CAMPAIGN a surface passes. The
// happy-path check (links-cta-device-aware.test.ts:215) only asserts both
// campaign tokens are PRESENT in the file — a token-presence check that
// stays green with the pairing FLIPPED.
//
// The defect this catches: swap the two literals so the Business branch
// resolves linksAttribution(src, 'explorer_bio') and the Explorer branch
// 'business_bio'. Every domain check stays green (the hrefs still point at
// the RIGHT apps), every anchor check stays green, tsc stays green (both
// are valid LinksCampaign members), the page works perfectly — and every
// bio install is reported under the WRONG surface forever. Silent, total,
// unbackfillable attribution poisoning: the exact bug class H-2 names,
// one layer up from the domain.
//
// SECOND ANGLE: sanitiser STATEFULNESS. A /g (or /y) flag on
// LINKS_SRC_PATTERN makes RegExp.prototype.test stateful via lastIndex:
// repeated calls alternate true/false on IDENTICAL valid input, so every
// second visitor with a valid ?src= silently falls to bio_direct. No
// table-driven single-pass suite reliably sees this — it depends on call
// COUNT, not input. Asserted both structurally (flags) and behaviourally
// (repeated + alternating calls).
//
// Repo pattern (no jest in mingla-marketing): plain tsc+node —
//   cd mingla-marketing
//   npx tsc components/marketing/__tests__/orch-1399-campaign-tab-binding.tester.test.ts \
//     --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node \
//     --esModuleInterop --skipLibCheck \
//     && node /tmp/o/components/marketing/__tests__/orch-1399-campaign-tab-binding.tester.test.js
// ---------------------------------------------------------------

import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  LINKS_SRC_PATTERN,
  linksAttribution,
  sanitizeLinksSrc,
  siteAttribution,
} from '../../../lib/links-src'
import { resolveBusinessAppTarget } from '../../../lib/business-app-target'
import { resolveExplorerAppTarget } from '../../../lib/explorer-app-target'

const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const readSurface = (rel: string): string =>
  stripComments(fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8'))

/**
 * Extract the EXACT argument text of a call by walking the paren balance from
 * the call token to its matching close — never a fixed-width window, which
 * would spill into the next statement and read a neighbouring call's campaign
 * as this call's (the decorative/mis-bound check trap this repo has now
 * produced five instances of).
 */
function callWindow(src: string, start: number, token: string): string {
  let depth = 0
  for (let i = start + token.length - 1; i < src.length; i++) {
    if (src[i] === '(') depth += 1
    else if (src[i] === ')') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return src.slice(start, start + 260) // unbalanced — fall back, the assert will name it
}

/**
 * Every call site of `fnName` in `src` must carry `mustHave` inside its OWN
 * argument list and must NOT carry any member of `mustNotHave`.
 */
function assertEveryCallBinds(
  label: string,
  src: string,
  fnName: string,
  mustHave: string,
  mustNotHave: readonly string[],
  failures: string[],
): void {
  const token = `${fnName}(`
  let idx = src.indexOf(token)
  if (idx === -1) {
    failures.push(`${label}: expected at least one ${fnName}( call site — found none (gate parse out of sync)`)
    return
  }
  let calls = 0
  while (idx !== -1) {
    calls += 1
    const windowSrc = callWindow(src, idx, token)
    if (!windowSrc.includes(mustHave)) {
      failures.push(
        `${label}: ${fnName}( call #${calls} does not bind ${mustHave} — this surface would report its ` +
          `installs under another surface's campaign. Window: ${windowSrc.slice(0, 140).replace(/\s+/g, ' ')}…`,
      )
    }
    for (const bad of mustNotHave) {
      if (windowSrc.includes(bad)) {
        failures.push(
          `${label}: ${fnName}( call #${calls} carries the FOREIGN campaign ${bad} — CROSSED CAMPAIGN. ` +
            `Every domain/anchor check stays green while all attribution lands under the wrong surface. ` +
            `Window: ${windowSrc.slice(0, 140).replace(/\s+/g, ' ')}…`,
        )
      }
    }
    idx = src.indexOf(token, idx + token.length)
  }
}

const failures: string[] = []
const check = (name: string, fn: () => void): void => {
  try {
    fn()
    // eslint-disable-next-line no-console
    console.log(`PASS  ${name}`)
  } catch (e) {
    failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    // eslint-disable-next-line no-console
    console.log(`FAIL  ${name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

// ── 1. /links — the bio surface. Tab decides the campaign; src never does. ────
check('C-A: links-experience binds business_bio↔business and explorer_bio↔explorer (never flipped)', () => {
  const src = readSurface('components/marketing/links-experience.tsx')
  const f: string[] = []
  assertEveryCallBinds('links-experience', src, 'resolveBusinessAppTarget', "'business_bio'", ["'explorer_bio'"], f)
  assertEveryCallBinds('links-experience', src, 'resolveExplorerAppTarget', "'explorer_bio'", ["'business_bio'"], f)
  assert(f.length === 0, f.join(' | '))
})

// ── 2. The three site surfaces (SPEC OQ-4) — each binds its OWN campaign. ─────
check('C-B: glass-nav binds business_nav / explorer_nav to the right resolvers', () => {
  const src = readSurface('components/marketing/glass-nav.tsx')
  const f: string[] = []
  assertEveryCallBinds('glass-nav', src, 'resolveBusinessAppTarget', "siteAttribution('business_nav')", [
    "'explorer_nav'", "'business_bio'", "'explorer_bio'", "'business_hero'", "'business_download'",
  ], f)
  assertEveryCallBinds('glass-nav', src, 'resolveExplorerAppTarget', "siteAttribution('explorer_nav')", [
    "'business_nav'", "'business_bio'", "'explorer_bio'",
  ], f)
  assert(f.length === 0, f.join(' | '))
})

check('C-C: hero binds business_hero; /business/download binds business_download', () => {
  const f: string[] = []
  assertEveryCallBinds('hero', readSurface('components/sections/organiser-home/hero.tsx'),
    'resolveBusinessAppTarget', "siteAttribution('business_hero')",
    ["'business_nav'", "'business_download'", "'business_bio'", "'explorer_bio'"], f)
  assertEveryCallBinds('/business/download', readSurface('app/business/download/page.tsx'),
    'resolveBusinessAppTarget', "siteAttribution('business_download')",
    ["'business_nav'", "'business_hero'", "'business_bio'", "'explorer_bio'"], f)
  assert(f.length === 0, f.join(' | '))
})

// ── 3. Behavioural: the campaign RIDES, by URL identity (not substring). ──────
check('C-D: campaign + pid ride into the emitted href exactly (URL-parsed identity)', () => {
  const biz = resolveBusinessAppTarget('android', linksAttribution(sanitizeLinksSrc('YouTube'), 'business_bio'))
  assert(biz.installHref !== null, 'business android installHref is null')
  const bu = new URL(biz.installHref as string)
  assert(bu.host === 'biz.usemingla.com' && bu.pathname === '/ZSCW', `wrong business base: ${bu.href}`)
  assert(bu.searchParams.get('pid') === 'bio_youtube', `pid=${bu.searchParams.get('pid')}`)
  assert(bu.searchParams.get('c') === 'business_bio', `c=${bu.searchParams.get('c')} — campaign did not ride`)

  const exp = resolveExplorerAppTarget('ios', linksAttribution(sanitizeLinksSrc('YouTube'), 'explorer_bio'))
  const eu = new URL(exp.installHref as string)
  assert(eu.host === 'go.usemingla.com' && eu.pathname === '/w36m', `wrong explorer base: ${eu.href}`)
  assert(eu.searchParams.get('c') === 'explorer_bio', `c=${eu.searchParams.get('c')}`)

  const dl = resolveBusinessAppTarget('ios', siteAttribution('business_download'))
  const du = new URL(dl.installHref as string)
  assert(du.searchParams.get('pid') === 'mingla_web' && du.searchParams.get('c') === 'business_download',
    `site attribution wrong: ${du.href}`)
})

// ── 4. Sanitiser statefulness — /g or /y would rot it silently. ──────────────
check('C-E: LINKS_SRC_PATTERN is stateless (no g/y flag), structurally and behaviourally', () => {
  assert(!LINKS_SRC_PATTERN.flags.includes('g') && !LINKS_SRC_PATTERN.flags.includes('y'),
    `LINKS_SRC_PATTERN carries a stateful flag ('${LINKS_SRC_PATTERN.flags}') — RegExp.test with /g|/y ` +
      `is lastIndex-stateful: repeated calls alternate true/false on IDENTICAL valid input, so every ` +
      `second visitor with a valid ?src= silently falls to bio_direct`)
  // Behavioural pin — survives a rewrite of the constant into a new RegExp(...):
  const repeated = [1, 2, 3, 4].map(() => sanitizeLinksSrc('youtube'))
  assert(repeated.every((r) => r === 'youtube'),
    `repeated sanitizeLinksSrc('youtube') diverged: ${JSON.stringify(repeated)} — the sanitiser is stateful`)
  const alternating = ['youtube', 'linkedin', 'youtube', 'seth', 'youtube', 'linkedin'].map((v) => sanitizeLinksSrc(v))
  assert(alternating.join(',') === 'youtube,linkedin,youtube,seth,youtube,linkedin',
    `alternating valid inputs diverged: ${JSON.stringify(alternating)}`)
})

// ── 5. Idempotence — a double-sanitised value never degrades. ────────────────
check('C-F: sanitizeLinksSrc is idempotent on both the accept and the fail-safe path', () => {
  assert(sanitizeLinksSrc(sanitizeLinksSrc('  YouTube  ')) === 'youtube', 'accept path not idempotent')
  assert(sanitizeLinksSrc(sanitizeLinksSrc('<script>')) === 'direct', 'fail-safe path not idempotent')
})

if (failures.length > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failures.length} campaign-binding adversarial test(s) failed`)
  process.exit(1)
}
// eslint-disable-next-line no-console
console.log('\nAll 6 ORCH-1399 campaign-tab-binding adversarial tests passed')
