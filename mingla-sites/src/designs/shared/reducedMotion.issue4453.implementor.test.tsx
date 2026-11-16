// @vitest-environment jsdom
/*
 * #4453 SC-D4 / I-SITES-MOTION-OPTIONAL — with reduced motion, `motion: none`
 * or Save-Data nothing animates and every word is visible: the motion module
 * does not start, so the page keeps exactly the server's markup (no hidden
 * "before" state), and the stylesheet hides nothing unless the module marked
 * the page. With motion allowed, the module marks the page and reveals.
 */
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { VOYAGE } from "../../contracts/generated/designs.ts";
import { voyageSyntheticArtifact } from "../../contracts/voyageSynthetic.fixture";
import { homePage } from "../../lib/pageRouting";
import { VoyagePage } from "../voyage/VoyagePage";
import { motionAttributes, pageMotion } from "./library";
import { motionAllowed, startMotion } from "./motion";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {} }) }));

function page(motion: "none" | "on"): HTMLElement {
  document.body.innerHTML = `<div id="mg-scope" class="mg-scope" data-motion="${motion}"><h2 data-mg-rise="">Heading</h2><ul data-mg-stagger=""><li>One</li><li>Two</li></ul><p data-mg-count="12">12</p></div>`;
  return document.getElementById("mg-scope")!;
}
function matchMedia(reduce: boolean) {
  window.matchMedia = ((query: string) => ({ matches: query.includes("reduce") ? reduce : false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}
class IO {
  static instances: IO[] = [];
  observed: Element[] = [];
  constructor(public cb: IntersectionObserverCallback) { IO.instances.push(this); }
  observe(el: Element) { this.observed.push(el); }
  unobserve() {}
  disconnect() {}
}

describe("#4453 SC-D4 motion is optional", () => {
  it("prefers-reduced-motion: the module never starts and nothing is hidden", () => {
    matchMedia(true);
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
    const root = page("on");
    const before = root.innerHTML;
    expect(motionAllowed(root)).toBe(false);
    startMotion(root);
    expect(root.hasAttribute("data-mg-motion")).toBe(false);
    expect(root.innerHTML).toBe(before);
  });

  it("motion: none — the owner's preset turns all of it off", () => {
    matchMedia(false);
    const root = page("none");
    startMotion(root);
    expect(root.hasAttribute("data-mg-motion")).toBe(false);
    expect(pageMotion(VOYAGE, "none")).toBeNull();
    expect(motionAttributes(VOYAGE, "none")["data-motion"]).toBe("none");
  });

  it("Save-Data turns it off", () => {
    matchMedia(false);
    Object.defineProperty(window.navigator, "connection", { value: { saveData: true }, configurable: true });
    const root = page("on");
    expect(motionAllowed(root)).toBe(false);
    Object.defineProperty(window.navigator, "connection", { value: undefined, configurable: true });
  });

  it("motion allowed: the page is marked, stagger is capped, and an observed element is revealed", () => {
    matchMedia(false);
    IO.instances = [];
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
    const root = page("on");
    const stop = startMotion(root);
    expect(root.getAttribute("data-mg-motion")).toBe("on");
    const items = root.querySelectorAll("li");
    expect(items[1]!.hasAttribute("data-mg-rise")).toBe(true);
    const io = IO.instances[0]!;
    io.cb(io.observed.map((target) => ({ isIntersecting: true, target })) as unknown as IntersectionObserverEntry[], io as unknown as IntersectionObserver);
    for (const element of io.observed) expect(element.hasAttribute("data-in")).toBe(true);
    stop();
    expect(root.hasAttribute("data-mg-motion")).toBe(false);
  });

  it("calm caps every profile at the calm numbers", () => {
    const calm = pageMotion(VOYAGE, "calm")!;
    expect(calm.hero_scale).toBeLessThanOrEqual(1.03);
    expect(calm.stagger_cap).toBeLessThanOrEqual(4);
  });

  it("a page rendered with motion: none carries data-motion=none and no inline hidden content", () => {
    const artifact = voyageSyntheticArtifact();
    artifact.tokens.motion = "none";
    artifact.navigation.header_variant = "glass";
    const html = renderToStaticMarkup(<VoyagePage artifact={artifact} page={homePage(artifact)!} nonce="n" notFound={false} />);
    expect(html).toContain('data-motion="none"');
    expect(html).not.toMatch(/style="[^"]*(opacity:\s*0|visibility:\s*hidden)/);
  });

  it("the stylesheet hides nothing at rest: every hidden 'before' state needs the module's mark and no-preference", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "public/designs/_shared/blocks-1.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const motionBlock = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"));
    const outside = css.slice(0, css.indexOf("@media (prefers-reduced-motion: no-preference)"));
    expect(outside).not.toMatch(/opacity:\s*0[;\s}]/);
    expect(motionBlock).toMatch(/\[data-mg-motion="on"\] \[data-mg-rise\]:not\(\[data-in\]\) \{ opacity: 0/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*mg-mq__track \{ animation: none/);
  });
});
