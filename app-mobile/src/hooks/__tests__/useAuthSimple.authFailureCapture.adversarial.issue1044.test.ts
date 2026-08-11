/**
 * #1044 [auth-failure-sentry-capture] — TESTER ADVERSARIAL suite, CONSUMER side
 * (P3 `signInWithGoogle` native catch, P4 `signInWithApple` native catch).
 *
 * Runs under Node's built-in test runner with type-stripping (no jest in this
 * app), matching the precedent in `useLaunchCityGate.test.ts`:
 *   node --experimental-strip-types --test \
 *     src/hooks/__tests__/useAuthSimple.authFailureCapture.adversarial.issue1044.test.ts
 *
 * DIFFERENT ANGLE FROM THE IMPLEMENTOR'S SUITE. Theirs asserts the post-change
 * body against hand-written expectations. This one never writes down what the
 * Alert copy "should" be — it runs a DIFFERENTIAL against the frozen
 * `origin/main` body:
 *
 *   1. slice the REAL shipped catch body out of useAuthSimple.ts;
 *   2. programmatically EXCISE the inserted `if (shouldReportAuthFailure(code))`
 *      block;
 *   3. assert the residue is BYTE-IDENTICAL to origin/main (a byte-level proof
 *      of "additive only" — stronger than a +N/−0 numstat, which cannot detect
 *      a line moved between a branch and its Alert);
 *   4. execute both bodies over one input matrix and assert identical Alerts,
 *      identical logger/console/Mixpanel calls, and identical return values.
 *
 * Plus SDK-realistic exotic rejections and reporter-breakage modes the
 * implementor's suite does not construct.
 *
 * Append-only. No product code was modified to make anything here pass.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(HERE, "..", "useAuthSimple.ts"), "utf8");
const HELPER_SOURCE = fs.readFileSync(
  path.join(HERE, "..", "..", "diagnostics", "reportNonFatal.ts"),
  "utf8",
);

// ─────────────────────────────────────────────────────────────────────────────
// Frozen pre-CAPTURE bodies.
//
// [TEST-MOD-APPROVED #1875] — SPEC §9.2, differential-baseline amendment.
//
// These two strings are the differential baseline for A1/A2 (byte-level "the
// #1044 capture block is purely additive") and A4/A5 (behavioural differential).
// They were frozen verbatim from
//   git show origin/main:app-mobile/src/hooks/useAuthSimple.ts
// at #1044 time, when "origin/main" and "the shipped body minus the capture
// block" were the same text.
//
// #1875 deliberately changed the user-facing Alert in both catch blocks — F-4:
// `Alert.alert("<Provider> Sign-In Failed", error.message)` rendered
// `JSON.stringify(Response)`, including our Supabase project URL and a blob id,
// to the user — and added a retry-aware copy selection. That text is therefore
// no longer equal to origin/main, and holding these strings at the pre-#1875
// copy would pin the very defect #1875 removes.
//
// So they are rebaselined to the CURRENT shipped catch bodies MINUS the #1044
// capture block, which is exactly what A1/A2's `exciseCaptureBlock` produces.
// A1/A2's real purpose is preserved byte-for-byte: they still prove the #1044
// capture block is purely additive and that nothing else in either catch moved.
// A4/A5's differential is likewise preserved — and its logger / console /
// Mixpanel / return-value assertions are NOT relaxed by this change.
// ─────────────────────────────────────────────────────────────────────────────

const PRE_GOOGLE_CATCH = `      const error = err instanceof Error ? err : new Error(String(err));
      const code = (err as { code?: unknown })?.code;
      logger.error('Google sign-in failed', { code, message: error.message });
      console.error("Google sign-in error:", code, error.message, err);
      mixpanelService.trackLoginFailed('google', error.message);

      // Handle specific error cases
      if (code === statusCodes.SIGN_IN_CANCELLED) {
        return { data: null, error: { message: "Sign-in cancelled" } };
      } else if (code === statusCodes.IN_PROGRESS) {
        return {
          data: null,
          error: { message: "Sign-in already in progress" },
        };
      } else if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert(
          "Google Play Services Required",
          "Google Play Services is not available. Please install it from the Play Store."
        );
        return {
          data: null,
          error: { message: "Google Play Services not available" },
        };
      }

      // #1875 [transient-signin-failure] — F-4. The user NEVER sees a caught
      // error's value again. \`error.message\` here is whatever auth-js put in it;
      // for a 502/503/504 that is JSON.stringify(Response), carrying our Supabase
      // project URL and a blob id. Every string below is a fixed i18n key, never
      // an interpolation, never a concatenation. The full original message still
      // reaches Sentry via the #1044 capture above, unchanged.
      if (retryAbandoned) {
        // The user backgrounded the app or the screen went away mid-retry.
        // Suppress the modal ONLY — the capture, logger, console and Mixpanel
        // calls above all already fired, and the return value is unchanged.
        return { data: null, error };
      }
      const failure = classifyAuthFailure(
        error.name,
        code,
        (err as { status?: unknown })?.status,
        error.message,
        Platform.OS,
      );
      let alertTitleKey = "auth:welcome.sign_in_failed_title";
      let alertBodyKey = "auth:welcome.sign_in_permanent_body";
      if (failure !== "permanent") {
        if (transportRetryAttempts > 0) {
          alertTitleKey = "auth:welcome.sign_in_retry_exhausted_title";
          alertBodyKey = "auth:welcome.sign_in_retry_exhausted_body";
        } else if (failure === "transient-transport-offline") {
          alertTitleKey = "auth:welcome.sign_in_offline_title";
          alertBodyKey = "auth:welcome.sign_in_offline_body";
        } else {
          alertBodyKey = "auth:welcome.sign_in_failed_body";
        }
      }
      // Single button on purpose. Alert.alert is fire-and-forget, so
      // WelcomeScreen's finally has already re-enabled the button by the time
      // this renders — a "Try again" onPress would re-enter sign-in with no busy
      // state and no disabled button, inviting GMS IN_PROGRESS (12502). The
      // correctly-wired affordance is the Continue button itself, which every
      // string points the user back at.
      Alert.alert(i18n.t(alertTitleKey), i18n.t(alertBodyKey), [
        { text: i18n.t("auth:welcome.sign_in_failed_ok") },
      ]);
      return { data: null, error };`;

const PRE_APPLE_CATCH = `      const error = err instanceof Error ? err : new Error(String(err));
      const code = (err as { code?: unknown })?.code;

      // Handle specific error cases
      if (code === "ERR_REQUEST_CANCELED") {
        if (__DEV__) logger.auth('Apple sign-in cancelled by user');
        return { data: null, error: { message: "Sign-in cancelled" } };
      }

      logger.error('Apple sign-in failed', { code, message: error.message });
      console.error("Apple sign-in error:", err);
      mixpanelService.trackLoginFailed('apple', error.message);

      // #1875 [transient-signin-failure] — F-4, Apple half. Same leak, same
      // signInWithIdToken leg, same fix. Copy is provider-neutral so both paths
      // share it. See the Google block above for the full rationale.
      if (retryAbandoned) {
        return { data: null, error };
      }
      const failure = classifyAuthFailure(
        error.name,
        code,
        (err as { status?: unknown })?.status,
        error.message,
        Platform.OS,
      );
      let alertTitleKey = "auth:welcome.sign_in_failed_title";
      let alertBodyKey = "auth:welcome.sign_in_permanent_body";
      if (failure !== "permanent") {
        if (transportRetryAttempts > 0) {
          alertTitleKey = "auth:welcome.sign_in_retry_exhausted_title";
          alertBodyKey = "auth:welcome.sign_in_retry_exhausted_body";
        } else if (failure === "transient-transport-offline") {
          alertTitleKey = "auth:welcome.sign_in_offline_title";
          alertBodyKey = "auth:welcome.sign_in_offline_body";
        } else {
          alertBodyKey = "auth:welcome.sign_in_failed_body";
        }
      }
      Alert.alert(i18n.t(alertTitleKey), i18n.t(alertBodyKey), [
        { text: i18n.t("auth:welcome.sign_in_failed_ok") },
      ]);
      return { data: null, error };`;

// ─────────────────────────────────────────────────────────────────────────────
// Slicing + excision
// ─────────────────────────────────────────────────────────────────────────────

const eraseTypeAssertions = (src: string): string =>
  src.replace(/\(err as \{[^}]*\}\)/g, "(err)");

const CATCH_RE = /\} catch \(err: unknown\) \{\n([\s\S]*?)\n {4}\}\n {2}\};/;

const sliceFn = (start: string, end: string): string => {
  const a = SOURCE.indexOf(start);
  const b = SOURCE.indexOf(end);
  assert.ok(a > -1, `missing ${start}`);
  assert.ok(b > a, `missing ${end}`);
  const m = SOURCE.slice(a, b).match(CATCH_RE);
  assert.ok(m, `no catch body in ${start}`);
  return m![1];
};

const liveGoogleCatch = (): string =>
  sliceFn("const signInWithGoogle", "const signInWithApple");
const liveAppleCatch = (): string =>
  sliceFn("const signInWithApple", "\n  return {\n    user,");

const exciseCaptureBlock = (body: string): string => {
  const lines = body.split("\n");
  const startIdx = lines.findIndex((l) => l.trim().startsWith("// #1044"));
  assert.ok(startIdx > -1, "no #1044 banner in the sliced body");
  const guardIdx = lines.findIndex((l) =>
    l.includes("if (shouldReportAuthFailure(code)) {"),
  );
  assert.ok(guardIdx > startIdx, "no shouldReportAuthFailure guard");
  let closeIdx = -1;
  for (let i = guardIdx + 1; i < lines.length; i += 1) {
    if (lines[i] === "      }") {
      closeIdx = i;
      break;
    }
  }
  assert.ok(closeIdx > guardIdx, "guard block never closes");
  let endIdx = closeIdx;
  if (lines[closeIdx + 1] === "") endIdx = closeIdx + 1;
  return [...lines.slice(0, startIdx), ...lines.slice(endIdx + 1)].join("\n");
};

// ─────────────────────────────────────────────────────────────────────────────
// Execution harness
// ─────────────────────────────────────────────────────────────────────────────

interface Recorder {
  alerts: unknown[][];
  reports: unknown[][];
  loggerCalls: unknown[][];
  consoleCalls: unknown[][];
  mixpanelCalls: unknown[][];
}

const ANDROID_STATUS_CODES: Record<string, string | undefined> = {
  SIGN_IN_CANCELLED: "12501",
  IN_PROGRESS: "ASYNC_OP_IN_PROGRESS",
  PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
  SIGN_IN_REQUIRED: "4",
  // app-mobile ships google-signin 16.0.0 — NULL_PRESENTER does NOT exist here.
};

const IOS_STATUS_CODES: Record<string, string | undefined> = {
  SIGN_IN_CANCELLED: "-5",
  IN_PROGRESS: "ASYNC_OP_IN_PROGRESS",
  PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
  SIGN_IN_REQUIRED: "-4",
};

const REAL_CLIENT_ID =
  "169132274606-hp7cne780gsp7s6l1rrvbfktp6smrfs0.apps.googleusercontent.com";

const compilePredicate = (
  statusCodes: Record<string, string | undefined>,
): ((code: unknown) => boolean) => {
  const m = SOURCE.match(
    /const shouldReportAuthFailure = \(code: unknown\): boolean => \{\n([\s\S]*?)\n\};/,
  );
  assert.ok(m, "shouldReportAuthFailure not found in shipped source");
  const make = new Function(
    "statusCodes",
    `"use strict"; return function (code) {\n${m![1]}\n};`,
  ) as (
    sc: Record<string, string | undefined>,
  ) => (code: unknown) => boolean;
  return make(statusCodes);
};

/**
 * [TEST-MOD-APPROVED #1875] — SPEC §9.2, dependency-map amendment ONLY.
 * The REAL compiled `classifyAuthFailure` body from the shipped source (never a
 * retyped copy — ORCH-1373 P2-2), injected because both catch bodies now call it
 * and a free identifier is a `ReferenceError` under `new Function`.
 */
const compileClassifier = (): ((
  errName: unknown,
  errCode: unknown,
  errStatus: unknown,
  errMessage: unknown,
  platformOS: string,
) => string) => {
  const m = SOURCE.match(
    /const classifyAuthFailure = \([\s\S]*?\): AuthFailureClass => \{\n([\s\S]*?)\n\};/,
  );
  assert.ok(m, "classifyAuthFailure not found in shipped source");
  return new Function(
    `"use strict"; return function (errName, errCode, errStatus, errMessage, platformOS) {\n${m![1]}\n};`,
  )() as (
    errName: unknown,
    errCode: unknown,
    errStatus: unknown,
    errMessage: unknown,
    platformOS: string,
  ) => string;
};

/**
 * [TEST-MOD-APPROVED #1875] — SPEC §9.2, dependency-map amendment ONLY.
 * Key-echoing stub. This suite is a DIFFERENTIAL: both sides get the same stub,
 * so it cannot mask drift. Rendered English is pinned by the #1875 suite.
 */
const I18N_STUB = { t: (k: string): string => k };

interface RunOpts {
  statusCodes?: Record<string, string | undefined>;
  webClientId?: unknown;
  reportNonFatal?: (...a: unknown[]) => void;
  /** [TEST-MOD-APPROVED #1875] — #1875 retry state, free in a CATCH-ONLY slice. */
  transportRetryAttempts?: number;
  retryAbandoned?: boolean;
}

const run = (
  body: string,
  err: unknown,
  opts: RunOpts = {},
): { ret: unknown; rec: Recorder } => {
  const statusCodes = opts.statusCodes ?? ANDROID_STATUS_CODES;
  const rec: Recorder = {
    alerts: [],
    reports: [],
    loggerCalls: [],
    consoleCalls: [],
    mixpanelCalls: [],
  };
  const fn = new Function(
    "err",
    "Alert",
    "statusCodes",
    "shouldReportAuthFailure",
    "reportNonFatal",
    "Platform",
    "webClientId",
    "logger",
    "console",
    "mixpanelService",
    "__DEV__",
    // [TEST-MOD-APPROVED #1875] — SPEC §9.2 dep-map entries. `transportRetryAttempts`
    // and `retryAbandoned` are declared before `try {` in the shipped functions and
    // are therefore free identifiers in a catch-only slice; both sides of the
    // differential receive identical values, so nothing can be masked.
    "classifyAuthFailure",
    "i18n",
    "transportRetryAttempts",
    "retryAbandoned",
    `"use strict";\n${eraseTypeAssertions(body)}`,
  ) as (...a: unknown[]) => unknown;

  const ret = fn(
    err,
    { alert: (...a: unknown[]) => rec.alerts.push(a) },
    statusCodes,
    compilePredicate(statusCodes),
    opts.reportNonFatal ?? ((...a: unknown[]) => rec.reports.push(a)),
    { OS: "android", Version: 34 },
    "webClientId" in opts ? opts.webClientId : REAL_CLIENT_ID,
    {
      error: (...a: unknown[]) => rec.loggerCalls.push(["error", ...a]),
      auth: (...a: unknown[]) => rec.loggerCalls.push(["auth", ...a]),
    },
    { error: (...a: unknown[]) => rec.consoleCalls.push(a), warn: () => {} },
    {
      trackLoginFailed: (...a: unknown[]) => rec.mixpanelCalls.push(a),
    },
    false,
    // [TEST-MOD-APPROVED #1875] — SPEC §9.2 dep-map values, positionally matching
    // the four parameter names added above.
    compileClassifier(),
    I18N_STUB,
    opts.transportRetryAttempts ?? 0,
    opts.retryAbandoned ?? false,
  );
  return { ret, rec };
};

const withCode = (message: string, code: unknown): Error => {
  const e = new Error(message);
  (e as unknown as Record<string, unknown>).code = code;
  return e;
};

const safeJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    typeof x === "bigint" || typeof x === "symbol" ? String(x) : x,
  ) ?? "undefined";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A — byte-level "additive only" proof
// ─────────────────────────────────────────────────────────────────────────────

test("A1 — excising the capture block from the SHIPPED P3 Google catch reproduces origin/main byte-for-byte", () => {
  assert.equal(exciseCaptureBlock(liveGoogleCatch()), PRE_GOOGLE_CATCH);
});

test("A2 — excising the capture block from the SHIPPED P4 Apple catch reproduces origin/main byte-for-byte", () => {
  assert.equal(exciseCaptureBlock(liveAppleCatch()), PRE_APPLE_CATCH);
});

test("A3 — the inserted block contains no return/throw/await/reassignment/deferral", () => {
  for (const body of [liveGoogleCatch(), liveAppleCatch()]) {
    const lines = body.split("\n");
    const start = lines.findIndex((l) =>
      l.includes("if (shouldReportAuthFailure(code)) {"),
    );
    let close = -1;
    for (let i = start + 1; i < lines.length; i += 1) {
      if (lines[i] === "      }") {
        close = i;
        break;
      }
    }
    const block = lines
      .slice(start, close + 1)
      .join("\n")
      .replace(/\/\/.*$/gm, "");
    assert.ok(!/\breturn\b/.test(block), "return inside the capture guard");
    assert.ok(!/\bthrow\b/.test(block), "throw inside the capture guard");
    assert.ok(!/\bawait\b/.test(block), "await inside the capture guard");
    assert.ok(
      !/setTimeout|requestAnimationFrame|flush\(|close\(/.test(block),
      "deferral/network call inside the capture guard",
    );
    assert.ok(
      !/^\s*(error|code|err|data)\s*=[^=]/m.test(block),
      "reassignment inside the capture guard",
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A' — differential execution
// ─────────────────────────────────────────────────────────────────────────────

const MATRIX: Array<{ name: string; make: () => unknown }> = [
  { name: "Google DEVELOPER_ERROR (string code)", make: () => withCode("DEVELOPER_ERROR", "10") },
  { name: "Android cancel (12501)", make: () => withCode("cancelled", "12501") },
  { name: "IN_PROGRESS double-tap", make: () => withCode("in progress", "ASYNC_OP_IN_PROGRESS") },
  { name: "no Play Services", make: () => withCode("no gms", "PLAY_SERVICES_NOT_AVAILABLE") },
  { name: "Apple cancel", make: () => withCode("The user canceled", "ERR_REQUEST_CANCELED") },
  { name: "codeless (#1038 class)", make: () => new Error("Failed to create session") },
  { name: "codeless — failed to get id token", make: () => new Error("Failed to get ID token from Google") },
  { name: "numeric code 10", make: () => withCode("DEVELOPER_ERROR", 10) },
  { name: "null code", make: () => withCode("boom", null) },
  { name: "explicit undefined code", make: () => withCode("boom", undefined) },
  { name: "Symbol code", make: () => withCode("boom", Symbol("SIGN_IN_CANCELLED")) },
  { name: "BigInt code", make: () => withCode("boom", BigInt(12501)) },
  { name: "empty-string code", make: () => withCode("boom", "") },
  { name: "SIGN_IN_REQUIRED", make: () => withCode("sign in required", "4") },
  { name: "NULL_PRESENTER (absent from this app's SDK)", make: () => withCode("np", "NULL_PRESENTER") },
  { name: "bare-string rejection", make: () => "boom" },
  { name: "plain object, no message", make: () => ({}) },
  { name: "plain object carrying only a code", make: () => ({ code: "10" }) },
  { name: "frozen error", make: () => Object.freeze(withCode("DEVELOPER_ERROR", "10")) },
  { name: "sealed error", make: () => Object.seal(withCode("DEVELOPER_ERROR", "10")) },
  {
    name: "message CONTAINS 'cancel' but the code is a real failure",
    make: () => withCode("cancelled by DEVELOPER_ERROR handler", "10"),
  },
  {
    name: "code exposed via a getter",
    make: () => {
      const e = new Error("DEVELOPER_ERROR");
      Object.defineProperty(e, "code", { get: () => "10", enumerable: true });
      return e;
    },
  },
  { name: "String object code", make: () => withCode("boom", new String("12501")) },
];

for (const c of MATRIX) {
  test(`A4 [P3 Google] ${c.name} — Alerts, logger, console, Mixpanel and return value are identical to origin/main`, () => {
    for (const sc of [ANDROID_STATUS_CODES, IOS_STATUS_CODES]) {
      const pre = run(PRE_GOOGLE_CATCH, c.make(), { statusCodes: sc });
      const live = run(liveGoogleCatch(), c.make(), { statusCodes: sc });
      assert.deepEqual(live.rec.alerts, pre.rec.alerts, "Alert drift");
      assert.deepEqual(
        safeJson(live.rec.loggerCalls),
        safeJson(pre.rec.loggerCalls),
        "logger drift",
      );
      assert.deepEqual(
        safeJson(live.rec.consoleCalls),
        safeJson(pre.rec.consoleCalls),
        "console.error drift",
      );
      assert.deepEqual(
        live.rec.mixpanelCalls,
        pre.rec.mixpanelCalls,
        "Mixpanel drift",
      );
      assert.equal(safeJson(live.ret), safeJson(pre.ret), "return-value drift");
    }
  });

  test(`A5 [P4 Apple] ${c.name} — Alerts, logger, console, Mixpanel and return value are identical to origin/main`, () => {
    const pre = run(PRE_APPLE_CATCH, c.make());
    const live = run(liveAppleCatch(), c.make());
    assert.deepEqual(live.rec.alerts, pre.rec.alerts, "Alert drift");
    assert.deepEqual(
      safeJson(live.rec.loggerCalls),
      safeJson(pre.rec.loggerCalls),
      "logger drift",
    );
    assert.deepEqual(
      live.rec.mixpanelCalls,
      pre.rec.mixpanelCalls,
      "Mixpanel drift",
    );
    assert.equal(safeJson(live.ret), safeJson(pre.ret), "return-value drift");
  });
}

test("A6 — a rejection whose toString() throws fails IDENTICALLY before and after (no new hazard)", () => {
  const hostile = () => ({
    toString() {
      throw new Error("hostile toString");
    },
  });
  const grab = (body: string) => {
    try {
      run(body, hostile());
      return null;
    } catch (x) {
      return (x as Error).message;
    }
  };
  assert.equal(grab(liveGoogleCatch()), grab(PRE_GOOGLE_CATCH));
  assert.equal(grab(liveAppleCatch()), grab(PRE_APPLE_CATCH));
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B — polarity
// ─────────────────────────────────────────────────────────────────────────────

test("B1 — every not-provably-normal code is REPORTED (16 shapes, both platform constant sets)", () => {
  const mustReport: unknown[] = [
    10,
    12501,
    null,
    undefined,
    Symbol("SIGN_IN_CANCELLED"),
    BigInt(12501),
    "",
    new String("12501"),
    false,
    NaN,
    { toString: () => "12501" },
    ["12501"],
    "10",
    "4",
    "NULL_PRESENTER",
    "SOME_NEW_CODE_2027",
  ];
  for (const sc of [ANDROID_STATUS_CODES, IOS_STATUS_CODES]) {
    const p = compilePredicate(sc);
    for (const code of mustReport) {
      assert.equal(p(code), true, `code ${String(code)} was NOT reported`);
    }
  }
});

test("B2 — exactly four codes are excluded, per platform constant set", () => {
  for (const sc of [ANDROID_STATUS_CODES, IOS_STATUS_CODES]) {
    const p = compilePredicate(sc);
    const excluded = [
      sc.SIGN_IN_CANCELLED,
      sc.IN_PROGRESS,
      sc.PLAY_SERVICES_NOT_AVAILABLE,
      "ERR_REQUEST_CANCELED",
    ];
    for (const code of [
      ...excluded,
      sc.SIGN_IN_REQUIRED,
      "10",
      "8",
      "ERR_INVALID_RESPONSE",
      "NULL_PRESENTER",
    ]) {
      assert.equal(
        p(code),
        !excluded.includes(code as string),
        `wrong polarity for ${String(code)}`,
      );
    }
  }
});

test("B3 — the predicate reads statusCodes, not integers: Android's cancel code is NOT excluded under iOS constants", () => {
  const ios = compilePredicate(IOS_STATUS_CODES);
  assert.equal(ios("-5"), false);
  assert.equal(ios("12501"), true);
});

test("B4 — with EVERY excluded constant undefined (16.0.0 has no NULL_PRESENTER), codeless errors are STILL reported", () => {
  const p = compilePredicate({
    SIGN_IN_CANCELLED: undefined,
    IN_PROGRESS: undefined,
    PLAY_SERVICES_NOT_AVAILABLE: undefined,
    SIGN_IN_REQUIRED: undefined,
    NULL_PRESENTER: undefined,
  });
  for (const code of [undefined, null, "10", "12501"]) {
    assert.equal(p(code), true, `undefined-constants swallow for ${String(code)}`);
  }
});

test("B5 — undefined constants degrade to OVER-reporting (noise), never to blindness", () => {
  const p = compilePredicate({
    SIGN_IN_CANCELLED: undefined,
    IN_PROGRESS: undefined,
    PLAY_SERVICES_NOT_AVAILABLE: undefined,
  });
  assert.equal(p("12501"), true);
  assert.equal(p("ASYNC_OP_IN_PROGRESS"), true);
  assert.equal(p("ERR_REQUEST_CANCELED"), false); // hardcoded Apple literal survives
});

test("B6 — this app's SDK genuinely lacks NULL_PRESENTER, and that absence is harmless here", () => {
  const pkg = JSON.parse(
    fs.readFileSync(
      path.join(
        HERE,
        "..",
        "..",
        "..",
        "node_modules",
        "@react-native-google-signin",
        "google-signin",
        "package.json",
      ),
      "utf8",
    ),
  ) as { version: string };
  assert.equal(pkg.version, "16.0.0");
  const codes = fs.readFileSync(
    path.join(
      HERE,
      "..",
      "..",
      "..",
      "node_modules",
      "@react-native-google-signin",
      "google-signin",
      "lib",
      "module",
      "errors",
      "errorCodes.js",
    ),
    "utf8",
  );
  assert.ok(
    !/NULL_PRESENTER/.test(codes),
    "16.0.0 unexpectedly exposes NULL_PRESENTER — re-check the F-7 trap",
  );
  // …and the predicate never references it, so the absence cannot swallow.
  assert.ok(!/NULL_PRESENTER/.test(SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")));
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION C — break the reporter
// ─────────────────────────────────────────────────────────────────────────────

const BREAKAGES: Array<[string, () => never | unknown]> = [
  [
    "throws an Error",
    () => {
      throw new Error("sentry exploded");
    },
  ],
  [
    "throws a non-Error",
    () => {
      throw "sentry exploded";
    },
  ],
  ["returns undefined", () => undefined],
  ["returns null", () => null],
  ["hangs (returns a never-settling promise)", () => new Promise(() => {})],
];

for (const [label, impl] of BREAKAGES) {
  test(`C1 [P3 Google] the REAL helper with captureException that ${label} — sign-in is untouched`, async () => {
    const { reportNonFatal } = await loadRealHelper(impl);
    const err = withCode("DEVELOPER_ERROR", "10");
    const pre = run(PRE_GOOGLE_CATCH, err);
    let threw: unknown = null;
    let live: { ret: unknown; rec: Recorder } | null = null;
    try {
      live = run(liveGoogleCatch(), err, { reportNonFatal });
    } catch (x) {
      threw = x;
    }
    assert.equal(threw, null, "the reporter escaped into the auth path");
    assert.deepEqual(live!.rec.alerts, pre.rec.alerts);
    assert.equal(safeJson(live!.ret), safeJson(pre.ret));
  });

  test(`C2 [P4 Apple] the REAL helper with captureException that ${label} — sign-in is untouched`, async () => {
    const { reportNonFatal } = await loadRealHelper(impl);
    const err = withCode("ERR_INVALID_RESPONSE", "ERR_INVALID_RESPONSE");
    const pre = run(PRE_APPLE_CATCH, err);
    let threw: unknown = null;
    let live: { ret: unknown; rec: Recorder } | null = null;
    try {
      live = run(liveAppleCatch(), err, { reportNonFatal });
    } catch (x) {
      threw = x;
    }
    assert.equal(threw, null);
    assert.deepEqual(live!.rec.alerts, pre.rec.alerts);
    assert.equal(safeJson(live!.ret), safeJson(pre.ret));
  });
}

/**
 * Compile the REAL shipped helper body with an injected `captureException`.
 * `@sentry/react-native` cannot be imported in this harness (native module), so
 * the body is sliced from the real file and executed — the same idiom the rest
 * of this suite uses. Line-delete the helper's try/catch and C1/C2 fail.
 */
async function loadRealHelper(
  captureImpl: () => unknown,
): Promise<{ reportNonFatal: (...a: unknown[]) => void; captures: unknown[][] }> {
  const m = HELPER_SOURCE.match(
    /export function reportNonFatal\([\s\S]*?\n\): void \{\n([\s\S]*)\n\}\n?$/,
  );
  assert.ok(m, "reportNonFatal body not found in the shipped helper");
  const captures: unknown[][] = [];
  const make = new Function(
    "captureException",
    "console",
    `"use strict"; return function reportNonFatal(scope, error, extra, fingerprint) {\n${m![1]}\n};`,
  ) as (
    c: (...a: unknown[]) => unknown,
    con: unknown,
  ) => (...a: unknown[]) => void;
  return {
    captures,
    reportNonFatal: make(
      (...a: unknown[]) => {
        captures.push(a);
        return captureImpl();
      },
      { warn: () => {}, error: () => {} },
    ),
  };
}

test("C3 [FINDING P3] — the helper never consumes captureException's return value (a promise-returning SDK would leak a rejection)", async () => {
  let thenCalls = 0;
  let catchCalls = 0;
  const { reportNonFatal } = await loadRealHelper(() => ({
    then: () => {
      thenCalls += 1;
    },
    catch: () => {
      catchCalls += 1;
    },
  }));
  run(liveGoogleCatch(), withCode("DEVELOPER_ERROR", "10"), { reportNonFatal });
  assert.equal(thenCalls, 0);
  assert.equal(catchCalls, 0);
});

test("C4 — the capture is fully synchronous: it completes before any microtask runs", async () => {
  let tick = 0;
  let capturedAt = -1;
  const { reportNonFatal } = await loadRealHelper(() => {
    capturedAt = tick;
    return "event-id";
  });
  void Promise.resolve().then(() => {
    tick = 1;
  });
  run(liveGoogleCatch(), withCode("DEVELOPER_ERROR", "10"), { reportNonFatal });
  assert.equal(capturedAt, 0);
  assert.equal(tick, 0);
});

test("C5 — the REAL helper swallows a throwing captureException and still console.warns first", async () => {
  const warns: unknown[][] = [];
  const m = HELPER_SOURCE.match(
    /export function reportNonFatal\([\s\S]*?\n\): void \{\n([\s\S]*)\n\}\n?$/,
  );
  const fn = new Function(
    "captureException",
    "console",
    `"use strict"; return function (scope, error, extra, fingerprint) {\n${m![1]}\n};`,
  ) as (c: unknown, con: unknown) => (...a: unknown[]) => void;
  const helper = fn(
    () => {
      throw new Error("sentry exploded");
    },
    { warn: (...a: unknown[]) => warns.push(a) },
  );
  assert.doesNotThrow(() => helper("s", new Error("boom"), { a: 1 }, ["f"]));
  assert.equal(warns.length, 1, "the I-NO-SILENT-FAILURES console.warn was lost");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION D — the captured payload
// ─────────────────────────────────────────────────────────────────────────────

test("D1 — Symbol and BigInt codes degrade to 'none' instead of throwing on String()", () => {
  for (const code of [Symbol("x"), BigInt(10)]) {
    const { rec } = run(liveGoogleCatch(), withCode("boom", code));
    assert.equal(rec.reports.length, 1);
    assert.equal((rec.reports[0][2] as Record<string, unknown>).code, "none");
    assert.deepEqual(rec.reports[0][3], ["auth-signin", "google", "none"]);
  }
});

test("D2 — a numeric code is preserved as a string, never collapsed to 'none'", () => {
  const { rec } = run(liveGoogleCatch(), withCode("DEVELOPER_ERROR", 10));
  assert.equal((rec.reports[0][2] as Record<string, unknown>).code, "10");
  assert.deepEqual(rec.reports[0][3], ["auth-signin", "google", "10"]);
});

test("D3 — grouping: same code + locale-varying messages ⇒ identical fingerprint; different codes ⇒ different", () => {
  const a = run(liveGoogleCatch(), withCode("DEVELOPER_ERROR", "10"));
  const b = run(liveGoogleCatch(), withCode("ERREUR DE DÉVELOPPEUR", "10"));
  const c = run(liveGoogleCatch(), withCode("DEVELOPER_ERROR", "4"));
  assert.deepEqual(a.rec.reports[0][3], b.rec.reports[0][3]);
  assert.notDeepEqual(a.rec.reports[0][3], c.rec.reports[0][3]);
});

test("D4 — extra carries exactly five keys, none of which is an email, token, or full client id", () => {
  const { rec } = run(
    liveGoogleCatch(),
    withCode("failed for user@example.com", "10"),
  );
  const extra = rec.reports[0][2] as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(extra).sort(),
    ["code", "osVersion", "platform", "provider", "webClientIdSuffix"].sort(),
  );
  for (const v of Object.values(extra)) {
    const s = String(v);
    assert.ok(!/@/.test(s), `email-shaped value: ${s}`);
    assert.ok(!/googleusercontent/.test(s), `full client id leaked: ${s}`);
    assert.ok(!/^ey[A-Za-z0-9_-]{10,}\./.test(s), `JWT-shaped value: ${s}`);
    assert.ok(s.length <= 24, `suspiciously long value: ${s}`);
  }
  const fp = rec.reports[0][3] as string[];
  assert.ok(!/@/.test(fp.join("|")));
});

test("D5 — an unconfigured client id reports the literal 'unset', never undefined", () => {
  for (const wid of [undefined, null, "", 12345]) {
    const { rec } = run(liveGoogleCatch(), withCode("boom", "10"), {
      webClientId: wid,
    });
    assert.equal(
      (rec.reports[0][2] as Record<string, unknown>).webClientIdSuffix,
      "unset",
    );
  }
});

/**
 * ── P2 FIX VERIFIED HERE ─────────────────────────────────────────────────────
 * [TEST-MOD-APPROVED ORCH-1044] — amended by the tester who authored this pin,
 * on the #1044 RETEST, sanctioned by the orchestrator's rework acceptance.
 * Originally pinned the P2 defect (`.slice(-8)` of the WHOLE id = "tent.com" for
 * every client id). The rework slices the DISCRIMINATING segment,
 * `webClientId.split(".")[0].slice(-8)`, dropping the shared
 * ".apps.googleusercontent.com" tail. Amended to assert the CORRECT post-fix
 * behaviour: two different ids yield two DIFFERENT suffixes, neither "tent.com",
 * neither leaking the full id / any PII. (Consumer runtime is dev-gated on
 * Sentry.init, but this predicate is byte-identical to the business mirror that
 * was RUNTIME-verified on a physical build.)
 */
test("D6 [P2 FIXED] — webClientIdSuffix DISCRIMINATES between two DIFFERENT Google client ids", () => {
  const a = run(liveGoogleCatch(), withCode("boom", "10"), {
    webClientId: REAL_CLIENT_ID,
  });
  const b = run(liveGoogleCatch(), withCode("boom", "10"), {
    webClientId:
      "999999999999-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz.apps.googleusercontent.com",
  });
  const sa = (a.rec.reports[0][2] as Record<string, unknown>).webClientIdSuffix;
  const sb = (b.rec.reports[0][2] as Record<string, unknown>).webClientIdSuffix;
  assert.equal(sa, "p6smrfs0");
  assert.equal(sb, "zzzzzzzz");
  assert.notEqual(sa, "tent.com");
  assert.notEqual(sb, "tent.com");
  assert.notEqual(sa, sb);
  assert.ok(String(sa).length <= 8);
  assert.ok(REAL_CLIENT_ID.includes(String(sa)));
  assert.ok(!String(sa).includes("googleusercontent"));
});

test("D7 — excluded codes produce ZERO reports on both providers and both platform constant sets", () => {
  for (const sc of [ANDROID_STATUS_CODES, IOS_STATUS_CODES]) {
    for (const code of [
      sc.SIGN_IN_CANCELLED,
      sc.IN_PROGRESS,
      sc.PLAY_SERVICES_NOT_AVAILABLE,
      "ERR_REQUEST_CANCELED",
    ]) {
      assert.equal(
        run(liveGoogleCatch(), withCode("x", code), { statusCodes: sc }).rec
          .reports.length,
        0,
      );
      assert.equal(
        run(liveAppleCatch(), withCode("x", code), { statusCodes: sc }).rec
          .reports.length,
        0,
      );
    }
  }
});

test("D8 — exactly ONE report per failed sign-in, with the spec's scope strings", () => {
  const g = run(liveGoogleCatch(), withCode("DEVELOPER_ERROR", "10"));
  assert.equal(g.rec.reports.length, 1);
  assert.equal(g.rec.reports[0][0], "auth.signInWithGoogle.native");
  const a = run(liveAppleCatch(), withCode("ERR_INVALID_RESPONSE", "ERR_INVALID_RESPONSE"));
  assert.equal(a.rec.reports.length, 1);
  assert.equal(a.rec.reports[0][0], "auth.signInWithApple.native");
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION E — sink + invariants
// ─────────────────────────────────────────────────────────────────────────────

test("E1 — the consumer helper imports the SDK directly, adds no init, no logger, no re-export", () => {
  const stripped = HELPER_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /(^|[^:])\/\/.*$/gm,
    "$1",
  );
  assert.ok(/from "@sentry\/react-native"/.test(stripped));
  assert.ok(!/Sentry\.init|\binit\(/.test(stripped));
  assert.ok(!/export \*/.test(stripped));
  assert.ok(!/from "\.\.\/utils\/logger"/.test(stripped));
});

test("E2 — I-SENTRY-SINGLE-INIT: still exactly one Sentry.init in app-mobile, and it is not in the auth hook", () => {
  const stripped = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/Sentry\.init/.test(stripped));
});

test("E3 — the capture guard sits ABOVE every early return in both catch bodies", () => {
  for (const raw of [liveGoogleCatch(), liveAppleCatch()]) {
    // Strip comments first — the #1044 banner itself contains the word
    // "return" while explaining that no return value changed.
    const body = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const guardAt = body.indexOf("if (shouldReportAuthFailure(code)) {");
    const firstReturnAt = body.indexOf("return ");
    assert.ok(guardAt > -1);
    assert.ok(
      guardAt < firstReturnAt,
      "a return precedes the capture guard — the exclusion set would be dead code",
    );
  }
});
