// @vitest-environment jsdom
/*
 * #4453 website workspace (build contract D) — a section of the owner's
 * private preview can be found by its Studio section id, and finding it costs
 * NOTHING visually, in all 11 designs and all three page components (the
 * shared gallery page, Voyage's own page, Atelier's page).
 *
 * The proof has three parts, each run against the real `SiteDocument`:
 *   1. Without a section list (the public site, a share link, the plan
 *      preview) the HTML carries no mark of any kind.
 *   2. With a section list, the HTML is THE SAME HTML plus one whitespace
 *      text marker before each section: delete the markers and the two
 *      documents are equal, character for character. No selector sees a text
 *      node (`>`, `+`, `:first-child`, `:nth-child`) and whitespace between
 *      block-level sections makes no box, which the real-browser check
 *      (e2e/preview-bridge) confirms pixel for pixel in every design.
 *      (Before this change shipped, the unmarked HTML of all 93 fixture
 *      pages was also compared, hash for hash, with the HTML the previous
 *      commit produced: identical.)
 *   3. The markers pair with the page's blocks one for one, including a
 *      block that draws nothing, so the n-th marker IS the n-th section.
 * And the marks are there both when React takes over the server's HTML
 * (hydration) and when it draws the page again in the browser (what it does
 * when the two disagree), which is when the bridge reads them.
 */
import { act, type ReactElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { DESIGN_KEYS, type DesignKey } from "../../contracts/generated/designs.ts";
import type { ArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import { upgradeV1ToV2 } from "../../contracts/generated/upgradeV1ToV2.ts";
import { gogiV1Fixture } from "../../contracts/gogiV1.fixture";
import { voyageSyntheticArtifact } from "../../contracts/voyageSynthetic.fixture";
import { galleryArtifact } from "../../designs/shared/galleryDesigns.fixture";
import { groupReels } from "../../designs/atelier/AtelierPage";
import { findSectionSlots } from "../../lib/previewBridge";
import { sitePages, type ArtifactPage } from "../../lib/pageRouting";
import { PREVIEW_SECTION_MARKER, PreviewSection } from "./PreviewSection";
import { SiteDocument } from "./SiteDocument";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURES: Array<[name: string, design: DesignKey, make: () => ArtifactV2]> = [
  ["atelier (its own page)", "atelier", () => upgradeV1ToV2(gogiV1Fixture())],
  ["voyage (its own header and footer)", "voyage", voyageSyntheticArtifact],
  ...DESIGN_KEYS.filter((key) => key !== "atelier").map((key): [string, DesignKey, () => ArtifactV2] => [`${key} (shared gallery chrome)`, key, () => galleryArtifact(key)]),
];

const idsFor = (page: ArtifactPage): string[] => page.blocks.map((_, index) => `sec${String(index).padStart(3, "0")}${page.path.replace(/[^a-z0-9]/g, "")}`.slice(0, 40));
const marked = (page: ArtifactPage): ArtifactPage => ({ ...page, previewSectionIds: idsFor(page) });
const draw = (artifact: ArtifactV2, page: ArtifactPage, render: (element: ReactElement) => string = renderToString): string =>
  render(<SiteDocument artifact={artifact} page={page} nonce="n" />);
/** A marker as the server writes it (React separates two text nodes in a row with an empty comment). */
const MARKER = /(?:<!-- -->)?\n\t\n/g;
/**
 * The page without its markers. React's generated ids (`useId`, e.g. `_R_ilm_`) are opaque labels that
 * tie a control to its description; a marker renumbers them, so they are renamed here in order of first
 * appearance. Every element, attribute, class and text is compared as it is.
 */
const unmarked = (html: string): string => {
  const names = new Map<string, string>();
  return html.replace(MARKER, "").replace(/_R_[A-Za-z0-9]*_/g, (id) => names.get(id) ?? (names.set(id, `_R_${names.size}_`), names.get(id)!));
};

describe("#4453 D: section marks change nothing a visitor or an owner can see", () => {
  it("covers every design", () => {
    expect(new Set(FIXTURES.map(([, design]) => design))).toEqual(new Set(DESIGN_KEYS));
    expect(DESIGN_KEYS).toHaveLength(11);
  });

  describe.each(FIXTURES)("%s", (_name, _design, make) => {
    const pages = sitePages(make()).filter((page) => page.blocks.length > 0);

    it("has pages with sections to test", () => {
      expect(pages.length).toBeGreaterThan(0);
    });

    it.each(pages.map((page) => [page.path || "(home)", page.path] as const))("/%s: no list, no marks; with a list, the same HTML plus markers", (_label, path) => {
      const artifact = make();
      const page = sitePages(artifact).find((candidate) => candidate.path === path)!;
      const plain = draw(artifact, page);
      // 1. A page with no section list carries nothing of the workspace.
      expect(plain).not.toMatch(MARKER);
      expect(plain).not.toContain("\t");
      expect(plain).not.toContain("data-mingla-section");
      // 2. The marked page is the same page: only comments were added.
      const withMarks = draw(artifact, marked(page));
      expect(withMarks).not.toContain("data-mingla-section");
      expect(unmarked(withMarks)).toBe(unmarked(plain));
      expect(withMarks.match(MARKER)).toHaveLength(page.blocks.length);
      // The static render (the design goldens' input) is the same document too.
      expect(unmarked(draw(artifact, marked(page), renderToStaticMarkup))).toBe(unmarked(draw(artifact, page, renderToStaticMarkup)));
      // 3. One marker per block, in block order, where the bridge looks for them.
      document.body.innerHTML = withMarks;
      const slots = findSectionSlots(document, page.blocks.length);
      expect(slots).not.toBeNull();
      expect(slots).toHaveLength(page.blocks.length);
      // Every element the page drew for its sections is inside exactly one slot, in document order.
      const roots = slots!.flat();
      expect(new Set(roots).size).toBe(roots.length);
      const container = roots[0]?.parentElement;
      expect(container).toBeTruthy();
      expect(roots.every((root) => root.parentElement === container)).toBe(true);
      expect(Array.from(container!.children)).toEqual(roots);
      // And the unmarked document offers the bridge nothing to pair.
      document.body.innerHTML = plain;
      expect(findSectionSlots(document, page.blocks.length)).toBeNull();
    });
  });

  it("pairs each marker with its own block on a gallery Home (a block that draws nothing keeps its place)", () => {
    const artifact = galleryArtifact("haven");
    const home = sitePages(artifact).find((page) => page.path === "")!;
    document.body.innerHTML = draw(artifact, marked(home));
    const slots = findSectionSlots(document, home.blocks.length)!;
    const text = (type: string) => slots[home.blocks.findIndex((block) => block.type === type)]!.map((root) => root.textContent).join(" ");
    expect(text("hero")).toContain("over the bay.");
    expect(text("marquee")).toContain("Breakfast till noon");
    expect(text("faq")).toContain("How do I get there?");
    expect(text("hours_location")).toContain("1 Fixture Pier");
    expect(text("faq")).not.toContain("1 Fixture Pier");
    expect(text("hero")).not.toContain("Breakfast till noon");
    // With no offerings or form stamp loaded some sections draw nothing: an empty slot each, and the
    // slots AFTER them still hold their own section (the FAQ is after two of them).
    const empty = slots.map((roots, index) => (roots.length === 0 ? home.blocks[index]!.type : null)).filter(Boolean);
    expect(empty).toContain("offering_grid");
    expect(home.blocks.findIndex((block) => block.type === "faq")).toBeGreaterThan(home.blocks.findIndex((block) => block.type === "offering_grid"));
  });

  it("Atelier: a run of reels is one grid owned by its first reel; the other reels keep an empty slot", () => {
    const artifact = upgradeV1ToV2(gogiV1Fixture());
    const base = sitePages(artifact).find((page) => page.path === "")!;
    const reel = (heading: string) => ({ type: "video_feature", variant: "neutral", heading, video_url: "https://videos.example.com/a.mp4", poster_url: "https://images.example.com/a.jpg" });
    const page = { ...base, blocks: [base.blocks[0]!, reel("Reel one"), reel("Reel two"), reel("Reel three"), ...base.blocks.slice(1)] } as unknown as ArtifactPage;
    expect(groupReels(page.blocks).some((group) => group.kind === "reels")).toBe(true);
    const plain = draw(artifact, page);
    const withMarks = draw(artifact, marked(page));
    expect(unmarked(withMarks)).toBe(unmarked(plain));
    document.body.innerHTML = withMarks;
    const slots = findSectionSlots(document, page.blocks.length)!;
    expect(slots).toHaveLength(page.blocks.length);
    expect(slots[1]!.map((root) => root.className)).toEqual(["reel-grid"]);
    expect(slots[1]![0]!.textContent).toContain("Reel three");
    expect(slots[2]).toEqual([]);
    expect(slots[3]).toEqual([]);
    expect(slots[4]!.length).toBeGreaterThan(0);
  });

  it("refuses to pair anything when the count is off (a wrong section is worse than none)", () => {
    const artifact = galleryArtifact("nocturne");
    const home = sitePages(artifact).find((page) => page.path === "")!;
    document.body.innerHTML = draw(artifact, marked(home));
    expect(findSectionSlots(document, home.blocks.length + 1)).toBeNull();
    expect(findSectionSlots(document, home.blocks.length - 1)).toBeNull();
    expect(findSectionSlots(document, 0)).toBeNull();
  });

  const tree = (isMarked: boolean) => (
    <main id="main">
      <PreviewSection marked={isMarked}><section id="one"><h2>One</h2></section></PreviewSection>
      <PreviewSection marked={isMarked}>{null}</PreviewSection>
      <PreviewSection marked={isMarked}><section id="three"><p>Three</p></section><aside id="three-b" /></PreviewSection>
    </main>
  );
  const slotIds = () => findSectionSlots(document, 3)!.map((roots) => roots.map((root) => root.id));

  it("the marker is whitespace only, and the exact HTML is pinned", () => {
    expect(PREVIEW_SECTION_MARKER).toBe("\n\t\n");
    expect(PREVIEW_SECTION_MARKER.trim()).toBe("");
    expect(renderToString(tree(true))).toBe('<main id="main">\n\t\n<section id="one"><h2>One</h2></section>\n\t\n<!-- -->\n\t\n<section id="three"><p>Three</p></section><aside id="three-b"></aside></main>');
    expect(renderToString(tree(false))).toBe('<main id="main"><section id="one"><h2>One</h2></section><section id="three"><p>Three</p></section><aside id="three-b"></aside></main>');
    // The static render joins neighbouring markers into one text node; the bridge still counts both.
    document.body.innerHTML = renderToStaticMarkup(tree(true));
    expect(slotIds()).toEqual([["one"], [], ["three", "three-b"]]);
  });

  it("the marks are in the page after React takes over the server's HTML, with no hydration error", async () => {
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    host.innerHTML = renderToString(tree(true));
    const errors: unknown[] = [];
    const root = await act(async () => hydrateRoot(host, tree(true), { onRecoverableError: (error) => errors.push(error) }));
    expect(errors).toEqual([]);
    expect(slotIds()).toEqual([["one"], [], ["three", "three-b"]]);
    // No element was added: the sections are still the container's only element children.
    expect(Array.from(document.getElementById("main")!.children).map((child) => child.id)).toEqual(["one", "three", "three-b"]);
    act(() => root.unmount());
  });

  it("the marks are in the page when React draws it again in the browser (a disagreement with the server's HTML)", async () => {
    // What React does after a hydration mismatch anywhere on the page: it throws the server's DOM away and renders afresh.
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const root = createRoot(host);
    await act(async () => root.render(tree(true)));
    expect(slotIds()).toEqual([["one"], [], ["three", "three-b"]]);
    expect(Array.from(document.getElementById("main")!.children).map((child) => child.id)).toEqual(["one", "three", "three-b"]);
    // And a real mismatch recovers to a marked page.
    const mismatched = document.createElement("div");
    document.body.replaceChildren(mismatched);
    mismatched.innerHTML = renderToString(tree(true)).replace("<h2>One</h2>", "<h2>Server said something else</h2>");
    const errors: unknown[] = [];
    const recovered = await act(async () => hydrateRoot(mismatched, tree(true), { onRecoverableError: (error) => errors.push(error) }));
    expect(errors.length).toBeGreaterThan(0);
    expect(document.getElementById("one")!.textContent).toBe("One");
    expect(slotIds()).toEqual([["one"], [], ["three", "three-b"]]);
    act(() => { root.unmount(); recovered.unmount(); });
  });
});
