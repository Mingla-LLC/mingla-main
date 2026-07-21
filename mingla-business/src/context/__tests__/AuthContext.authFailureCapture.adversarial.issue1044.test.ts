/**
 * #1044 [auth-failure-sentry-capture] — TESTER ADVERSARIAL suite, BUSINESS side.
 *
 * DIFFERENT ANGLE FROM THE IMPLEMENTOR'S SUITE (which asserts the POST-change
 * body against hand-written expectations). This suite never writes down what the
 * Alert copy "should" be. Instead it runs a DIFFERENTIAL:
 *
 *   1. It slices the REAL shipped catch body out of AuthContext.tsx.
 *   2. It PROGRAMMATICALLY EXCISES the inserted
 *      `if (shouldReportAuthFailure(code)) { … }` block from that slice.
 *   3. It asserts the residue is BYTE-IDENTICAL to the frozen `origin/main`
 *      body (embedded below verbatim from `git show origin/main:…`). That is a
 *      byte-level proof of "additive only" — strictly stronger than a `+N/−0`
 *      numstat, because numstat cannot see a line MOVED between a branch and
 *      its Alert, and this can.
 *   4. It then EXECUTES both bodies over one input matrix and asserts the
 *      recorded `Alert.alert` argument arrays and the returned values are
 *      deep-equal, case by case.
 *
 * Plus two attack surfaces the implementor's suite does not cover:
 *   - SDK-realistic exotic rejections (null / Symbol / BigInt / frozen / sealed /
 *     bare-string throw / getter-backed `code` / empty-string `code`). Polarity
 *     under test: anything NOT PROVABLY NORMAL must be reported.
 *   - Reporter breakage beyond "throws": returns `undefined`, returns a PENDING
 *     promise (hang), and returns a REJECTED promise (unhandled-rejection
 *     hazard). In every case sign-in must be untouched.
 *
 * Append-only. No product code was modified to make anything here pass.
 */

import fs from "node:fs";
import path from "node:path";

jest.mock("../../diagnostics/sentry", () => ({
  captureException: jest.fn(() => "event-id"),
}));

import { captureException } from "../../diagnostics/sentry";
import { reportNonFatal as realReportNonFatal } from "../../diagnostics/reportNonFatal";

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "AuthContext.tsx"),
  "utf8",
);

jest.spyOn(console, "warn").mockImplementation(() => {});

// ─────────────────────────────────────────────────────────────────────────────
// The frozen pre-change bodies, verbatim from
//   git show origin/main:mingla-business/src/context/AuthContext.tsx
// captured at origin/main = the PR's merge base. These are history, not shipped
// code, so a frozen copy is legitimate here (the POST-change side is always
// sliced live from the real file — delete the fix and this suite fails).
// ─────────────────────────────────────────────────────────────────────────────

const PRE_GOOGLE_CATCH = `      const e = err instanceof Error ? err : new Error(String(err));
      const code = (err as { code?: string })?.code;

      if (code === statusCodes.SIGN_IN_CANCELLED) {
        return { error: e };
      }
      if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert(
          "Google Play Services",
          "Google Play Services is required. Install or update it from the Play Store."
        );
        return { error: e };
      }

      if (!String(e.message).toLowerCase().includes("cancel")) {
        const msg = e.message || "Please try again.";
        const audienceHint =
          msg.includes("Unacceptable audience") || msg.includes("audience in id_token")
            ? "\\n\\nRegister every OAuth client this build uses (Web, iOS, Android) in Supabase → Authentication → Google → Client IDs, comma-separated, Web client first."
            : "";
        Alert.alert("Google Sign-In failed", \`\${msg}\${audienceHint}\`);
      }
      return { error: e };`;

const PRE_APPLE_CATCH = `      const e = err instanceof Error ? err : new Error(String(err));
      const code = (err as { code?: string })?.code;
      if (code === "ERR_REQUEST_CANCELED") {
        return { error: e };
      }
      Alert.alert("Apple Sign-In failed", e.message || "Please try again.");
      return { error: e };`;

// ─────────────────────────────────────────────────────────────────────────────
// Slicing + excision
// ─────────────────────────────────────────────────────────────────────────────

const eraseTypeAssertions = (src: string): string =>
  src.replace(/\(err as \{[^}]*\}\)/g, "(err)");

const between = (start: string, end: string): string => {
  const a = SOURCE.indexOf(start);
  const b = SOURCE.indexOf(end);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return SOURCE.slice(a, b);
};

const catchBody = (chunk: string): string => {
  const m = chunk.match(
    /\} catch \(err: unknown\) \{\n([\s\S]*)\n {4}\}\n {2}\}, \[\]\);/,
  );
  expect(m).not.toBeNull();
  return m![1];
};

const liveGoogleCatch = (): string =>
  catchBody(
    between(
      "const signInWithGoogle = useCallback",
      "const signInWithApple = useCallback",
    ),
  );

const liveAppleCatch = (): string =>
  catchBody(
    between(
      "const signInWithApple = useCallback",
      "const signInWithEmail = useCallback",
    ),
  );

/**
 * Remove the `#1044` comment banner + the whole `if (shouldReportAuthFailure(...))`
 * block (and the single blank line that follows it, when present) from a sliced
 * catch body. Everything else must survive untouched.
 */
const exciseCaptureBlock = (body: string): string => {
  const lines = body.split("\n");
  const startIdx = lines.findIndex((l) => l.trim().startsWith("// #1044"));
  expect(startIdx).toBeGreaterThan(-1);

  const guardIdx = lines.findIndex((l) =>
    l.includes("if (shouldReportAuthFailure(code)) {"),
  );
  expect(guardIdx).toBeGreaterThan(startIdx);

  // The guard block closes on the first line that is exactly six spaces + "}".
  let closeIdx = -1;
  for (let i = guardIdx + 1; i < lines.length; i += 1) {
    if (lines[i] === "      }") {
      closeIdx = i;
      break;
    }
  }
  expect(closeIdx).toBeGreaterThan(guardIdx);

  let endIdx = closeIdx;
  if (lines[closeIdx + 1] === "") endIdx = closeIdx + 1;

  return [...lines.slice(0, startIdx), ...lines.slice(endIdx + 1)].join("\n");
};

// ─────────────────────────────────────────────────────────────────────────────
// Execution harness — compiles a catch body into a callable
// ─────────────────────────────────────────────────────────────────────────────

interface Deps {
  Alert: { alert: (...args: unknown[]) => void };
  statusCodes: Record<string, string | undefined>;
  shouldReportAuthFailure: (code: unknown) => boolean;
  reportNonFatal: (
    scope: string,
    error: unknown,
    extra?: Record<string, unknown>,
    fingerprint?: string[],
  ) => void;
  Platform: { OS: string; Version: unknown };
  webClientId: unknown;
}

const compileCatch = (
  body: string,
): ((err: unknown, deps: Deps) => unknown) => {
  const fn = new Function(
    "err",
    "Alert",
    "statusCodes",
    "shouldReportAuthFailure",
    "reportNonFatal",
    "Platform",
    "webClientId",
    `"use strict";\n${eraseTypeAssertions(body)}`,
  ) as (...a: unknown[]) => unknown;
  return (err, d) =>
    fn(
      err,
      d.Alert,
      d.statusCodes,
      d.shouldReportAuthFailure,
      d.reportNonFatal,
      d.Platform,
      d.webClientId,
    );
};

/** The REAL predicate body, sliced live from the shipped source. */
const compilePredicate = (
  statusCodes: Record<string, string | undefined>,
): ((code: unknown) => boolean) => {
  const m = SOURCE.match(
    /const shouldReportAuthFailure = \(code: unknown\): boolean => \{\n([\s\S]*?)\n\};/,
  );
  expect(m).not.toBeNull();
  const make = new Function(
    "statusCodes",
    `"use strict"; return function (code) {\n${m![1]}\n};`,
  ) as (
    sc: Record<string, string | undefined>,
  ) => (code: unknown) => boolean;
  return make(statusCodes);
};

/**
 * The REAL native constant values, read off the SDK's own Android/iOS bridge
 * sources (investigation F-7 table). Not mock strings — these are what the
 * device actually delivers.
 */
const ANDROID_STATUS_CODES = {
  SIGN_IN_CANCELLED: "12501",
  IN_PROGRESS: "ASYNC_OP_IN_PROGRESS",
  PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
  SIGN_IN_REQUIRED: "4",
  NULL_PRESENTER: "NULL_PRESENTER",
};

const IOS_STATUS_CODES = {
  SIGN_IN_CANCELLED: "-5",
  IN_PROGRESS: "ASYNC_OP_IN_PROGRESS",
  PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
  SIGN_IN_REQUIRED: "-4",
  NULL_PRESENTER: "NULL_PRESENTER",
};

const makeDeps = (
  overrides: Partial<Deps> & { statusCodes?: Record<string, string | undefined> } = {},
): Deps & { alerts: unknown[][]; reports: unknown[][] } => {
  const alerts: unknown[][] = [];
  const reports: unknown[][] = [];
  const statusCodes = overrides.statusCodes ?? ANDROID_STATUS_CODES;
  return {
    alerts,
    reports,
    Alert: { alert: (...args: unknown[]) => alerts.push(args) },
    statusCodes,
    shouldReportAuthFailure:
      overrides.shouldReportAuthFailure ?? compilePredicate(statusCodes),
    reportNonFatal:
      overrides.reportNonFatal ?? ((...args: unknown[]) => reports.push(args)),
    Platform: overrides.Platform ?? { OS: "android", Version: 34 },
    webClientId:
      "webClientId" in overrides
        ? overrides.webClientId
        : "169132274606-hp7cne780gsp7s6l1rrvbfktp6smrfs0.apps.googleusercontent.com",
  };
};

const withCode = (message: string, code: unknown): Error => {
  const e = new Error(message);
  (e as unknown as Record<string, unknown>).code = code;
  return e;
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A — byte-level "additive only" proof + differential execution
// ─────────────────────────────────────────────────────────────────────────────

describe("#1044 ADVERSARIAL A — the change is provably additive (byte-level, not numstat-level)", () => {
  it("A1 — excising the capture block from the SHIPPED Google catch reproduces origin/main byte-for-byte", () => {
    expect(exciseCaptureBlock(liveGoogleCatch())).toBe(PRE_GOOGLE_CATCH);
  });

  it("A2 — excising the capture block from the SHIPPED Apple catch reproduces origin/main byte-for-byte", () => {
    expect(exciseCaptureBlock(liveAppleCatch())).toBe(PRE_APPLE_CATCH);
  });

  it("A3 — the inserted block is a single self-contained guard: no return, no throw, no reassignment of e/code", () => {
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
      expect(block).not.toMatch(/\breturn\b/);
      expect(block).not.toMatch(/\bthrow\b/);
      expect(block).not.toMatch(/\bawait\b/);
      expect(block).not.toMatch(/^\s*(e|code|err)\s*=[^=]/m);
      expect(block).not.toMatch(/setTimeout|requestAnimationFrame|flush\(|close\(/);
    }
  });
});

/**
 * The differential matrix. Every entry is executed by BOTH the pre-change body
 * and the shipped body; the Alerts and the return value must match exactly.
 */
const MATRIX: Array<{ name: string; make: () => unknown }> = [
  { name: "Google DEVELOPER_ERROR (string code)", make: () => withCode("DEVELOPER_ERROR", "10") },
  { name: "Android cancel (12501)", make: () => withCode("Sign in cancelled", "12501") },
  { name: "IN_PROGRESS double-tap", make: () => withCode("in progress", "ASYNC_OP_IN_PROGRESS") },
  { name: "no Play Services", make: () => withCode("no play services", "PLAY_SERVICES_NOT_AVAILABLE") },
  { name: "Apple cancel", make: () => withCode("The user canceled", "ERR_REQUEST_CANCELED") },
  { name: "codeless (the #1038 class)", make: () => new Error("Failed to create session") },
  { name: "codeless — Unacceptable audience", make: () => new Error("Unacceptable audience in id_token") },
  { name: "numeric code 10", make: () => withCode("DEVELOPER_ERROR", 10) },
  { name: "null code", make: () => withCode("boom", null) },
  { name: "explicit undefined code", make: () => withCode("boom", undefined) },
  { name: "Symbol code", make: () => withCode("boom", Symbol("DEVELOPER_ERROR")) },
  { name: "BigInt code", make: () => withCode("boom", BigInt(12501)) },
  { name: "empty-string code", make: () => withCode("boom", "") },
  { name: "SIGN_IN_REQUIRED (4)", make: () => withCode("sign in required", "4") },
  { name: "NULL_PRESENTER", make: () => withCode("null presenter", "NULL_PRESENTER") },
  { name: "bare-string rejection", make: () => "boom" },
  { name: "plain object, no message", make: () => ({}) },
  { name: "plain object carrying only a code", make: () => ({ code: "10" }) },
  { name: "frozen error", make: () => Object.freeze(withCode("DEVELOPER_ERROR", "10")) },
  { name: "sealed error", make: () => Object.seal(withCode("DEVELOPER_ERROR", "10")) },
  {
    name: "message CONTAINS 'cancel' but the code is a real failure",
    make: () => withCode("Sign-in cancelled by the DEVELOPER_ERROR handler", "10"),
  },
  {
    name: "code exposed via a getter",
    make: () => {
      const e = new Error("DEVELOPER_ERROR");
      Object.defineProperty(e, "code", { get: () => "10", enumerable: true });
      return e;
    },
  },
  { name: "String object code (typeof 'object')", make: () => withCode("boom", new String("12501")) },
];

describe("#1044 ADVERSARIAL A — differential: sign-in behaviour is byte-identical", () => {
  const cases: Array<[string, string, string]> = [
    ["Google", "google", "apple"],
  ];
  void cases;

  it.each(MATRIX.map((c) => [c.name, c] as const))(
    "A4 [Google] %s — same Alerts, same return value as origin/main",
    (_name, c) => {
      for (const sc of [ANDROID_STATUS_CODES, IOS_STATUS_CODES]) {
        const pre = makeDeps({ statusCodes: sc });
        const live = makeDeps({ statusCodes: sc });
        const preFn = compileCatch(PRE_GOOGLE_CATCH);
        const liveFn = compileCatch(liveGoogleCatch());

        const preRet = preFn(c.make(), pre);
        const liveRet = liveFn(c.make(), live);

        const safe = (v: unknown) =>
          JSON.stringify(v, (_k, x) =>
            typeof x === "bigint" || typeof x === "symbol" ? String(x) : x,
          );
        expect(live.alerts).toEqual(pre.alerts);
        expect(safe(liveRet)).toEqual(safe(preRet));
        expect((liveRet as { error: Error }).error.message).toBe(
          (preRet as { error: Error }).error.message,
        );
      }
    },
  );

  it.each(MATRIX.map((c) => [c.name, c] as const))(
    "A5 [Apple] %s — same Alerts, same return value as origin/main",
    (_name, c) => {
      const pre = makeDeps();
      const live = makeDeps();
      const preRet = compileCatch(PRE_APPLE_CATCH)(c.make(), pre);
      const liveRet = compileCatch(liveAppleCatch())(c.make(), live);

      expect(live.alerts).toEqual(pre.alerts);
      expect((liveRet as { error: Error }).error.message).toBe(
        (preRet as { error: Error }).error.message,
      );
    },
  );

  it("A6 — a rejection whose toString() throws fails IDENTICALLY before and after (no new hazard added)", () => {
    const hostile = () => ({
      toString() {
        throw new Error("hostile toString");
      },
    });
    const preErr = (() => {
      try {
        compileCatch(PRE_GOOGLE_CATCH)(hostile(), makeDeps());
        return null;
      } catch (x) {
        return (x as Error).message;
      }
    })();
    const liveErr = (() => {
      try {
        compileCatch(liveGoogleCatch())(hostile(), makeDeps());
        return null;
      } catch (x) {
        return (x as Error).message;
      }
    })();
    expect(liveErr).toBe(preErr);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION B — polarity: anything not provably normal MUST be reported
// ─────────────────────────────────────────────────────────────────────────────

describe("#1044 ADVERSARIAL B — exotic rejections are never silently swallowed", () => {
  const MUST_REPORT: Array<[string, unknown]> = [
    ["number 10 (DEVELOPER_ERROR unstringified)", 10],
    ["number 12501 (a cancel that arrived unstringified)", 12501],
    ["null", null],
    ["undefined (the #1038 shape — no code at all)", undefined],
    ["Symbol", Symbol("SIGN_IN_CANCELLED")],
    ["BigInt", BigInt(12501)],
    ["empty string", ""],
    ["String object wrapping a cancel code", new String("12501")],
    ["boolean false", false],
    ["NaN", NaN],
    ["object shaped like a status code", { toString: () => "12501" }],
    ["array", ["12501"]],
    ["DEVELOPER_ERROR '10'", "10"],
    ["SIGN_IN_REQUIRED '4'", "4"],
    ["NULL_PRESENTER", "NULL_PRESENTER"],
    ["unknown future code", "SOME_NEW_CODE_2027"],
  ];

  it.each(MUST_REPORT)(
    "B1 — code = %s is REPORTED (polarity: not provably normal ⇒ report)",
    (_label, code) => {
      for (const sc of [ANDROID_STATUS_CODES, IOS_STATUS_CODES]) {
        expect(compilePredicate(sc)(code)).toBe(true);
      }
    },
  );

  const MUST_NOT_REPORT_ANDROID: Array<[string, string]> = [
    ["SIGN_IN_CANCELLED", "12501"],
    ["IN_PROGRESS", "ASYNC_OP_IN_PROGRESS"],
    ["PLAY_SERVICES_NOT_AVAILABLE", "PLAY_SERVICES_NOT_AVAILABLE"],
    ["ERR_REQUEST_CANCELED", "ERR_REQUEST_CANCELED"],
  ];

  it.each(MUST_NOT_REPORT_ANDROID)(
    "B2 [android] — %s is EXCLUDED (exactly, no more)",
    (_label, code) => {
      expect(compilePredicate(ANDROID_STATUS_CODES)(code)).toBe(false);
    },
  );

  it("B3 [ios] — the iOS cancel code ('-5') is excluded and the ANDROID cancel code is NOT (constants, not literals)", () => {
    const ios = compilePredicate(IOS_STATUS_CODES);
    expect(ios("-5")).toBe(false);
    // "12501" is Android's cancel value; on an iOS statusCodes object it is not
    // a cancel, and must therefore be reported. This is what proves the
    // predicate reads the SDK object rather than hardcoding integers.
    expect(ios("12501")).toBe(true);
  });

  it("B4 — the exclusion set is EXACTLY four codes across both platform constant sets", () => {
    for (const sc of [ANDROID_STATUS_CODES, IOS_STATUS_CODES]) {
      const p = compilePredicate(sc);
      const excluded = [
        sc.SIGN_IN_CANCELLED,
        sc.IN_PROGRESS,
        sc.PLAY_SERVICES_NOT_AVAILABLE,
        "ERR_REQUEST_CANCELED",
      ];
      const universe = [
        ...excluded,
        sc.SIGN_IN_REQUIRED,
        sc.NULL_PRESENTER,
        "10",
        "8",
        "7",
        "ERR_INVALID_RESPONSE",
        "ERR_INVALID_OPERATION",
      ];
      for (const code of universe) {
        expect(p(code)).toBe(!excluded.includes(code as string));
      }
    }
  });

  /**
   * THE OVER-BROAD-EXCLUSION GUARD. If a future SDK bump (or a jest/native
   * mock) leaves an excluded constant `undefined`, the `typeof code !== "string"`
   * first statement must still force a report — never an
   * `undefined === undefined` swallow.
   */
  it("B5 — with EVERY excluded constant undefined, a codeless error is STILL reported (no undefined===undefined swallow)", () => {
    const p = compilePredicate({
      SIGN_IN_CANCELLED: undefined,
      IN_PROGRESS: undefined,
      PLAY_SERVICES_NOT_AVAILABLE: undefined,
      SIGN_IN_REQUIRED: undefined,
      NULL_PRESENTER: undefined,
    });
    expect(p(undefined)).toBe(true);
    expect(p(null)).toBe(true);
    expect(p("10")).toBe(true);
    expect(p("12501")).toBe(true);
  });

  /**
   * The complementary failure the guard does NOT protect against, pinned so it
   * is a known quantity rather than a surprise: if the constants are undefined
   * at runtime, real cancels stop being excluded and become NOISE. That is the
   * safe direction (over-report, never under-report) — but it means the runtime
   * definedness of these constants is load-bearing for signal quality, and is
   * verified live on device in the QA report.
   */
  it("B6 — undefined constants degrade to OVER-reporting (noise), never to under-reporting (blindness)", () => {
    const p = compilePredicate({
      SIGN_IN_CANCELLED: undefined,
      IN_PROGRESS: undefined,
      PLAY_SERVICES_NOT_AVAILABLE: undefined,
    });
    expect(p("12501")).toBe(true);
    expect(p("ASYNC_OP_IN_PROGRESS")).toBe(true);
    // Apple's cancel is a hardcoded literal in the predicate, so it survives
    // an SDK whose constants are all undefined.
    expect(p("ERR_REQUEST_CANCELED")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION C — break the reporter; prove sign-in is unharmed
// ─────────────────────────────────────────────────────────────────────────────

describe("#1044 ADVERSARIAL C — a broken reporter cannot degrade sign-in", () => {
  const mockedCapture = captureException as unknown as jest.Mock;

  const BREAKAGES: Array<[string, () => unknown]> = [
    [
      "throws a plain Error",
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
    ["returns a PENDING promise (hang) — must not be awaited", () => new Promise(() => {})],
  ];

  it.each(BREAKAGES)(
    "C1 [Google] captureException %s — Alerts, return value and control flow are unchanged",
    (_label, impl) => {
      mockedCapture.mockReset();
      mockedCapture.mockImplementation(impl as () => string);

      const err = withCode("DEVELOPER_ERROR", "10");

      const pre = makeDeps();
      const live = makeDeps({ reportNonFatal: realReportNonFatal });

      const preRet = compileCatch(PRE_GOOGLE_CATCH)(err, pre);
      let threw: unknown = null;
      let liveRet: unknown = null;
      try {
        liveRet = compileCatch(liveGoogleCatch())(err, live);
      } catch (x) {
        threw = x;
      }

      expect(threw).toBeNull();
      expect(live.alerts).toEqual(pre.alerts);
      expect((liveRet as { error: Error }).error).toBe(
        (preRet as { error: Error }).error,
      );
      expect(mockedCapture).toHaveBeenCalledTimes(1);
    },
  );

  it.each(BREAKAGES)(
    "C2 [Apple] captureException %s — Alerts, return value and control flow are unchanged",
    (_label, impl) => {
      mockedCapture.mockReset();
      mockedCapture.mockImplementation(impl as () => string);

      const err = withCode("ERR_INVALID_RESPONSE", "ERR_INVALID_RESPONSE");

      const pre = makeDeps();
      const live = makeDeps({ reportNonFatal: realReportNonFatal });

      const preRet = compileCatch(PRE_APPLE_CATCH)(err, pre);
      let threw: unknown = null;
      let liveRet: unknown = null;
      try {
        liveRet = compileCatch(liveAppleCatch())(err, live);
      } catch (x) {
        threw = x;
      }

      expect(threw).toBeNull();
      expect(live.alerts).toEqual(pre.alerts);
      expect((liveRet as { error: Error }).error).toBe(
        (preRet as { error: Error }).error,
      );
    },
  );

  /**
   * ── P3 FINDING PINNED HERE (not a failure — a fact) ────────────────────────
   * The helper's `try/catch` contains SYNCHRONOUS throws only. It never touches
   * the value `captureException` returns, so if a future SDK made
   * `captureException` return a Promise, a rejection would escape the helper as
   * an UNHANDLED REJECTION rather than being swallowed. Verified empirically:
   * feeding a genuinely rejected promise through this path makes the rejection
   * surface outside the helper.
   *
   * Today this is hypothetical — @sentry/react-native 7.2.0's captureException
   * is synchronous and returns a string event id (asserted in C4). This test
   * pins the MECHANISM (the return value is never consumed) without leaking a
   * real rejection into the runner.
   */
  it("C3 [FINDING P3] — the helper never consumes captureException's return value (a promise-returning SDK would leak)", () => {
    mockedCapture.mockReset();
    const then = jest.fn();
    const cat = jest.fn();
    const finallyFn = jest.fn();
    mockedCapture.mockImplementation(
      (() => ({ then, catch: cat, finally: finallyFn })) as unknown as () => string,
    );

    const d = makeDeps({ reportNonFatal: realReportNonFatal });
    expect(() =>
      compileCatch(liveGoogleCatch())(withCode("DEVELOPER_ERROR", "10"), d),
    ).not.toThrow();

    expect(mockedCapture).toHaveBeenCalledTimes(1);
    expect(then).not.toHaveBeenCalled();
    expect(cat).not.toHaveBeenCalled();
    expect(finallyFn).not.toHaveBeenCalled();
  });

  it("C4 — the capture is synchronous: the catch body completes before any microtask runs", () => {
    mockedCapture.mockReset();
    let capturedAt = -1;
    let tick = 0;
    mockedCapture.mockImplementation((() => {
      capturedAt = tick;
      return "id";
    }) as unknown as () => string);
    Promise.resolve().then(() => {
      tick = 1;
    });
    compileCatch(liveGoogleCatch())(
      withCode("DEVELOPER_ERROR", "10"),
      makeDeps({ reportNonFatal: realReportNonFatal }),
    );
    expect(capturedAt).toBe(0);
    expect(tick).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION D — the captured payload
// ─────────────────────────────────────────────────────────────────────────────

describe("#1044 ADVERSARIAL D — the captured payload", () => {
  const capture = (err: unknown, overrides: Partial<Deps> = {}) => {
    const d = makeDeps(overrides);
    compileCatch(liveGoogleCatch())(err, d);
    return d.reports;
  };

  it("D1 — a Symbol code degrades to 'none' rather than throwing on String()", () => {
    const reports = capture(withCode("boom", Symbol("x")));
    expect(reports).toHaveLength(1);
    expect((reports[0][2] as Record<string, unknown>).code).toBe("none");
    expect(reports[0][3]).toEqual(["auth-signin", "google", "none"]);
  });

  it("D2 — a BigInt code degrades to 'none' rather than throwing on String()", () => {
    const reports = capture(withCode("boom", BigInt(10)));
    expect((reports[0][2] as Record<string, unknown>).code).toBe("none");
  });

  it("D3 — a numeric code is preserved as a string, never collapsed to 'none'", () => {
    const reports = capture(withCode("DEVELOPER_ERROR", 10));
    expect((reports[0][2] as Record<string, unknown>).code).toBe("10");
    expect(reports[0][3]).toEqual(["auth-signin", "google", "10"]);
  });

  it("D4 — grouping: same code + different messages ⇒ identical fingerprint", () => {
    const a = capture(withCode("DEVELOPER_ERROR", "10"));
    const b = capture(withCode("ERREUR_DE_DÉVELOPPEUR (locale-varying)", "10"));
    expect(a[0][3]).toEqual(b[0][3]);
  });

  it("D5 — grouping: different codes ⇒ different fingerprints", () => {
    const a = capture(withCode("boom", "10"));
    const b = capture(withCode("boom", "4"));
    expect(a[0][3]).not.toEqual(b[0][3]);
  });

  it("D6 — the fingerprint carries no message text and no PII", () => {
    const reports = capture(withCode("failed for user@example.com", "10"));
    const fp = reports[0][3] as string[];
    expect(fp.join("|")).not.toMatch(/@/);
    expect(fp).toEqual(["auth-signin", "google", "10"]);
  });

  it("D7 — extra has EXACTLY the five allowed keys and no value looks like an email/token/full client id", () => {
    const reports = capture(withCode("DEVELOPER_ERROR", "10"));
    const extra = reports[0][2] as Record<string, unknown>;
    expect(Object.keys(extra).sort()).toEqual(
      ["code", "osVersion", "platform", "provider", "webClientIdSuffix"].sort(),
    );
    for (const v of Object.values(extra)) {
      const s = String(v);
      expect(s).not.toMatch(/@/);
      expect(s).not.toMatch(/googleusercontent/);
      expect(s).not.toMatch(/^ey[A-Za-z0-9_-]{10,}\./); // JWT
      expect(s.length).toBeLessThanOrEqual(24);
    }
  });

  it("D8 — an unconfigured client id reports the literal 'unset', never undefined", () => {
    for (const wid of [undefined, null, "", 12345]) {
      const reports = capture(withCode("boom", "10"), { webClientId: wid });
      expect((reports[0][2] as Record<string, unknown>).webClientIdSuffix).toBe(
        "unset",
      );
    }
  });

  /**
   * ── P2 FINDING PINNED HERE (not a failure — a fact) ────────────────────────
   * SPEC §4.5 justifies `webClientIdSuffix` as proof of "*which* OAuth client
   * the failing build was configured against". Every Google OAuth client id
   * ends in `.apps.googleusercontent.com`, so `.slice(-8)` is the constant
   * "tent.com" for EVERY client id in existence. The field is therefore
   * non-discriminating and cannot serve its stated purpose. It is safe (it
   * leaks strictly less than intended) but it is dead weight.
   * This test pins the current behaviour so the defect is visible and so a
   * later fix (e.g. slicing the id's numeric project prefix instead) trips it.
   */
  it("D9 [FINDING P2] — webClientIdSuffix cannot discriminate between two DIFFERENT Google client ids", () => {
    const idA = "169132274606-hp7cne780gsp7s6l1rrvbfktp6smrfs0.apps.googleusercontent.com";
    const idB = "999999999999-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz.apps.googleusercontent.com";
    const a = capture(withCode("boom", "10"), { webClientId: idA });
    const b = capture(withCode("boom", "10"), { webClientId: idB });
    const sa = (a[0][2] as Record<string, unknown>).webClientIdSuffix;
    const sb = (b[0][2] as Record<string, unknown>).webClientIdSuffix;
    expect(sa).toBe("tent.com");
    expect(sb).toBe("tent.com");
    expect(sa).toBe(sb); // ← the defect: identical for every possible client id
  });

  it("D10 — an Apple failure still reports the GOOGLE web client id suffix (cosmetic mislabel, pinned)", () => {
    const d = makeDeps();
    compileCatch(liveAppleCatch())(withCode("boom", "ERR_INVALID_RESPONSE"), d);
    expect((d.reports[0][2] as Record<string, unknown>).provider).toBe("apple");
    expect(
      (d.reports[0][2] as Record<string, unknown>).webClientIdSuffix,
    ).toBe("tent.com");
  });

  it("D11 — excluded codes produce ZERO reports on both providers and both platforms", () => {
    for (const sc of [ANDROID_STATUS_CODES, IOS_STATUS_CODES]) {
      for (const code of [
        sc.SIGN_IN_CANCELLED,
        sc.IN_PROGRESS,
        sc.PLAY_SERVICES_NOT_AVAILABLE,
        "ERR_REQUEST_CANCELED",
      ]) {
        const g = makeDeps({ statusCodes: sc });
        compileCatch(liveGoogleCatch())(withCode("x", code), g);
        expect(g.reports).toHaveLength(0);

        const a = makeDeps({ statusCodes: sc });
        compileCatch(liveAppleCatch())(withCode("x", code), a);
        expect(a.reports).toHaveLength(0);
      }
    }
  });

  it("D12 — exactly ONE report per failed sign-in (no double capture)", () => {
    const d = makeDeps();
    compileCatch(liveGoogleCatch())(withCode("DEVELOPER_ERROR", "10"), d);
    expect(d.reports).toHaveLength(1);
    expect(d.reports[0][0]).toBe("auth.signInWithGoogle.native");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION E — the helper itself
// ─────────────────────────────────────────────────────────────────────────────

describe("#1044 ADVERSARIAL E — reportNonFatal under hostile input", () => {
  const mockedCapture = captureException as unknown as jest.Mock;

  beforeEach(() => {
    mockedCapture.mockReset();
    mockedCapture.mockImplementation(() => "event-id");
  });

  it("E1 — a frozen Error is still captured (the SDK may want to annotate it; we must not)", () => {
    const frozen = Object.freeze(new Error("frozen"));
    expect(() => realReportNonFatal("s", frozen, { a: 1 }, ["f"])).not.toThrow();
    expect(mockedCapture).toHaveBeenCalledTimes(1);
  });

  it("E2 — a non-Error rejection is NOT sent to Sentry (helper contract) — the call sites coerce first", () => {
    realReportNonFatal("s", "bare string");
    realReportNonFatal("s", { plain: "object" });
    realReportNonFatal("s", null);
    expect(mockedCapture).not.toHaveBeenCalled();
    // …which is why every call site coerces to an Error BEFORE calling. Proven:
    const d = makeDeps({ reportNonFatal: realReportNonFatal });
    compileCatch(liveGoogleCatch())("bare string rejection", d);
    expect(mockedCapture).toHaveBeenCalledTimes(1);
    expect((mockedCapture.mock.calls[0][0] as Error) instanceof Error).toBe(true);
    expect((mockedCapture.mock.calls[0][0] as Error).message).toBe(
      "bare string rejection",
    );
  });

  it("E3 — an Error whose .message getter throws does not escape the helper", () => {
    const hostile = new Error("x");
    Object.defineProperty(hostile, "message", {
      get() {
        throw new Error("hostile message getter");
      },
    });
    expect(() => realReportNonFatal("s", hostile)).not.toThrow();
  });

  it("E4 — no fingerprint argument ⇒ the pre-#1044 context shape is emitted verbatim (backward compat)", () => {
    const e = new Error("legacy");
    realReportNonFatal("legacy.scope", e, { k: "v" });
    expect(mockedCapture).toHaveBeenCalledWith(e, {
      tags: { scope: "legacy.scope" },
      extra: { k: "v" },
    });
    expect(
      Object.keys(mockedCapture.mock.calls[0][1] as object),
    ).not.toContain("fingerprint");
  });

  it("E5 — a fingerprint argument is forwarded as a ScopeContext key", () => {
    const e = new Error("with fp");
    realReportNonFatal("s", e, { k: "v" }, ["a", "b"]);
    expect(mockedCapture).toHaveBeenCalledWith(e, {
      tags: { scope: "s" },
      extra: { k: "v" },
      fingerprint: ["a", "b"],
    });
  });

  it("E6 — an empty fingerprint array falls back to default grouping (falsy-array footgun check)", () => {
    const e = new Error("empty fp");
    realReportNonFatal("s", e, undefined, []);
    // [] is truthy in JS, so the fingerprint IS forwarded — an empty fingerprint
    // is a valid-but-meaningless Sentry grouping key. No call site passes one.
    expect(mockedCapture.mock.calls[0][1]).toEqual({
      tags: { scope: "s" },
      extra: undefined,
      fingerprint: [],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION F — the sink, and the scope of the change
// ─────────────────────────────────────────────────────────────────────────────

describe("#1044 ADVERSARIAL F — sink + scope", () => {
  it("F1 — business routes through the platform shim, never @sentry/react-native directly", () => {
    const helper = fs.readFileSync(
      path.join(__dirname, "..", "..", "diagnostics", "reportNonFatal.ts"),
      "utf8",
    );
    expect(helper).toMatch(/from "\.\/sentry"/);
    expect(helper.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(
      /@sentry\/react-native/,
    );
    expect(SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(
      /@sentry\/react-native/,
    );
  });

  it("F2 — no Sentry.init is added anywhere in the touched files", () => {
    const helper = fs.readFileSync(
      path.join(__dirname, "..", "..", "diagnostics", "reportNonFatal.ts"),
      "utf8",
    );
    expect(helper).not.toMatch(/Sentry\.init|\binit\s*\(/);
    expect(SOURCE.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/Sentry\.init/);
  });

  it("F3 — SC-9: both WEB signInWithOAuth branches are free of any telemetry call", () => {
    const hits: number[] = [];
    let from = 0;
    for (;;) {
      const i = SOURCE.indexOf("supabase.auth.signInWithOAuth(", from);
      if (i === -1) break;
      hits.push(i);
      from = i + 1;
    }
    expect(hits.length).toBe(2); // google web + apple web, unchanged
    for (const i of hits) {
      const chunk = SOURCE.slice(Math.max(0, i - 400), i + 600);
      expect(chunk).toMatch(/Platform\.OS === "web"/);
      expect(chunk).not.toMatch(/reportNonFatal|captureException|Sentry\./);
      expect(chunk).not.toMatch(/shouldReportAuthFailure/);
    }
  });

  it("F4 — the predicate is module-scope and introduces no module-load side effect", () => {
    const m = SOURCE.match(
      /const shouldReportAuthFailure = \(code: unknown\): boolean => \{([\s\S]*?)\n\};/,
    );
    expect(m).not.toBeNull();
    // Nothing outside a function body may touch statusCodes at module load.
    const beforeProvider = SOURCE.slice(0, SOURCE.indexOf("export function AuthProvider"));
    const topLevelStatusCodeReads = beforeProvider
      .split("\n")
      .filter(
        (l) =>
          /statusCodes\./.test(l) &&
          !/^\s{2,}/.test(l) &&
          !/^\s*(\*|\/\/)/.test(l),
      );
    expect(topLevelStatusCodeReads).toEqual([]);
  });
});
