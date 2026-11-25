// MINGLA-INVARIANT: I-4572-BUTTON-TARGETS | issue #4572 | owners and Ari can set every visitor button target; booking actions stay on Mingla, validated informational targets may use the safe external allowlist, and no target means no public button.
import { describe, expect, it } from "vitest";
import {
  applyEdits,
  sectionFields,
  starterSection,
} from "./sectionActions";

const make = () => starterSection("cta", "atelier", null).block;

describe("#4572 owner CTA target", () => {
  it("starts without the old dead home target and exposes a link field to owner and Ari", () => {
    const block = make();
    expect(block).not.toHaveProperty("href");
    expect(sectionFields(block, "user")).toContainEqual({
      key: "href",
      label: "Button link",
      kind: "mingla_link",
      value: "",
      max: 2048,
    });
    expect(sectionFields(block, "ari").map((field) => field.key)).toContain("href");
  });

  it.each([
    "/about",
    "/about?ref=host#start",
    "/",
    "https://host.usemingla.com/b/young-and-stamped",
    "https://host.usemingla.com/e/young-and-stamped/friday-night",
    "https://host.usemingla.com/b/young-and-stamped/v/althaven/book/11111111-1111-4111-8111-111111111111",
    "https://maps.google.com/?q=Althaven",
  ])("saves the safe target %s", (href) => {
    expect(
      applyEdits(make(), [{ key: "href", value: href }], "user").block.href,
    ).toBe(href);
  });

  it.each([
    "/\\evil.com",
    "//evil.com",
    "https://tickets.example/book",
    "https://evil.host.usemingla.com/b/young-and-stamped",
    "https://person@host.usemingla.com/b/young-and-stamped",
    "https://host.usemingla.com:444/b/young-and-stamped",
    "javascript:alert(1)",
  ])("refuses the dead or outside target %s", (href) => {
    expect(() =>
      applyEdits(make(), [{ key: "href", value: href }], "user"),
    ).toThrow("VALIDATION_FAILED");
  });

  it("keeps booking labels on Mingla while Ari can set hero and media-feature targets", () => {
    expect(() => applyEdits(make(), [
      { key: "label", value: "Book a room" },
      { key: "href", value: "https://maps.google.com/?q=Althaven" },
    ], "ari")).toThrow("VALIDATION_FAILED");

    const hero = {
      blockType: "hero", heading: "Work your way", ctas: [{ label: "Book", href: "/" }],
    };
    expect(sectionFields(hero, "ari").map((field) => field.key)).toContain("ctas.0.href");
    expect(applyEdits(hero, [{ key: "ctas.0.href", value: "https://host.usemingla.com/b/althaven/v/althaven/book/11111111-1111-4111-8111-111111111111" }], "ari").block.ctas[0].href)
      .toContain("/book/");
    expect(() => applyEdits(hero, [{ key: "ctas.0.href", value: "https://maps.google.com/?q=Althaven" }], "ari"))
      .toThrow("VALIDATION_FAILED");

    const directions = {
      blockType: "hero", heading: "Find us", ctas: [{ label: "Directions", href: "/contact" }],
    };
    expect(applyEdits(directions, [{ key: "ctas.0.href", value: "https://maps.google.com/?q=Althaven" }], "ari").block.ctas[0].href)
      .toContain("maps.google.com");

    const feature = { blockType: "media_feature", cta_label: "Directions", cta_href: null };
    expect(sectionFields(feature, "ari").map((field) => field.key)).toContain("cta_href");
    expect(applyEdits(feature, [{ key: "cta_href", value: "https://maps.google.com/?q=Althaven" }], "ari").block.cta_href)
      .toContain("maps.google.com");
  });

  it("clearing a target stores null, so the renderer can hide the button", () => {
    const withLink = { ...make(), href: "/about" };
    expect(
      applyEdits(withLink, [{ key: "href", value: "  " }], "user").block.href,
    ).toBeNull();
  });
});
