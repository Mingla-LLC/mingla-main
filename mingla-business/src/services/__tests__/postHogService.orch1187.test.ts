// META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 3 happy-path regression
// (business app). Implementor-owned (the tester writes a second, adversarial
// one). Behavioral: proves the postHogService facade (1) no-ops gracefully when
// the key is absent (T-10) and never constructs a client, and (2) routes the
// Settings opt-out/opt-in to the underlying client (T-19 / §4.F(b)).
//
// posthog-react-native is dynamically imported, so we mock it; expo-constants +
// react-native Platform are mocked so the node-env test can import the service.

const mockOptOut = jest.fn();
const mockOptIn = jest.fn();
const mockCapture = jest.fn();
const mockIdentify = jest.fn();
const mockReset = jest.fn();
const mockCtor = jest.fn();

// extra holder so individual tests can set/clear the key before importing.
const extraHolder: { extra: Record<string, string | undefined> } = { extra: {} };

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

// The store is read at init for the persisted opt-out — mock it opted-IN.
jest.mock("../../store/analyticsPrefsStore", () => ({
  useAnalyticsPrefsStore: {
    getState: () => ({ analyticsOptOut: false }),
  },
}));

describe("postHogService (META-ORCH-1187 native)", () => {
  beforeEach(() => {
    jest.resetModules();
    extraHolder.extra = {};
    mockCtor.mockClear();
    mockOptOut.mockClear();
    mockOptIn.mockClear();
    mockCapture.mockClear();
  });

  it("no-ops gracefully when the PostHog key is absent (T-10) — no client built", async () => {
    extraHolder.extra = {}; // key missing
    const { postHogService } = await import("../postHogService");
    await postHogService.initialize();
    expect(mockCtor).not.toHaveBeenCalled();
    expect(postHogService.isReady()).toBe(false);
    // capture / identify must be safe no-ops (never throw) while un-inited.
    expect(() => postHogService.capture("x")).not.toThrow();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("constructs the client with masked replay + US host when the key is present", async () => {
    extraHolder.extra = { EXPO_PUBLIC_POSTHOG_KEY: "phc_test_key" };
    const { postHogService } = await import("../postHogService");
    await postHogService.initialize();
    expect(mockCtor).toHaveBeenCalledTimes(1);
    const [key, opts] = mockCtor.mock.calls[0] as [string, Record<string, unknown>];
    expect(key).toBe("phc_test_key");
    expect(opts.host).toBe("https://us.i.posthog.com");
    expect(opts.enableSessionReplay).toBe(true);
    const replay = opts.sessionReplayConfig as Record<string, unknown>;
    expect(replay.maskAllTextInputs).toBe(true);
    expect(replay.maskAllImages).toBe(true);
  });

  it("routes the Settings opt-out toggle to the client (T-19)", async () => {
    extraHolder.extra = { EXPO_PUBLIC_POSTHOG_KEY: "phc_test_key" };
    const { postHogService } = await import("../postHogService");
    await postHogService.initialize();
    postHogService.optOut();
    expect(mockOptOut).toHaveBeenCalledTimes(1);
    postHogService.optIn();
    expect(mockOptIn).toHaveBeenCalledTimes(1);
  });
});
