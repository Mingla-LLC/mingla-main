/**
 * #1044 [auth-failure-sentry-capture] — implementor happy-path regression suite,
 * CONSUMER side (P3 `signInWithGoogle` native catch, P4 `signInWithApple` native
 * catch). Covers SPEC §7 T1, T2, T3, T4, T5, T6, T7, T9, T10, T11, T12.
 *
 * Runs under Node's built-in test runner with type-stripping (there is NO jest in
 * this app — no jest dependency, no jest.config, every .test.ts here runs this
 * way; precedent: src/hooks/__tests__/useLaunchCityGate.test.ts):
 *
 *   node --experimental-strip-types --test \
 *     src/hooks/__tests__/useAuthSimple.authFailureCapture.issue1044.test.ts
 *
 * (CI wrapper: .github/workflows/issue-1044-auth-failure-capture-tests.yml)
 *
 * ─── WHAT WENT WRONG (#1038) ───────────────────────────────────────────────
 * Google sign-in was broken for EVERY Play-Store organizer on Mingla Business for
 * months and monitoring never saw it: the catch block Alerted the user and threw
 * the error away. THIS app has the same shape with an extra illusion on top —
 * `logger.error` reads like production telemetry but its breadcrumb buffer is
 * `__DEV__`-only (src/utils/breadcrumbs.ts), and `mixpanelService.trackLoginFailed`
 * carries only the message string (no code, no platform, no build). Sentry
 * received nothing from auth here either.
 *
 * ─── THE TRAP THIS SUITE PINS (T7 is the anchor) ───────────────────────────
 * `statusCodes` members are RUNTIME NATIVE CONSTANTS and differ between the two
 * apps' SDKs — `NULL_PRESENTER` exists on mingla-business 16.1.2 and NOT on this
 * app's 16.0.0. If someone "simplifies" `shouldReportAuthFailure` into an array
 * `.includes()` over those constants and drops the leading
 * `typeof code !== "string"` guard, an error with NO `code`
 * (`new Error("Failed to create session")`) compares equal to an `undefined`
 * constant and is SILENTLY DROPPED — reintroducing #1038 inside its own fix.
 * `T7-trap` injects exactly that SDK shape and proves it is still reported.
 *
 * ─── TEST STYLE — WHY IT SLICES THE REAL SOURCE ────────────────────────────
 * `useAuthSimple.ts` pulls RN, expo-constants, GoogleSignin, expo-apple-
 * authentication, supabase, Mixpanel and the app store at module load, so the
 * hook cannot be imported here. That constrains HOW we reach the catch blocks; it
 * does NOT license testing a hand-retyped COPY of them (ORCH-1373 P2-2 proved a
 * replica test stays green while the real guard is deleted).
 *
 * So this suite SLICES the REAL shipped catch-block bodies, the REAL
 * `shouldReportAuthFailure` body, and the REAL `reportNonFatal` body out of the
 * source files and EXECUTES them via `new Function` with collaborators injected.
 * If the shipped body changes, THIS RUNS THE CHANGED BODY. Line-delete the
 * `reportNonFatal(...)` call and T1 fails; line-delete the `typeof` guard and T7
 * fails; delete the exclusion clauses and T2/T3/T4/T5 fail.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const HOOK_SOURCE = fs.readFileSync(
  path.join(HERE, '..', 'useAuthSimple.ts'),
  'utf8',
)
const HELPER_SOURCE = fs.readFileSync(
  path.join(HERE, '..', '..', 'diagnostics', 'reportNonFatal.ts'),
  'utf8',
)

// ─────────────────────────────────────────────────────────────────────────────
// Slicing the REAL shipped source
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ONLY de-TypeScript step applied to a sliced body, declared explicitly so a
 * reader can audit it: the catch blocks' single TS construct is the `code` cast
 * `(err as { code?: unknown })?.code`. `new Function` compiles JS, not TS, so the
 * cast is erased exactly the way tsc erases it. Nothing else is rewritten.
 */
const eraseTypeAssertions = (src: string): string =>
  src.replace(/\(err as \{[^}]*\}\)/g, '(err)')

/**
 * Comment-stripped view, for assertions about what the code READS. The #1044
 * comments deliberately name `email`, `idToken`, `Sentry.init` while explaining
 * what must never be captured; a naive grep over raw source would flag its own
 * documentation.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const between = (start: string, end: string): string => {
  const a = HOOK_SOURCE.indexOf(start)
  const b = HOOK_SOURCE.indexOf(end)
  assert.ok(a > -1, `slice start not found: ${start}`)
  assert.ok(b > a, `slice end not found after start: ${end}`)
  return HOOK_SOURCE.slice(a, b)
}

const predicateBody = (): string => {
  const m = HOOK_SOURCE.match(
    /const shouldReportAuthFailure = \(code: unknown\): boolean => \{\n([\s\S]*?)\n\};/,
  )
  assert.ok(m, 'shouldReportAuthFailure not found in useAuthSimple.ts')
  return m[1]
}

const catchBody = (chunk: string): string => {
  const m = chunk.match(
    /\} catch \(err: unknown\) \{\n([\s\S]*)\n {4}\}\n {2}\};/,
  )
  assert.ok(m, 'catch body not found in sliced function')
  return eraseTypeAssertions(m[1])
}

const googleCatch = (): string =>
  catchBody(
    between('const signInWithGoogle = async () =>', 'const signInWithApple = async () =>'),
  )

const appleCatch = (): string =>
  catchBody(between('const signInWithApple = async () =>', '  return {\n    user,'))

const helperBody = (): string => {
  const m = HELPER_SOURCE.match(/\): void \{\n([\s\S]*)\n\}\n$/)
  assert.ok(m, 'reportNonFatal body not found')
  return m[1]
}

// ─────────────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────────────

type StatusCodesShape = Record<string, string | undefined>

interface Spy {
  (...args: unknown[]): unknown
  calls: unknown[][]
}

const spy = (impl?: (...args: unknown[]) => unknown): Spy => {
  const fn = ((...args: unknown[]) => {
    fn.calls.push(args)
    return impl ? impl(...args) : undefined
  }) as Spy
  fn.calls = []
  return fn
}

const compilePredicate = (statusCodes: StatusCodesShape): ((code: unknown) => boolean) => {
  const make = new Function(
    'statusCodes',
    `"use strict"; return function (code) {\n${predicateBody()}\n};`,
  ) as (sc: StatusCodesShape) => (code: unknown) => boolean
  return make(statusCodes)
}

const compileCatch = (
  body: string,
  deps: Record<string, unknown>,
): ((err: unknown) => unknown) => {
  const names = Object.keys(deps)
  const make = new Function(
    ...names,
    `"use strict"; return function (err) {\n${body}\n};`,
  ) as (...injected: unknown[]) => (err: unknown) => unknown
  return make(...names.map((n) => deps[n]))
}

/** The REAL shipped reportNonFatal body, compiled against an injected sink. */
const compileHelper = (
  captureException: (...args: unknown[]) => unknown,
  warn: (...args: unknown[]) => unknown,
): ((
  scope: string,
  error: unknown,
  extra?: Record<string, unknown>,
  fingerprint?: string[],
) => void) => {
  const make = new Function(
    'captureException',
    'console',
    `"use strict"; return function (scope, error, extra, fingerprint) {\n${helperBody()}\n};`,
  ) as (
    ce: unknown,
    c: unknown,
  ) => (
    scope: string,
    error: unknown,
    extra?: Record<string, unknown>,
    fingerprint?: string[],
  ) => void
  return make(captureException, { warn })
}

// Realistic native constant values (Android), proven in the investigation from
// the installed package's Java/ObjC bridge sources.
const ANDROID_STATUS_CODES: StatusCodesShape = {
  SIGN_IN_CANCELLED: '12501',
  IN_PROGRESS: 'ASYNC_OP_IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  SIGN_IN_REQUIRED: '4',
  // NOTE: no NULL_PRESENTER — this app's SDK is 16.0.0. That asymmetry is the
  // whole reason the `typeof` guard exists.
}

const WEB_CLIENT_ID =
  '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com'
// #1044 REWORK (tester P2). The suffix is the last 8 chars of the DISCRIMINATING
// segment — everything before the first "." — NOT of the whole id. Slicing the
// whole id returned the literal "tent.com" for every Google client id in
// existence (they all end ".apps.googleusercontent.com"), so the one axis this
// field exists for was never actually captured.
const EXPECTED_SUFFIX = WEB_CLIENT_ID.split('.')[0].slice(-8)

interface Harness {
  deps: Record<string, unknown>
  alert: Spy
  report: Spy
  run: (body: string, err: unknown) => unknown
}

const harness = (opts: {
  statusCodes?: StatusCodesShape
  os?: string
  version?: string | number
  webClientId?: unknown
  reportNonFatal?: (...args: unknown[]) => unknown
} = {}): Harness => {
  const statusCodes = opts.statusCodes ?? ANDROID_STATUS_CODES
  const alert = spy()
  const report = spy(opts.reportNonFatal)
  const deps: Record<string, unknown> = {
    Alert: { alert },
    Platform: { OS: opts.os ?? 'android', Version: opts.version ?? 34 },
    statusCodes,
    reportNonFatal: report,
    shouldReportAuthFailure: compilePredicate(statusCodes),
    webClientId: 'webClientId' in opts ? opts.webClientId : WEB_CLIENT_ID,
    logger: { error: () => {}, auth: () => {} },
    console: { error: () => {}, warn: () => {}, log: () => {} },
    mixpanelService: { trackLoginFailed: spy() },
    __DEV__: false,
  }
  return {
    deps,
    alert,
    report,
    run: (body: string, err: unknown) => compileCatch(body, deps)(err),
  }
}

const errWith = (code: unknown, message: string): Error => {
  const e = new Error(message)
  ;(e as unknown as { code: unknown }).code = code
  return e
}

// ─────────────────────────────────────────────────────────────────────────────
// SC-1-CONS / SC-4-CONS — the capture happens, with the right shape
// ─────────────────────────────────────────────────────────────────────────────

test('T1 — P3 Google DEVELOPER_ERROR ("10") is REPORTED with provider/code/fingerprint', () => {
  // THE fails-on-revert anchor for the capture itself: line-delete the
  // reportNonFatal(...) call from useAuthSimple.ts and this fails.
  const h = harness()
  const err = errWith('10', 'DEVELOPER_ERROR')
  const ret = h.run(googleCatch(), err)

  assert.equal(h.report.calls.length, 1)
  const [scope, error, extra, fingerprint] = h.report.calls[0] as [
    string,
    unknown,
    Record<string, unknown>,
    string[],
  ]
  assert.equal(scope, 'auth.signInWithGoogle.native')
  assert.equal(error, err)
  assert.deepEqual(extra, {
    provider: 'google',
    code: '10',
    platform: 'android',
    osVersion: '34',
    webClientIdSuffix: EXPECTED_SUFFIX,
  })
  assert.deepEqual(fingerprint, ['auth-signin', 'google', '10'])

  // T11 — Alert parity: exactly the pre-change Alert, unchanged.
  assert.equal(h.alert.calls.length, 1)
  assert.deepEqual(h.alert.calls[0], ['Google Sign-In Failed', 'DEVELOPER_ERROR'])
  assert.deepEqual(ret, { data: null, error: err })
})

test('T7 — P3 CODELESS error is REPORTED with code "none" (the #1038 class)', () => {
  const h = harness()
  const err = new Error('Failed to create session') // no `code` property
  const ret = h.run(googleCatch(), err)

  assert.equal(h.report.calls.length, 1)
  const extra = h.report.calls[0][2] as Record<string, unknown>
  assert.equal(extra.code, 'none')
  assert.deepEqual(h.report.calls[0][3], ['auth-signin', 'google', 'none'])
  assert.equal(h.alert.calls.length, 1)
  assert.deepEqual(h.alert.calls[0], [
    'Google Sign-In Failed',
    'Failed to create session',
  ])
  assert.deepEqual(ret, { data: null, error: err })
})

test('T7-trap — codeless error is STILL reported when statusCodes members are undefined (F-7)', () => {
  // The SDK-drift shape. Without the leading `typeof code !== "string"` guard,
  // `code === undefined` matches `statusCodes.SIGN_IN_CANCELLED === undefined`
  // and the error is dropped. LINE-DELETE that guard and THIS TEST FAILS.
  const h = harness({
    statusCodes: {
      SIGN_IN_CANCELLED: undefined,
      IN_PROGRESS: undefined,
      PLAY_SERVICES_NOT_AVAILABLE: undefined,
    },
  })
  h.run(googleCatch(), new Error('Failed to create session'))
  assert.equal(h.report.calls.length, 1)
  assert.equal((h.report.calls[0][2] as Record<string, unknown>).code, 'none')
})

test('numeric code (SDK reality, not a mock artefact) is stringified, not collapsed to "none"', () => {
  const h = harness()
  h.run(googleCatch(), errWith(10, 'DEVELOPER_ERROR'))
  assert.equal(h.report.calls.length, 1)
  assert.equal((h.report.calls[0][2] as Record<string, unknown>).code, '10')
  assert.deepEqual(h.report.calls[0][3], ['auth-signin', 'google', '10'])
})

test('webClientIdSuffix is "unset" when no client id is configured, never a full id', () => {
  const h = harness({ webClientId: undefined })
  h.run(googleCatch(), errWith('10', 'DEVELOPER_ERROR'))
  assert.equal(
    (h.report.calls[0][2] as Record<string, unknown>).webClientIdSuffix,
    'unset',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// SC-3-CONS — the exclusion set
// ─────────────────────────────────────────────────────────────────────────────

test('T2 — P3 user cancelled the picker: ZERO captures, ZERO alerts, same return', () => {
  const h = harness()
  const ret = h.run(googleCatch(), errWith(ANDROID_STATUS_CODES.SIGN_IN_CANCELLED, 'cancelled'))
  assert.equal(h.report.calls.length, 0)
  assert.equal(h.alert.calls.length, 0)
  assert.deepEqual(ret, { data: null, error: { message: 'Sign-in cancelled' } })
})

test('T3 — P3 double-tap (IN_PROGRESS): ZERO captures, same return', () => {
  const h = harness()
  const ret = h.run(googleCatch(), errWith(ANDROID_STATUS_CODES.IN_PROGRESS, 'in progress'))
  assert.equal(h.report.calls.length, 0)
  assert.equal(h.alert.calls.length, 0)
  assert.deepEqual(ret, {
    data: null,
    error: { message: 'Sign-in already in progress' },
  })
})

test('T4 — P3 no Play Services: ZERO captures, Play-Services Alert STILL fires verbatim', () => {
  const h = harness()
  const ret = h.run(
    googleCatch(),
    errWith(ANDROID_STATUS_CODES.PLAY_SERVICES_NOT_AVAILABLE, 'play services'),
  )
  assert.equal(h.report.calls.length, 0)
  assert.equal(h.alert.calls.length, 1)
  assert.deepEqual(h.alert.calls[0], [
    'Google Play Services Required',
    'Google Play Services is not available. Please install it from the Play Store.',
  ])
  assert.deepEqual(ret, {
    data: null,
    error: { message: 'Google Play Services not available' },
  })
})

test('T5 — Apple cancel code on the P3 Google path: ZERO captures (one predicate serves both)', () => {
  const h = harness()
  h.run(googleCatch(), errWith('ERR_REQUEST_CANCELED', 'cancelled'))
  assert.equal(h.report.calls.length, 0)
})

// ─────────────────────────────────────────────────────────────────────────────
// SC-2-CONS — Apple (P4)
// ─────────────────────────────────────────────────────────────────────────────

test('T6 — P4 Apple config failure is REPORTED with provider "apple"', () => {
  const h = harness({ os: 'ios', version: '18.2' })
  const err = errWith('ERR_INVALID_RESPONSE', 'Invalid response')
  const ret = h.run(appleCatch(), err)

  assert.equal(h.report.calls.length, 1)
  const [scope, error, extra, fingerprint] = h.report.calls[0] as [
    string,
    unknown,
    Record<string, unknown>,
    string[],
  ]
  assert.equal(scope, 'auth.signInWithApple.native')
  assert.equal(error, err)
  assert.deepEqual(extra, {
    provider: 'apple',
    code: 'ERR_INVALID_RESPONSE',
    platform: 'ios',
    osVersion: '18.2',
    // #1044 REWORK (tester P3): NO webClientIdSuffix on the Apple path. That
    // field describes a GOOGLE OAuth client and said nothing true about an
    // Apple Services-ID fault. Four keys here, five on Google.
  })
  assert.deepEqual(fingerprint, ['auth-signin', 'apple', 'ERR_INVALID_RESPONSE'])

  assert.equal(h.alert.calls.length, 1)
  assert.deepEqual(h.alert.calls[0], ['Apple Sign-In Failed', 'Invalid response'])
  assert.deepEqual(ret, { data: null, error: err })
})

test('T5 — P4 Apple cancelled: ZERO captures, ZERO alerts, same return', () => {
  const h = harness({ os: 'ios', version: '18.2' })
  const ret = h.run(
    appleCatch(),
    errWith('ERR_REQUEST_CANCELED', 'The user canceled the sign-in'),
  )
  assert.equal(h.report.calls.length, 0)
  assert.equal(h.alert.calls.length, 0)
  assert.deepEqual(ret, { data: null, error: { message: 'Sign-in cancelled' } })
})

test('T7 — P4 codeless Apple error is REPORTED with code "none"', () => {
  const h = harness({ os: 'ios', version: '18.2' })
  h.run(appleCatch(), new Error('Failed to create session'))
  assert.equal(h.report.calls.length, 1)
  assert.equal((h.report.calls[0][2] as Record<string, unknown>).code, 'none')
})

// ─────────────────────────────────────────────────────────────────────────────
// SC-7 — PII allowlist (T10)
// ─────────────────────────────────────────────────────────────────────────────

// #1044 REWORK (tester P3): the allowlist is now PER PROVIDER. Google carries
// five keys; Apple carries four, because `webClientIdSuffix` describes a Google
// OAuth client and was a misleading field on every Apple event.
const ALLOWED_GOOGLE_KEYS = [
  'code',
  'osVersion',
  'platform',
  'provider',
  'webClientIdSuffix',
]
const ALLOWED_APPLE_KEYS = ['code', 'osVersion', 'platform', 'provider']

const everyReportedExtra = (): Record<string, unknown>[] => {
  const out: Record<string, unknown>[] = []
  for (const body of [googleCatch(), appleCatch()]) {
    for (const err of [
      errWith('10', 'DEVELOPER_ERROR'),
      errWith('ERR_INVALID_RESPONSE', 'bad'),
      new Error('Failed to create session'),
      errWith(4, 'SIGN_IN_REQUIRED'),
    ]) {
      const h = harness()
      h.run(body, err)
      for (const call of h.report.calls) out.push(call[2] as Record<string, unknown>)
    }
  }
  return out
}

test('T10 — extra carries EXACTLY the allowed keys for its provider on every reported failure', () => {
  const extras = everyReportedExtra()
  assert.ok(extras.length > 0)
  for (const extra of extras) {
    const allowed =
      extra.provider === 'apple' ? ALLOWED_APPLE_KEYS : ALLOWED_GOOGLE_KEYS
    assert.deepEqual(Object.keys(extra).sort(), allowed)
  }
  // Both providers must actually be represented, or this test proves nothing.
  assert.ok(extras.some((e) => e.provider === 'google'))
  assert.ok(extras.some((e) => e.provider === 'apple'))
})

test('T10 — no captured value looks like an email, a token, or a full client id', () => {
  for (const extra of everyReportedExtra()) {
    for (const value of Object.values(extra)) {
      const s = String(value)
      assert.ok(!/@/.test(s), `value looks like an email/identifier: ${s}`)
      assert.ok(!/^ey[A-Za-z0-9_-]{10,}/.test(s), `value looks like a JWT: ${s}`)
      assert.ok(s.length <= 24, `value too long to be non-identifying: ${s}`)
      assert.ok(!s.includes('googleusercontent'))
    }
  }
})

test('T10 — the capture call sites never read a token, email, or full client id', () => {
  for (const raw of [googleCatch(), appleCatch()]) {
    const body = stripComments(raw)
    assert.ok(!/idToken|identityToken|accessToken|serverAuthCode|refreshToken/.test(body))
    assert.ok(!/\bemail\b/.test(body))
    assert.ok(!/credential\.fullName|credential\.user/.test(body))
    assert.ok(!/webClientId(?!Suffix)\s*,/.test(body))
  }

  // #1044 REWORK (tester P2 + P3): the Google site slices the DISCRIMINATING
  // segment (before the first "."), never the whole id — a plain
  // `webClientId.slice(-8)` yields the constant "tent.com". The Apple site does
  // not read the Google client id at all.
  const google = stripComments(googleCatch())
  assert.ok(/webClientId\.split\("\."\)\[0\]\.slice\(-8\)/.test(google))
  assert.ok(!/webClientId\.slice\(-8\)/.test(google))

  const apple = stripComments(appleCatch())
  assert.ok(!/webClientId/.test(apple))
})

// ─────────────────────────────────────────────────────────────────────────────
// SC-6 — failure-safety (T9)
// ─────────────────────────────────────────────────────────────────────────────

test('T9 — the REAL reportNonFatal body returns normally when captureException THROWS', () => {
  const warn = spy()
  const helper = compileHelper(() => {
    throw new Error('sentry exploded')
  }, warn)
  assert.doesNotThrow(() =>
    helper('auth.signInWithGoogle.native', new Error('boom'), { provider: 'google' }),
  )
  assert.equal(warn.calls.length, 1) // console.warn retained (I-NO-SILENT-FAILURES)
})

test('T9 — the REAL catch block still Alerts and returns the same value when Sentry throws', () => {
  // End-to-end: the REAL reportNonFatal body (not a stub) is injected into the
  // REAL catch body, with captureException rigged to throw.
  const realReport = compileHelper(() => {
    throw new Error('sentry exploded')
  }, spy())
  const h = harness({ reportNonFatal: realReport as unknown as (...a: unknown[]) => unknown })
  const err = errWith('10', 'DEVELOPER_ERROR')

  let ret: unknown
  assert.doesNotThrow(() => {
    ret = h.run(googleCatch(), err)
  })
  assert.equal(h.alert.calls.length, 1)
  assert.deepEqual(h.alert.calls[0], ['Google Sign-In Failed', 'DEVELOPER_ERROR'])
  assert.deepEqual(ret, { data: null, error: err })
})

test('T9 — the REAL helper forwards the fingerprint only when one is supplied (backward compatible)', () => {
  const seen: unknown[][] = []
  const helper = compileHelper((...args: unknown[]) => {
    seen.push(args)
    return 'event-id'
  }, spy())
  const e = new Error('boom')

  helper('scope.a', e, { k: 1 })
  assert.deepEqual(seen[0][1], { tags: { scope: 'scope.a' }, extra: { k: 1 } })

  helper('scope.b', e, { k: 2 }, ['auth-signin', 'google', '10'])
  assert.deepEqual(seen[1][1], {
    tags: { scope: 'scope.b' },
    extra: { k: 2 },
    fingerprint: ['auth-signin', 'google', '10'],
  })
})

test('the capture is synchronous, never awaited, never flushed, never deferred', () => {
  for (const body of [googleCatch(), appleCatch()]) {
    assert.ok(!/await\s+reportNonFatal/.test(body))
    assert.ok(!/Sentry\.flush|\.flush\(|\.close\(/.test(body))
    assert.ok(!/setTimeout|requestAnimationFrame/.test(body))
  }
})

test('the capture never alters control flow (no return/throw inside the guard)', () => {
  for (const body of [googleCatch(), appleCatch()]) {
    const m = body.match(/if \(shouldReportAuthFailure\(code\)\) \{([\s\S]*?)\n {6}\}/)
    assert.ok(m, 'guarded capture block not found')
    assert.ok(!/\breturn\b/.test(m[1]))
    assert.ok(!/\bthrow\b/.test(m[1]))
    assert.ok(/reportNonFatal\(/.test(m[1]))
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Structural guards — the invariant's shape (T12, SC-8)
// ─────────────────────────────────────────────────────────────────────────────

test('the `typeof code !== "string"` guard is the FIRST statement of the predicate', () => {
  const body = predicateBody().trim()
  assert.equal(body.split('\n')[0].trim(), 'if (typeof code !== "string") return true;')
})

test('the predicate excludes EXACTLY the four specified codes, via statusCodes — never integers', () => {
  const body = predicateBody()
  assert.ok(/code === statusCodes\.SIGN_IN_CANCELLED/.test(body))
  assert.ok(/code === statusCodes\.IN_PROGRESS/.test(body))
  assert.ok(/code === statusCodes\.PLAY_SERVICES_NOT_AVAILABLE/.test(body))
  assert.ok(/code === "ERR_REQUEST_CANCELED"/.test(body))
  // SIGN_IN_REQUIRED / NULL_PRESENTER are deliberately NOT excluded.
  assert.ok(!/SIGN_IN_REQUIRED/.test(body))
  assert.ok(!/NULL_PRESENTER/.test(body))
  // No hardcoded native integers — they differ per platform.
  assert.ok(!/"12501"|"-5"|"10"|"4"/.test(body))
  assert.equal((body.match(/return false;/g) ?? []).length, 4)
})

test('there is exactly ONE predicate definition and exactly TWO capture call sites', () => {
  assert.equal((HOOK_SOURCE.match(/const shouldReportAuthFailure = /g) ?? []).length, 1)
  assert.equal(
    (HOOK_SOURCE.match(/if \(shouldReportAuthFailure\(code\)\)/g) ?? []).length,
    2,
  )
})

test('T12 / SC-8 — the consumer helper imports the SDK directly, adds no init, no logger', () => {
  const helper = stripComments(HELPER_SOURCE)
  assert.ok(/import \{ captureException \} from "@sentry\/react-native";/.test(helper))
  assert.ok(!/Sentry\.init/.test(helper))
  assert.ok(!/export \* from/.test(helper))
  assert.ok(!/from ["'].*utils\/logger["']/.test(helper))
  // I-SENTRY-SINGLE-INIT: the hook must not gain an init either.
  assert.ok(!/Sentry\.init/.test(stripComments(HOOK_SOURCE)))
})

test('the helper body is throw-proof and the swallow is silent', () => {
  const body = helperBody()
  assert.ok(/^\s*try \{/.test(body))
  assert.ok(/\} catch \{/.test(body))
  // console.warn retained (I-NO-SILENT-FAILURES)…
  assert.ok(/console\.warn\(/.test(body))
  // …but the swallow itself must be silent.
  const swallow = body.slice(body.lastIndexOf('} catch {'))
  assert.ok(!/console\./.test(swallow))
})

test('the pre-existing consumer telemetry calls are PRESERVED, not replaced', () => {
  // This SPEC adds; it does not replace. logger.error / console.error /
  // mixpanelService.trackLoginFailed must all survive on both paths.
  const g = googleCatch()
  assert.ok(/logger\.error\('Google sign-in failed'/.test(g))
  assert.ok(/console\.error\("Google sign-in error:"/.test(g))
  assert.ok(/mixpanelService\.trackLoginFailed\('google'/.test(g))
  const a = appleCatch()
  assert.ok(/logger\.error\('Apple sign-in failed'/.test(a))
  assert.ok(/console\.error\("Apple sign-in error:"/.test(a))
  assert.ok(/mixpanelService\.trackLoginFailed\('apple'/.test(a))
})

// ─────────────────────────────────────────────────────────────────────────────
// #1044 REWORK — P1 REGRESSION: the RESOLVED cancel contract
//
// THE BUG THIS SECTION EXISTS TO CATCH, and why the original suite missed it.
//
// `@react-native-google-signin/google-signin` v16 RESOLVES with
// `{ type: "cancelled", data: null }` when the user backs out of the account
// picker. It does NOT reject with `statusCodes.SIGN_IN_CANCELLED`. Verified in
// this app's installed SDK (16.0.0) type declarations:
//     signIn(): Promise<SignInSuccessResponse | CancelledResponse>
//     CancelledResponse = { type: 'cancelled'; data: null }
//
// The original implementation discarded that resolved value and called
// `getTokens()`, which throws `code: "getTokens"` — a code no exclusion covers.
// Live-fired on the business twin of this code: three picker cancels produced
// THREE Sentry captures plus a "Sign-In failed" Alert on every one.
//
// Every test in the original suite passed because it INJECTED a rejection
// carrying `{ code: SIGN_IN_CANCELLED }` — a shape this call path cannot
// produce. Injecting the wrong shape is what made a broken exclusion look
// proven. So these tests drive the REAL `signInWithGoogle` body end to end and
// inject the shape the REAL SDK actually delivers: a RESOLVED cancel from
// `signIn()`, plus a `getTokens()` that throws the REAL error observed on the
// device.
//
// Delete the `if (googleUser?.type === "cancelled") return …` early return and
// these fail: `getTokens` runs, throws, and produces the capture, the
// `trackLoginFailed` event and the Alert this issue exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────

/** The whole `signInWithGoogle` body, sliced from the shipped file. */
const googleFnBody = (): string => {
  const chunk = between(
    'const signInWithGoogle = async () =>',
    'const signInWithApple = async () =>',
  )
  const m = chunk.match(/const signInWithGoogle = async \(\) => \{\n([\s\S]*)\n {2}\};/)
  assert.ok(m, 'signInWithGoogle body not found')
  // The documented de-TS steps for a WHOLE-function slice (the catch slices only
  // ever needed the first). Each is a type annotation or assertion that `tsc`
  // erases identically; no logic is rewritten.
  return eraseTypeAssertions(m[1])
    .replace(/catch \(err: unknown\)/g, 'catch (err)')
    .replace(/let googleEmail: string \| undefined;/, 'let googleEmail;')
    .replace(/\(googleUser as unknown as \{[^}]*\}[^)]*\)/g, '(googleUser)')
}

const compileGoogleFn = (
  deps: Record<string, unknown>,
): (() => Promise<{ data: unknown; error: unknown }>) => {
  const names = Object.keys(deps)
  const make = new Function(
    ...names,
    `"use strict"; return async function () {\n${googleFnBody()}\n};`,
  ) as (...injected: unknown[]) => () => Promise<{ data: unknown; error: unknown }>
  return make(...names.map((n) => deps[n]))
}

const makeFnDeps = (signInResult: unknown, getTokensImpl?: () => unknown) => {
  const report = spy()
  const alert = spy()
  const trackLoginFailed = spy()
  const getTokens = spy(
    getTokensImpl ??
      (() => {
        throw errWith('getTokens', 'getTokens requires a user to be signed in')
      }),
  )
  const signIn = spy(async () => signInResult)
  const signInWithIdToken = spy(async () => ({
    data: { session: { user: { id: 'u1' } }, user: { id: 'u1' } },
    error: null,
  }))
  const deps: Record<string, unknown> = {
    Platform: { OS: 'android', Version: 34 },
    Alert: { alert },
    Constants: {
      expoConfig: { extra: { EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB_CLIENT_ID } },
    },
    GoogleSignin: {
      hasPlayServices: spy(async () => true),
      hasPreviousSignIn: spy(async () => false),
      signOut: spy(async () => null),
      signIn,
      getTokens,
    },
    supabase: {
      from: () => ({
        select: () => ({ ilike: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      }),
      auth: {
        signInWithIdToken,
        getSession: spy(async () => ({ data: { session: null } })),
      },
    },
    logger: { auth: () => {}, error: () => {} },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    mixpanelService: { trackLoginFailed },
    webClientId: WEB_CLIENT_ID,
    statusCodes: ANDROID_STATUS_CODES,
    shouldReportAuthFailure: compilePredicate(ANDROID_STATUS_CODES),
    reportNonFatal: report,
  }
  return { deps, report, alert, trackLoginFailed, getTokens, signIn, signInWithIdToken }
}

test("P1 — signIn() RESOLVING {type:'cancelled'} returns early: getTokens never called, ZERO captures, ZERO alerts", async () => {
  const h = makeFnDeps({ type: 'cancelled', data: null })

  const ret = await compileGoogleFn(h.deps)()

  // The picker was shown and the user backed out.
  assert.equal(h.signIn.calls.length, 1)

  // The root fix: control never reaches getTokens, so the "getTokens requires a
  // user to be signed in" error is never manufactured in the first place.
  assert.equal(h.getTokens.calls.length, 0)

  // SC-3-CONS, against the shape the SDK ACTUALLY delivers.
  assert.equal(h.report.calls.length, 0)

  // The user-visible half of the same bug: no "Google Sign-In Failed" Alert…
  assert.equal(h.alert.calls.length, 0)
  // …and a cancel is not a login FAILURE, so no analytics failure event either.
  assert.equal(h.trackLoginFailed.calls.length, 0)

  assert.deepEqual(ret, { data: null, error: { message: 'Sign-in cancelled' } })
})

test('P1 — the early return does NOT fire on a successful sign-in (the guard is not over-broad)', async () => {
  const h = makeFnDeps({ type: 'success', data: { user: { id: 'g1' } } }, async () => ({
    idToken: 'id-token',
  }))

  const ret = await compileGoogleFn(h.deps)()

  assert.equal(h.signIn.calls.length, 1)
  assert.equal(h.getTokens.calls.length, 1)
  assert.equal(h.signInWithIdToken.calls.length, 1)
  assert.equal(h.report.calls.length, 0)
  assert.equal(h.alert.calls.length, 0)
  assert.equal((ret as { error: unknown }).error, null)
})

test('P1 — a GENUINE getTokens failure is still reported (the fix must not blind us to real token faults)', async () => {
  // Not a cancel: signIn() succeeded and getTokens genuinely failed. This is the
  // case that adding "getTokens" to the exclusion set would have hidden — which
  // is exactly the #1038 bug class. It MUST still reach Sentry.
  const h = makeFnDeps({ type: 'success', data: { user: { id: 'g1' } } })

  await compileGoogleFn(h.deps)()

  assert.equal(h.getTokens.calls.length, 1)
  assert.equal(h.report.calls.length, 1)
  assert.equal(h.report.calls[0][0], 'auth.signInWithGoogle.native')
  assert.equal((h.report.calls[0][2] as Record<string, unknown>).code, 'getTokens')
  assert.equal(h.alert.calls.length, 1)
})

test('P1 — the shipped source carries the resolved-cancel guard BEFORE getTokens', () => {
  const body = stripComments(googleFnBody())
  const guardAt = body.indexOf('googleUser?.type === "cancelled"')
  const getTokensAt = body.indexOf('GoogleSignin.getTokens()')
  assert.ok(guardAt > -1, 'resolved-cancel guard missing from signInWithGoogle')
  assert.ok(getTokensAt > -1)
  assert.ok(guardAt < getTokensAt, 'the cancel guard must precede getTokens()')

  // And "getTokens" must NOT have been papered over in the exclusion set — that
  // would blind us to genuine token failures (#1038's bug class).
  assert.ok(!predicateBody().includes('getTokens'))
})
