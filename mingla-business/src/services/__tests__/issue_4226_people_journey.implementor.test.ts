// MINGLA-INVARIANT: I-4226-JOURNEY-TRACKING-NEVER-BLOCKS-HOST | issue #4226 | the Host app records its brand-setup step, sign-up source and AppsFlyer install attribution through fire-and-forget RPCs that log (never throw), are held until the host is known, and are cleared on sign-out.
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

type RpcCall = { name: string; args: Record<string, unknown> };
const rt: {
  rpcCalls: RpcCall[];
  rpcError: boolean;
  rpcThrows: boolean;
  store: Map<string, string>;
  optOut: boolean;
  initOk: ((r: unknown) => void) | null;
  conversionCb: ((r: unknown) => void) | null;
  attributionAnswers: unknown[];
} = { rpcCalls: [], rpcError: false, rpcThrows: false, store: new Map(), optOut: false, initOk: null, conversionCb: null, attributionAnswers: [] };

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => rt.store.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      rt.store.set(k, v);
    }),
  },
}));
jest.mock("react-native-appsflyer", () => ({
  __esModule: true,
  default: {
    initSdk: jest.fn((_c: unknown, ok: (r: unknown) => void) => {
      rt.initOk = ok;
    }),
    onDeepLink: jest.fn(() => () => {}),
    onInstallConversionData: jest.fn((cb: (r: unknown) => void) => {
      rt.conversionCb = cb;
      return () => {};
    }),
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
    subscribe: () => () => {},
  },
}));
jest.mock("../oneSignalService", () => ({ onPushSubscriptionToken: () => {} }));
jest.mock("../supabase", () => ({
  supabase: {
    rpc: jest.fn(async (name: string, args: Record<string, unknown>) => {
      rt.rpcCalls.push({ name, args });
      if (rt.rpcThrows) throw new Error("network down");
      if (name === "record_install_attribution") {
        if (rt.rpcError) return { data: null, error: { message: "boom" } };
        return { data: rt.attributionAnswers.length ? rt.attributionAnswers.shift() : true, error: null };
      }
      return { error: rt.rpcError ? { message: "boom" } : null };
    }),
    auth: {
      getUser: jest.fn(async () => ({ data: { user: { id: "host-1", email: "h@e.co" } } })),
      getSession: jest.fn(async () => ({ data: { session: null } })),
    },
    from: jest.fn(() => ({ upsert: jest.fn(() => Promise.resolve({ error: null })) })),
  },
}));

const flush = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};
const importJourney = async () => import("../peopleJourneyService");
const rpc = (name: string) => rt.rpcCalls.filter((c) => c.name === name);
const read = (rel: string) => fs.readFileSync(path.join(__dirname, "../../..", rel), "utf8");

beforeEach(() => {
  jest.resetModules();
  Object.assign(rt, { rpcCalls: [], rpcError: false, rpcThrows: false, store: new Map(), optOut: false, initOk: null, conversionCb: null, attributionAnswers: [] });
  process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = "k";
  process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID = "6768737367";
  process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID = "com.sethogieva.minglabusiness";
});

describe("#4226 Host brand-setup marks", () => {
  test("a mark is sent for every brand-setup step, including the first", async () => {
    const j = await importJourney();
    const steps: Array<[number, string]> = [[1, "name"], [2, "country"], [3, "pay"], [4, "done"]];
    for (const [n, key] of steps) j.recordJourneyMark("host_brand_setup", n, key);
    await flush();
    expect(rpc("record_journey_mark").map((c) => c.args)).toEqual(
      steps.map(([n, key]) => ({ p_kind: "host_brand_setup", p_step: n, p_step_key: key })),
    );
  });

  test("the flow's step-viewed effect records the mark with the step index and name", () => {
    const src = read("src/components/brand/BrandCreationFlow.tsx");
    expect(src).toContain('recordJourneyMark("host_brand_setup", STEP_INDEX[step], step)');
    const stepsDefined = read("src/components/brand/brandSetupStepper.ts");
    expect(stepsDefined).toContain("{ name: 1, country: 2, pay: 3, done: 4 }");
  });

  test("a repeat view is sent once; a failed write retries on the next view; a throwing RPC never throws", async () => {
    const j = await importJourney();
    j.recordJourneyMark("host_brand_setup", 2, "country");
    j.recordJourneyMark("host_brand_setup", 2, "country");
    await flush();
    expect(rpc("record_journey_mark")).toHaveLength(1);
    rt.rpcError = true;
    j.recordJourneyMark("host_brand_setup", 3, "pay");
    await flush();
    j.recordJourneyMark("host_brand_setup", 3, "pay");
    await flush();
    expect(rpc("record_journey_mark")).toHaveLength(3);
    rt.rpcThrows = true;
    j.recordJourneyMark("host_brand_setup", 4, "done");
    await expect(j.recordHostSignupSourceOnce({ userId: "h", platform: "ios", optedOut: false })).resolves.toBeUndefined();
    await flush();
  });
});

describe("#4226 Host sign-up source", () => {
  test("order: host invite, referral link, AppsFlyer paid / organic, website on web, unknown", async () => {
    const j = await importJourney();
    const conv = { af_status: "Non-organic", media_source: "Facebook Ads", campaign: "lagos" };
    const none = j.EMPTY_SOURCE_HINTS;
    expect(j.deriveSignupSource({ hostInvite: true, referralLink: true }, conv, false, "ios").source).toBe("host_invite");
    expect(j.deriveSignupSource({ hostInvite: false, referralLink: true }, conv, false, "ios").source).toBe("referral_link");
    expect(j.deriveSignupSource(none, conv, false, "ios")).toEqual({
      source: "paid_ad",
      detail: { media_source: "Facebook Ads", campaign: "lagos" },
    });
    expect(j.deriveSignupSource(none, { af_status: "Organic" }, false, "ios").source).toBe("organic");
    expect(j.deriveSignupSource(none, null, false, "ios").source).toBe("unknown");
    expect(j.deriveSignupSource(none, null, false, "web").source).toBe("website");
    expect(j.deriveSignupSource(none, conv, true, "ios").source).toBe("unknown");
  });

  test("recorded once per account with the host_app surface; the referral key and a team-invite hint are used", async () => {
    rt.store.set("@mingla_referral_code", "abc");
    const j = await importJourney();
    await j.recordHostSignupSourceOnce({ userId: "host-1", platform: "ios", optedOut: false });
    await j.recordHostSignupSourceOnce({ userId: "host-1", platform: "ios", optedOut: false });
    expect(rpc("record_signup_source")).toHaveLength(1);
    expect(rpc("record_signup_source")[0].args).toEqual({
      p_source: "referral_link",
      p_detail: { has_code: true },
      p_surface: "host_app",
    });
    jest.resetModules();
    rt.rpcCalls = [];
    const k = await importJourney();
    k.noteSourceHints({ hostInvite: true });
    await k.recordHostSignupSourceOnce({ userId: "host-2", platform: "ios", optedOut: false });
    expect(rpc("record_signup_source")[0].args.p_source).toBe("host_invite");
  });

  test("the first-time sign-in and the invitation route feed it", () => {
    // AuthContext.tsx is byte-pinned by #1881, so the call lives in a hook.
    expect(read("src/hooks/usePeopleJourneyTracking.ts")).toContain("recordHostSignupSourceOnce(");
    expect(read("app/_layout.tsx")).toContain("useHostSignupSourceTracking();");
    expect(read("src/context/AuthContext.tsx")).not.toContain("peopleJourneyService");
    expect(read("app/accept-brand-invitation.tsx")).toContain("noteSourceHints({ hostInvite: true })");
  });
});

describe("#4226 Host install attribution", () => {
  test("conversion data that arrives before sign-in is held, sent once after auth, with the business app value", async () => {
    const svc = await import("../appsFlyerService");
    svc.initializeAppsFlyer();
    expect(rt.conversionCb).not.toBeNull();
    rt.initOk?.({});
    rt.conversionCb?.({ type: "onInstallConversionDataLoaded", data: { af_status: "Non-organic", media_source: "m", is_first_launch: "true" } });
    await flush();
    expect(rpc("record_install_attribution")).toHaveLength(0);
    svc.setAppsFlyerUserId("host-1");
    await flush();
    svc.registerAppsFlyerDevice("host-1");
    await flush();
    const sent = rpc("record_install_attribution");
    expect(sent).toHaveLength(1);
    expect(sent[0].args).toEqual({
      p_appsflyer_id: "af-host-uid",
      p_app: "business",
      p_payload: { af_status: "Non-organic", media_source: "m", is_first_launch: "true", platform: "ios", app_id: "6768737367" },
    });
  });

  test("sign-out drops held data; an opted-out host sends and keeps nothing", async () => {
    const j = await importJourney();
    j.holdInstallConversion({ af_status: "Organic" });
    j.noteSourceHints({ hostInvite: true });
    j.clearPeopleJourneyState();
    expect(j.getHeldInstallConversion()).toBeNull();
    expect(j.getSourceHints().hostInvite).toBe(false);
    j.holdInstallConversion({ af_status: "Organic" });
    await expect(j.sendHeldInstallAttribution({ userId: "h", appsflyerId: "af", optedOut: true, platform: "ios", appId: "app-1" })).resolves.toBe("skipped");
    expect(j.getHeldInstallConversion()).toBeNull();
    expect(rt.rpcCalls).toHaveLength(0);
  });

  test("rework: held attribution clears only after a boolean answer; errors and empty answers keep it, at most 3 tries", async () => {
    const ctx = { userId: "h-1", appsflyerId: "af", optedOut: false, platform: "ios", appId: "app-1" };
    // false = already recorded earlier: handled, payload cleared
    let j = await importJourney();
    rt.attributionAnswers = [false];
    j.holdInstallConversion({ af_status: "Non-organic", media_source: "x" });
    await expect(j.sendHeldInstallAttribution(ctx)).resolves.toBe("sent");
    expect(j.getHeldInstallConversion()).toBeNull();
    // error keeps it
    jest.resetModules();
    rt.rpcCalls = [];
    j = await importJourney();
    rt.rpcError = true;
    j.holdInstallConversion({ af_status: "Non-organic", media_source: "x" });
    await expect(j.sendHeldInstallAttribution(ctx)).resolves.toBe("failed");
    expect(j.getHeldInstallConversion()).not.toBeNull();
    rt.rpcError = false;
    // no error, no answer ("no rows"): never "sent"; stops after 3 tries
    jest.resetModules();
    rt.rpcCalls = [];
    j = await importJourney();
    rt.attributionAnswers = [undefined, null, undefined, undefined];
    j.holdInstallConversion({ af_status: "Non-organic", media_source: "x" });
    await expect(j.sendHeldInstallAttribution(ctx)).resolves.toBe("failed");
    await expect(j.sendHeldInstallAttribution(ctx)).resolves.toBe("failed");
    await expect(j.sendHeldInstallAttribution(ctx)).resolves.toBe("failed");
    await expect(j.sendHeldInstallAttribution(ctx)).resolves.toBe("skipped");
    expect(rpc("record_install_attribution")).toHaveLength(3);
    expect(j.getHeldInstallConversion()).not.toBeNull();
  });

  test("clearAppsFlyerUserId (sign-out) clears the held conversion data", async () => {
    const svc = await import("../appsFlyerService");
    const j = await importJourney();
    svc.initializeAppsFlyer();
    rt.initOk?.({});
    rt.conversionCb?.({ data: { af_status: "Organic" } });
    expect(j.getHeldInstallConversion()).not.toBeNull();
    svc.clearAppsFlyerUserId();
    expect(j.getHeldInstallConversion()).toBeNull();
  });
});

describe("#4226 Host PostHog app tag and screens", () => {
  test("the super property app=host is registered; a client failure never throws", async () => {
    const t = await import("../screenTracking");
    const registered: unknown[] = [];
    expect(t.registerAppSuperProperty({ register: (p) => { registered.push(p); return Promise.resolve(); } })).toBe(true);
    expect(registered).toEqual([{ app: "host" }]);
    expect(t.registerAppSuperProperty(null)).toBe(false);
    expect(t.registerAppSuperProperty({ register: () => { throw new Error("x"); } })).toBe(false);
    t.registerAppSuperProperty({ register: () => Promise.reject(new Error("net")) });
    await flush();
  });

  test("screen names are stable, carry no ids, one per change, and stop when opted out", async () => {
    const t = await import("../screenTracking");
    expect(t.screenNameForRoute(["(tabs)", "events"])).toBe("route_events");
    expect(t.screenNameForRoute(["brand", "[id]", "setup"])).toBe("route_brand_id_setup");
    expect(t.screenNameForRoute([])).toBeNull();
    const seen: string[] = [];
    let optedOut = false;
    const tracker = t.createScreenTracker({ getClient: () => ({ screen: (n) => { seen.push(n); } }), isOptedOut: () => optedOut });
    tracker.track("route_events");
    tracker.track("route_events");
    tracker.track("route_home");
    optedOut = true;
    tracker.track("route_account");
    expect(seen).toEqual(["route_events", "route_home"]);
    expect(tracker.track("Not Stable!")).toBe(false);
  });

  test("wiring: registered right after init and identify, screens from one route tracker", () => {
    const ph = read("src/services/postHogService.ts");
    expect(ph).toMatch(/this\.initialized = true;\s*\/\/ #4226[^\n]*\n\s*registerAppSuperProperty\(client\)/);
    expect(ph).toContain("registerAppSuperProperty(this.client)");
    expect(read("app/_layout.tsx")).toContain("useRouteScreenTracking();");
    expect(read("src/hooks/usePeopleJourneyTracking.ts")).toContain("postHogService.screen(");
    expect(read("src/services/postHogService.web.ts")).toContain("screen(_name: string | null)");
  });
});
