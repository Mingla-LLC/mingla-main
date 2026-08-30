/**
 * #1875 [transient-signin-failure] — TESTER ADVERSARIAL suite.
 *
 *   node --experimental-strip-types --test \
 *     src/hooks/__tests__/useAuthSimple.transientSignInFailure.adversarial.issue1875.test.ts
 *
 * (CI: .github/workflows/issue-1875-google-signin-transient-failure-tests.yml)
 *
 * ─── WHY THIS FILE EXISTS, AND HOW IT DIFFERS FROM THE IMPLEMENTOR'S ───────
 * The implementor's suite (`…transientSignInFailure.issue1875.test.ts`, T1-T16 /
 * SC-1..SC-27) asserts that the SPECIFIED behaviour happens. It is a happy-path
 * proof: the named inputs produce the named outputs.
 *
 * This suite attacks the complementary claim — that **nothing else changed, that
 * the bound cannot be defeated, and that nothing leaks** — using mechanisms the
 * implementor's suite does not employ:
 *
 *   AX-A  The retry bound is attacked, not demonstrated. A hostile timer that
 *         fires its callback five times; a `TRANSPORT_RETRY_DELAYS_MS` shorter
 *         than the attempt cap; an error whose `name` flips mid-loop; a retry
 *         attempt that THROWS instead of returning; two concurrent sign-ins
 *         sharing one module. If the loop were driven by anything other than the
 *         counter, one of these spins or over-runs.
 *   AX-B  Misclassification is hunted by EXHAUSTION, not by sampling. Every GMS
 *         numeric code 0..20, 12500..12502, every iOS kGIDSignInErrorCode -1..-9,
 *         every HTTP status 100..599, both platforms, plus type-confusion
 *         variants (number 8, String object "8", padded "8 ", fullwidth "８").
 *         The whitelist of retry-eligible inputs is asserted to be EXACTLY the
 *         documented one, and the retry-eligibility of every other input is
 *         asserted false.
 *   AX-C  The leak gate is a WHITELIST, not a blacklist. The implementor asserts
 *         that a list of forbidden substrings is absent. This suite asserts the
 *         inverse and stronger property: the set of distinct strings that ever
 *         reach `Alert.alert` across the whole fuzz is a SUBSET of the six
 *         permitted `en/auth.json` values. A blacklist can be escaped by a
 *         leak nobody predicted; a whitelist cannot.
 *   AX-D  #1044's capture is proved intact BEHAVIOURALLY on every classification
 *         branch and every cancellation branch — including ordering, proved by a
 *         shared call-order log rather than by a source-text regex, and
 *         including the case where `Alert.alert` or `i18n.t` THROWS.
 *   AX-E  Cancellation RACES: unmount while the token exchange is in flight;
 *         background-then-resume during the sleep (must NOT abandon); unmount on
 *         the second iteration.
 *   AX-F  Anti-vacuity + a BYTE-LEVEL DIFFERENTIAL against `origin/main`: excise
 *         the #1875 regions from both shipped sign-in functions and prove the
 *         residue is byte-identical to the pre-change source. The implementor's
 *         suite does not attempt this. It is the strongest available proof that
 *         nothing else in either function moved.
 *
 * Append-only. No product code was modified to make anything here pass.
 * No existing test file was edited.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(HERE, '..', 'useAuthSimple.ts')
const AUTH_JSON_PATH = path.join(HERE, '..', '..', 'i18n', 'locales', 'en', 'auth.json')
const I18N_INDEX_PATH = path.join(HERE, '..', '..', 'i18n', 'index.ts')
const REPO_ROOT = path.join(HERE, '..', '..', '..', '..')
const HOOK_REPO_RELPATH = 'app-mobile/src/hooks/useAuthSimple.ts'

const HOOK_SOURCE = fs.readFileSync(HOOK_PATH, 'utf8')
const AUTH_JSON = JSON.parse(fs.readFileSync(AUTH_JSON_PATH, 'utf8')) as {
  welcome: Record<string, string>
}
const I18N_INDEX_SOURCE = fs.readFileSync(I18N_INDEX_PATH, 'utf8')

// ═════════════════════════════════════════════════════════════════════════════
// Independent slicing of the REAL shipped source
//
// Re-derived here rather than imported, on purpose: if the implementor's slicing
// helpers were subtly wrong, importing them would inherit the same blind spot.
// ═════════════════════════════════════════════════════════════════════════════

const eraseErrCasts = (src: string): string => src.replace(/\(err as \{[^}]*\}\)/g, '(err)')

const sliceBetween = (start: string, end: string): string => {
  const a = HOOK_SOURCE.indexOf(start)
  assert.ok(a > -1, `#1875 adversarial: slice start missing: ${start}`)
  const b = HOOK_SOURCE.indexOf(end, a + 1)
  assert.ok(b > a, `#1875 adversarial: slice end missing after start: ${end}`)
  return HOOK_SOURCE.slice(a, b)
}

const GOOGLE_CHUNK = (): string =>
  sliceBetween('const signInWithGoogle = async () =>', 'const signInWithApple = async () =>')
const APPLE_CHUNK = (): string =>
  sliceBetween('const signInWithApple = async () =>', '  return {\n    user,')

const classifierBody = (): string => {
  const m = HOOK_SOURCE.match(
    /const classifyAuthFailure = \([\s\S]*?\): AuthFailureClass => \{\n([\s\S]*?)\n\};/,
  )
  assert.ok(m, '#1875 adversarial: classifyAuthFailure not found in useAuthSimple.ts')
  return m[1]
}

type Classifier = (
  errName: unknown,
  errCode: unknown,
  errStatus: unknown,
  errMessage: unknown,
  platformOS: string,
) => string

const compileClassifier = (): Classifier =>
  new Function(
    `"use strict"; return function (errName, errCode, errStatus, errMessage, platformOS) {\n${classifierBody()}\n};`,
  )() as Classifier

const catchBodyOf = (chunk: string): string => {
  const m = chunk.match(/\} catch \(err: unknown\) \{\n([\s\S]*)\n {4}\}\n {2}\};/)
  assert.ok(m, '#1875 adversarial: catch body not found in sliced function')
  return eraseErrCasts(m[1])
}

const googleCatch = (): string => catchBodyOf(GOOGLE_CHUNK())
const appleCatch = (): string => catchBodyOf(APPLE_CHUNK())

const googleFnBody = (): string => {
  const m = GOOGLE_CHUNK().match(/const signInWithGoogle = async \(\) => \{\n([\s\S]*)\n {2}\};/)
  assert.ok(m, '#1875 adversarial: signInWithGoogle body not found')
  return eraseErrCasts(m[1])
    .replace(/catch \(err: unknown\)/g, 'catch (err)')
    .replace(/let googleEmail: string \| undefined;/, 'let googleEmail;')
    .replace(/\(googleUser as unknown as \{[^}]*\}[^)]*\)/g, '(googleUser)')
}

const appleFnBody = (): string => {
  const m = APPLE_CHUNK().match(/const signInWithApple = async \(\) => \{\n([\s\S]*)\n {2}\};/)
  assert.ok(m, '#1875 adversarial: signInWithApple body not found')
  return eraseErrCasts(m[1])
    .replace(/catch \(err: unknown\)/g, 'catch (err)')
    .replace(/const updates: Record<string, string> = \{\};/, 'const updates = {};')
}

// ═════════════════════════════════════════════════════════════════════════════
// Copy — resolved from the REAL en/auth.json, never retyped
// ═════════════════════════════════════════════════════════════════════════════

/** The ONLY six values #1875 is permitted to put on screen. Anything else = leak. */
const PERMITTED_COPY_KEYS = [
  'sign_in_failed_title',
  'sign_in_failed_body',
  'sign_in_failed_ok',
  'sign_in_offline_title',
  'sign_in_offline_body',
  'sign_in_retry_exhausted_title',
  'sign_in_retry_exhausted_body',
  'sign_in_permanent_body',
] as const

const PERMITTED_COPY_VALUES = new Set(
  PERMITTED_COPY_KEYS.map((k) => {
    const v = AUTH_JSON.welcome[k]
    assert.ok(typeof v === 'string' && v.length > 0, `en/auth.json missing welcome.${k}`)
    return v
  }),
)

const C = {
  failedTitle: AUTH_JSON.welcome.sign_in_failed_title,
  failedBody: AUTH_JSON.welcome.sign_in_failed_body,
  ok: AUTH_JSON.welcome.sign_in_failed_ok,
  offlineTitle: AUTH_JSON.welcome.sign_in_offline_title,
  offlineBody: AUTH_JSON.welcome.sign_in_offline_body,
  exhaustedTitle: AUTH_JSON.welcome.sign_in_retry_exhausted_title,
  exhaustedBody: AUTH_JSON.welcome.sign_in_retry_exhausted_body,
  permanentBody: AUTH_JSON.welcome.sign_in_permanent_body,
}

const alertShape = (title: string, body: string): unknown[] => [title, body, [{ text: C.ok }]]
const STATE_1 = alertShape(C.offlineTitle, C.offlineBody)
const STATE_2 = alertShape(C.failedTitle, C.failedBody)
const STATE_3 = alertShape(C.exhaustedTitle, C.exhaustedBody)
const STATE_4 = alertShape(C.failedTitle, C.permanentBody)

/**
 * Resolves against the REAL shipped JSON and REFUSES any key outside the
 * permitted set — so a product-code key typo, or a newly-introduced key that
 * was never reviewed, is a hard failure here rather than a silently echoed
 * string on a user's screen.
 */
const i18nStub = {
  t: (key: unknown): string => {
    assert.equal(typeof key, 'string', `#1875: i18n.t called with a non-string: ${String(key)}`)
    const m = String(key).match(/^auth:welcome\.(.+)$/)
    assert.ok(m, `#1875: alert copy must come from an auth:welcome.* key, got: ${String(key)}`)
    assert.ok(
      (PERMITTED_COPY_KEYS as readonly string[]).includes(m[1]),
      `#1875: unreviewed copy key reached the user: welcome.${m[1]}`,
    )
    return AUTH_JSON.welcome[m[1]]
  },
}

// ═════════════════════════════════════════════════════════════════════════════
// Harness
// ═════════════════════════════════════════════════════════════════════════════

interface Spy {
  (...args: unknown[]): unknown
  calls: unknown[][]
}

/** Shared ordering log — AX-D3 proves capture-ordering behaviourally, not by regex. */
const makeOrderLog = (): { seq: string[] } => ({ seq: [] })

const spyOn = (
  order: { seq: string[] },
  label: string,
  impl?: (...args: unknown[]) => unknown,
): Spy => {
  const fn = ((...args: unknown[]) => {
    fn.calls.push(args)
    order.seq.push(label)
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
}

const WEB_CLIENT_ID = '999999999999-zzzzzzzzzzzzzzzzzzzzzzzzzabc1234.apps.googleusercontent.com'

const EVENT_B_MESSAGE =
  '{"type":"default","status":504,"ok":false,"statusText":"","headers":{"map":{"connection":"Close","content-length":"0"}},"url":"https://gqnoajqerqhnvulmnyvv.supabase.co/auth/v1/token?grant_type=id_token","bodyUsed":false,"_bodyInit":{"_data":{"size":0,"offset":0,"blobId":"5364ad2b-0000-4000-8000-000000000000"}}}'

const SUCCESS = {
  data: { session: { user: { id: 'u1' }, access_token: 'tok' }, user: { id: 'u1' } },
  error: null,
}

const retryable = (message: string, status: unknown): Error => {
  const e = new Error(message)
  e.name = 'AuthRetryableFetchError'
  ;(e as unknown as { status: unknown }).status = status
  return e
}

const apiError = (message: string, status: number, code?: string): Error => {
  const e = new Error(message)
  e.name = 'AuthApiError'
  ;(e as unknown as { status: number; code?: string }).status = status
  if (code !== undefined) (e as unknown as { code: string }).code = code
  return e
}

const coded = (code: unknown, message: string): Error => {
  const e = new Error(message)
  ;(e as unknown as { code: unknown }).code = code
  return e
}

interface Harness {
  run: () => Promise<unknown>
  alert: Spy
  report: Spy
  providerSignIn: Spy
  exchange: Spy
  sleeps: unknown[]
  order: { seq: string[] }
  appState: { currentState: string | null }
  isMountedRef: { current: boolean }
  mixpanel: Spy
}

interface HarnessOpts {
  /** Consumed one per exchange call; the LAST entry repeats forever. */
  results?: unknown[]
  /** Throw (reject) on the Nth exchange call, 1-based. */
  throwOnCall?: { n: number; value: unknown }
  providerRejects?: unknown
  providerResult?: unknown
  getTokensImpl?: () => unknown
  os?: string
  realTimers?: boolean
  /** Hostile timer: how many times to invoke the scheduled callback. */
  timerFires?: number
  delays?: unknown
  maxAttempts?: number
  onSleep?: (index: number) => void
  onExchange?: (callIndex: number) => void
  alertImpl?: (...a: unknown[]) => unknown
  i18nImpl?: { t: (k: unknown) => string }
}

const buildExchange = (order: { seq: string[] }, opts: HarnessOpts): { exchange: Spy } => {
  const results = opts.results ?? [SUCCESS]
  let call = 0
  // ONE spy, async, so `throwOnCall` becomes a genuine promise rejection at the
  // `await` inside the sliced body — the hostile shape AX-A6 needs.
  const exchange = spyOn(order, 'exchange', async () => {
    call += 1
    if (opts.onExchange) opts.onExchange(call)
    if (opts.throwOnCall && opts.throwOnCall.n === call) throw opts.throwOnCall.value
    return results[Math.min(call - 1, results.length - 1)]
  })
  return { exchange }
}

const googleHarness = (opts: HarnessOpts = {}): Harness => {
  const order = makeOrderLog()
  const alert = spyOn(order, 'alert', opts.alertImpl)
  const report = spyOn(order, 'report')
  const mixpanel = spyOn(order, 'mixpanel')
  const sleeps: unknown[] = []
  const appState: { currentState: string | null } = { currentState: 'active' }
  const isMountedRef = { current: true }
  const { exchange } = buildExchange(order, opts)

  const providerSignIn = spyOn(order, 'provider.signIn', async () => {
    if (opts.providerRejects) throw opts.providerRejects
    return opts.providerResult ?? { type: 'success', data: { user: { id: 'g1' } } }
  })
  const getTokens = spyOn(
    order,
    'provider.getTokens',
    opts.getTokensImpl ?? (() => ({ idToken: 'google-id-token-CONSTANT' })),
  )

  const fires = opts.timerFires ?? 1
  const fakeSetTimeout = (cb: () => void, ms: unknown): number => {
    const index = sleeps.length
    sleeps.push(ms)
    if (opts.onSleep) opts.onSleep(index)
    for (let i = 0; i < fires; i += 1) cb()
    return 0
  }

  const deps: Record<string, unknown> = {
    Platform: { OS: opts.os ?? 'android', Version: 34 },
    Alert: { alert },
    Constants: { expoConfig: { extra: { EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: WEB_CLIENT_ID } } },
    GoogleSignin: {
      hasPlayServices: spyOn(order, 'hasPlayServices', async () => true),
      hasPreviousSignIn: spyOn(order, 'hasPreviousSignIn', async () => false),
      signOut: spyOn(order, 'provider.signOut', async () => null),
      signIn: providerSignIn,
      getTokens,
    },
    supabase: {
      from: () => ({
        select: () => ({ ilike: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      }),
      auth: { signInWithIdToken: exchange, getSession: async () => ({ data: { session: null } }) },
    },
    logger: { auth: () => {}, error: spyOn(order, 'logger.error') },
    console: { log: () => {}, warn: () => {}, error: spyOn(order, 'console.error') },
    mixpanelService: { trackLoginFailed: mixpanel },
    webClientId: WEB_CLIENT_ID,
    statusCodes: ANDROID_STATUS_CODES,
    shouldReportAuthFailure: () => true,
    reportNonFatal: report,
    classifyAuthFailure: compileClassifier(),
    i18n: opts.i18nImpl ?? i18nStub,
    AppState: appState,
    isMountedRef,
    TRANSPORT_RETRY_MAX_ATTEMPTS: opts.maxAttempts ?? 2,
    TRANSPORT_RETRY_DELAYS_MS: opts.delays ?? [400, 1200],
    setTimeout: opts.realTimers ? setTimeout : fakeSetTimeout,
  }

  const names = Object.keys(deps)
  const make = new Function(
    ...names,
    `"use strict"; return async function () {\n${googleFnBody()}\n};`,
  ) as (...injected: unknown[]) => () => Promise<unknown>

  return {
    run: make(...names.map((n) => deps[n])),
    alert,
    report,
    providerSignIn,
    exchange,
    sleeps,
    order,
    appState,
    isMountedRef,
    mixpanel,
  }
}

const appleHarness = (opts: HarnessOpts = {}): Harness => {
  const order = makeOrderLog()
  const alert = spyOn(order, 'alert', opts.alertImpl)
  const report = spyOn(order, 'report')
  const mixpanel = spyOn(order, 'mixpanel')
  const sleeps: unknown[] = []
  const appState: { currentState: string | null } = { currentState: 'active' }
  const isMountedRef = { current: true }
  const { exchange } = buildExchange(order, opts)

  const providerSignIn = spyOn(order, 'provider.signIn', async () => {
    if (opts.providerRejects) throw opts.providerRejects
    return { identityToken: 'apple-identity-token-CONSTANT', fullName: null }
  })

  const fires = opts.timerFires ?? 1
  const deps: Record<string, unknown> = {
    Platform: { OS: opts.os ?? 'ios', Version: '18.2' },
    Alert: { alert },
    AppleAuthentication: {
      isAvailableAsync: async () => true,
      signInAsync: providerSignIn,
      AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    },
    supabase: { auth: { signInWithIdToken: exchange } },
    logger: { auth: () => {}, error: spyOn(order, 'logger.error') },
    console: { log: () => {}, warn: () => {}, error: spyOn(order, 'console.error') },
    mixpanelService: { trackLoginFailed: mixpanel },
    shouldReportAuthFailure: () => true,
    reportNonFatal: report,
    classifyAuthFailure: compileClassifier(),
    i18n: opts.i18nImpl ?? i18nStub,
    AppState: appState,
    isMountedRef,
    TRANSPORT_RETRY_MAX_ATTEMPTS: opts.maxAttempts ?? 2,
    TRANSPORT_RETRY_DELAYS_MS: opts.delays ?? [400, 1200],
    setTimeout: opts.realTimers
      ? setTimeout
      : (cb: () => void, ms: unknown): number => {
          const index = sleeps.length
          sleeps.push(ms)
          if (opts.onSleep) opts.onSleep(index)
          for (let i = 0; i < fires; i += 1) cb()
          return 0
        },
    __DEV__: false,
  }

  const names = Object.keys(deps)
  const make = new Function(
    ...names,
    `"use strict"; return async function () {\n${appleFnBody()}\n};`,
  ) as (...injected: unknown[]) => () => Promise<unknown>

  return {
    run: make(...names.map((n) => deps[n])),
    alert,
    report,
    providerSignIn,
    exchange,
    sleeps,
    order,
    appState,
    isMountedRef,
    mixpanel,
  }
}

/** Catch-only driver, for the leak whitelist fuzz. */
const catchHarness = (opts: {
  os?: string
  attempts?: number
  abandoned?: boolean
  i18nImpl?: { t: (k: unknown) => string }
} = {}) => {
  const order = makeOrderLog()
  const alert = spyOn(order, 'alert')
  const report = spyOn(order, 'report')
  const deps: Record<string, unknown> = {
    Alert: { alert },
    Platform: { OS: opts.os ?? 'android', Version: 34 },
    statusCodes: ANDROID_STATUS_CODES,
    reportNonFatal: report,
    shouldReportAuthFailure: () => true,
    webClientId: WEB_CLIENT_ID,
    logger: { error: () => {}, auth: () => {} },
    console: { error: () => {}, warn: () => {}, log: () => {} },
    mixpanelService: { trackLoginFailed: spyOn(order, 'mixpanel') },
    __DEV__: false,
    classifyAuthFailure: compileClassifier(),
    i18n: opts.i18nImpl ?? i18nStub,
    transportRetryAttempts: opts.attempts ?? 0,
    retryAbandoned: opts.abandoned ?? false,
  }
  const names = Object.keys(deps)
  const run = (body: string, err: unknown): unknown =>
    (
      new Function(...names, `"use strict"; return function (err) {\n${body}\n};`) as (
        ...a: unknown[]
      ) => (e: unknown) => unknown
    )(...names.map((n) => deps[n]))(err)
  return { alert, report, order, run }
}

// ═════════════════════════════════════════════════════════════════════════════
// AX-F0 — ANTI-VACUITY. If these fail, every other test in this file is
// meaningless, so they run first and fail loudly.
// ═════════════════════════════════════════════════════════════════════════════

test('AX-F0 — the sliced bodies are real, non-empty, and carry the #1875 additions', () => {
  const cls = classifierBody()
  assert.ok(cls.length > 200, 'classifyAuthFailure body suspiciously small')
  assert.ok(/transient-transport-offline/.test(cls) && /return "permanent"/.test(cls))

  for (const [label, body] of [
    ['google', googleFnBody()],
    ['apple', appleFnBody()],
  ] as const) {
    assert.ok(body.length > 2000, `${label} function body suspiciously small`)
    assert.ok(/#1875/.test(body), `${label}: the #1875 additions are not in the sliced body`)
    assert.ok(
      /transportRetryAttempts < TRANSPORT_RETRY_MAX_ATTEMPTS/.test(body),
      `${label}: the counter bound is not in the sliced body`,
    )
    assert.ok(/retryCancelled/.test(body), `${label}: cancellation checkpoints missing`)
    assert.ok(/i18n\.t\(/.test(body), `${label}: the alert no longer reads from i18n`)
  }
  // The compiled classifier really executes.
  assert.equal(
    compileClassifier()('AuthRetryableFetchError', undefined, 0, 'x', 'android'),
    'transient-transport-offline',
  )
})

test('AX-F0 — the harness itself can observe a failure (negative control on the harness)', async () => {
  const h = googleHarness({ results: [{ data: null, error: apiError('nope', 400) }] })
  await h.run()
  assert.equal(h.alert.calls.length, 1, 'the harness cannot see alerts — every AX-C test is vacuous')
  assert.equal(h.report.calls.length, 1, 'the harness cannot see captures — every AX-D test is vacuous')
})

// ═════════════════════════════════════════════════════════════════════════════
// AX-A — CAN THE RETRY SPIN? Attack the bound.
// ═════════════════════════════════════════════════════════════════════════════

test('AX-A1 — a hostile timer that fires its callback FIVE times cannot drive extra attempts', async () => {
  // If the loop were driven by timer callbacks rather than by the counter, this
  // is where it would run away. The awaited Promise resolves exactly once no
  // matter how many times `resolve` is invoked, and the counter is the bound.
  const h = googleHarness({
    results: [{ data: null, error: retryable(EVENT_B_MESSAGE, 504) }],
    timerFires: 5,
  })
  await h.run()
  assert.equal(h.exchange.calls.length, 3, 'token exchange ran more than 3 times')
  assert.equal(h.sleeps.length, 2, 'more than 2 sleeps were scheduled')
  assert.deepEqual(h.alert.calls[0], STATE_3)
})

test('AX-A2 — the bound is the COUNTER, not the delay array: a short delay array still terminates', async () => {
  // TRANSPORT_RETRY_DELAYS_MS deliberately shortened to length 1 while the cap
  // stays 2. Attempt 2 sleeps on `undefined`. If anything derived the bound from
  // the array length, or crashed on the undefined delay, this changes shape.
  const h = googleHarness({
    results: [{ data: null, error: retryable('boom', 0) }],
    delays: [400],
  })
  await h.run()
  assert.equal(h.exchange.calls.length, 3)
  assert.deepEqual(h.sleeps, [400, undefined])
  assert.deepEqual(h.alert.calls[0], STATE_3)
})

test('AX-A3 — an EMPTY delay array still terminates at exactly 3 attempts', async () => {
  const h = googleHarness({ results: [{ data: null, error: retryable('boom', 0) }], delays: [] })
  await h.run()
  assert.equal(h.exchange.calls.length, 3)
})

test('AX-A4 — an error whose `name` FLIPS mid-loop cannot extend or short-circuit the bound', async () => {
  // A Proxy-backed error that reports AuthRetryableFetchError for the first two
  // reads and something permanent afterwards. The loop must still terminate, and
  // must stop as soon as the class stops being transient-transport.
  let nameReads = 0
  const flipping = new Proxy(new Error('flip'), {
    get(target, prop, recv) {
      if (prop === 'name') {
        nameReads += 1
        return nameReads <= 1 ? 'AuthRetryableFetchError' : 'AuthApiError'
      }
      if (prop === 'status') return 0
      return Reflect.get(target, prop, recv)
    },
  })
  const h = googleHarness({ results: [{ data: null, error: flipping }] })
  await h.run()
  // 1 initial + 1 retry (first condition read was transient) then the second
  // read classifies permanent and the loop exits.
  assert.equal(h.exchange.calls.length, 2)
  assert.ok(h.alert.calls.length === 1)
})

test('AX-A5 — an always-transient error terminates at EXACTLY 3 attempts under REAL timers', async () => {
  const started = Date.now()
  const h = googleHarness({
    results: [{ data: null, error: retryable('Network request failed', 0) }],
    realTimers: true,
  })
  await h.run()
  const elapsed = Date.now() - started
  assert.equal(h.exchange.calls.length, 3)
  assert.ok(elapsed >= 1500, `real backoff did not happen (elapsed ${elapsed}ms)`)
  assert.ok(elapsed < 8000, `retry took far too long (elapsed ${elapsed}ms)`)
})

test('AX-A6 — a retry attempt that THROWS instead of returning does not spin, double-capture, or leak', async () => {
  // The second attempt rejects. Control leaves the loop through the throw and
  // lands in the existing catch: exactly one capture, exactly one alert, and the
  // alert is State 3 because a retry did run.
  const h = googleHarness({
    results: [{ data: null, error: retryable('boom', 504) }],
    throwOnCall: { n: 2, value: retryable(EVENT_B_MESSAGE, 504) },
  })
  const out = (await h.run()) as { data: unknown; error: unknown }
  assert.equal(h.exchange.calls.length, 2, 'the throw did not stop the loop')
  assert.equal(h.report.calls.length, 1, 'capture count is wrong')
  assert.equal(h.alert.calls.length, 1)
  assert.deepEqual(h.alert.calls[0], STATE_3)
  assert.equal(out.data, null)
})

test('AX-A7 — two CONCURRENT sign-ins each keep their own counter (no shared module state)', async () => {
  const a = googleHarness({ results: [{ data: null, error: retryable('boom', 0) }] })
  const b = googleHarness({ results: [{ data: null, error: retryable('boom', 0) }] })
  await Promise.all([a.run(), b.run()])
  assert.equal(a.exchange.calls.length, 3)
  assert.equal(b.exchange.calls.length, 3)
  assert.equal(a.alert.calls.length, 1)
  assert.equal(b.alert.calls.length, 1)
})

test('AX-A8 — the counter is written in exactly ONE place, and the constants cannot be reassigned', () => {
  const src = HOOK_SOURCE
  // Frozen module-level constants, not `let`, not derived at runtime.
  assert.ok(
    /const TRANSPORT_RETRY_MAX_ATTEMPTS = 2;/.test(src),
    'TRANSPORT_RETRY_MAX_ATTEMPTS is not a module-level const numeric literal',
  )
  assert.ok(
    /const TRANSPORT_RETRY_DELAYS_MS = Object\.freeze\(\[/.test(src),
    'TRANSPORT_RETRY_DELAYS_MS is not frozen',
  )
  // No reassignment of either constant anywhere.
  assert.ok(
    !/TRANSPORT_RETRY_MAX_ATTEMPTS\s*=[^=]/.test(src.replace(/const TRANSPORT_RETRY_MAX_ATTEMPTS = 2;/, '')),
    'TRANSPORT_RETRY_MAX_ATTEMPTS is reassigned somewhere',
  )
  for (const [label, body] of [
    ['google', googleFnBody()],
    ['apple', appleFnBody()],
  ] as const) {
    assert.ok(
      /let transportRetryAttempts = 0;/.test(body),
      `${label}: counter is not initialised to 0 with let`,
    )
    // Every write to the counter, excluding its single declaration.
    const writes =
      body
        .replace('let transportRetryAttempts = 0;', '')
        .match(/transportRetryAttempts\s*(\+\+|--|\+=[^;]*|-=[^;]*|=[^=][^;]*)/g) ?? []
    assert.deepEqual(
      writes.map((w) => w.replace(/\s+/g, ' ').trim()),
      ['transportRetryAttempts += 1'],
      `${label}: the retry counter is written somewhere other than the single += 1`,
    )
  }
})

test('AX-A9 — the provider leg is never re-invoked by the retry, on either provider', async () => {
  const g = googleHarness({ results: [{ data: null, error: retryable('boom', 503) }] })
  await g.run()
  assert.equal(g.exchange.calls.length, 3)
  assert.equal(g.providerSignIn.calls.length, 1, 'the Google account picker was re-presented')

  const a = appleHarness({ results: [{ data: null, error: retryable('boom', 503) }] })
  await a.run()
  assert.equal(a.exchange.calls.length, 3)
  assert.equal(a.providerSignIn.calls.length, 1, 'the Apple Face ID sheet was re-presented')
})

test('AX-A10 — every retry re-sends a byte-identical argument; the loop never mutates the token', async () => {
  const h = googleHarness({ results: [{ data: null, error: retryable('boom', 502) }] })
  await h.run()
  assert.equal(h.exchange.calls.length, 3)
  const first = JSON.stringify(h.exchange.calls[0])
  for (const call of h.exchange.calls) {
    assert.equal(JSON.stringify(call), first, 'a retry sent a different argument')
  }
  assert.deepEqual(h.exchange.calls[0][0], {
    provider: 'google',
    token: 'google-id-token-CONSTANT',
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// AX-B — CAN A PERMANENT FAILURE BE SILENTLY RETRIED? Exhaustive, not sampled.
// ═════════════════════════════════════════════════════════════════════════════

const RETRY_ELIGIBLE = (cls: string): boolean => cls.startsWith('transient-transport')
const VALID_CLASSES = new Set([
  'permanent',
  'transient-transport-offline',
  'transient-transport-remote',
  'transient-provider',
])

test('AX-B1 — EXHAUSTIVE GMS/iOS code sweep: only android + "7"/"8"/"15" is transient-provider', () => {
  const c = compileClassifier()
  const codes: unknown[] = []
  for (let i = 0; i <= 20; i += 1) codes.push(String(i))
  for (let i = -1; i >= -9; i -= 1) codes.push(String(i))
  codes.push('12500', '12501', '12502', 'getTokens', 'ASYNC_OP_IN_PROGRESS', '')

  const expectedProvider = new Set(['7', '8', '15'])
  for (const os of ['android', 'ios']) {
    for (const code of codes) {
      const cls = c(undefined, code, undefined, 'some message', os)
      assert.ok(VALID_CLASSES.has(cls), `classifier returned a non-literal: ${cls}`)
      const shouldBeProvider = os === 'android' && expectedProvider.has(String(code))
      assert.equal(
        cls,
        shouldBeProvider ? 'transient-provider' : 'permanent',
        `code ${JSON.stringify(code)} on ${os} classified ${cls}`,
      )
      assert.equal(
        RETRY_ELIGIBLE(cls),
        false,
        `a provider-layer code (${String(code)}/${os}) became AUTO-RETRY ELIGIBLE`,
      )
    }
  }
})

test('AX-B2 — type confusion cannot smuggle a code past the `typeof === "string"` guard', () => {
  const c = compileClassifier()
  const impostors: unknown[] = [
    7,
    8,
    15,
    new String('8'),
    { toString: () => '8' },
    { valueOf: () => '8' },
    ['8'],
    true,
    8n,
    Symbol('8'),
    ' 8',
    '8 ',
    '08',
    '8.0',
    '8 ',
    '８', // fullwidth digit eight
  ]
  for (const code of impostors) {
    const cls = c(undefined, code, undefined, 'm', 'android')
    assert.equal(cls, 'permanent', `impostor code ${String(code)} classified ${cls}`)
  }
})

test('AX-B3 — codeless / empty / exotic errors all default to permanent (R6)', () => {
  const c = compileClassifier()
  const shapes: unknown[] = [
    undefined,
    null,
    {},
    [],
    '',
    0,
    -1,
    false,
    NaN,
    Infinity,
    Symbol('x'),
    () => {},
    new Date(0),
    Object.freeze({ code: '8' }),
    new Map(),
  ]
  for (const name of shapes) {
    for (const code of shapes) {
      const cls = c(name, code, undefined, undefined, 'android')
      assert.ok(VALID_CLASSES.has(cls))
      assert.equal(
        cls,
        'permanent',
        `name=${String(name)} code=${String(code)} classified ${cls} instead of permanent`,
      )
    }
  }
})

test('AX-B4 — R5 is EXACT equality: 20 near-miss messages stay permanent', () => {
  const c = compileClassifier()
  const exact = 'Network request failed'
  assert.equal(c(undefined, undefined, undefined, exact, 'ios'), 'transient-transport-offline')

  const nearMisses = [
    'network request failed',
    'NETWORK REQUEST FAILED',
    ' Network request failed',
    'Network request failed ',
    'Network request failed.',
    'Network  request failed',
    'Network request failed\n',
    'TypeError: Network request failed',
    'Error: Network request failed',
    '["Network request failed"]',
    `{"message":"${exact}"}`,
    `${exact}${exact}`,
    'Network_request_failed',
    'Networkrequestfailed',
    'Network request faile',
    'Network request failedd',
    `${'x'.repeat(1_000_000)}${exact}`,
    `${exact}${'x'.repeat(1_000_000)}`,
    EVENT_B_MESSAGE,
    'La solicitud de red ha fallado',
  ]
  for (const m of nearMisses) {
    assert.equal(
      c(undefined, undefined, undefined, m, 'android'),
      'permanent',
      `near-miss message became transient: ${m.slice(0, 60)}`,
    )
  }
})

test('AX-B5 — an AuthApiError is NEVER retried, at any HTTP status 100..599', () => {
  const c = compileClassifier()
  for (let s = 100; s <= 599; s += 1) {
    for (const name of ['AuthApiError', 'AuthUnknownError', 'AuthWeakPasswordError', 'AuthSessionMissingError', 'TypeError', 'Error']) {
      const cls = c(name, undefined, s, 'm', 'android')
      assert.equal(cls, 'permanent', `${name}/${s} classified ${cls}`)
      assert.equal(RETRY_ELIGIBLE(cls), false)
    }
  }
})

test('AX-B6 — the retry gate is the ERROR NAME: an AuthApiError(504) is not retried end-to-end', async () => {
  const h = googleHarness({ results: [{ data: null, error: apiError(EVENT_B_MESSAGE, 504) }] })
  await h.run()
  assert.equal(h.exchange.calls.length, 1, 'a permanent AuthApiError was retried')
  assert.deepEqual(h.alert.calls[0], STATE_4)
})

test('AX-B7 — platformOS is matched by strict equality: no case or whitespace variant enables R4', () => {
  const c = compileClassifier()
  for (const os of ['Android', 'ANDROID', ' android', 'android ', 'andro id', 'ios', 'iOS', 'web', 'windows', 'macos', '']) {
    const cls = c(undefined, '8', undefined, 'INTERNAL_ERROR', os)
    assert.equal(
      cls,
      os === 'android' ? 'transient-provider' : 'permanent',
      `platformOS ${JSON.stringify(os)} produced ${cls}`,
    )
  }
})

test('AX-B8 — the classifier is PURE: deterministic, and it mutates none of its arguments', () => {
  const c = compileClassifier()
  const args: [unknown, unknown, unknown, unknown, string] = [
    'AuthRetryableFetchError',
    Object.freeze({ nested: true }),
    Object.freeze([504]),
    'Network request failed',
    'android',
  ]
  const first = c(...args)
  for (let i = 0; i < 1000; i += 1) {
    assert.equal(c(...args), first, 'classifier is not deterministic')
  }
  // Frozen arguments would throw in strict mode on any write attempt.
  assert.deepEqual(args[1], { nested: true })
  assert.deepEqual(args[2], [504])
})

test('AX-B9 — the classifier body reads nothing outside its five parameters', () => {
  const body = classifierBody()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const forbidden of [
    'statusCodes',
    'INTERNAL_ERROR',
    'NETWORK_ERROR',
    'TIMEOUT',
    'instanceof',
    'NetInfo',
    'onlineManager',
    'networkMonitor',
    'offlineService',
    'Platform',
    'Date',
    'Math.',
    'await',
    'fetch',
    'console',
    'throw',
    'i18n',
    'AppState',
    'isMountedRef',
  ]) {
    assert.ok(
      !body.includes(forbidden),
      `classifyAuthFailure references ${forbidden} — it must read only its five parameters`,
    )
  }
  // Every `return` is one of the four literals, and there are no others.
  const returns = body.match(/return "[a-z-]+";/g) ?? []
  assert.ok(returns.length >= 4, 'classifier has suspiciously few returns')
  for (const r of returns) {
    const literal = r.slice('return "'.length, -2)
    assert.ok(VALID_CLASSES.has(literal), `classifier can return an unknown class: ${literal}`)
  }
  assert.ok(
    /return "permanent";\n\};/.test(`${classifierBody()}\n};`),
    'the LAST statement of the classifier is not the permanent default',
  )
})

test('AX-B10 — a hostile error object cannot produce an unhandled rejection or a silent retry', async () => {
  // `name`/`message` getters that throw. The throw happens at the CALL SITE while
  // evaluating the classifier arguments, inside the try — so the existing catch
  // must absorb it, capture once, and show the permanent copy.
  const boobyTrapped = Object.defineProperties(new Error('x'), {
    name: { get: () => { throw new Error('name getter boom') } },
  })
  const h = googleHarness({ results: [{ data: null, error: boobyTrapped }] })
  const out = (await h.run()) as { data: unknown; error: unknown }
  assert.equal(h.exchange.calls.length, 1, 'a booby-trapped error was retried')
  assert.equal(h.report.calls.length, 1)
  assert.equal(h.alert.calls.length, 1)
  assert.deepEqual(h.alert.calls[0], STATE_4)
  assert.equal(out.data, null)
})

test('AX-B11 — a toJSON/Symbol.toPrimitive that returns our Supabase URL cannot reach the user', async () => {
  const sneaky = new Error('benign')
  ;(sneaky as unknown as { toJSON: () => string }).toJSON = () =>
    'https://gqnoajqerqhnvulmnyvv.supabase.co/auth/v1/token'
  ;(sneaky as unknown as Record<symbol, unknown>)[Symbol.toPrimitive] = () =>
    'https://gqnoajqerqhnvulmnyvv.supabase.co/auth/v1/token'
  const h = googleHarness({ results: [{ data: null, error: sneaky }] })
  await h.run()
  assert.equal(h.alert.calls.length, 1)
  assert.deepEqual(h.alert.calls[0], STATE_4)
  assert.ok(!JSON.stringify(h.alert.calls).includes('supabase'))
})

// ═════════════════════════════════════════════════════════════════════════════
// AX-C — CAN THE ALERT LEAK? Whitelist closure, not substring blacklist.
// ═════════════════════════════════════════════════════════════════════════════

const LEAK_CORPUS: { label: string; err: unknown }[] = [
  { label: 'event-B 504 blob', err: retryable(EVENT_B_MESSAGE, 504) },
  { label: 'event-A INTERNAL_ERROR', err: coded('8', 'INTERNAL_ERROR') },
  { label: 'DEVELOPER_ERROR + docs URL', err: coded('10', 'DEVELOPER_ERROR: Follow troubleshooting instructions at https://react-native-google-signin.github.io/docs/troubleshooting') },
  { label: '4KB junk', err: new Error('JUNKSENTINEL'.repeat(400)) },
  { label: '1MB message', err: new Error(`LEAKCANARY${'z'.repeat(1_000_000)}`) },
  { label: 'raw project ref', err: new Error('gqnoajqerqhnvulmnyvv') },
  { label: 'percent-encoded url', err: new Error('https%3A%2F%2Fgqnoajqerqhnvulmnyvv.supabase.co') },
  { label: 'blob id only', err: new Error('blobId 5364ad2b-0000-4000-8000-000000000000') },
  { label: 'auth api 400', err: apiError('invalid audience', 400, 'validation_failed') },
  { label: 'auth api 401', err: apiError('bad jwt', 401) },
  { label: 'offline fetch', err: retryable('Network request failed', 0) },
  { label: 'null thrown', err: null },
  { label: 'undefined thrown', err: undefined },
  { label: 'string thrown', err: 'https://gqnoajqerqhnvulmnyvv.supabase.co/auth/v1/token' },
  { label: 'number thrown', err: 504 },
  { label: 'plain object thrown', err: { name: 'AuthRetryableFetchError', status: 504, message: EVENT_B_MESSAGE } },
  { label: 'frozen error', err: Object.freeze(coded('999', 'frozen')) },
  { label: 'getTokens fallback', err: coded('getTokens', 'Failed to get ID token from Google') },
  { label: 'codeless create-session', err: new Error('Failed to create session') },
  { label: 'newline injection', err: new Error('ok\n\nhttps://gqnoajqerqhnvulmnyvv.supabase.co') },
]

const FORBIDDEN_SUBSTRINGS = [
  'supabase.co',
  'http',
  'gqnoajqerqhnvulmnyvv',
  'blobId',
  '_bodyInit',
  'statusText',
  'bodyUsed',
  'INTERNAL_ERROR',
  'DEVELOPER_ERROR',
  'AuthRetryableFetchError',
  'AuthApiError',
  '504',
  'JUNKSENTINEL',
  'LEAKCANARY',
  'getTokens',
  'Failed to create session',
]

test('AX-C1 — WHITELIST CLOSURE: across the whole fuzz, only permitted copy ever reaches Alert', () => {
  const seen = new Set<string>()
  let drives = 0
  for (const provider of ['google', 'apple'] as const) {
    const body = provider === 'google' ? googleCatch() : appleCatch()
    for (const os of ['android', 'ios']) {
      for (const attempts of [0, 1, 2]) {
        for (const { label, err } of LEAK_CORPUS) {
          const h = catchHarness({ os, attempts })
          h.run(body, err)
          drives += 1
          assert.ok(
            h.alert.calls.length <= 1,
            `${provider}/${os}/${attempts}/${label}: more than one alert`,
          )
          for (const call of h.alert.calls) {
            const [title, bodyArg, buttons] = call as [unknown, unknown, unknown]
            for (const v of [title, bodyArg]) {
              assert.equal(typeof v, 'string', `${label}: a non-string reached the alert`)
              assert.ok(
                PERMITTED_COPY_VALUES.has(v as string),
                `${provider}/${os}/${attempts}/${label}: NON-WHITELISTED string reached the user: ${String(v).slice(0, 120)}`,
              )
              seen.add(v as string)
            }
            assert.deepEqual(buttons, [{ text: C.ok }], `${label}: button shape changed`)
          }
        }
      }
    }
  }
  assert.ok(drives >= 240, `fuzz did not actually run (${drives} drives)`)
  for (const v of seen) assert.ok(PERMITTED_COPY_VALUES.has(v))
})

test('AX-C2 — blacklist gate, independently: no forbidden substring in any alert argument', () => {
  for (const provider of ['google', 'apple'] as const) {
    const body = provider === 'google' ? googleCatch() : appleCatch()
    for (const attempts of [0, 1, 2]) {
      for (const { label, err } of LEAK_CORPUS) {
        const h = catchHarness({ attempts })
        h.run(body, err)
        const rendered = JSON.stringify(h.alert.calls)
        for (const needle of FORBIDDEN_SUBSTRINGS) {
          assert.ok(
            !rendered.includes(needle),
            `${provider}/${attempts}/${label}: "${needle}" leaked into the alert`,
          )
        }
      }
    }
  }
})

test('AX-C3 — the caught error cannot influence the alert AT ALL (two different errors, same class)', () => {
  for (const provider of ['google', 'apple'] as const) {
    const body = provider === 'google' ? googleCatch() : appleCatch()
    const a = catchHarness()
    const b = catchHarness()
    a.run(body, retryable(EVENT_B_MESSAGE, 504))
    b.run(body, retryable('x', 503))
    assert.deepEqual(
      a.alert.calls,
      b.alert.calls,
      `${provider}: the alert varies with the error's value`,
    )
  }
})

test('AX-C4 — every one of the four states resolves to a real English sentence, not a raw key', () => {
  // A missing key would surface to the user as the literal "auth:welcome.x".
  for (const state of [STATE_1, STATE_2, STATE_3, STATE_4]) {
    for (const v of [state[0], state[1]] as string[]) {
      assert.ok(!/^auth:/.test(v), `an unresolved i18n key would reach the user: ${v}`)
      assert.ok(/[a-z]/.test(v) && v.includes(' '), `copy is not a sentence: ${v}`)
      assert.ok(!/\{\{|\}\}/.test(v), `copy carries interpolation: ${v}`)
      assert.ok(!/@needs_translation/.test(v), `copy carries the @needs_translation suffix: ${v}`)
      assert.ok(!/https?:|supabase|\berror\b/i.test(v), `technical leakage in copy: ${v}`)
    }
  }
  assert.ok(
    !/check your connection/i.test(C.permanentBody),
    'State 4 misdirects the user to their connection',
  )
  assert.ok(C.permanentBody.includes('support@usemingla.com'), 'State 4 is not actionable')
})

test('AX-C5 — every i18n key the SHIPPED code passes to t() exists and is eagerly bundled for en', () => {
  // Extracted from the real source, not from a list typed here — so a key added
  // to product code without a translation is a hard failure.
  const usedKeys = new Set<string>()
  for (const body of [googleCatch(), appleCatch()]) {
    for (const m of body.matchAll(/i18n\.t\(\s*"([^"]+)"\s*\)/g)) usedKeys.add(m[1])
    for (const m of body.matchAll(/(alertTitleKey|alertBodyKey)\s*=\s*"([^"]+)"/g)) usedKeys.add(m[2])
  }
  assert.ok(usedKeys.size >= 6, `expected at least 6 copy keys, found ${usedKeys.size}`)
  for (const key of usedKeys) {
    const m = key.match(/^([a-z_]+):(.+)$/)
    assert.ok(m, `copy key is not namespaced: ${key}`)
    const [, ns, dotted] = m
    assert.equal(ns, 'auth', `#1875 copy must live in the auth namespace, got ${ns}`)
    const leaf = dotted.split('.').reduce<unknown>(
      (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
      AUTH_JSON as unknown,
    )
    assert.equal(typeof leaf, 'string', `unresolvable key would render literally: ${key}`)
    assert.ok((leaf as string).length > 0, `empty copy for ${key}`)
  }
  // The `auth` namespace must be registered AND statically bundled for en —
  // a lazily-loaded namespace would render raw keys on the very first failure.
  assert.ok(/\bauth\b/.test(I18N_INDEX_SOURCE), 'auth namespace absent from i18n/index.ts')
  assert.ok(
    /resources:\s*\{[\s\S]*?en:\s*\{[\s\S]*?auth:\s*en_auth[\s\S]*?\}/.test(I18N_INDEX_SOURCE),
    'the auth namespace is not eagerly bundled for en — alerts could render raw keys',
  )
  assert.ok(
    /fallbackLng:\s*'en'/.test(I18N_INDEX_SOURCE),
    "fallbackLng 'en' is what serves these en-only keys to the other 28 locales",
  )
})

test('AX-C6 — the untouched Play Services alert is still the ORIGINAL verbatim English pair', () => {
  for (const body of [googleCatch()]) {
    assert.ok(
      body.includes('"Google Play Services Required"') &&
        body.includes('"Google Play Services is not available. Please install it from the Play Store."'),
      '#1875 altered the Play Services alert, which was explicitly out of scope',
    )
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// AX-D — DOES #1044's CAPTURE SURVIVE EVERY PATH?
// ═════════════════════════════════════════════════════════════════════════════

const assertGoogleCapture = (report: Spy, expectedCode: string): void => {
  assert.equal(report.calls.length, 1, 'expected exactly one reportNonFatal')
  const [scope, , extra, fingerprint] = report.calls[0] as [string, unknown, Record<string, unknown>, string[]]
  assert.equal(scope, 'auth.signInWithGoogle.native')
  assert.deepEqual(
    Object.keys(extra).sort(),
    ['code', 'osVersion', 'platform', 'provider', 'webClientIdSuffix'],
    'the #1044 extra allowlist changed',
  )
  assert.equal(extra.provider, 'google')
  assert.equal(extra.code, expectedCode)
  assert.deepEqual(fingerprint, ['auth-signin', 'google', expectedCode])
}

test('AX-D1 — the #1044 payload is byte-exact on EVERY classification branch', async () => {
  const branches: { label: string; result: unknown; code: string }[] = [
    { label: 'offline', result: { data: null, error: retryable('Network request failed', 0) }, code: 'none' },
    { label: 'remote-504', result: { data: null, error: retryable(EVENT_B_MESSAGE, 504) }, code: 'none' },
    { label: 'permanent-api', result: { data: null, error: apiError('bad', 400, 'validation_failed') }, code: 'validation_failed' },
  ]
  for (const b of branches) {
    const h = googleHarness({ results: [b.result] })
    await h.run()
    assertGoogleCapture(h.report, b.code)
  }
  // The provider branch never reaches the token exchange at all.
  const p = googleHarness({ providerRejects: coded('8', 'INTERNAL_ERROR') })
  await p.run()
  assert.equal(p.exchange.calls.length, 0, 'the provider branch reached the token exchange')
  assertGoogleCapture(p.report, '8')
  assert.deepEqual(p.alert.calls[0], STATE_2)
})

test('AX-D2 — Apple keeps its own scope and its FOUR-key extra on every branch', async () => {
  for (const result of [
    { data: null, error: retryable('Network request failed', 0) },
    { data: null, error: retryable(EVENT_B_MESSAGE, 504) },
    { data: null, error: apiError('bad', 400) },
  ]) {
    const h = appleHarness({ results: [result] })
    await h.run()
    assert.equal(h.report.calls.length, 1)
    const [scope, , extra, fingerprint] = h.report.calls[0] as [string, unknown, Record<string, unknown>, string[]]
    assert.equal(scope, 'auth.signInWithApple.native')
    assert.deepEqual(
      Object.keys(extra).sort(),
      ['code', 'osVersion', 'platform', 'provider'],
      'Apple extra must stay FOUR keys — no webClientIdSuffix',
    )
    assert.equal(extra.provider, 'apple')
    assert.deepEqual(fingerprint, ['auth-signin', 'apple', 'none'])
  }
})

test('AX-D3 — CANCELLATION suppresses the Alert and NEVER the capture, at every checkpoint', async () => {
  const scenarios: { label: string; wire: (h: Harness) => void; expectCalls: number }[] = [
    {
      label: 'C2 background BEFORE the first sleep',
      wire: (h) => { h.appState.currentState = 'background' },
      expectCalls: 1,
    },
    {
      label: 'C1 unmounted BEFORE the first sleep',
      wire: (h) => { h.isMountedRef.current = false },
      expectCalls: 1,
    },
  ]
  for (const s of scenarios) {
    const h = googleHarness({ results: [{ data: null, error: retryable(EVENT_B_MESSAGE, 504) }] })
    s.wire(h)
    await h.run()
    assert.equal(h.exchange.calls.length, s.expectCalls, `${s.label}: retry not abandoned`)
    assert.equal(h.alert.calls.length, 0, `${s.label}: an alert fired for an abandoned retry`)
    assert.equal(h.report.calls.length, 1, `${s.label}: the #1044 capture was suppressed`)
    assertGoogleCapture(h.report, 'none')
    assert.ok(h.mixpanel.calls.length === 1, `${s.label}: mixpanel was suppressed`)
  }

  // C2 DURING the sleep — the checkpoint after the sleep is the one that matters.
  const mid = googleHarness({
    results: [{ data: null, error: retryable(EVENT_B_MESSAGE, 504) }],
    onSleep: () => { mid.appState.currentState = 'background' },
  })
  await mid.run()
  assert.equal(mid.exchange.calls.length, 1, 'backgrounding during the sleep did not cancel')
  assert.equal(mid.alert.calls.length, 0)
  assert.equal(mid.report.calls.length, 1)

  // C1 DURING the sleep.
  const midUnmount = googleHarness({
    results: [{ data: null, error: retryable(EVENT_B_MESSAGE, 504) }],
    onSleep: () => { midUnmount.isMountedRef.current = false },
  })
  await midUnmount.run()
  assert.equal(midUnmount.exchange.calls.length, 1)
  assert.equal(midUnmount.alert.calls.length, 0)
  assert.equal(midUnmount.report.calls.length, 1)
})

test('AX-D4 — reportNonFatal is BEHAVIOURALLY first: before logger, console, mixpanel and Alert', async () => {
  for (const build of [googleHarness, appleHarness]) {
    const h = build({ results: [{ data: null, error: apiError('bad', 400) }] })
    await h.run()
    const observed = h.order.seq.filter((s) =>
      ['report', 'logger.error', 'console.error', 'mixpanel', 'alert'].includes(s),
    )
    assert.equal(observed[0], 'report', `capture is not the first post-failure call: ${observed.join(' > ')}`)
    assert.equal(observed[observed.length - 1], 'alert', `the alert is not last: ${observed.join(' > ')}`)
  }
})

test('AX-D5 — a recovered retry is INVISIBLE: zero captures, zero alerts, session returned', async () => {
  for (const [build, provider] of [
    [googleHarness, 'google'],
    [appleHarness, 'apple'],
  ] as const) {
    const h = build({
      results: [{ data: null, error: retryable('Network request failed', 0) }, SUCCESS],
    })
    const out = (await h.run()) as { data: unknown; error: unknown }
    assert.equal(h.exchange.calls.length, 2, `${provider}: wrong attempt count`)
    assert.equal(h.report.calls.length, 0, `${provider}: a recovered blip was reported to Sentry`)
    assert.equal(h.alert.calls.length, 0, `${provider}: a recovered blip alerted the user`)
    assert.equal(h.mixpanel.calls.length, 0, `${provider}: a recovered blip logged a login failure`)
    assert.equal(out.error, null)
    assert.ok(out.data, `${provider}: no session returned after recovery`)
  }
})

test('AX-D6 — the capture survives a THROWING Alert and a THROWING i18n', async () => {
  const throwingAlert = googleHarness({
    results: [{ data: null, error: apiError('bad', 400) }],
    alertImpl: () => { throw new Error('RN Alert exploded') },
  })
  await assert.rejects(throwingAlert.run(), /RN Alert exploded/)
  assert.equal(throwingAlert.report.calls.length, 1, 'a throwing Alert lost the #1044 capture')

  const throwingI18n = googleHarness({
    results: [{ data: null, error: apiError('bad', 400) }],
    i18nImpl: { t: () => { throw new Error('i18n not initialised') } },
  })
  await assert.rejects(throwingI18n.run(), /i18n not initialised/)
  assert.equal(throwingI18n.report.calls.length, 1, 'a throwing i18n lost the #1044 capture')
  assert.equal(throwingI18n.alert.calls.length, 0)
})

test('AX-D7 — the picker-cancel path is still silent: no capture, no alert, no token exchange', async () => {
  const h = googleHarness({ providerResult: { type: 'cancelled' } })
  await h.run()
  assert.equal(h.exchange.calls.length, 0)
  assert.equal(h.report.calls.length, 0)
  assert.equal(h.alert.calls.length, 0)
})

// ═════════════════════════════════════════════════════════════════════════════
// AX-E — CANCELLATION RACES
// ═════════════════════════════════════════════════════════════════════════════

test('AX-E1 — unmount WHILE the token exchange is in flight cancels at the next checkpoint', async () => {
  const h = googleHarness({
    results: [{ data: null, error: retryable('boom', 0) }],
    onExchange: (n) => { if (n === 1) h.isMountedRef.current = false },
  })
  await h.run()
  assert.equal(h.exchange.calls.length, 1)
  assert.equal(h.alert.calls.length, 0)
  assert.equal(h.report.calls.length, 1)
})

test('AX-E2 — background THEN RESUME during the sleep must NOT abandon (the checkpoint re-reads)', async () => {
  // If the cancellation flag were captured once instead of re-read, this would
  // wrongly abandon and the user would be left with no feedback at all.
  const h = googleHarness({
    results: [{ data: null, error: retryable(EVENT_B_MESSAGE, 504) }],
    onSleep: () => {
      h.appState.currentState = 'background'
      h.appState.currentState = 'active'
    },
  })
  await h.run()
  assert.equal(h.exchange.calls.length, 3, 'a transient background flicker killed the retry')
  assert.deepEqual(h.alert.calls[0], STATE_3)
})

test('AX-E3 — unmount on the SECOND iteration: 2 attempts, no alert, capture intact', async () => {
  const h = googleHarness({
    results: [{ data: null, error: retryable('boom', 0) }],
    onSleep: (i) => { if (i === 1) h.isMountedRef.current = false },
  })
  await h.run()
  assert.equal(h.exchange.calls.length, 2)
  assert.equal(h.alert.calls.length, 0)
  assert.equal(h.report.calls.length, 1)
})

test('AX-E4 — non-background AppState values never cancel, including null and undefined', async () => {
  for (const state of ['active', 'inactive', 'unknown', 'extension', null, undefined]) {
    const h = googleHarness({ results: [{ data: null, error: retryable('boom', 0) }] })
    ;(h.appState as { currentState: unknown }).currentState = state
    await h.run()
    assert.equal(
      h.exchange.calls.length,
      3,
      `AppState "${String(state)}" spuriously cancelled the retry`,
    )
    assert.deepEqual(h.alert.calls[0], STATE_3)
  }
})

test('AX-E5 — a PERMANENT failure can never be abandoned: the alert always fires', async () => {
  const h = googleHarness({ results: [{ data: null, error: apiError('bad', 400) }] })
  h.appState.currentState = 'background'
  h.isMountedRef.current = false
  await h.run()
  assert.equal(h.exchange.calls.length, 1)
  assert.equal(h.alert.calls.length, 1, 'a permanent failure was silently swallowed')
  assert.deepEqual(h.alert.calls[0], STATE_4)
})

test('AX-E6 — Apple honours the identical cancellation contract', async () => {
  const h = appleHarness({ results: [{ data: null, error: retryable(EVENT_B_MESSAGE, 504) }] })
  h.appState.currentState = 'background'
  await h.run()
  assert.equal(h.exchange.calls.length, 1)
  assert.equal(h.alert.calls.length, 0)
  assert.equal(h.report.calls.length, 1)
})

// ═════════════════════════════════════════════════════════════════════════════
// AX-F — BYTE-LEVEL DIFFERENTIAL AGAINST origin/main
//
// Excise the #1875 regions from both shipped sign-in functions and prove the
// residue is byte-identical to the pre-change source. This is the strongest
// available proof that nothing ELSE in either function moved, and the
// implementor's suite does not attempt it.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The pre-#1875 `useAuthSimple.ts`, pinned by BOTH the commit it lives in and
 * the sha256 of its content.
 *
 * `4bcefcf26656355f05ae740dc0cbd06b4ee9769c` is the direct parent of the
 * #1875 squash merge `892a07fbf7de33567440d9682664da5cb2a42dc9` and remains
 * on durable `main` first-parent history. Its full-file sha256 is the pinned
 * content hash below, so the baseline has both durable provenance and exact-byte
 * identity. `origin/main` and `main` remain diagnostic fallback refs; whichever
 * ref answers, the content hash is what decides whether the bytes are accepted.
 *
 * ─── RE-BASELINING ────────────────────────────────────────────────────────
 * A future, legitimate change to `signInWithGoogle` / `signInWithApple` will
 * turn AX-F1..AX-F3 red. That is the gate working, not a flake. Re-baseline
 * DELIBERATELY, in the same PR, with a `[TEST-MOD-APPROVED #<issue>]` marker —
 * the protocol #1044 established for `PRE_GOOGLE_CATCH` / `PRE_APPLE_CATCH`.
 * Never silence it by loosening the comparison.
 */
const PRE_1875_BASELINE_COMMIT = '4bcefcf26656355f05ae740dc0cbd06b4ee9769c'
const PRE_1875_BASELINE_SHA256 =
  '41a7a7fb52735b862ae3550e7aee090702cffa7dd96bbf36b771c534815ce353'

let baselineCache: string | null = null

const baselineSource = (): string => {
  if (baselineCache !== null) return baselineCache
  const candidates = [PRE_1875_BASELINE_COMMIT, 'origin/main', 'main']
  const notes: string[] = []
  for (const ref of candidates) {
    let text: string
    try {
      text = execFileSync('git', ['show', `${ref}:${HOOK_REPO_RELPATH}`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch (e) {
      notes.push(`${ref}: unavailable (${(e as Error).message.split('\n')[0]})`)
      continue
    }
    const digest = createHash('sha256').update(text).digest('hex')
    if (digest === PRE_1875_BASELINE_SHA256) {
      baselineCache = text
      return text
    }
    notes.push(`${ref}: resolved but sha256 ${digest.slice(0, 12)}… != pinned ${PRE_1875_BASELINE_SHA256.slice(0, 12)}…`)
  }
  assert.fail(
    'AX-F: could not resolve the pinned pre-#1875 baseline of useAuthSimple.ts.\n' +
      '  · If git history is shallow, the workflow checkout needs `fetch-depth: 0`.\n' +
      '  · If a later change legitimately edited this file, RE-BASELINE deliberately\n' +
      '    (new commit SHA + new sha256) with a [TEST-MOD-APPROVED #<issue>] marker.\n' +
      `  Tried:\n    ${notes.join('\n    ')}`,
  )
}

const cutBetween = (src: string, startMarker: string, endMarker: string, label: string): string => {
  const a = src.indexOf(startMarker)
  assert.ok(a > -1, `AX-F excision (${label}): start marker not found: ${startMarker.slice(0, 60)}`)
  const b = src.indexOf(endMarker, a)
  assert.ok(b > a, `AX-F excision (${label}): end marker not found: ${endMarker.slice(0, 60)}`)
  return src.slice(0, a) + src.slice(b)
}

const fnFrom = (src: string, start: string, end: string): string => {
  const a = src.indexOf(start)
  assert.ok(a > -1, `AX-F: ${start} not found`)
  const b = src.indexOf(end, a + 1)
  assert.ok(b > a, `AX-F: ${end} not found after ${start}`)
  return src.slice(a, b)
}

/** Strips exactly the four #1875 insertion regions from one sign-in function. */
const excise1875 = (fn: string, provider: 'google' | 'apple'): string => {
  let out = fn
  // 1 — the pre-`try` declarations (counters + the retryCancelled closure).
  out = cutBetween(out, '    // #1875 [transient-signin-failure] —', '    try {', `${provider} pre-try`)
  // 2 — the bounded retry loop inside the try.
  out = cutBetween(
    out,
    '      // #1875 [transient-signin-failure] — bounded retry of the SUPABASE TOKEN',
    provider === 'google'
      ? '      // Handle case where user already exists'
      : '      if (error) {\n        throw error;\n      }',
    `${provider} retry loop`,
  )
  // 3 — the copy-selection block in the catch, restored to the original Alert.
  const catchStart =
    provider === 'google'
      ? '      // #1875 [transient-signin-failure] — F-4. The user NEVER sees a caught'
      : '      // #1875 [transient-signin-failure] — F-4, Apple half. Same leak, same'
  const catchEnd = '      return { data: null, error };\n    }\n  };'
  const a = out.indexOf(catchStart)
  assert.ok(a > -1, `AX-F excision (${provider} catch): start marker not found`)
  const b = out.indexOf(catchEnd, a)
  assert.ok(b > a, `AX-F excision (${provider} catch): end marker not found`)
  const originalAlert =
    provider === 'google'
      ? '      Alert.alert(\n        "Google Sign-In Failed",\n        error.message || "Unable to sign in with Google. Please try again."\n      );\n'
      : '      Alert.alert(\n        "Apple Sign-In Failed",\n        error.message || "Unable to sign in with Apple. Please try again."\n      );\n'
  out = out.slice(0, a) + originalAlert + out.slice(b)
  // 4 — Apple's destructure was widened from `const` to `let` for reassignment.
  if (provider === 'apple') {
    out = out.replace(
      'let { data, error } = await supabase.auth.signInWithIdToken({\n        provider: "apple",',
      'const { data, error } = await supabase.auth.signInWithIdToken({\n        provider: "apple",',
    )
  }
  return out
}

test('AX-F1 — signInWithGoogle minus the #1875 regions is BYTE-IDENTICAL to origin/main', () => {
  const base = baselineSource()
  const liveFn = fnFrom(HOOK_SOURCE, '  const signInWithGoogle = async () => {', '  const signInWithApple = async () => {')
  const baseFn = fnFrom(base, '  const signInWithGoogle = async () => {', '  const signInWithApple = async () => {')
  const residue = excise1875(liveFn, 'google')
  if (residue !== baseFn) {
    const r = residue.split('\n')
    const b = baseFn.split('\n')
    const diff: string[] = []
    for (let i = 0; i < Math.max(r.length, b.length) && diff.length < 20; i += 1) {
      if (r[i] !== b[i]) diff.push(`  line ${i + 1}\n    origin/main: ${JSON.stringify(b[i])}\n    residue   : ${JSON.stringify(r[i])}`)
    }
    assert.fail(
      '#1875 changed something in signInWithGoogle OUTSIDE its declared regions:\n' + diff.join('\n'),
    )
  }
  // Anti-vacuity: the excision must actually have removed the #1875 work.
  assert.ok(!/#1875/.test(residue), 'excision left #1875 markers behind')
  assert.ok(!/classifyAuthFailure|i18n\.t\(|transportRetryAttempts/.test(residue))
  assert.ok(liveFn.length - residue.length > 1500, 'excision removed suspiciously little')
})

test('AX-F2 — signInWithApple minus the #1875 regions is BYTE-IDENTICAL to origin/main', () => {
  const base = baselineSource()
  const liveFn = fnFrom(HOOK_SOURCE, '  const signInWithApple = async () => {', '  return {\n    user,')
  const baseFn = fnFrom(base, '  const signInWithApple = async () => {', '  return {\n    user,')
  const residue = excise1875(liveFn, 'apple')
  if (residue !== baseFn) {
    const r = residue.split('\n')
    const b = baseFn.split('\n')
    const diff: string[] = []
    for (let i = 0; i < Math.max(r.length, b.length) && diff.length < 20; i += 1) {
      if (r[i] !== b[i]) diff.push(`  line ${i + 1}\n    origin/main: ${JSON.stringify(b[i])}\n    residue   : ${JSON.stringify(r[i])}`)
    }
    assert.fail(
      '#1875 changed something in signInWithApple OUTSIDE its declared regions:\n' + diff.join('\n'),
    )
  }
  assert.ok(!/#1875/.test(residue), 'excision left #1875 markers behind')
  assert.ok(liveFn.length - residue.length > 1000, 'excision removed suspiciously little')
})

test('AX-F3 — everything ELSE in useAuthSimple.ts is byte-identical to origin/main', () => {
  // Guards against a drive-by edit somewhere outside the two sign-in functions —
  // e.g. the sign-out or profile-update paths, which render error.message and
  // were deliberately left alone.
  const base = baselineSource()
  const cutFns = (src: string): string => {
    const a = src.indexOf('  const signInWithGoogle = async () => {')
    const b = src.indexOf('  return {\n    user,')
    assert.ok(a > -1 && b > a)
    return src.slice(0, a) + src.slice(b)
  }
  const liveRest = cutFns(HOOK_SOURCE)
  const baseRest = cutFns(base)
  // The declared out-of-function #1875 additions, excised.
  let residue = liveRest
  residue = residue.replace(
    'import { useState, useEffect, useRef } from "react";\nimport { Alert, AppState, Platform } from "react-native";',
    'import { useState, useEffect } from "react";\nimport { Alert, Platform } from "react-native";',
  )
  residue = cutBetween(residue, '// #1875 [transient-signin-failure] — user-facing sign-in failure copy is read', '\n\n// Module-level flag', 'imports')
  residue = cutBetween(residue, '/**\n * #1875 [transient-signin-failure] —', 'export const useAuthSimple = () => {', 'classifier block')
  residue = cutBetween(residue, '  // #1875 [transient-signin-failure] — cancellation checkpoint C1 for the', '\n  // Add timeout to prevent infinite loading', 'isMountedRef decl')
  residue = cutBetween(residue, '    // #1875 — re-arm on (re)mount.', '\n    const initializeAuth', 're-arm')
  residue = cutBetween(residue, '      // #1875 — C1: stop any in-flight bounded transport retry.', '      subscription.unsubscribe();', 'cleanup')
  if (residue !== baseRest) {
    const r = residue.split('\n')
    const b = baseRest.split('\n')
    const diff: string[] = []
    for (let i = 0; i < Math.max(r.length, b.length) && diff.length < 20; i += 1) {
      if (r[i] !== b[i]) diff.push(`  line ${i + 1}\n    origin/main: ${JSON.stringify(b[i])}\n    residue   : ${JSON.stringify(r[i])}`)
    }
    assert.fail('#1875 touched useAuthSimple.ts outside the two sign-in functions:\n' + diff.join('\n'))
  }
  assert.ok(!/#1875/.test(residue), 'excision left #1875 markers behind')
})

test('AX-F4 — the retry loop is on the LIVE path, wrapping the REAL token exchange (anti-dead-code)', () => {
  for (const [provider, fn] of [
    ['google', googleFnBody()],
    ['apple', appleFnBody()],
  ] as const) {
    const loopAt = fn.indexOf('while (')
    const catchAt = fn.indexOf('} catch (err)')
    const exchangeAt = fn.indexOf('supabase.auth.signInWithIdToken')
    assert.ok(loopAt > -1, `${provider}: no retry loop`)
    assert.ok(catchAt > loopAt, `${provider}: the retry loop is inside the catch, not the try`)
    assert.ok(exchangeAt > -1 && exchangeAt < loopAt, `${provider}: the loop precedes the first exchange`)
    const loopSrc = fn.slice(loopAt, catchAt)
    assert.ok(
      /supabase\.auth\.signInWithIdToken/.test(loopSrc),
      `${provider}: the loop does not re-issue the real token exchange`,
    )
    assert.ok(
      !/GoogleSignin\.signIn\(|AppleAuthentication\.signInAsync\(/.test(loopSrc),
      `${provider}: the loop re-invokes the PROVIDER leg — the picker would be re-presented`,
    )
    // No unreachable guard smuggled in front of the loop.
    assert.ok(!/if \(false\)|if \(__DEV__\)|return;\s*while \(/.test(loopSrc))
  }
})

test('AX-F5 — the catch contains no retry and defers nothing', () => {
  for (const [provider, body] of [
    ['google', googleCatch()],
    ['apple', appleCatch()],
  ] as const) {
    assert.ok(!/while \(/.test(body), `${provider}: a retry loop leaked into the catch`)
    assert.ok(!/setTimeout|setInterval/.test(body), `${provider}: the catch defers work`)
    assert.ok(!/\$\{/.test(body.slice(body.indexOf('Alert.alert(i18n.t('))), `${provider}: interpolation near the alert`)
  }
})

test('AX-F6 — the pinned baseline has durable main-line provenance and exact bytes', () => {
  const squashMerge = '892a07fbf7de33567440d9682664da5cb2a42dc9'
  const gitText = (...args: string[]): string =>
    execFileSync('git', args, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

  const mainRef = ['origin/main', 'main'].find((ref) => {
    try {
      gitText('rev-parse', '--verify', `${ref}^{commit}`)
      return true
    } catch {
      return false
    }
  })
  assert.ok(mainRef, 'AX-F6: neither origin/main nor main resolves to a durable main commit')

  assert.doesNotThrow(
    () => gitText('merge-base', '--is-ancestor', PRE_1875_BASELINE_COMMIT, mainRef),
    `AX-F6: pinned baseline ${PRE_1875_BASELINE_COMMIT} is not an ancestor of ${mainRef}`,
  )
  assert.equal(
    gitText('rev-parse', `${squashMerge}^`),
    PRE_1875_BASELINE_COMMIT,
    'AX-F6: pinned baseline is not the direct parent of the #1875 squash merge',
  )

  const pinnedBytes = execFileSync(
    'git',
    ['show', `${PRE_1875_BASELINE_COMMIT}:${HOOK_REPO_RELPATH}`],
    {
      cwd: REPO_ROOT,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  assert.equal(
    createHash('sha256').update(pinnedBytes).digest('hex'),
    PRE_1875_BASELINE_SHA256,
    'AX-F6: durable baseline bytes no longer match the pinned full-file sha256',
  )
})
