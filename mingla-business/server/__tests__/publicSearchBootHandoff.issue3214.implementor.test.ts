import { describe, expect, it, jest } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

// #3214 — the public-page handoff to the Expo app, driven through the exact
// inline script the server document ships. The real-browser proof that loses
// the download race on purpose lives in
// playwright/issue3214-public-boot-order.spec.ts; this suite pins the same
// contract inside the required jest gate so a revert is caught on every PR.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const runtime = require("../publicSearchBrowserRuntime") as {
  BOOT_MOUNT_DEADLINE_MS: number;
  browserRuntimeScript: (canonicalUrl: string) => string;
};

const CANONICAL = "https://host.usemingla.com/b/lanternroom";
const ORIGIN = "https://host.usemingla.com";
const CHUNKS = [
  `${ORIGIN}/_expo/static/js/web/__expo-metro-runtime-aaa.js`,
  `${ORIGIN}/_expo/static/js/web/__common-bbb.js`,
  `${ORIGIN}/_expo/static/js/web/index-ccc.js`,
];
const EXPO_RESET = "html,body{height:100%}body{overflow:hidden}#root{display:flex;height:100%;flex:1}";
const NO_BLUR = "@media (max-width: 767px){*{backdrop-filter:none!important}}";
const FAILURE_COPY = "Interactive features could not load. This page and its links still work.";

type Listener = (event?: unknown) => unknown;

type FakeNode = {
  tag: string;
  id: string;
  src: string;
  type: string;
  media: string;
  async?: boolean;
  defer?: boolean;
  textContent: string;
  hidden: boolean;
  disabled: boolean;
  value: string;
  isConnected: boolean;
  parentNode: { removeChild: (node: FakeNode) => void } | null;
  firstElementChild: FakeNode | null;
  children: FakeNode[];
  appendChild: (child: FakeNode) => void;
  removeChild: (child: FakeNode) => void;
  dataset: Record<string, string>;
  attributes: Map<string, string>;
  listeners: Map<string, Listener[]>;
  select: jest.Mock;
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  addEventListener: (name: string, listener: Listener) => void;
  fire: (name: string, event?: unknown) => void;
};

const node = (tag: string, id = ""): FakeNode => {
  const created: FakeNode = {
    tag,
    id,
    src: "",
    type: "",
    media: "",
    textContent: "",
    hidden: false,
    disabled: false,
    value: "",
    isConnected: true,
    parentNode: null,
    get firstElementChild() { return this.children[0] ?? null; },
    children: [],
    appendChild(child) {
      this.children.push(child);
      child.parentNode = this;
      child.isConnected = true;
    },
    removeChild(child) {
      this.children.splice(this.children.indexOf(child), 1);
      child.parentNode = null;
      child.isConnected = false;
    },
    dataset: {},
    attributes: new Map(),
    listeners: new Map(),
    select: jest.fn(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    addEventListener(name, listener) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
    },
    fire(name, event) { (this.listeners.get(name) ?? []).forEach((listener) => listener(event)); },
  };
  return created;
};

type MountOptions = {
  consent?: string | null;
  preboot?: string;
  styles?: Array<{ id: string; media?: string; css: string }>;
  fetchImpl?: () => Promise<unknown>;
};

const mount = ({ consent = JSON.stringify({ choice: "granted", ts: 1 }), preboot, styles, fetchImpl }: MountOptions = {}) => {
  const elements: Record<string, FakeNode> = {
    "mingla-share": node("button", "mingla-share"),
    "mingla-share-status": node("p", "mingla-share-status"),
    "mingla-share-fallback": node("div", "mingla-share-fallback"),
    "mingla-share-fallback-input": node("input", "mingla-share-fallback-input"),
    "mingla-runtime-status": node("p", "mingla-runtime-status"),
    root: node("div", "root"),
    "mingla-public-document-style": node("style", "mingla-public-document-style"),
  };
  const shell = node("main");
  elements.root.appendChild(shell);
  const serverStyle = elements["mingla-public-document-style"];
  const headChildren: FakeNode[] = [serverStyle];
  const appended: FakeNode[] = [];
  const head = {
    get firstChild() { return headChildren[0] ?? null; },
    insertBefore(child: FakeNode, anchor: FakeNode | null) {
      const at = anchor ? headChildren.indexOf(anchor) : headChildren.length;
      headChildren.splice(at < 0 ? headChildren.length : at, 0, child);
      child.parentNode = head;
      child.isConnected = true;
    },
    appendChild(child: FakeNode) { head.insertBefore(child, null); },
    removeChild(child: FakeNode) {
      headChildren.splice(headChildren.indexOf(child), 1);
      child.parentNode = null;
      child.isConnected = false;
    },
  };
  serverStyle.parentNode = head;
  const documentHarness = {
    title: "Lantern Room | Mingla",
    head,
    body: { appendChild: (child: FakeNode) => { appended.push(child); } },
    documentElement: {},
    getElementById: (id: string) => elements[id] ?? null,
    querySelector: (selector: string) => {
      const expo = /data-mingla-expo="([^"]+)"/.exec(selector);
      if (expo) return appended.find((child) => child.dataset.minglaExpo === expo[1]) ?? null;
      const style = /data-mingla-expo-style="([^"]+)"/.exec(selector);
      if (style) return headChildren.find((child) => child.getAttribute("data-mingla-expo-style") === style[1]) ?? null;
      return null;
    },
    createElement: (tag: string) => node(tag),
  };
  const windowListeners = new Map<string, Listener[]>();
  const windowHarness = {
    __minglaPrebootConsentChoice: preboot,
    localStorage: { getItem: (key: string) => (key === "mingla_consent_v1" ? consent : null) },
    addEventListener(name: string, listener: Listener) {
      windowListeners.set(name, [...(windowListeners.get(name) ?? []), listener]);
    },
  };
  const beacons: Array<Record<string, unknown>> = [];
  const navigatorHarness = {
    sendBeacon: jest.fn((url: string, body: string) => {
      expect(url).toBe("/api/public-boot-outcome");
      beacons.push(JSON.parse(body) as Record<string, unknown>);
      return true;
    }),
  };
  let observerCallback: (() => void) | null = null;
  const observed: unknown[] = [];
  class FakeMutationObserver {
    constructor(callback: () => void) { observerCallback = callback; }
    observe(target: unknown, options: unknown) { observed.push({ target, options }); }
    disconnect() { observerCallback = null; }
  }
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let nextTimer = 1;
  const setTimeoutHarness = (callback: () => void, delay: number) => {
    const id = nextTimer++;
    timers.set(id, { callback, delay });
    return id;
  };
  const clearTimeoutHarness = (id: number) => { timers.delete(id); };
  const indexStyles = (styles ?? [{ id: "expo-reset", css: EXPO_RESET }, { id: "mingla-mobile-web-no-blur", css: NO_BLUR }])
    .map((style) => ({ id: style.id, media: style.media ?? "", textContent: style.css }));
  const DOMParserHarness = class {
    parseFromString() {
      return {
        querySelectorAll: (selector: string) => {
          if (selector === "script[src]") return CHUNKS.map((src) => ({ src, type: "" }));
          if (selector === "head style") return indexStyles;
          return [];
        },
      };
    }
  };
  const effectiveFetch = fetchImpl ?? (async () => ({ ok: true, text: async () => "<html>index</html>" }));

  const execute = new Function(
    "document", "navigator", "fetch", "DOMParser", "window", "MutationObserver", "setTimeout", "clearTimeout",
    runtime.browserRuntimeScript(CANONICAL),
  );
  execute(documentHarness, navigatorHarness, effectiveFetch, DOMParserHarness, windowHarness, FakeMutationObserver, setTimeoutHarness, clearTimeoutHarness);

  return {
    elements,
    shell,
    serverStyle,
    headChildren,
    appended,
    beacons,
    observed,
    timers,
    status: () => elements["mingla-runtime-status"].textContent,
    loadAll: () => appended.forEach((chunk) => chunk.fire("load")),
    // React's first successful commit: clear the container, insert the tree.
    takeOver: () => {
      elements.root.children.slice().forEach((child) => elements.root.removeChild(child));
      elements.root.appendChild(node("div", "app-tree"));
      observerCallback?.();
    },
    // React 19 after an uncaught render error: an EMPTY committed root.
    crashCommit: () => {
      elements.root.children.slice().forEach((child) => elements.root.removeChild(child));
      observerCallback?.();
    },
    windowEvent: (name: string, event: unknown) => (windowListeners.get(name) ?? []).forEach((listener) => listener(event)),
    runTimers: () => {
      const due = [...timers.entries()];
      due.forEach(([id, timer]) => {
        timers.delete(id);
        timer.callback();
      });
    },
  };
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("#3214 injected Expo chunks execute in index.html order", () => {
  it("inserts runtime, __common, index in that order, each in the ordered list (async=false, no inert defer)", async () => {
    const page = mount();
    await settle();
    expect(page.appended.map((chunk) => chunk.src)).toEqual(CHUNKS);
    for (const chunk of page.appended) {
      expect(chunk.tag).toBe("script");
      expect(chunk.async).toBe(false);
      expect(chunk.defer).not.toBe(true);
      expect(chunk.dataset.minglaExpo).toBe(chunk.src);
      expect(chunk.listeners.get("error")).toHaveLength(1);
      expect(chunk.listeners.get("load")).toHaveLength(1);
    }
    expect(page.status()).toBe("");
  });
});

describe("#3214 takeover applies index.html styles only when the app has committed", () => {
  it("keeps the plain page's own styles, and adds none, until the server shell leaves the document", async () => {
    const page = mount();
    await settle();
    page.loadAll();
    expect(page.headChildren.map((child) => child.id)).toEqual(["mingla-public-document-style"]);
    expect(page.observed).toEqual([{ target: page.elements.root, options: { childList: true } }]);

    page.takeOver();
    expect(page.serverStyle.isConnected).toBe(false);
    expect(page.headChildren.map((child) => child.id)).toEqual(["expo-reset", "mingla-mobile-web-no-blur"]);
    expect(page.headChildren[0].textContent).toBe(EXPO_RESET);
    expect(page.headChildren[0].getAttribute("data-mingla-expo-style")).toBe("expo-reset");
    expect(page.status()).toBe("");
    expect(page.timers.size).toBe(0);
    expect(page.beacons).toEqual([
      expect.objectContaining({ outcome: "success", reason: "mounted", path: "/b/lanternroom" }),
    ]);
  });

  it("is idempotent and places index.html styles ahead of anything the app already injected", async () => {
    const page = mount({ styles: [{ id: "", css: "body{margin:0}" }, { id: "expo-reset", media: "screen", css: EXPO_RESET }] });
    await settle();
    const appSheet = { ...page.serverStyle, id: "react-native-stylesheet" } as FakeNode;
    page.headChildren.push(appSheet);
    page.takeOver();
    page.takeOver();
    expect(page.headChildren.map((child) => child.getAttribute("data-mingla-expo-style") ?? child.id))
      .toEqual(["index-style-0", "expo-reset", "react-native-stylesheet"]);
    expect(page.headChildren[1].media).toBe("screen");
    expect(page.beacons).toHaveLength(1);
  });
});

describe("#3214 a boot failure is visible and measured, never silent", () => {
  it("a chunk that fails to load shows the failure and leaves the plain page's styles alone", async () => {
    const page = mount();
    await settle();
    page.appended[1].fire("error");
    expect(page.status()).toBe(FAILURE_COPY);
    expect(page.headChildren.map((child) => child.id)).toEqual(["mingla-public-document-style"]);
    expect(page.beacons).toEqual([expect.objectContaining({ outcome: "failure", reason: "chunk_load_error" })]);
    page.appended[2].fire("load");
    expect(page.timers.size).toBe(0);
  });

  it("an uncaught error from an injected chunk before takeover is a failure; one from elsewhere is not", async () => {
    const page = mount();
    await settle();
    page.windowEvent("error", { filename: `${ORIGIN}/some-other-script.js` });
    expect(page.status()).toBe("");
    page.windowEvent("error", { filename: CHUNKS[2] });
    expect(page.status()).toBe(FAILURE_COPY);
    expect(page.beacons).toEqual([expect.objectContaining({ outcome: "failure", reason: "chunk_execution_error" })]);
  });

  it("an unhandled rejection whose stack names an injected chunk is a failure", async () => {
    const page = mount();
    await settle();
    page.windowEvent("unhandledrejection", { reason: { stack: `Error: boom\n    at ${CHUNKS[1]}:1:10` } });
    expect(page.beacons).toEqual([expect.objectContaining({ outcome: "failure", reason: "chunk_rejection" })]);
  });

  it("an empty commit (React tearing down after a render error) is not a takeover; the plain page comes back with its message", async () => {
    const page = mount();
    await settle();
    page.appended[1].fire("error");
    expect(page.status()).toBe(FAILURE_COPY);
    page.crashCommit();
    expect(page.shell.isConnected).toBe(true);
    expect(page.elements.root.children).toEqual([page.shell]);
    expect(page.status()).toBe(FAILURE_COPY);
    expect(page.headChildren.map((child) => child.id)).toEqual(["mingla-public-document-style"]);
    expect(page.beacons.map((beacon) => `${beacon.outcome}:${beacon.reason}`)).toEqual(["failure:chunk_load_error"]);
  });

  it("an empty commit BEFORE any failure waits; the deadline then restores the plain page", async () => {
    const page = mount();
    await settle();
    page.loadAll();
    page.crashCommit();
    expect(page.shell.isConnected).toBe(false);
    expect(page.beacons).toEqual([]);
    page.runTimers();
    expect(page.shell.isConnected).toBe(true);
    expect(page.status()).toBe(FAILURE_COPY);
    expect(page.beacons.map((beacon) => `${beacon.outcome}:${beacon.reason}`)).toEqual(["failure:mount_timeout"]);
  });

  it("an app that takes over and then unmounts (React 19 after a render error) gives the plain page back, visibly", async () => {
    const page = mount();
    await settle();
    page.loadAll();
    page.takeOver();
    expect(page.headChildren.map((child) => child.id)).toEqual(["expo-reset", "mingla-mobile-web-no-blur"]);
    page.crashCommit();
    expect(page.shell.isConnected).toBe(true);
    expect(page.elements.root.children).toEqual([page.shell]);
    expect(page.headChildren.map((child) => child.id)).toEqual(["mingla-public-document-style"]);
    expect(page.status()).toBe(FAILURE_COPY);
    expect(page.beacons.map((beacon) => `${beacon.outcome}:${beacon.reason}`)).toEqual(["success:mounted", "failure:app_unmounted"]);
  });

  it("errors after takeover belong to the app, not the handoff", async () => {
    const page = mount();
    await settle();
    page.takeOver();
    page.windowEvent("error", { filename: CHUNKS[2] });
    expect(page.status()).toBe("");
    expect(page.beacons.map((beacon) => beacon.outcome)).toEqual(["success"]);
  });

  it("arms the deadline only after the LAST chunk has executed, so download time is never inside it", async () => {
    const page = mount();
    await settle();
    page.appended[0].fire("load");
    page.appended[1].fire("load");
    expect(page.timers.size).toBe(0);
    page.appended[2].fire("load");
    expect([...page.timers.values()].map((timer) => timer.delay)).toEqual([runtime.BOOT_MOUNT_DEADLINE_MS]);
    page.runTimers();
    expect(page.status()).toBe(FAILURE_COPY);
    expect(page.beacons).toEqual([expect.objectContaining({ outcome: "failure", reason: "mount_timeout" })]);
  });

  it("a late takeover after a reported failure is recorded as late_mount and still gets its styles", async () => {
    const page = mount();
    await settle();
    page.loadAll();
    page.runTimers();
    page.takeOver();
    expect(page.headChildren.map((child) => child.id)).toEqual(["expo-reset", "mingla-mobile-web-no-blur"]);
    expect(page.beacons.map((beacon) => `${beacon.outcome}:${beacon.reason}`)).toEqual(["failure:mount_timeout", "success:late_mount"]);
  });

  it.each([
    ["an HTTP failure", async () => ({ ok: false, text: async () => "" }), "bootstrap_http"],
    ["a network failure", async () => { throw new TypeError("Failed to fetch"); }, "bootstrap_network"],
  ])("reports %s of /index.html with its reason", async (_case, fetchImpl, reason) => {
    const page = mount({ fetchImpl });
    await settle();
    expect(page.status()).toBe(FAILURE_COPY);
    expect(page.beacons).toEqual([expect.objectContaining({ outcome: "failure", reason })]);
  });
});

describe("#3214 the boot-outcome beacon honours the app's consent reading", () => {
  it.each([
    ["no stored choice", { consent: null }],
    ["a stored denial", { consent: JSON.stringify({ choice: "denied", ts: 1 }) }],
    ["an unreadable record", { consent: "not-json" }],
    ["a preboot denial over a stored grant", { preboot: "denied" }],
  ])("sends nothing with %s", async (_case, options) => {
    const page = mount(options);
    await settle();
    page.takeOver();
    expect(page.beacons).toEqual([]);
  });

  it("sends a bounded, entity-free payload with a preboot grant", async () => {
    const page = mount({ consent: null, preboot: "granted" });
    await settle();
    page.takeOver();
    expect(page.beacons).toHaveLength(1);
    const [beacon] = page.beacons;
    expect(Object.keys(beacon).sort()).toEqual(["elapsed_ms", "load_id", "outcome", "path", "reason"]);
    expect(beacon.load_id).toMatch(/^[0-9a-z]{8,32}$/);
    expect(Number.isSafeInteger(beacon.elapsed_ms)).toBe(true);
  });
});

describe("#3214 the server document can be neutralised at takeover", () => {
  it("names its own style element so takeover can remove exactly it", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { renderVisibleDocument } = require("../publicSearchDocument") as {
      renderVisibleDocument: (input: unknown) => string;
    };
    const html = renderVisibleDocument({
      facts: { kind: "brand", id: "b1", title: "Lantern Room", brandName: "Lantern Room" },
      state: "search_ready",
      canonicalPath: "/b/lanternroom",
    });
    expect(html.match(/<style id="mingla-public-document-style">/g)).toHaveLength(1);
    expect(html).toMatch(/<div id="root">\s*<main class="shell">/);
  });
});

describe("#3214 the real-browser race proof stays routed into CI", () => {
  const root = path.resolve(__dirname, "../..");
  const SPEC = "issue3214-public-boot-order.spec.ts";

  it("the web-build lane's #2771 Playwright config collects the #3214 spec", () => {
    const config = fs.readFileSync(path.join(root, "playwright.issue2771.config.ts"), "utf8");
    const match = /testMatch:\s*\/(.+)\/,?\s*$/m.exec(config);
    expect(match).not.toBeNull();
    expect(new RegExp(match?.[1] ?? "^$").test(`playwright/${SPEC}`)).toBe(true);
    expect(/testDir:\s*['"]\.\/playwright['"]/.test(config)).toBe(true);
    expect(fs.existsSync(path.join(root, "playwright", SPEC))).toBe(true);
  });

  it("the web-build lane still runs that config against the export it builds", () => {
    // Named by join, never by a literal workflow filename (a literal in a
    // tracked file enrols it as a CI provider reference).
    const workflow = fs.readFileSync(
      path.join(root, "..", ".github", "workflows", ["web-build-check", "yml"].join(".")),
      "utf8",
    );
    expect(workflow).toContain("npx expo export -p web --clear --output-dir dist");
    expect(workflow).toContain("npx playwright test -c playwright.issue2771.config.ts");
  });
});
