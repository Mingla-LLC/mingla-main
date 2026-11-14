// MINGLA-INVARIANT: I-4238-SPA-PIXEL-RUNTIME-ALWAYS-LOADS | issue #4238 | when ads are on, a server-rendered landing page never leaves the app's pixel runtime unset; browser conversions fire with the server's event id.
// MINGLA-INVARIANT: I-4238-REDDIT-CONVERSIONID | issue #4238 | the Reddit browser dedup key is the platform's documented `conversionId`, and its value equals the server's conversion_id (the Mingla order or reservation id).
/**
 * #4238 Wave 2 browser parity on buyer web (jest, node env, hand-rolled DOM).
 *
 * W2-1 (D4): a server-rendered page sets window.__minglaAdPixelsBootstrapped
 * and boots fbq/ttq/snaptr itself. The SPA used to read that flag as "ready"
 * and never load its own runtime, so every later browser conversion
 * (InitiateCheckout, free sign-up, TikTok identify, all of Reddit) was a
 * silent no-op on an ad landing.
 */

interface FakeEl {
  tag: string;
  async: boolean;
  src: string;
  _attrs: Record<string, string>;
  setAttribute(k: string, v: string): void;
  remove(): void;
}

interface Harness {
  wa: typeof import("../webAnalytics.web");
  win: Record<string, unknown>;
  injected: FakeEl[];
  fetchMock: jest.Mock;
}

const EXTRA = {
  EXPO_PUBLIC_META_PIXEL_ID: "1949011972638955",
  EXPO_PUBLIC_TIKTOK_PIXEL_CODE: "D9B98EBC77U1EOHV2O0G",
  EXPO_PUBLIC_SNAP_PIXEL_ID: "snap-pixel-4238",
  EXPO_PUBLIC_REDDIT_PIXEL_ID: "a2_jcfwvnfcfqcs",
  EXPO_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

const PROPS = {
  value: 25,
  currency: "GBP",
  contentId: "event-4238",
  brandId: "brand-4238",
};

function loadHarness(opts: {
  href: string;
  ssrBooted?: boolean;
}): Harness {
  const injected: FakeEl[] = [];
  const makeEl = (tag: string): FakeEl => {
    const element: FakeEl = {
      tag,
      async: false,
      src: "",
      _attrs: {},
      setAttribute(k: string, v: string): void {
        this._attrs[k] = v;
      },
      remove(): void {
        const index = injected.indexOf(element);
        if (index >= 0) injected.splice(index, 1);
      },
    };
    return element;
  };
  const store = new Map<string, string>();
  const url = new URL(opts.href);
  const win: Record<string, unknown> = {
    document: {
      cookie: "",
      referrer: "",
      createElement: (tag: string): FakeEl => makeEl(tag),
      querySelector: (sel: string): unknown => {
        const m = /data-mingla-pixel="([^"]+)"/.exec(sel);
        if (m && injected.some((s) => s._attrs["data-mingla-pixel"] === m[1])) {
          return {};
        }
        return null;
      },
      querySelectorAll: (sel: string): FakeEl[] =>
        sel === "script[data-mingla-pixel]" ? [...injected] : [],
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
      removeItem: (k: string): void => {
        store.delete(k);
      },
    },
    location: {
      search: url.search,
      pathname: url.pathname,
      href: url.href,
      origin: url.origin,
    },
    navigator: { userAgent: "jest" },
  };
  if (opts.ssrBooted) {
    // What publicAdRuntime.js leaves behind on an older page config: three
    // providers booted (each with its script marker), Reddit missing.
    win.__minglaAdPixelsBootstrapped = true;
    win.__minglaAdPageViewKeys = { [url.href]: true };
    win.fbq = jest.fn();
    win.ttq = { track: jest.fn(), page: jest.fn(), identify: jest.fn() };
    win.snaptr = jest.fn();
    for (const marker of ["meta", "tiktok", "snap"]) {
      const el = makeEl("script");
      el.setAttribute("data-mingla-pixel", marker);
      injected.push(el);
    }
  }
  const fetchMock = jest.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, click_id: "click-4238" }),
    }),
  );
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  jest.resetModules();
  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: { expoConfig: { extra: EXTRA } },
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
  (globalThis as unknown as { window: unknown }).window = win;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const wa = require("../webAnalytics.web") as typeof import("../webAnalytics.web");
  return { wa, win, injected, fetchMock };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
  jest.resetModules();
});

const markers = (injected: FakeEl[]): string[] =>
  injected.map((s) => s._attrs["data-mingla-pixel"]).filter(Boolean);

test("W2-1: after an SSR boot the SPA loads its runtime and InitiateCheckout fires with the session id", async () => {
  const h = loadHarness({
    href: "https://host.usemingla.com/e/wise/party?fbclid=test4238",
    ssrBooted: true,
  });
  await h.wa.initWebAnalytics();
  expect(h.wa.adPixelsReady()).toBe(true);

  h.wa.fireAdInitiateCheckout("sess-1", PROPS);

  const fbq = h.win.fbq as jest.Mock;
  expect(fbq).toHaveBeenCalledWith(
    "track",
    "InitiateCheckout",
    expect.objectContaining({ value: 25, currency: "GBP" }),
    { eventID: "sess-1" },
  );
  const ttq = h.win.ttq as { track: jest.Mock };
  expect(ttq.track).toHaveBeenCalledWith(
    "InitiateCheckout",
    expect.objectContaining({ content_id: "event-4238" }),
    { event_id: "sess-1" },
  );
  const snaptr = h.win.snaptr as jest.Mock;
  expect(snaptr).toHaveBeenCalledWith(
    "track",
    "START_CHECKOUT",
    expect.objectContaining({ client_dedup_id: "sess-1" }),
  );
});

test("W2-1: adopting SSR pixels boots only the missing provider (Reddit) once and never re-sends PageView", async () => {
  const h = loadHarness({
    href: "https://host.usemingla.com/e/wise/party",
    ssrBooted: true,
  });
  await h.wa.initWebAnalytics();
  await h.wa.initWebAnalytics();

  expect(markers(h.injected).filter((m) => m === "reddit")).toHaveLength(1);
  expect(markers(h.injected).filter((m) => m === "meta")).toHaveLength(1);
  const fbq = h.win.fbq as jest.Mock;
  expect(fbq).not.toHaveBeenCalledWith("init", expect.anything());
  expect(fbq).not.toHaveBeenCalledWith("track", "PageView");
  expect((h.win.ttq as { page: jest.Mock }).page).not.toHaveBeenCalled();
  h.wa.fireAdPageView();
  expect(fbq).not.toHaveBeenCalledWith("track", "PageView");
});

test("W2-1: a page with no SSR boot still boots all four providers once", async () => {
  const h = loadHarness({ href: "https://host.usemingla.com/e/wise/party" });
  await h.wa.initWebAnalytics();
  await h.wa.initWebAnalytics();
  expect(markers(h.injected).sort()).toEqual(["meta", "reddit", "snap", "tiktok"]);
});

test("W2-3: the Reddit browser Purchase carries conversionId (the order id) and no conversion_id", async () => {
  const h = loadHarness({
    href: "https://host.usemingla.com/e/wise/party",
    ssrBooted: true,
  });
  await h.wa.initWebAnalytics();
  h.wa.fireAdPurchase("ord-1", PROPS);
  const rdt = h.win.rdt as { callQueue: unknown[][] };
  const purchase = rdt.callQueue.find((a) => a[0] === "track" && a[1] === "Purchase");
  expect(purchase).toBeDefined();
  const payload = (purchase as unknown[])[2] as Record<string, unknown>;
  expect(payload).toEqual({ value: 25, currency: "GBP", conversionId: "ord-1" });
  expect(payload).not.toHaveProperty("conversion_id");
});
