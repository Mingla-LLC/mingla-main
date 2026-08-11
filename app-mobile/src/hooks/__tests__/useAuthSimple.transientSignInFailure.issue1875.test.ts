/**
 * #1875 [transient-signin-failure] — IMPLEMENTOR happy-path regression suite,
 * CONSUMER native sign-in (`signInWithGoogle` + `signInWithApple` in
 * `src/hooks/useAuthSimple.ts`). Covers SPEC §7 T1–T16 and §5 SC-1..SC-27.
 *
 * Runs under Node's built-in test runner with type-stripping (there is NO jest
 * in this app — no jest dependency, no jest.config; every .test.ts here runs
 * this way, precedent `src/hooks/__tests__/useLaunchCityGate.test.ts`):
 *
 *   node --experimental-strip-types --test \
 *     src/hooks/__tests__/useAuthSimple.transientSignInFailure.issue1875.test.ts
 *
 * (CI wrapper: .github/workflows/issue-1875-google-signin-transient-failure-tests.yml)
 *
 * ─── WHAT WENT WRONG (#1875) ───────────────────────────────────────────────
 * F-3: a transient transport failure during native sign-in was handled exactly
 * like a permanent authentication failure — no retry, no offline-aware path. A
 * one-second connectivity blip dead-ended the user at the door.
 *
 * F-4: the failure modal rendered `error.message` verbatim. `@supabase/auth-js`'s
 * `_getErrorMessage` falls through to `JSON.stringify(err)` when handed a
 * `Response`, and `NETWORK_ERROR_CODES = [502, 503, 504]` routes gateway errors
 * straight into it — so the user saw a serialized Response object containing our
 * Supabase project URL and a blob id. Same string, three destinations: the Sentry
 * issue title, the Mixpanel property, and the Alert body.
 *
 * ─── THE ANCHORS ───────────────────────────────────────────────────────────
 *  · T15/SC-19 is the fails-on-revert anchor for F-4. Restore
 *    `Alert.alert("Google Sign-In Failed", error.message)` and it fails with
 *    `gqnoajqerqhnvulmnyvv.supabase.co` present in the alert arguments.
 *  · T1/T2/SC-8 are the anchors for F-3. Delete the retry loop and they fail
 *    with `expected 3 calls, actual 1`.
 *  · T5/SC-6 is the anchor for R6's permanent default. Flip the default, or key
 *    R4 on `statusCodes.INTERNAL_ERROR` (which is `undefined` in the installed
 *    16.0.0 SDK, so the comparison matches EVERY codeless error — the F-7 trap),
 *    and it fails.
 *  · T8/SC-12 is the anchor for the counter bound. Delete
 *    `transportRetryAttempts < TRANSPORT_RETRY_MAX_ATTEMPTS` and it never
 *    terminates.
 *  · T6/T7 are the anchors for cancellation, INCLUDING the rule that
 *    cancellation suppresses the Alert and NEVER the #1044 capture.
 *
 * ─── TEST STYLE — WHY IT SLICES THE REAL SOURCE ────────────────────────────
 * `useAuthSimple.ts` pulls RN, expo-constants, GoogleSignin, expo-apple-
 * authentication, supabase, Mixpanel, i18n and the app store at module load, so
 * the hook cannot be imported here. That constrains HOW we reach the code; it
 * does NOT license testing a hand-retyped COPY (ORCH-1373 P2-2 proved a replica
 * test stays green while the real guard is deleted).
 *
 * So this suite SLICES the REAL shipped `classifyAuthFailure` body, the REAL
 * whole `signInWithGoogle` / `signInWithApple` bodies, and the REAL catch bodies
 * out of the source file and EXECUTES them via `new Function` with collaborators
 * injected — the same idiom as the two #1044 suites. If the shipped body
 * changes, THIS RUNS THE CHANGED BODY.
 *
 * Append-only. No product code was modified to make anything here pass.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(HERE, '..', 'useAuthSimple.ts')
const HELPER_PATH = path.join(HERE, '..', '..', 'diagnostics', 'reportNonFatal.ts')
const AUTH_JSON_PATH = path.join(
  HERE, '..', '..', 'i18n', 'locales', 'en', 'auth.json',
)

const HOOK_SOURCE = fs.readFileSync(HOOK_PATH, 'utf8')
const HELPER_SOURCE = fs.readFileSync(HELPER_PATH, 'utf8')
const AUTH_JSON_RAW = fs.readFileSync(AUTH_JSON_PATH, 'utf8')
const AUTH_JSON = JSON.parse(AUTH_JSON_RAW) as {
  welcome: Record<string, string>
}

// ─────────────────────────────────────────────────────────────────────────────
// Slicing the REAL shipped source
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The catch blocks' only TS construct is the `err` cast — `(err as { … })?.x`.
 * `new Function` compiles JS, not TS, so it is erased exactly the way tsc erases
 * it. This is byte-for-byte the eraser both #1044 suites use.
 */
const eraseTypeAssertions = (src: string): string =>
  src.replace(/\(err as \{[^}]*\}\)/g, '(err)')

/**
 * Comment-stripped view, for assertions about what the code READS. The #1875
 * banners deliberately name `statusCodes.INTERNAL_ERROR`, `instanceof` and
 * `NetInfo` while explaining that they must never be used; a naive grep over raw
 * source would flag its own documentation.
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

const GOOGLE_CHUNK = (): string =>
  between('const signInWithGoogle = async () =>', 'const signInWithApple = async () =>')
const APPLE_CHUNK = (): string =>
  between('const signInWithApple = async () =>', '  return {\n    user,')

/** The REAL `classifyAuthFailure` body. Contains ZERO TypeScript by contract. */
const classifierBody = (): string => {
  const m = HOOK_SOURCE.match(
    /const classifyAuthFailure = \([\s\S]*?\): AuthFailureClass => \{\n([\s\S]*?)\n\};/,
  )
  assert.ok(m, 'classifyAuthFailure not found in useAuthSimple.ts')
  return m[1]
}

type Classifier = (
  errName: unknown,
  errCode: unknown,
  errStatus: unknown,
  errMessage: unknown,
  platformOS: string,
) => string

/**
 * SPEC §8 step 2 — this is the harness that had to compile FIRST. If the
 * predicate ever acquires TypeScript-only syntax in its body, this throws a
 * SyntaxError and every test in this file fails loudly, which is the point.
 */
const compileClassifier = (): Classifier =>
  new Function(
    `"use strict"; return function (errName, errCode, errStatus, errMessage, platformOS) {\n${classifierBody()}\n};`,
  )() as Classifier

const catchBody = (chunk: string): string => {
  const m = chunk.match(/\} catch \(err: unknown\) \{\n([\s\S]*)\n {4}\}\n {2}\};/)
  assert.ok(m, 'catch body not found in sliced function')
  return eraseTypeAssertions(m[1])
}

const googleCatch = (): string => catchBody(GOOGLE_CHUNK())
const appleCatch = (): string => catchBody(APPLE_CHUNK())

/**
 * The documented de-TypeScript steps for a WHOLE-function slice. Each is a type
 * annotation or assertion that `tsc` erases identically; no logic is rewritten.
 * The #1875 additions were written specifically so this list did NOT have to
 * grow (SPEC §4.6) — `retryCancelled` carries no return-type annotation and the
 * classifier is called with plain property reads.
 */
const googleFnBody = (): string => {
  const m = GOOGLE_CHUNK().match(
    /const signInWithGoogle = async \(\) => \{\n([\s\S]*)\n {2}\};/,
  )
  assert.ok(m, 'signInWithGoogle body not found')
  return eraseTypeAssertions(m[1])
    .replace(/catch \(err: unknown\)/g, 'catch (err)')
    .replace(/let googleEmail: string \| undefined;/, 'let googleEmail;')
    .replace(/\(googleUser as unknown as \{[^}]*\}[^)]*\)/g, '(googleUser)')
}

const appleFnBody = (): string => {
  const m = APPLE_CHUNK().match(
    /const signInWithApple = async \(\) => \{\n([\s\S]*)\n {2}\};/,
  )
  assert.ok(m, 'signInWithApple body not found')
  return eraseTypeAssertions(m[1])
    .replace(/catch \(err: unknown\)/g, 'catch (err)')
    .replace(/const updates: Record<string, string> = \{\};/, 'const updates = {};')
}

// ─────────────────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────────────────

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

const ANDROID_STATUS_CODES: Record<string, string | undefined> = {
  SIGN_IN_CANCELLED: '12501',
  IN_PROGRESS: 'ASYNC_OP_IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  SIGN_IN_REQUIRED: '4',
  // 16.0.0 exposes no INTERNAL_ERROR / NETWORK_ERROR / TIMEOUT — that absence is
  // the whole reason R4 keys on the numeric strings the native bridge emits.
}

const WEB_CLIENT_ID =
  '123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com'

/**
 * Resolves the REAL shipped English copy from `en/auth.json`, so the four copy
 * states are asserted against the strings a user actually reads — and a typo in
 * a product-code key is a hard failure here, not a silently echoed key.
 */
const i18nStub = {
  t: (key: string): string => {
    const m = key.match(/^auth:welcome\.(.+)$/)
    assert.ok(m, `#1875 copy must use an auth:welcome.* key, got: ${key}`)
    const value = AUTH_JSON.welcome[m[1]]
    assert.ok(
      typeof value === 'string' && value.length > 0,
      `missing en/auth.json key: welcome.${m[1]}`,
    )
    return value
  },
}

const COPY = {
  failedTitle: AUTH_JSON.welcome.sign_in_failed_title,
  failedBody: AUTH_JSON.welcome.sign_in_failed_body,
  ok: AUTH_JSON.welcome.sign_in_failed_ok,
  offlineTitle: AUTH_JSON.welcome.sign_in_offline_title,
  offlineBody: AUTH_JSON.welcome.sign_in_offline_body,
  exhaustedTitle: AUTH_JSON.welcome.sign_in_retry_exhausted_title,
  exhaustedBody: AUTH_JSON.welcome.sign_in_retry_exhausted_body,
  permanentBody: AUTH_JSON.welcome.sign_in_permanent_body,
}

const alertArgs = (title: string, body: string): unknown[] => [
  title,
  body,
  [{ text: COPY.ok }],
]

const STATE_1_OFFLINE = alertArgs(COPY.offlineTitle, COPY.offlineBody)
const STATE_2_TRANSIENT = alertArgs(COPY.failedTitle, COPY.failedBody)
const STATE_3_EXHAUSTED = alertArgs(COPY.exhaustedTitle, COPY.exhaustedBody)
const STATE_4_PERMANENT = alertArgs(COPY.failedTitle, COPY.permanentBody)

const errWith = (code: unknown, message: string): Error => {
  const e = new Error(message)
  ;(e as unknown as { code: unknown }).code = code
  return e
}

/** The shape `@supabase/auth-js` actually constructs. */
const authRetryableFetchError = (message: string, status: number): Error => {
  const e = new Error(message)
  e.name = 'AuthRetryableFetchError'
  ;(e as unknown as { status: number }).status = status
  return e
}

const authApiError = (message: string, status: number, code?: string): Error => {
  const e = new Error(message)
  e.name = 'AuthApiError'
  ;(e as unknown as { status: number; code: string | undefined }).status = status
  ;(e as unknown as { code: string | undefined }).code = code
  return e
}

/** The verbatim Event B message from the #1875 investigation. */
const EVENT_B_MESSAGE =
  '{"type":"default","status":504,"ok":false,"statusText":"","headers":{"map":{"connection":"Close","content-length":"0"}},"url":"https://gqnoajqerqhnvulmnyvv.supabase.co/auth/v1/token?grant_type=id_token","bodyUsed":false,"_bodyInit":{"_data":{"size":0,"offset":0,"blobId":"5364ad2b-0000-4000-8000-000000000000"}}}'

const SUCCESS_RESULT = {
  data: { session: { user: { id: 'u1' }, access_token: 't' }, user: { id: 'u1' } },
  error: null,
}

interface FnHarness {
  deps: Record<string, unknown>
  alert: Spy
  report: Spy
  signIn: Spy
  getTokens: Spy
  signInWithIdToken: Spy
  sleeps: number[]
  appState: { currentState: string }
  isMountedRef: { current: boolean }
  run: () => Promise<{ data: unknown; error: unknown }>
}

const compileFn = (
  body: string,
  deps: Record<string, unknown>,
): (() => Promise<{ data: unknown; error: unknown }>) => {
  const names = Object.keys(deps)
  const make = new Function(
    ...names,
    `"use strict"; return async function () {\n${body}\n};`,
  ) as (...injected: unknown[]) => () => Promise<{ data: unknown; error: unknown }>
  return make(...names.map((n) => deps[n]))
}

/**
 * `results` is consumed one per `signInWithIdToken` call; the LAST entry repeats
 * once exhausted, so "always transient" is expressible with a single element.
 */
const googleHarness = (opts: {
  results?: { data: unknown; error: unknown }[]
  signInResult?: unknown
  signInRejects?: unknown
  getTokensImpl?: () => unknown
  os?: string
  realTimers?: boolean
  onSleep?: (attemptIndex: number) => void
} = {}): FnHarness => {
  const alert = spy()
  const report = spy()
  const sleeps: number[] = []
  const appState = { currentState: 'active' }
  const isMountedRef = { current: true }
  const results = opts.results ?? [SUCCESS_RESULT]
  let call = 0

  const signInWithIdToken = spy(async () => {
    const r = results[Math.min(call, results.length - 1)]
    call += 1
    return r
  })
  const signIn = spy(async () => {
    if (opts.signInRejects) throw opts.signInRejects
    return opts.signInResult ?? { type: 'success', data: { user: { id: 'g1' } } }
  })
  const getTokens = spy(opts.getTokensImpl ?? (() => ({ idToken: 'google-id-token' })))

  const fakeSetTimeout = (cb: () => void, ms: number): number => {
    const index = sleeps.length
    sleeps.push(ms)
    if (opts.onSleep) opts.onSleep(index)
    cb()
    return 0
  }

  const deps: Record<string, unknown> = {
    Platform: { OS: opts.os ?? 'android', Version: 34 },
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
    mixpanelService: { trackLoginFailed: spy() },
    webClientId: WEB_CLIENT_ID,
    statusCodes: ANDROID_STATUS_CODES,
    shouldReportAuthFailure: () => true,
    reportNonFatal: report,
    classifyAuthFailure: compileClassifier(),
    i18n: i18nStub,
    AppState: appState,
    isMountedRef,
    TRANSPORT_RETRY_MAX_ATTEMPTS: 2,
    TRANSPORT_RETRY_DELAYS_MS: [400, 1200],
    setTimeout: opts.realTimers ? setTimeout : fakeSetTimeout,
  }

  return {
    deps,
    alert,
    report,
    signIn,
    getTokens,
    signInWithIdToken,
    sleeps,
    appState,
    isMountedRef,
    run: () => compileFn(googleFnBody(), deps)(),
  }
}

const appleHarness = (opts: {
  results?: { data: unknown; error: unknown }[]
  signInRejects?: unknown
} = {}): FnHarness => {
  const alert = spy()
  const report = spy()
  const sleeps: number[] = []
  const appState = { currentState: 'active' }
  const isMountedRef = { current: true }
  const results = opts.results ?? [SUCCESS_RESULT]
  let call = 0

  const signInWithIdToken = spy(async () => {
    const r = results[Math.min(call, results.length - 1)]
    call += 1
    return r
  })
  const signIn = spy(async () => {
    if (opts.signInRejects) throw opts.signInRejects
    return { identityToken: 'apple-identity-token', fullName: null }
  })

  const deps: Record<string, unknown> = {
    Platform: { OS: 'ios', Version: '18.2' },
    Alert: { alert },
    AppleAuthentication: {
      isAvailableAsync: async () => true,
      signInAsync: signIn,
      AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    },
    supabase: { auth: { signInWithIdToken } },
    logger: { auth: () => {}, error: () => {} },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    mixpanelService: { trackLoginFailed: spy() },
    shouldReportAuthFailure: () => true,
    reportNonFatal: report,
    classifyAuthFailure: compileClassifier(),
    i18n: i18nStub,
    AppState: appState,
    isMountedRef,
    TRANSPORT_RETRY_MAX_ATTEMPTS: 2,
    TRANSPORT_RETRY_DELAYS_MS: [400, 1200],
    setTimeout: (cb: () => void, ms: number): number => {
      sleeps.push(ms)
      cb()
      return 0
    },
    __DEV__: false,
  }

  return {
    deps,
    alert,
    report,
    signIn,
    getTokens: spy(),
    signInWithIdToken,
    sleeps,
    appState,
    isMountedRef,
    run: () => compileFn(appleFnBody(), deps)(),
  }
}

/** Catch-only harness, for the copy states and the anti-leak matrix. */
const catchHarness = (opts: {
  os?: string
  transportRetryAttempts?: number
  retryAbandoned?: boolean
} = {}) => {
  const alert = spy()
  const report = spy()
  const deps: Record<string, unknown> = {
    Alert: { alert },
    Platform: { OS: opts.os ?? 'android', Version: 34 },
    statusCodes: ANDROID_STATUS_CODES,
    reportNonFatal: report,
    shouldReportAuthFailure: () => true,
    webClientId: WEB_CLIENT_ID,
    logger: { error: () => {}, auth: () => {} },
    console: { error: () => {}, warn: () => {}, log: () => {} },
    mixpanelService: { trackLoginFailed: spy() },
    __DEV__: false,
    classifyAuthFailure: compileClassifier(),
    i18n: i18nStub,
    transportRetryAttempts: opts.transportRetryAttempts ?? 0,
    retryAbandoned: opts.retryAbandoned ?? false,
  }
  const names = Object.keys(deps)
  const run = (body: string, err: unknown): unknown =>
    (
      new Function(
        ...names,
        `"use strict"; return function (err) {\n${body}\n};`,
      ) as (...a: unknown[]) => (e: unknown) => unknown
    )(...names.map((n) => deps[n]))(err)
  return { alert, report, run }
}

// ═════════════════════════════════════════════════════════════════════════════
// CLASSIFICATION — SC-1 .. SC-7
// ═════════════════════════════════════════════════════════════════════════════

test('SC-1 — offline transport (AuthRetryableFetchError, status 0/undefined/null)', () => {
  const c = compileClassifier()
  assert.equal(
    c('AuthRetryableFetchError', undefined, 0, 'Network request failed', 'android'),
    'transient-transport-offline',
  )
  assert.equal(
    c('AuthRetryableFetchError', undefined, undefined, 'boom', 'ios'),
    'transient-transport-offline',
  )
  assert.equal(
    c('AuthRetryableFetchError', undefined, null, 'boom', 'android'),
    'transient-transport-offline',
  )
})

test('SC-2 — remote transport: 502 / 503 / 504 and any other status auth-js labelled retryable', () => {
  const c = compileClassifier()
  for (const status of [502, 503, 504, 429, 500, 599]) {
    assert.equal(
      c('AuthRetryableFetchError', undefined, status, EVENT_B_MESSAGE, 'android'),
      'transient-transport-remote',
      `status ${status}`,
    )
  }
})

test('SC-3-A — Android GMS transient codes "7" / "8" / "15" are transient-provider', () => {
  const c = compileClassifier()
  for (const [code, message] of [
    ['7', 'NETWORK_ERROR'],
    ['8', 'INTERNAL_ERROR'],
    ['15', 'TIMEOUT'],
  ]) {
    assert.equal(
      c(undefined, code, undefined, message, 'android'),
      'transient-provider',
      `code ${code}`,
    )
  }
})

test('SC-4-i — the SAME GMS codes on iOS are PERMANENT (there is no GMS on iOS)', () => {
  const c = compileClassifier()
  for (const code of ['7', '8', '15']) {
    assert.equal(c(undefined, code, undefined, 'INTERNAL_ERROR', 'ios'), 'permanent')
  }
})

test('SC-5 — DEVELOPER_ERROR ("10", the #1038 certificate class) is PERMANENT and never retried', () => {
  const c = compileClassifier()
  assert.equal(
    c(undefined, '10', undefined, 'DEVELOPER_ERROR', 'android'),
    'permanent',
  )
})

test('T5 / SC-6 — every unrecognised shape defaults to PERMANENT (R6)', () => {
  const c = compileClassifier()
  const permanentCases: [string, unknown[]][] = [
    ['getTokens', [undefined, 'getTokens', undefined, 'getTokens requires a user', 'android']],
    ['12500 SIGN_IN_FAILED', [undefined, '12500', undefined, 'SIGN_IN_FAILED', 'android']],
    ['14 INTERRUPTED (excluded on purpose)', [undefined, '14', undefined, 'INTERRUPTED', 'android']],
    ['iOS -1 unknown', [undefined, '-1', undefined, 'Unknown', 'ios']],
    ['iOS -5 cancelled', [undefined, '-5', undefined, 'canceled', 'ios']],
    ['AuthApiError 400', ['AuthApiError', 'bad_jwt', 400, 'Unacceptable audience', 'android']],
    ['Failed to create session', ['Error', undefined, undefined, 'Failed to create session', 'android']],
    ['Failed to get ID token', ['Error', undefined, undefined, 'Failed to get ID token from Google', 'android']],
    ['null everything', [null, null, null, null, 'android']],
    ['undefined everything', [undefined, undefined, undefined, undefined, 'android']],
    ['string code', ['Error', 'a string', 'a string', 'a string', 'android']],
    ['object code', ['Error', {}, {}, {}, 'android']],
    ['numeric code 8 (NOT the string "8")', [undefined, 8, undefined, 'INTERNAL_ERROR', 'android']],
    ['999', [undefined, '999', undefined, 'nope', 'android']],
    ['SOME_NEW_CODE_2027', [undefined, 'SOME_NEW_CODE_2027', undefined, 'x', 'android']],
  ]
  for (const [label, args] of permanentCases) {
    assert.equal(
      (c as (...a: unknown[]) => string)(...args),
      'permanent',
      `expected permanent for: ${label}`,
    )
  }
})

test('R5 — "Network request failed" is matched by EXACT equality, never `includes`', () => {
  const c = compileClassifier()
  assert.equal(
    c('Error', undefined, undefined, 'Network request failed', 'android'),
    'transient-transport-offline',
  )
  // A permanent failure whose message merely CONTAINS the phrase must NOT be
  // promoted to transient — that is how a substring match turns a hard fault
  // into an infinite-feeling retry.
  assert.equal(
    c('Error', undefined, undefined, 'DEVELOPER_ERROR: Network request failed too', 'android'),
    'permanent',
  )
  assert.equal(
    c('Error', undefined, undefined, `${EVENT_B_MESSAGE}Network request failed`, 'android'),
    'permanent',
  )
})

test('SC-7 — the predicate never references the undefined statusCodes members, and never `instanceof`', () => {
  const body = stripComments(classifierBody())
  assert.ok(!/statusCodes/.test(body), 'classifyAuthFailure must not read statusCodes')
  assert.ok(!/INTERNAL_ERROR|NETWORK_ERROR|TIMEOUT/.test(body))
  assert.ok(!/instanceof/.test(body))
  // …and it must not reach for a connectivity cache instead of the error itself.
  assert.ok(!/NetInfo|onlineManager|networkMonitor|offlineService/.test(body))
  // The numeric strings the native bridge actually emits ARE present.
  assert.ok(/"7"/.test(body) && /"8"/.test(body) && /"15"/.test(body))
  // Purity: no I/O, no clock, no randomness, no logging, no throwing.
  assert.ok(!/await|Date|Math\.random|console\.|throw|fetch\(/.test(body))
  // Exactly one definition, in the shipped source.
  assert.equal((HOOK_SOURCE.match(/const classifyAuthFailure = /g) ?? []).length, 1)
})

// ═════════════════════════════════════════════════════════════════════════════
// RETRY — SC-8 .. SC-14
// ═════════════════════════════════════════════════════════════════════════════

test('T1 / SC-9 — a blip that clears on retry: 2 calls, session returned, ZERO alerts, ZERO captures', async () => {
  const h = googleHarness({
    results: [
      { data: { session: null, user: null }, error: authRetryableFetchError(EVENT_B_MESSAGE, 504) },
      SUCCESS_RESULT,
    ],
  })
  const ret = await h.run()

  assert.equal(h.signInWithIdToken.calls.length, 2)
  assert.equal(h.alert.calls.length, 0, 'a recovered blip must be invisible to the user')
  assert.equal(h.report.calls.length, 0, 'a recovered blip is not a failure — nothing to report')
  assert.equal((ret as { error: unknown }).error, null)
  assert.deepEqual((ret as { data: unknown }).data, SUCCESS_RESULT.data.session)
  assert.deepEqual(h.sleeps, [400])
})

test('T2 / SC-8 — Event B replay (504 x3): EXACTLY 3 calls at 400ms then 1200ms, State 3 alert, ONE capture', async () => {
  const h = googleHarness({
    results: [
      {
        data: { session: null, user: null },
        error: authRetryableFetchError(EVENT_B_MESSAGE, 504),
      },
    ],
  })
  const ret = await h.run()

  // THE F-3 fails-on-revert anchor. Delete the retry loop → `actual 1`.
  assert.equal(h.signInWithIdToken.calls.length, 3)
  assert.deepEqual(h.sleeps, [400, 1200])
  assert.equal(h.report.calls.length, 1, 'exactly ONE capture per user-initiated sign-in')
  assert.equal(h.report.calls[0][0], 'auth.signInWithGoogle.native')
  assert.equal(h.alert.calls.length, 1)
  assert.deepEqual(h.alert.calls[0], STATE_3_EXHAUSTED)
  // …and the leak is gone from the modal even though the message still went to Sentry.
  assert.ok(!JSON.stringify(h.alert.calls).includes('supabase.co'))
  assert.equal(
    (h.report.calls[0][1] as Error).message,
    EVENT_B_MESSAGE,
    'the FULL original message must still reach Sentry',
  )
  assert.equal((ret as { data: unknown }).data, null)
})

test('SC-8 (wall clock) — the retry really waits ~400ms and ~1200ms, not zero', async () => {
  const h = googleHarness({
    realTimers: true,
    results: [
      {
        data: { session: null, user: null },
        error: authRetryableFetchError('offline', 0),
      },
    ],
  })
  const started = Date.now()
  await h.run()
  const elapsed = Date.now() - started
  assert.equal(h.signInWithIdToken.calls.length, 3)
  assert.ok(elapsed >= 1500, `expected >= 1500ms of backoff, got ${elapsed}ms`)
  assert.ok(elapsed < 6000, `backoff ran far longer than specified: ${elapsed}ms`)
})

test('T3 / SC-10-A — GMS "8" from signIn(): the picker is NEVER re-presented, token exchange never runs', async () => {
  const h = googleHarness({ signInRejects: errWith('8', 'INTERNAL_ERROR') })
  await h.run()

  assert.equal(h.signIn.calls.length, 1, 'the account picker must not be re-shown')
  assert.equal(h.signInWithIdToken.calls.length, 0)
  assert.deepEqual(h.sleeps, [])
  assert.equal(h.report.calls.length, 1)
  assert.equal(h.alert.calls.length, 1)
  assert.deepEqual(h.alert.calls[0], STATE_2_TRANSIENT)
})

test('T4 — permanent GMS "10": zero retries, State 4, #1044 fingerprint intact', async () => {
  const h = googleHarness({ signInRejects: errWith('10', 'DEVELOPER_ERROR') })
  await h.run()

  assert.equal(h.signInWithIdToken.calls.length, 0)
  assert.deepEqual(h.sleeps, [])
  assert.equal(h.report.calls.length, 1)
  assert.deepEqual(h.report.calls[0][3], ['auth-signin', 'google', '10'])
  assert.deepEqual(h.report.calls[0][2], {
    provider: 'google',
    code: '10',
    platform: 'android',
    osVersion: '34',
    webClientIdSuffix: WEB_CLIENT_ID.split('.')[0].slice(-8),
  })
  assert.deepEqual(h.alert.calls[0], STATE_4_PERMANENT)
})

test('T11 / SC-11 — a permanent AuthApiError(400) from the token exchange is NEVER retried', async () => {
  const h = googleHarness({
    results: [
      {
        data: { session: null, user: null },
        error: authApiError('Unacceptable audience in id_token', 400, 'bad_jwt'),
      },
    ],
  })
  await h.run()

  assert.equal(h.signInWithIdToken.calls.length, 1)
  assert.deepEqual(h.sleeps, [])
  assert.equal(h.report.calls.length, 1)
  assert.deepEqual(h.alert.calls[0], STATE_4_PERMANENT)
})

test('T8 / SC-12 — the loop is bounded by a COUNTER: an always-transient stub terminates at exactly 3 calls', async () => {
  // Delete `transportRetryAttempts < TRANSPORT_RETRY_MAX_ATTEMPTS` from the loop
  // condition and this test never returns — the runner kills it on timeout.
  const h = googleHarness({
    results: [
      { data: { session: null, user: null }, error: authRetryableFetchError('always', 0) },
    ],
  })
  await h.run()
  assert.equal(h.signInWithIdToken.calls.length, 3)
  assert.equal(h.sleeps.length, 2)
  // The bound is a frozen constant compared against a counter, in the source.
  const src = stripComments(googleFnBody())
  assert.ok(
    /transportRetryAttempts < TRANSPORT_RETRY_MAX_ATTEMPTS/.test(src),
    'the counter bound is missing from the loop condition',
  )
  assert.ok(/transportRetryAttempts \+= 1/.test(src), 'the counter is never incremented')
})

test('T6 / SC-13 — backgrounding cancels the retry: 1 call, ZERO alerts, and the capture STILL fires', async () => {
  const h = googleHarness({
    results: [
      { data: { session: null, user: null }, error: authRetryableFetchError(EVENT_B_MESSAGE, 504) },
    ],
  })
  h.appState.currentState = 'background'
  await h.run()

  assert.equal(h.signInWithIdToken.calls.length, 1)
  assert.deepEqual(h.sleeps, [])
  assert.equal(h.alert.calls.length, 0, 'no modal for a screen nobody is looking at')
  // I-1044-AUTH-FAILURE-REPORTED: cancellation suppresses the ALERT ONLY.
  assert.equal(h.report.calls.length, 1, 'cancellation must never suppress the Sentry capture')
})

test('SC-13 — "inactive" and "unknown" do NOT cancel (only an explicit "background" does)', async () => {
  for (const state of ['inactive', 'unknown', 'active', 'extension']) {
    const h = googleHarness({
      results: [
        { data: { session: null, user: null }, error: authRetryableFetchError('x', 0) },
      ],
    })
    h.appState.currentState = state
    await h.run()
    assert.equal(
      h.signInWithIdToken.calls.length,
      3,
      `AppState "${state}" must not cancel the retry`,
    )
  }
})

test('SC-13 — backgrounding DURING the sleep is caught by the second checkpoint', async () => {
  const h = googleHarness({
    results: [
      { data: { session: null, user: null }, error: authRetryableFetchError('x', 0) },
    ],
    onSleep: () => {
      h.appState.currentState = 'background'
    },
  })
  await h.run()
  assert.equal(h.signInWithIdToken.calls.length, 1, 'the post-sleep checkpoint did not fire')
  assert.deepEqual(h.sleeps, [400])
  assert.equal(h.alert.calls.length, 0)
  assert.equal(h.report.calls.length, 1)
})

test('T7 / SC-14 — an unmounted hook cancels the retry: 1 call, ZERO alerts, ONE capture', async () => {
  const h = googleHarness({
    results: [
      { data: { session: null, user: null }, error: authRetryableFetchError('x', 0) },
    ],
  })
  h.isMountedRef.current = false
  await h.run()

  assert.equal(h.signInWithIdToken.calls.length, 1)
  assert.equal(h.alert.calls.length, 0)
  assert.equal(h.report.calls.length, 1)
})

test('T12 — every retry re-sends the SAME token, byte-identical, to the SAME provider', async () => {
  const h = googleHarness({
    results: [
      { data: { session: null, user: null }, error: authRetryableFetchError('x', 0) },
    ],
  })
  await h.run()
  assert.equal(h.signInWithIdToken.calls.length, 3)
  for (const call of h.signInWithIdToken.calls) {
    assert.deepEqual(call[0], { provider: 'google', token: 'google-id-token' })
  }
})

test('T11 (picker cancel) — a resolved {type:"cancelled"} still returns early: no getTokens, no capture, no alert', async () => {
  const h = googleHarness({ signInResult: { type: 'cancelled', data: null } })
  const ret = await h.run()
  assert.equal(h.getTokens.calls.length, 0)
  assert.equal(h.report.calls.length, 0)
  assert.equal(h.alert.calls.length, 0)
  assert.equal(h.signInWithIdToken.calls.length, 0)
  assert.deepEqual(ret, { data: null, error: { message: 'Sign-in cancelled' } })
})

test('T10 — an iOS Google network failure ("-1") is permanent: State 4, zero retries', () => {
  const h = catchHarness({ os: 'ios' })
  h.run(googleCatch(), errWith('-1', 'Unknown error'))
  assert.deepEqual(h.alert.calls[0], STATE_4_PERMANENT)
})

// ═════════════════════════════════════════════════════════════════════════════
// APPLE PARITY — T9
// ═════════════════════════════════════════════════════════════════════════════

test('T9 — Apple 504 x3: 3 calls, State 3, scope auth.signInWithApple.native, NO url in the alert', async () => {
  const h = appleHarness({
    results: [
      {
        data: { session: null, user: null },
        error: authRetryableFetchError(EVENT_B_MESSAGE, 504),
      },
    ],
  })
  await h.run()

  assert.equal(h.signInWithIdToken.calls.length, 3)
  assert.deepEqual(h.sleeps, [400, 1200])
  assert.equal(h.signIn.calls.length, 1, 'the Face ID sheet must not be re-presented')
  assert.equal(h.report.calls.length, 1)
  assert.equal(h.report.calls[0][0], 'auth.signInWithApple.native')
  assert.deepEqual(h.alert.calls[0], STATE_3_EXHAUSTED)
  assert.ok(!JSON.stringify(h.alert.calls).includes('supabase.co'))
  for (const call of h.signInWithIdToken.calls) {
    assert.deepEqual(call[0], { provider: 'apple', token: 'apple-identity-token' })
  }
})

test('T9 — an Apple blip that clears on retry is invisible: 2 calls, zero alerts, zero captures', async () => {
  const h = appleHarness({
    results: [
      { data: { session: null, user: null }, error: authRetryableFetchError('x', 0) },
      SUCCESS_RESULT,
    ],
  })
  const ret = await h.run()
  assert.equal(h.signInWithIdToken.calls.length, 2)
  assert.equal(h.alert.calls.length, 0)
  assert.equal(h.report.calls.length, 0)
  assert.equal((ret as { error: unknown }).error, null)
})

// ═════════════════════════════════════════════════════════════════════════════
// COPY — SC-15 .. SC-21
// ═════════════════════════════════════════════════════════════════════════════

const OFFLINE_ERR = (): Error => authRetryableFetchError('Network request failed', 0)
const REMOTE_ERR = (): Error => authRetryableFetchError(EVENT_B_MESSAGE, 504)

test('SC-15 — State 1 (offline, no retry ran)', () => {
  for (const body of [googleCatch(), appleCatch()]) {
    const h = catchHarness()
    h.run(body, OFFLINE_ERR())
    assert.deepEqual(h.alert.calls[0], STATE_1_OFFLINE)
  }
  assert.equal(COPY.offlineTitle, "You're offline")
  assert.equal(
    COPY.offlineBody,
    "We couldn't reach Mingla. Check your connection and give it another tap.",
  )
})

test('SC-16 — State 2 (transient remote with no retry, and every transient-provider case)', () => {
  const remote = catchHarness()
  remote.run(googleCatch(), REMOTE_ERR())
  assert.deepEqual(remote.alert.calls[0], STATE_2_TRANSIENT)

  for (const code of ['7', '8', '15']) {
    const h = catchHarness()
    h.run(googleCatch(), errWith(code, 'INTERNAL_ERROR'))
    assert.deepEqual(h.alert.calls[0], STATE_2_TRANSIENT, `code ${code}`)
  }
  assert.equal(COPY.failedTitle, "Couldn't sign you in")
  assert.equal(COPY.failedBody, "Something didn't connect. Give it another tap.")
})

test('SC-17 — State 3 (any transient class once a retry has run)', () => {
  for (const body of [googleCatch(), appleCatch()]) {
    for (const attempts of [1, 2]) {
      const h = catchHarness({ transportRetryAttempts: attempts })
      h.run(body, REMOTE_ERR())
      assert.deepEqual(h.alert.calls[0], STATE_3_EXHAUSTED)
    }
  }
  assert.equal(COPY.exhaustedTitle, "Still couldn't sign you in")
})

test('SC-18 — State 4 (permanent) points at support and NEVER says "check your connection"', () => {
  for (const body of [googleCatch(), appleCatch()]) {
    const h = catchHarness()
    h.run(body, errWith('10', 'DEVELOPER_ERROR'))
    assert.deepEqual(h.alert.calls[0], STATE_4_PERMANENT)
  }
  assert.ok(COPY.permanentBody.includes('support@usemingla.com'))
  assert.ok(
    !/check your connection/i.test(COPY.permanentBody),
    'State 4 must not misdirect the user to their connection',
  )
  // A permanent failure that FOLLOWED retries stays permanent — retry-exhausted
  // copy must never be shown for a hard fault.
  const after = catchHarness({ transportRetryAttempts: 2 })
  after.run(googleCatch(), errWith('10', 'DEVELOPER_ERROR'))
  assert.deepEqual(after.alert.calls[0], STATE_4_PERMANENT)
})

test('T13 — the SIGN_IN_CANCELLED branch is untouched: zero alerts, original return value', () => {
  const h = catchHarness()
  const ret = h.run(googleCatch(), errWith(ANDROID_STATUS_CODES.SIGN_IN_CANCELLED, 'cancelled'))
  assert.equal(h.alert.calls.length, 0)
  assert.deepEqual(ret, { data: null, error: { message: 'Sign-in cancelled' } })

  const inprog = catchHarness()
  const r2 = inprog.run(googleCatch(), errWith(ANDROID_STATUS_CODES.IN_PROGRESS, 'busy'))
  assert.equal(inprog.alert.calls.length, 0)
  assert.deepEqual(r2, { data: null, error: { message: 'Sign-in already in progress' } })

  const apple = catchHarness({ os: 'ios' })
  const r3 = apple.run(appleCatch(), errWith('ERR_REQUEST_CANCELED', 'cancelled'))
  assert.equal(apple.alert.calls.length, 0)
  assert.deepEqual(r3, { data: null, error: { message: 'Sign-in cancelled' } })
})

test('T14 — the Play Services branch keeps its ORIGINAL verbatim alert', () => {
  const h = catchHarness()
  const ret = h.run(
    googleCatch(),
    errWith(ANDROID_STATUS_CODES.PLAY_SERVICES_NOT_AVAILABLE, 'no gms'),
  )
  assert.deepEqual(h.alert.calls[0], [
    'Google Play Services Required',
    'Google Play Services is not available. Please install it from the Play Store.',
  ])
  assert.deepEqual(ret, {
    data: null,
    error: { message: 'Google Play Services not available' },
  })
})

test('SC-13 (copy half) — an abandoned retry raises NO alert at all, on either provider', () => {
  for (const body of [googleCatch(), appleCatch()]) {
    const h = catchHarness({ retryAbandoned: true, transportRetryAttempts: 1 })
    const ret = h.run(body, REMOTE_ERR())
    assert.equal(h.alert.calls.length, 0)
    assert.equal(h.report.calls.length, 1, 'the capture must survive an abandoned retry')
    assert.equal((ret as { data: unknown }).data, null)
  }
})

// ── T15 / SC-19 — THE ANTI-LEAK GATE (fails-on-revert anchor for F-4) ────────

const JUNK = 'ZZQ' + 'x'.repeat(4096)

const LEAK_MATRIX: [string, () => unknown][] = [
  ['Event B, verbatim (504)', () => authRetryableFetchError(EVENT_B_MESSAGE, 504)],
  ['Event B message on a codeless Error', () => new Error(EVENT_B_MESSAGE)],
  ['Event A INTERNAL_ERROR', () => errWith('8', 'INTERNAL_ERROR')],
  [
    'DEVELOPER_ERROR with the troubleshooting URL',
    () =>
      errWith(
        '10',
        'DEVELOPER_ERROR: Follow troubleshooting instructions at https://react-native-google-signin.github.io/docs/troubleshooting',
      ),
  ],
  ['4KB junk', () => new Error(JUNK)],
  ['offline', () => authRetryableFetchError('Network request failed', 0)],
  ['AuthApiError 400', () => authApiError('Unacceptable audience in id_token', 400, 'bad_jwt')],
  ['bare string rejection', () => EVENT_B_MESSAGE],
  ['plain object', () => ({ message: EVENT_B_MESSAGE, status: 504 })],
]

const FORBIDDEN = [
  'supabase.co',
  'http',
  'gqnoajqerqhnvulmnyvv',
  'blobId',
  '_bodyInit',
  'statusText',
  'INTERNAL_ERROR',
  'DEVELOPER_ERROR',
  'AuthRetryableFetchError',
  'AuthApiError',
  '504',
  JUNK,
]

for (const [label, make] of LEAK_MATRIX) {
  test(`T15 / SC-19 — ${label}: NOTHING from the error reaches any alert argument`, () => {
    for (const [provider, body] of [
      ['google', googleCatch()],
      ['apple', appleCatch()],
    ] as [string, string][]) {
      for (const attempts of [0, 1, 2]) {
        const h = catchHarness({ transportRetryAttempts: attempts })
        h.run(body, make())
        const rendered = JSON.stringify(h.alert.calls)
        for (const needle of FORBIDDEN) {
          assert.ok(
            !rendered.includes(needle),
            `[${provider}, ${attempts} retries] leaked "${needle.slice(0, 40)}" into the alert: ${rendered.slice(0, 300)}`,
          )
        }
        // Positive control: an alert really did fire, so the assertion above is
        // not vacuously true.
        assert.equal(h.alert.calls.length, 1, `[${provider}] no alert was rendered`)
        // …and every argument is one of the six permitted copy values.
        const permitted = new Set([
          COPY.failedTitle, COPY.failedBody, COPY.ok,
          COPY.offlineTitle, COPY.offlineBody,
          COPY.exhaustedTitle, COPY.exhaustedBody, COPY.permanentBody,
        ])
        const [title, msg, buttons] = h.alert.calls[0] as [string, string, { text: string }[]]
        assert.ok(permitted.has(title), `unexpected alert title: ${title}`)
        assert.ok(permitted.has(msg), `unexpected alert body: ${msg}`)
        assert.equal(buttons.length, 1)
        assert.equal(buttons[0].text, COPY.ok)
      }
    }
  })
}

test('SC-20 — both replaced Alert statements read ONLY from i18n.t: no interpolation, no concatenation', () => {
  for (const raw of [googleCatch(), appleCatch()]) {
    const body = stripComments(raw)
    const m = body.match(/Alert\.alert\(i18n\.t\(alertTitleKey\), i18n\.t\(alertBodyKey\), \[\n\s*\{ text: i18n\.t\("auth:welcome\.sign_in_failed_ok"\) \},\n\s*\]\);/)
    assert.ok(m, 'the #1875 Alert statement is not in its specified shape')
    // The old shape must be gone.
    assert.ok(!/Alert\.alert\(\s*"(Google|Apple) Sign-In Failed"/.test(body))
    assert.ok(!/error\.message \|\| "Unable to sign in/.test(body))
    // No error value may be interpolated into any alert argument anywhere.
    assert.ok(!/Alert\.alert\([^)]*error\.message/.test(body))
    assert.ok(!/Alert\.alert\([^)]*\$\{/.test(body))
    assert.ok(!/Alert\.alert\([^)]*\bcode\b/.test(body))
  }
  // Every copy key used by the product code is an auth:welcome.* literal.
  const keys = (stripComments(HOOK_SOURCE).match(/i18n\.t\("([^"]+)"\)/g) ?? [])
  for (const k of keys) assert.ok(/auth:welcome\./.test(k), `non-auth key: ${k}`)
})

test('SC-21 — the five new en/auth.json keys exist, are clean, and carry no @needs_translation', () => {
  const NEW_KEYS = [
    'sign_in_offline_title',
    'sign_in_offline_body',
    'sign_in_retry_exhausted_title',
    'sign_in_retry_exhausted_body',
    'sign_in_permanent_body',
  ]
  for (const k of NEW_KEYS) {
    const v = AUTH_JSON.welcome[k]
    assert.ok(typeof v === 'string' && v.trim().length > 0, `missing/empty: ${k}`)
    assert.ok(!v.includes('{{') && !v.includes('}}'), `interpolation in ${k}`)
    assert.ok(!/@needs_translation/.test(v), `@needs_translation suffix in ${k}`)
    assert.ok(!/https?:|supabase|\berror\b/i.test(v), `technical leakage in ${k}`)
  }
  // The three reused keys are untouched.
  assert.equal(AUTH_JSON.welcome.sign_in_failed_title, "Couldn't sign you in")
  assert.equal(AUTH_JSON.welcome.sign_in_failed_body, "Something didn't connect. Give it another tap.")
  assert.equal(AUTH_JSON.welcome.sign_in_failed_ok, 'Got it')
  // Valid JSON with no duplicate keys at the `welcome` level.
  const occurrences = (name: string): number =>
    (AUTH_JSON_RAW.match(new RegExp(`"${name}"\\s*:`, 'g')) ?? []).length
  for (const k of NEW_KEYS) assert.equal(occurrences(k), 1, `duplicate key: ${k}`)
})

// ═════════════════════════════════════════════════════════════════════════════
// #1044 NON-REGRESSION — SC-22 .. SC-27
// ═════════════════════════════════════════════════════════════════════════════

/**
 * SC-22 — `shouldReportAuthFailure` is byte-identical to origin/main. Frozen
 * inline rather than read through `git show`, because CI checks out at depth 1
 * and a git-dependent assertion would silently degrade to "skipped" — the
 * vacuity class. If a LATER issue legitimately changes this predicate, that
 * issue rebaselines this constant under its own [TEST-MOD-APPROVED] marker.
 */
const ORIGIN_MAIN_SHOULD_REPORT_BODY = `  if (typeof code !== "string") return true;
  // BELT-AND-BRACES, NOT THE LIVE GUARD (#1044). The Google picker cancel is
  // handled at its ROOT, in signInWithGoogle's try block: SDK v16 RESOLVES
  // \`{ type: "cancelled" }\` rather than rejecting, so control returns early and
  // never reaches this predicate. This line is therefore unreachable for the
  // Google cancel path today. It is kept on purpose — it still fires if the SDK
  // ever reverts to a rejecting cancel, and it costs nothing. Do not read it as
  // the mechanism that stops cancels reaching Sentry; that is the early return.
  if (code === statusCodes.SIGN_IN_CANCELLED) return false;
  if (code === statusCodes.IN_PROGRESS) return false;
  if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return false;
  if (code === "ERR_REQUEST_CANCELED") return false;
  return true;`

test('SC-22 — #1875 did NOT touch shouldReportAuthFailure (byte-identical)', () => {
  const m = HOOK_SOURCE.match(
    /const shouldReportAuthFailure = \(code: unknown\): boolean => \{\n([\s\S]*?)\n\};/,
  )
  assert.ok(m, 'shouldReportAuthFailure not found')
  assert.equal(m[1], ORIGIN_MAIN_SHOULD_REPORT_BODY)
})

/**
 * SC-25 — `reportNonFatal.ts` is byte-identical to origin/main. Pinned by digest
 * because the file is on #1875's DO-NOT-TOUCH list and a digest cannot be
 * satisfied by a near-miss.
 */
test('SC-25 — #1875 did NOT touch reportNonFatal.ts (byte-identical, sha256)', () => {
  const digest = crypto.createHash('sha256').update(HELPER_SOURCE, 'utf8').digest('hex')
  assert.equal(
    digest,
    'dc04127239092d3936510c2b024019635760221893054e3abb9cc3c1fcb64249',
    'reportNonFatal.ts changed — #1875 must not modify it (DO-NOT-TOUCH, SPEC §11)',
  )
})

test('SC-23 — the #1044 capture payload is unchanged on both providers', () => {
  const g = catchHarness()
  g.run(googleCatch(), errWith('10', 'DEVELOPER_ERROR'))
  assert.equal(g.report.calls.length, 1)
  assert.equal(g.report.calls[0][0], 'auth.signInWithGoogle.native')
  assert.deepEqual(Object.keys(g.report.calls[0][2] as object).sort(), [
    'code', 'osVersion', 'platform', 'provider', 'webClientIdSuffix',
  ])
  assert.deepEqual(g.report.calls[0][3], ['auth-signin', 'google', '10'])

  const a = catchHarness({ os: 'ios' })
  a.run(appleCatch(), errWith('ERR_INVALID_RESPONSE', 'Invalid response'))
  assert.equal(a.report.calls[0][0], 'auth.signInWithApple.native')
  assert.deepEqual(Object.keys(a.report.calls[0][2] as object).sort(), [
    'code', 'osVersion', 'platform', 'provider',
  ])
  assert.deepEqual(a.report.calls[0][3], ['auth-signin', 'apple', 'ERR_INVALID_RESPONSE'])
})

test('SC-24 — a resolved {type:"cancelled"} still short-circuits before getTokens', async () => {
  const h = googleHarness({ signInResult: { type: 'cancelled', data: null } })
  await h.run()
  assert.equal(h.getTokens.calls.length, 0)
  assert.equal(h.report.calls.length, 0)
  assert.equal(h.alert.calls.length, 0)
})

test('SC-26 — a transient failure that RECOVERS captures zero times; one that EXHAUSTS captures exactly once', async () => {
  const recovered = googleHarness({
    results: [
      { data: { session: null, user: null }, error: authRetryableFetchError('x', 0) },
      SUCCESS_RESULT,
    ],
  })
  await recovered.run()
  assert.equal(recovered.report.calls.length, 0)

  const exhausted = googleHarness({
    results: [
      { data: { session: null, user: null }, error: authRetryableFetchError('x', 0) },
    ],
  })
  await exhausted.run()
  assert.equal(exhausted.report.calls.length, 1)
})

test('SC-27 — reportNonFatal is still the FIRST statement of each catch, above every early return', () => {
  for (const raw of [googleCatch(), appleCatch()]) {
    const body = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    const guardAt = body.indexOf('if (shouldReportAuthFailure(code)) {')
    const firstReturnAt = body.indexOf('return ')
    assert.ok(guardAt > -1, 'the #1044 capture guard is gone')
    assert.ok(guardAt < firstReturnAt, 'an early return now precedes the capture guard')
    // The retry loop lives in the TRY, never the CATCH — that is what makes
    // "exactly one capture per user-initiated sign-in" true.
    assert.ok(!/while \(/.test(body), 'a retry loop leaked into the catch block')
    assert.ok(!/setTimeout/.test(raw), 'the catch must not defer anything')
  }
  assert.equal(
    (HOOK_SOURCE.match(/if \(shouldReportAuthFailure\(code\)\)/g) ?? []).length,
    2,
  )
})

test('the retry loop is on the LIVE path in BOTH functions, wrapping the real token exchange', () => {
  for (const [label, src] of [
    ['google', stripComments(googleFnBody())],
    ['apple', stripComments(appleFnBody())],
  ] as [string, string][]) {
    const loopAt = src.indexOf('while (')
    const exchangeAt = src.indexOf('supabase.auth.signInWithIdToken')
    assert.ok(loopAt > -1, `${label}: no retry loop`)
    assert.ok(exchangeAt > -1 && exchangeAt < loopAt, `${label}: loop is not after the first exchange`)
    assert.ok(
      /classifyAuthFailure\(/.test(src.slice(loopAt, loopAt + 400)),
      `${label}: the loop does not consult classifyAuthFailure`,
    )
    assert.ok(
      /\.startsWith\("transient-transport"\)/.test(src),
      `${label}: retry eligibility is not restricted to transient-transport`,
    )
    // The PROVIDER leg is never re-invoked inside the loop.
    const loopEnd = src.indexOf('\n      }', loopAt)
    const loopSrc = src.slice(loopAt, loopEnd)
    assert.ok(!/GoogleSignin\.signIn\(|AppleAuthentication\.signInAsync\(/.test(loopSrc))
  }
})
