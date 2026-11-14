// MINGLA-INVARIANT: I-4238-AF-SUB1-NOT-REFERRAL | issue #4238 | a campaign value in AppsFlyer af_sub1 never becomes a Host referral code; only `ref:<code>` (or a referral link) does, and a first-launch non-organic install's media source, campaign and af_sub1-3 are saved on the device.
/**
 * #4238 W4-3 (B9). Host OneLinks put campaign tags in af_sub1, and the app
 * stored every af_sub1 as a referral code. Install attribution was never kept.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

type ConvRes = { status?: string; type?: string; data?: Record<string, unknown> };
const sdk: { onConv: ((r: ConvRes) => void) | null } = { onConv: null };
const store = new Map<string, string>();

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => store.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
  },
}));
jest.mock("react-native-appsflyer", () => ({
  __esModule: true,
  default: {
    initSdk: jest.fn((_c: unknown, ok: (r: unknown) => void) => ok({})),
    onDeepLink: jest.fn(() => () => {}),
    onInstallConversionData: jest.fn((cb: (r: ConvRes) => void) => {
      sdk.onConv = cb;
      return () => {};
    }),
    setOneLinkCustomDomains: jest.fn(),
    performOnDeepLinking: jest.fn(),
    setCustomerUserId: jest.fn(),
    getAppsFlyerUID: jest.fn(),
    logEvent: jest.fn(),
  },
}));
jest.mock("../supabase", () => ({
  supabase: { auth: { getUser: jest.fn(), getSession: jest.fn() }, from: jest.fn() },
}));

const importService = async () => import("../appsFlyerService");

describe("#4238 W4-3 campaigns are not referral codes; install attribution is saved", () => {
  beforeEach(() => {
    jest.resetModules();
    store.clear();
    sdk.onConv = null;
    process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = "k";
    process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID = "6768737367";
    process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID = "com.sethogieva.minglabusiness";
  });

  test("af_sub1=cmp:host-lagos stores no referral code; af_sub1=ref:ABC stores ABC", async () => {
    const { resolveBusinessOneLinkDestination, referralCodeFromAfSub1 } = await importService();
    expect(resolveBusinessOneLinkDestination({ af_sub1: "cmp:host-lagos" })).toEqual({ kind: "download" });
    expect(resolveBusinessOneLinkDestination({ af_sub1: "host_lagos_nov" })).toEqual({ kind: "download" });
    expect(resolveBusinessOneLinkDestination({ af_sub1: "ref:ABC" })).toEqual({
      kind: "referral",
      referralCode: "ABC",
    });
    expect(referralCodeFromAfSub1("REF:XYZ")).toBe("XYZ");
    expect(referralCodeFromAfSub1("ref:")).toBeNull();
    expect(referralCodeFromAfSub1(undefined)).toBeNull();
    // A referral link still works.
    expect(
      resolveBusinessOneLinkDestination({ deep_link_value: "referral", deep_link_sub1: "SETH" }),
    ).toEqual({ kind: "referral", referralCode: "SETH" });
  });

  test("the first non-organic launch saves media source, campaign and af_sub1-3 once", async () => {
    const { initializeAppsFlyer, HOST_INSTALL_ATTRIBUTION_KEY } = await importService();
    initializeAppsFlyer();
    expect(sdk.onConv).not.toBeNull();
    sdk.onConv?.({
      status: "success",
      data: {
        is_first_launch: true,
        af_status: "Non-organic",
        media_source: "tiktokglobal_int",
        campaign: "host_lagos_nov",
        af_sub1: "cmp:host-lagos",
        af_sub2: "click-123",
        af_sub3: "ttclid",
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    const saved = JSON.parse(store.get(HOST_INSTALL_ATTRIBUTION_KEY) ?? "null");
    expect(saved).toEqual(
      expect.objectContaining({
        media_source: "tiktokglobal_int",
        campaign: "host_lagos_nov",
        af_sub1: "cmp:host-lagos",
        af_sub2: "click-123",
        af_sub3: "ttclid",
        surface: "ios",
      }),
    );
    // A later launch (or a second payload) never overwrites the first install.
    sdk.onConv?.({ data: { is_first_launch: true, af_status: "Non-organic", media_source: "other" } });
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(store.get(HOST_INSTALL_ATTRIBUTION_KEY) ?? "{}").media_source).toBe("tiktokglobal_int");
  });

  test("organic installs and later launches save nothing", async () => {
    const { installAttributionFromConversionData } = await importService();
    const now = "2026-11-14T00:00:00.000Z";
    expect(installAttributionFromConversionData({ is_first_launch: true, af_status: "Organic" }, "ios", now)).toBeNull();
    expect(installAttributionFromConversionData({ is_first_launch: false, af_status: "Non-organic" }, "ios", now)).toBeNull();
    expect(installAttributionFromConversionData({ is_first_launch: "true", af_status: "Non-organic", media_source: "x" }, "android", now)?.surface).toBe("android");
  });
});
