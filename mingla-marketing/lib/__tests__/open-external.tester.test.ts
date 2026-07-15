// ---------------------------------------------------------------
// ORCH-1381 ADDENDUM D-B [business-getapp-android-choice] — TESTER ADVERSARIAL
// regression test. Attacks a DIFFERENT ANGLE from the implementor's happy-path
// suite (lib/__tests__/open-external.test.ts).
//
// THE IMPLEMENTOR'S ANGLE: drive openExternal against a fake Window and assert the
// popup-block fallback does not fire on a successful open. That suite's fake models
// the HTML rule as:
//
//     if (/\bnoopener\b|\bnoreferrer\b/.test(features)) return null   // CASE-SENSITIVE
//
// THE ATTACK (this file): **that model is wrong, and the error is exploitable.**
// HTML window-feature names are ASCII **case-INSENSITIVE**. Verified by execution in
// real Chromium during the ORCH-1381 retest — every one of these returns null EVEN
// ON SUCCESS, i.e. every one reships the D-B double-navigation bug:
//
//     'noopener'  'NOOPENER'  'NoOpener'  ' noopener '  'noopener,'  'noopener=yes'
//     'noreferrer' 'NOREFERRER' 'NoReferrer' ' noreferrer ' 'noreferrer=yes'
//     'noopener,noreferrer'  'noreferrer,noopener'  'NOOPENER,NOREFERRER'
//
//   ...while these return a real WindowProxy (safe):
//
//     ''  'width=100'  'popup=1'  (absent)
//
// PROVEN BLIND SPOT (retest, by execution): patching the module to
// `w.open(dest, '_blank', 'NOOPENER')` — a pure case change — leaves ALL 4 tests in
// open-external.test.ts GREEN and ALL 6 strict-grep gates GREEN
// (orch-1324/1328/1381-*, whose regexes are likewise case-sensitive), while a real
// Chromium double-navigated on 7 of 7 marketing CTAs. Tests green, gates green, bug
// shipped — the exact failure class of ADDENDUM C-2/D-A3 (a guard that cannot
// distinguish the fix from the bug).
//
// SO THIS FILE'S FAKE IS THE BROWSER-ACCURATE ONE (`/i`). It is the load-bearing
// difference: openExternal is driven against a Window that nulls the return for the
// FULL case-insensitive variant class, so any case-variant mutation is caught here
// even though it slips every other guard.
//
// A-3 attacks repetition rather than the feature string: the ONE owner must be
// idempotent across taps (a user double-taps a CTA constantly on a phone).
//
// Run from mingla-marketing/ (tsc roots the emit at lib/):
//   npx tsc lib/__tests__/open-external.tester.test.ts --outDir /tmp/oet \
//     --module commonjs --target es2020 --moduleResolution node --skipLibCheck \
//     && node /tmp/oet/__tests__/open-external.tester.test.js
// ---------------------------------------------------------------

import * as fs from 'fs'
import * as path from 'path'
import { openExternal } from '../open-external'

const DEST = 'https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness'

interface OpenCall {
  url: string
  target: string | undefined
  features: string
}
interface Log {
  opened: OpenCall[]
  assigned: string[]
}

/**
 * The BROWSER-ACCURATE rule (this is the whole point of this file).
 *
 * Per HTML, window-feature names are ASCII case-insensitive, and `noreferrer`
 * implies `noopener`; either token forces open() to return null EVEN ON SUCCESS.
 * The `/i` flag below is what the implementor's model is missing.
 *
 * Verified against real Chromium — see the docblock variant matrix.
 */
const NULLS_THE_RETURN = /\bnoopener\b|\bnoreferrer\b/i

/**
 * A fake Window modelling the real browser. `popupBlocked` forces the genuine
 * popup-block case (open() returns null with NO feature string at all).
 */
const makeFakeWindow = (popupBlocked = false): { w: Window; log: Log } => {
  const log: Log = { opened: [], assigned: [] }
  const w = {
    open(url: string, target?: string, features?: string): Window | null {
      log.opened.push({ url, target, features: features ?? '' })
      if (popupBlocked) return null
      // THE BROWSER RULE — case-insensitive.
      if (NULLS_THE_RETURN.test(features ?? '')) return null
      // A successful open returns a real WindowProxy.
      return { opener: {} } as unknown as Window
    },
    location: {
      assign(url: string): void {
        log.assigned.push(url)
      },
    },
  }
  return { w: w as unknown as Window, log }
}

let failures = 0
const check = (name: string, fn: () => void): void => {
  try {
    fn()
    console.log(`PASS  ${name}`)
  } catch (e) {
    failures++
    console.log(`FAIL  ${name}: ${(e as Error).message}`)
  }
}
const assert = (cond: boolean, msg: string): void => {
  if (!cond) throw new Error(msg)
}

// ── A-1: the case-variant mutation class (THE attack) ───────────────────────────
// Driven against a browser-accurate fake. If openExternal ever passes ANY
// case-variant of noopener/noreferrer, the fake nulls the return, the fallback
// fires, and the double-navigation is observable HERE — even though the
// implementor's case-sensitive suite and every strict-grep gate stay green.
check(
  'A-1: a successful open does NOT also navigate the current tab, under a ' +
    'BROWSER-ACCURATE (case-insensitive) window model',
  () => {
    const { w, log } = makeFakeWindow()
    openExternal(DEST, w)

    assert(
      log.opened.length === 1,
      `expected exactly 1 window.open call, got ${log.opened.length}`,
    )
    assert(
      log.assigned.length === 0,
      `DOUBLE NAVIGATION — the popup opened AND the current tab navigated to ` +
        `"${log.assigned[0]}". openExternal passed features=` +
        `"${log.opened[0]?.features}", which contains a case-variant of ` +
        `noopener/noreferrer. Per HTML those names are ASCII case-INSENSITIVE, so ` +
        `open() returns null even on success and the fallback fires on EVERY tap. ` +
        `This is the ORCH-1381 ADDENDUM D-B bug reshipped through the case blind ` +
        `spot that open-external.test.ts (case-sensitive model) and all 6 ` +
        `strict-grep gates (case-sensitive regexes) cannot see.`,
    )
  },
)

// ── A-2: the same invariant enforced STATICALLY, case-insensitively ─────────────
// Belt-and-braces on the real source: whatever feature string the module passes (if
// any) must not carry a noopener/noreferrer token in ANY casing.
check(
  'A-2: the module never passes a noopener/noreferrer feature string in ANY casing',
  () => {
    // Resolved from process.cwd() (= mingla-marketing/), matching the package's
    // existing tsc+node tests — __dirname would point at the compiled outDir.
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'lib/open-external.ts'),
      'utf8',
    )
    // Strip comments — the docblock legitimately NAMES the banned tokens to explain
    // them. Only real code counts. (Same stripping rationale as the 1381 gate.)
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')

    const openCall = code.match(/\.open\(([^)]*)\)/)
    assert(
      openCall !== null,
      'no .open( call found in open-external.ts — the ONE owner must still open a tab',
    )
    const args = openCall![1]
    assert(
      !NULLS_THE_RETURN.test(args),
      `.open(${args}) passes a noopener/noreferrer token. HTML feature names are ` +
        `ASCII case-insensitive, so ANY casing returns null even on success and ` +
        `re-ships the D-B double-navigation bug. Sever the opener with ` +
        `\`win.opener = null\` instead — never via the feature string.`,
    )
  },
)

// ── A-3: idempotency across repeated taps (a different axis entirely) ───────────
// Phones double-tap. N taps must be N opens and ZERO same-tab navigations; the
// fallback must never leak in on a later tap.
check(
  'A-3: repeated taps stay clean — N successful opens, ZERO same-tab navigations',
  () => {
    const { w, log } = makeFakeWindow()
    openExternal(DEST, w)
    openExternal(DEST, w)
    openExternal(DEST, w)

    assert(log.opened.length === 3, `expected 3 opens, got ${log.opened.length}`)
    assert(
      log.assigned.length === 0,
      `a repeated tap fell back to a same-tab navigation (${log.assigned.length} ` +
        `assign(s): ${JSON.stringify(log.assigned)}). Every successful tap must open ` +
        `a tab and leave the marketing page mounted.`,
    )
    for (const c of log.opened) {
      assert(
        c.url === DEST,
        `a tap opened "${c.url}" instead of the requested destination "${DEST}"`,
      )
      assert(c.target === '_blank', `a tap opened with target="${c.target}", expected _blank`)
    }
  },
)

// ── A-4: the genuine popup block still falls back EXACTLY once, to the SAME url ──
// Guards the other direction: killing the double-nav must not kill the no-dead-tap
// property, and must not double-assign.
check(
  'A-4: a genuinely blocked popup falls back EXACTLY once, to the same destination',
  () => {
    const { w, log } = makeFakeWindow(true)
    openExternal(DEST, w)

    assert(
      log.assigned.length === 1,
      `expected exactly 1 fallback navigation on a real popup block, got ` +
        `${log.assigned.length} — a blocked popup must never be a dead tap, and ` +
        `must never navigate twice.`,
    )
    assert(
      log.assigned[0] === DEST,
      `the fallback navigated to "${log.assigned[0]}" instead of "${DEST}"`,
    )
  },
)

if (failures > 0) {
  console.log(`\n${failures} tester adversarial test(s) failed`)
  process.exit(1)
}
console.log('\nAll 4 tester adversarial open-external tests passed')
