// @vitest-environment jsdom
/*
 * #3149 — the header's scrolled state, PROVEN BY RUNNING IT.
 *
 * The class name is not the contract; the behaviour is. These mount the real
 * component into a real document, move a real scroll position, and read the
 * header's real class list — so a component that imported cleanly, rendered
 * null and did nothing (which is exactly what a broken effect looks like)
 * fails here rather than shipping.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HeaderScrollState } from "./HeaderScrollState";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let header: HTMLElement;
let live = false;

const scrollTo = (y: number) => {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
};

const mount = () => {
  live = true;
  act(() => {
    root.render(<HeaderScrollState />);
  });
};

const unmount = () => {
  if (!live) return;
  live = false;
  act(() => root.unmount());
};

beforeEach(() => {
  document.body.innerHTML = "";
  header = document.createElement("header");
  header.className = "site-header";
  document.body.appendChild(header);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  // jsdom has no rAF budget; run the callback immediately so a scroll event
  // and its class write happen inside the same act().
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => undefined) as typeof window.cancelAnimationFrame;
});

afterEach(unmount);

describe("#3149 the header's scrolled state", () => {
  it("is NOT stuck at the top of the page", () => {
    mount();
    expect(header.classList.contains("stuck")).toBe(false);
  });

  it("becomes stuck once the page has moved past the reference's threshold", () => {
    mount();
    scrollTo(41);
    expect(header.classList.contains("stuck")).toBe(true);
  });

  it("is still NOT stuck at the threshold itself", () => {
    // 40 exactly is the reference's own boundary: `scrollY > 40`.
    mount();
    scrollTo(40);
    expect(header.classList.contains("stuck")).toBe(false);
  });

  it("releases again when the page returns to the top", () => {
    mount();
    scrollTo(600);
    expect(header.classList.contains("stuck")).toBe(true);
    scrollTo(0);
    expect(header.classList.contains("stuck")).toBe(false);
  });

  it("applies the state on mount, before any scroll event", () => {
    /*
     * A reload part-way down a page — or a browser restoring the previous
     * scroll position — would otherwise paint a TRANSPARENT header over
     * ordinary page content until the visitor happened to scroll.
     */
    Object.defineProperty(window, "scrollY", { value: 900, configurable: true });
    mount();
    expect(header.classList.contains("stuck")).toBe(true);
  });

  it("leaves no listener and no class behind when it unmounts", () => {
    mount();
    scrollTo(600);
    unmount();
    expect(header.classList.contains("stuck")).toBe(false);
    // The listener is gone, so a later scroll cannot resurrect the state.
    Object.defineProperty(window, "scrollY", { value: 900, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    expect(header.classList.contains("stuck")).toBe(false);
  });

  it("does nothing at all when there is no header to drive", () => {
    header.remove();
    expect(() => mount()).not.toThrow();
  });
});
