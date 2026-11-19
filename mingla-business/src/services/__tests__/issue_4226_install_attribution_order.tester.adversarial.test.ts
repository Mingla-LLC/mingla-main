/**
 * #4226 adversarial (Host app twin of the Explorer test): on a first sign-in the
 * attribution RPC can run before the device row exists. The server then reports
 * "no row" without an error (here: no boolean answer). The client must not treat
 * that as sent; the post-upsert flush has to land it on the device row.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const rt: {
  rows: Map<string, Record<string, unknown>>;
  rpcCalls: string[];
  initOk: ((r: unknown) => void) | null;
  conversionCb: ((r: unknown) => void) | null;
} = { rows: new Map(), rpcCalls: [], initOk: null, conversionCb: null };

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) },
}));
jest.mock("react-native-appsflyer", () => ({
  __esModule: true,
  default: {
    initSdk: jest.fn((_c: unknown, ok: (r: unknown) => void) => { rt.initOk = ok; }),
    onDeepLink: jest.fn(() => () => {}),
    onInstallConversionData: jest.fn((cb: (r: unknown) => void) => { rt.conversionCb = cb; return () => {}; }),
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
  useAnalyticsPrefsStore: { getState: () => ({ analyticsOptOut: false }), subscribe: () => () => {} },
}));
jest.mock("../oneSignalService", () => ({ onPushSubscriptionToken: () => {} }));
jest.mock("../supabase", () => ({
  supabase: {
    // Models the "update only if the row exists, no error, no answer" server.
    rpc: jest.fn(async (name: string, args: Record<string, unknown>) => {
      rt.rpcCalls.push(name);
      const row = rt.rows.get(`host-1:${String(args.p_app)}:${String(args.p_appsflyer_id)}`);
      if (row && row.media_source == null) row.media_source = (args.p_payload as Record<string, unknown>).media_source;
      return { error: null };
    }),
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: "host-1", email: "h@e.co" } } })),
      getSession: jest.fn(async () => ({ data: { session: null } })),
    },
    from: jest.fn(() => ({
      upsert: jest.fn((row: Record<string, unknown>) =>
        new Promise((resolve) => {
          // lands on the server after the RPC request (call order at sign-in)
          setTimeout(() => {
            rt.rows.set(`${String(row.user_id)}:${String(row.app)}:${String(row.appsflyer_uid)}`, { ...row, media_source: null });
            resolve({ error: null });
          }, 0);
        })),
    })),
  },
}));

describe("#4226 adversarial: Host first sign-in keeps the install attribution", () => {
  beforeEach(() => {
    jest.resetModules();
    rt.rows = new Map();
    rt.rpcCalls = [];
    rt.initOk = null;
    rt.conversionCb = null;
    process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = "k";
    process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID = "6768737367";
    process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID = "com.sethogieva.minglabusiness";
  });

  test("an RPC that ran before the device row existed is retried after the device upsert", async () => {
    const svc = await import("../appsFlyerService");
    svc.initializeAppsFlyer();
    rt.initOk?.({});
    rt.conversionCb?.({ type: "onInstallConversionDataLoaded", data: { af_status: "Non-organic", media_source: "Facebook Ads" } });
    svc.setAppsFlyerUserId("host-1");
    svc.registerAppsFlyerDevice("host-1");
    await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    const row = rt.rows.get("host-1:business:af-host-uid");
    expect(row?.user_id).toBe("host-1");
    expect(row?.media_source).toBe("Facebook Ads");
  });
});
