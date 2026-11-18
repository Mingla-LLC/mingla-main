// @vitest-environment jsdom
/*
 * #4453 tester P3 (comments 6932770046 and 6935515341) — when frames are
 * suspended (a hidden, prerendered or background webview), IntersectionObserver
 * never reports and requestAnimationFrame never runs. Every [data-mg-rise]
 * must still reach its final visible state: after the settle time if no
 * observer entry arrived, and when the page becomes visible again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startMotion } from "./motion";

class StalledIO {
  static instances: StalledIO[] = [];
  observed = new Set<Element>();
  constructor(public cb: IntersectionObserverCallback) { StalledIO.instances.push(this); }
  observe(el: Element): void { this.observed.add(el); }
  unobserve(el: Element): void { this.observed.delete(el); }
  disconnect(): void { this.observed.clear(); }
  /** Reports entries, as a browser with running frames would. */
  report(entries: Array<{ target: Element; isIntersecting: boolean }>): void {
    this.cb(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

function page(): HTMLElement {
  document.body.innerHTML = `<div id="mg-scope" class="mg-scope"><section data-mg-rise="" id="a">A</section><ul data-mg-stagger=""><li>One</li><li>Two</li><li>Three</li></ul><section data-mg-rise="" id="far">Far</section><p data-mg-count="12">12</p></div>`;
  return document.getElementById("mg-scope") as HTMLElement;
}

function rises(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-mg-rise]"));
}

let visibility: DocumentVisibilityState = "hidden";

beforeEach(() => {
  vi.useFakeTimers();
  StalledIO.instances = [];
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = StalledIO;
  // Frames suspended: requestAnimationFrame callbacks never run.
  vi.stubGlobal("requestAnimationFrame", () => 0);
  visibility = "hidden";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("#4453 motion failsafe: rises are never stuck hidden", () => {
  it("no observer entry by the settle time: every rise is revealed in place", () => {
    const root = page();
    const stop = startMotion(root);
    expect(root.getAttribute("data-mg-motion")).toBe("on");
    expect(rises(root).length).toBe(5);
    expect(rises(root).some((el) => el.hasAttribute("data-in"))).toBe(false);
    vi.advanceTimersByTime(5000);
    for (const el of rises(root)) {
      expect(el.hasAttribute("data-in")).toBe(true);
      expect(el.hasAttribute("data-mg-instant")).toBe(true);
    }
    expect(root.querySelector("[data-mg-count]")?.textContent).toBe("12");
    stop();
  });

  it("becoming visible before the settle time reveals every rise when nothing reported", () => {
    const root = page();
    const stop = startMotion(root);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    for (const el of rises(root)) expect(el.hasAttribute("data-in")).toBe(true);
    stop();
  });

  it("with a working observer, below-the-fold rises still wait to rise (no early reveal)", () => {
    const root = page();
    const stop = startMotion(root);
    const io = StalledIO.instances[0];
    const far = root.querySelector("#far") as HTMLElement;
    far.getBoundingClientRect = () => ({ top: 5000, bottom: 5100, left: 0, right: 0, width: 0, height: 100, x: 0, y: 5000, toJSON() {} }) as DOMRect;
    io.report([{ target: root.querySelector("#a") as Element, isIntersecting: true }, { target: far, isIntersecting: false }]);
    vi.advanceTimersByTime(5000);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(root.querySelector("#a")?.hasAttribute("data-in")).toBe(true);
    expect(far.hasAttribute("data-in")).toBe(false);
    stop();
  });

  it("stop() clears the failsafe", () => {
    const root = page();
    startMotion(root)();
    vi.advanceTimersByTime(5000);
    expect(rises(root).some((el) => el.hasAttribute("data-in"))).toBe(false);
  });
});
