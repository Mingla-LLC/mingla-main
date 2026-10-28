// @vitest-environment jsdom
/*
 * #2829 W7 — voyage's header behaviour in a browser-like DOM:
 *  - the header goes "stuck" past 8 px of scroll (the stylesheet keys the
 *    transparent-over-cover state off data-stuck="false");
 *  - the disclosure: click toggles, ArrowDown opens and focuses the first
 *    item, ArrowUp/Down/Home/End move, Escape closes and returns focus,
 *    items are out of the tab order while closed;
 *  - the drawer: opening makes the page behind inert and locks scrolling,
 *    Escape closes it and returns focus to the toggle.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/faqs" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
}));

import { VoyageHeader } from "./VoyageHeader";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items = [
  { label: "Trips", href: "/trips" },
  { label: "More", href: "/about-us", children: [
    { label: "About us", href: "/about-us" },
    { label: "Questions", href: "/faqs" },
    { label: "Privacy", href: "/privacy" },
  ] },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = ((query: string) => ({ matches: query.includes("hover: hover"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0)) as unknown as typeof window.requestAnimationFrame;
  document.body.innerHTML = '<div id="host"></div><main id="main"></main><footer class="site-footer"></footer>';
  container = document.getElementById("host") as HTMLDivElement;
  root = createRoot(container);
  act(() => root.render(<VoyageHeader items={items} logo={null} siteName="Fixture & Friends" cta={{ label: "Browse trips", href: "/trips" }} />));
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const key = (target: Element, name: string) => act(() => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
});
const flush = () => act(() => { vi.runAllTimers(); });

describe("#2829 W7 voyage header", () => {
  it("is not stuck at the top and becomes stuck past 8 px", () => {
    const header = container.querySelector(".site-header")!;
    expect(header.getAttribute("data-stuck")).toBe("false");
    Object.defineProperty(window, "scrollY", { value: 9, configurable: true });
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(header.getAttribute("data-stuck")).toBe("true");
    Object.defineProperty(window, "scrollY", { value: 8, configurable: true });
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(header.getAttribute("data-stuck")).toBe("false");
  });

  it("disclosure: click, arrows, Home/End, Escape, and closed items out of the tab order", () => {
    const trigger = container.querySelector<HTMLButtonElement>(".nav-disclosure .nav-link")!;
    const panel = container.querySelector(".nav-panel")!;
    const links = () => Array.from(panel.querySelectorAll<HTMLAnchorElement>(".nav-item"));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(links().every((link) => link.tabIndex === -1)).toBe(true);
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(panel.getAttribute("data-open")).toBe("true");
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    trigger.focus();
    key(trigger, "ArrowDown");
    flush();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(links()[0]);
    key(links()[0]!, "ArrowDown");
    expect(document.activeElement).toBe(links()[1]);
    expect(links()[1]!.getAttribute("aria-current")).toBe("page");
    key(links()[1]!, "End");
    expect(document.activeElement).toBe(links()[2]);
    key(links()[2]!, "ArrowDown");
    expect(document.activeElement).toBe(links()[0]);
    key(links()[0]!, "Home");
    expect(document.activeElement).toBe(links()[0]);
    key(links()[0]!, "ArrowUp");
    expect(document.activeElement).toBe(links()[2]);
    key(document.body, "Escape");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("disclosure: hover opens after 100 ms and closes after 220 ms", () => {
    const root = container.querySelector(".nav-disclosure")!;
    const trigger = root.querySelector(".nav-link")!;
    // React derives pointerenter/leave from pointerover/pointerout with a relatedTarget.
    act(() => { trigger.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, relatedTarget: document.body })); });
    act(() => { vi.advanceTimersByTime(99); });
    const openedEarly = trigger.getAttribute("aria-expanded") === "true";
    act(() => { vi.advanceTimersByTime(1); });
    expect(openedEarly).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    act(() => { trigger.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body })); });
    act(() => { vi.advanceTimersByTime(219); });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    act(() => { vi.advanceTimersByTime(1); });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("drawer: opening makes the page behind inert and locks scroll; Escape closes and returns focus", () => {
    const details = container.querySelector<HTMLDetailsElement>("details.v-drawer")!;
    const summary = details.querySelector<HTMLElement>("summary")!;
    act(() => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    flush(); // opens on the next frame
    flush(); // then focus moves into the panel
    expect(document.activeElement?.closest(".drawer-panel")).not.toBeNull();
    expect(details.querySelector(".drawer-panel")!.getAttribute("data-open")).toBe("true");
    expect(document.getElementById("main")!.hasAttribute("inert")).toBe(true);
    expect(document.querySelector("footer.site-footer")!.hasAttribute("inert")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    // flattened links: Trips + the three children, current page marked
    const drawerLinks = Array.from(details.querySelectorAll(".drawer-item")).map((link) => link.textContent);
    expect(drawerLinks).toEqual(["Trips", "About us", "Questions", "Privacy"]);
    key(document.body, "Escape");
    flush();
    expect(document.getElementById("main")!.hasAttribute("inert")).toBe(false);
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(summary);
  });
});
