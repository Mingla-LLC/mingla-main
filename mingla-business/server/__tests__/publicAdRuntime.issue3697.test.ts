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

function runArrivalRuntime(storedConsent?: string) {
  const storage = new Map<string, string>();
  if (storedConsent !== undefined) {
    storage.set("mingla_consent_v1", storedConsent);
  }
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
  const elements = {
    banner: { hidden: true },
    ok: { onclick: null as null | (() => void) },
    out: { onclick: null as null | (() => void) },
  };
  const document = {
    readyState: "complete",
    referrer: "",
    cookie: "",
    head: { appendChild: jest.fn() },
    createElement: makeScript,
    getElementsByTagName: () => [{ parentNode: { insertBefore: makeScript } }],
    getElementById: (id: string) =>
      id === "mingla-ad-privacy-banner"
        ? elements.banner
        : id === "mingla-ad-privacy-ok"
        ? elements.ok
        : id === "mingla-ad-privacy-opt-out"
        ? elements.out
        : null,
    querySelector: () => null,
    querySelectorAll: (selector: string) =>
      selector === "script[data-mingla-pixel]" ? insertedScripts : [],
    addEventListener: jest.fn(),
  };
  const context: Record<string, unknown> = {
    document,
    addEventListener: jest.fn(),
    location: { href: "https://business.usemingla.com/e/acme/signal-night" },
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    fetch: () => Promise.resolve({ ok: true }),
    crypto: { randomUUID: () => "33333333-3333-4333-8333-333333333333" },
    console,
  };
  context.window = context;
  runInNewContext(
    publicAdRuntimeScript({ facts, consentMode: "on_arrival" }),
    context,
  );
  return { elements, insertedScripts, storage, window: context };
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

describe("#3697 public arrival runtime", () => {
  test("runs cookieless keepalive capture and pixels before the app handoff", () => {
    const html = publicSearch.renderVisibleDocument({
      facts,
      state: "search_ready",
      canonicalPath: "/e/acme/signal-night",
      adPixelConsentMode: "on_arrival",
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

  test("renders Seth's exact disclosure, actions, policy and footer choice", () => {
    const html = publicSearch.renderVisibleDocument({
      facts,
      state: "search_ready",
      canonicalPath: "/e/acme/signal-night",
    });
    expect(html).toContain(
      "We use cookies and advertising tools from Meta, Snapchat and TikTok to measure and improve our ads.",
    );
    expect(html).toContain(">OK</button>");
    expect(html).toContain(">Opt out of ad tracking</button>");
    expect(html).toContain(">Privacy policy</a>");
    expect(html).toContain(">Ad privacy choices</button>");
  });

  test("honours the hydrated app's remembered JSON opt-out before loading pixels", () => {
    const runtime = runArrivalRuntime(
      JSON.stringify({ choice: "denied", ts: 1_800_000_000_000 }),
    );
    expect(runtime.insertedScripts).toHaveLength(0);
    expect(runtime.window.__minglaAdPixelsBootstrapped).not.toBe(true);
    expect(runtime.window.__minglaPrebootConsentChoice).toBe("denied");
    expect(runtime.elements.banner.hidden).toBe(true);
  });

  test("writes an early opt-out in the hydrated app's canonical JSON format", () => {
    const runtime = runArrivalRuntime();
    expect(runtime.window.__minglaAdPixelsBootstrapped).toBe(true);
    expect(runtime.window.__minglaAdPageViewKeys).toEqual({
      "https://business.usemingla.com/e/acme/signal-night": true,
    });
    runtime.elements.out.onclick?.();
    expect(JSON.parse(runtime.storage.get("mingla_consent_v1") ?? "{}"))
      .toMatchObject({ choice: "denied" });
    expect(runtime.window.__minglaPrebootConsentChoice).toBe("denied");
    expect(runtime.window.__minglaAdPixelsBootstrapped).toBe(false);
    expect(runtime.insertedScripts.every((script) => script.removed)).toBe(true);
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

  test("reads a country override without making the page depend on it", async () => {
    rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "resolve_public_search_document"
          ? resolution
          : { ad_pixel_consent_mode: "opt_in" },
      )
    );
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
    expect(rpc).toHaveBeenCalledWith("ad_pixel_public_config", {
      p_country_code: "FR",
    });
    expect(res.body).toContain('"consentMode":"opt_in"');

    rpc.mockImplementation((name: string) =>
      name === "resolve_public_search_document"
        ? Promise.resolve(resolution)
        : Promise.reject(new Error("config unavailable"))
    );
    const fallback = response();
    await publicSearch.handlePublicSearchDocument({
      req: {
        method: "GET",
        headers: { "x-vercel-ip-country": "FR" },
        url: "/e/acme/signal-night",
      },
      res: fallback,
      kind: "event",
      slugs: ["acme", "signal-night"],
    });
    expect(fallback.statusCode).toBe(200);
    expect(fallback.body).toContain('"consentMode":"on_arrival"');
  });
});
