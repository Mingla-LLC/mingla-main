/**
 * ISSUE-865 PR1 WP-2 — browser fireAdReservation (LEAD-type) + consent gate.
 *
 * NEW (append-only). The reservation twin of fireAdPurchase, proven under the
 * SAME consent gate:
 *   • pre-consent, fireAdReservation is a NO-OP (no pixel, no throw) — SC-8/RT-3,
 *   • on consent grant it fires the LEAD-type Meta event 'Schedule' with the
 *     shared event_id as `eventID` (dedups with the server CAPI lead send),
 *   • it is NEVER a value'd 'Purchase' (the two-tier boundary),
 *   • absent pixel id / a load failure is a silent no-op (fail-open).
 *
 * fails-on-revert target: the consent gate (fireAdReservation firing pre-consent),
 * and the lead-branch event name ('Schedule', not 'Purchase').
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

test("CONSENT GATE — fireAdReservation is a NO-OP before grantConsent (SC-8 / RT-3)", async () => {
  const { wa, getFbq } = loadHarness(META_EXTRA);
  await wa.initWebAnalytics();
  expect(wa.adPixelsReady()).toBe(false);
  expect(() => wa.fireAdReservation("resv-1", { value: 0, currency: "GBP" })).not.toThrow();
  expect(getFbq()).toBeUndefined();
});

test("grantConsent → fireAdReservation fires the LEAD Meta event 'Schedule' with the shared eventID (not 'Purchase')", async () => {
  const { wa, getFbq } = loadHarness(META_EXTRA);
  await wa.initWebAnalytics();
  wa.grantConsent();
  wa.fireAdReservation("resv-xyz");

  const fbq = getFbq();
  expect(fbq).toBeDefined();
  const queued = ((fbq as unknown as { queue?: unknown[][] }).queue ?? []) as unknown[][];
  const schedule = queued.find((a) => a[0] === "track" && a[1] === "Schedule");
  expect(schedule).toBeDefined();
  expect(schedule?.[3]).toEqual({ eventID: "resv-xyz" }); // == server CAPI event_id
  // It is NEVER a value'd Purchase (the two-tier boundary).
  expect(queued.find((a) => a[0] === "track" && a[1] === "Purchase")).toBeUndefined();
});

test("free RSVP with no value — 'Schedule' still fires (£0 lead), no throw", async () => {
  const { wa, getFbq } = loadHarness(META_EXTRA);
  await wa.initWebAnalytics();
  wa.grantConsent();
  expect(() => wa.fireAdReservation("resv-free")).not.toThrow();
  const queued = ((getFbq() as unknown as { queue?: unknown[][] }).queue ?? []) as unknown[][];
  expect(queued.some((a) => a[0] === "track" && a[1] === "Schedule")).toBe(true);
});

test("NO-OP when the pixel id is absent (silent, never throws)", async () => {
  const { wa, getFbq } = loadHarness({
    EXPO_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon",
  });
  await wa.initWebAnalytics();
  wa.grantConsent();
  expect(() => wa.fireAdReservation("resv-1")).not.toThrow();
  expect(getFbq()).toBeUndefined();
});
