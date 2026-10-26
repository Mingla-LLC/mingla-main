import {
  afterAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { runInNewContext } from "node:vm";

const rpc = jest.fn<any>();
jest.mock("../supabaseRpc", () => ({
  requestRpcJson: (...args: unknown[]) => rpc(...args),
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "public-anon-key",
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const publicSearch = require("../publicSearchDocument") as {
  attributionQueryFromRequest: (req: unknown) => string;
  handlePublicSearchDocument: (input: unknown) => Promise<void>;
  renderVisibleDocument: (input: Record<string, unknown>) => string;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { publicAdRuntimeScript } = require("../publicAdRuntime") as {
  publicAdRuntimeScript: (input: Record<string, unknown>) => string;
};

const facts = {
  kind: "event",
  id: "11111111-1111-4111-8111-111111111111",
  brandId: "22222222-2222-4222-8222-222222222222",
  brandSlug: "acme",
  brandName: "Acme",
  title: "Signal night",
  description: "A public event.",
  status: "scheduled",
  eventType: "event",
  actionAvailable: true,
};

const resolution = {
  valid: true,
  kind: "event",
  state: "search_ready",
  canonicalPath: "/e/acme/signal-night",
  integrityOk: true,
  facts,
};

const response = () => ({
  statusCode: 0,
  headers: {} as Record<string, string>,
  body: "",
  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = String(value);
  },
  end(body = "") {
    this.body = String(body);
  },
});

// [TEST-MOD-APPROVED #2331] The server-rendered copy is now the same slim
// privacy bar as the app (one reader, I-PRIVACY-ON-UNLESS-VISITOR-TURNED-OFF):
// pixels run unless the visitor turned ads off, GPC starts them off, and there
// is no per-country read.
type Listener = (event: { type: string; detail?: unknown }) => void;

interface FakeNode {
  hidden: boolean;
  checked: boolean;
  textContent: string;
  className: string;
  attrs: Record<string, string>;
  listeners: Record<string, Listener[]>;
  isConnected: boolean;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  addEventListener: (type: string, listener: Listener) => void;
  click: () => void;
  focus: () => void;
  remove: () => void;
  getBoundingClientRect: () => { height: number };
  querySelector: (selector: string) => FakeNode | null;
}

function node(children: Record<string, FakeNode> = {}): FakeNode {
  const self: FakeNode = {
    hidden: false,
    checked: false,
    textContent: "",
    className: "",
    attrs: {},
    listeners: {},
    isConnected: true,
    setAttribute(name, value) { self.attrs[name] = value; },
    getAttribute(name) { return self.attrs[name] ?? null; },
    addEventListener(type, listener) { (self.listeners[type] ??= []).push(listener); },
    click() { for (const listener of self.listeners.click ?? []) listener({ type: "click" }); },
    focus() {},
    remove() { self.isConnected = false; },
    getBoundingClientRect() { return { height: self.hidden ? 0 : 53 }; },
    querySelector(selector) { return children[selector] ?? null; },
  };
  return self;
}

function runArrivalRuntime(seed: Record<string, string> = {}, gpc = false) {
  const storage = new Map<string, string>(Object.entries(seed));
  const insertedScripts: { removed: boolean; remove: () => void }[] = [];
  const makeScript = () => {
    const script = {
      removed: false,
      async: false,
      src: "",
      setAttribute: jest.fn(),
      remove() {
        script.removed = true;
      },
    };
    insertedScripts.push(script);
    return script;
  };
  const parts = {
    panel: node(),
    toggle: node(),
    ok: node(),
    label: node(),
    chev: node(),
    collapsed: node(),
    expanded: node(),
    analytics: node(),
    ads: node(),
    save: node(),
    off: node(),
  };
  const bar = node({
    ".mpb-panel": parts.panel,
    '[data-mpb-act="toggle"]': parts.toggle,
    '[data-mpb-act="ok"]': parts.ok,
    "[data-mpb-label]": parts.label,
    "[data-mpb-chev]": parts.chev,
    "[data-mpb-collapsed]": parts.collapsed,
    "[data-mpb-expanded]": parts.expanded,
    '[data-mpb-switch="analytics"]': parts.analytics,
    '[data-mpb-switch="ads"]': parts.ads,
    '[data-mpb-act="save"]': parts.save,
    '[data-mpb-act="off"]': parts.off,
  });
  bar.hidden = true;
  const inset: string[] = [];
  const windowListeners: Record<string, Listener[]> = {};
  const document = {
    readyState: "complete",
    referrer: "",
    cookie: "",
    head: { appendChild: jest.fn() },
    body: { appendChild: jest.fn() },
    documentElement: {
      style: { setProperty: (_name: string, value: string) => inset.push(value) },
    },
    createElement: (tag: string) => (tag === "script" ? makeScript() : node()),
    getElementsByTagName: () => [{ parentNode: { insertBefore: makeScript } }],
    querySelector: (selector: string) =>
      selector === "[data-mingla-ssr-privacy-bar]" ? bar : null,
    querySelectorAll: (selector: string) =>
      selector === "script[data-mingla-pixel]" ? insertedScripts : [],
    addEventListener: jest.fn(),
  };
  class FakeEvent {
    type: string;
    detail?: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  }
  const context: Record<string, unknown> = {
    document,
    navigator: gpc ? { globalPrivacyControl: true } : {},
    addEventListener: (type: string, listener: Listener) => {
      (windowListeners[type] ??= []).push(listener);
    },
    dispatchEvent: (event: { type: string; detail?: unknown }) => {
      for (const listener of windowListeners[event.type] ?? []) listener(event);
      return true;
    },
    Event: FakeEvent,
    CustomEvent: FakeEvent,
    setTimeout: () => 0,
    location: { href: "https://business.usemingla.com/e/acme/signal-night" },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    fetch: () => Promise.resolve({ ok: true }),
    crypto: { randomUUID: () => "33333333-3333-4333-8333-333333333333" },
    console,
  };
  context.window = context;
  runInNewContext(publicAdRuntimeScript({ facts }), context);
  return { bar, parts, inset, insertedScripts, storage, window: context };
}


beforeEach(() => {
  rpc.mockReset();
  process.env.EXPO_PUBLIC_META_PIXEL_ID = "meta-3697";
  process.env.EXPO_PUBLIC_TIKTOK_PIXEL_CODE = "tiktok-3697";
  process.env.EXPO_PUBLIC_SNAP_PIXEL_ID = "snap-3697";
});

afterAll(() => {
  delete process.env.EXPO_PUBLIC_META_PIXEL_ID;
  delete process.env.EXPO_PUBLIC_TIKTOK_PIXEL_CODE;
  delete process.env.EXPO_PUBLIC_SNAP_PIXEL_ID;
});

describe("#3697 / #2331 public arrival runtime", () => {
  test("runs cookieless keepalive capture and pixels before the app handoff", () => {
    const html = publicSearch.renderVisibleDocument({
      facts,
      state: "search_ready",
      canonicalPath: "/e/acme/signal-night",
    });
    const capture = html.indexOf("offering-engagement-capture");
    const handoff = html.indexOf("browserRuntimeScript");
    expect(capture).toBeGreaterThan(-1);
    expect(html).toContain("keepalive:true");
    expect(html).toContain("__minglaEarlyEngagementCapture");
    expect(html).toContain("__minglaAdPixelsBootstrapped");
    expect(html).toContain("__minglaAdPageViewKeys");
    expect(html).toContain("content_ids:[c.contentId]");
    expect(html).toContain("content_id:c.contentId");
    expect(html).toContain("item_ids:[c.contentId]");
    expect(capture).toBeLessThan(html.indexOf('<div id="root">'));
    expect(handoff).toBe(-1); // source function names are never leaked into HTML
  });

  test("renders the slim privacy bar, its choices, the policy and the footer link", () => {
    const html = publicSearch.renderVisibleDocument({
      facts,
      state: "search_ready",
      canonicalPath: "/e/acme/signal-night",
    });
    expect(html).toContain("Mingla uses cookies for analytics and ads.");
    expect(html).toContain("Cookies for analytics and ads.");
    expect(html).toContain('<span class="mpb-pill mpb-primary">OK</span>');
    expect(html).toContain('aria-label="Privacy options"');
    expect(html).toContain("Lets Meta, TikTok, Snapchat and Reddit measure our ads.");
    expect(html).toContain(">Privacy policy</a>");
    expect(html).toContain(">Your privacy choices</button>");
    expect(html).not.toContain("Ad privacy choices");
    expect(html).not.toContain("Opt out of ad tracking");
    expect(html).toContain(
      "#root{box-sizing:border-box;height:calc(100% - var(--mingla-privacy-inset,0px))}",
    );
  });

  test("a carried-over v1 opt-out loads no pixel and shows no bar", () => {
    const runtime = runArrivalRuntime({
      mingla_consent_v1: JSON.stringify({ choice: "denied", ts: 1_800_000_000_000 }),
    });
    expect(runtime.insertedScripts).toHaveLength(0);
    expect(runtime.window.__minglaAdPixelsBootstrapped).not.toBe(true);
    expect(runtime.bar.hidden).toBe(true);
  });

  test("Global Privacy Control loads no pixel; the bar shows with Ads off", () => {
    const runtime = runArrivalRuntime({}, true);
    expect(runtime.insertedScripts).toHaveLength(0);
    expect(runtime.bar.hidden).toBe(false);
    runtime.parts.toggle.click();
    expect(runtime.parts.panel.hidden).toBe(false);
    expect(runtime.parts.analytics.checked).toBe(true);
    expect(runtime.parts.ads.checked).toBe(false);
  });

  test("first visit loads pixels and shows the bar; Turn off all saves v2 and stops them", () => {
    const runtime = runArrivalRuntime();
    expect(runtime.window.__minglaAdPixelsBootstrapped).toBe(true);
    expect(runtime.window.__minglaAdPageViewKeys).toEqual({
      "https://business.usemingla.com/e/acme/signal-night": true,
    });
    expect(runtime.bar.hidden).toBe(false);
    expect(runtime.inset.at(-1)).toBe("53px");
    runtime.parts.toggle.click();
    expect(runtime.parts.analytics.checked).toBe(true);
    expect(runtime.parts.ads.checked).toBe(true);
    expect(runtime.parts.toggle.attrs["aria-expanded"]).toBe("true");
    runtime.parts.off.click();
    expect(JSON.parse(runtime.storage.get("mingla_privacy_v2") ?? "{}"))
      .toMatchObject({ analytics: false, ads: false });
    expect(runtime.window.__minglaPrebootPrivacy).toMatchObject({ analytics: false, ads: false });
    expect(runtime.window.__minglaAdPixelsBootstrapped).toBe(false);
    expect(runtime.insertedScripts.every((script) => script.removed)).toBe(true);
    expect(runtime.bar.hidden).toBe(true);
    expect(runtime.inset.at(-1)).toBe("0px");
  });

  test("preserves every provider link identity and drops unrelated secrets", () => {
    const kept = publicSearch.attributionQueryFromRequest({
      url:
        "/e/a/b?utm_source=snapchat&mc_id=camp&campaign_id=campaign&adset_id=set&ad_squad_id=squad&ad_id=ad&fbclid=fb&ttclid=tt&ScCid=snap&rdt_cid=reddit&token=secret",
    });
    for (
      const expected of [
        "utm_source=snapchat",
        "mc_id=camp",
        "campaign_id=campaign",
        "adset_id=set",
        "ad_squad_id=squad",
        "ad_id=ad",
        "fbclid=fb",
        "ttclid=tt",
        "ScCid=snap",
        "rdt_cid=reddit",
      ]
    ) expect(kept).toContain(expected);
    expect(kept).not.toContain("token");
  });


  test("never reads a per-country privacy mode", async () => {
    rpc.mockImplementation(() => Promise.resolve(resolution));
    const res = response();
    await publicSearch.handlePublicSearchDocument({
      req: {
        method: "GET",
        headers: { "x-vercel-ip-country": "fr" },
        url: "/e/acme/signal-night",
      },
      res,
      kind: "event",
      slugs: ["acme", "signal-night"],
    });
    expect(res.statusCode).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("resolve_public_search_document", {
      p_path: "/e/acme/signal-night",
    });
    expect(res.body).not.toContain("consentMode");
  });
});
