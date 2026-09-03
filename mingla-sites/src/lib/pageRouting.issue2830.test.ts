import { describe, expect, it } from "vitest";
import {
  RESERVED_SLUGS,
  hrefForPage,
  isRoutableSlug,
  navigablePages,
  pageForSlug,
} from "./pageRouting";
import type { RestaurantArtifact } from "../contracts/artifact";

const page = (
  role: RestaurantArtifact["pages"][number]["role"],
  slug: string,
  nav_order: number,
  enabled = true,
) => ({
  role,
  slug,
  title: role,
  enabled,
  nav_label: role,
  nav_order,
  blocks: [],
});

const artifact = {
  pages: [
    page("contact", "contact", 4),
    page("home", "home", 0),
    page("menu", "menu", 2),
    page("about", "about", 1),
    page("gallery", "gallery", 3, false),
  ],
} as unknown as RestaurantArtifact;

describe("#2830 real pages, not anchors", () => {
  it("home is / and every other page is its own path", () => {
    expect(hrefForPage(page("home", "home", 0))).toBe("/");
    expect(hrefForPage(page("menu", "menu", 2))).toBe("/menu");
  });

  it("navigation follows the brand's order and drops disabled pages", () => {
    expect(navigablePages(artifact).map((p) => p.role)).toEqual([
      "home",
      "about",
      "menu",
      "contact",
    ]);
  });

  it("resolves a slug to its page, and unknown slugs to null", () => {
    expect(pageForSlug(artifact, "menu")?.role).toBe("menu");
    expect(pageForSlug(artifact, "gallery")).toBeNull();
    expect(pageForSlug(artifact, "nope")).toBeNull();
    expect(pageForSlug(artifact, "home")).toBeNull();
  });

  it("NEVER routes a slug the runtime already owns", () => {
    // A restaurant calling a page "Preview" is entirely plausible, and the
    // private preview route would have swallowed it with no error anywhere.
    for (const reserved of RESERVED_SLUGS) {
      expect(isRoutableSlug(reserved)).toBe(false);
      expect(pageForSlug(artifact, reserved)).toBeNull();
    }
  });

  it("refuses slugs that are not simple lowercase paths", () => {
    for (const bad of [
      "../secrets",
      "Menu",
      "menu/extra",
      "menu ",
      "",
      "-menu",
      "menu-",
      "a".repeat(65),
      "men u",
      "menu?x=1",
    ]) expect(isRoutableSlug(bad)).toBe(false);
  });

  it("accepts ordinary multi-word slugs", () => {
    for (const good of ["menu", "our-story", "private-dining", "gogi2"]) {
      expect(isRoutableSlug(good)).toBe(true);
    }
  });
});
