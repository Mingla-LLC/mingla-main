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
  onclick: null | (() => void);
  setAttribute: (name: string, value: string) => void;
  appendChild: (child: FakeNode) => FakeNode;
};

function makeNode(tagName: string): FakeNode {
  const node: FakeNode = {
    tagName,
    id: "",
    type: "",
    textContent: "",
    style: { cssText: "" },
    attributes: {},
    childNodes: [],
    onclick: null,
    setAttribute: (name, value) => {
      node.attributes[name] = value;
    },
    appendChild: (child) => {
      node.childNodes.push(child);
      return child;
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
};

type Harness = {
  doc: FakeDocument;
  reload: jest.Mock;
  navigations: string[];
  fireResourceError: (src: string) => void;
  card: () => FakeNode | null;
  root: () => FakeNode | null;
  mountRoot: () => void;
  populateRoot: () => void;
};

const CHECKOUT_URL = "https://business.usemingla.com/checkout/48db05a9-2b78";
const realWindow = (global as unknown as { window?: unknown }).window;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(1_700_000_000_000);
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
  };
}

/** Puts the shared cooldown record inside its window, so the next failure is suppressed. */
const suppressedSeed = (): Record<string, string> => ({
  [SHARED_KEY]: String(Date.now() - (COOLDOWN_MS - 1)),
});

// ---------------------------------------------------------------------------

describe("#1876 T-7 — a suppressed failure with an empty #root shows the card", () => {
  test("T-7.1 — SC-8: #mingla-boot-error is rendered after the 1500 ms guard", () => {
    const head = mount({ seed: suppressedSeed() });

    head.fireResourceError(CHUNK_URL);
    expect(head.reload).not.toHaveBeenCalled(); // suppressed, as designed
    expect(head.card()).toBeNull(); // nothing yet — the guard has not fired

    jest.advanceTimersByTime(BOOT_ERROR_DELAY_MS);

    expect(head.card()).not.toBeNull();
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
