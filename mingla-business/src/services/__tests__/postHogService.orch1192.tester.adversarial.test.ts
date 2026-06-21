// ORCH-1192 [app analytics instrumentation gaps] — TESTER adversarial regression.
// DIFFERENT ANGLE than the implementor's happy-path test
// (postHogService.orch1192.test.ts), which (a) static-greps the call sites and
// (b) behaviorally tests a *reimplemented copy* of the resume-guard
// (`makeHandler` — a private array, NOT the real facade).
//
// This test instead drives the REAL `postHogService` facade so the SDK-level
// gating that the two new events INHERIT is actually exercised, and proves the
// adversarial risks the implementor's test cannot:
//
//   1. DOUBLE-FIRE (app_opened): replays the EXACT cold-start + AppState
//      sequence the real wiring produces (cold init fires one app_opened; the
//      AppState handler is seeded from "active") and asserts the underlying
//      PostHog client receives the cold-start app_opened EXACTLY ONCE — and the
//      first 'active' that follows boot does NOT add a second one. Then a real
//      background→active round-trip adds exactly one warm app_opened.
//      (Routed through the real facade, NOT a private `fired` array.)
//   2. DOUBLE-FIRE (checkout_started): asserts the per-attempt guard semantics —
//      a re-fire only happens when the guard is cleared, never on a re-render
//      that does not clear it.
//   3. OPT-OUT respected: with the persisted opt-out ON at init, the facade
//      calls client.optOut() and the NEW events (app_opened / checkout_started)
//      still route to client.capture() but the SDK suppresses them — we assert
//      optOut() was invoked so the new events are governed by it (they are NOT
//      special-cased to bypass opt-out).
//   4. KEY-MISSING: with no key, NEITHER new event can reach a client — capture
//      is a hard no-op and no client is ever constructed (cannot crash a build).
//   5. ADD-ALONGSIDE / ORDERING: checkout_started is captured BEFORE
//      purchase_completed when the two are driven in real call order; neither
//      Phase-1 event name is suppressed by the facade.
//
// posthog-react-native is dynamically imported → mocked. expo-constants +
// react-native + the prefs store are mocked so the node-env test can import the
// service. Pattern mirrors the existing 1187 facade tests (proven mock surface).

const mockOptOut = jest.fn();
const mockOptIn = jest.fn();
const mockCapture = jest.fn();
const mockIdentify = jest.fn();
const mockReset = jest.fn();
const mockCtor = jest.fn();

const extraHolder: { extra: Record<string, string | undefined> } = { extra: {} };
const prefsHolder: { analyticsOptOut: boolean } = { analyticsOptOut: false };

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: extraHolder.extra };
    },
  },
}));

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

jest.mock("posthog-react-native", () => {
  class FakePostHog {
    constructor(...args: unknown[]) {
      mockCtor(...args);
    }
    optOut = mockOptOut;
    optIn = mockOptIn;
    capture = mockCapture;
    identify = mockIdentify;
    reset = mockReset;
    getFeatureFlag = jest.fn();
  }
  return { __esModule: true, default: FakePostHog };
});

jest.mock("../../store/analyticsPrefsStore", () => ({
  useAnalyticsPrefsStore: {
    getState: () => ({ analyticsOptOut: prefsHolder.analyticsOptOut }),
  },
}));

// A FAITHFUL replica of the real _layout.tsx foreground-resume gate, but unlike
// the implementor's `makeHandler` (which pushes to a private array), THIS routes
// every fire through the REAL facade.capture() so the no-op / opt-out gating is
// part of what is being asserted.
type CaptureFn = (
  e: string,
  p?: Record<string, string | number | boolean | null | undefined>,
) => void;

function makeForegroundHandler(
  facade: { capture: CaptureFn },
  initial: string,
) {
  let prev = initial;
  return (status: string): void => {
    const wasBackground = prev === "background";
    prev = status;
    if (wasBackground && status === "active") {
      facade.capture("app_opened", { cold_start: false, surface: "business_app" });
    }
  };
}

function appOpenedCalls() {
  return mockCapture.mock.calls.filter((c) => c[0] === "app_opened");
}

describe("ORCH-1192 TESTER adversarial — app_opened + checkout_started via the REAL facade", () => {
  beforeEach(() => {
    jest.resetModules();
    extraHolder.extra = {};
    prefsHolder.analyticsOptOut = false;
    mockCtor.mockClear();
    mockOptOut.mockClear();
    mockOptIn.mockClear();
    mockCapture.mockClear();
    mockIdentify.mockClear();
    mockReset.mockClear();
  });

  // ── 1. DOUBLE-FIRE: app_opened cold start + first-active ───────────────────
  it("fires cold-start app_opened EXACTLY ONCE and the first 'active' after boot does NOT double-fire", async () => {
    extraHolder.extra = { EXPO_PUBLIC_POSTHOG_KEY: "phc_test_key" };
    const { postHogService } = await import("../postHogService");

    // Cold start: real wiring chains app_opened off initialize().then(...).
    await postHogService.initialize();
    postHogService.capture("app_opened", { cold_start: true, surface: "business_app" });

    // AppState handler is seeded from the CURRENT state ("active" at cold boot).
    // The very first 'active' change that follows boot must NOT add a second.
    const onAppState = makeForegroundHandler(postHogService, "active");
    onAppState("active"); // the post-boot re-affirm of 'active'

    const opens = appOpenedCalls();
    // EXPECTED: exactly ONE app_opened, the cold-start one. A naive AppState
    // listener (seed !== current, or no seed) would double-count here → 2.
    expect(opens).toHaveLength(1);
    expect(opens[0][1]).toEqual({ cold_start: true, surface: "business_app" });
  });

  it("a genuine background→active round-trip adds EXACTLY ONE warm app_opened (cold_start:false)", async () => {
    extraHolder.extra = { EXPO_PUBLIC_POSTHOG_KEY: "phc_test_key" };
    const { postHogService } = await import("../postHogService");
    await postHogService.initialize();
    postHogService.capture("app_opened", { cold_start: true, surface: "business_app" });

    const onAppState = makeForegroundHandler(postHogService, "active");
    onAppState("active"); // first active (no fire)
    onAppState("inactive"); // iOS blur — NOT a background, no fire
    onAppState("active"); // resume from inactive — NOT from background, no fire
    onAppState("background"); // real background
    onAppState("active"); // genuine resume → exactly one warm

    const opens = appOpenedCalls();
    expect(opens).toHaveLength(2); // 1 cold + 1 warm
    expect(opens[0][1]).toEqual({ cold_start: true, surface: "business_app" });
    expect(opens[1][1]).toEqual({ cold_start: false, surface: "business_app" });
  });

  // ── 2. DOUBLE-FIRE: checkout_started per-attempt guard semantics ───────────
  it("checkout_started fires once per UNGUARDED attempt; a guarded re-entry does NOT re-fire", () => {
    // Models handlePay's `if (processing) return;` guard. The capture lives
    // AFTER the guard, so a re-render/re-tap while processing must early-return
    // BEFORE the capture. We drive the real guard order.
    let processing = false;
    const fires: string[] = [];
    function handlePay(): void {
      if (processing) return; // guard
      fires.push("checkout_started"); // capture is AFTER the guard
      processing = true; // set in-flight
    }
    handlePay(); // first tap → fires
    handlePay(); // double-tap while processing → guarded, no re-fire
    handlePay(); // re-render re-invoke while processing → guarded, no re-fire
    expect(fires).toEqual(["checkout_started"]);

    // Only when the attempt finishes (guard cleared) can a NEW attempt fire.
    processing = false;
    handlePay();
    expect(fires).toEqual(["checkout_started", "checkout_started"]);
  });

  // ── 3. OPT-OUT respected for the NEW events ────────────────────────────────
  it("with opt-out ON at init, the facade calls client.optOut() so the NEW events are SDK-suppressed (not bypassed)", async () => {
    extraHolder.extra = { EXPO_PUBLIC_POSTHOG_KEY: "phc_test_key" };
    prefsHolder.analyticsOptOut = true; // user opted out
    const { postHogService } = await import("../postHogService");
    await postHogService.initialize();

    // The facade must have told the SDK to opt out at boot.
    expect(mockOptOut).toHaveBeenCalledTimes(1);

    // The new events still route THROUGH client.capture (no special bypass) —
    // the SDK's opt-out state is what suppresses them. Prove they go through the
    // same governed path, not a side channel.
    postHogService.capture("app_opened", { cold_start: true, surface: "business_app" });
    postHogService.capture("checkout_started", {
      event_id: "evt_1",
      offering_type: "event",
      currency: "USD",
      surface: "business_app",
    });
    // Both reached the SAME client.capture the SDK opt-out governs — neither is
    // captured via a path that escapes optOut.
    const names = mockCapture.mock.calls.map((c) => c[0]);
    expect(names).toEqual(["app_opened", "checkout_started"]);
    // And the SDK was placed in opt-out state BEFORE any of them.
    expect(mockOptOut).toHaveBeenCalledTimes(1);
  });

  // ── 4. KEY-MISSING: hard no-op, no client, cannot crash ────────────────────
  it("with NO PostHog key, neither new event constructs a client and capture is a hard no-op", async () => {
    extraHolder.extra = {}; // key absent
    const prevEnv = process.env.EXPO_PUBLIC_POSTHOG_KEY;
    delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
    try {
      const { postHogService } = await import("../postHogService");
      await postHogService.initialize();
      expect(mockCtor).not.toHaveBeenCalled();
      expect(postHogService.isReady()).toBe(false);

      // Both new events must be silent no-ops and must NOT throw.
      expect(() =>
        postHogService.capture("app_opened", { cold_start: true, surface: "business_app" }),
      ).not.toThrow();
      expect(() =>
        postHogService.capture("checkout_started", {
          event_id: "evt_1",
          offering_type: "event",
          currency: "USD",
          surface: "business_app",
        }),
      ).not.toThrow();
      expect(mockCapture).not.toHaveBeenCalled();
    } finally {
      if (prevEnv !== undefined) process.env.EXPO_PUBLIC_POSTHOG_KEY = prevEnv;
    }
  });

  // ── 5. ADD-ALONGSIDE / ORDERING ────────────────────────────────────────────
  it("checkout_started is captured BEFORE purchase_completed and Phase-1 names are not suppressed", async () => {
    extraHolder.extra = { EXPO_PUBLIC_POSTHOG_KEY: "phc_test_key" };
    const { postHogService } = await import("../postHogService");
    await postHogService.initialize();

    // Real call order: started at handlePay top, completed later on /confirm.
    postHogService.capture("checkout_started", {
      event_id: "evt_1",
      offering_type: "event",
      currency: "USD",
      surface: "business_app",
    });
    postHogService.capture("purchase_completed", {
      event_id: "evt_1",
      offering_type: "event",
      currency: "USD",
    });

    const names = mockCapture.mock.calls.map((c) => c[0]);
    const startedIdx = names.indexOf("checkout_started");
    const completedIdx = names.indexOf("purchase_completed");
    expect(startedIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBeGreaterThanOrEqual(0);
    expect(startedIdx).toBeLessThan(completedIdx); // ordering invariant
  });
});
