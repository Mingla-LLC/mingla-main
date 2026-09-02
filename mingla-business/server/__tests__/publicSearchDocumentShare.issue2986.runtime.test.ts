import { describe, expect, it, jest } from "@jest/globals";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const publicSearch = require("../publicSearchDocument") as {
  browserRuntimeScript: (canonicalUrl: string) => string;
};

const CANONICAL = "https://host.usemingla.com/e/acme/summer-night";

type Listener = () => unknown;

const fakeElement = () => ({
  textContent: "",
  hidden: false,
  disabled: false,
  value: "",
  src: "",
  type: "",
  defer: false,
  dataset: {} as Record<string, string>,
  attributes: new Map<string, string>(),
  listeners: new Map<string, Listener>(),
  select: jest.fn(),
  setAttribute(name: string, value: string) { this.attributes.set(name, value); },
  addEventListener(name: string, listener: Listener) { this.listeners.set(name, listener); },
});

type MountOptions = {
  share?: jest.Mock;
  writeText?: jest.Mock;
  fetchImpl?: jest.Mock;
};

const mountRuntime = ({ share, writeText, fetchImpl }: MountOptions = {}) => {
  const elements = {
    "mingla-share": fakeElement(),
    "mingla-share-status": fakeElement(),
    "mingla-share-fallback": fakeElement(),
    "mingla-share-fallback-input": fakeElement(),
    "mingla-runtime-status": fakeElement(),
  };
  elements["mingla-share-fallback"].hidden = true;
  elements["mingla-share-fallback-input"].value = CANONICAL;
  const appended: unknown[] = [];
  const documentHarness = {
    title: "Truthful event | Mingla",
    getElementById: (id: keyof typeof elements) => elements[id] ?? null,
    querySelector: jest.fn(() => null),
    createElement: jest.fn(() => fakeElement()),
    body: { appendChild: jest.fn((element: unknown) => appended.push(element)) },
  };
  const navigatorHarness = {
    ...(share ? { share } : {}),
    ...(writeText ? { clipboard: { writeText } } : {}),
  };
  const effectiveFetch = fetchImpl ?? jest.fn<() => Promise<unknown>>().mockResolvedValue({ ok: false, text: async () => "" });
  const DOMParserHarness = class {
    parseFromString() { return { querySelectorAll: () => [] }; }
  };

  const execute = new Function("document", "navigator", "fetch", "DOMParser", publicSearch.browserRuntimeScript(CANONICAL));
  execute(documentHarness, navigatorHarness, effectiveFetch, DOMParserHarness);

  return {
    elements,
    appended,
    fetch: effectiveFetch,
    click: () => elements["mingla-share"].listeners.get("click")?.(),
  };
};

const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("#2986 exact browser Share runtime", () => {
  it("shows immediate progress, then native-share success", async () => {
    const pending = deferred();
    const share = jest.fn(() => pending.promise);
    const harness = mountRuntime({ share });

    const completion = harness.click() as Promise<void>;
    expect(harness.elements["mingla-share-status"].textContent).toBe("Opening sharing options…");
    expect(harness.elements["mingla-share"].disabled).toBe(true);
    expect(harness.elements["mingla-share"].attributes.get("aria-busy")).toBe("true");
    pending.resolve();
    await completion;

    expect(share).toHaveBeenCalledWith({ title: "Truthful event | Mingla", url: CANONICAL });
    expect(harness.elements["mingla-share-status"].textContent).toBe("Shared successfully.");
    expect(harness.elements["mingla-share-fallback"].hidden).toBe(true);
    expect(harness.elements["mingla-share"].disabled).toBe(false);
  });

  it.each([
    ["cancel", Object.assign(new Error("cancel"), { name: "AbortError" }), "Share cancelled."],
    ["failure", new Error("provider down"), "Sharing failed."],
  ])("distinguishes native-share %s and reveals the canonical fallback", async (_case, error, expected) => {
    const share = jest.fn<() => Promise<void>>().mockRejectedValue(error);
    const harness = mountRuntime({ share });
    await harness.click();

    expect(harness.elements["mingla-share-status"].textContent).toContain(expected);
    expect(harness.elements["mingla-share-fallback"].hidden).toBe(false);
    expect(harness.elements["mingla-share-fallback-input"].value).toBe(CANONICAL);
  });

  it("reports clipboard success after immediate copy progress", async () => {
    const pending = deferred();
    const writeText = jest.fn(() => pending.promise);
    const harness = mountRuntime({ writeText });
    const completion = harness.click() as Promise<void>;

    expect(harness.elements["mingla-share-status"].textContent).toBe("Copying link…");
    pending.resolve();
    await completion;
    expect(writeText).toHaveBeenCalledWith(CANONICAL);
    expect(harness.elements["mingla-share-status"].textContent).toBe("Link copied.");
    expect(harness.elements["mingla-share-fallback"].hidden).toBe(true);
  });

  it("reports clipboard failure and leaves a selectable canonical fallback", async () => {
    const harness = mountRuntime({
      writeText: jest.fn<() => Promise<void>>().mockRejectedValue(new Error("clipboard denied")),
    });
    await harness.click();

    expect(harness.elements["mingla-share-status"].textContent).toContain("Could not copy automatically.");
    expect(harness.elements["mingla-share-fallback"].hidden).toBe(false);
    harness.elements["mingla-share-fallback-input"].listeners.get("focus")?.();
    expect(harness.elements["mingla-share-fallback-input"].select).toHaveBeenCalledTimes(1);
  });

  it("handles browsers with neither API without a dead tap", async () => {
    const harness = mountRuntime();
    await harness.click();
    expect(harness.elements["mingla-share-status"].textContent).toContain("Sharing is not available here.");
    expect(harness.elements["mingla-share-fallback"].hidden).toBe(false);
    expect(harness.elements["mingla-share"].disabled).toBe(false);
  });

  it.each([
    ["network rejection", jest.fn<() => Promise<unknown>>().mockRejectedValue(new Error("offline"))],
    ["HTTP rejection", jest.fn<() => Promise<unknown>>().mockResolvedValue({ ok: false, text: async () => "" })],
  ])("makes bootstrap %s visible while preserving the document", async (_case, fetchImpl) => {
    const harness = mountRuntime({ fetchImpl });
    await settle();
    expect(harness.elements["mingla-runtime-status"].textContent).toBe(
      "Interactive features could not load. This page and its links still work.",
    );
  });
});
