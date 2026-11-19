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
 *   2. With a section list, the HTML is THE SAME HTML plus React boundary
 *      comments: delete the comments and the two documents are equal,
 *      character for character. A comment has no box and no selector sees it
 *      (`>`, `+`, `:first-child`, `:nth-child`), so equal-minus-comments means
 *      equal pixels. (Before this change shipped, the unmarked HTML of all 93
 *      fixture pages was also compared, hash for hash, with the HTML the
 *      previous commit produced: identical.)
 *   3. The comments pair with the page's blocks one for one, including a
 *      block that draws nothing, so the n-th boundary IS the n-th section.
 * And the marks survive React taking over the page (hydration), which is
 * when the bridge reads them.
 */
import { act, type ReactElement } from "react";
import { hydrateRoot } from "react-dom/client";
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
import { PreviewSection } from "./PreviewSection";
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
const BOUNDARY = /<!--\/?\$-->/g;

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

    it.each(pages.map((page) => [page.path || "(home)", page.path] as const))("/%s: no list, no marks; with a list, the same HTML plus comments", (_label, path) => {
      const artifact = make();
      const page = sitePages(artifact).find((candidate) => candidate.path === path)!;
      const plain = draw(artifact, page);
      // 1. A page with no section list carries nothing of the workspace.
      expect(plain).not.toMatch(BOUNDARY);
      expect(plain).not.toContain("data-mingla-section");
      // 2. The marked page is the same page: only comments were added.
      const withMarks = draw(artifact, marked(page));
      expect(withMarks).not.toContain("data-mingla-section");
      expect(withMarks.replace(BOUNDARY, "")).toBe(plain);
      expect(withMarks.length).toBeGreaterThan(plain.length);
      // The static render (the design goldens' input) is the same document either way.
      expect(draw(artifact, marked(page), renderToStaticMarkup)).toBe(draw(artifact, page, renderToStaticMarkup));
      // 3. One boundary per block, in block order, where the bridge looks for them.
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

  it("pairs each boundary with its own block on a gallery Home (a block that draws nothing keeps its place)", () => {
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
    expect(withMarks.replace(BOUNDARY, "")).toBe(plain);
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

  it("the marks are still in the page after React takes it over (they are what the bridge reads)", async () => {
    const tree = (
      <main id="main">
        <PreviewSection marked><section id="one"><h2>One</h2></section></PreviewSection>
        <PreviewSection marked>{null}</PreviewSection>
        <PreviewSection marked><section id="three"><p>Three</p></section><aside id="three-b" /></PreviewSection>
      </main>
    );
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    host.innerHTML = renderToString(tree);
    // This pins the exact markers React writes: if a React upgrade changes them, this fails before a preview does.
    expect(host.innerHTML).toBe('<main id="main"><!--$--><section id="one"><h2>One</h2></section><!--/$--><!--$--><!--/$--><!--$--><section id="three"><p>Three</p></section><aside id="three-b"></aside><!--/$--></main>');
    const errors: unknown[] = [];
    const root = await act(async () => hydrateRoot(host, tree, { onRecoverableError: (error) => errors.push(error) }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(errors).toEqual([]);
    const slots = findSectionSlots(document, 3)!;
    expect(slots.map((roots) => roots.map((root) => root.id))).toEqual([["one"], [], ["three", "three-b"]]);
    // Unmarked, the same tree is the same elements with no comments at all.
    expect(renderToString(
      <main id="main">
        <PreviewSection marked={false}><section id="one"><h2>One</h2></section></PreviewSection>
        <PreviewSection marked={false}>{null}</PreviewSection>
        <PreviewSection marked={false}><section id="three"><p>Three</p></section><aside id="three-b" /></PreviewSection>
      </main>,
    )).toBe('<main id="main"><section id="one"><h2>One</h2></section><section id="three"><p>Three</p></section><aside id="three-b"></aside></main>');
    act(() => root.unmount());
  });
});
