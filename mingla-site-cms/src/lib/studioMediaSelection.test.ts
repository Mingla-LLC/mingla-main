import { describe, expect, it } from "vitest";
import {
  applyStudioMediaSelection,
  referencedStudioMediaIds,
  studioMediaTargets,
} from "./studioMediaSelection";

const mediaA = "00000000-0000-4000-8000-000000000010";
const mediaB = "00000000-0000-4000-8000-000000000011";
const page = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Home",
  role: "home",
  revision: 7,
  blocks: [
    { blockType: "hero", media: mediaA },
    { blockType: "media_feature", media: mediaA, alt: "Dining room" },
    { blockType: "gallery", images: [{ media: mediaA, alt: "Chef plating" }] },
  ],
};

describe("#2830 Studio media draft binding", () => {
  it("lists exact page/block targets and current tenant relationships", () => {
    const targets = studioMediaTargets([page]);
    expect(targets.map((target) => target.label)).toEqual([
      "Home · Hero image",
      "Home · Image feature 2",
      "Home · Gallery image 1",
      "Home · Add gallery image",
    ]);
    expect(targets[0]).toMatchObject({
      expectedRevision: "7",
      decorativeOnly: true,
      currentMediaId: mediaA,
    });
    expect(referencedStudioMediaIds([page])).toEqual(new Set([mediaA]));
  });

  it("writes the READY relationship and alt into the intended draft slot", () => {
    const blocks = applyStudioMediaSelection(page, mediaB, {
      expectedRevision: "7",
      blockIndex: 1,
      field: "media",
      imageIndex: null,
      alt: "  Dining room at night  ",
      decorative: false,
    }) as Array<Record<string, unknown>>;
    expect(blocks[1]).toMatchObject({
      media: mediaB,
      alt: "Dining room at night",
    });
    expect(page.blocks[1]).toMatchObject({ media: mediaA, alt: "Dining room" });
  });

  it("supports an explicit decorative gallery choice as standard empty alt text", () => {
    const blocks = applyStudioMediaSelection(page, mediaB, {
      expectedRevision: "7",
      blockIndex: 2,
      field: "images",
      imageIndex: 0,
      alt: "ignored",
      decorative: true,
    }) as Array<Record<string, unknown>>;
    expect((blocks[2].images as Array<Record<string, unknown>>)[0]).toMatchObject({
      media: mediaB,
      alt: "",
    });
  });

  it("fails closed on stale revisions, bad slots and unlabeled meaningful media", () => {
    const base = {
      expectedRevision: "7",
      blockIndex: 1,
      field: "media" as const,
      imageIndex: null,
      alt: "Dining room",
      decorative: false,
    };
    expect(() => applyStudioMediaSelection(page, mediaB, {
      ...base,
      expectedRevision: "6",
    })).toThrow("REVISION_CONFLICT");
    expect(() => applyStudioMediaSelection(page, mediaB, {
      ...base,
      blockIndex: 9,
    })).toThrow("VALIDATION_FAILED");
    expect(() => applyStudioMediaSelection(page, mediaB, {
      ...base,
      alt: " ",
    })).toThrow("VALIDATION_FAILED");
    expect(() => applyStudioMediaSelection(page, mediaB, {
      ...base,
      blockIndex: 0,
    })).toThrow("VALIDATION_FAILED");
  });
});
