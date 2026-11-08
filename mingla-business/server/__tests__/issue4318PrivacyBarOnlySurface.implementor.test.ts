// #4318 section 7 (Seth): one thin "Privacy & ad choices" strip at the very
// bottom of every Host web page is the ONE place people make and change their
// analytics and ads choice. No first-visit banner, no OK prompt, no toast, and
// no separate "Privacy choices" link anywhere (app routes or server-rendered
// documents). Analytics and ads stay on unless turned off (#4128).
//
// This suite proves, on the real sources and the real server runtime:
//   (a) no product source renders the retired link or the retired banner, and
//       no server-rendered page shows "privacy choices" text outside the strip
//       and its sheet; the strip is in the first HTML;
//   (b) default on: a first visit loads the pixels with the sheet closed;
//   (c) the strip opens the choices; Save turns ads off and back on, the strip
//       reads "Saved", Escape closes the sheet and focus returns to the strip;
//   (d) the strip holds a permanent 28px inset (it never changes size).
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
// eslint-disable-next-line @typescript-eslint/no-require-imports
const privacyRuntime = require("../publicPrivacyRuntime") as {
  privacyBarCollapsedMarkup: () => string;
  privacyBarCollapsedRuntimeSource: () => string;
  privacyBarCss: () => string;
};

const BUSINESS = join(__dirname, "..", "..");
const REPO = join(BUSINESS, "..");
const BANNER = readFileSync(join(BUSINESS, "src/analytics/ConsentBanner.web.tsx"), "utf8");

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
 * What the page shows outside the privacy surface: the strip, its sheet and
 * scrim, and every script/style (the runtime's own strings) cut out.
 */
function outsideThePrivacySurface(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<section class="mpb[\s\S]*?<\/section>/g, "")
    .replace(/<button type="button" class="mps[\s\S]*?<\/button>/g, "");
}

describe("#4318 (a) the strip is the one privacy surface on Host web", () => {
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

  test("server-rendered public and share pages carry the strip from the first HTML, no banner, no stray privacy text", () => {
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
      inviteShell: privacyRuntime.privacyBarCollapsedMarkup(),
    };
    for (const [name, html] of Object.entries(pages)) {
      // The strip is in the server HTML, visible (not `hidden`).
      const strip = html.match(/<button type="button" class="mps[^>]*>/)?.[0] ?? "";
      expect([name, strip.includes('data-testid="privacy-strip"')]).toEqual([name, true]);
      expect([name, /\shidden[\s>]/.test(strip)]).toEqual([name, false]);
      expect([name, html.includes("Privacy &amp; ad choices</span></button>")]).toEqual([name, true]);
      // No first-visit banner, no OK prompt, no toast.
      for (const retired of ["Mingla uses cookies", ">OK<", "privacy-bar-ok", "privacy-toast", "Turn off all"]) {
        expect([name, retired, html.includes(retired)]).toEqual([name, retired, false]);
      }
      const rest = outsideThePrivacySurface(html);
      expect([name, /privacy choices/i.test(rest)]).toEqual([name, false]);
      expect([name, rest.includes("data-mingla-privacy-choices")]).toEqual([name, false]);
    }
  });

  test("the React owner renders the strip from mount with no banner, toast or folded icon", () => {
    expect(BANNER).toContain('export const PRIVACY_STRIP_LABEL = "Privacy & ad choices";');
    expect(BANNER).toContain('data-testid="privacy-strip"');
    expect(BANNER).toContain('<span aria-live="polite"');
    expect(BANNER).toContain("const SAVED_MS = 1800;");
    expect(BANNER).toContain('aria-modal="true"');
    // Gone: the first-visit row, OK, Options, the toast and the folded icon.
    for (const retired of ["privacy-bar-ok", "privacy-bar-options", "privacy-toast", "privacy-bar-folded", "privacy-bar-reopen", "Mingla uses cookies", "Turn off all"]) {
      expect([retired, BANNER.includes(retired)]).toEqual([retired, false]);
    }
    // The strip's height is the permanent inset; 28px plus the safe area.
    expect(privacyRuntime.privacyBarCss()).toContain("height:calc(28px + env(safe-area-inset-bottom,0px))");
    expect(privacyRuntime.privacyBarCss()).toContain(":root{--mingla-privacy-inset:calc(28px + env(safe-area-inset-bottom,0px))}");
    expect(BANNER).toMatch(/const measure = \(\): void => writeInset\(strip\.getBoundingClientRect\(\)\.height\);/);
  });
});

// ---- runtime: the server-rendered strip, real runtime source, fake DOM ----

type Listener = (event: { type: string; detail?: unknown; key?: string; shiftKey?: boolean; preventDefault?: () => void }) => void;
interface FakeNode {
  hidden: boolean;
  checked: boolean;
  textContent: string;
  className: string;
  attrs: Record<string, string>;
  listeners: Record<string, Listener[]>;
  isConnected: boolean;
  height: number;
  focused: number;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  addEventListener: (type: string, listener: Listener) => void;
  click: () => void;
  focus: () => void;
  remove: () => void;
  getBoundingClientRect: () => { height: number };
  querySelector: (selector: string) => FakeNode | null;
  querySelectorAll: (selector: string) => FakeNode[];
  contains: (other: unknown) => boolean;
}

function runPage(options: { gpc?: boolean } = {}) {
  process.env.EXPO_PUBLIC_META_PIXEL_ID = "meta-4318";
  const storage = new Map<string, string>();
  const scripts: { removed: boolean; remove: () => void; setAttribute: () => void; async: boolean; src: string }[] = [];
  const makeScript = () => {
    const script = { removed: false, async: false, src: "", setAttribute: () => undefined, remove() { script.removed = true; } };
    scripts.push(script);
    return script;
  };
  const doc: { activeElement: FakeNode | null } = { activeElement: null };
  const node = (height: number, children: Record<string, FakeNode> = {}): FakeNode => {
    const self: FakeNode = {
      hidden: false,
      checked: false,
      textContent: "",
      className: "",
      attrs: {},
      listeners: {},
      isConnected: true,
      height,
      focused: 0,
      setAttribute(name, value) { self.attrs[name] = value; },
      getAttribute(name) { return self.attrs[name] ?? null; },
      addEventListener(type, listener) { (self.listeners[type] ??= []).push(listener); },
      click() { for (const listener of self.listeners.click ?? []) listener({ type: "click" }); },
      focus() { self.focused += 1; doc.activeElement = self; },
      remove() { self.isConnected = false; },
      getBoundingClientRect() { return { height: self.hidden ? 0 : self.height }; },
      querySelector(selector) { return children[selector] ?? null; },
      querySelectorAll() { return Object.values(children); },
      contains(other) { return Object.values(children).includes(other as FakeNode); },
    };
    return self;
  };
  const parts = { label: node(0), analytics: node(26), ads: node(26), save: node(44) };
  const strip = node(28, { "[data-mps-label]": parts.label });
  parts.label.textContent = "Privacy & ad choices";
  const scrim = node(0);
  const sheet = node(240, {
    '[data-mpb-switch="analytics"]': parts.analytics,
    '[data-mpb-switch="ads"]': parts.ads,
    '[data-mpb-act="save"]': parts.save,
  });
  sheet.hidden = true;
  scrim.hidden = true;
  const inset: string[] = [];
  const saved: Array<{ analytics: boolean; ads: boolean }> = [];
  const windowListeners: Record<string, Listener[]> = {};
  const documentListeners: Record<string, Listener[]> = {};
  const timers: Array<() => void> = [];
  const document = {
    readyState: "complete",
    referrer: "",
    cookie: "",
    get activeElement() { return doc.activeElement; },
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
      selector === "[data-mingla-ssr-privacy-bar]" ? sheet
        : selector === "[data-mingla-ssr-privacy-strip]" ? strip
          : selector === "[data-mingla-ssr-privacy-scrim]" ? scrim
            : null,
    querySelectorAll: (selector: string) =>
      selector === "script[data-mingla-pixel]" ? scripts.filter((script) => !script.removed) : [],
    addEventListener: (type: string, listener: Listener) => { (documentListeners[type] ??= []).push(listener); },
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
    navigator: options.gpc === true ? { globalPrivacyControl: true } : {},
    addEventListener: (type: string, listener: Listener) => { (windowListeners[type] ??= []).push(listener); },
    dispatchEvent: (event: { type: string; detail?: unknown }) => {
      for (const listener of windowListeners[event.type] ?? []) listener(event);
      return true;
    },
    Event: FakeEvent,
    CustomEvent: FakeEvent,
    setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
    clearTimeout: () => undefined,
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
  const key = (k: string) => {
    let prevented = false;
    for (const listener of documentListeners.keydown ?? []) {
      listener({ type: "keydown", key: k, shiftKey: false, preventDefault: () => { prevented = true; } });
    }
    return prevented;
  };
  const runTimers = () => { while (timers.length > 0) timers.shift()?.(); };
  return { sheet, strip, scrim, parts, inset, saved, pixelsOn, stored, key, runTimers };
}

describe("#4318 (b) default on: no banner, no wait for consent", () => {
  test("a first visit loads the pixels, shows the strip and keeps the sheet closed", () => {
    const page = runPage();
    expect(page.pixelsOn()).toBe(true);
    expect(page.strip.hidden).toBe(false);
    expect(page.sheet.hidden).toBe(true);
    expect(page.stored()).toBeNull();
    expect(page.parts.label.textContent).toBe("Privacy & ad choices");
  });

  test("Global Privacy Control starts ads off; analytics stays on", () => {
    const page = runPage({ gpc: true });
    expect(page.pixelsOn()).toBe(false);
    page.strip.click();
    expect(page.parts.analytics.checked).toBe(true);
    expect(page.parts.ads.checked).toBe(false);
  });
});

describe("#4318 (c) the strip opens the choices; Save takes effect; Saved shows", () => {
  test("Save turns analytics and ads off, then back on; the strip reads Saved for 1.8s", () => {
    const page = runPage();
    page.strip.click();
    expect(page.sheet.hidden).toBe(false);
    expect(page.scrim.hidden).toBe(false);
    expect(page.strip.attrs["aria-expanded"]).toBe("true");
    expect(page.parts.analytics.checked).toBe(true);
    expect(page.parts.ads.checked).toBe(true);

    page.parts.analytics.checked = false;
    page.parts.ads.checked = false;
    page.parts.save.click();
    expect(page.stored()).toMatchObject({ analytics: false, ads: false });
    expect(page.saved.at(-1)).toEqual({ analytics: false, ads: false });
    expect(page.pixelsOn()).toBe(false);
    expect(page.sheet.hidden).toBe(true);
    expect(page.parts.label.textContent).toBe("Saved");
    page.runTimers();
    expect(page.parts.label.textContent).toBe("Privacy & ad choices");

    page.strip.click();
    expect(page.parts.analytics.checked).toBe(false);
    expect(page.parts.ads.checked).toBe(false);
    page.parts.analytics.checked = true;
    page.parts.ads.checked = true;
    page.parts.save.click();
    expect(page.stored()).toMatchObject({ analytics: true, ads: true });
    expect(page.saved.at(-1)).toEqual({ analytics: true, ads: true });
    expect(page.pixelsOn()).toBe(true);
    expect(page.parts.label.textContent).toBe("Saved");
  });

  test("the strip moves focus into the sheet; Escape closes it and returns focus to the strip", () => {
    const page = runPage();
    const before = page.strip.focused;
    page.strip.click();
    expect(page.sheet.hidden).toBe(false);
    expect(page.parts.analytics.focused).toBeGreaterThan(0);
    page.key("Escape");
    expect(page.sheet.hidden).toBe(true);
    expect(page.strip.attrs["aria-expanded"]).toBe("false");
    expect(page.strip.focused).toBeGreaterThan(before);
    expect(page.stored()).toBeNull();
  });
});

describe("#4318 (d) the strip never changes size", () => {
  test("the inset is the strip's 28px from load, open, Save and close", () => {
    const page = runPage();
    expect(page.inset.at(-1)).toBe("28px");
    page.strip.click();
    page.parts.save.click();
    page.runTimers();
    expect(new Set(page.inset)).toEqual(new Set(["28px"]));
  });

  test("the lean invite-shell strip hands off to the app instead of a banner", () => {
    const lean = privacyRuntime.privacyBarCollapsedRuntimeSource();
    expect(lean).toContain("window.__minglaPrivacyOpenExpanded=true");
    expect(lean).toContain('new Event("mingla:privacy-options")');
    expect(lean).not.toContain("privacy-saved");
  });
});
