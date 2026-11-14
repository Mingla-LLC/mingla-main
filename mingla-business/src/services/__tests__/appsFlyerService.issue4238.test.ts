// MINGLA-INVARIANT: I-4238-AF-RESPECTS-OPT-OUT | issue #4238 | with the Host analytics opt-out on, AppsFlyer is anonymized and no AppsFlyer event, hashed email or uninstall token is sent.
// MINGLA-INVARIANT: I-4238-AF-START-NEVER-LOST | issue #4238 | a Host AppsFlyer event or customer id set before init completes is applied exactly once after init, in order (at most 50 events, dropped on sign-out).
/**
 * #4238 Wave 6, Host app (mingla-business): W6-1 pre-init queue, W6-5
 * uninstall token, W6-6 opt-out, W6-7 registration once + method, W6-8 OneLink
 * screens, W6-11 SHA-256 email (crypt type 3).
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

type InitOk = (r: unknown) => void;
const rt: {
  platform: "ios" | "android";
  initOk: InitOk | null;
  optOut: boolean;
  listeners: Array<(s: { analyticsOptOut: boolean }, p: { analyticsOptOut: boolean }) => void>;
  tokenListener: ((t: string | null) => void) | null;
  user: { id: string; email: string } | null;
  session: boolean;
} = { platform: "ios", initOk: null, optOut: false, listeners: [], tokenListener: null, user: null, session: false };
const store = new Map<string, string>();

const mockLogEvent = jest.fn();
const mockSetUserEmails = jest.fn((_o: unknown, ok: (r: unknown) => void) => ok({}));
const mockAnonymize = jest.fn();
const mockUninstall = jest.fn();
const mockSetCustomerUserId = jest.fn();

jest.mock("react-native", () => ({
  Platform: {
    get OS() {
      return rt.platform;
    },
  },
}));
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
    initSdk: jest.fn((_c: unknown, ok: InitOk) => {
      rt.initOk = ok;
    }),
    onDeepLink: jest.fn(() => () => {}),
    setOneLinkCustomDomains: jest.fn(),
    performOnDeepLinking: jest.fn(),
    setCustomerUserId: mockSetCustomerUserId,
    getAppsFlyerUID: jest.fn(),
    logEvent: mockLogEvent,
    setUserEmails: mockSetUserEmails,
    anonymizeUser: mockAnonymize,
    updateServerUninstallToken: mockUninstall,
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
jest.mock("../oneSignalService", () => ({
  onPushSubscriptionToken: (l: (t: string | null) => void) => {
    rt.tokenListener = l;
  },
}));
jest.mock("../supabase", () => ({
  supabase: {
    auth: {
      getUser: jest.fn(async () => ({ data: { user: rt.user } })),
      getSession: jest.fn(async () => ({
        data: { session: rt.session ? { user: { id: "u-1" } } : null },
      })),
    },
    from: jest.fn(() => ({ upsert: jest.fn(() => Promise.resolve({ error: null })) })),
  },
}));

const importService = async () => import("../appsFlyerService");
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};
const setOptOut = (next: boolean) => {
  const prev = rt.optOut;
  rt.optOut = next;
  for (const l of rt.listeners) l({ analyticsOptOut: next }, { analyticsOptOut: prev });
};
const APNS = "a".repeat(64);
const FCM = `fid123:APA91b${"x".repeat(140)}`;

describe("#4238 Wave 6 Host AppsFlyer", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    store.clear();
    Object.assign(rt, { platform: "ios", initOk: null, optOut: false, listeners: [], tokenListener: null, user: null, session: false });
    process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = "k";
    process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID = "6768737367";
    process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID = "com.sethogieva.minglabusiness";
  });

  test("W6-1 events logged before init are sent after it, once, in order", async () => {
    const svc = await importService();
    svc.initializeAppsFlyer();
    svc.logAppsFlyerEvent("mingla_brand_created", { brand_id: "b1" });
    svc.logAppsFlyerEvent("mingla_event_published", { event_id: "e1" });
    expect(mockLogEvent).not.toHaveBeenCalled();
    rt.initOk?.({});
    expect(mockLogEvent.mock.calls.map((c) => c[0])).toEqual(["mingla_brand_created", "mingla_event_published"]);
    rt.initOk?.({});
    expect(mockLogEvent).toHaveBeenCalledTimes(2);
  });

  test("W6-1 the queue is bounded at 50 and dropped on sign-out", async () => {
    const svc = await importService();
    svc.initializeAppsFlyer();
    for (let i = 0; i < 60; i += 1) svc.logAppsFlyerEvent(`e${i}`, {});
    svc.clearAppsFlyerUserId();
    svc.logAppsFlyerEvent("after_sign_out", {});
    rt.initOk?.({});
    expect(mockLogEvent.mock.calls.map((c) => c[0])).toEqual(["after_sign_out"]);

    jest.resetModules();
    jest.clearAllMocks();
    const again = await importService();
    again.initializeAppsFlyer();
    for (let i = 0; i < 60; i += 1) again.logAppsFlyerEvent(`e${i}`, {});
    rt.initOk?.({});
    expect(mockLogEvent).toHaveBeenCalledTimes(svc.PRE_INIT_EVENT_QUEUE_MAX);
    expect(mockLogEvent.mock.calls[0][0]).toBe("e10");
  });

  test("W6-6 opt-out anonymizes and logs nothing; opting back in restores", async () => {
    rt.optOut = true;
    const svc = await importService();
    svc.initializeAppsFlyer();
    svc.logAppsFlyerEvent("queued_while_out", {});
    rt.initOk?.({});
    expect(mockAnonymize).toHaveBeenCalledWith(true, expect.any(Function));
    svc.logAppsFlyerEvent("mingla_event_published", { event_id: "e1" });
    expect(mockLogEvent).not.toHaveBeenCalled();
    setOptOut(false);
    expect(mockAnonymize).toHaveBeenLastCalledWith(false, expect.any(Function));
    svc.logAppsFlyerEvent("mingla_event_published", { event_id: "e2" });
    expect(mockLogEvent).toHaveBeenCalledTimes(1);
    setOptOut(true);
    svc.logAppsFlyerEvent("blocked", {});
    expect(mockLogEvent).toHaveBeenCalledTimes(1);
  });

  test("W6-11 sign-in sends the email with crypt type 3 (SHA-256); sign-out clears; opt-out skips", async () => {
    rt.user = { id: "u-1", email: " Host@Example.COM " };
    const svc = await importService();
    svc.initializeAppsFlyer();
    rt.initOk?.({});
    svc.setAppsFlyerUserId("u-1");
    await flush();
    expect(mockSetUserEmails).toHaveBeenCalledWith(
      { emails: ["host@example.com"], emailsCryptType: 3 },
      expect.any(Function),
      expect.any(Function),
    );
    expect(svc.APPSFLYER_EMAIL_CRYPT_SHA256).toBe(3);
    svc.clearAppsFlyerUserId();
    expect(mockSetUserEmails).toHaveBeenLastCalledWith(
      { emails: [], emailsCryptType: 3 },
      expect.any(Function),
      expect.any(Function),
    );
    mockSetUserEmails.mockClear();
    setOptOut(true);
    svc.setAppsFlyerUserId("u-1");
    await flush();
    expect(mockSetUserEmails.mock.calls.some((c) => (c[0] as { emails: string[] }).emails.length > 0)).toBe(false);
  });

  test("W6-5 iOS APNs hex is sent once per change; held until init", async () => {
    const svc = await importService();
    svc.initializeAppsFlyer();
    expect(rt.tokenListener).not.toBeNull();
    rt.tokenListener?.(APNS.toUpperCase());
    expect(mockUninstall).not.toHaveBeenCalled();
    rt.initOk?.({});
    expect(mockUninstall).toHaveBeenCalledWith(APNS, expect.any(Function));
    rt.tokenListener?.(APNS);
    expect(mockUninstall).toHaveBeenCalledTimes(1);
    rt.tokenListener?.("b".repeat(64));
    expect(mockUninstall).toHaveBeenCalledTimes(2);
  });

  test("W6-5 Android sends the FCM token and refuses a Firebase Installation ID loudly", async () => {
    rt.platform = "android";
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    const svc = await importService();
    svc.initializeAppsFlyer();
    rt.initOk?.({});
    rt.tokenListener?.("cXbz1Xyz-abcdEFGHijk_l");
    expect(mockUninstall).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(expect.stringContaining("Firebase Installation ID"));
    rt.tokenListener?.(FCM);
    expect(mockUninstall).toHaveBeenCalledWith(FCM, expect.any(Function));
    err.mockRestore();
    expect(svc.classifyUninstallToken("not-hex", "ios")).toEqual({ ok: false, reason: "not_apns_hex" });
  });

  test("W6-7 af_complete_registration is logged once per user; the method is the real provider", async () => {
    const svc = await importService();
    svc.initializeAppsFlyer();
    rt.initOk?.({});
    expect(await svc.logAppsFlyerRegistrationOnce("u-1", { af_registration_method: "phone" })).toBe(true);
    expect(await svc.logAppsFlyerRegistrationOnce("u-1", { af_registration_method: "phone" })).toBe(false);
    expect(mockLogEvent.mock.calls.filter((c) => c[0] === "af_complete_registration")).toHaveLength(1);
    expect(svc.appsFlyerAuthMethod("phone")).toBe("phone");
    expect(svc.appsFlyerAuthMethod("apple")).toBe("apple");
    expect(svc.appsFlyerAuthMethod("email")).toBe("email");
    expect(svc.appsFlyerAuthMethod("azure")).toBe("other");
    expect(svc.appsFlyerAuthMethod(undefined)).toBe("email");
  });

  test("W6-8 each OneLink value routes to its screen; unknown goes Home", async () => {
    const { resolveBusinessOneLinkDestination: r, deliverBusinessOneLinkTarget } = await importService();
    const id = "6a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    expect(r({ deep_link_value: "event", deep_link_sub1: id })).toEqual({ kind: "content", target: `/event/${id}`, referralCode: null });
    expect(r({ deep_link_value: "brand", deep_link_sub1: id })).toEqual({ kind: "content", target: `/brand/${id}`, referralCode: null });
    expect(r({ deep_link_value: "payouts", deep_link_sub1: id })).toEqual({ kind: "content", target: `/brand/${id}/payments`, referralCode: null });
    expect(r({ deep_link_value: "create_event" })).toEqual({ kind: "content", target: "/event/create", referralCode: null });
    expect(r({ deep_link_value: "something_new" })).toEqual({ kind: "content", target: "/(tabs)/home", referralCode: null });
    expect(r({ deep_link_value: "event", deep_link_sub1: "../../admin" })).toEqual({ kind: "content", target: "/(tabs)/home", referralCode: null });

    const navigate = jest.fn();
    const stash = jest.fn(async () => {});
    rt.session = true;
    expect(await deliverBusinessOneLinkTarget(`/event/${id}`, { navigate, stashForAfterSignIn: stash })).toBe("navigated");
    expect(navigate).toHaveBeenCalledWith(`/event/${id}`);
    rt.session = false;
    expect(await deliverBusinessOneLinkTarget(`/event/${id}`, { navigate, stashForAfterSignIn: stash })).toBe("stashed");
    expect(stash).toHaveBeenCalledWith(`/event/${id}`);
  });
});
