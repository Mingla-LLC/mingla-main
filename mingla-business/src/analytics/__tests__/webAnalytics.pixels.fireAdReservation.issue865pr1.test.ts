/**
 * ISSUE-865 PR1 WP-2 — browser fireAdReservation (LEAD-type) + consent gate.
 *
 * NEW (append-only). The reservation twin of fireAdPurchase, proven under the
 * SAME consent gate:
 *   • pre-consent, fireAdReservation is a NO-OP (no pixel, no throw) — SC-8/RT-3,
 *   • on consent grant it fires Meta 'CompleteRegistration' with the
 *     shared event_id as `eventID` (dedups with the server CAPI sign-up send),
 *   • it is NEVER a value'd 'Purchase' (the two-tier boundary),
 *   • absent pixel id / a load failure is a silent no-op (fail-open).
 * [TEST-MOD-APPROVED #3697] F-4: Schedule → CompleteRegistration
 *
 * fails-on-revert target: the consent gate (fireAdReservation firing pre-consent),
 * and the sign-up event name ('CompleteRegistration', not 'Purchase').
 *
 * Mirrors the shipped webAnalytics.pixels.issue865 harness (fake window/document +
 * mocked expo-constants/posthog-js). No network, no real pixel scripts.
 */
interface FakeEl {
  tag: string;
  async: boolean;
  src: string;
  _attrs: Record<string, string>;
  setAttribute(k: string, v: string): void;
}

interface FbqSpy {
  (...args: unknown[]): void;
  queue?: unknown[][];
}

function loadHarness(extra: Record<string, string | undefined>): {
  wa: typeof import("../webAnalytics.web");
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
      createElement: (tag: string): FakeEl => makeEl(tag),
      querySelector: (sel: string): unknown => {
        const m = /data-mingla-pixel="([^"]+)"/.exec(sel);
        if (m && injected.some((s) => s._attrs["data-mingla-pixel"] === m[1])) return {};
        return null;
      },
      head: { appendChild: (el: FakeEl): void => void injected.push(el) },
    },
    localStorage: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => void store.set(k, v),
    },
    sessionStorage: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => void store.set(k, v),
    },
    location: { search: "", href: "https://usemingla.com/reserve/brand" },
  };

  jest.resetModules();
  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: { expoConfig: { extra } },
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
  return { wa, getFbq: () => fakeWindow.fbq as FbqSpy | undefined };
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

test("ARRIVAL MODE — fireAdReservation is available before the banner choice", async () => {
  const { wa, getFbq } = loadHarness(META_EXTRA);
  await wa.initWebAnalytics();
  expect(wa.adPixelsReady()).toBe(true);
  expect(() => wa.fireAdReservation("resv-1", {
    value: 0,
    currency: "GBP",
    contentId: "event-1",
    brandId: "brand-1",
  })).not.toThrow();
  expect(getFbq()).toBeDefined();
});

test("grantConsent → fireAdReservation fires Meta 'CompleteRegistration' with the shared eventID (not 'Purchase')", async () => {
  const { wa, getFbq } = loadHarness(META_EXTRA);
  await wa.initWebAnalytics();
  await wa.grantConsent();
  wa.fireAdReservation("resv-xyz", {
    value: 0,
    currency: "GBP",
    contentId: "event-xyz",
    brandId: "brand-xyz",
  });

  const fbq = getFbq();
  expect(fbq).toBeDefined();
  const queued = ((fbq as unknown as { queue?: unknown[][] }).queue ?? []) as unknown[][];
  const schedule = queued.find((a) => a[0] === "track" && a[1] === "CompleteRegistration");
  expect(schedule).toBeDefined();
  expect(schedule?.[2]).toMatchObject({
    value: 0,
    currency: "GBP",
    content_type: "product",
    content_ids: ["event-xyz"],
    brand_id: "brand-xyz",
  });
  expect(schedule?.[3]).toEqual({ eventID: "resv-xyz" }); // == server CAPI event_id
  // It is NEVER a value'd Purchase (the two-tier boundary).
  expect(queued.find((a) => a[0] === "track" && a[1] === "Purchase")).toBeUndefined();
});

test("free RSVP with zero value — 'CompleteRegistration' still fires (£0 sign-up), no throw", async () => {
  const { wa, getFbq } = loadHarness(META_EXTRA);
  await wa.initWebAnalytics();
  await wa.grantConsent();
  expect(() => wa.fireAdReservation("resv-free", {
    value: 0,
    currency: "GBP",
    contentId: "event-free",
    brandId: "brand-free",
  })).not.toThrow();
  const queued = ((getFbq() as unknown as { queue?: unknown[][] }).queue ?? []) as unknown[][];
  expect(queued.some((a) => a[0] === "track" && a[1] === "CompleteRegistration")).toBe(true);
});

test("NO-OP when the pixel id is absent (silent, never throws)", async () => {
  const { wa, getFbq } = loadHarness({
    EXPO_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon",
  });
  await wa.initWebAnalytics();
  await wa.grantConsent();
  expect(() => wa.fireAdReservation("resv-1")).not.toThrow();
  expect(getFbq()).toBeUndefined();
});
