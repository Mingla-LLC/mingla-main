interface FakeScript {
  src: string;
  async: boolean;
  attrs: Record<string, string>;
  setAttribute(name: string, value: string): void;
}

interface PostHogHarness {
  init: jest.Mock;
  opt_in_capturing: jest.Mock;
  capture: jest.Mock;
  identify: jest.Mock;
  getFeatureFlag: jest.Mock;
}

interface AnalyticsHarness {
  analytics: typeof import("../webAnalytics.web");
  posthog: PostHogHarness;
  scripts: FakeScript[];
  local: Map<string, string>;
  win: {
    document: {
      referrer: string;
      createElement(): FakeScript;
      querySelector(): null;
      head: { appendChild(script: FakeScript): void };
    };
    location: {
      origin: string;
      href: string;
      pathname: string;
      search: string;
    };
    localStorage: {
      getItem(key: string): string | null;
      setItem(key: string, value: string): void;
    };
    sessionStorage: {
      getItem(key: string): null;
      setItem(key: string, value: string): void;
    };
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  };
}

function harness(): AnalyticsHarness {
  const scripts: FakeScript[] = [];
  const local = new Map<string, string>();
  const posthog: PostHogHarness = {
    init: jest.fn(),
    opt_in_capturing: jest.fn(),
    capture: jest.fn(),
    identify: jest.fn(),
    getFeatureFlag: jest.fn(),
  };
  const win: AnalyticsHarness["win"] = {
    document: {
      referrer: "https://search.example/results?q=private",
      createElement: (): FakeScript => ({
        src: "",
        async: false,
        attrs: {},
        setAttribute(name: string, value: string): void {
          this.attrs[name] = value;
        },
      }),
      querySelector: (): null => null,
      head: {
        appendChild: (script: FakeScript): void => {
          scripts.push(script);
        },
      },
    },
    location: {
      origin: "https://business.usemingla.com",
      href: "https://business.usemingla.com/private?token=private#fragment",
      pathname: "/private",
      search: "?token=private",
    },
    localStorage: {
      getItem: (key: string): string | null => local.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        local.set(key, value);
      },
    },
    sessionStorage: {
      getItem: (): null => null,
      setItem: (): void => {},
    },
  };

  jest.resetModules();
  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: {
      expoConfig: {
        extra: {
          EXPO_PUBLIC_POSTHOG_KEY: "phc_public_test",
          EXPO_PUBLIC_GA4_MEASUREMENT_ID: "G-TEST",
        },
      },
    },
  }));
  jest.doMock("posthog-js", () => ({ __esModule: true, default: posthog }));
  (globalThis as unknown as { window: AnalyticsHarness["win"] }).window = win;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const analytics = require("../webAnalytics.web") as typeof import("../webAnalytics.web");
  return { analytics, posthog, scripts, local, win };
}

function dataLayerCommands(win: AnalyticsHarness["win"]): unknown[][] {
  return (win.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
}

afterEach(() => {
  delete (globalThis as unknown as { window?: AnalyticsHarness["win"] }).window;
  jest.resetModules();
});

describe("#3176 Host public search measurement", () => {
  it("keeps the live root route wired to initialize then emit each manual public pageview", () => {
    const layout = readFileSync(join(__dirname, "../../../app/_layout.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    expect(layout).toMatch(
      /const pathname = usePathname\(\);\s*useEffect\(\(\) => \{\s*if \(Platform\.OS !== "web"\) return;\s*void initWebAnalytics\(\)\.then\(\(\) => \{\s*captureHostPublicSearchPageView\(pathname\);\s*\}\);\s*\}, \[pathname\]\);/,
    );
  });

  it("keeps both analytics clients and public pageviews dark before consent", async () => {
    const pending = harness();

    await pending.analytics.initWebAnalytics();
    pending.analytics.captureHostPublicSearchPageView(
      "/e/mingla/launch?token=private#fragment",
    );

    expect(pending.posthog.init).not.toHaveBeenCalled();
    expect(pending.posthog.capture).not.toHaveBeenCalled();
    expect(pending.scripts).toHaveLength(0);
    expect(pending.win.dataLayer).toBeUndefined();
    expect(pending.local.size).toBe(0);
  });

  it("boots only after consent with both automatic page lifecycles disabled", async () => {
    const accepted = harness();

    await accepted.analytics.grantConsent();

    expect(accepted.posthog.init).toHaveBeenCalledTimes(1);
    expect(accepted.posthog.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(accepted.posthog.init).toHaveBeenCalledWith(
      "phc_public_test",
      expect.objectContaining({
        capture_pageview: false,
        capture_pageleave: false,
        before_send: expect.any(Function),
      }),
    );
    expect(dataLayerCommands(accepted.win)).toContainEqual([
      "config",
      "G-TEST",
      { send_page_view: false },
    ]);
    expect(
      accepted.scripts.filter((script) => script.src.includes("googletagmanager")),
    ).toHaveLength(1);
  });

  it("emits one manual public pageview with query-free URL and origin-only referrer", async () => {
    const accepted = harness();
    await accepted.analytics.grantConsent();
    accepted.posthog.capture.mockClear();

    accepted.analytics.captureHostPublicSearchPageView(
      "/e/mingla/launch?token=private#fragment",
    );

    const expectedProperties = {
      audience: "explorer",
      page_family: "public_inventory",
      page_location: "https://business.usemingla.com/e/mingla/launch",
      source_kind: "referrer",
      page_referrer_origin: "https://search.example",
    };
    expect(accepted.posthog.capture).toHaveBeenCalledTimes(1);
    expect(accepted.posthog.capture).toHaveBeenCalledWith(
      "page_view",
      expectedProperties,
    );
    expect(dataLayerCommands(accepted.win)).toContainEqual([
      "event",
      "page_view",
      expectedProperties,
    ]);
    expect(JSON.stringify(accepted.posthog.capture.mock.calls)).not.toMatch(
      /token=private|#fragment|q=private/,
    );

    accepted.posthog.capture.mockClear();
    accepted.analytics.captureHostPublicSearchPageView(
      "/checkout/00000000-0000-0000-0000-000000000000?token=private",
    );
    expect(accepted.posthog.capture).not.toHaveBeenCalled();
  });
});
import { readFileSync } from "node:fs";
import { join } from "node:path";
