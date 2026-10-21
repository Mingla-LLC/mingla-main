/**
 * toward #3697 Wave 0a/0b — pre-consent first-party click + Reject stamp.
 * Append-only.
 */
interface FakeScript {
  src: string;
  async: boolean;
  attrs: Record<string, string>;
  setAttribute(name: string, value: string): void;
}

function harness(search = ""): {
  analytics: typeof import("../webAnalytics.web");
  fetches: Array<{ url: string; body: Record<string, unknown> }>;
  session: Map<string, string>;
  local: Map<string, string>;
  win: Record<string, unknown>;
  scripts: FakeScript[];
  posthog: { init: jest.Mock };
} {
  const scripts: FakeScript[] = [];
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  const fetches: Array<{ url: string; body: Record<string, unknown> }> = [];
  const posthog = {
    init: jest.fn(),
    opt_in_capturing: jest.fn(),
    opt_out_capturing: jest.fn(),
    capture: jest.fn(),
    identify: jest.fn(),
    getFeatureFlag: jest.fn(),
  };
  const win: Record<string, unknown> = {
    document: {
      referrer: "",
      cookie: "",
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
    navigator: {},
    location: { search, href: `https://business.usemingla.com/e/b/e${search}` },
    localStorage: {
      getItem: (key: string): string | null => local.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        local.set(key, value);
      },
      removeItem: (key: string): void => {
        local.delete(key);
      },
    },
    sessionStorage: {
      getItem: (key: string): string | null => session.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        session.set(key, value);
      },
    },
  };
  jest.resetModules();
  jest.doMock("expo-constants", () => ({
    __esModule: true,
    default: {
      expoConfig: {
        extra: {
          EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
          EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon",
        },
      },
    },
  }));
  jest.doMock("posthog-js", () => ({ __esModule: true, default: posthog }));
  (globalThis as unknown as { window: unknown }).window = win;
  (globalThis as unknown as { fetch: unknown }).fetch = (
    url: string,
    init?: { body?: string },
  ) => {
    fetches.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body) as Record<string, unknown> : {},
    });
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, click_id: `click-${fetches.length}` }),
    });
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const analytics = require("../webAnalytics.web") as typeof import("../webAnalytics.web");
  return { analytics, fetches, session, local, win, scripts, posthog };
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { fetch?: unknown }).fetch;
  jest.resetModules();
});

test("F-1: pre-consent ad signal posts touch with consent_state=pending", async () => {
  const h = harness("?fbclid=ABC&mc_id=camp1");
  h.analytics.captureAdClickIds({ pageType: "event", brandSlug: "b" });
  await new Promise((r) => setTimeout(r, 0));
  expect(h.posthog.init).not.toHaveBeenCalled();
  expect(h.scripts).toHaveLength(0);
  expect(h.fetches).toHaveLength(1);
  expect(h.fetches[0].body.kind).toBe("touch");
  expect(h.fetches[0].body.consent_state).toBe("pending");
  expect(h.local.get("mingla_ad_click_v1")).toContain("click-1");
});

test("F-3: Reject stamps consent rejected and does not boot vendors", async () => {
  const h = harness("?fbclid=ABC");
  h.analytics.captureAdClickIds();
  await new Promise((r) => setTimeout(r, 0));
  h.analytics.denyConsent();
  await new Promise((r) => setTimeout(r, 0));
  expect(h.local.get("mingla_consent_v1")).toContain('"denied"');
  expect(h.posthog.init).not.toHaveBeenCalled();
  const consentPosts = h.fetches.filter((f) => f.body.kind === "consent");
  expect(consentPosts.length).toBeGreaterThanOrEqual(1);
  expect(consentPosts[0].body.consent_state).toBe("rejected");
});

test("Wave 0d: postAttributionConversion is a no-op", () => {
  const h = harness("?fbclid=ABC");
  h.local.set("mingla_consent_v1", JSON.stringify({ choice: "granted", ts: 1 }));
  const before = h.fetches.length;
  h.analytics.postAttributionConversion({ eventId: "ord-1", valueCents: 100 });
  expect(h.fetches.length).toBe(before);
});

test("#3697: click attribution survives sessions for seven days and expires", () => {
  const h = harness();
  h.local.set("mingla_ad_click_v1", JSON.stringify({
    clickId: "fresh-click",
    expiresAt: Date.now() + h.analytics.AD_CLICK_TTL_MS,
  }));
  expect(h.analytics.getStoredClickAttribution()).toEqual({ clickId: "fresh-click" });
  h.local.set("mingla_ad_click_v1", JSON.stringify({
    clickId: "expired-click",
    expiresAt: Date.now() - 1,
  }));
  expect(h.analytics.getStoredClickAttribution()).toEqual({ clickId: null });
  expect(h.local.has("mingla_ad_click_v1")).toBe(false);
});

test("#3697: first-touch stays social while a later Meta landing is still counted", async () => {
  const h = harness();
  const win = h.win as {
    document: { referrer: string };
    location: { search: string };
  };
  h.local.set("mingla_consent_v1", JSON.stringify({ choice: "granted", ts: 1 }));
  win.document.referrer = "https://l.instagram.com/?u=ctrl";

  h.analytics.captureAdClickIds({ pageType: "event", brandSlug: "ctrl" });
  await new Promise((r) => setTimeout(r, 0));

  win.location.search = "?fbclid=LATER&mc_id=meta-campaign&placement=facebook_feed";
  win.document.referrer = "https://usemingla.com/";
  h.analytics.captureAdClickIds({ pageType: "event", brandSlug: "ctrl" });
  await new Promise((r) => setTimeout(r, 0));

  const touches = h.fetches.filter((entry) => entry.body.kind === "touch");
  expect(touches).toHaveLength(2);
  expect(touches[0].body.network).toBe("other");
  expect(touches[0].body.referrer).toBe("l.instagram.com");
  expect(touches[0].body.mc_id).toBeNull();
  expect(touches[1].body.network).toBe("meta");
  expect(touches[1].body.mc_id).toBe("meta-campaign");
  expect(touches[1].body.utm).toMatchObject({ placement: "facebook_feed" });
  expect(h.local.get("mingla_ad_click_v1")).toContain("click-1");
  expect(h.local.get("mingla_ad_click_v1")).not.toContain("click-2");
});

test("#3697: attribution soft errors never poison first-touch storage", async () => {
  const h = harness("?fbclid=ABC&mc_id=camp1");
  (globalThis as unknown as { fetch: unknown }).fetch = (
    url: string,
    init?: { body?: string },
  ) => {
    h.fetches.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body) as Record<string, unknown> : {},
    });
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: false,
        soft_error: "touch_not_recorded",
        click_id: "not-persisted",
      }),
    });
  };

  h.analytics.captureAdClickIds();
  await new Promise((r) => setTimeout(r, 0));

  expect(h.fetches).toHaveLength(1);
  expect(h.local.has("mingla_ad_click_v1")).toBe(false);
});

test("#3697: malformed ad cookies fail open instead of blocking checkout", () => {
  const h = harness();
  const win = h.win as { document: { cookie: string } };
  h.local.set("mingla_consent_v1", JSON.stringify({ choice: "granted", ts: 1 }));
  win.document.cookie = "_fbp=%E0%A4%A";
  expect(h.analytics.getStoredAdMatchData()).toEqual({
    fbp: null,
    fbc: null,
    scid: null,
    clientUserAgent: null,
  });
});

test("#3697: a soft-failed landing can retry in the same document", async () => {
  const h = harness("?fbclid=RETRY&mc_id=camp1");
  let attempt = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = (
    url: string,
    init?: { body?: string },
  ) => {
    attempt += 1;
    h.fetches.push({
      url: String(url),
      body: init?.body ? JSON.parse(init.body) as Record<string, unknown> : {},
    });
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(attempt === 1
        ? { ok: false, soft_error: "touch_not_recorded", click_id: "discard-me" }
        : { ok: true, click_id: "retry-landed" }),
    });
  };

  h.analytics.captureAdClickIds();
  await new Promise((r) => setTimeout(r, 0));
  h.analytics.captureAdClickIds();
  await new Promise((r) => setTimeout(r, 0));

  expect(h.fetches).toHaveLength(2);
  expect(h.local.get("mingla_ad_click_v1")).toContain("retry-landed");
  expect(h.local.get("mingla_ad_click_v1")).not.toContain("discard-me");
});
