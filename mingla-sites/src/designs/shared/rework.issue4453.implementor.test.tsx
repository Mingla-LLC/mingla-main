// @vitest-environment jsdom
/*
 * #4453 PR 4 rework after the tester's FAIL (comment 6929265996):
 * P1-1 the phone menu dialog is portalled to <body>, out of the header (a
 *      size container whose bar may carry a backdrop filter: either makes it
 *      the containing block of a fixed child and trapped the menu in the strip);
 * P2-1 Save-Data stops ALL motion: server attribute and browser-only signal;
 * P3   at most 12 elements animate at once; "More" closes when focus leaves it.
 */
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VOYAGE } from "../../contracts/generated/designs.ts";
import { voyageSyntheticArtifact } from "../../contracts/voyageSynthetic.fixture";
import { homePage } from "../../lib/pageRouting";
import { VoyagePage } from "../voyage/VoyagePage";
import { SharedHeader } from "./chrome/SharedChrome";
import { motionAttributes } from "./library";
import { MAX_ANIMATING_AT_ONCE, startMotion } from "./motion";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {}, prefetch: () => {} }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items = ["Trips", "Stays", "Rooms", "Dining", "Spa", "Events", "Gifts", "Contact"].map((label) => ({ label, href: `/${label.toLowerCase()}` }));
const frame = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

async function mount(node: React.ReactNode) {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  await frame();
  return { host, root };
}

describe("#4453 P1-1 the phone menu covers the viewport, outside the header", () => {
  for (const variant of ["glass", "pill", "center"] as const) {
    it(`${variant}: the dialog is a child of <body>, never inside the header, and lists every page`, async () => {
      const { root } = await mount(<SharedHeader variant={variant} items={items} path="/" logo={null} siteName="Fixture" cta={{ label: "Reserve", href: "https://host.usemingla.com/b/fixture" }} place="Fixture City" />);
      const dialog = document.getElementById("mg-phone-menu")!;
      expect(dialog.parentElement).toBe(document.body);
      expect(dialog.closest("header")).toBeNull();
      await act(async () => (document.querySelector(".mg-menu-btn") as HTMLButtonElement).click());
      expect(dialog.hidden).toBe(false);
      const labels = [...dialog.querySelectorAll(".mg-pmenu__list > li > a")].map((a) => a.textContent);
      expect(labels).toEqual(["01Home", ...items.map((item, index) => `${String(index + 2).padStart(2, "0")}${item.label}`)]);
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
      expect(dialog.hidden).toBe(true);
      expect(document.activeElement).toBe(document.querySelector(".mg-menu-btn"));
      await act(async () => root.unmount());
    });
  }

  it("the menu is a viewport box: fixed, inset 0, above the header", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "public/designs/_shared/blocks-1.css"), "utf8");
    expect(css).toMatch(/\.mg-pmenu \{ position: fixed; inset: 0; z-index: 90;/);
    expect(css).toMatch(/\.mg-hd \{ position: fixed;[^}]*z-index: 60;/);
  });

  it("server markup still carries the hidden dialog (hydration matches)", () => {
    const html = renderToStaticMarkup(<SharedHeader variant="glass" items={items} path="/" logo={null} siteName="Fixture" cta={null} />);
    expect(html).toMatch(/id="mg-phone-menu"[^>]*hidden=""/);
  });
});

describe("#4453 P2-1 Save-Data stops all motion", () => {
  it("server: a Save-Data request draws data-motion=none (hero settle, drift and ticker off)", () => {
    expect(motionAttributes(VOYAGE, "design", true)["data-motion"]).toBe("none");
    const artifact = voyageSyntheticArtifact();
    artifact.navigation.header_variant = "glass";
    const html = renderToStaticMarkup(<VoyagePage artifact={artifact} page={homePage(artifact)!} saveData nonce="n" notFound={false} />);
    expect(html).toContain('data-motion="none"');
  });

  it("browser-only Save-Data: the module turns the page's motion off before anything starts", () => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    Object.defineProperty(window.navigator, "connection", { value: { saveData: true }, configurable: true });
    document.body.innerHTML = '<div id="s" class="mg-scope" data-motion="on"><h2 data-mg-rise="">x</h2></div>';
    const root = document.getElementById("s")!;
    startMotion(root);
    expect(root.getAttribute("data-motion")).toBe("none");
    expect(root.hasAttribute("data-mg-motion")).toBe(false);
    Object.defineProperty(window.navigator, "connection", { value: undefined, configurable: true });
  });

  it("every running animation in the shared stylesheet has a data-motion=none stop or needs data-motion=on", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "public/designs/_shared/blocks-1.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.matchAll(/([^{};]+)\{[^{}]*\banimation:\s*(mg-[a-z]+)/g)) {
      const selector = rule[1]!.trim();
      const gated = selector.includes('[data-motion="on"]') || selector.includes('[data-mg-motion="on"]');
      const stopped = new RegExp(`\\[data-motion="none"\\][^{]*\\{[^}]*animation: none`).test(css);
      expect(gated || (rule[2] === "mg-mq" && stopped), selector).toBe(true);
    }
  });
});

describe("#4453 P3 motion cap and More focus-out", () => {
  it(`at most ${MAX_ANIMATING_AT_ONCE} elements animate at once; the rest appear without moving`, () => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    let cb: IntersectionObserverCallback = () => {};
    const observed: Element[] = [];
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      constructor(c: IntersectionObserverCallback) { cb = c; }
      observe(el: Element) { observed.push(el); }
      unobserve() {}
      disconnect() {}
    };
    document.body.innerHTML = `<div id="s" class="mg-scope" data-motion="on">${Array.from({ length: 30 }, (_, i) => `<p data-mg-rise="">${i}</p>`).join("")}</div>`;
    startMotion(document.getElementById("s")!);
    cb(observed.map((target) => ({ isIntersecting: true, target })) as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    const instant = observed.filter((el) => el.hasAttribute("data-mg-instant")).length;
    expect(observed.every((el) => el.hasAttribute("data-in"))).toBe(true);
    expect(observed.length - instant).toBe(MAX_ANIMATING_AT_ONCE);
  });

  it("More closes when focus moves out of it", async () => {
    const { root } = await mount(<><SharedHeader variant="center" items={items} path="/" logo={null} siteName="Fixture" cta={null} /><button type="button" id="after">after</button></>);
    const button = document.querySelector(".mg-more__btn") as HTMLButtonElement;
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const after = document.getElementById("after")!;
    await act(async () => {
      button.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: after }));
    });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await act(async () => root.unmount());
  });
});
