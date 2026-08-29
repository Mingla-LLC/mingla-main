/**
 * ISSUE-865 WP-C — browser ad-conversion pixels + consent gate (Stage C).
 *
 * Runtime battery (jest / ts-jest, node env with a hand-rolled fake DOM). Covers:
 *   • the pixel loaders NO-OP when the pixel id is absent,
 *   • the CONSENT GATE blocks all pixel firing pre-consent (SC-8 / RT-3) — the
 *     pixels bootstrap ONLY on grantConsent, never before,
 *   • the DEDUP CONTRACT — fireAdPurchase fires the Meta Pixel with the shared
 *     event_id as `eventID` (== the server CAPI event_id) — SC-15,
 *   • a simulated pixel-LOAD FAILURE does NOT throw / break the flow (fail-open).
 *
 * fails-on-revert target: the consent gate (pixels bootstrapping ONLY on grant).
 * Append-only. No network, no real pixel scripts.
 */

interface FakeEl {
  tag: string;
  async: boolean;
  src: string;
  _attrs: Record<string, string>;
  setAttribute(k: string, v: string): void;
}

interface HarnessOpts {
  extra: Record<string, string | undefined>;
  createElementThrows?: boolean;
}

interface FbqSpy {
  (...args: unknown[]): void;
  calls: unknown[][];
}

/**
 * (Re)load webAnalytics.web.ts fresh with a mocked expo-constants + posthog-js
 * and a fake window/document. Returns the module + a handle on injected scripts.
 */
function loadHarness(opts: HarnessOpts): {
  wa: typeof import("../webAnalytics.web");
  injected: FakeEl[];
  getFbq: () => FbqSpy | undefined;
} {
  const injected: FakeEl[] = [];

  const makeEl = (tag: string): FakeEl => ({
    tag,
    async: false,
    src: "",
    _attrs: {},
    setAttribute(k: string, v: string): void {
      this._attrs[k] = v;
    },
  });

  const store = new Map<string, string>();
  const fakeWindow: Record<string, unknown> = {
    document: {
      createElement: (tag: string): FakeEl => {
        if (opts.createElementThrows) throw new Error("CSP blocked the pixel script");
        return makeEl(tag);
      },
      querySelector: (sel: string): unknown => {
        const m = /data-mingla-pixel="([^"]+)"/.exec(sel);
        if (m && injected.some((s) => s._attrs["data-mingla-pixel"] === m[1])) return {};
        return null;
      },
      head: {
        appendChild: (el: FakeEl): void => {
          injected.push(el);
        },
      },
    },
    localStorage: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => {
        store.set(k, v);
      },
    },
    sessionStorage: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => {
        store.set(k, v);
      },
    },
    location: { search: "", href: "https://usemingla.com/e/brand/event" },
  };

  jest.resetModules();
  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: { expoConfig: { extra: opts.extra } },
  }));
  jest.doMock("posthog-js", () => ({
    __esModule: true,
    default: {
      init: jest.fn(),
      opt_in_capturing: jest.fn(),
      opt_out_capturing: jest.fn(),
      capture: jest.fn(),
      identify: jest.fn(),
      getFeatureFlag: jest.fn(),
    },
  }));

  (globalThis as unknown as { window: unknown }).window = fakeWindow;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const wa = require("../webAnalytics.web") as typeof import("../webAnalytics.web");
  return {
    wa,
    injected,
    getFbq: () => fakeWindow.fbq as FbqSpy | undefined,
  };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  jest.resetModules();
});

const META_EXTRA = {
  EXPO_PUBLIC_META_PIXEL_ID: "1949011972638955",
  EXPO_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

test("CONSENT GATE — no pixel loads or fires before grantConsent (SC-8 / RT-3)", async () => {
  const { wa, injected, getFbq } = loadHarness({ extra: META_EXTRA });
  await wa.initWebAnalytics();

  // Post-init, pre-consent: NOTHING is bootstrapped.
  expect(wa.adPixelsReady()).toBe(false);
  expect(getFbq()).toBeUndefined();
  expect(injected.some((s) => s._attrs["data-mingla-pixel"] === "meta")).toBe(false);

  // A Purchase fire pre-consent is a NO-OP (no fbq, no throw).
  expect(() => wa.fireAdPurchase("order-xyz", { value: 20, currency: "GBP" })).not.toThrow();
  expect(getFbq()).toBeUndefined();
});

test("grantConsent BOOTSTRAPS the Meta pixel; fireAdPurchase fires with the shared event_id (SC-15)", async () => {
  const { wa, injected, getFbq } = loadHarness({ extra: META_EXTRA });
  await wa.initWebAnalytics();

  await wa.grantConsent();

  // Now the pixel is live: stub created + script injected + init + PageView.
  expect(wa.adPixelsReady()).toBe(true);
  const fbq = getFbq();
  expect(fbq).toBeDefined();
  expect(injected.some((s) => s._attrs["data-mingla-pixel"] === "meta")).toBe(true);

  // The DEDUP fire: the 4th arg eventID MUST equal the shared event_id (order id).
  wa.fireAdPurchase("order-xyz", { value: 20, currency: "GBP" });
  const fbqSpy = fbq as unknown as { queue?: unknown[][] };
  // fbevents.js is not loaded in the test, so calls sit on the stub queue.
  const queued = (fbqSpy.queue ?? []) as unknown[][];
  const purchase = queued.find((a) => a[0] === "track" && a[1] === "Purchase");
  expect(purchase).toBeDefined();
  expect(purchase?.[2]).toEqual({ value: 20, currency: "GBP" });
  expect(purchase?.[3]).toEqual({ eventID: "order-xyz" }); // == server CAPI event_id
});

test("NO-OP when the pixel id is absent — grantConsent loads no Meta pixel", async () => {
  const { wa, injected, getFbq } = loadHarness({
    extra: { EXPO_PUBLIC_SUPABASE_URL: "https://x.supabase.co", EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon" },
  });
  await wa.initWebAnalytics();
  await wa.grantConsent();

  // No id → no fbq stub, no injected script; firing is a silent no-op.
  expect(getFbq()).toBeUndefined();
  expect(injected.some((s) => s._attrs["data-mingla-pixel"] === "meta")).toBe(false);
  expect(() => wa.fireAdPurchase("order-1", { value: 5, currency: "USD" })).not.toThrow();
});

test("a simulated pixel-LOAD FAILURE does NOT throw / break the flow (fail-open)", async () => {
  const { wa } = loadHarness({ extra: META_EXTRA, createElementThrows: true });
  await wa.initWebAnalytics();

  // Script injection throws (CSP/adblock) — grantConsent must absorb it silently.
  await expect(wa.grantConsent()).resolves.toBeUndefined();
  // And the checkout Purchase fire that follows must not throw either.
  expect(() => wa.fireAdPurchase("order-xyz", { value: 20, currency: "GBP" })).not.toThrow();
  expect(() => wa.fireAdPageView()).not.toThrow();
});
