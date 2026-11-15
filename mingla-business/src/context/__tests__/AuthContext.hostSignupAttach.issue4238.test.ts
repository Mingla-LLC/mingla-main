// MINGLA-INVARIANT: I-4238-HOST-FUNNEL-ONCE-HOST-APP | issue #4238 | the Host app asks host-attribution-attach once per sign-in and treats a sign-in as a new account only when the server says so (the 30-second created_at window is only the fallback); host web fires the browser HostSignUp twin with the server's event id only for a new host while ads are on.
/**
 * #4238 W3-3 (host web half) + W4-3 (Host app sends its saved install
 * attribution) + W6-7 (the server sign-up flag). Exercises the real web and
 * native appsFlyerService attach functions with supabase and webAnalytics
 * mocked, and pins the AuthContext decision.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const rt = {
  platform: "ios" as "ios" | "android" | "web",
  optOut: false,
  adsOn: true,
  response: { data: { ok: true, new_host: true, host_signup_event_id: "host_signup:u1" } as unknown, error: null as unknown },
};
const store = new Map<string, string>();
const mockInvoke = jest.fn(async (_name: string, _opts: { body: Record<string, unknown> }) => rt.response);
const mockFire = jest.fn(async (_kind: string, _id: string) => {});
const mockKnown = jest.fn();

jest.mock("react-native", () => ({ Platform: { get OS() { return rt.platform; } } }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => store.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
  },
}));
jest.mock("react-native-appsflyer", () => ({ __esModule: true, default: {} }));
jest.mock("../../store/analyticsPrefsStore", () => ({
  useAnalyticsPrefsStore: {
    getState: () => ({ analyticsOptOut: rt.optOut }),
    subscribe: () => () => {},
  },
}));
jest.mock("../../services/oneSignalService", () => ({ onPushSubscriptionToken: () => {} }));
jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: mockInvoke }, auth: { getUser: async () => ({ data: { user: null } }) } },
}));
jest.mock("../../analytics/webAnalytics", () => ({
  isAdsOn: () => rt.adsOn,
  getStoredClickAttribution: () => ({ clickId: "click-4238" }),
  getStoredAdMatchData: () => ({ fbp: "fb.1.1.1", fbc: "fb.1.1.FB", ttp: "ttp", scid: "scid", clientUserAgent: "UA", trackingOptOut: !rt.adsOn }),
  fireHostFunnelBrowserEvent: mockFire,
  markHostKnownAccount: mockKnown,
}));

beforeEach(() => {
  rt.optOut = false;
  rt.adsOn = true;
  rt.response = { data: { ok: true, new_host: true, host_signup_event_id: "host_signup:u1" }, error: null };
  store.clear();
  mockInvoke.mockClear();
  mockFire.mockClear();
  mockKnown.mockClear();
  (globalThis as { window?: unknown }).window = {
    location: { origin: "https://host.usemingla.com", pathname: "/auth/callback", search: "?x=1", hash: "#access_token=secret" },
  };
});

describe("host web (appsFlyerService.web)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const web = () => require("../../services/appsFlyerService.web") as typeof import("../../services/appsFlyerService.web");

  test("ads on: sends the click id and cookies, a page URL with no query or hash, and fires HostSignUp for a new host", async () => {
    const result = await web().attachHostAttribution();
    expect(result).toEqual({ newHost: true, hostSignupEventId: "host_signup:u1" });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [name, opts] = mockInvoke.mock.calls[0];
    expect(name).toBe("host-attribution-attach");
    expect(opts.body).toEqual({
      surface: "web",
      tracking_opt_out: false,
      click_id: "click-4238",
      fbp: "fb.1.1.1",
      fbc: "fb.1.1.FB",
      ttp: "ttp",
      scid: "scid",
      page_url: "https://host.usemingla.com/auth/callback",
    });
    expect(JSON.stringify(opts.body)).not.toContain("access_token");
    expect(mockFire).toHaveBeenCalledWith("host_signup", "host_signup:u1");
    expect(mockKnown).toHaveBeenCalledTimes(1);
  });

  test("a returning host fires no browser HostSignUp", async () => {
    rt.response = { data: { ok: true, new_host: false, host_signup_event_id: "host_signup:u1" }, error: null };
    expect((await web().attachHostAttribution())?.newHost).toBe(false);
    expect(mockFire).not.toHaveBeenCalled();
  });

  test("ads off: sends only the opt-out and fires nothing", async () => {
    rt.adsOn = false;
    await web().attachHostAttribution();
    expect(mockInvoke.mock.calls[0][1].body).toEqual({ surface: "web", tracking_opt_out: true });
    expect(mockFire).not.toHaveBeenCalled();
  });

  test("a failed call answers null (the caller keeps its fallback)", async () => {
    rt.response = { data: null, error: { message: "offline" } };
    expect(await web().attachHostAttribution()).toBeNull();
  });
});

describe("Host app (appsFlyerService native)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const native = () => require("../../services/appsFlyerService") as typeof import("../../services/appsFlyerService");

  test("W4-3: sends the saved install attribution with the device surface", async () => {
    rt.platform = "android";
    store.set(
      "@mingla_host_install_attribution",
      JSON.stringify({ media_source: "Facebook Ads", campaign: "host-lagos", af_sub1: "cmp:host-lagos", af_sub2: null, surface: "android", captured_at: "x" }),
    );
    const result = await native().attachHostAttribution();
    expect(result).toEqual({ newHost: true, hostSignupEventId: "host_signup:u1" });
    expect(mockInvoke.mock.calls[0][1].body).toEqual({
      surface: "android",
      tracking_opt_out: false,
      install_attribution: { media_source: "Facebook Ads", campaign: "host-lagos", af_sub1: "cmp:host-lagos" },
    });
  });

  test("W6-6: with the analytics opt-out on, no install attribution is sent", async () => {
    rt.platform = "ios";
    rt.optOut = true;
    store.set("@mingla_host_install_attribution", JSON.stringify({ media_source: "x" }));
    await native().attachHostAttribution();
    expect(mockInvoke.mock.calls[0][1].body).toEqual({ surface: "ios", tracking_opt_out: true });
  });

  test("an unknown server flag stays null", () => {
    expect(native().parseHostAttachResponse({ ok: true, new_host: null })).toEqual({ newHost: null, hostSignupEventId: null });
    expect(native().parseHostAttachResponse({ ok: false })).toBeNull();
  });
});

test("W6-7: AuthContext treats a sign-in as new only on the server's word; the 30 s window is the fallback", () => {
  const src = readFileSync(join(__dirname, "..", "AuthContext.tsx"), "utf8");
  expect(src).toContain("const attach = await attachHostAttribution();");
  expect(src).toMatch(
    /const isFirstTime =\s*attach !== null && attach\.newHost !== null\s*\? attach\.newHost\s*: createdAt !== null && Date\.now\(\) - createdAt < 30_000;/,
  );
});
