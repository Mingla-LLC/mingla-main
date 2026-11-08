// #4318 section 7 (Seth): the bottom privacy bar is the ONE place people make
// and change their analytics and ads choice. No Host web page (app routes or
// server-rendered documents) carries a separate "Privacy choices" link.
//
// Because that link was the only way back into the choices, the bar now folds
// to one icon-only "Privacy settings" button after a choice. This suite proves:
//   (a) no product source renders the retired link, and no server-rendered
//       page shows "privacy choices" text outside the bar itself;
//   (b) after accepting AND after declining, the folded bar reopens the
//       choices and a change takes effect: ad pixels stop and start again.
import { describe, expect, jest, test } from "@jest/globals";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { runInNewContext } from "node:vm";

jest.mock("../supabaseRpc", () => ({
  requestRpcJson: jest.fn(),
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "public-anon-key",
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const publicSearch = require("../publicSearchDocument") as {
  renderVisibleDocument: (input: Record<string, unknown>) => string;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { publicAdRuntimeScript } = require("../publicAdRuntime") as {
  publicAdRuntimeScript: (input: Record<string, unknown>) => string;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderContentShareHtml } = require("../socialPreview") as {
  renderContentShareHtml: (input: Record<string, unknown>) => string;
};

const BUSINESS = join(__dirname, "..", "..");
const REPO = join(BUSINESS, "..");

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

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * What the page shows outside the bar: the bar itself (its region and its
 * folded button) and every script/style (the bar's own runtime strings) cut out.
 */
function outsideTheBar(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<section class="mpb[\s\S]*?<\/section>/g, "")
    .replace(/<div class="mpb mpb-mini[\s\S]*?<\/button><\/div><\/div>/g, "");
}

describe("#4318 (a) no separate privacy link on Host web", () => {
  test("no product source renders or registers the retired link", () => {
    const roots = ["app", "src", "server"].map((dir) => join(BUSINESS, dir));
    roots.push(join(REPO, "packages", "offering-rendering"));
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const source = readFileSync(file, "utf8");
        if (/PrivacyChoicesLink|privacy-choices-link|data-mingla-privacy-choices|setPageFooterAccessory/.test(source)) {
          offenders.push(relative(REPO, file));
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(existsSync(join(BUSINESS, "src/analytics/PrivacyChoicesLink.web.tsx"))).toBe(false);
    expect(existsSync(join(BUSINESS, "src/analytics/PrivacyChoicesLink.tsx"))).toBe(false);
  });

  test("server-rendered public and share pages show no privacy-choices text outside the bar", () => {
    const pages = {
      publicSearch: publicSearch.renderVisibleDocument({
        facts,
        state: "search_ready",
        canonicalPath: "/e/acme/signal-night",
      }),
      contentShare: renderContentShareHtml({
        shortCode: "Aa0Bb1Cc2Dd3Ee4F",
        version: 2,
        facts: { schemaVersion: 1, kind: "event", title: "Truth" },
        media: null,
        destination: { kind: "event", brandSlug: "b", eventSlug: "e" },
        publicDetails: { kind: "event", actionEligible: true, occurrences: [] },
      }),
    };
    for (const [name, html] of Object.entries(pages)) {
      // The bar is still there, with its folded reopen button.
      expect([name, html.includes('data-testid="privacy-bar"')]).toEqual([name, true]);
      expect([name, html.includes('aria-label="Privacy settings"')]).toEqual([name, true]);
      const rest = outsideTheBar(html);
      expect([name, /privacy choices/i.test(rest)]).toEqual([name, false]);
      expect([name, rest.includes("data-mingla-privacy-choices")]).toEqual([name, false]);
    }
  });

  test("the React bar folds to an icon-only Privacy settings button that reopens it", () => {
    const banner = readFileSync(join(BUSINESS, "src/analytics/ConsentBanner.web.tsx"), "utf8");
    expect(banner).toContain('aria-label="Privacy settings"');
    expect(banner).toContain('data-testid="privacy-bar-reopen"');
    expect(banner).toContain("onClick={openPrivacyChoices}");
    // The folded bar is measured into the same inset (never occludes).
    expect(banner).toMatch(/if \(!mounted \|\| bar === null\)/);
  });
});

// ---- (b) runtime: the server-rendered bar, real runtime source, fake DOM ----

type Listener = (event: { type: string; detail?: unknown }) => void;
interface FakeNode {
  hidden: boolean;
  checked: boolean;
  textContent: string;
  className: string;
  attrs: Record<string, string>;
  listeners: Record<string, Listener[]>;
  isConnected: boolean;
  height: number;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  addEventListener: (type: string, listener: Listener) => void;
  click: () => void;
  focus: () => void;
  remove: () => void;
  getBoundingClientRect: () => { height: number };
  querySelector: (selector: string) => FakeNode | null;
}

function node(height: number, children: Record<string, FakeNode> = {}): FakeNode {
  const self: FakeNode = {
    hidden: false,
    checked: false,
    textContent: "",
    className: "",
    attrs: {},
    listeners: {},
    isConnected: true,
    height,
    setAttribute(name, value) { self.attrs[name] = value; },
    getAttribute(name) { return self.attrs[name] ?? null; },
    addEventListener(type, listener) { (self.listeners[type] ??= []).push(listener); },
    click() { for (const listener of self.listeners.click ?? []) listener({ type: "click" }); },
    focus() {},
    remove() { self.isConnected = false; },
    getBoundingClientRect() { return { height: self.hidden ? 0 : self.height }; },
    querySelector(selector) { return children[selector] ?? null; },
  };
  return self;
}

function runPage() {
  process.env.EXPO_PUBLIC_META_PIXEL_ID = "meta-4318";
  const storage = new Map<string, string>();
  const scripts: { removed: boolean; remove: () => void; setAttribute: () => void; async: boolean; src: string }[] = [];
  const makeScript = () => {
    const script = { removed: false, async: false, src: "", setAttribute: () => undefined, remove() { script.removed = true; } };
    scripts.push(script);
    return script;
  };
  const parts = {
    panel: node(0), toggle: node(44), ok: node(44), label: node(0), chev: node(0),
    collapsed: node(0), expanded: node(0), analytics: node(0), ads: node(0), save: node(44), off: node(44),
  };
  const bar = node(53, {
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
  const reopen = node(44);
  const folded = node(45, { button: reopen });
  bar.hidden = true;
  folded.hidden = true;
  const inset: string[] = [];
  const saved: Array<{ analytics: boolean; ads: boolean }> = [];
  const windowListeners: Record<string, Listener[]> = {};
  const document = {
    readyState: "complete",
    referrer: "",
    cookie: "",
    head: { appendChild: () => undefined },
    body: { appendChild: () => undefined },
    documentElement: {
      style: { setProperty: (_name: string, value: string) => inset.push(value) },
      setAttribute: () => undefined,
      removeAttribute: () => undefined,
    },
    createElement: (tag: string) => (tag === "script" ? makeScript() : node(0)),
    getElementsByTagName: () => [{ parentNode: { insertBefore: makeScript } }],
    querySelector: (selector: string) =>
      selector === "[data-mingla-ssr-privacy-bar]" ? bar
        : selector === "[data-mingla-ssr-privacy-folded]" ? folded
          : null,
    querySelectorAll: (selector: string) =>
      selector === "script[data-mingla-pixel]" ? scripts.filter((script) => !script.removed) : [],
    addEventListener: () => undefined,
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
    navigator: {},
    addEventListener: (type: string, listener: Listener) => { (windowListeners[type] ??= []).push(listener); },
    dispatchEvent: (event: { type: string; detail?: unknown }) => {
      for (const listener of windowListeners[event.type] ?? []) listener(event);
      return true;
    },
    Event: FakeEvent,
    CustomEvent: FakeEvent,
    setTimeout: () => 0,
    location: { href: "https://host.usemingla.com/e/acme/signal-night" },
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
  (windowListeners["mingla:privacy-saved"] ??= []).push((event) => {
    const detail = event.detail as { analytics: boolean; ads: boolean };
    saved.push({ analytics: detail.analytics, ads: detail.ads });
  });
  runInNewContext(publicAdRuntimeScript({ facts }), context);
  const pixelsOn = () => context.__minglaAdPixelsBootstrapped === true && scripts.some((script) => !script.removed);
  const stored = () => JSON.parse(storage.get("mingla_privacy_v2") ?? "null") as { analytics: boolean; ads: boolean } | null;
  return { bar, folded, reopen, parts, inset, saved, pixelsOn, stored };
}

describe("#4318 (b) after a choice the folded bar reopens the choices and a change takes effect", () => {
  test("accept (OK) → folded button → turn both off → reopen → turn both on", () => {
    const page = runPage();
    expect(page.bar.hidden).toBe(false);
    expect(page.pixelsOn()).toBe(true);

    page.parts.ok.click();
    expect(page.saved.at(-1)).toEqual({ analytics: true, ads: true });
    expect(page.bar.hidden).toBe(true);
    expect(page.folded.hidden).toBe(false);
    expect(page.inset.at(-1)).toBe("45px");

    page.reopen.click();
    expect(page.bar.hidden).toBe(false);
    expect(page.folded.hidden).toBe(true);
    expect(page.bar.getAttribute("data-expanded")).toBe("true");
    expect(page.parts.analytics.checked).toBe(true);
    expect(page.parts.ads.checked).toBe(true);

    page.parts.analytics.checked = false;
    page.parts.ads.checked = false;
    page.parts.save.click();
    expect(page.stored()).toMatchObject({ analytics: false, ads: false });
    expect(page.pixelsOn()).toBe(false);
    expect(page.folded.hidden).toBe(false);

    page.reopen.click();
    expect(page.parts.analytics.checked).toBe(false);
    expect(page.parts.ads.checked).toBe(false);
    page.parts.analytics.checked = true;
    page.parts.ads.checked = true;
    page.parts.save.click();
    expect(page.stored()).toMatchObject({ analytics: true, ads: true });
    expect(page.pixelsOn()).toBe(true);
    expect(page.folded.hidden).toBe(false);
  });

  test("decline (Options → Turn off all) → folded button → turn back on → reopen shows it on", () => {
    const page = runPage();
    page.parts.toggle.click();
    page.parts.off.click();
    expect(page.stored()).toMatchObject({ analytics: false, ads: false });
    expect(page.pixelsOn()).toBe(false);
    expect(page.bar.hidden).toBe(true);
    expect(page.folded.hidden).toBe(false);

    page.reopen.click();
    expect(page.bar.getAttribute("data-expanded")).toBe("true");
    expect(page.parts.analytics.checked).toBe(false);
    expect(page.parts.ads.checked).toBe(false);
    page.parts.analytics.checked = true;
    page.parts.ads.checked = true;
    page.parts.save.click();
    expect(page.saved.at(-1)).toEqual({ analytics: true, ads: true });
    expect(page.pixelsOn()).toBe(true);

    page.reopen.click();
    expect(page.parts.analytics.checked).toBe(true);
    expect(page.parts.ads.checked).toBe(true);
  });
});
