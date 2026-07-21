/**
 * #1044 [auth-failure-sentry-capture] — implementor happy-path regression suite,
 * BUSINESS side (P1 `signInWithGoogle` native catch, P2 `signInWithApple` native
 * catch). Covers SPEC §7 T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12.
 *
 * ─── WHAT WENT WRONG (#1038) ───────────────────────────────────────────────
 * An Android OAuth client registered against the EAS upload-key SHA-1 instead of
 * the Play app-signing SHA-1 broke Google sign-in for EVERY Play-Store organizer
 * for months. A 90-day Sentry search for DEVELOPER_ERROR across `mingla-business`
 * returned ZERO issues while MINGLA-BUSINESS-5 (a production Android native
 * event) proved the pipeline was live the whole time. The catch block Alerted the
 * user and threw the error away. A human found the bug; monitoring never did.
 *
 * ─── THE TRAP THIS SUITE PINS (T7 is the anchor) ───────────────────────────
 * `statusCodes` members are RUNTIME NATIVE CONSTANTS, and they differ between the
 * two apps' installed SDKs (`NULL_PRESENTER` exists on business 16.1.2 and NOT on
 * app-mobile 16.0.0). If someone later "simplifies" `shouldReportAuthFailure`
 * into an array `.includes()` over those constants and drops the leading
 * `typeof code !== "string"` guard, then in any app where a constant resolves to
 * `undefined` an error with NO `code` (`new Error("Failed to create session")`)
 * compares equal to it and is SILENTLY DROPPED — reintroducing #1038 inside its
 * own fix. `T7-trap` below injects exactly that SDK shape and proves the codeless
 * error is still reported.
 *
 * ─── TEST STYLE — WHY IT SLICES THE REAL SOURCE ────────────────────────────
 * `AuthContext.tsx` carries JSX plus native-only deps (GoogleSignin,
 * expo-apple-authentication, AppsFlyer, OneSignal, RevenueCat…) that the default
 * node/ts-jest harness cannot load, and there is no RTL under this config, so
 * <AuthProvider> cannot be MOUNTED here.
 *
 * That constrains HOW we reach the catch blocks — it does NOT license testing a
 * hand-retyped COPY of them. ORCH-1373 P2-2 proved a replica test is worse than
 * no test: it stayed green while the real guard was deleted from the real file.
 *
 * So this suite uses the idiom established by
 * `AuthContext.diagnosticTruth.orch1377.test.ts`: it SLICES the REAL shipped
 * catch-block bodies (and the REAL `shouldReportAuthFailure` body) out of
 * AuthContext.tsx and EXECUTES them via `new Function` with the real
 * collaborators injected. Nothing below re-types production logic — if the
 * shipped body changes, THIS RUNS THE CHANGED BODY. Line-delete the
 * `reportNonFatal(...)` call and T1 fails; line-delete the `typeof` guard and T7
 * fails; delete the exclusion clauses and T2/T3/T4/T5 fail.
 */

import fs from "node:fs";
import path from "node:path";

jest.mock("../../diagnostics/sentry", () => ({
  captureException: jest.fn(() => "event-id"),
}));

import { captureException } from "../../diagnostics/sentry";
import { reportNonFatal as realReportNonFatal } from "../../diagnostics/reportNonFatal";

const AUTH_CONTEXT_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "AuthContext.tsx"),
  "utf8",
);

const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

// ─────────────────────────────────────────────────────────────────────────────
// Slicing the REAL shipped source
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The ONLY de-TypeScript step applied to a sliced body, declared explicitly so a
 * reader can audit it: the catch blocks' single TS construct is the `code` cast
 * `(err as { code?: string })?.code`. `new Function` compiles JS, not TS, so the
 * cast is erased exactly the way tsc erases it. Nothing else is rewritten.
 */
const eraseTypeAssertions = (src: string): string =>
  src.replace(/\(err as \{[^}]*\}\)/g, "(err)");

/**
 * Comment-stripped view, for assertions about what the code READS. The #1044
 * comments deliberately name `email`, `idToken`, `Sentry.init` etc. while
 * explaining what must never be captured; a naive grep over raw source would
 * flag its own documentation.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const between = (start: string, end: string): string => {
  const a = AUTH_CONTEXT_SOURCE.indexOf(start);
  const b = AUTH_CONTEXT_SOURCE.indexOf(end);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return AUTH_CONTEXT_SOURCE.slice(a, b);
};

/** The REAL `shouldReportAuthFailure` body, sliced from the shipped source. */
const predicateBody = (): string => {
  const m = AUTH_CONTEXT_SOURCE.match(
    /const shouldReportAuthFailure = \(code: unknown\): boolean => \{\n([\s\S]*?)\n\};/,
  );
  expect(m).not.toBeNull();
  return m![1];
};

/** The REAL catch-block body of a `useCallback` sign-in function. */
const catchBody = (chunk: string): string => {
  const m = chunk.match(
    /\} catch \(err: unknown\) \{\n([\s\S]*)\n {4}\}\n {2}\}, \[\]\);/,
  );
  expect(m).not.toBeNull();
  return eraseTypeAssertions(m![1]);
};

const googleCatch = (): string =>
  catchBody(
    between(
      "const signInWithGoogle = useCallback",
      "const signInWithApple = useCallback",
    ),
  );

const appleCatch = (): string =>
  catchBody(
    between(
      "const signInWithApple = useCallback",
      "const signInWithEmail = useCallback",
    ),
  );

type StatusCodesShape = Record<string, string | undefined>;

/** Compile the REAL predicate against an injected `statusCodes` object. */
const compilePredicate = (
  statusCodes: StatusCodesShape,
): ((code: unknown) => boolean) => {
  const make = new Function(
    "statusCodes",
    `"use strict"; return function (code) {\n${predicateBody()}\n};`,
  ) as (sc: StatusCodesShape) => (code: unknown) => boolean;
  return make(statusCodes);
};

interface CatchDeps {
  Alert: { alert: jest.Mock };
  Platform: { OS: string; Version: string | number };
  statusCodes: StatusCodesShape;
  reportNonFatal: (
    scope: string,
    error: unknown,
    extra?: Record<string, unknown>,
    fingerprint?: string[],
  ) => void;
  shouldReportAuthFailure: (code: unknown) => boolean;
  webClientId: unknown;
}

/** Compile a REAL catch body into a callable `(err) => returnValue`. */
const compileCatch = (
  body: string,
  deps: CatchDeps,
): ((err: unknown) => unknown) => {
  const names = Object.keys(deps);
  const make = new Function(
    ...names,
    `"use strict"; return function (err) {\n${body}\n};`,
  ) as (...injected: unknown[]) => (err: unknown) => unknown;
  return make(...names.map((n) => (deps as unknown as Record<string, unknown>)[n]));
};

// Realistic native constant values (Android). Proven in the investigation from
// the installed package's Java/ObjC bridge sources.
const ANDROID_STATUS_CODES: StatusCodesShape = {
  SIGN_IN_CANCELLED: "12501",
  IN_PROGRESS: "ASYNC_OP_IN_PROGRESS",
  PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
  SIGN_IN_REQUIRED: "4",
  NULL_PRESENTER: "NULL_PRESENTER",
};

const WEB_CLIENT_ID =
  "123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com";
const EXPECTED_SUFFIX = WEB_CLIENT_ID.slice(-8); // "ent.com" family — last 8 only

const makeDeps = (
  overrides: Partial<CatchDeps> = {},
): CatchDeps & { report: jest.Mock } => {
  const statusCodes = overrides.statusCodes ?? ANDROID_STATUS_CODES;
  const report = jest.fn();
  const deps: CatchDeps = {
    Alert: { alert: jest.fn() },
    Platform: { OS: "android", Version: 34 },
    statusCodes,
    reportNonFatal: report,
    shouldReportAuthFailure: compilePredicate(statusCodes),
    webClientId: WEB_CLIENT_ID,
    ...overrides,
  };
  // Keep the predicate consistent with any injected statusCodes override.
  if (overrides.statusCodes && !overrides.shouldReportAuthFailure) {
    deps.shouldReportAuthFailure = compilePredicate(overrides.statusCodes);
  }
  if (overrides.reportNonFatal) deps.reportNonFatal = overrides.reportNonFatal;
  return Object.assign(deps, { report });
};

const errWith = (code: unknown, message: string): Error => {
  const e = new Error(message);
  (e as unknown as { code: unknown }).code = code;
  return e;
};

beforeEach(() => {
  warnSpy.mockClear();
  (captureException as jest.Mock).mockClear();
});

afterAll(() => {
  warnSpy.mockRestore();
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-1-BIZ / SC-4-BIZ — the capture happens, with the right shape
// ─────────────────────────────────────────────────────────────────────────────

describe("#1044 P1 signInWithGoogle — capture (SC-1-BIZ)", () => {
  it("T1 — DEVELOPER_ERROR ('10') is REPORTED with provider/code/fingerprint", () => {
    // THE fails-on-revert anchor for the capture itself: line-delete the
    // reportNonFatal(...) call from AuthContext.tsx and this fails.
    const d = makeDeps();
    const err = errWith("10", "DEVELOPER_ERROR");
    const ret = compileCatch(googleCatch(), d)(err);

    expect(d.report).toHaveBeenCalledTimes(1);
    const [scope, error, extra, fingerprint] = d.report.mock.calls[0];
    expect(scope).toBe("auth.signInWithGoogle.native");
    expect(error).toBe(err);
    expect(extra).toEqual({
      provider: "google",
      code: "10",
      platform: "android",
      osVersion: "34",
      webClientIdSuffix: EXPECTED_SUFFIX,
    });
    expect(fingerprint).toEqual(["auth-signin", "google", "10"]);

    // T11 — Alert parity: exactly the pre-change Alert, unchanged.
    expect(d.Alert.alert).toHaveBeenCalledTimes(1);
    expect(d.Alert.alert).toHaveBeenCalledWith(
      "Google Sign-In failed",
      "DEVELOPER_ERROR",
    );
    expect(ret).toEqual({ error: err });
  });

  it("T7 — CODELESS error is REPORTED with code 'none' (the #1038 class)", () => {
    const d = makeDeps();
    const err = new Error("Failed to create session"); // no `code` property
    const ret = compileCatch(googleCatch(), d)(err);

    expect(d.report).toHaveBeenCalledTimes(1);
    const [, , extra, fingerprint] = d.report.mock.calls[0];
    expect(extra.code).toBe("none");
    expect(fingerprint).toEqual(["auth-signin", "google", "none"]);

    expect(d.Alert.alert).toHaveBeenCalledTimes(1);
    expect(d.Alert.alert).toHaveBeenCalledWith(
      "Google Sign-In failed",
      "Failed to create session",
    );
    expect(ret).toEqual({ error: err });
  });

  it("T7-trap — codeless error is STILL reported when statusCodes members are undefined (F-7)", () => {
    // The SDK-drift shape: app-mobile 16.0.0 has no NULL_PRESENTER, and every
    // `statusCodes` member is a native constant that can resolve to `undefined`
    // in a harness or on a platform that does not define it. Without the leading
    // `typeof code !== "string"` guard, `code === undefined` matches
    // `statusCodes.SIGN_IN_CANCELLED === undefined` and the error is dropped.
    // LINE-DELETE that guard from AuthContext.tsx and THIS TEST FAILS.
    const d = makeDeps({
      statusCodes: {
        SIGN_IN_CANCELLED: undefined,
        IN_PROGRESS: undefined,
        PLAY_SERVICES_NOT_AVAILABLE: undefined,
      },
    });
    compileCatch(googleCatch(), d)(new Error("Failed to create session"));
    expect(d.report).toHaveBeenCalledTimes(1);
    expect(d.report.mock.calls[0][2].code).toBe("none");
  });

  it("T8 — 'Unacceptable audience' is REPORTED and the audienceHint Alert copy is verbatim", () => {
    const d = makeDeps();
    const err = new Error("Unacceptable audience in id_token");
    compileCatch(googleCatch(), d)(err);

    expect(d.report).toHaveBeenCalledTimes(1);
    expect(d.Alert.alert).toHaveBeenCalledTimes(1);
    expect(d.Alert.alert).toHaveBeenCalledWith(
      "Google Sign-In failed",
      "Unacceptable audience in id_token" +
        "\n\nRegister every OAuth client this build uses (Web, iOS, Android) in Supabase → Authentication → Google → Client IDs, comma-separated, Web client first.",
    );
  });

  it("numeric code (SDK reality, not a mock artefact) is reported as a string, not collapsed to 'none'", () => {
    const d = makeDeps();
    compileCatch(googleCatch(), d)(errWith(10, "DEVELOPER_ERROR"));
    expect(d.report).toHaveBeenCalledTimes(1);
    expect(d.report.mock.calls[0][2].code).toBe("10");
    expect(d.report.mock.calls[0][3]).toEqual(["auth-signin", "google", "10"]);
  });

  it("webClientIdSuffix is 'unset' when no client id is configured, never a full id", () => {
    const d = makeDeps({ webClientId: undefined });
    compileCatch(googleCatch(), d)(errWith("10", "DEVELOPER_ERROR"));
    expect(d.report.mock.calls[0][2].webClientIdSuffix).toBe("unset");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-3-BIZ — the exclusion set (normal behaviour is NOT reported)
// ─────────────────────────────────────────────────────────────────────────────

describe("#1044 P1 signInWithGoogle — exclusions (SC-3-BIZ)", () => {
  it("T2 — user cancelled the picker: ZERO captures, ZERO alerts, same return", () => {
    // Delete the SIGN_IN_CANCELLED exclusion clause and this FAILS.
    const d = makeDeps();
    const err = errWith(ANDROID_STATUS_CODES.SIGN_IN_CANCELLED, "cancelled");
    const ret = compileCatch(googleCatch(), d)(err);
    expect(d.report).not.toHaveBeenCalled();
    expect(d.Alert.alert).not.toHaveBeenCalled();
    expect(ret).toEqual({ error: err });
  });

  it("T3 — double-tap (IN_PROGRESS): ZERO captures", () => {
    // Business does NOT branch on IN_PROGRESS, so without the exclusion every
    // impatient double-tap would become a Sentry error. Delete the clause → FAILS.
    const d = makeDeps();
    compileCatch(googleCatch(), d)(
      errWith(ANDROID_STATUS_CODES.IN_PROGRESS, "in progress"),
    );
    expect(d.report).not.toHaveBeenCalled();
  });

  it("T4 — no Play Services: ZERO captures, and the Play-Services Alert STILL fires verbatim", () => {
    const d = makeDeps();
    const err = errWith(
      ANDROID_STATUS_CODES.PLAY_SERVICES_NOT_AVAILABLE,
      "play services",
    );
    const ret = compileCatch(googleCatch(), d)(err);
    expect(d.report).not.toHaveBeenCalled();
    expect(d.Alert.alert).toHaveBeenCalledTimes(1);
    expect(d.Alert.alert).toHaveBeenCalledWith(
      "Google Play Services",
      "Google Play Services is required. Install or update it from the Play Store.",
    );
    expect(ret).toEqual({ error: err });
  });

  it("T5 — Apple's cancel code on the Google path: ZERO captures (one predicate serves both)", () => {
    const d = makeDeps();
    compileCatch(googleCatch(), d)(errWith("ERR_REQUEST_CANCELED", "cancelled"));
    expect(d.report).not.toHaveBeenCalled();
  });

  it("a message merely CONTAINING 'cancel' still gets captured (the Alert guard must not suppress telemetry)", () => {
    // Business P1 has a pre-existing `message.includes("cancel")` guard on the
    // ALERT path. It must not also silence the CAPTURE — a real failure whose
    // message happens to say "cancel" is still a real failure.
    const d = makeDeps();
    compileCatch(googleCatch(), d)(errWith("10", "operation was cancelled by GMS"));
    expect(d.report).toHaveBeenCalledTimes(1);
    expect(d.Alert.alert).not.toHaveBeenCalled(); // pre-existing behaviour, unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-2-BIZ — Apple (P2)
// ─────────────────────────────────────────────────────────────────────────────

describe("#1044 P2 signInWithApple (SC-2-BIZ)", () => {
  it("T6 — Apple config failure is REPORTED with provider 'apple'", () => {
    const d = makeDeps({ Platform: { OS: "ios", Version: "18.2" } });
    const err = errWith("ERR_INVALID_RESPONSE", "Invalid response");
    const ret = compileCatch(appleCatch(), d)(err);

    expect(d.report).toHaveBeenCalledTimes(1);
    const [scope, error, extra, fingerprint] = d.report.mock.calls[0];
    expect(scope).toBe("auth.signInWithApple.native");
    expect(error).toBe(err);
    expect(extra).toEqual({
      provider: "apple",
      code: "ERR_INVALID_RESPONSE",
      platform: "ios",
      osVersion: "18.2",
      webClientIdSuffix: EXPECTED_SUFFIX,
    });
    expect(fingerprint).toEqual([
      "auth-signin",
      "apple",
      "ERR_INVALID_RESPONSE",
    ]);

    expect(d.Alert.alert).toHaveBeenCalledTimes(1);
    expect(d.Alert.alert).toHaveBeenCalledWith(
      "Apple Sign-In failed",
      "Invalid response",
    );
    expect(ret).toEqual({ error: err });
  });

  it("T5 — Apple cancelled: ZERO captures, ZERO alerts, same return", () => {
    const d = makeDeps({ Platform: { OS: "ios", Version: "18.2" } });
    const err = errWith("ERR_REQUEST_CANCELED", "The user canceled the sign-in");
    const ret = compileCatch(appleCatch(), d)(err);
    expect(d.report).not.toHaveBeenCalled();
    expect(d.Alert.alert).not.toHaveBeenCalled();
    expect(ret).toEqual({ error: err });
  });

  it("T7 — codeless Apple error is REPORTED with code 'none'", () => {
    const d = makeDeps({ Platform: { OS: "ios", Version: "18.2" } });
    compileCatch(appleCatch(), d)(new Error("Failed to create session"));
    expect(d.report).toHaveBeenCalledTimes(1);
    expect(d.report.mock.calls[0][2].code).toBe("none");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-7 — PII allowlist (T10)
// ─────────────────────────────────────────────────────────────────────────────

describe("#1044 T10 — PII allowlist (SC-7)", () => {
  const ALLOWED = [
    "provider",
    "code",
    "platform",
    "osVersion",
    "webClientIdSuffix",
  ];

  const everyReportedExtra = (): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    for (const body of [googleCatch(), appleCatch()]) {
      for (const err of [
        errWith("10", "DEVELOPER_ERROR"),
        errWith("ERR_INVALID_RESPONSE", "bad"),
        new Error("Failed to create session"),
        errWith(4, "SIGN_IN_REQUIRED"),
      ]) {
        const d = makeDeps();
        compileCatch(body, d)(err);
        for (const call of d.report.mock.calls) out.push(call[2]);
      }
    }
    return out;
  };

  it("extra carries EXACTLY the five allowed keys on every reported failure", () => {
    const extras = everyReportedExtra();
    expect(extras.length).toBeGreaterThan(0);
    for (const extra of extras) {
      expect(Object.keys(extra).sort()).toEqual([...ALLOWED].sort());
    }
  });

  it("no captured value looks like an email, a token, or a full client id", () => {
    for (const extra of everyReportedExtra()) {
      for (const value of Object.values(extra)) {
        const s = String(value);
        expect(s).not.toMatch(/@/); // no email, no @-bearing identifier
        expect(s).not.toMatch(/^ey[A-Za-z0-9_-]{10,}/); // no JWT
        expect(s.length).toBeLessThanOrEqual(24); // no full client id / token
        expect(s).not.toContain("googleusercontent");
      }
    }
  });

  it("the source of the four capture call sites never reads a token, email, or full client id", () => {
    for (const raw of [googleCatch(), appleCatch()]) {
      const body = stripComments(raw);
      expect(body).not.toMatch(/idToken|identityToken|accessToken|serverAuthCode|refreshToken/);
      expect(body).not.toMatch(/\bemail\b/);
      expect(body).not.toMatch(/credential\.fullName|credential\.user/);
      // the client id only ever appears sliced to its last 8 chars
      expect(body).not.toMatch(/webClientId(?!Suffix)\s*,/);
      expect(body).toMatch(/webClientId\.slice\(-8\)/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SC-6 — failure-safety: the capture cannot break the auth path (T9)
// ─────────────────────────────────────────────────────────────────────────────

describe("#1044 T9 — failure safety (SC-6)", () => {
  it("reportNonFatal returns normally when captureException THROWS", () => {
    (captureException as jest.Mock).mockImplementationOnce(() => {
      throw new Error("sentry exploded");
    });
    expect(() =>
      realReportNonFatal("auth.signInWithGoogle.native", new Error("boom"), {
        provider: "google",
      }),
    ).not.toThrow();
  });

  it("the REAL catch block still Alerts and returns the same value when Sentry throws", () => {
    // End-to-end: the REAL reportNonFatal (not a spy) is injected into the REAL
    // catch body, with captureException rigged to throw.
    (captureException as jest.Mock).mockImplementation(() => {
      throw new Error("sentry exploded");
    });
    const d = makeDeps({ reportNonFatal: realReportNonFatal });
    const err = errWith("10", "DEVELOPER_ERROR");

    let ret: unknown;
    expect(() => {
      ret = compileCatch(googleCatch(), d)(err);
    }).not.toThrow();

    expect(d.Alert.alert).toHaveBeenCalledTimes(1);
    expect(d.Alert.alert).toHaveBeenCalledWith(
      "Google Sign-In failed",
      "DEVELOPER_ERROR",
    );
    expect(ret).toEqual({ error: err });
    (captureException as jest.Mock).mockImplementation(() => "event-id");
  });

  it("reportNonFatal is synchronous, never awaited, never flushed at any call site", () => {
    for (const body of [googleCatch(), appleCatch()]) {
      expect(body).not.toMatch(/await\s+reportNonFatal/);
      expect(body).not.toMatch(/Sentry\.flush|\.flush\(|\.close\(/);
      expect(body).not.toMatch(/setTimeout|requestAnimationFrame/);
    }
  });

  it("the capture never alters control flow (no return/throw inside the guard)", () => {
    for (const body of [googleCatch(), appleCatch()]) {
      const m = body.match(
        /if \(shouldReportAuthFailure\(code\)\) \{([\s\S]*?)\n {6}\}/,
      );
      expect(m).not.toBeNull();
      const guarded = m![1];
      expect(guarded).not.toMatch(/\breturn\b/);
      expect(guarded).not.toMatch(/\bthrow\b/);
      expect(guarded).toMatch(/reportNonFatal\(/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Structural guards — the invariant's shape (T12, SC-8, SC-9)
// ─────────────────────────────────────────────────────────────────────────────

describe("#1044 structural — I-PROPOSED-1044-AUTH-FAILURE-REPORTED", () => {
  it("the `typeof code !== \"string\"` guard is the FIRST statement of the predicate", () => {
    const body = predicateBody().trim();
    expect(body.split("\n")[0].trim()).toBe(
      'if (typeof code !== "string") return true;',
    );
  });

  it("the predicate excludes EXACTLY the four specified codes, via statusCodes — never integers", () => {
    const body = predicateBody();
    expect(body).toMatch(/code === statusCodes\.SIGN_IN_CANCELLED/);
    expect(body).toMatch(/code === statusCodes\.IN_PROGRESS/);
    expect(body).toMatch(/code === statusCodes\.PLAY_SERVICES_NOT_AVAILABLE/);
    expect(body).toMatch(/code === "ERR_REQUEST_CANCELED"/);
    // SIGN_IN_REQUIRED / NULL_PRESENTER are deliberately NOT excluded.
    expect(body).not.toMatch(/SIGN_IN_REQUIRED/);
    expect(body).not.toMatch(/NULL_PRESENTER/);
    // No hardcoded native integers — they differ per platform.
    expect(body).not.toMatch(/"12501"|"-5"|"10"|"4"/);
    expect((body.match(/return false;/g) ?? []).length).toBe(4);
  });

  it("there is exactly ONE predicate definition and exactly TWO capture call sites", () => {
    expect(
      (AUTH_CONTEXT_SOURCE.match(/const shouldReportAuthFailure = /g) ?? [])
        .length,
    ).toBe(1);
    expect(
      (AUTH_CONTEXT_SOURCE.match(/if \(shouldReportAuthFailure\(code\)\)/g) ?? [])
        .length,
    ).toBe(2);
  });

  it("SC-9 — the business WEB signInWithOAuth branches are untouched (they belong to #890)", () => {
    const webBranches =
      AUTH_CONTEXT_SOURCE.match(/supabase\.auth\.signInWithOAuth\(\{[\s\S]*?\}\);/g) ??
      [];
    expect(webBranches.length).toBe(2);
    for (const b of webBranches) {
      expect(b).not.toMatch(/reportNonFatal|captureException|Sentry/);
    }
  });

  it("SC-8 / T12 — business routes Sentry through the platform split, never the SDK directly", () => {
    const helper = fs.readFileSync(
      path.join(__dirname, "..", "..", "diagnostics", "reportNonFatal.ts"),
      "utf8",
    );
    expect(helper).toMatch(
      /import \{ captureException \} from "\.\/sentry";/,
    );
    expect(helper).not.toMatch(/@sentry\/react-native/);
    expect(helper).not.toMatch(/Sentry\.init|\binit\(/);
    expect(AUTH_CONTEXT_SOURCE).not.toMatch(/from "@sentry\/react-native"/);
    expect(AUTH_CONTEXT_SOURCE).not.toMatch(/Sentry\.init/);
  });

  it("T12 — the consumer mirror imports the SDK directly and adds no second init", () => {
    const consumerHelper = stripComments(
      fs.readFileSync(
        path.join(
          __dirname,
          "..","..","..","..",
          "app-mobile","src","diagnostics","reportNonFatal.ts",
        ),
        "utf8",
      ),
    );
    expect(consumerHelper).toMatch(
      /import \{ captureException \} from "@sentry\/react-native";/,
    );
    expect(consumerHelper).not.toMatch(/Sentry\.init/);
    expect(consumerHelper).not.toMatch(/export \* from/);
    expect(consumerHelper).not.toMatch(/from ["'].*utils\/logger["']/);
  });

  it("the helper's body is throw-proof and the swallow is silent", () => {
    const helper = fs.readFileSync(
      path.join(__dirname, "..", "..", "diagnostics", "reportNonFatal.ts"),
      "utf8",
    );
    const body = helper.match(/\): void \{\n([\s\S]*)\n\}\n$/);
    expect(body).not.toBeNull();
    expect(body![1]).toMatch(/^\s*try \{/);
    expect(body![1]).toMatch(/\} catch \{/);
    // console.warn retained (the I-NO-SILENT-FAILURES half that works on web)…
    expect(body![1]).toMatch(/console\.warn\(/);
    // …but the swallow itself must be silent.
    const swallow = body![1].slice(body![1].lastIndexOf("} catch {"));
    expect(swallow).not.toMatch(/console\./);
  });
});
