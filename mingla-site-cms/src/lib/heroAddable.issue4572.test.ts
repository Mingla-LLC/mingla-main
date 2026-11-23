/*
 * #4572 item 8 (D4) — Home can get a cover from Add section and from
 * Design → Cover: it replaces a leading colour panel and keeps its heading;
 * a second cover, another page or a lower position is refused.
 * FAILS-ON-REVERT: without "hero" in ADDABLE_SECTION_TYPES the catalog has no
 * Cover, and without blocksWithHomeCover a cover is spliced anywhere.
 */
import { describe, expect, it } from "vitest";
import { ADDABLE_SECTION_TYPES, blocksWithHomeCover, SECTION_TYPES_NEEDING_PHOTO, sectionCatalog } from "./sectionActions";

const home = { id: "p1", slug: "", parent: null };
const cover = { id: "c1", blockType: "hero", heading: "Add a heading", media: "m1", ctas: [] };
const refusal = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error as { code?: string; extra?: { problems?: string[] } } & Error;
  }
  throw new Error("expected a refusal");
};

describe("#4572 item 8 — a cover on Home", () => {
  it("Cover is addable, needs a photo, and is called Cover", () => {
    expect(ADDABLE_SECTION_TYPES).toContain("hero");
    expect(SECTION_TYPES_NEEDING_PHOTO.has("hero")).toBe(true);
    expect(sectionCatalog("maison", "user").find((entry) => entry.type === "hero")).toMatchObject({ label: "Cover", needs_photo: true });
  });

  it("replaces the colour panel and keeps its heading", () => {
    const blocks = blocksWithHomeCover(home, [{ id: "h", blockType: "page_header", heading: "Kolanut Gallery" }, { id: "e", blockType: "offering_grid" }], cover, 0);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ blockType: "hero", heading: "Kolanut Gallery", media: "m1" });
    expect(blocks[1]).toMatchObject({ blockType: "offering_grid" });
  });

  it("goes first when Home starts with something else", () => {
    const blocks = blocksWithHomeCover(home, [{ id: "e", blockType: "offering_grid" }], cover, 0);
    expect(blocks.map((block) => block.blockType)).toEqual(["hero", "offering_grid"]);
  });

  it("refuses a second cover, another page and any position but the top", () => {
    expect(refusal(() => blocksWithHomeCover(home, [cover], cover, 0)).message).toBeTruthy();
    expect(refusal(() => blocksWithHomeCover({ id: "p2", slug: "visit", parent: null }, [], cover, 0)).message).toBeTruthy();
    expect(refusal(() => blocksWithHomeCover(home, [{ id: "e", blockType: "offering_grid" }], cover, 1)).message).toBeTruthy();
  });
});
