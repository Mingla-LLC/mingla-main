// ---------------------------------------------------------------
// ORCH-1381 ADDENDUM D-B [business-getapp-android-choice] — HAPPY-PATH regression
// test for the double-navigation bug.
//
// THE BUG. `window.open(dest, '_blank', 'noopener,noreferrer')` returns null EVEN
// ON SUCCESS (HTML spec), so the `if (!win) window.location.assign(dest)`
// "popup-blocked fallback" fired on EVERY tap: a new tab opened AND the current tab
// navigated away. Every marketing CTA double-navigated in production.
//
// WHY THIS TEST IS BEHAVIOURAL, NOT A SOURCE GREP. A test that merely asserts
// `window.location.assign(` EXISTS passes on the buggy code — that is exactly what
// the old CI gates did, and they were green while the bug shipped (ADDENDUM C-2:
// the gates were BLIND, not wrong). This test instead DRIVES openExternal against a
// fake Window and asserts the fallback does NOT fire on a successful open.
//
// THE LOAD-BEARING PART is `makeFakeWindow`: it models the browser-verified HTML
// rule that noopener OR noreferrer => null even on success. If that model is ever
// weakened, T-A/T-B stop catching the bug and this whole contract becomes theatre.
//
// The marketing package has NO jest/vitest runner wired — this is run via the
// repo's tsc+node pattern (mirrors lib/__tests__/business-app-target.test.ts). Run
// from mingla-marketing/:
//   npx tsc lib/__tests__/open-external.test.ts --outDir /tmp/oe \
//     --module commonjs --target es2020 --moduleResolution node --skipLibCheck \
//     && node /tmp/oe/__tests__/open-external.test.js
// (tsc roots the emit at lib/, so the runnable JS lands in /tmp/oe/__tests__/.)
// ---------------------------------------------------------------

import { openExternal } from '../open-external'

const DEST = 'https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness'

interface OpenCall {
  url: string
  target: string | undefined
  features: string
}

interface FakeWindowResult {
  w: Window
  log: { opened: OpenCall[]; assigned: string[] }
  lastPopup: { opener: unknown } | null
}

/**
 * A fake Window modelling the REAL, browser-verified window.open contract.
 *
 * Verified in Chromium across 5 feature strings (ADDENDUM §4.2):
 *   'noopener,noreferrer' -> null   |  'noopener' -> null
 *   'noreferrer'          -> null   |  ''/absent  -> WindowProxy
 *
 * The noreferrer-alone case is THE trap (ADDENDUM C-4): a half-fix that drops only
 * 'noopener' ships the identical bug. Modelling it here is what makes T-A/T-B catch
 * that half-fix.
 */
function makeFakeWindow({ popupBlocked = false } = {}): FakeWindowResult {
  const log: { opened: OpenCall[]; assigned: string[] } = { opened: [], assigned: [] }
  const result: FakeWindowResult = { w: null as unknown as Window, log, lastPopup: null }

  const w = {
    open(url: string, target?: string, features = ''): unknown {
      log.opened.push({ url, target, features })
      if (popupBlocked) return null
      // HTML spec, verified in Chromium: noopener OR noreferrer => null EVEN ON SUCCESS.
      if (/\bnoopener\b|\bnoreferrer\b/.test(features)) return null
      const popup = { opener: {} as unknown }
      result.lastPopup = popup as { opener: unknown }
      return popup
    },
    location: {
      assign: (u: string): void => {
        log.assigned.push(u)
      },
    },
  }

  result.w = w as unknown as Window
  return result
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg)
}

const cases: ReadonlyArray<[string, () => void]> = [
  // ── T-A ⭐ THE REGRESSION GUARD (fails-on-revert) ────────────────────────────
  // This is the double navigation itself. On a SUCCESSFUL open the same-tab
  // fallback must NOT fire. The buggy pattern fails here because its feature
  // string nulls the return, making `!win` true on success.
  [
    'T-A: a SUCCESSFUL open does NOT also navigate the current tab (no double-nav)',
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
          `"${log.assigned[0]}". The location.assign fallback must fire ONLY when ` +
          `open() returns null (a real popup block), never on success. This is the ` +
          `ORCH-1381 ADDENDUM D-B bug: a feature string containing noopener/noreferrer ` +
          `makes open() return null even on success.`,
      )
    },
  ],
  // ── T-B the null-return CAUSE + the noreferrer-only half-fix trap ────────────
  [
    'T-B: window.open is called with NO noopener/noreferrer feature string',
    () => {
      const { w, log } = makeFakeWindow()
      openExternal(DEST, w)
      const call = log.opened[0]
      assert(call !== undefined, 'window.open was never called')
      assert(
        !/\bnoopener\b/.test(call.features),
        `window.open carries 'noopener' (features="${call.features}") — per the HTML spec ` +
          `it then returns null EVEN ON SUCCESS and the fallback double-navigates.`,
      )
      assert(
        !/\bnoreferrer\b/.test(call.features),
        `window.open carries 'noreferrer' (features="${call.features}") — THE HALF-FIX TRAP: ` +
          `noreferrer IMPLIES noopener, so it ALSO returns null on success and ships the ` +
          `identical double-navigation bug (ORCH-1381 ADDENDUM C-4).`,
      )
      assert(
        call.target === '_blank',
        `window.open target is "${call.target}", expected '_blank' (open in a new tab)`,
      )
      assert(call.url === DEST, `window.open url is "${call.url}", expected "${DEST}"`)
    },
  ],
  // ── T-C no silent failure: a GENUINELY blocked popup must still navigate ─────
  [
    'T-C: a genuinely blocked popup DOES fall back to a same-tab navigation (no dead tap)',
    () => {
      const { w, log } = makeFakeWindow({ popupBlocked: true })
      openExternal(DEST, w)
      assert(
        log.assigned.length === 1,
        `expected exactly 1 location.assign fallback when the popup is blocked, got ` +
          `${log.assigned.length} — a blocked popup with no fallback is a DEAD TAP.`,
      )
      assert(
        log.assigned[0] === DEST,
        `fallback navigated to "${log.assigned[0]}", expected "${DEST}"`,
      )
    },
  ],
  // ── T-D the security property noopener used to provide ──────────────────────
  [
    'T-D: the popup opener reference is severed (no reverse tabnabbing)',
    () => {
      // NOTE: read `fake.lastPopup` AFTER the call — the popup is created inside
      // open(), so destructuring it up front would capture the initial null.
      const fake = makeFakeWindow()
      openExternal(DEST, fake.w)
      const popup = fake.lastPopup
      assert(popup !== null, 'no popup was created on a successful open')
      assert(
        popup!.opener === null,
        `win.opener is ${JSON.stringify(popup!.opener)}, expected null — dropping ` +
          `'noopener' WITHOUT severing opener is a SECURITY REGRESSION (reverse tabnabbing: ` +
          `the store tab could rewrite our page via window.opener.location).`,
      )
    },
  ],
]

declare const describe: undefined | ((name: string, fn: () => void) => void)
declare const it: undefined | ((name: string, fn: () => void) => void)

if (typeof describe === 'function' && typeof it === 'function') {
  describe('ORCH-1381 ADDENDUM D-B openExternal (happy-path)', () => {
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
  console.log(`\nAll ${cases.length} open-external tests passed`)
}
