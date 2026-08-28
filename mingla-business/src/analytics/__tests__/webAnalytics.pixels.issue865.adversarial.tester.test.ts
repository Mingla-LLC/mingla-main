/**
 * ISSUE-865 WP-C — TESTER adversarial battery (append-only, mingla-tester).
 *
 * DIFFERENT ANGLES than the implementor's 4 Stage-C tests (which only exercise
 * the Meta pixel + the consent gate). Attacks:
 *   (B1) ALL FOUR browser pixels carry the shared event_id in the CORRECT
 *        per-channel dedup field + the correct event name — the browser half of
 *        SC-5/SC-15 (fbq eventID='Purchase', ttq event_id='CompletePayment',
 *        snaptr client_dedup_id='PURCHASE', rdt conversion_id='Purchase').
 *   (B2) NO PII EGRESS from the checkout conversion POST — even post-consent, the
 *        attribution-capture body carries event_id/value/currency/click_id ONLY;
 *        it NEVER contains an email or phone field (SC-8/SC-9).
 *   (B3) captureAdClickIds forwards click-id + UTM ONLY (no PII) and does NOT
 *        fire when the URL carries no ad signal (byte-identical no-op).
 *   (B4) fireAdViewContent / fireAdPageView are NO-OPS pre-consent (SC-8).
 *
 * Hermetic: fake window/document + a captured global fetch. No network, no real
 * pixel scripts, no real charge.
 */

interface FakeEl {
  tag: string;
  async: boolean;
  src: string;
  _attrs: Record<string, string>;
  setAttribute(k: string, v: string): void;
}

interface Harness {
  wa: typeof import("../webAnalytics.web");
  win: Record<string, unknown>;
  fetchCalls: { url: string; body: string }[];
}

function loadHarness(
  extra: Record<string, string | undefined>,
  locationSearch = "",
): Harness {
  const injected: FakeEl[] = [];
  const store = new Map<string, string>();
  const makeEl = (tag: string): FakeEl => ({
    tag, async: false, src: "", _attrs: {},
    setAttribute(k: string, v: string): void { this._attrs[k] = v; },
  });
  const win: Record<string, unknown> = {
    document: {
      createElement: (tag: string): FakeEl => makeEl(tag),
      querySelector: (sel: string): unknown => {
        const m = /data-mingla-pixel="([^"]+)"/.exec(sel);
        if (m && injected.some((s) => s._attrs["data-mingla-pixel"] === m[1])) return {};
        return null;
      },
      head: { appendChild: (el: FakeEl): void => { injected.push(el); } },
    },
    localStorage: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => { store.set(k, v); },
    },
    sessionStorage: {
      getItem: (k: string): string | null => store.get(k) ?? null,
      setItem: (k: string, v: string): void => { store.set(k, v); },
    },
    location: { search: locationSearch, href: "https://usemingla.com/e/brand/event" + locationSearch },
  };

  jest.resetModules();
  jest.doMock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra } } }));
  jest.doMock("posthog-js", () => ({
    __esModule: true,
    default: {
      init: jest.fn(), opt_in_capturing: jest.fn(), opt_out_capturing: jest.fn(),
      capture: jest.fn(), identify: jest.fn(), getFeatureFlag: jest.fn(),
    },
  }));

  (globalThis as unknown as { window: unknown }).window = win;

  // Capture every global fetch (postAttributionTouch / postAttributionConversion).
  const fetchCalls: { url: string; body: string }[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = (url: string, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), body: String((init ?? {}).body ?? "") });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ click_id: "srv-click-1" }) });
  };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const wa = require("../webAnalytics.web") as typeof import("../webAnalytics.web");
  return { wa, win, fetchCalls };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
  jest.resetModules();
});

const ALL_PIXELS = {
  EXPO_PUBLIC_META_PIXEL_ID: "1949011972638955",
  EXPO_PUBLIC_TIKTOK_PIXEL_CODE: "D9B98EBC77U1EOHV2O0G",
  EXPO_PUBLIC_SNAP_PIXEL_ID: "af5f8fc4-1ef6-41e7-81c5-042b7be7df38",
  EXPO_PUBLIC_REDDIT_PIXEL_ID: "a2_jcfwvnfcfqcs",
  EXPO_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
  EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

const ORDER_ID = "order-dedup-865";

// ═══ B1 — all four pixels fire the shared event_id in the right dedup field ═══
test("B1 fireAdPurchase fires ALL FOUR pixels with the shared event_id + correct names (browser half of SC-15)", async () => {
  const { wa, win } = loadHarness(ALL_PIXELS);
  await wa.initWebAnalytics();
  await wa.grantConsent(); // bootstraps all four
  expect(wa.adPixelsReady()).toBe(true);

  wa.fireAdPurchase(ORDER_ID, { value: 35, currency: "GBP" });

  // Meta — fbq('track','Purchase', props, { eventID }).
  const fbq = win.fbq as unknown as { queue: unknown[][] };
  const metaCall = fbq.queue.find((a) => a[0] === "track" && a[1] === "Purchase");
  expect(metaCall).toBeDefined();
  expect(metaCall?.[3]).toEqual({ eventID: ORDER_ID });

  // TikTok — ttq.track('CompletePayment', props, { event_id }); track defers onto _q.
  const ttq = win.ttq as unknown as { _q: unknown[][] };
  const ttCall = (ttq._q ?? []).find((a) => a[0] === "track" && a[1] === "CompletePayment");
  expect(ttCall).toBeDefined();
  expect(ttCall?.[3]).toEqual({ event_id: ORDER_ID });

  // Snap — snaptr('track','PURCHASE', { ... client_dedup_id }); queues args.
  const snaptr = win.snaptr as unknown as { queue: unknown[][] };
  const snCall = snaptr.queue.find((a) => a[0] === "track" && a[1] === "PURCHASE");
  expect(snCall).toBeDefined();
  expect((snCall?.[2] as Record<string, unknown>).client_dedup_id).toBe(ORDER_ID);
  expect((snCall?.[2] as Record<string, unknown>).transaction_id).toBe(ORDER_ID);

  // Reddit — rdt('track','Purchase', { ... conversion_id }); queues on callQueue.
  const rdt = win.rdt as unknown as { callQueue: unknown[][] };
  const rdCall = rdt.callQueue.find((a) => a[0] === "track" && a[1] === "Purchase");
  expect(rdCall).toBeDefined();
  expect((rdCall?.[2] as Record<string, unknown>).conversion_id).toBe(ORDER_ID);
});

// ═══ B2 — checkout conversion POST carries NO email/phone (no PII egress) ═════
test("B2 postAttributionConversion sends event_id/value/currency/click_id ONLY — never email/phone (SC-8/SC-9)", async () => {
  const { wa, fetchCalls } = loadHarness(ALL_PIXELS);
  await wa.initWebAnalytics();
  await wa.grantConsent();

  wa.postAttributionConversion({ eventId: ORDER_ID, valueCents: 3500, currency: "GBP" });

  const convCall = fetchCalls.find((c) => c.url.includes("/attribution-capture") && c.body.includes("conversion"));
  expect(convCall).toBeDefined();
  const parsed = JSON.parse(convCall!.body);
  expect(parsed.kind).toBe("conversion");
  expect(parsed.event_id).toBe(ORDER_ID);
  expect(parsed.value_cents).toBe(3500);
  // The hard invariant: no PII field anywhere in the outgoing conversion body.
  const bodyLower = convCall!.body.toLowerCase();
  expect(bodyLower).not.toContain("email");
  expect(bodyLower).not.toContain("phone");
  expect(bodyLower).not.toContain("buyer_email");
  expect(parsed.hashed_email).toBeUndefined();
  expect(parsed.buyer_email).toBeUndefined();
});

// ═══ B3 — click capture forwards click-id + UTM only; no-op with no ad signal ═
test("B3 captureAdClickIds forwards click-id/UTM only (no PII) and no-ops with no ad signal", async () => {
  // (a) With an fbclid + utm, pre-consent capture stays entirely dark.
  const withSignal = loadHarness(ALL_PIXELS, "?fbclid=ABC123&utm_source=meta&utm_campaign=summer");
  await withSignal.wa.initWebAnalytics();
  withSignal.wa.captureAdClickIds({ pageType: "event", brandSlug: "b", entitySlug: "e" });
  expect(withSignal.fetchCalls.some((c) => c.url.includes("/attribution-capture"))).toBe(false);
  const preConsentStore = (withSignal.win.sessionStorage as { getItem(k: string): string | null });
  expect(preConsentStore.getItem("mingla_ad_click_v1")).toBeNull();

  // (b) The same harness sends exactly one touch only after explicit grant.
  await withSignal.wa.grantConsent();
  withSignal.wa.captureAdClickIds({ pageType: "event", brandSlug: "b", entitySlug: "e" });
  const touches = withSignal.fetchCalls.filter((c) => c.url.includes("/attribution-capture") && c.body.includes("touch"));
  expect(touches).toHaveLength(1);
  const touch = touches[0];
  expect(touch).toBeDefined();
  const tp = JSON.parse(touch.body);
  expect(tp.kind).toBe("touch");
  expect(tp.external_click_id).toBe("ABC123");
  expect(tp.network).toBe("meta");
  expect(tp.utm.utm_source).toBe("meta");
  const tbLower = touch.body.toLowerCase();
  expect(tbLower).not.toContain("email");
  expect(tbLower).not.toContain("phone");

  // (c) With NO ad signal on the URL → NOTHING is posted (byte-identical no-op).
  const noSignal = loadHarness(ALL_PIXELS, "");
  await noSignal.wa.initWebAnalytics();
  await noSignal.wa.grantConsent();
  noSignal.fetchCalls.length = 0; // ignore any init-time calls
  noSignal.wa.captureAdClickIds({ pageType: "event", brandSlug: "b", entitySlug: "e" });
  expect(noSignal.fetchCalls.some((c) => c.url.includes("/attribution-capture"))).toBe(false);
});

// ═══ B4 — ViewContent / PageView are NO-OPS pre-consent (SC-8) ════════════════
test("B4 fireAdViewContent / fireAdPageView do NOTHING before consent (SC-8)", async () => {
  const { wa, win } = loadHarness(ALL_PIXELS);
  await wa.initWebAnalytics();
  // pre-consent: no pixels bootstrapped.
  expect(wa.adPixelsReady()).toBe(false);
  expect(() => wa.fireAdViewContent({ value: 10, currency: "GBP", contentId: "x" })).not.toThrow();
  expect(() => wa.fireAdPageView()).not.toThrow();
  // No pixel globals exist, so nothing could have fired.
  expect(win.fbq).toBeUndefined();
  expect(win.ttq).toBeUndefined();
  expect(win.snaptr).toBeUndefined();
  expect(win.rdt).toBeUndefined();
});
