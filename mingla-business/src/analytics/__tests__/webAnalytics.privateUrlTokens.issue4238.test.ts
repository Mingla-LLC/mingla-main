// MINGLA-INVARIANT: I-4238-NO-PRIVATE-TOKEN-TO-PIXELS | issue #4238 | on buyer web, no third-party ad pixel (Meta, TikTok, Snap, Reddit) boots or fires in a document whose address carried a buyer return page's private keys (bst, csi, cs, rcs, trxref, reference, token); GA4 and PostHog only receive URLs with those keys removed; the address itself is never rewritten, so a refresh of a confirm page still resumes.
/**
 * #4238 P1-5 (rework 2). Stripe and Paystack return the buyer to
 * /checkout/<id>/confirm?cs=…&csi=…&bst=<token> (and the trip / experience
 * twins, /o/venue/<id>?bst=…, /reserve/<brand>/confirm?rcs=…&bst=…). Scrubbing
 * the address failed in a browser (Expo Router wrote it back, and a refresh
 * lost the confirmation), so the address stays and the vendors are kept away
 * from it instead. jest, node env, hand-rolled DOM.
 */
import {
  hasPrivateUrlToken,
  stripPrivateUrlParams,
  stripPrivateUrlProperties,
} from "../../utils/privateUrlTokens";

interface FakeEl {
  tag: string;
  src: string;
  async: boolean;
  _attrs: Record<string, string>;
  setAttribute(k: string, v: string): void;
  remove(): void;
}

const EXTRA = {
  EXPO_PUBLIC_META_PIXEL_ID: "1949011972638955",
  EXPO_PUBLIC_TIKTOK_PIXEL_CODE: "D9B98EBC77U1EOHV2O0G",
  EXPO_PUBLIC_SNAP_PIXEL_ID: "snap-pixel-4238",
  EXPO_PUBLIC_REDDIT_PIXEL_ID: "a2_jcfwvnfcfqcs",
  EXPO_PUBLIC_GA4_MEASUREMENT_ID: "G-TEST4238",
  EXPO_PUBLIC_POSTHOG_KEY: "phc_test_4238",
  EXPO_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

const PIXEL_HOSTS = /facebook\.net|tiktok\.com|sc-static\.net|redditstatic\.com/;
const PRIVATE = /[?&#](bst|csi|cs|rcs|trxref|reference|token)=/;

function loadHarness(href: string, referrer = "") {
  const injected: FakeEl[] = [];
  const url = new URL(href);
  const location = {
    search: url.search,
    pathname: url.pathname,
    hash: url.hash,
    origin: url.origin,
    get href(): string {
      return `${url.origin}${this.pathname}${this.search}${this.hash}`;
    },
  };
  const go = (next: string): void => {
    const parsed = new URL(next, url.origin);
    location.pathname = parsed.pathname;
    location.search = parsed.search;
    location.hash = parsed.hash;
  };
  const makeEl = (tag: string): FakeEl => {
    const element: FakeEl = {
      tag,
      src: "",
      async: false,
      _attrs: {},
      setAttribute(k: string, v: string): void {
        this._attrs[k] = v;
      },
      remove(): void {
        const i = injected.indexOf(element);
        if (i >= 0) injected.splice(i, 1);
      },
    };
    return element;
  };
  const store = new Map<string, string>();
  const storage = {
    get length(): number {
      return store.size;
    },
    key: (i: number): string | null => [...store.keys()][i] ?? null,
    getItem: (k: string): string | null => store.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      store.set(k, v);
    },
    removeItem: (k: string): void => {
      store.delete(k);
    },
  };
  const win: Record<string, unknown> = {
    document: {
      cookie: "",
      referrer,
      createElement: (tag: string): FakeEl => makeEl(tag),
      querySelector: (sel: string): unknown => {
        const m = /data-mingla-(?:pixel|ga4)="([^"]+)"/.exec(sel);
        return m &&
          injected.some(
            (s) =>
              s._attrs["data-mingla-pixel"] === m[1] ||
              s._attrs["data-mingla-ga4"] === m[1],
          )
          ? {}
          : null;
      },
      querySelectorAll: (sel: string): FakeEl[] =>
        sel === "script[data-mingla-pixel]"
          ? injected.filter((s) => s._attrs["data-mingla-pixel"] !== undefined)
          : [],
      head: {
        appendChild: (el: FakeEl): void => {
          injected.push(el);
        },
      },
    },
    localStorage: storage,
    sessionStorage: storage,
    location,
    navigator: { userAgent: "jest" },
  };
  (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }),
  );
  jest.resetModules();
  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: { expoConfig: { extra: EXTRA } },
  }));
  const persistenceProps: Record<string, unknown> = {
    // posthog.init stores the first page's address once (register_once).
    $initial_person_info: { r: "$direct", u: href },
  };
  const posthog = {
    persistence: {
      props: persistenceProps,
      register: jest.fn((props: Record<string, unknown>) => {
        Object.assign(persistenceProps, props);
      }),
    },
    init: jest.fn(),
    opt_in_capturing: jest.fn(),
    opt_out_capturing: jest.fn(),
    capture: jest.fn(),
    identify: jest.fn(),
    getFeatureFlag: jest.fn(),
  };
  jest.doMock("posthog-js", () => ({ __esModule: true, default: posthog }));
  (globalThis as unknown as { window: unknown }).window = win;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const wa = require("../webAnalytics.web") as typeof import("../webAnalytics.web");
  const pixelScripts = (): FakeEl[] => injected.filter((s) => PIXEL_HOSTS.test(s.src));
  const dataLayer = (): unknown[][] =>
    ((win.dataLayer as unknown[] | undefined) ?? []).map((entry) =>
      Array.from(entry as ArrayLike<unknown>),
    );
  return { wa, win, location, go, injected, pixelScripts, posthog, dataLayer };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
  jest.resetModules();
});

const TOKEN_RETURNS: ReadonlyArray<readonly [string, string]> = [
  ["/checkout/e1/confirm", "?cs=cs_test_1&csi=sess-1&bst=tok-secret&utm_source=meta"],
  ["/checkout-trip/t1/confirm", "?cs=paystack&csi=sess-2&bst=tok-2&trxref=r1&reference=r1"],
  ["/checkout-experience/x1/confirm", "?cs=cs_test_3&csi=sess-3&bst=tok-3"],
  ["/o/venue/ord-1", "?bst=tok-4&cs=cs_test_4"],
  ["/reserve/brand-1/confirm", "?cs=cs_test_5&rcs=res-5&bst=tok-5"],
];

test.each(TOKEN_RETURNS)(
  "P1-5: a cold return to %s boots no ad pixel, fires no Purchase, and leaves the address as it was",
  async (pathname, search) => {
    const h = loadHarness(`https://host.usemingla.com${pathname}${search}`);
    await h.wa.initWebAnalytics(pathname);
    expect(h.pixelScripts()).toEqual([]);
    for (const global of ["fbq", "ttq", "snaptr", "rdt"]) {
      expect(h.win[global]).toBeUndefined();
    }
    expect(h.wa.adPixelsReady()).toBe(false);
    h.wa.fireAdPurchase("order-1", {
      value: 25,
      currency: "GBP",
      contentId: "event-4238",
      brandId: "brand-4238",
    });
    expect(h.win.fbq).toBeUndefined();
    // The confirm pages read these keys, and a refresh must still resume
    // (ORCH-0928): the address is never rewritten.
    expect(h.location.pathname).toBe(pathname);
    expect(h.location.search).toBe(search);
  },
);

test("P1-5: the block is sticky for the document (a later token-free page and a turn-on boot no pixel)", async () => {
  const h = loadHarness(
    "https://host.usemingla.com/checkout/e1/confirm?cs=cs_test_1&csi=sess-1&bst=tok-secret",
  );
  await h.wa.initWebAnalytics("/checkout/e1/confirm");
  h.go("/e/wise/party");
  await h.wa.initWebAnalytics("/e/wise/party");
  await h.wa.savePrivacyChoice({ analytics: true, ads: true });
  expect(h.pixelScripts()).toEqual([]);
  expect(h.wa.adPixelsReady()).toBe(false);
});

test("P1-5: pixels booted on a public page are torn down when the tab reaches a token address", async () => {
  const h = loadHarness("https://host.usemingla.com/e/wise/party");
  await h.wa.initWebAnalytics("/e/wise/party");
  expect(h.pixelScripts().length).toBeGreaterThan(0);
  expect(h.wa.adPixelsReady()).toBe(true);
  h.go("/o/venue/ord-1?bst=tok-4");
  await h.wa.initWebAnalytics("/o/venue/ord-1");
  expect(h.pixelScripts()).toEqual([]);
  expect(h.win.fbq).toBeUndefined();
  expect(h.win.ttq).toBeUndefined();
  expect(h.wa.adPixelsReady()).toBe(false);
});

test("P1-5: a public page without private keys still boots every pixel (control)", async () => {
  const h = loadHarness("https://host.usemingla.com/e/wise/party?utm_source=meta&fbclid=abc");
  await h.wa.initWebAnalytics("/e/wise/party");
  expect(h.pixelScripts().map((s) => s._attrs["data-mingla-pixel"]).sort()).toEqual([
    "meta",
    "reddit",
    "snap",
    "tiktok",
  ]);
});

test("P1-5: GA4 gets a sanitized page_location / page_referrer as the tag default and before every event", async () => {
  const h = loadHarness(
    "https://host.usemingla.com/checkout/e1/confirm?cs=cs_test_1&csi=sess-1&bst=tok-secret&utm_source=meta",
    "https://host.usemingla.com/checkout/e1/buyer?csi=sess-1&bst=tok-secret",
  );
  await h.wa.initWebAnalytics("/checkout/e1/confirm");
  h.wa.gaEvent("purchase", { transaction_id: "order-1" });
  const layer = h.dataLayer();
  const config = layer.find((args) => args[0] === "config");
  expect(config?.[2]).toMatchObject({
    send_page_view: false,
    page_location: "https://host.usemingla.com/checkout/e1/confirm?utm_source=meta",
    page_referrer: "https://host.usemingla.com/checkout/e1/buyer",
  });
  const sets = layer.filter((args) => args[0] === "set");
  expect(sets.length).toBeGreaterThanOrEqual(2);
  const purchaseIndex = layer.findIndex((args) => args[0] === "event" && args[1] === "purchase");
  const lastSetBeforePurchase = layer
    .slice(0, purchaseIndex)
    .reverse()
    .find((args) => args[0] === "set");
  expect(lastSetBeforePurchase?.[1]).toEqual({
    page_location: "https://host.usemingla.com/checkout/e1/confirm?utm_source=meta",
    page_referrer: "https://host.usemingla.com/checkout/e1/buyer",
  });
  expect(JSON.stringify(layer)).not.toMatch(/tok-secret|sess-1|cs_test_1/);

  // A document without private keys keeps GA4's own defaults (#3176 config).
  const clean = loadHarness("https://host.usemingla.com/e/wise/party?utm_source=meta");
  await clean.wa.initWebAnalytics("/e/wise/party");
  const cleanLayer = clean.dataLayer();
  expect(cleanLayer.find((args) => args[0] === "config")?.[2]).toEqual({ send_page_view: false });
  expect(cleanLayer.some((args) => args[0] === "set")).toBe(false);
});

test("P1-5: PostHog before_send strips the keys from every URL-bearing property, replay meta included", async () => {
  const h = loadHarness(
    "https://host.usemingla.com/checkout/e1/confirm?cs=cs_test_1&csi=sess-1&bst=tok-secret&utm_source=meta",
  );
  await h.wa.initWebAnalytics("/checkout/e1/confirm");
  expect(h.posthog.init).toHaveBeenCalledTimes(1);
  const config = h.posthog.init.mock.calls[0]?.[1] as {
    before_send: (event: unknown) => Record<string, unknown> | null;
  };
  const tokenUrl =
    "https://host.usemingla.com/checkout/e1/confirm?cs=cs_test_1&csi=sess-1&bst=tok-secret&utm_source=meta";
  const out = config.before_send({
    event: "$autocapture",
    uuid: "u1",
    properties: {
      $current_url: tokenUrl,
      $referrer: tokenUrl,
      $pathname: "/checkout/e1/confirm",
      $elements: [{ attr__href: "/o/venue/ord-1?bst=tok-secret" }],
      utm_source: "meta",
    },
    $set_once: { $initial_current_url: tokenUrl },
    $set: { $current_url: tokenUrl },
  });
  expect(JSON.stringify(out)).not.toMatch(/tok-secret|sess-1|cs_test_1/);
  const properties = out?.properties as Record<string, unknown>;
  expect(properties.$current_url).toBe(
    "https://host.usemingla.com/checkout/e1/confirm?utm_source=meta",
  );
  expect(properties.utm_source).toBe("meta");

  const replay = config.before_send({
    event: "$snapshot",
    uuid: "u2",
    properties: {
      $snapshot_data: [
        { type: 4, data: { href: tokenUrl, width: 1, height: 1 } },
        { type: 5, data: { tag: "$url_changed", payload: { href: tokenUrl } } },
      ],
    },
  });
  expect(JSON.stringify(replay)).not.toMatch(/tok-secret|sess-1|cs_test_1/);

  // The #2771 origin-only manual $pageview contract is unchanged.
  const pageview = config.before_send({
    event: "$pageview",
    uuid: "u3",
    properties: { $current_url: tokenUrl, $pathname: "/checkout/e1/confirm" },
  });
  expect((pageview?.properties as Record<string, unknown>).$current_url).toBe(
    "https://host.usemingla.com",
  );
});

test("P1-5: PostHog's stored first-page address (sent with every flags request) loses the keys right after init", async () => {
  const h = loadHarness(
    "https://host.usemingla.com/checkout/e1/confirm?cs=cs_test_1&csi=sess-1&bst=tok-secret&utm_source=meta",
  );
  await h.wa.initWebAnalytics("/checkout/e1/confirm");
  expect(h.posthog.persistence.props.$initial_person_info).toEqual({
    r: "$direct",
    u: "https://host.usemingla.com/checkout/e1/confirm?utm_source=meta",
  });
  // A clean first page is left alone.
  const clean = loadHarness("https://host.usemingla.com/e/wise/party?utm_source=meta");
  await clean.wa.initWebAnalytics("/e/wise/party");
  expect(clean.posthog.persistence.register).not.toHaveBeenCalled();
});

test("P1-5: stripPrivateUrlParams removes only the private keys", () => {
  expect(hasPrivateUrlToken("?utm_source=meta&focus=1")).toBe(false);
  expect(hasPrivateUrlToken("?cs=1")).toBe(true);
  expect(stripPrivateUrlParams("https://h/x?cs=1")).toBe("https://h/x");
  expect(stripPrivateUrlParams("https://h/x?a=1&cs=2&b=3")).toBe("https://h/x?a=1&b=3");
  expect(stripPrivateUrlParams("https://h/x?cs=2&a=1#top")).toBe("https://h/x?a=1#top");
  expect(stripPrivateUrlParams("https://h/x?focus=1&bst=t")).toBe("https://h/x?focus=1");
  expect(stripPrivateUrlParams("https://h/x#csi=1&bst=2")).toBe("https://h/x");
  expect(stripPrivateUrlParams("https://h/x?token=abc&reservationId=r1")).toBe(
    "https://h/x?reservationId=r1",
  );
  expect(
    stripPrivateUrlParams("https://h/auth?next=%2Fcheckout%2Fe1%2Fconfirm%3Fbst%3Dtok%26a%3D1"),
  ).toBe("https://h/auth?next=%2Fcheckout%2Fe1%2Fconfirm%3Fa%3D1");
  expect(stripPrivateUrlParams("https://h/x?utm_source=meta")).toBe("https://h/x?utm_source=meta");
  expect(
    JSON.stringify(stripPrivateUrlProperties({ nested: { deep: ["?bst=t&x=1"] } })),
  ).toBe(JSON.stringify({ nested: { deep: ["?x=1"] } }));
  expect(PRIVATE.test(stripPrivateUrlParams("/o/venue/1?bst=a&cs=b&payment=cancelled"))).toBe(false);
});
