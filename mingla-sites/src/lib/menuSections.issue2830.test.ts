import { describe, expect, it } from "vitest";

import { menuSectionSlug, sectionForHash } from "./menuSections";

describe("#2830 menu section anchors", () => {
  it("produces the slugs gögi's own site already links at", () => {
    // These four fragments exist on their live homepage. If this rule changes,
    // every link they have published breaks.
    expect(menuSectionSlug("Rice bowls")).toBe("rice-bowls");
    expect(menuSectionSlug("Flat burgers")).toBe("flat-burgers");
    expect(menuSectionSlug("Shawarmas")).toBe("shawarmas");
    expect(menuSectionSlug("Cocktails")).toBe("cocktails");
  });

  it("collapses punctuation and never leaves a dangling separator", () => {
    expect(menuSectionSlug("Sides & extras")).toBe("sides-extras");
    expect(menuSectionSlug("  Chef's picks!  ")).toBe("chef-s-picks");
    expect(menuSectionSlug("---")).toBe("");
  });

  it("folds accents so one section cannot yield two anchors", () => {
    expect(menuSectionSlug("Entrées")).toBe(menuSectionSlug("Entrees"));
    expect(menuSectionSlug("Entrées")).toBe("entrees");
  });

  it("matches a fragment to its section, case-insensitively", () => {
    const sections = ["all", "Rice bowls", "Cocktails"];
    expect(sectionForHash("#rice-bowls", sections)).toBe("Rice bowls");
    expect(sectionForHash("#RICE-BOWLS", sections)).toBe("Rice bowls");
    expect(sectionForHash("rice-bowls", sections)).toBe("Rice bowls");
  });

  it("returns null rather than guessing", () => {
    const sections = ["all", "Rice bowls"];
    expect(sectionForHash("", sections)).toBeNull();
    expect(sectionForHash("#", sections)).toBeNull();
    expect(sectionForHash("#does-not-exist", sections)).toBeNull();
  });
});
