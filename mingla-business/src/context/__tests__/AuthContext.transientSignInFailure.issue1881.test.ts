/**
 * #1881 implementor happy-path guard. These tests slice and execute the real
 * AuthContext classifier and provider callbacks; no production logic is copied.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveAuthFailureCopy } from "../../constants/authFailureCopy";

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "AuthContext.tsx"), "utf8");

const stripComments = (value: string): string =>
  value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const between = (start: string, end: string): string => {
  const from = SOURCE.indexOf(start);
  const to = SOURCE.indexOf(end, from + start.length);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return SOURCE.slice(from, to);
};

const classifierBody = (): string => {
  const match = SOURCE.match(
    /const classifyAuthFailure = \([\s\S]*?\): AuthFailureClass => \{\n([\s\S]*?)\n\};/,
  );
  expect(match).not.toBeNull();
  return match![1];
};

const classify = (
  errName: unknown,
  errCode: unknown,
  errStatus: unknown,
  errMessage: unknown,
  platformOS: string,
): string => {
  const compiled = new Function(
    "errName",
    "errCode",
    "errStatus",
    "errMessage",
    "platformOS",
    `"use strict";${classifierBody()}`,
  ) as (...args: unknown[]) => string;
  return compiled(errName, errCode, errStatus, errMessage, platformOS);
};

const eraseFunctionTypes = (value: string): string =>
  value
    .replace(/catch \(err: unknown\)/g, "catch (err)")
    .replace(/\(err as \{[^}]*\}\)/g, "(err)");

const callbackBody = (start: string, end: string): string => {
  const chunk = between(start, end);
  const match = chunk.match(
    /useCallback\(async \(\): Promise<\{ error: Error \| null \}> => \{\n([\s\S]*)\n {2}\}, \[\]\);/,
  );
  expect(match).not.toBeNull();
  return eraseFunctionTypes(match![1]);
};

const googleBody = (): string =>
  callbackBody(
    "const signInWithGoogle = useCallback",
    "const signInWithApple = useCallback",
  );

const appleBody = (): string =>
  callbackBody(
    "const signInWithApple = useCallback",
    "const signInWithEmail = useCallback",
  );

const compileCallback = (
  body: string,
  deps: Record<string, unknown>,
): (() => Promise<{ error: Error | null }>) => {
  const names = Object.keys(deps);
  const factory = new Function(
    ...names,
    `"use strict"; return async function () {\n${body}\n};`,
  ) as (...args: unknown[]) => () => Promise<{ error: Error | null }>;
  return factory(...names.map((name) => deps[name]));
};

const statusCodes = Object.freeze({
  SIGN_IN_CANCELLED: "12501",
  IN_PROGRESS: "ASYNC_OP_IN_PROGRESS",
  PLAY_SERVICES_NOT_AVAILABLE: "PLAY_SERVICES_NOT_AVAILABLE",
  SIGN_IN_REQUIRED: "4",
  NULL_PRESENTER: "NULL_PRESENTER",
});

const shouldReportAuthFailure = (code: unknown): boolean =>
  typeof code !== "string" ||
  ![
    statusCodes.SIGN_IN_CANCELLED,
    statusCodes.IN_PROGRESS,
    statusCodes.PLAY_SERVICES_NOT_AVAILABLE,
    "ERR_REQUEST_CANCELED",
  ].includes(code);

const authError = (
  name: string,
  status: number | undefined,
  message = "transport failed",
): Error & { status?: number; code?: string } => {
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.name = name;
  error.status = status;
  return error;
};

interface HarnessOptions {
  readonly platform?: "android" | "ios" | "web";
  readonly exchanges?: readonly { data: unknown; error: unknown }[];
  readonly providerError?: Error & { code?: string };
  readonly existingSession?: unknown;
  readonly activeRef?: { current: boolean };
  readonly appState?: { currentState: string | null };
}

const makeGoogleHarness = (options: HarnessOptions = {}) => {
  const platform = options.platform ?? "android";
  const alert = jest.fn();
  const report = jest.fn();
  const signIn = options.providerError
    ? jest.fn(async () => Promise.reject(options.providerError))
    : jest.fn(async () => ({ type: "success", data: { user: { id: "g1" } } }));
  const exchanges = [...(options.exchanges ?? [{ data: { session: { user: { id: "u1" } } }, error: null }])];
  const signInWithIdToken = jest.fn(async (_credentials: { provider: string; token: string }) =>
    exchanges.shift() ?? { data: null, error: new Error("unexpected exchange") },
  );
  const getSession = jest.fn(async () => ({
    data: { session: options.existingSession ?? null },
  }));
  const oauth = jest.fn(async () => ({ error: null }));
  const GoogleSignin = {
    hasPlayServices: jest.fn(async () => true),
    hasPreviousSignIn: jest.fn(async () => false),
    signOut: jest.fn(async () => undefined),
    signIn,
    getTokens: jest.fn(async () => ({ idToken: "google-token" })),
  };
  const deps: Record<string, unknown> = {
    Platform: { OS: platform, Version: platform === "ios" ? "18.2" : 34 },
    AppState: options.appState ?? { currentState: "active" },
    Alert: { alert },
    GoogleSignin,
    supabase: {
      auth: { signInWithIdToken, getSession, signInWithOAuth: oauth },
    },
    buildWebRedirectTo: () => "https://biz.usemingla.com/auth/callback",
    webClientId: "123-client.apps.googleusercontent.com",
    statusCodes,
    shouldReportAuthFailure,
    reportNonFatal: report,
    classifyAuthFailure: classify,
    TRANSPORT_RETRY_MAX_ATTEMPTS: 2,
    TRANSPORT_RETRY_DELAYS_MS: Object.freeze([400, 1200]),
    authLifetimeActiveRef: options.activeRef ?? { current: true },
    resolveAuthFailureCopy,
  };
  return {
    run: compileCallback(googleBody(), deps),
    alert,
    report,
    signIn,
    providerCall: signIn,
    signInWithIdToken,
    getSession,
    oauth,
    GoogleSignin,
  };
};

const makeAppleHarness = (options: HarnessOptions = {}) => {
  const platform = options.platform ?? "ios";
  const alert = jest.fn();
  const report = jest.fn();
  const signInAsync = options.providerError
    ? jest.fn(async () => Promise.reject(options.providerError))
    : jest.fn(async () => ({ identityToken: "apple-token", fullName: null }));
  const exchanges = [...(options.exchanges ?? [{ data: { session: { user: { id: "u1" } } }, error: null }])];
  const signInWithIdToken = jest.fn(async (_credentials: { provider: string; token: string }) =>
    exchanges.shift() ?? { data: null, error: new Error("unexpected exchange") },
  );
  const oauth = jest.fn(async () => ({ error: null }));
  const deps: Record<string, unknown> = {
    Platform: { OS: platform, Version: platform === "ios" ? "18.2" : 34 },
    AppState: options.appState ?? { currentState: "active" },
    Alert: { alert },
    AppleAuthentication: {
      isAvailableAsync: jest.fn(async () => true),
      signInAsync,
      AppleAuthenticationScope: { FULL_NAME: "full", EMAIL: "email" },
    },
    supabase: {
      auth: { signInWithIdToken, signInWithOAuth: oauth },
      from: jest.fn(() => ({
        update: jest.fn(() => ({ eq: jest.fn(async () => undefined) })),
      })),
    },
    buildWebRedirectTo: () => "https://biz.usemingla.com/auth/callback",
    shouldReportAuthFailure,
    reportNonFatal: report,
    classifyAuthFailure: classify,
    TRANSPORT_RETRY_MAX_ATTEMPTS: 2,
    TRANSPORT_RETRY_DELAYS_MS: Object.freeze([400, 1200]),
    authLifetimeActiveRef: options.activeRef ?? { current: true },
    resolveAuthFailureCopy,
  };
  return { run: compileCallback(appleBody(), deps), alert, report, signInAsync, providerCall: signInAsync, signInWithIdToken, oauth };
};

const permanentAlert = [
  "Couldn't sign you in",
  "That didn't work this time. Give it another tap — if it keeps happening, reach us at support@usemingla.com.",
  [{ text: "Got it" }],
];

const exhaustedAlert = [
  "Still couldn't sign you in",
  "We tried again and couldn't get through. Check your connection, then give it another tap in a moment.",
  [{ text: "Got it" }],
];

describe("#1881 classifier and frozen copy", () => {
  it("SC-1/2/3 — exact classifier matrix keeps unknown and iOS Google codes permanent", () => {
    expect(classify("AuthRetryableFetchError", undefined, 0, "x", "android")).toBe("transient-transport-offline");
    expect(classify("AuthRetryableFetchError", undefined, undefined, "x", "ios")).toBe("transient-transport-offline");
    expect(classify("AuthRetryableFetchError", undefined, 504, "x", "android")).toBe("transient-transport-remote");
    for (const code of ["7", "8", "15"]) {
      expect(classify("Error", code, undefined, "x", "android")).toBe("transient-provider");
      expect(classify("Error", code, undefined, "x", "ios")).toBe("permanent");
    }
    for (const code of ["10", "14", "12500", "getTokens", "NULL_PRESENTER", undefined, 8, {}]) {
      expect(classify("Error", code, undefined, "x", "android")).toBe("permanent");
    }
    expect(classify("Error", undefined, undefined, "Network request failed", "ios")).toBe("transient-transport-offline");
    expect(classify("Error", undefined, undefined, "prefix Network request failed", "ios")).toBe("permanent");
  });

  it("SC-2/8 — executable classifier has no nonexistent SDK names and loop is counter bounded", () => {
    expect(stripComments(classifierBody())).not.toMatch(/statusCodes\.(INTERNAL_ERROR|NETWORK_ERROR|TIMEOUT)/);
    const executable = stripComments(SOURCE);
    expect(executable.match(/transportRetryAttempts < TRANSPORT_RETRY_MAX_ATTEMPTS/g)).toHaveLength(2);
    expect(executable.match(/transportRetryAttempts \+= 1/g)).toHaveLength(2);
    expect(executable.match(/if \(retryCancelled\(\)\)/g)).toHaveLength(4);
    expect(executable.match(/GoogleSignin\.signIn\(\)/g)).toHaveLength(1);
    expect(executable.match(/AppleAuthentication\.signInAsync\(/g)).toHaveLength(1);
  });

  it("SC-11 — the Business registry resolves the exact eight fixed values", () => {
    expect(resolveAuthFailureCopy("auth:welcome.sign_in_failed_title")).toBe("Couldn't sign you in");
    expect(resolveAuthFailureCopy("auth:welcome.sign_in_failed_body")).toBe("Something didn't connect. Give it another tap.");
    expect(resolveAuthFailureCopy("auth:welcome.sign_in_failed_ok")).toBe("Got it");
    expect(resolveAuthFailureCopy("auth:welcome.sign_in_offline_title")).toBe("You're offline");
    expect(resolveAuthFailureCopy("auth:welcome.sign_in_offline_body")).toBe("We couldn't reach Mingla. Check your connection and give it another tap.");
    expect(resolveAuthFailureCopy("auth:welcome.sign_in_retry_exhausted_title")).toBe("Still couldn't sign you in");
    expect(resolveAuthFailureCopy("auth:welcome.sign_in_retry_exhausted_body")).toBe("We tried again and couldn't get through. Check your connection, then give it another tap in a moment.");
    expect(resolveAuthFailureCopy("auth:welcome.sign_in_permanent_body")).toBe("That didn't work this time. Give it another tap — if it keeps happening, reach us at support@usemingla.com.");
  });
});

describe("#1881 real provider callbacks", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each(["google", "apple"] as const)("SC-4 — %s status-0 exchange retries once then succeeds without Alert/capture", async (provider) => {
    const options = {
      exchanges: [
        { data: null, error: authError("AuthRetryableFetchError", 0) },
        { data: { session: { user: { id: "u1" } } }, error: null },
      ],
    };
    const harness = provider === "google" ? makeGoogleHarness(options) : makeAppleHarness(options);
    const pending = harness.run();
    await jest.advanceTimersByTimeAsync(400);
    await expect(pending).resolves.toEqual({ error: null });
    expect(harness.signInWithIdToken).toHaveBeenCalledTimes(2);
    expect(harness.signInWithIdToken.mock.calls[0][0]).toEqual(harness.signInWithIdToken.mock.calls[1][0]);
    expect(harness.alert).not.toHaveBeenCalled();
    expect(harness.report).not.toHaveBeenCalled();
  });

  it.each(["google", "apple"] as const)("SC-5/7/13 — %s exhausts at three exchanges, one provider call, one fixed Alert and one capture", async (provider) => {
    const failure = () => ({ data: null, error: authError("AuthRetryableFetchError", 504) });
    const harness = provider === "google"
      ? makeGoogleHarness({ exchanges: [failure(), failure(), failure()] })
      : makeAppleHarness({ exchanges: [failure(), failure(), failure()] });
    const pending = harness.run();
    await jest.advanceTimersByTimeAsync(1600);
    await pending;
    expect(harness.signInWithIdToken).toHaveBeenCalledTimes(3);
    expect(harness.providerCall).toHaveBeenCalledTimes(1);
    expect(harness.alert).toHaveBeenCalledTimes(1);
    expect(harness.alert).toHaveBeenCalledWith(...exhaustedAlert);
    expect(harness.report).toHaveBeenCalledTimes(1);
  });

  it.each(["google", "apple"] as const)("SC-6/11 — %s unknown exchange error is permanent, un-retried, opaque", async (provider) => {
    const secret = "https://gqnoajqerqhnvulmnyvv.supabase.co/blob/secret";
    const harness = provider === "google"
      ? makeGoogleHarness({ exchanges: [{ data: null, error: new Error(secret) }] })
      : makeAppleHarness({ exchanges: [{ data: null, error: new Error(secret) }] });
    await harness.run();
    expect(harness.signInWithIdToken).toHaveBeenCalledTimes(1);
    expect(harness.alert).toHaveBeenCalledWith(...permanentAlert);
    expect(JSON.stringify(harness.alert.mock.calls)).not.toContain(secret);
    expect(harness.report).toHaveBeenCalledTimes(1);
  });

  it("SC-2/7 — Android provider code 8 is fixed transient copy and never replays picker", async () => {
    const providerError = Object.assign(new Error("raw GMS text"), { code: "8" });
    const harness = makeGoogleHarness({ providerError });
    await harness.run();
    expect(harness.signIn).toHaveBeenCalledTimes(1);
    expect(harness.signInWithIdToken).not.toHaveBeenCalled();
    expect(harness.alert).toHaveBeenCalledWith(
      "Couldn't sign you in",
      "Something didn't connect. Give it another tap.",
      [{ text: "Got it" }],
    );
    expect(harness.report).toHaveBeenCalledTimes(1);
  });

  it.each(["before", "after"] as const)("SC-9 — cancellation %s delay suppresses only Alert while preserving capture", async (checkpoint) => {
    const activeRef = { current: checkpoint !== "before" };
    const appState = { currentState: "active" };
    const failure = authError("AuthRetryableFetchError", 0);
    const harness = makeGoogleHarness({
      exchanges: [{ data: null, error: failure }, { data: null, error: failure }],
      activeRef,
      appState,
    });
    const pending = harness.run();
    if (checkpoint === "after") {
      appState.currentState = "background";
      await jest.advanceTimersByTimeAsync(400);
    }
    await pending;
    expect(harness.signInWithIdToken).toHaveBeenCalledTimes(1);
    expect(harness.alert).not.toHaveBeenCalled();
    expect(harness.report).toHaveBeenCalledTimes(1);
  });

  it("SC-9 — inactive never cancels and background is read fresh", async () => {
    const appState = { currentState: "inactive" };
    const failure = () => ({ data: null, error: authError("AuthRetryableFetchError", 0) });
    const harness = makeAppleHarness({
      appState,
      exchanges: [failure(), { data: { session: { user: { id: "u1" } } }, error: null }],
    });
    const pending = harness.run();
    await jest.advanceTimersByTimeAsync(400);
    await pending;
    expect(harness.signInWithIdToken).toHaveBeenCalledTimes(2);
    expect(harness.alert).not.toHaveBeenCalled();
  });

  it("SC-10 — Google existing-user reconciliation remains a distinct second exchange", async () => {
    const existing = new Error("already exists");
    const session = { user: { id: "existing" } };
    const harness = makeGoogleHarness({
      exchanges: [
        { data: null, error: existing },
        { data: { session, user: session.user }, error: null },
      ],
    });
    const pending = harness.run();
    await jest.advanceTimersByTimeAsync(200);
    await pending;
    expect(harness.signInWithIdToken).toHaveBeenCalledTimes(2);
    expect(harness.getSession).toHaveBeenCalledTimes(1);
    expect(harness.alert).not.toHaveBeenCalled();
  });

  it.each(["google", "apple"] as const)("SC-14 — %s web path redirects before any native provider behavior", async (provider) => {
    const harness = provider === "google"
      ? makeGoogleHarness({ platform: "web" })
      : makeAppleHarness({ platform: "web" });
    await harness.run();
    expect(harness.oauth).toHaveBeenCalledTimes(1);
    expect(harness.signInWithIdToken).not.toHaveBeenCalled();
    expect(harness.providerCall).not.toHaveBeenCalled();
    expect(harness.alert).not.toHaveBeenCalled();
  });
});
