// @vitest-environment jsdom
/*
 * #4453 website workspace (build contract D) — the preview bridge, PROVEN BY
 * RUNNING IT in a real document: every message in both directions, who it
 * listens to and who it refuses, edit mode (a click picks a section and
 * nothing on the page acts), the keyboard, the marks it draws, the text swap,
 * the throttle, and the Host app's WebView.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHIP_ATTRIBUTE,
  MARK_ATTRIBUTE,
  OVERLAY_ATTRIBUTE,
  PROXY_ATTRIBUTE,
  SECTION_ATTRIBUTE,
  startPreviewBridge,
  type PreviewBridgeOptions,
} from "./previewBridge";
import { parsePreviewParentMessage, PREVIEW_CHIP_TEXT, PREVIEW_MAX_TEXT } from "./previewBridgeProtocol";

const HOST = "https://host.usemingla.com";
const STUDIO = "https://studio.sites.usemingla.com";
const VERCEL = "https://mingla-business-git-4453-abc.vercel.app";
const A = "aaaaaaaaaaaaaaaaaaaaaaa1";
const B = "bbbbbbbbbbbbbbbbbbbbbbb2";
const C = "ccccccccccccccccccccccc3";
const SECTIONS = [{ id: A, type: "hero" }, { id: B, type: "offering_grid" }, { id: C, type: "faq" }];

type Rect = { top: number; left: number; width: number; height: number };
const rects = new Map<string, Rect>();
let scroll = 0;
let parent: { postMessage: ReturnType<typeof vi.fn> };
let stop: (() => void) | null = null;

/** The page as the server writes it: one boundary per block; the second block drew nothing; the third drew two elements. */
function page(): void {
  document.body.innerHTML = `
    <div data-preview="1" data-page="home">
      <p class="preview-banner" role="status">Private preview</p>
      <div id="mg-scope">
        <header id="site-header"><a id="nav-link" href="#elsewhere">About</a></header>
        <main id="main"><!--$--><section id="hero"><h1 id="hero-title">Wake up over the bay.</h1><p id="hero-sub">Wake up</p><a id="hero-link" href="#book">Book a stay</a><form id="hero-form" action="#search"><input id="hero-input" name="q"><button id="hero-submit" type="submit">Search</button></form><script>var x = "Wake up";</script></section><!--/$--><!--$--><!--/$--><!--$--><section id="faq"><h2 id="faq-title">Before you come</h2><!--$--><p id="faq-answer">A longtail from the pier.</p><!--/$--></section><aside id="faq-aside"><span id="faq-more">More</span></aside><!--/$--></main>
        <footer id="site-footer"><a id="footer-link" href="#legal">Legal</a></footer>
      </div>
    </div>`;
  rects.clear();
  rects.set("site-header", { top: 0, left: 0, width: 1000, height: 80 });
  rects.set("hero", { top: 80, left: 0, width: 1000, height: 600 });
  rects.set("faq", { top: 680, left: 40, width: 920, height: 300 });
  rects.set("faq-aside", { top: 980, left: 40, width: 400, height: 120 });
  rects.set("site-footer", { top: 1100, left: 0, width: 1000, height: 200 });
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const setScroll = (y: number): void => {
  scroll = y;
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
};
const frames = (): void => { vi.advanceTimersByTime(100); };
const start = (options: Partial<PreviewBridgeOptions> = {}): void => {
  stop = startPreviewBridge({ localMode: false, pagePath: "", sections: SECTIONS, ...options });
};
const ready = (options: Partial<PreviewBridgeOptions> = {}): void => { start(options); frames(); };
const sent = (type: string) => parent.postMessage.mock.calls.filter(([message]) => (message as { type: string }).type === type);
const lastSent = (type: string) => sent(type).at(-1)?.[0] as Record<string, unknown> | undefined;

function fromParent(data: unknown, origin = HOST, source: unknown = parent): void {
  const event = new MessageEvent("message", { data, origin });
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
}
function click(target: Element, init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, clientX: 500, clientY: 300, ...init });
  target.dispatchEvent(event);
  return event;
}
const overlay = (): HTMLElement | null => document.querySelector(`[${OVERLAY_ATTRIBUTE}]`);
const mark = (id: string): HTMLElement | null => document.querySelector(`[${MARK_ATTRIBUTE}="${id}"]`);
const chip = (id: string): string | null => mark(id)?.querySelector(`[${CHIP_ATTRIBUTE}]`)?.textContent ?? null;
const buttons = (): HTMLButtonElement[] => Array.from(document.querySelectorAll<HTMLButtonElement>(`[${PROXY_ATTRIBUTE}]`));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout"] });
  page();
  setScroll(0);
  parent = { postMessage: vi.fn() };
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
  Object.defineProperty(document.documentElement, "scrollHeight", { value: 1300, configurable: true });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const rect = rects.get(this.id) ?? { top: scroll, left: 0, width: 0, height: 0 };
    const top = rect.top - scroll;
    return { top, left: rect.left, width: rect.width, height: rect.height, bottom: top + rect.height, right: rect.left + rect.width, x: rect.left, y: top, toJSON: () => ({}) } as DOMRect;
  });
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(window, "parent", { value: window, configurable: true });
  delete (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  document.documentElement.removeAttribute("style");
  document.body.innerHTML = "";
});

describe("#4453 D frame → parent: mingla:preview-ready", () => {
  it("says which page, and where each section that drew something is (document pixels)", () => {
    setScroll(120);
    ready({ pagePath: "about/team" });
    expect(sent("mingla:preview-ready")).toHaveLength(2);
    expect(lastSent("mingla:preview-ready")).toEqual({
      type: "mingla:preview-ready",
      page_path: "about/team",
      // The second block drew nothing, so it is not listed; the third is the union of its two elements.
      sections: [{ id: A, type: "hero", top: 80, height: 600 }, { id: C, type: "faq", top: 680, height: 420 }],
      scroll_y: 120,
      doc_height: 1300,
    });
  });

  it("is offered only to origins that may frame the preview, never to '*'", () => {
    ready();
    expect(parent.postMessage.mock.calls.map(([, origin]) => origin)).toEqual([HOST, STUDIO]);
    expect(parent.postMessage.mock.calls.some(([, origin]) => origin === "*" || origin === undefined)).toBe(false);
  });

  it("a section is findable in the page by its id once the page is ready (and not before React is done with it)", () => {
    start();
    expect(document.querySelector(`[${SECTION_ATTRIBUTE}]`)).toBeNull();
    frames();
    expect(document.querySelectorAll(`[${SECTION_ATTRIBUTE}="${A}"]`)).toHaveLength(1);
    expect(document.querySelector(`[${SECTION_ATTRIBUTE}="${A}"]`)).toBe($("hero"));
    expect(Array.from(document.querySelectorAll(`[${SECTION_ATTRIBUTE}="${C}"]`))).toEqual([$("faq"), $("faq-aside")]);
    expect(document.querySelector(`[${SECTION_ATTRIBUTE}="${B}"]`)).toBeNull();
    // Nothing else on the page is touched: no class, no style, no wrapper.
    expect($("hero").getAttribute("style")).toBeNull();
    expect($("hero").className).toBe("");
    expect($("main").children).toHaveLength(3);
  });

  it("a section Studio gave no id for is drawn but not selectable or listed", () => {
    ready({ sections: [{ id: "", type: "hero" }, { id: B, type: "offering_grid" }, { id: C, type: "faq" }] });
    expect((lastSent("mingla:preview-ready")!.sections as unknown[])).toEqual([{ id: C, type: "faq", top: 680, height: 420 }]);
    expect($("hero").hasAttribute(SECTION_ATTRIBUTE)).toBe(false);
  });

  it("marks NOTHING when the page's sections do not line up with the list", () => {
    ready({ sections: SECTIONS.slice(0, 2) });
    expect(lastSent("mingla:preview-ready")!.sections).toEqual([]);
    expect(document.querySelector(`[${SECTION_ATTRIBUTE}]`)).toBeNull();
  });

  it("a page with no sections (an offering page) still answers", () => {
    ready({ pagePath: "trips/rome", sections: [] });
    expect(lastSent("mingla:preview-ready")).toEqual({ type: "mingla:preview-ready", page_path: "trips/rome", sections: [], scroll_y: 0, doc_height: 1300 });
  });

  it("when the browser did not name the parent, a parent that speaks later gets 'ready' then", () => {
    ready();
    parent.postMessage.mockClear();
    fromParent({ type: "mingla:preview-mode", edit: false }, VERCEL);
    expect(parent.postMessage.mock.calls).toHaveLength(1);
    expect(parent.postMessage.mock.calls[0]![1]).toBe(VERCEL);
    expect((parent.postMessage.mock.calls[0]![0] as { type: string }).type).toBe("mingla:preview-ready");
    // From then on everything goes to that one origin.
    parent.postMessage.mockClear();
    fromParent({ type: "mingla:preview-mode", edit: true }, VERCEL);
    click($("hero-title"));
    expect(parent.postMessage.mock.calls.map(([, origin]) => origin)).toEqual([VERCEL]);
  });

  it("the Business preview deployment named in ?fa= is offered the first 'ready' too", () => {
    window.history.replaceState(null, "", `/preview?k=x&fa=${encodeURIComponent(VERCEL)}`);
    ready();
    expect(parent.postMessage.mock.calls.map(([, origin]) => origin)).toEqual([HOST, STUDIO, VERCEL]);
    window.history.replaceState(null, "", "/preview?k=x&fa=https%3A%2F%2Fevil.example");
    stop!();
    parent.postMessage.mockClear();
    ready();
    expect(parent.postMessage.mock.calls.map(([, origin]) => origin)).toEqual([HOST, STUDIO]);
    window.history.replaceState(null, "", "/");
  });

  it("opened on its own (no parent, no app) it sends nothing and listens to no one", () => {
    Object.defineProperty(window, "parent", { value: window, configurable: true });
    ready();
    expect(parent.postMessage).not.toHaveBeenCalled();
    fromParent({ type: "mingla:preview-mode", edit: true }, HOST, window);
    expect(click($("hero-link")).defaultPrevented).toBe(false);
  });
});

describe("#4453 D who the preview listens to", () => {
  it("refuses another origin, another window, and loopback outside local mode", () => {
    ready();
    const refused = (data: unknown, origin: string, source: unknown = parent) => {
      fromParent(data, origin, source);
      expect(click($("hero-link")).defaultPrevented).toBe(false);
      expect(sent("mingla:preview-select")).toHaveLength(0);
    };
    refused({ type: "mingla:preview-mode", edit: true }, "https://evil.example");
    refused({ type: "mingla:preview-mode", edit: true }, "https://host.usemingla.com.evil.example");
    refused({ type: "mingla:preview-mode", edit: true }, "http://localhost:8081");
    refused({ type: "mingla:preview-mode", edit: true }, HOST, {});
    refused({ type: "mingla:preview-mode", edit: true }, HOST, window);
    refused({ type: "mingla:preview-mode", edit: true }, "null");
    // The same message from the real parent is taken.
    fromParent({ type: "mingla:preview-mode", edit: true });
    expect(click($("hero-link")).defaultPrevented).toBe(true);
  });

  it("local mode adds loopback parents, and nothing else", () => {
    ready({ localMode: true });
    fromParent({ type: "mingla:preview-mode", edit: true }, "https://evil.example");
    expect(click($("hero-link")).defaultPrevented).toBe(false);
    fromParent({ type: "mingla:preview-mode", edit: true }, "http://localhost:8081");
    expect(click($("hero-link")).defaultPrevented).toBe(true);
  });

  it("a refused origin's text, marks and colours change nothing", () => {
    ready();
    fromParent({ type: "mingla:preview-text", section_id: A, from: "Wake up", to: "pwned" }, "https://evil.example");
    fromParent({ type: "mingla:preview-marks", selected: A, ari: null, unread: [] }, "https://evil.example");
    fromParent({ type: "mingla:preview-tokens", declarations: ["--c-canvas:#000000"] }, "https://evil.example");
    expect($("hero-sub").textContent).toBe("Wake up");
    expect(overlay()).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--c-canvas")).toBe("");
  });

  it("a malformed message does nothing at all", () => {
    ready();
    for (const data of [
      null, 7, "mingla:preview-mode", [], { type: "mingla:preview-mode" }, { type: "mingla:preview-mode", edit: "yes" },
      { type: "mingla:preview-scroll-to", section_id: "<img onerror=x>" }, { type: "mingla:preview-text", section_id: A, from: "", to: "x" },
      { type: "mingla:preview-text", section_id: A, from: "Wake up", to: "x".repeat(PREVIEW_MAX_TEXT + 1) },
      { type: "mingla:preview-text", section_id: A, from: "Wake up", to: 5 },
      { type: "mingla:preview-restore-scroll", scroll_y: -1 }, { type: "mingla:preview-restore-scroll", scroll_y: "9" },
      { type: "mingla:preview-restore-scroll", scroll_y: Number.NaN }, { type: "mingla:unknown" },
    ]) {
      expect(parsePreviewParentMessage(data), JSON.stringify(data)).toBeNull();
      fromParent(data);
    }
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect($("hero-sub").textContent).toBe("Wake up");
    expect(click($("hero-link")).defaultPrevented).toBe(false);
  });
});

describe("#4453 D parent → frame: mingla:preview-tokens (unchanged from #2829 W9r)", () => {
  it("applies only token variables with safe values and replaces the previous set", () => {
    ready();
    fromParent({ type: "mingla:preview-tokens", declarations: ["--c-canvas:#101013", "--button-radius:999px", "--c-canvas:red;background:url(https://evil)", "color:#000000"] });
    const style = document.documentElement.style;
    expect(style.getPropertyValue("--c-canvas")).toBe("#101013");
    expect(style.getPropertyValue("--button-radius")).toBe("999px");
    expect(style.getPropertyValue("color")).toBe("");
    fromParent({ type: "mingla:preview-tokens", declarations: ["--c-surface:#ffffff"] });
    expect(style.getPropertyValue("--c-canvas")).toBe("");
    expect(style.getPropertyValue("--c-surface")).toBe("#ffffff");
    fromParent({ type: "mingla:preview-tokens", declarations: [] });
    expect(style.getPropertyValue("--c-surface")).toBe("");
  });
});

describe("#4453 D edit mode: a click picks a section and nothing on the page acts", () => {
  const edit = (on = true) => fromParent({ type: "mingla:preview-mode", edit: on });

  it("off by default: links, forms and buttons behave like the live site", () => {
    ready();
    const seen = vi.fn();
    document.addEventListener("click", seen, true);
    expect(click($("hero-link")).defaultPrevented).toBe(false);
    expect(seen).toHaveBeenCalledTimes(1);
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    $("hero-form").addEventListener("submit", (event) => event.preventDefault(), { once: true });
    $("hero-form").dispatchEvent(submit);
    expect(sent("mingla:preview-select")).toHaveLength(0);
    expect(document.querySelector("[inert]")).toBeNull();
    expect(buttons()).toHaveLength(0);
    document.removeEventListener("click", seen, true);
  });

  it("on: a click on a link inside a section selects the section and the link never fires", () => {
    setScroll(40);
    ready();
    edit();
    const pageHandler = vi.fn();
    const bubbleHandler = vi.fn();
    document.addEventListener("click", pageHandler, true);
    $("hero-link").addEventListener("click", bubbleHandler);
    const event = click($("hero-link"));
    expect(event.defaultPrevented).toBe(true);
    // The page's own handlers (React's, the preview-link rewriter's) never see it.
    expect(pageHandler).not.toHaveBeenCalled();
    expect(bubbleHandler).not.toHaveBeenCalled();
    expect(sent("mingla:preview-select")).toHaveLength(1);
    expect(lastSent("mingla:preview-select")).toEqual({
      type: "mingla:preview-select", section_id: A, rect: { top: 80, left: 0, width: 1000, height: 600 }, scroll_y: 40,
    });
    document.removeEventListener("click", pageHandler, true);
  });

  it("on: the second element of a section selects that section, with the whole section's box", () => {
    ready();
    edit();
    click($("faq-more"));
    expect(lastSent("mingla:preview-select")).toEqual({
      type: "mingla:preview-select", section_id: C, rect: { top: 680, left: 40, width: 920, height: 420 }, scroll_y: 0,
    });
  });

  it("on: forms do not submit, buttons do not press, nothing is dragged, focus does not move into the page", () => {
    ready();
    edit();
    const pageSubmit = vi.fn();
    document.addEventListener("submit", pageSubmit, true);
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    $("hero-form").dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(pageSubmit).not.toHaveBeenCalled();
    expect(click($("hero-submit")).defaultPrevented).toBe(true);
    for (const kind of ["mousedown", "mouseup", "auxclick", "dblclick", "dragstart"]) {
      const pageListener = vi.fn();
      document.addEventListener(kind, pageListener, true);
      const event = new MouseEvent(kind, { bubbles: true, cancelable: true });
      $("hero-input").dispatchEvent(event);
      expect(event.defaultPrevented, kind).toBe(true);
      expect(pageListener, kind).not.toHaveBeenCalled();
      document.removeEventListener(kind, pageListener, true);
    }
    // Touch and pointer starts are swallowed for the page but never cancelled: the owner can still scroll.
    for (const kind of ["pointerdown", "pointerup", "touchstart", "touchend"]) {
      const pageListener = vi.fn();
      document.addEventListener(kind, pageListener, true);
      const event = new Event(kind, { bubbles: true, cancelable: true });
      $("hero").dispatchEvent(event);
      expect(event.defaultPrevented, kind).toBe(false);
      expect(pageListener, kind).not.toHaveBeenCalled();
      document.removeEventListener(kind, pageListener, true);
    }
    document.removeEventListener("submit", pageSubmit, true);
    // Only the three picks above (the submit button) reached the parent as selections; no navigation happened.
    expect(sent("mingla:preview-select").map(([message]) => (message as { section_id: string }).section_id)).toEqual([A]);
  });

  it("on: the page is inert (not the banner, not the bridge's own layer), and it is undone when edit mode ends", () => {
    ready();
    edit();
    expect($("mg-scope").hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".preview-banner")!.hasAttribute("inert")).toBe(false);
    expect(overlay()!.closest("[inert]")).toBeNull();
    edit(false);
    expect(document.querySelector("[inert]")).toBeNull();
    expect(click($("hero-link")).defaultPrevented).toBe(false);
    expect(buttons()).toHaveLength(0);
  });

  it("on: a click on the page's header or footer (not a section) selects nothing and still does not navigate", () => {
    ready();
    edit();
    expect(click($("nav-link"), { clientX: 30, clientY: 20 }).defaultPrevented).toBe(true);
    expect(click($("footer-link"), { clientX: 30, clientY: 1150 }).defaultPrevented).toBe(true);
    expect(sent("mingla:preview-select")).toHaveLength(0);
  });

  it("on: an inert page gives the click to the wrapper; the section under the pointer is still found", () => {
    ready();
    edit();
    const wrapper = document.querySelector('[data-preview="1"]')!;
    const inertDuringHit: boolean[] = [];
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = (_x, y) => {
      inertDuringHit.push($("mg-scope").hasAttribute("inert"));
      return y < 80 ? $("nav-link") : y < 680 ? $("hero-title") : $("faq-answer");
    };
    click(wrapper, { clientX: 400, clientY: 300 });
    expect(lastSent("mingla:preview-select")!.section_id).toBe(A);
    click(wrapper, { clientX: 400, clientY: 700 });
    expect(lastSent("mingla:preview-select")!.section_id).toBe(C);
    // Under the design's own header there is no section to pick, whatever lies behind it.
    click(wrapper, { clientX: 400, clientY: 40 });
    expect(sent("mingla:preview-select")).toHaveLength(2);
    // The page was live only for the look, and is inert again.
    expect(inertDuringHit).toEqual([false, false, false]);
    expect($("mg-scope").hasAttribute("inert")).toBe(true);
  });

  it("on: with no way to ask what is under the pointer, the section whose box holds the point is picked", () => {
    setScroll(600);
    ready();
    edit();
    const wrapper = document.querySelector('[data-preview="1"]')!;
    click(wrapper, { clientX: 100, clientY: 150 }); // document y = 750: the FAQ
    expect(lastSent("mingla:preview-select")!.section_id).toBe(C);
    click(wrapper, { clientX: 100, clientY: 650 }); // document y = 1250: the footer
    expect(sent("mingla:preview-select")).toHaveLength(1);
  });
});

describe("#4453 D keyboard: sections are reachable and Enter picks one", () => {
  it("edit mode adds one button per drawn section, in page order, labelled, over its section", () => {
    ready();
    fromParent({ type: "mingla:preview-mode", edit: true });
    const list = buttons();
    expect(list.map((button) => button.getAttribute(PROXY_ATTRIBUTE))).toEqual([A, C]);
    expect(list.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Section 1 of 2. Press Enter to choose it.",
      "Section 2 of 2. Press Enter to choose it.",
    ]);
    expect(list.every((button) => button.type === "button" && button.tabIndex === 0)).toBe(true);
    expect([list[1]!.style.top, list[1]!.style.left, list[1]!.style.width, list[1]!.style.height]).toEqual(["680px", "40px", "920px", "420px"]);
    // They take no pointer: a mouse click always lands on the page beneath.
    expect(list.every((button) => button.style.pointerEvents === "none")).toBe(true);
    expect(list[0]!.closest("[role=group]")!.getAttribute("aria-label")).toBe("Sections of this page");
  });

  it("focus draws a ring the bridge owns; Enter (a click on the focused button) selects the section", () => {
    ready();
    fromParent({ type: "mingla:preview-mode", edit: true });
    const [, second] = buttons();
    second!.focus();
    expect(document.activeElement).toBe(second);
    expect(mark(C)).not.toBeNull();
    expect(mark(C)!.getAttribute("data-mingla-mark-kind")).toBe("focus");
    // Two tones, so the ring shows on a dark design and on a light one.
    expect(mark(C)!.style.boxShadow).toContain("#ffffff");
    expect(mark(C)!.style.boxShadow).toContain("#111111");
    expect(second!.style.outline).toContain("none");
    const event = click(second!, { clientX: 0, clientY: 0, detail: 0 });
    expect(event.defaultPrevented).toBe(true);
    expect(lastSent("mingla:preview-select")).toEqual({
      type: "mingla:preview-select", section_id: C, rect: { top: 680, left: 40, width: 920, height: 420 }, scroll_y: 0,
    });
    second!.blur();
    expect(mark(C)).toBeNull();
  });

  it("the selected section's button says so", () => {
    ready();
    fromParent({ type: "mingla:preview-mode", edit: true });
    fromParent({ type: "mingla:preview-marks", selected: C, ari: null, unread: [] });
    expect(buttons().map((button) => button.getAttribute("aria-current"))).toEqual([null, "true"]);
  });
});

describe("#4453 D parent → frame: mingla:preview-marks", () => {
  it("draws the outline and the three chips, in a layer that cannot move the page", () => {
    ready();
    fromParent({ type: "mingla:preview-marks", selected: A, ari: null, unread: [{ id: C, by: "team" }] });
    const layer = overlay()!;
    expect(layer.parentElement).toBe(document.body);
    expect(document.body.lastElementChild).toBe(layer);
    expect([layer.style.position, layer.style.width, layer.style.height, layer.style.pointerEvents]).toEqual(["absolute", "0px", "0px", "none"]);
    expect(mark(A)!.getAttribute("data-mingla-mark-kind")).toBe("selected");
    expect([mark(A)!.style.top, mark(A)!.style.left, mark(A)!.style.width, mark(A)!.style.height]).toEqual(["80px", "0px", "1000px", "600px"]);
    expect(mark(A)!.style.pointerEvents).toBe("none");
    expect(chip(A)).toBeNull();
    expect(chip(C)).toBe("Read me · made by the Mingla team");
    fromParent({ type: "mingla:preview-marks", selected: null, ari: A, unread: [{ id: C, by: "ari" }] });
    expect(chip(A)).toBe("Ari is changing this");
    expect(chip(C)).toBe("Read me");
    fromParent({ type: "mingla:preview-marks", selected: null, ari: null, unread: [{ id: A, by: "composer" }] });
    expect(chip(A)).toBe("Read me");
    expect(mark(C)).toBeNull();
    expect(PREVIEW_CHIP_TEXT).toEqual({ ari: "Ari is changing this", unread: "Read me", unreadTeam: "Read me · made by the Mingla team" });
  });

  it("chip text is white on near-black with a white edge (readable on any design), and the page itself is untouched", () => {
    ready();
    const before = $("mg-scope").outerHTML;
    fromParent({ type: "mingla:preview-marks", selected: C, ari: A, unread: [{ id: C, by: "ari" }] });
    const label = mark(A)!.querySelector<HTMLElement>(`[${CHIP_ATTRIBUTE}]`)!;
    expect([label.style.background, label.style.color]).toEqual(["rgb(17, 17, 17)", "rgb(255, 255, 255)"]);
    expect(label.style.border).toContain("rgb(255, 255, 255)");
    // A selected section that is also unread keeps both its outline and its chip.
    expect(mark(C)!.getAttribute("data-mingla-mark-kind")).toBe("selected");
    expect(chip(C)).toBe("Read me");
    expect($("mg-scope").outerHTML).toBe(before);
    expect(overlay()!.querySelector("style, script, link")).toBeNull();
  });

  it("each message replaces the last; ids that are not on this page are ignored", () => {
    ready();
    fromParent({ type: "mingla:preview-marks", selected: A, ari: null, unread: [{ id: C, by: "ari" }] });
    fromParent({ type: "mingla:preview-marks", selected: "dddddddddddddddddddddddd", ari: B, unread: [{ id: "eeeeeeeeeeeeeeeeeeeeeeee", by: "team" }, { id: C, by: "nobody" }] });
    expect(document.querySelectorAll(`[${MARK_ATTRIBUTE}]`)).toHaveLength(0);
  });

  it("'Ari is changing this' breathes, unless the owner asked for less motion", () => {
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }));
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    ready();
    fromParent({ type: "mingla:preview-marks", selected: null, ari: A, unread: [] });
    expect(animate).toHaveBeenCalledTimes(1);
    fromParent({ type: "mingla:preview-marks", selected: null, ari: A, unread: [{ id: C, by: "ari" }] });
    expect(animate).toHaveBeenCalledTimes(1);
    fromParent({ type: "mingla:preview-marks", selected: null, ari: null, unread: [] });
    expect(cancel).toHaveBeenCalledTimes(1);
    (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({ matches: query.includes("prefers-reduced-motion") });
    fromParent({ type: "mingla:preview-marks", selected: null, ari: A, unread: [] });
    expect(animate).toHaveBeenCalledTimes(1);
    expect(chip(A)).toBe("Ari is changing this");
  });

  it("marks follow their section when the layout moves", () => {
    ready();
    fromParent({ type: "mingla:preview-marks", selected: C, ari: null, unread: [] });
    rects.set("hero", { top: 80, left: 0, width: 1000, height: 900 });
    rects.set("faq", { top: 980, left: 40, width: 920, height: 300 });
    rects.set("faq-aside", { top: 1280, left: 40, width: 400, height: 120 });
    window.dispatchEvent(new Event("resize"));
    frames();
    expect([mark(C)!.style.top, mark(C)!.style.height]).toEqual(["980px", "420px"]);
  });
});

describe("#4453 D parent → frame: mingla:preview-text", () => {
  it("swaps the one piece of text that is exactly `from`, inside that section only", () => {
    ready();
    // "Wake up" is also the start of the heading and sits in a script: only the exact text node changes.
    fromParent({ type: "mingla:preview-text", section_id: A, from: "Wake up", to: "Rise <b>early</b>" });
    expect($("hero-sub").textContent).toBe("Rise <b>early</b>");
    expect($("hero-sub").children).toHaveLength(0);
    expect($("hero-title").textContent).toBe("Wake up over the bay.");
    expect($("hero").querySelector("script")!.textContent).toBe('var x = "Wake up";');
    // Typing on: the next swap starts from what is on the page now.
    fromParent({ type: "mingla:preview-text", section_id: A, from: "Rise <b>early</b>", to: "Rise early." });
    expect($("hero-sub").textContent).toBe("Rise early.");
  });

  it("is silently ignored when the text is not there, is in another section, or the section is unknown", () => {
    ready();
    const before = document.body.innerHTML;
    fromParent({ type: "mingla:preview-text", section_id: A, from: "Before you come", to: "x" });
    fromParent({ type: "mingla:preview-text", section_id: A, from: "wake up", to: "x" });
    fromParent({ type: "mingla:preview-text", section_id: B, from: "Wake up", to: "x" });
    fromParent({ type: "mingla:preview-text", section_id: "dddddddddddddddddddddddd", from: "Wake up", to: "x" });
    expect(document.body.innerHTML).toBe(before);
    // The second element of a section is part of it.
    fromParent({ type: "mingla:preview-text", section_id: C, from: "More", to: "Even more" });
    expect($("faq-more").textContent).toBe("Even more");
  });
});

describe("#4453 D frame → parent: mingla:preview-rects (throttled)", () => {
  it("many scroll and resize events in one frame make one message", () => {
    ready();
    parent.postMessage.mockClear();
    const frameRequests = vi.spyOn(window, "requestAnimationFrame");
    const measures = vi.mocked(Element.prototype.getBoundingClientRect);
    measures.mockClear();
    for (let y = 10; y <= 200; y += 10) {
      setScroll(y);
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
    }
    // Forty events: one animation frame asked for, nothing measured and nothing sent until it runs.
    expect(frameRequests).toHaveBeenCalledTimes(1);
    expect(measures).not.toHaveBeenCalled();
    expect(sent("mingla:preview-rects")).toHaveLength(0);
    vi.advanceTimersByTime(16);
    // One message, offered to each origin that may frame the preview.
    expect(sent("mingla:preview-rects").map(([, origin]) => origin)).toEqual([HOST, STUDIO]);
    expect(lastSent("mingla:preview-rects")).toEqual({
      type: "mingla:preview-rects",
      sections: [{ id: A, top: 80, height: 600 }, { id: C, top: 680, height: 420 }],
      scroll_y: 200,
      doc_height: 1300,
    });
  });

  it("nothing is sent when nothing changed, and a layout change with no scroll is reported", () => {
    ready();
    fromParent({ type: "mingla:preview-mode", edit: false });
    parent.postMessage.mockClear();
    window.dispatchEvent(new Event("resize"));
    frames();
    expect(parent.postMessage).not.toHaveBeenCalled();
    rects.set("hero", { top: 80, left: 0, width: 1000, height: 640 });
    window.dispatchEvent(new Event("load"));
    frames();
    expect(sent("mingla:preview-rects")).toHaveLength(1);
    expect((lastSent("mingla:preview-rects")!.sections as Array<{ height: number }>)[0]!.height).toBe(640);
  });

  it("no rects before 'ready' (the parent hears 'ready' first)", () => {
    start();
    window.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(16);
    expect(sent("mingla:preview-rects")).toHaveLength(0);
    frames();
    expect((parent.postMessage.mock.calls[0]![0] as { type: string }).type).toBe("mingla:preview-ready");
  });
});

describe("#4453 D parent → frame: scroll", () => {
  it("mingla:preview-scroll-to brings the section into view, below a fixed header, smoothly unless motion is reduced", () => {
    ready();
    fromParent({ type: "mingla:preview-scroll-to", section_id: C });
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 592, behavior: "smooth" });
    fromParent({ type: "mingla:preview-scroll-to", section_id: A });
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: "smooth" });
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: true });
    fromParent({ type: "mingla:preview-scroll-to", section_id: C });
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 592, behavior: "auto" });
    // A section that drew nothing, or is not on this page: nothing happens.
    (window.scrollTo as unknown as ReturnType<typeof vi.fn>).mockClear();
    fromParent({ type: "mingla:preview-scroll-to", section_id: B });
    fromParent({ type: "mingla:preview-scroll-to", section_id: "dddddddddddddddddddddddd" });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("mingla:preview-restore-scroll puts the page back at once", () => {
    ready();
    fromParent({ type: "mingla:preview-restore-scroll", scroll_y: 431.6 });
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 432, behavior: "auto" });
  });
});

describe("#4453 D the Host app's WebView", () => {
  let native: { postMessage: ReturnType<typeof vi.fn> };
  const nativeReady = (): void => {
    Object.defineProperty(window, "parent", { value: window, configurable: true });
    native = { postMessage: vi.fn() };
    (window as unknown as { ReactNativeWebView: unknown }).ReactNativeWebView = native;
    ready();
  };
  const nativeSent = (type: string) => native.postMessage.mock.calls.map(([text]) => JSON.parse(text as string) as Record<string, unknown>).filter((message) => message.type === type);
  /** What the app's injected line of script does: an event with no source and no origin. */
  const inject = (data: unknown, target: EventTarget = window): void => { target.dispatchEvent(new MessageEvent("message", { data })); };

  it("sends every message to the app as JSON text", () => {
    nativeReady();
    expect(native.postMessage.mock.calls.every(([text]) => typeof text === "string")).toBe(true);
    expect(nativeSent("mingla:preview-ready")).toEqual([{
      type: "mingla:preview-ready", page_path: "",
      sections: [{ id: A, type: "hero", top: 80, height: 600 }, { id: C, type: "faq", top: 680, height: 420 }],
      scroll_y: 0, doc_height: 1300,
    }]);
    inject(JSON.stringify({ type: "mingla:preview-mode", edit: true }));
    expect(click($("hero-link")).defaultPrevented).toBe(true);
    expect(nativeSent("mingla:preview-select")).toEqual([{ type: "mingla:preview-select", section_id: A, rect: { top: 80, left: 0, width: 1000, height: 600 }, scroll_y: 0 }]);
    setScroll(50);
    window.dispatchEvent(new Event("scroll"));
    frames();
    expect(nativeSent("mingla:preview-rects")).toHaveLength(1);
  });

  it("takes a message the app injects: JSON text or an object, on window or (Android) on document, or posted by the page's own window", () => {
    nativeReady();
    inject(JSON.stringify({ type: "mingla:preview-marks", selected: A, ari: null, unread: [] }));
    expect(mark(A)).not.toBeNull();
    inject({ type: "mingla:preview-marks", selected: null, ari: null, unread: [{ id: C, by: "team" }] }, document);
    expect(mark(A)).toBeNull();
    expect(chip(C)).toBe("Read me · made by the Mingla team");
    fromParent(JSON.stringify({ type: "mingla:preview-text", section_id: A, from: "Wake up", to: "Rise" }), window.location.origin, window);
    expect($("hero-sub").textContent).toBe("Rise");
    inject(JSON.stringify({ type: "mingla:preview-tokens", declarations: ["--c-canvas:#101013"] }));
    expect(document.documentElement.style.getPropertyValue("--c-canvas")).toBe("#101013");
    inject(JSON.stringify({ type: "mingla:preview-restore-scroll", scroll_y: 300 }));
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 300, behavior: "auto" });
  });

  it("refuses a frame inside the page (the map) and any other window, and text that is not a message", () => {
    nativeReady();
    const frame = {};
    fromParent({ type: "mingla:preview-mode", edit: true }, "https://www.openstreetmap.org", frame);
    fromParent({ type: "mingla:preview-mode", edit: true }, window.location.origin, frame);
    fromParent({ type: "mingla:preview-mode", edit: true }, "https://evil.example", window);
    inject("mingla:preview-mode");
    inject("{not json");
    inject(`{"type":"mingla:preview-mode","edit":true}${" ".repeat(200_000)}`);
    expect(click($("hero-link")).defaultPrevented).toBe(false);
  });

  it("a page that is framed listens to its parent only, even inside an app's WebView", () => {
    native = { postMessage: vi.fn() };
    (window as unknown as { ReactNativeWebView: unknown }).ReactNativeWebView = native;
    ready();
    expect(native.postMessage).not.toHaveBeenCalled();
    expect(sent("mingla:preview-ready")).toHaveLength(2);
    inject(JSON.stringify({ type: "mingla:preview-mode", edit: true }));
    expect(click($("hero-link")).defaultPrevented).toBe(false);
  });
});

describe("#4453 D stopping the bridge leaves the page as it found it", () => {
  it("removes its layer, its marks, inert and its listeners", () => {
    ready();
    const untouched = document.body.innerHTML;
    fromParent({ type: "mingla:preview-mode", edit: true });
    fromParent({ type: "mingla:preview-marks", selected: A, ari: C, unread: [] });
    fromParent({ type: "mingla:preview-tokens", declarations: ["--c-canvas:#101013"] });
    stop!();
    stop = null;
    expect(overlay()).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.querySelector(`[${SECTION_ATTRIBUTE}]`)).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--c-canvas")).toBe("");
    expect(document.body.innerHTML.replace(/ data-mingla-section="[^"]*"/g, "")).toBe(untouched.replace(/ data-mingla-section="[^"]*"/g, ""));
    parent.postMessage.mockClear();
    fromParent({ type: "mingla:preview-mode", edit: true });
    expect(click($("hero-link")).defaultPrevented).toBe(false);
    window.dispatchEvent(new Event("scroll"));
    frames();
    expect(parent.postMessage).not.toHaveBeenCalled();
  });
});
