// @vitest-environment jsdom
/*
 * #2829 W10 — inside a private share link, a click on one of the site's own
 * links (the header and footer use client-side links whose handlers would go
 * to the LIVE page) opens the same page of the preview instead; links to
 * other sites keep their own behaviour.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SharedPreviewLinks } from "./SharedPreviewLinks";

const TOKEN = "T".repeat(43);
let container: HTMLDivElement;
let root: Root;
const assign = vi.fn();

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "location", { value: { ...window.location, origin: "https://young.sites.usemingla.com", assign }, configurable: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  assign.mockReset();
});

function link(href: string, onClick: (event: MouseEvent) => void) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.addEventListener("click", onClick);
  container.appendChild(anchor);
  return anchor;
}

describe("#2829 W10 links inside a shared link", () => {
  it("a site link's own (client-side) handler never runs; the preview page opens instead", () => {
    act(() => root.render(<SharedPreviewLinks token={TOKEN} />));
    const liveNavigation = vi.fn((event: MouseEvent) => event.preventDefault());
    const anchor = link("https://young.sites.usemingla.com/about-us", liveNavigation);
    anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(liveNavigation).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith(`/preview/share/${TOKEN}?path=about-us`);
  });

  it("links to other sites keep their behaviour", () => {
    act(() => root.render(<SharedPreviewLinks token={TOKEN} />));
    const own = vi.fn((event: MouseEvent) => event.preventDefault());
    link("https://host.usemingla.com/t/young/bali", own).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    expect(own).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });
});
