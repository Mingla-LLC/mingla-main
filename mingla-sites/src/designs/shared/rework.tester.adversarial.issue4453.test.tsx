// @vitest-environment jsdom
/*
 * #4453 PR 4 retest — the tester's adversarial angles on the rework
 * (comment 6929505096), different from the implementor's rework suite:
 *
 * D. "More" closes on focus-out but NOT while focus moves between its own
 *    links (a Tab through the list must not slam it shut).
 * E. The 12-at-once motion cap RELEASES: once the first batch has settled, a
 *    new batch animates again instead of every later element appearing
 *    without motion for the rest of the visit.
 * F. The portalled phone menu never leaks: mounting and unmounting the header
 *    (a client navigation) leaves no orphan dialog in <body>, and a remount
 *    has exactly one #mg-phone-menu, so aria-controls stays unambiguous.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SharedHeader } from "./chrome/SharedChrome";
import { MAX_ANIMATING_AT_ONCE, MAX_STAGGER_STEPS, startMotion } from "./motion";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {}, prefetch: () => {} }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items = ["Trips", "Stays", "Rooms", "Dining", "Spa", "Events", "Gifts", "Contact"].map((label) => ({ label, href: `/${label.toLowerCase()}` }));
const frame = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });

async function mount() {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<><SharedHeader variant="center" items={items} path="/" logo={null} siteName="Fixture" cta={null} /><button type="button" id="after">after</button></>));
  await frame();
  return root;
}

afterEach(() => { vi.useRealTimers(); });

describe("#4453 retest D — More and focus", () => {
  it("stays open while focus moves inside its list, closes when focus leaves", async () => {
    const root = await mount();
    const button = document.querySelector(".mg-more__btn") as HTMLButtonElement;
    await act(async () => button.click());
    const links = [...document.querySelectorAll<HTMLAnchorElement>(".mg-more a")];
    expect(links.length).toBeGreaterThan(0);
    await act(async () => { button.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: links[0] })); });
    expect(button.getAttribute("aria-expanded"), "button → first link").toBe("true");
    if (links[1]) {
      await act(async () => { links[0]!.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: links[1] })); });
      expect(button.getAttribute("aria-expanded"), "link → link").toBe("true");
    }
    await act(async () => { links.at(-1)!.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: document.getElementById("after") })); });
    expect(button.getAttribute("aria-expanded"), "last link → outside").toBe("false");
    await act(async () => root.unmount());
  });
});

describe("#4453 retest E — the motion cap releases", () => {
  it(`after a batch settles, the next ${MAX_ANIMATING_AT_ONCE} animate again`, () => {
    vi.useFakeTimers();
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    let cb: IntersectionObserverCallback = () => {};
    const observed: Element[] = [];
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      constructor(c: IntersectionObserverCallback) { cb = c; }
      observe(el: Element) { observed.push(el); }
      unobserve() {}
      disconnect() {}
    };
    document.body.innerHTML = `<div id="s" class="mg-scope" data-motion="on">${Array.from({ length: 40 }, (_, i) => `<p data-mg-rise="">${i}</p>`).join("")}</div>`;
    startMotion(document.getElementById("s")!);
    const fire = (els: Element[]) => cb(els.map((target) => ({ isIntersecting: true, target })) as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    fire(observed.slice(0, 20));
    expect(observed.slice(0, 20).filter((el) => !el.hasAttribute("data-mg-instant")).length).toBe(MAX_ANIMATING_AT_ONCE);
    // Still inside the first batch's run: the cap holds.
    vi.advanceTimersByTime(100);
    fire(observed.slice(20, 22));
    expect(observed.slice(20, 22).every((el) => el.hasAttribute("data-mg-instant"))).toBe(true);
    // Past the longest rise (duration + 6 stagger steps): slots are free again.
    vi.advanceTimersByTime(700 + MAX_STAGGER_STEPS * 60 + 50);
    fire(observed.slice(22, 40));
    const animated = observed.slice(22, 40).filter((el) => !el.hasAttribute("data-mg-instant")).length;
    expect(animated).toBe(MAX_ANIMATING_AT_ONCE);
    expect(observed.every((el) => el.hasAttribute("data-in"))).toBe(true);
  });
});

describe("#4453 retest F — the portalled menu never leaks", () => {
  it("unmount leaves no orphan dialog; remount has exactly one", async () => {
    const root = await mount();
    expect(document.querySelectorAll("#mg-phone-menu").length).toBe(1);
    expect(document.getElementById("mg-phone-menu")!.parentElement).toBe(document.body);
    await act(async () => root.unmount());
    expect(document.querySelectorAll("#mg-phone-menu").length, "orphan after unmount").toBe(0);
    const again = await mount();
    expect(document.querySelectorAll("#mg-phone-menu").length).toBe(1);
    expect(document.querySelector(".mg-menu-btn")!.getAttribute("aria-controls")).toBe("mg-phone-menu");
    await act(async () => again.unmount());
  });
});
