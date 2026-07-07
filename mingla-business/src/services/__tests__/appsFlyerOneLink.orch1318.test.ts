// ORCH-1318 [appsflyer-onelink-deferred-deeplinking] — BUSINESS B1 fails-on-revert
// guard (implementor-owned). Proves the business half of §A.2 / §B.3 / §C.1:
//
//   1. `onDeepLink` is registered inside `initializeAppsFlyer` (listener enabled)
//      and a FOUND payload is FORWARDED to the UI sink; a NOT_FOUND payload is
//      IGNORED (no sink call, no navigation).                          [§A.2 / §A.6]
//   2. The §A.4.3 buffered-flush delivers a FOUND that resolved BEFORE the sink
//      registered — exactly once.                                      [§A.4.3]
//   3. The branded OneLink domain `go.usemingla.com` is registered via
//      `setOneLinkCustomDomains`.                                      [§C.1]
//   4. The pure `resolveBusinessOneLinkDestination` maps the §B.1 payload contract
//      (referral / af_sub1 piggyback / universal-download / empty).    [§B.1 / §B.3]
//
// Reverting `onDeepLinkListener` to `false` / removing the subscription makes (1)
// fail; removing the extended `AppsFlyerSdk` methods (`onDeepLink` /
// `setOneLinkCustomDomains` / `performOnDeepLinking`) makes the service fail to
// TYPECHECK, so ts-jest cannot import it and EVERY test here fails — that import
// is the "extended type calls typecheck" guard.
//
// react-native Platform + the AppsFlyer native module + ./supabase are mocked so
// the node-env ts-jest test can import the service (mirrors postHogService.orch1187).

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

// `__DEV__` is a Metro-injected global (always defined in RN runtimes); node/
// ts-jest does not provide it, so the service's `if (__DEV__)` logs would throw
// ReferenceError. Define it here so the full init success path executes.
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

type OneLinkRes = {
  deepLinkStatus?: string;
  isDeferred?: boolean;
  data?: Record<string, unknown>;
};

// Shared holder — lets a test invoke the exact callback the service registered.
const sdkState: {
  onDeepLinkCb: ((res: OneLinkRes) => void) | null;
  initSdkSuccess: boolean;
} = { onDeepLinkCb: null, initSdkSuccess: true };

const mockOnDeepLink = jest.fn(
  (cb: (res: OneLinkRes) => void): (() => void) => {
    sdkState.onDeepLinkCb = cb;
    return () => {};
  },
);

const mockInitSdk = jest.fn(
  (
    _cfg: unknown,
    ok: (r: unknown) => void,
    fail: (e: unknown) => void,
  ): void => {
    if (sdkState.initSdkSuccess) ok({ status: "ok" });
    else fail(new Error("init failed"));
  },
);

const mockSetOneLinkCustomDomains = jest.fn(
  (_domains: string[], ok: (r: unknown) => void): void => ok({}),
);

const mockPerformOnDeepLinking = jest.fn();

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
}));

jest.mock("react-native-appsflyer", () => ({
  __esModule: true,
  default: {
    initSdk: mockInitSdk,
    onDeepLink: mockOnDeepLink,
    setOneLinkCustomDomains: mockSetOneLinkCustomDomains,
    performOnDeepLinking: mockPerformOnDeepLinking,
    setCustomerUserId: jest.fn(),
    getAppsFlyerUID: jest.fn(),
    logEvent: jest.fn(),
  },
}));

// The service imports `./supabase` at module load — stub it so the import graph
// resolves in a node env (the OneLink path never touches it).
jest.mock("../supabase", () => ({
  supabase: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
}));

const setEnv = (): void => {
  process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = "test-devkey";
  process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID = "id-6760440898";
  process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID = "com.sethogieva.minglabusiness";
};

type ServiceModule = typeof import("../appsFlyerService");
const importService = async (): Promise<ServiceModule> =>
  import("../appsFlyerService");

describe("ORCH-1318 business OneLink service (B1)", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    sdkState.onDeepLinkCb = null;
    sdkState.initSdkSuccess = true;
    setEnv();
  });

  // ── §B.1 pure resolver ─────────────────────────────────────────────────────
  test("resolveBusinessOneLinkDestination maps the §B.1 payload contract", async () => {
    const { resolveBusinessOneLinkDestination } = await importService();

    // standalone referral link → referral(code from deep_link_sub1)
    expect(
      resolveBusinessOneLinkDestination({
        deep_link_value: "referral",
        deep_link_sub1: "SETH-8Q2",
      }),
    ).toEqual({ kind: "referral", referralCode: "SETH-8Q2" });

    // case/whitespace-insensitive discriminator
    expect(
      resolveBusinessOneLinkDestination({
        deep_link_value: "  Referral ",
        deep_link_sub1: "REF-1",
      }),
    ).toEqual({ kind: "referral", referralCode: "REF-1" });

    // content/entity link piggybacking a referral in af_sub1 → referral
    expect(
      resolveBusinessOneLinkDestination({
        deep_link_value: "event",
        deep_link_sub1: "sunset-collective",
        deep_link_sub2: "rooftop-nye",
        af_sub1: "REF9",
      }),
    ).toEqual({ kind: "referral", referralCode: "REF9" });

    // universal-download (no discriminator, no referral) → no-op landing
    expect(resolveBusinessOneLinkDestination({})).toEqual({ kind: "download" });

    // content link with NO referral → no-op landing (per-entity routing is B2)
    expect(
      resolveBusinessOneLinkDestination({
        deep_link_value: "trip",
        deep_link_sub1: "brand",
        deep_link_sub2: "trip",
      }),
    ).toEqual({ kind: "download" });

    // empty / missing payload → null
    expect(resolveBusinessOneLinkDestination(undefined)).toBeNull();
    expect(resolveBusinessOneLinkDestination(null)).toBeNull();
  });

  // ── §A.2 / §A.6 forward-FOUND / ignore-NOT_FOUND + §C.1 branded domain ──────
  test("registers onDeepLink + branded domain, forwards FOUND to the sink, ignores NOT_FOUND", async () => {
    const { initializeAppsFlyer, subscribeOneLinkDeepLink } =
      await importService();

    const sink = jest.fn();
    subscribeOneLinkDeepLink(sink);
    initializeAppsFlyer();

    // listener registered (fails-on-revert if the subscription is removed)
    expect(mockOnDeepLink).toHaveBeenCalledTimes(1);
    expect(typeof sdkState.onDeepLinkCb).toBe("function");

    // §A.2.1 — both listeners enabled in the initSdk config (fails-on-revert if
    // either boolean is flipped back to false)
    const initCfg = mockInitSdk.mock.calls[0][0] as Record<string, unknown>;
    expect(initCfg.onDeepLinkListener).toBe(true);
    expect(initCfg.onInstallConversionDataListener).toBe(true);

    // §A.2.3 — the subscription is registered BEFORE initSdk fires transmission
    expect(mockOnDeepLink.mock.invocationCallOrder[0]).toBeLessThan(
      mockInitSdk.mock.invocationCallOrder[0],
    );

    // §C.1 — branded OneLink domain registered
    expect(mockSetOneLinkCustomDomains).toHaveBeenCalledTimes(1);
    expect(mockSetOneLinkCustomDomains.mock.calls[0][0]).toEqual([
      "go.usemingla.com",
    ]);

    // iOS resolves via AppDelegate hooks — no forced Android resolution pass
    expect(mockPerformOnDeepLinking).not.toHaveBeenCalled();

    // FOUND → destination reaches the sink exactly once
    sdkState.onDeepLinkCb?.({
      deepLinkStatus: "FOUND",
      isDeferred: true,
      data: {
        deep_link_value: "referral",
        deep_link_sub1: "SETH-8Q2",
        link: "https://go.usemingla.com/abc",
      },
    });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith({
      kind: "referral",
      referralCode: "SETH-8Q2",
    });

    // NOT_FOUND (organic open) → ignored, sink not called again
    sdkState.onDeepLinkCb?.({
      deepLinkStatus: "NOT_FOUND",
      isDeferred: false,
      data: { link: "https://go.usemingla.com/organic" },
    });
    expect(sink).toHaveBeenCalledTimes(1);
  });

  // ── §A.4.3 buffered flush ───────────────────────────────────────────────────
  test("buffers a FOUND that resolves before the sink registers, flushes once", async () => {
    const { initializeAppsFlyer, subscribeOneLinkDeepLink } =
      await importService();

    // init registers the listener; the deferred hit resolves BEFORE any sink
    initializeAppsFlyer();
    expect(sdkState.onDeepLinkCb).not.toBeNull();

    sdkState.onDeepLinkCb?.({
      deepLinkStatus: "FOUND",
      isDeferred: true,
      data: {
        deep_link_value: "referral",
        deep_link_sub1: "EARLY-1",
        link: "https://go.usemingla.com/early",
      },
    });

    // sink now registers late → receives the buffered destination exactly once
    const sink = jest.fn();
    subscribeOneLinkDeepLink(sink);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith({
      kind: "referral",
      referralCode: "EARLY-1",
    });
  });

  // ── §A.4.1 dedup ────────────────────────────────────────────────────────────
  test("dedups a re-emitted identical link within the window", async () => {
    const { initializeAppsFlyer, subscribeOneLinkDeepLink } =
      await importService();

    const sink = jest.fn();
    subscribeOneLinkDeepLink(sink);
    initializeAppsFlyer();

    const payload: OneLinkRes = {
      deepLinkStatus: "FOUND",
      isDeferred: false,
      data: {
        deep_link_value: "referral",
        deep_link_sub1: "DUP-1",
        link: "https://go.usemingla.com/dup",
      },
    };
    sdkState.onDeepLinkCb?.(payload);
    sdkState.onDeepLinkCb?.(payload); // resume re-emit — same link
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
