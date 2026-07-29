/**
 * ISSUE-855 PR-2 — source tracking, CLIENT leg (append-only, NEW file).
 *
 * Proves the browser half of forward-only source tracking:
 *   (P1) A NON-AD visit that carries a referrer (search / social / organic) now
 *        RECORDS a touch (the PR-1 early-bail is loosened) and forwards the
 *        referrer HOST only — NO PII (SC-8/SC-9).
 *   (P2) A truly bare visit (no ad param, no utm, no referrer) STILL no-ops
 *        (byte-identical to the pre-PR-2 contract — nothing fabricated).
 *   (P3) readReferrerHost strips path/query/fragment → host only.
 *   (P4) FIRST-TOUCH-WINS: a later internal-nav (Mingla-referrer) touch does NOT
 *        clobber the click_id of the ad touch that actually drove the session.
 *
 * Hermetic: fake window/document (with a settable document.referrer) + a captured
 * global fetch. No network, no real pixels.
 */

interface Harness {
  wa: typeof import("../webAnalytics.web");
  fetchCalls: { url: string; body: string }[];
  win: Record<string, unknown>;
}

const ENV = {
  EXPO_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

function loadHarness(locationSearch = "", referrer = ""): Harness {
  const store = new Map<string, string>();
  const win: Record<string, unknown> = {
    document: {
      referrer,
      createElement: () => ({ setAttribute() {}, _attrs: {} }),
      querySelector: () => null,
      head: { appendChild() {} },
    },
    localStorage: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => void store.set(k, v),
    },
    sessionStorage: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => void store.set(k, v),
    },
    location: {
      search: locationSearch,
      href: "https://usemingla.com/e/brand/event" + locationSearch,
    },
  };

  jest.resetModules();
  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: { expoConfig: { extra: ENV } },
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

  let clickSeq = 0;
  const fetchCalls: { url: string; body: string }[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = (
    url: string,
    init?: RequestInit,
  ) => {
    fetchCalls.push({ url: String(url), body: String((init ?? {}).body ?? "") });
    clickSeq += 1;
    const clickId = `srv-click-${clickSeq}`;
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ click_id: clickId }),
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const wa = require("../webAnalytics.web") as typeof import("../webAnalytics.web");
  return { wa, fetchCalls, win };
}

const flush = () => new Promise((r) => setTimeout(r, 10));

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
  jest.resetModules();
});

// ═══ P1 — a social/search/organic visit (no ad signal) now RECORDS a touch ════
test("P1 a NON-AD referrer visit records a touch forwarding the referrer HOST only (no PII)", async () => {
  const h = loadHarness("", "https://l.instagram.com/p/xyz?u=someone%40example.com");
  await h.wa.initWebAnalytics();
  h.fetchCalls.length = 0;
  h.wa.captureAdClickIds({ pageType: "event", brandSlug: "b", entitySlug: "e" });

  const touch = h.fetchCalls.find(
    (c) => c.url.includes("/attribution-capture") && c.body.includes("touch"),
  );
  expect(touch).toBeDefined();
  const tp = JSON.parse(touch!.body);
  expect(tp.kind).toBe("touch");
  // Host ONLY — the path (/p/xyz) and the ?u=email query never leave the browser.
  expect(tp.referrer).toBe("l.instagram.com");
  expect(tp.external_click_id).toBeNull();
  const bodyLower = touch!.body.toLowerCase();
  expect(bodyLower).not.toContain("example.com");
  expect(bodyLower).not.toContain("someone");
  expect(bodyLower).not.toContain("email");
  expect(bodyLower).not.toContain("phone");
  expect(bodyLower).not.toContain("/p/xyz");
});

// ═══ P2 — a bare visit still no-ops (pre-PR-2 contract preserved) ══════════════
test("P2 a bare visit (no ad param, no utm, no referrer) posts NOTHING (byte-identical no-op)", async () => {
  const h = loadHarness("", ""); // empty search + empty referrer
  await h.wa.initWebAnalytics();
  h.fetchCalls.length = 0;
  h.wa.captureAdClickIds({ pageType: "event", brandSlug: "b", entitySlug: "e" });
  expect(h.fetchCalls.some((c) => c.url.includes("/attribution-capture"))).toBe(false);
});

// ═══ P3 — readReferrerHost strips everything but the host ══════════════════════
test("P3 readReferrerHost returns the host only; null for empty/absent referrer", () => {
  const h = loadHarness("", "https://www.Google.com/search?q=secret#frag");
  expect(h.wa.readReferrerHost()).toBe("google.com");

  // Empty referrer → null (a direct visit).
  (h.win.document as { referrer: string }).referrer = "";
  expect(h.wa.readReferrerHost()).toBeNull();
});

// ═══ P4 — FIRST-TOUCH-WINS: organic internal-nav never clobbers the ad click ═══
test("P4 the ad click_id is preserved when a later internal (Mingla-referrer) touch fires", async () => {
  // 1) Land via an ad (fbclid), no referrer → records + stores the ad click_id.
  const h = loadHarness("?fbclid=ADCLICK", "");
  await h.wa.initWebAnalytics();
  h.wa.captureAdClickIds({ pageType: "event", brandSlug: "b", entitySlug: "e" });
  await flush();
  const adClick = h.wa.getStoredClickAttribution().clickId;
  expect(adClick).toBe("srv-click-1");

  // 2) Internal navigation to another public page: no fbclid, referrer = a Mingla
  //    host (→ organic). It STILL records a touch, but must NOT overwrite the ad
  //    click that drove the session (first-touch-wins).
  (h.win.location as { search: string }).search = "";
  (h.win.document as { referrer: string }).referrer = "https://go.usemingla.com/e/brand/event2";
  h.wa.captureAdClickIds({ pageType: "event", brandSlug: "b", entitySlug: "e2" });
  await flush();
  // A second touch WAS posted (organic capture works)...
  expect(h.fetchCalls.filter((c) => c.url.includes("/attribution-capture")).length)
    .toBeGreaterThanOrEqual(2);
  // ...but the threaded click_id is still the FIRST (ad) one.
  expect(h.wa.getStoredClickAttribution().clickId).toBe(adClick);
});
