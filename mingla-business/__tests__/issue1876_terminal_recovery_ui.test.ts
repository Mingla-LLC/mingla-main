/**
 * Issue #1876 — F-3, the recovery path's terminal UI. Happy path + the three
 * negatives that keep it from becoming a worse bug than the one it fixes.
 *
 * WHY THIS FILE EXISTS. Business web's chunk recovery gets exactly ONE
 * automatic reload, bounded by a 10,000 ms `sessionStorage` cooldown shared
 * with `chunkReloadGuard` (`I-1485-ONE-CHUNK-RECOVERY-OWNER`). That cooldown is
 * the ONLY guarantee recovery cannot reload-loop, so it can never be relaxed —
 * which makes its suppression branch a permanent dead end by construction.
 *
 * #1485 left that dead end as a bare `console.warn` and deferred to "the
 * ErrorBoundary's recoverable fallback". For a LAZY ROUTE chunk that is right:
 * React is running and the boundary catches it. For the ENTRY BUNDLE it is not:
 * React never mounts, so no boundary exists. The deployed `<body>` on
 * 2026-08-11 was, in full:
 *
 *   <noscript>You need to enable JavaScript to run this app.</noscript>
 *   <div id="root"></div>
 *   <script src="/_expo/static/js/web/__expo-metro-runtime-….js" defer></script>
 *   <script src="/_expo/static/js/web/__common-….js" defer></script>
 *   <script src="/_expo/static/js/web/index-….js" defer></script>
 *
 * An empty div and a `<noscript>` that never shows, because JS *is* enabled.
 * After the cooldown suppressed the second reload the user got a console
 * warning and a permanently white page. Constitution rule 3, live.
 *
 * THE NEGATIVES ARE THE POINT. A card that appears OVER a working app is worse
 * than the blank page it replaces, so the render is gated on `#root` still
 * being empty 1500 ms after suppression, and the card is appended as a SIBLING
 * of `#root` — never into it — so React can still mount over `#root` untouched
 * if a late chunk lands. T-8/T-9/T-10/T-14 are those guards.
 *
 * HOW IT TESTS. Not a source grep. The `CHUNK_RECOVERY_SCRIPT` template literal
 * is read out of the build script, evaluated with the real constants into the
 * EXACT bytes that ship in `<head>`, and executed against a synthetic window
 * and a synthetic document — the same technique as
 * `issue1485_p2_1_one_chunk_recovery_owner.test.ts`, and for the same reason
 * (`jest-environment-jsdom` is deliberately not a dependency of
 * `mingla-business`; see that suite's ENVIRONMENT NOTE).
 *
 * Fails-on-revert: restoring the bare `console.warn(...); return` suppression
 * branch — i.e. deleting the `armBootError()` call — leaves the DOM untouched
 * and fails T-7.1 through T-7.5, T-11, T-12 and T-13.
 *
 * ---------------------------------------------------------------------------
 * REWORK, 2026-08-11 — WHY THIS FILE'S CONTRACT CHANGED.
 *
 * The first attempt passed every test in this file and shipped a card with ZERO
 * VISIBLE PIXELS on every viewport: a static-flow sibling after a `#root` that
 * `expo-reset` pins to `height:100%`, on a `body{overflow:hidden}` page that
 * cannot scroll. The user saw the same blank white rectangle the issue is named
 * after, and CI called it fixed.
 *
 * The cause was the SHAPE of the assertions, not the count of them: SC-8 asked
 * "is the node in the DOM?", which is true of an invisible card. So:
 *
 *   * T-7.1 (SC-8) is now a VISIBILITY claim — in the viewport, non-zero box,
 *     out of the flow that stranded it — evaluated by `resolveCardBox` below.
 *   * T-16.0 is a VACUITY GUARD on that evaluator: it must reproduce the three
 *     Chromium measurements taken on the real shell at the defective commit
 *     (tops of 772 / 844 / 928 px, 0 visible pixels). An oracle that cannot see
 *     the known defect proves nothing about the fix.
 *   * T-17 covers the removal path, and T-18 the latch (see the build script's
 *     own P0-1 / P1-1 / P2-1 notes for why all three had to ship together).
 *
 * And the claim this file structurally CANNOT make — that a real engine lays it
 * out where the arithmetic says — is made by
 * `playwright/issue1876/boot-error-reachability.spec.ts` in real Chromium.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const BUSINESS_ROOT = join(__dirname, "..");
const INJECT_PATH = join(BUSINESS_ROOT, "scripts", "inject-mobile-blur-css.mjs");

const injectSource = readFileSync(INJECT_PATH, "utf8");

function stringConst(source: string, name: string): string {
  const match = source.match(new RegExp(`const ${name} = "([^"]*)";`));
  if (match === null) throw new Error(`could not find string const ${name}`);
  return match[1];
}

function numberConst(source: string, name: string): number {
  const match = source.match(new RegExp(`const ${name} = ([0-9_]+);`));
  if (match === null) throw new Error(`could not find numeric const ${name}`);
  return Number(match[1].replace(/_/g, ""));
}

const LEGACY_KEY = stringConst(injectSource, "CHUNK_RECOVERY_MARKER");
const SHARED_KEY = stringConst(injectSource, "CHUNK_RECOVERY_KEY");
const COOLDOWN_MS = numberConst(injectSource, "CHUNK_RECOVERY_COOLDOWN_MS");

/** Materialises the EXACT `<script>…</script>` string the build injects. */
function injectedScriptTag(): string {
  const match = injectSource.match(/const CHUNK_RECOVERY_SCRIPT =\s*(`[^`]*`);/);
  if (match === null) {
    throw new Error("could not find the CHUNK_RECOVERY_SCRIPT template literal");
  }
  const build = new Function(
    "CHUNK_RECOVERY_MARKER",
    "CHUNK_RECOVERY_KEY",
    "CHUNK_RECOVERY_COOLDOWN_MS",
    `return ${match[1]};`,
  ) as (marker: string, key: string, cooldown: number) => string;
  return build(LEGACY_KEY, SHARED_KEY, COOLDOWN_MS);
}

const SCRIPT_TAG = injectedScriptTag();
const SCRIPT_BODY = SCRIPT_TAG.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");

const CHUNK_URL = "/_expo/static/js/web/index-c71bd65d4564bece548e38b8d5512d1e.js";
const BOOT_ERROR_ID = "mingla-boot-error";
const BOOT_ERROR_DELAY_MS = 1500;

/** The exact user-facing copy this issue's SPEC specifies. */
const HEADING = "This page didn't finish loading";
const BODY_COPY =
  "Mingla just updated in the background. Reload and you'll be right back where you were.";
const BUTTON_LABEL = "Reload";

// ---------------------------------------------------------------------------
// A minimal synthetic DOM. Only what the injected script actually touches.
// ---------------------------------------------------------------------------

type FakeNode = {
  tagName: string;
  id: string;
  type: string;
  textContent: string;
  style: { cssText: string };
  attributes: Record<string, string>;
  childNodes: FakeNode[];
  parentNode: FakeNode | null;
  onclick: null | (() => void);
  setAttribute: (name: string, value: string) => void;
  appendChild: (child: FakeNode) => FakeNode;
  removeChild: (child: FakeNode) => FakeNode;
  remove: () => void;
};

/**
 * #1876 REWORK — mutation observers registered against this DOM, and the
 * bubbling notifier that drives them. The first attempt's harness could not
 * REMOVE a node or observe one, so "the card is never taken away" was not a
 * fact the harness could even express. It can now.
 */
const mutationObservers: { target: FakeNode; cb: () => void }[] = [];

function notifyMutation(node: FakeNode | null): void {
  for (let cursor = node; cursor !== null; cursor = cursor.parentNode) {
    for (const entry of [...mutationObservers]) if (entry.target === cursor) entry.cb();
  }
}

function makeNode(tagName: string): FakeNode {
  const node: FakeNode = {
    tagName,
    id: "",
    type: "",
    textContent: "",
    style: { cssText: "" },
    attributes: {},
    childNodes: [],
    parentNode: null,
    onclick: null,
    setAttribute: (name, value) => {
      node.attributes[name] = value;
    },
    appendChild: (child) => {
      child.parentNode = node;
      node.childNodes.push(child);
      notifyMutation(node);
      return child;
    },
    removeChild: (child) => {
      const at = node.childNodes.indexOf(child);
      if (at >= 0) node.childNodes.splice(at, 1);
      child.parentNode = null;
      notifyMutation(node);
      return child;
    },
    remove: () => {
      if (node.parentNode !== null) node.parentNode.removeChild(node);
    },
  };
  return node;
}

function findById(node: FakeNode, id: string): FakeNode | null {
  if (node.id === id) return node;
  for (const child of node.childNodes) {
    const hit = findById(child, id);
    if (hit !== null) return hit;
  }
  return null;
}

type FakeDocument = {
  body: FakeNode | null;
  documentElement: FakeNode;
  createElement: (tag: string) => FakeNode;
  getElementById: (id: string) => FakeNode | null;
  addEventListener: (type: string, listener: () => void) => void;
  fireDomContentLoaded: () => void;
  attachBody: (body: FakeNode) => void;
};

function makeDocument(options: { withBody: boolean }): FakeDocument {
  const documentElement = makeNode("html");
  const listeners = new Map<string, (() => void)[]>();
  const doc: FakeDocument = {
    body: null,
    documentElement,
    createElement: (tag) => makeNode(tag),
    getElementById: (id) => (doc.body === null ? null : findById(doc.body, id)),
    addEventListener: (type, listener) => {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
    fireDomContentLoaded: () => {
      for (const listener of listeners.get("DOMContentLoaded") ?? []) listener();
    },
    attachBody: (body) => {
      doc.body = body;
      documentElement.appendChild(body);
    },
  };
  if (options.withBody) {
    const body = makeNode("body");
    body.appendChild(Object.assign(makeNode("div"), { id: "root" }));
    doc.attachBody(body);
  }
  return doc;
}

type Listener = (event: unknown) => void;

type MountOptions = {
  seed?: Record<string, string>;
  getItemThrows?: boolean;
  /** Omit `document.body` at boot (a `<head>`-blocking script's real state). */
  withoutBody?: boolean;
  /** Omit `window.document` entirely (the #1485 synthetic-window harnesses). */
  withoutDocument?: boolean;
  /** Omit `window.MutationObserver`, forcing the bounded polling fallback. */
  withoutMutationObserver?: boolean;
  /** Omit `setInterval`/`clearInterval` too — no removal path is possible. */
  withoutTimers?: boolean;
};

/** Minimal `MutationObserver` over the fake DOM above. */
class FakeMutationObserver {
  private readonly cb: () => void;

  constructor(cb: () => void) {
    this.cb = cb;
  }

  observe(target: FakeNode): void {
    mutationObservers.push({ target, cb: this.cb });
  }

  disconnect(): void {
    for (let i = mutationObservers.length - 1; i >= 0; i -= 1) {
      if (mutationObservers[i].cb === this.cb) mutationObservers.splice(i, 1);
    }
  }

  takeRecords(): unknown[] {
    return [];
  }
}

type Harness = {
  doc: FakeDocument;
  reload: jest.Mock;
  navigations: string[];
  fireResourceError: (src: string) => void;
  card: () => FakeNode | null;
  root: () => FakeNode | null;
  mountRoot: () => void;
  populateRoot: () => void;
  clearRoot: () => void;
};

const CHECKOUT_URL = "https://business.usemingla.com/checkout/48db05a9-2b78";
const realWindow = (global as unknown as { window?: unknown }).window;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_700_000_000_000);
  mutationObservers.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
  (global as unknown as { window?: unknown }).window = realWindow;
  jest.clearAllMocks();
});

function mount(options: MountOptions = {}): Harness {
  const listeners = new Map<string, Listener[]>();
  const store = new Map<string, string>(Object.entries(options.seed ?? {}));
  const navigations: string[] = [];
  const reload = jest.fn();
  const doc = makeDocument({ withBody: options.withoutBody !== true });

  const storage = {
    getItem: (key: string): string | null => {
      if (options.getItemThrows === true) throw new Error("sessionStorage is blocked");
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string): void => {
      if (options.getItemThrows === true) throw new Error("sessionStorage is blocked");
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      if (options.getItemThrows === true) throw new Error("sessionStorage is blocked");
      store.delete(key);
    },
  };

  const location: Record<string, unknown> = {
    reload,
    replace: jest.fn((url: string) => navigations.push(`replace:${url}`)),
    assign: jest.fn((url: string) => navigations.push(`assign:${url}`)),
  };
  Object.defineProperty(location, "href", {
    configurable: true,
    get: () => CHECKOUT_URL,
    set: (value: string) => {
      navigations.push(`href:${String(value)}`);
    },
  });

  const fakeWindow: Record<string, unknown> = {
    addEventListener: (type: string, listener: Listener): void => {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
    location,
    sessionStorage: storage,
    setTimeout: ((handler: () => void, delay?: number) =>
      setTimeout(handler, delay)) as typeof setTimeout,
  };
  // #1876 REWORK — a real browser has these, so the harness has them too. The
  // fallback path is exercised by omitting them (T-17.3).
  if (options.withoutMutationObserver !== true) {
    fakeWindow.MutationObserver = FakeMutationObserver;
  }
  if (options.withoutTimers !== true) {
    fakeWindow.setInterval = ((handler: () => void, delay?: number) =>
      setInterval(handler, delay)) as typeof setInterval;
    fakeWindow.clearInterval = ((handle: never) => clearInterval(handle)) as typeof clearInterval;
  }
  if (options.withoutDocument !== true) fakeWindow.document = doc;

  (global as unknown as { window?: unknown }).window = fakeWindow;

  const quietConsole = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
  new Function("window", "console", SCRIPT_BODY)(fakeWindow, quietConsole);

  const dispatch = (type: string, event: unknown): void => {
    const registered = listeners.get(type) ?? [];
    expect(registered.length).toBeGreaterThan(0);
    for (const listener of registered) listener(event);
  };

  return {
    doc,
    reload,
    navigations,
    fireResourceError: (src: string) => dispatch("error", { target: { src } }),
    card: () => doc.getElementById(BOOT_ERROR_ID),
    root: () => doc.getElementById("root"),
    mountRoot: () => {
      const body = makeNode("body");
      body.appendChild(Object.assign(makeNode("div"), { id: "root" }));
      doc.attachBody(body);
    },
    populateRoot: () => {
      const root = doc.getElementById("root");
      if (root === null) throw new Error("no #root to populate");
      root.appendChild(makeNode("div")); // React mounted
    },
    clearRoot: () => {
      const root = doc.getElementById("root");
      if (root === null) throw new Error("no #root to clear");
      while (root.childNodes.length > 0) root.removeChild(root.childNodes[0]);
    },
  };
}

// ---------------------------------------------------------------------------
// #1876 REWORK — THE LAYOUT ORACLE.
//
// SC-8 used to read "`#mingla-boot-error` is present in the DOM after 1500 ms",
// and the card that satisfied it had ZERO VISIBLE PIXELS on every viewport. A
// presence assertion cannot tell a card from a blank page, so SC-8 is now a
// VISIBILITY claim and this is what evaluates it.
//
// `jest-environment-jsdom` is deliberately not a dependency of `mingla-business`
// and jsdom would not compute layout anyway, so this resolves the card's border
// box itself — for exactly the two positioning schemes in play, under the
// deployed shell's own `<style id="expo-reset">`:
//
//     html, body { height: 100%; }   body { overflow: hidden; }
//     #root { display: flex; height: 100%; flex: 1; }
//
// STATIC FLOW (the defect): an EMPTY `#root` is still `height:100%`, so a
// sibling after it starts at the UA's 8px body margin + 100vh + its own top
// margin, and `body{overflow:hidden}` propagates to the viewport so nothing can
// scroll to it.
// FIXED + CENTRED (the fix): the box is resolved against the viewport, so the
// flow `#root` owns cannot push it anywhere.
//
// IT IS PROVEN, NOT ASSUMED: T-16.0 feeds it the exact CSS that shipped at
// `fe76b973a` and requires it to reproduce the three Chromium measurements the
// tester took on the real shell — 772 / 844 / 928 px tops and 0 visible pixels.
// An oracle that cannot detect the known defect is worth nothing.
// ---------------------------------------------------------------------------

/** UA default `body` margin. `expo-reset` does not zero it, so it is real. */
const BODY_MARGIN_PX = 8;

/** The card's rendered height in Chromium at 390px wide, measured 2026-08-11. */
const MEASURED_CARD_HEIGHT_PX = 210;

type Viewport = { w: number; h: number; label: string };

const VIEWPORTS: Viewport[] = [
  { w: 390, h: 664, label: "iPhone 13" },
  { w: 393, h: 727, label: "Pixel 5" },
  { w: 1280, h: 800, label: "desktop" },
];

function declarations(cssText: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of cssText.split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    out[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).trim();
  }
  return out;
}

/** `15vh` / `50%` / `24px` against one axis of the viewport. */
function resolveLength(value: string, axisPx: number): number {
  const vh = /^(-?[\d.]+)vh$/.exec(value);
  if (vh !== null) return (Number(vh[1]) / 100) * axisPx;
  const pct = /^(-?[\d.]+)%$/.exec(value);
  if (pct !== null) return (Number(pct[1]) / 100) * axisPx;
  const px = /^(-?[\d.]+)px$/.exec(value);
  if (px !== null) return Number(px[1]);
  return 0;
}

type Box = { top: number; visiblePx: number; outOfFlow: boolean };

/**
 * Where the card's border box lands, and how much of it a human can see.
 * `outOfFlow` says the empty `#root`'s flow cannot strand it — which is the
 * only structural defence, because `body{overflow:hidden}` propagates to the
 * viewport and no wheel, drag or key press can scroll to anything below it.
 */
function resolveCardBox(cssText: string, vp: Viewport, cardHeightPx: number): Box {
  const decl = declarations(cssText);
  const width = Math.min(
    decl["max-width"] === "22rem" ? 352 : vp.w,
    vp.w - (decl["position"] === "fixed" ? 32 : 0),
  );

  let top: number;
  if (decl["position"] === "fixed") {
    const anchor = resolveLength(decl["top"] ?? "0", vp.h);
    const shiftsUpByHalf = /translate\(\s*-50%\s*,\s*-50%\s*\)/i.test(decl["transform"] ?? "");
    top = anchor - (shiftsUpByHalf ? cardHeightPx / 2 : 0);
  } else {
    // Static flow, after a `#root` the reset pins to the full viewport height.
    const marginTop = (decl["margin"] ?? "0").split(/\s+/)[0];
    top = BODY_MARGIN_PX + vp.h + resolveLength(marginTop, vp.h);
  }

  const visibleH = Math.max(0, Math.min(top + cardHeightPx, vp.h) - Math.max(top, 0));
  return {
    top: Math.round(top),
    visiblePx: Math.round(visibleH * width),
    outOfFlow: decl["position"] === "fixed" || decl["position"] === "absolute",
  };
}

/** Puts the shared cooldown record inside its window, so the next failure is suppressed. */
const suppressedSeed = (): Record<string, string> => ({
  [SHARED_KEY]: String(Date.now() - (COOLDOWN_MS - 1)),
});

// ---------------------------------------------------------------------------

describe("#1876 T-7 — a suppressed failure with an empty #root shows the card", () => {
  test("T-7.1 — SC-8: after the 1500 ms guard the card is VISIBLE, not merely present", () => {
    // SC-8 REWRITTEN. It used to assert `expect(head.card()).not.toBeNull()`,
    // and a card with zero visible pixels on every viewport satisfied it. DOM
    // presence is not the property this issue is about — a human seeing a way
    // out of a blank page is. So the node still has to exist, and then it has to
    // land inside the viewport with a non-zero box on every geometry we ship to.
    const head = mount({ seed: suppressedSeed() });

    head.fireResourceError(CHUNK_URL);
    expect(head.reload).not.toHaveBeenCalled(); // suppressed, as designed
    expect(head.card()).toBeNull(); // nothing yet — the guard has not fired

    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS);

    const card = head.card();
    expect(card).not.toBeNull();

    const css = card?.style.cssText ?? "";
    const seen = VIEWPORTS.map((vp) => {
      const box = resolveCardBox(css, vp, MEASURED_CARD_HEIGHT_PX);
      return {
        viewport: vp.label,
        topInsideViewport: box.top >= 0 && box.top + MEASURED_CARD_HEIGHT_PX <= vp.h,
        hasVisiblePixels: box.visiblePx > 0,
        outOfFlow: box.outOfFlow,
      };
    });

    expect(seen).toEqual(
      VIEWPORTS.map((vp) => ({
        viewport: vp.label,
        topInsideViewport: true,
        hasVisiblePixels: true,
        outOfFlow: true,
      })),
    );
  });

  test("T-7.2 — the card carries the exact heading, body and button copy", () => {
    const head = mount({ seed: suppressedSeed() });
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS);

    const card = head.card();
    const texts = (card?.childNodes ?? []).map((child) => child.textContent);
    expect(texts).toEqual([HEADING, BODY_COPY, BUTTON_LABEL]);
  });

  test("T-7.3 — the card is announced and its Reload control is a real button", () => {
    const head = mount({ seed: suppressedSeed() });
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS);

    const card = head.card();
    expect(card?.attributes.role).toBe("alert");

    const button = card?.childNodes[2];
    expect(button?.tagName).toBe("button");
    expect(button?.type).toBe("button");
    // The visible label IS the accessible name — no divergent aria-label.
    expect(button?.attributes["aria-label"]).toBeUndefined();
    // 44x44 minimum tap target, Mingla orange, white label, no border.
    expect(button?.style.cssText).toContain("min-height:44px");
    expect(button?.style.cssText).toContain("min-width:44px");
    expect(button?.style.cssText).toContain("background:#eb7825");
    expect(button?.style.cssText).toContain("color:#ffffff");
    expect(button?.style.cssText).toContain("border-radius:8px");
  });

  test("T-7.4 — the card is dependency-free: inline styles, no network, no fonts", () => {
    const head = mount({ seed: suppressedSeed() });
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS);

    const card = head.card();
    expect(card?.style.cssText).toContain("max-width:22rem");
    // It runs precisely when no bundle loaded, so it may assume nothing exists.
    for (const forbidden of ["http://", "https://", "@import", "url(", "<link"]) {
      expect(SCRIPT_TAG).not.toContain(forbidden);
    }
  });

  test("T-7.5 — SC-14: blocked sessionStorage gets NO reload but still gets the card", () => {
    // Private mode: the storage read throws, the existing `catch` skips recovery
    // entirely, so this user never gets even one automatic reload. The card is
    // their only route out and it must render.
    const head = mount({ getItemThrows: true });

    expect(() => head.fireResourceError(CHUNK_URL)).not.toThrow();
    expect(head.reload).not.toHaveBeenCalled();

    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS);

    expect(head.card()).not.toBeNull();
    expect(head.navigations).toEqual([]);
  });

  test("T-7.6 — when body is absent at boot, the card defers to DOMContentLoaded", () => {
    const head = mount({ seed: suppressedSeed(), withoutBody: true });

    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS);
    expect(head.card()).toBeNull(); // nowhere to mount yet — and it did not throw

    head.mountRoot();
    head.doc.fireDomContentLoaded();

    expect(head.card()).not.toBeNull();
    expect(head.root()?.childNodes).toHaveLength(0);
  });
});

describe("#1876 T-8/T-9/T-10 — the card must NEVER appear over a working app", () => {
  test("T-8 — SC-9: #root populated before the guard fires means NO card", () => {
    const head = mount({ seed: suppressedSeed() });

    head.fireResourceError(CHUNK_URL);
    head.populateRoot(); // React mounted: a lazy-route failure, app still alive

    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS * 10);

    expect(head.card()).toBeNull();
  });

  test("T-8b — the guard is evaluated at 1500 ms, not at suppression time", () => {
    // A #root that populates at 1499 ms must suppress the card; the decision is
    // deliberately deferred so a slow-but-successful boot is never interrupted.
    const head = mount({ seed: suppressedSeed() });
    head.fireResourceError(CHUNK_URL);

    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS - 1);
    expect(head.card()).toBeNull();
    head.populateRoot();

    jest.advanceTimersByTime(1);
    expect(head.card()).toBeNull();
  });

  test("T-9 — SC-10: a healthy boot with no chunk error renders no card", () => {
    const head = mount();

    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS * 10);

    expect(head.card()).toBeNull();
    expect(head.reload).not.toHaveBeenCalled();
  });

  test("T-9b — a non-chunk resource failure renders no card", () => {
    const head = mount({ seed: suppressedSeed() });

    head.fireResourceError("/assets/assets/google_icon.abc123.png");
    head.fireResourceError("/_expo/static/media/font-abc.ttf");
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS * 10);

    expect(head.card()).toBeNull();
    expect(head.reload).not.toHaveBeenCalled();
  });

  test("T-10 — SC-11: the FIRST failure reloads exactly once and renders no card", () => {
    const head = mount(); // no seed: the cooldown is not active

    head.fireResourceError(CHUNK_URL);
    expect(head.reload).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS * 10);

    expect(head.card()).toBeNull();
    expect(head.navigations).toEqual([]);
  });
});

describe("#1876 T-11 — idempotent: one card, ever", () => {
  test("T-11.1 — SC-13: two suppressed failures render exactly ONE node", () => {
    const head = mount({ seed: suppressedSeed() });

    head.fireResourceError(CHUNK_URL);
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS);
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS * 5);

    const body = head.doc.body;
    const cards = (body?.childNodes ?? []).filter((node) => node.id === BOOT_ERROR_ID);
    expect(cards).toHaveLength(1);
  });

  test("T-11.2 — a burst of ten suppressed failures still renders exactly ONE", () => {
    const head = mount({ seed: suppressedSeed() });

    for (let i = 0; i < 10; i += 1) head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS * 3);

    const body = head.doc.body;
    const cards = (body?.childNodes ?? []).filter((node) => node.id === BOOT_ERROR_ID);
    expect(cards).toHaveLength(1);
    expect(head.reload).not.toHaveBeenCalled();
  });
});

describe("#1876 T-12 — Reload reloads, and never navigates", () => {
  test("T-12.1 — SC-12: clicking Reload calls window.location.reload() only", () => {
    const head = mount({ seed: suppressedSeed() });
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS);

    const button = head.card()?.childNodes[2];
    expect(button?.onclick).toBeInstanceOf(Function);

    head.reload.mockClear();
    button?.onclick?.();

    expect(head.reload).toHaveBeenCalledTimes(1);
    expect(head.navigations).toEqual([]); // href / assign / replace all untouched
  });

  test("T-12.2 — the shipped bytes still contain no navigation primitive", () => {
    // The terminal UI must not have smuggled one in. This extends
    // `issue1485_p2_1_recovery_never_navigates.tester.adversarial.test.ts` N.2
    // to the branch that suite could not reach.
    for (const forbidden of [
      "location.replace",
      "location.assign",
      ".assign(",
      "window.open",
      "pushState",
      "replaceState",
      "http-equiv",
      "document.location",
    ]) {
      expect(SCRIPT_TAG).not.toContain(forbidden);
    }
    expect(SCRIPT_TAG).not.toMatch(/location\s*\.\s*href\s*=/);
    expect(SCRIPT_TAG).toContain("window.location.reload()");
  });
});

describe("#1876 T-13/T-14 — the card never touches React's mount point", () => {
  test("T-13 — the card is appended to document.body, as a SIBLING of #root", () => {
    const head = mount({ seed: suppressedSeed() });
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS);

    const body = head.doc.body;
    const ids = (body?.childNodes ?? []).map((node) => node.id);
    expect(ids).toEqual(["root", BOOT_ERROR_ID]);
  });

  test("T-14 — #root is left completely empty, so React can still mount over it", () => {
    const head = mount({ seed: suppressedSeed() });
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS);

    expect(head.card()).not.toBeNull();
    expect(head.root()?.childNodes).toHaveLength(0);
  });
});

describe("#1876 T-15 — the terminal UI cannot break the #1485 harnesses", () => {
  test("T-15.1 — a window with no document neither throws nor schedules anything", () => {
    // `issue1485_p2_1_one_chunk_recovery_owner` and its adversarial sibling
    // execute these bytes against a synthetic window that has NO document and
    // NO setTimeout. A bare `document` reference here would throw where those
    // suites assert nothing escapes, so the DOM reach must stay guarded.
    const head = mount({ seed: suppressedSeed(), withoutDocument: true });

    expect(() => head.fireResourceError(CHUNK_URL)).not.toThrow();
    expect(() => jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS * 10)).not.toThrow();
    expect(head.reload).not.toHaveBeenCalled();
    expect(head.navigations).toEqual([]);
  });

  test("T-15.2 — the shared cooldown record and window are untouched by #1876", () => {
    // `I-1485-ONE-CHUNK-RECOVERY-OWNER` pins these equal across both owners.
    expect(SHARED_KEY).toBe("mingla:last-chunk-reload");
    expect(COOLDOWN_MS).toBe(10_000);
    expect(SCRIPT_TAG).toContain(`var KEY="${SHARED_KEY}"`);
    expect(SCRIPT_TAG).toContain(`var COOLDOWN_MS=${COOLDOWN_MS}`);
  });
});

// ---------------------------------------------------------------------------
// #1876 REWORK — the three defects the first attempt shipped.
// ---------------------------------------------------------------------------

describe("#1876 T-16 — P0-1: the card is reachable, and the oracle proves it can tell", () => {
  test("T-16.0 — VACUITY GUARD: the oracle reproduces the SHIPPED DEFECT's measurements", () => {
    // The exact host CSS at `fe76b973a`. The tester drove it in real Chromium
    // against the real shell and measured card tops of 772 / 844 / 928 px with
    // ZERO visible pixels, on viewports 664 / 727 / 800 px tall. If this oracle
    // cannot reproduce those numbers it is not measuring layout, and every
    // assertion built on it is decoration. This is the check that makes T-7.1
    // and T-16.1 falsifiable.
    const SHIPPED_DEFECT_CSS =
      "box-sizing:border-box;max-width:22rem;margin:15vh auto 0;padding:24px;" +
      "text-align:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

    const measured = VIEWPORTS.map((vp) => {
      const box = resolveCardBox(SHIPPED_DEFECT_CSS, vp, MEASURED_CARD_HEIGHT_PX);
      return { viewport: vp.label, top: box.top, visiblePx: box.visiblePx, outOfFlow: box.outOfFlow };
    });

    expect(measured).toEqual([
      { viewport: "iPhone 13", top: 772, visiblePx: 0, outOfFlow: false },
      { viewport: "Pixel 5", top: 844, visiblePx: 0, outOfFlow: false },
      { viewport: "desktop", top: 928, visiblePx: 0, outOfFlow: false },
    ]);
  });

  test("T-16.1 — the shipped card is viewport-anchored and centred, not laid out by #root", () => {
    const head = mount({ seed: suppressedSeed() });
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS);

    const css = head.card()?.style.cssText ?? "";
    // Taken out of the flow the empty `#root` owns...
    expect(css).toContain("position:fixed");
    // ...and centred on the viewport rather than offset from a flow position.
    expect(css).toContain("top:50%");
    expect(css).toContain("left:50%");
    expect(css).toContain("transform:translate(-50%,-50%)");
    // Bounded so a long translation can never overflow off-screen instead.
    expect(css).toContain("max-height:calc(100% - 32px)");
    expect(css).toContain("overflow:auto");
    // The stranding construction must be gone, not merely overridden.
    expect(css).not.toContain("margin:15vh");
  });

  test("T-16.2 — every viewport we ship to gets a card with real visible area", () => {
    const head = mount({ seed: suppressedSeed() });
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS);

    const css = head.card()?.style.cssText ?? "";
    for (const vp of VIEWPORTS) {
      const box = resolveCardBox(css, vp, MEASURED_CARD_HEIGHT_PX);
      // Centred: the top is exactly half the leftover height.
      expect([vp.label, box.top]).toEqual([vp.label, Math.round((vp.h - MEASURED_CARD_HEIGHT_PX) / 2)]);
      expect([vp.label, box.visiblePx > 0]).toEqual([vp.label, true]);
    }
  });
});

describe("#1876 T-17 — P1-1: a late-mounting app takes the card away again", () => {
  test("T-17.1 — a boot that commits AFTER the guard fires clears the card", () => {
    // The false positive that P0-1 would otherwise have made VISIBLE: at
    // 1501 ms the card appeared over a perfectly healthy app and never left.
    const head = mount({ seed: suppressedSeed() });
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS + 1);
    expect(head.card()).not.toBeNull(); // fired while #root was genuinely empty

    head.populateRoot(); // React commits, late but successfully
    jest.advanceTimersByTime(5_000);

    expect(head.card()).toBeNull();
  });

  test("T-17.2 — clearing it touches neither #root nor the URL", () => {
    const head = mount({ seed: suppressedSeed() });
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS + 1);
    head.populateRoot();
    jest.advanceTimersByTime(5_000);

    expect(head.root()?.childNodes).toHaveLength(1); // the app's own node, intact
    expect(head.reload).not.toHaveBeenCalled(); // removal is not a reload
    expect(head.navigations).toEqual([]);
    const body = head.doc.body;
    expect((body?.childNodes ?? []).map((n) => n.id)).toEqual(["root"]);
  });

  test("T-17.3 — without MutationObserver the bounded interval fallback still clears it", () => {
    const head = mount({ seed: suppressedSeed(), withoutMutationObserver: true });
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS + 1);
    expect(head.card()).not.toBeNull();

    head.populateRoot();
    jest.advanceTimersByTime(1_000); // the poll interval is 250 ms

    expect(head.card()).toBeNull();
  });

  test("T-17.4 — with neither, it fails safe: the card stays, nothing throws", () => {
    // A browser this old cannot observe anything. Leaving the card is the safe
    // side of the trade — the user still has a way out of a blank page.
    const head = mount({
      seed: suppressedSeed(),
      withoutMutationObserver: true,
      withoutTimers: true,
    });
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS + 1);

    expect(head.card()).not.toBeNull();
    expect(() => jest.advanceTimersByTime(10_000)).not.toThrow();
  });

  test("T-17.5 — the watcher stops once it has fired, and does not re-paint on its own", () => {
    const head = mount({ seed: suppressedSeed() });
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS + 1);
    head.populateRoot();
    jest.advanceTimersByTime(5_000);
    expect(head.card()).toBeNull();

    // The app is torn back down. Nothing has failed since, so nothing should
    // paint — the card is a response to a failure, not to an empty #root.
    head.clearRoot();
    jest.advanceTimersByTime(10_000);

    expect(head.card()).toBeNull();
  });
});

describe("#1876 T-18 — P2-1: the latch belongs to the card, not to the arm", () => {
  test("T-18.1 — a survivable failure does not disable the terminal UI forever", () => {
    // `bootErrorArmed` was set on ARM and never reset, so a suppressed LAZY
    // failure while React was alive (timer correctly renders nothing) burned the
    // one-shot latch — and a genuinely blank state later in the same document
    // got no card at all.
    //
    // Seeded with the FULL cooldown still to run (not `suppressedSeed()`, which
    // leaves 1 ms), because the second failure five seconds later must also be
    // suppressed — otherwise it reloads and never reaches the latch at all.
    const head = mount({ seed: { [SHARED_KEY]: String(Date.now()) } });

    head.populateRoot(); // React is up: this failure is survivable
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(5_000);
    expect(head.card()).toBeNull(); // correct — the app is on screen

    head.clearRoot(); // now the app really is gone
    head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(5_000);

    expect(head.card()).not.toBeNull(); // and the user gets their way out
  });

  test("T-18.2 — the arm is still de-duplicated while one timer is in flight", () => {
    // Fixing P2-1 must not reintroduce a timer per failure event.
    const head = mount({ seed: suppressedSeed() });

    for (let i = 0; i < 25; i += 1) head.fireResourceError(CHUNK_URL);
    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS * 4);

    const cards = (head.doc.body?.childNodes ?? []).filter((n) => n.id === BOOT_ERROR_ID);
    expect(cards).toHaveLength(1);
    expect(head.reload).not.toHaveBeenCalled();
  });

  test("T-18.3 — the pending flag is what changed, and the card latch is intact", () => {
    expect(SCRIPT_TAG).toContain("bootErrorPending");
    expect(SCRIPT_TAG).not.toContain("bootErrorArmed");
    // "one card, ever" was always this check, and it stays.
    expect(SCRIPT_TAG).toContain("if(doc.getElementById(BOOT_ERROR_ID)){return}");
  });
});
