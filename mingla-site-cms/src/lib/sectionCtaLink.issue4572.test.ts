// MINGLA-INVARIANT: I-4572-CTA-NO-DEAD-PLACEHOLDER | issue #4572 | an owner-created CTA never stores "/" as a placeholder; the owner can set only a page on this site or a secure Mingla /b/ or /e/ URL, and no target means no public button.
import { describe, expect, it } from "vitest";
import {
  applyEdits,
  sectionFields,
  starterSection,
} from "./sectionActions";

const make = () => starterSection("cta", "atelier", null).block;

describe("#4572 owner CTA target", () => {
  it("starts without the old dead home target and exposes a link field to the owner only", () => {
    const block = make();
    expect(block).not.toHaveProperty("href");
    expect(sectionFields(block, "user")).toContainEqual({
      key: "href",
      label: "Button link",
      kind: "mingla_link",
      value: "",
      max: 2048,
    });
    expect(sectionFields(block, "ari").map((field) => field.key)).not.toContain(
      "href",
    );
  });

  it.each([
    "/about",
    "/about?ref=host#start",
    "https://host.usemingla.com/b/young-and-stamped",
    "https://host.usemingla.com/e/young-and-stamped/friday-night",
  ])("saves the safe target %s", (href) => {
    expect(
      applyEdits(make(), [{ key: "href", value: href }], "user").block.href,
    ).toBe(href);
  });

  it.each([
    "/",
    "/./",
    "/?x=1",
    "/#x",
    "/about/..",
    "/about/../contact",
    "/%2e",
    "/%2e%2e/",
    "/\\evil.com",
    "//evil.com",
    "https://tickets.example/book",
    "https://evil.host.usemingla.com/b/young-and-stamped",
    "https://person@host.usemingla.com/b/young-and-stamped",
    "https://host.usemingla.com:444/b/young-and-stamped",
    "https://host.usemingla.com/b",
    "https://host.usemingla.com/e/",
    "https://host.usemingla.com/t/young-and-stamped/trip",
    "javascript:alert(1)",
  ])("refuses the dead or outside target %s", (href) => {
    expect(() =>
      applyEdits(make(), [{ key: "href", value: href }], "user"),
    ).toThrow("VALIDATION_FAILED");
  });

  it("clearing a target stores null, so the renderer can hide the button", () => {
    const withLink = { ...make(), href: "/about" };
    expect(
      applyEdits(withLink, [{ key: "href", value: "  " }], "user").block.href,
    ).toBeNull();
  });
});
