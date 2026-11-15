// MINGLA-INVARIANT: I-4238-AF-SERVER-RESPECTS-OPT-OUT | issue #4238 | the Host app writes its Analytics choice to appsflyer_devices.tracking_opt_out on registration and on every change, so the server's first-sale, payout and dispute AppsFlyer posts skip an opted-out host.
/**
 * #4238 P2-4. The Host app Analytics switch only anonymized the SDK; the
 * server kept posting mingla_host_first_sale and the payout events with the
 * host's AppsFlyer id.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

type InitOk = (r: unknown) => void;
const rt: {
  initOk: InitOk | null;
  optOut: boolean;
  listeners: Array<(s: { analyticsOptOut: boolean }, p: { analyticsOptOut: boolean }) => void>;
  upserts: Array<Record<string, unknown>>;
  updates: Array<{ values: Record<string, unknown>; filters: Record<string, unknown> }>;
  serverHasOptOutColumn: boolean;
} = { initOk: null, optOut: false, listeners: [], upserts: [], updates: [], serverHasOptOutColumn: true };

jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}) },
}));
jest.mock("react-native-appsflyer", () => ({
  __esModule: true,
  default: {
    initSdk: jest.fn((_c: unknown, ok: InitOk) => {
      rt.initOk = ok;
    }),
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
        // #4238 P2-R1: a server older than M-2 rejects the unknown column.
        const error = !rt.serverHasOptOutColumn && "tracking_opt_out" in row
          ? {
              code: "PGRST204",
              message: "Could not find the 'tracking_opt_out' column of 'appsflyer_devices' in the schema cache",
            }
          : null;
        return Promise.resolve({ error });
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

describe("#4238 P2-4 Host app opt-out reaches the server", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    Object.assign(rt, {
      initOk: null,
      optOut: false,
      listeners: [],
      upserts: [],
      updates: [],
      serverHasOptOutColumn: true,
    });
    process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = "k";
    process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID = "6768737367";
    process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID = "com.sethogieva.minglabusiness";
  });

  test.each([true, false])("the device row carries the switch at registration (opted out: %s)", async (optOut) => {
    rt.optOut = optOut;
    const svc = await importService();
    svc.initializeAppsFlyer();
    rt.initOk?.({});
    svc.setAppsFlyerUserId("host-1");
    svc.registerAppsFlyerDevice("host-1");
    await flush();
    expect(rt.upserts).toHaveLength(1);
    expect(rt.upserts[0]).toMatchObject({ app: "business", tracking_opt_out: optOut });
  });

  test("switching Analytics off (and on) updates only this install's Host app device row (P3-R2)", async () => {
    const svc = await importService();
    svc.initializeAppsFlyer();
    rt.initOk?.({});
    svc.setAppsFlyerUserId("host-1");
    setOptOut(true);
    await flush();
    expect(rt.updates).toEqual([
      {
        values: { app: "business", tracking_opt_out: true },
        filters: { user_id: "host-1", app: "business", appsflyer_uid: "af-host-uid" },
      },
    ]);
    setOptOut(false);
    await flush();
    expect(rt.updates.at(-1)?.values).toEqual({ app: "business", tracking_opt_out: false });
    svc.clearAppsFlyerUserId();
    setOptOut(true);
    await flush();
    expect(rt.updates).toHaveLength(2);
  });

  test("P2-R1: a server without tracking_opt_out still gets the device row (retried without the column)", async () => {
    rt.optOut = true;
    rt.serverHasOptOutColumn = false;
    const svc = await importService();
    svc.initializeAppsFlyer();
    rt.initOk?.({});
    svc.setAppsFlyerUserId("host-1");
    svc.registerAppsFlyerDevice("host-1");
    await flush();
    expect(rt.upserts).toHaveLength(2);
    expect(rt.upserts[0]).toMatchObject({ tracking_opt_out: true });
    expect("tracking_opt_out" in (rt.upserts[1] ?? {})).toBe(false);
    expect(rt.upserts[1]).toMatchObject({ app: "business", appsflyer_uid: "af-host-uid" });
  });
});
