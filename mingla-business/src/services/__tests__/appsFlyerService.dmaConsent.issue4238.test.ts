// MINGLA-INVARIANT: I-4238-AF-DMA-CONSENT | issue #4238 | on an EU / EEA / UK device the Host app gives AppsFlyer DMA consent data (setConsentData) from its Analytics switch before initSdk (this app transmits at init) and on every change; elsewhere it says GDPR does not apply.
/**
 * #4238 P2-2 (W6-6). setConsentData was never called, so AppsFlyer had no DMA
 * consent signal for European Host app installs.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

type InitOk = (r: unknown) => void;
const rt: {
  initOk: InitOk | null;
  optOut: boolean;
  listeners: Array<(s: { analyticsOptOut: boolean }, p: { analyticsOptOut: boolean }) => void>;
  upserts: Array<Record<string, unknown>>;
  updates: Array<{ values: Record<string, unknown>; filters: Record<string, unknown> }>;
} = { initOk: null, optOut: false, listeners: [], upserts: [], updates: [] };
const order: string[] = [];
const mockSetConsentData = jest.fn((_c: unknown) => {
  order.push("setConsentData");
});

jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) },
}));
jest.mock("react-native-appsflyer", () => ({
  __esModule: true,
  default: {
    initSdk: jest.fn((_c: unknown, ok: InitOk) => {
      order.push("initSdk");
      rt.initOk = ok;
    }),
    setConsentData: (c: unknown) => mockSetConsentData(c),
    onDeepLink: jest.fn(() => () => {}),
    setOneLinkCustomDomains: jest.fn(),
    performOnDeepLinking: jest.fn(),
    setCustomerUserId: jest.fn(),
    getAppsFlyerUID: jest.fn((cb: (e: unknown, uid: string) => void) => cb(null, "af-host-uid")),
    logEvent: jest.fn(),
    setUserEmails: jest.fn((_o: unknown, ok: (r: unknown) => void) => ok({})),
    anonymizeUser: jest.fn(),
    updateServerUninstallToken: jest.fn(),
  },
}));
jest.mock("../../store/analyticsPrefsStore", () => ({
  useAnalyticsPrefsStore: {
    getState: () => ({ analyticsOptOut: rt.optOut }),
    subscribe: (l: (s: { analyticsOptOut: boolean }, p: { analyticsOptOut: boolean }) => void) => {
      rt.listeners.push(l);
      return () => {};
    },
  },
}));
jest.mock("../oneSignalService", () => ({ onPushSubscriptionToken: () => {} }));
jest.mock("../supabase", () => ({
  supabase: {
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: "host-1", email: "h@e.co" } } })),
      getSession: jest.fn(async () => ({ data: { session: null } })),
    },
    from: jest.fn(() => ({
      upsert: jest.fn((row: Record<string, unknown>) => {
        rt.upserts.push(row);
        return Promise.resolve({ error: null });
      }),
      update: jest.fn((values: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const chain = {
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return chain;
          },
          then: (f: (r: unknown) => unknown, r?: (e: unknown) => unknown) => {
            rt.updates.push({ values, filters });
            return Promise.resolve({ error: null }).then(f, r);
          },
        };
        return chain;
      }),
    })),
  },
}));

const importService = async () => import("../appsFlyerService");
const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};
const setOptOut = (next: boolean) => {
  const prev = rt.optOut;
  rt.optOut = next;
  for (const l of rt.listeners) l({ analyticsOptOut: next }, { analyticsOptOut: prev });
};
const realDateTimeFormat = Intl.DateTimeFormat;
const withLocale = (locale: string) => {
  (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function () {
    return { resolvedOptions: () => ({ locale }) };
  } as unknown;
};

describe("#4238 P2-2 Host app AppsFlyer DMA consent", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    order.length = 0;
    Object.assign(rt, { initOk: null, optOut: false, listeners: [], upserts: [], updates: [] });
    process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = "k";
    process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID = "6768737367";
    process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID = "com.sethogieva.minglabusiness";
  });
  afterEach(() => {
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = realDateTimeFormat;
  });

  test("a UK device sets consent before initSdk and again when Analytics is switched off", async () => {
    withLocale("en-GB");
    const svc = await importService();
    svc.initializeAppsFlyer();
    expect(order.slice(0, 2)).toEqual(["setConsentData", "initSdk"]);
    expect(mockSetConsentData.mock.calls[0][0]).toEqual({
      isUserSubjectToGDPR: true,
      hasConsentForDataUsage: true,
      hasConsentForAdsPersonalization: true,
      hasConsentForAdStorage: true,
    });
    rt.initOk?.({});
    setOptOut(true);
    await flush();
    expect(mockSetConsentData.mock.calls.at(-1)?.[0]).toEqual({
      isUserSubjectToGDPR: true,
      hasConsentForDataUsage: false,
      hasConsentForAdsPersonalization: false,
      hasConsentForAdStorage: false,
    });
  });

  test("a Nigerian device tells AppsFlyer GDPR does not apply", async () => {
    withLocale("en-NG");
    const svc = await importService();
    svc.initializeAppsFlyer();
    expect(mockSetConsentData.mock.calls[0][0]).toEqual({ isUserSubjectToGDPR: false });
  });
});
