// MINGLA-INVARIANT: I-4238-NO-PRIVATE-TOKEN-TO-PIXELS | issue #4238 | on buyer web, the buyer status token (bst) and the checkout/provider return ids (csi, cs, rcs, trxref, reference) are removed from the visible address before any ad pixel or analytics vendor boots or fires; the page still reads them from memory.
/**
 * #4238 P1-5. Stripe and Paystack return the buyer to
 * /checkout/<id>/confirm?cs=…&csi=…&bst=<token> (and /o/venue/<id>?bst=…).
 * The pixel runtime booted there and the vendor scripts read the full address,
 * so the token that reads the buyer's order went to Meta, TikTok, Snap and
 * Reddit. jest, node env, hand-rolled DOM (same harness as ssrTakeover).
 */
import {
  readPageSearch,
  resetPrivateUrlTokensForTest,
  scrubPrivateUrlTokens,
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
  EXPO_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

function loadHarness(href: string) {
  const injected: FakeEl[] = [];
  // The address each vendor script saw at the moment it was injected.
  const searchAtInjection: string[] = [];
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
  const historyState = { __EXPO_ROUTER_key: "k-1" };
  const history = {
    state: historyState as unknown,
    replaceState(state: unknown, _u: string, next: string): void {
      const parsed = new URL(next, url.origin);
      history.state = state;
      location.pathname = parsed.pathname;
      location.search = parsed.search;
      location.hash = parsed.hash;
    },
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
  const win: Record<string, unknown> = {
    document: {
      cookie: "",
      referrer: "",
      createElement: (tag: string): FakeEl => makeEl(tag),
      querySelector: (sel: string): unknown => {
        const m = /data-mingla-pixel="([^"]+)"/.exec(sel);
        return m && injected.some((s) => s._attrs["data-mingla-pixel"] === m[1]) ? {} : null;
      },
      querySelectorAll: (sel: string): FakeEl[] =>
        sel === "script[data-mingla-pixel]" ? [...injected] : [],
      head: {
        appendChild: (el: FakeEl): void => {
          searchAtInjection.push(location.search);
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
    location,
    history,
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tokens = require("../../utils/privateUrlTokens") as typeof import("../../utils/privateUrlTokens");
  return { wa, tokens, win, location, history, historyState, injected, searchAtInjection };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
  resetPrivateUrlTokensForTest();
  jest.resetModules();
});

const PRIVATE = /[?&](bst|csi|cs|rcs|trxref|reference)=/;

test("P1-5: a cold Stripe return to /checkout/<id>/confirm boots pixels only after bst/csi/cs leave the address", async () => {
  const h = loadHarness(
    "https://host.usemingla.com/checkout/e1/confirm?cs=cs_test_1&csi=sess-1&bst=tok-secret&utm_source=meta",
  );
  await h.wa.initWebAnalytics("/checkout/e1/confirm");
  expect(h.injected.length).toBeGreaterThan(0);
  for (const seen of h.searchAtInjection) expect(seen).not.toMatch(PRIVATE);
  expect(h.location.search).toBe("?utm_source=meta");
  expect(h.location.pathname).toBe("/checkout/e1/confirm");
  expect(h.history.state).toBe(h.historyState);
  // The page still reads its own return credentials.
  const params = new URLSearchParams(h.tokens.readPageSearch(h.location));
  expect(params.get("bst")).toBe("tok-secret");
  expect(params.get("csi")).toBe("sess-1");
  expect(params.get("cs")).toBe("cs_test_1");
});

test("P1-5: the Purchase dedup pixel still fires on confirm, and a router write-back is scrubbed before it", async () => {
  const h = loadHarness("https://host.usemingla.com/checkout/e1/confirm?cs=paystack&csi=sess-2&bst=tok-2&trxref=r1&reference=r1");
  await h.wa.initWebAnalytics("/checkout/e1/confirm");
  // A router state sync writes the old address back.
  h.history.replaceState(h.history.state, "", "/checkout/e1/confirm?cs=paystack&csi=sess-2&bst=tok-2");
  const fbq = h.win.fbq as unknown as jest.Mock | undefined;
  expect(typeof fbq).toBe("function");
  let searchAtPurchase: string | null = null;
  h.win.fbq = Object.assign(
    (...args: unknown[]) => {
      if (args[1] === "Purchase") searchAtPurchase = h.location.search;
    },
    fbq as object,
  );
  h.wa.fireAdPurchase("order-1", { value: 25, currency: "GBP", contentId: "event-4238", brandId: "brand-4238" });
  expect(searchAtPurchase).toBe("");
});

test("P1-5: /o/venue/<id>?bst=… is scrubbed too; a host route and a public page without tokens are untouched", () => {
  const venue = { pathname: "/o/venue/ord-1", search: "?bst=tok-3&cs=cs_1", hash: "" };
  const history = { state: null, replaceState: jest.fn() };
  expect(scrubPrivateUrlTokens({ location: venue, history })).toBe(true);
  expect(history.replaceState).toHaveBeenCalledWith(null, "", "/o/venue/ord-1");
  expect(readPageSearch(venue)).toBe("?bst=tok-3&cs=cs_1");

  resetPrivateUrlTokensForTest();
  const host = { pathname: "/events", search: "?cs=1", hash: "" };
  const hostHistory = { state: null, replaceState: jest.fn() };
  expect(scrubPrivateUrlTokens({ location: host, history: hostHistory })).toBe(false);
  expect(hostHistory.replaceState).not.toHaveBeenCalled();

  const page = { pathname: "/e/wise/party", search: "?fbclid=abc", hash: "" };
  const pageHistory = { state: null, replaceState: jest.fn() };
  expect(scrubPrivateUrlTokens({ location: page, history: pageHistory })).toBe(false);
  expect(readPageSearch(page)).toBe("?fbclid=abc");
});
