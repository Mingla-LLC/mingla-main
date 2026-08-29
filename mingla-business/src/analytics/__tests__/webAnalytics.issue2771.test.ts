interface FakeScript {
  src: string;
  async: boolean;
  attrs: Record<string, string>;
  setAttribute(name: string, value: string): void;
}

function harness(search = ""): {
  analytics: typeof import("../webAnalytics.web");
  scripts: FakeScript[];
  local: Map<string, string>;
  session: Map<string, string>;
  fetches: string[];
  posthog: { init: jest.Mock; opt_in_capturing: jest.Mock; capture: jest.Mock };
  win: Record<string, unknown>;
} {
  const scripts: FakeScript[] = [];
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  const fetches: string[] = [];
  const posthog = {
    init: jest.fn(() => {
      expect(JSON.parse(local.get("mingla_consent_v1") ?? "{}").choice).toBe("granted");
    }),
    opt_in_capturing: jest.fn(),
    opt_out_capturing: jest.fn(),
    capture: jest.fn(),
    identify: jest.fn(),
    getFeatureFlag: jest.fn(),
  };
  const win: Record<string, unknown> = {
    document: {
      referrer: "",
      createElement: (): FakeScript => ({
        src: "", async: false, attrs: {},
        setAttribute(name: string, value: string): void { this.attrs[name] = value; },
      }),
      querySelector: (): null => null,
      head: { appendChild: (script: FakeScript): void => { scripts.push(script); } },
    },
    location: { search, href: `https://business.usemingla.com/e/b/e${search}` },
    localStorage: {
      getItem: (key: string): string | null => local.get(key) ?? null,
      setItem: (key: string, value: string): void => { local.set(key, value); },
    },
    sessionStorage: {
      getItem: (key: string): string | null => session.get(key) ?? null,
      setItem: (key: string, value: string): void => { session.set(key, value); },
    },
  };
  jest.resetModules();
  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: { expoConfig: { extra: {
      EXPO_PUBLIC_POSTHOG_KEY: "phc_public",
      EXPO_PUBLIC_GA4_MEASUREMENT_ID: "G-TEST",
      EXPO_PUBLIC_META_PIXEL_ID: "meta-test",
      EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon",
    } } },
  }));
  jest.doMock("posthog-js", () => ({ __esModule: true, default: posthog }));
  (globalThis as unknown as { window: unknown }).window = win;
  (globalThis as unknown as { fetch: unknown }).fetch = (url: string) => {
    fetches.push(String(url));
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ click_id: "server-click" }) });
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const analytics = require("../webAnalytics.web") as typeof import("../webAnalytics.web");
  return { analytics, scripts, local, session, fetches, posthog, win };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
  jest.resetModules();
});

test("#2771 fresh and denied Business roots stay byte-dark until explicit grant", async () => {
  const pending = harness("?fbclid=PRE&utm_source=meta");
  await pending.analytics.initWebAnalytics();
  pending.analytics.captureWeb("pregrant");
  pending.analytics.gaEvent("pregrant");
  pending.analytics.captureAdClickIds();
  pending.analytics.postAttributionConversion({ eventId: "order-pre" });

  expect(pending.posthog.init).not.toHaveBeenCalled();
  expect(pending.scripts).toHaveLength(0);
  expect(pending.fetches).toHaveLength(0);
  expect(pending.session.size).toBe(0);
  expect(pending.win.dataLayer).toBeUndefined();

  pending.analytics.denyConsent();
  await pending.analytics.initWebAnalytics();
  expect(pending.local.get("mingla_consent_v1")).toContain('"denied"');
  expect(pending.posthog.init).not.toHaveBeenCalled();
  expect(pending.scripts).toHaveLength(0);
});

test("#2771 Accept persists first and concurrent calls share one complete boot", async () => {
  const accepted = harness("?fbclid=YES&utm_source=meta");
  await Promise.all([
    accepted.analytics.grantConsent(),
    accepted.analytics.grantConsent(),
    accepted.analytics.initWebAnalytics(),
  ]);

  expect(accepted.posthog.init).toHaveBeenCalledTimes(1);
  expect(accepted.posthog.opt_in_capturing).toHaveBeenCalledTimes(1);
  expect(accepted.posthog.capture).toHaveBeenCalledTimes(2);
  expect(accepted.posthog.capture).toHaveBeenCalledWith("$pageview");
  expect(accepted.posthog.capture).toHaveBeenCalledWith("consent_granted", undefined);
  expect(accepted.scripts.filter((script) => script.src.includes("googletagmanager"))).toHaveLength(1);
  expect(accepted.scripts.filter((script) => script.src.includes("facebook"))).toHaveLength(1);

  accepted.analytics.captureAdClickIds();
  expect(accepted.fetches.filter((url) => url.includes("attribution-capture"))).toHaveLength(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(accepted.session.get("mingla_ad_click_v1")).toContain("server-click");
});
