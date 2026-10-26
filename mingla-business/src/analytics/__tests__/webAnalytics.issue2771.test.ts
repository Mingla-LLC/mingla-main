// [TEST-MOD-APPROVED #2331] The #2771 "nothing before an explicit grant" rule
// is replaced by I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF: analytics and ads are
// each on from the first page unless this visitor turned it off, and nothing
// loads after a turn-off.

interface FakeScript {
  src: string;
  async: boolean;
  attrs: Record<string, string>;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

function harness(
  search = "",
  seed: Record<string, string> = {},
): {
  analytics: typeof import("../webAnalytics.web");
  scripts: FakeScript[];
  local: Map<string, string>;
  fetches: string[];
  cookies: string[];
  posthog: {
    init: jest.Mock;
    opt_in_capturing: jest.Mock;
    opt_out_capturing: jest.Mock;
    capture: jest.Mock;
    set_config: jest.Mock;
    stopSessionRecording: jest.Mock;
  };
  win: Record<string, unknown>;
} {
  const scripts: FakeScript[] = [];
  const local = new Map<string, string>(Object.entries(seed));
  const session = new Map<string, string>();
  const fetches: string[] = [];
  const cookies: string[] = [];
  let cookieJar = "_ga=GA1.1.1; _ga_TEST=GS1; ph_phc_public_posthog=%7B%7D; _fbp=fb.1";
  const posthog = {
    init: jest.fn(),
    opt_in_capturing: jest.fn(),
    opt_out_capturing: jest.fn(),
    capture: jest.fn(),
    identify: jest.fn(),
    getFeatureFlag: jest.fn(),
    set_config: jest.fn(),
    stopSessionRecording: jest.fn(),
  };
  const document = {
    referrer: "",
    createElement: (): FakeScript => {
      const script: FakeScript = {
        src: "", async: false, attrs: {},
        setAttribute(name: string, value: string): void { this.attrs[name] = value; },
        remove(): void {
          const index = scripts.indexOf(script);
          if (index >= 0) scripts.splice(index, 1);
        },
      };
      return script;
    },
    querySelector: (): null => null,
    querySelectorAll: (selector: string): FakeScript[] =>
      scripts.filter((script) =>
        selector.includes("data-mingla-ga4")
          ? "data-mingla-ga4" in script.attrs
          : "data-mingla-pixel" in script.attrs || script.src.includes("facebook"),
      ),
    head: { appendChild: (script: FakeScript): void => { scripts.push(script); } },
    getElementsByTagName: (): FakeScript[] => scripts,
    get cookie(): string { return cookieJar; },
    set cookie(value: string) {
      cookies.push(value);
      const name = value.split("=", 1)[0];
      if (value.includes("expires=Thu, 01 Jan 1970")) {
        cookieJar = cookieJar
          .split("; ")
          .filter((part) => !part.startsWith(`${name}=`))
          .join("; ");
      }
    },
  };
  const win: Record<string, unknown> = {
    document,
    navigator: {},
    location: { search, pathname: "/e/b/e", href: `https://business.usemingla.com/e/b/e${search}`, origin: "https://business.usemingla.com" },
    localStorage: {
      getItem: (key: string): string | null => local.get(key) ?? null,
      setItem: (key: string, value: string): void => { local.set(key, value); },
      removeItem: (key: string): void => { local.delete(key); },
      key: (index: number): string | null => [...local.keys()][index] ?? null,
      get length(): number { return local.size; },
    },
    sessionStorage: {
      getItem: (key: string): string | null => session.get(key) ?? null,
      setItem: (key: string, value: string): void => { session.set(key, value); },
    },
    addEventListener: (): void => undefined,
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
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, click_id: "server-click" }),
    });
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const analytics = require("../webAnalytics.web") as typeof import("../webAnalytics.web");
  return { analytics, scripts, local, fetches, cookies, posthog, win };
}

const vendorScripts = (scripts: FakeScript[], host: string): FakeScript[] =>
  scripts.filter((script) => script.src.includes(host));

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
  jest.resetModules();
});

test("#2331 first visit: analytics and ads both start before any tap, and never ask the region", async () => {
  const visit = harness("?fbclid=PRE&utm_source=meta");
  await visit.analytics.initWebAnalytics();
  visit.analytics.captureWeb("first_page");
  visit.analytics.captureAdClickIds();

  expect(visit.posthog.init).toHaveBeenCalledTimes(1);
  expect(visit.posthog.opt_in_capturing).toHaveBeenCalledTimes(1);
  expect(visit.posthog.capture).toHaveBeenCalledWith("first_page", undefined);
  expect(vendorScripts(visit.scripts, "googletagmanager")).toHaveLength(1);
  expect(vendorScripts(visit.scripts, "facebook")).toHaveLength(1);
  expect(visit.fetches.some((url) => url.includes("ad-pixel-config"))).toBe(false);
  expect(visit.fetches.filter((url) => url.includes("attribution-capture"))).toHaveLength(1);
  expect(visit.analytics.readPrivacyChoice()).toBeNull();
  expect(visit.analytics.getPrivacySnapshot()).toEqual({
    saved: false,
    analytics: true,
    ads: true,
    gpc: false,
  });
});

test("#2331 analytics off stops PostHog + GA now, clears their cookies, keeps pixels, and stays off", async () => {
  const visit = harness();
  await visit.analytics.initWebAnalytics();
  await visit.analytics.savePrivacyChoice({ analytics: false, ads: true });

  expect(visit.posthog.opt_out_capturing).toHaveBeenCalledTimes(1);
  expect(visit.posthog.stopSessionRecording).toHaveBeenCalledTimes(1);
  expect(vendorScripts(visit.scripts, "googletagmanager")).toHaveLength(0);
  for (const name of ["_ga", "_ga_TEST", "ph_phc_public_posthog"]) {
    expect(visit.cookies.some((cookie) => cookie.startsWith(`${name}=;`))).toBe(true);
  }
  expect(visit.cookies.some((cookie) => cookie.startsWith("_fbp=;"))).toBe(false);
  expect(visit.analytics.adPixelsReady()).toBe(true);

  visit.posthog.capture.mockClear();
  visit.analytics.captureWeb("after_off");
  visit.analytics.gaEvent("after_off");
  expect(visit.posthog.capture).not.toHaveBeenCalled();
  expect(JSON.parse(visit.local.get("mingla_privacy_v2") ?? "null")).toMatchObject({
    analytics: false,
    ads: true,
  });

  // A reload reads the saved choice: analytics never starts again.
  const reload = harness("", Object.fromEntries(visit.local));
  await reload.analytics.initWebAnalytics();
  expect(reload.posthog.init).not.toHaveBeenCalled();
  expect(vendorScripts(reload.scripts, "googletagmanager")).toHaveLength(0);
  expect(vendorScripts(reload.scripts, "facebook")).toHaveLength(1);
  expect(reload.analytics.getPrivacySnapshot()).toMatchObject({ saved: true, analytics: false, ads: true });
});

test("#2331 turning analytics back on resumes the same page without a reload", async () => {
  const visit = harness();
  await visit.analytics.initWebAnalytics();
  await visit.analytics.savePrivacyChoice({ analytics: false, ads: false });
  await visit.analytics.savePrivacyChoice({ analytics: true, ads: true });

  expect(visit.posthog.init).toHaveBeenCalledTimes(1);
  expect(visit.posthog.opt_in_capturing).toHaveBeenCalledTimes(2);
  expect(vendorScripts(visit.scripts, "googletagmanager")).toHaveLength(1);
  expect(vendorScripts(visit.scripts, "facebook")).toHaveLength(1);
  visit.analytics.captureWeb("back_on");
  expect(visit.posthog.capture).toHaveBeenCalledWith("back_on", undefined);
});

test.each([
  ["denied", false],
  ["granted", true],
] as const)("#2331 a v1 %s visitor carries over (both %s) and sees no bar", async (choice, on) => {
  const visit = harness("", { mingla_consent_v1: JSON.stringify({ choice, ts: 1 }) });
  await visit.analytics.initWebAnalytics();
  expect(visit.posthog.init).toHaveBeenCalledTimes(on ? 1 : 0);
  expect(vendorScripts(visit.scripts, "facebook")).toHaveLength(on ? 1 : 0);
  expect(vendorScripts(visit.scripts, "googletagmanager")).toHaveLength(on ? 1 : 0);
  expect(visit.analytics.getPrivacySnapshot()).toEqual({ saved: true, analytics: on, ads: on, gpc: false });
  expect(JSON.parse(visit.local.get("mingla_privacy_v2") ?? "null")).toMatchObject({ analytics: on, ads: on });
  expect(visit.local.has("mingla_consent_v1")).toBe(false);
});

test("#2331 concurrent init calls share one complete boot", async () => {
  const visit = harness();
  await Promise.all([
    visit.analytics.initWebAnalytics(),
    visit.analytics.initWebAnalytics(),
    visit.analytics.initWebAnalytics(),
  ]);
  expect(visit.posthog.init).toHaveBeenCalledTimes(1);
  expect(visit.posthog.capture).toHaveBeenCalledWith("$pageview");
  expect(vendorScripts(visit.scripts, "googletagmanager")).toHaveLength(1);
  expect(vendorScripts(visit.scripts, "facebook")).toHaveLength(1);
});
