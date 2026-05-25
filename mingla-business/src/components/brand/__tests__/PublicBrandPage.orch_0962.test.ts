import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pageSrc = readFileSync(
  join(__dirname, "..", "PublicBrandPage.tsx"),
  "utf8",
);

describe("ORCH-0962 PublicBrandPage happy paths", () => {
  test("T-07 SocialLinksRow renders the facebook icon entry", () => {
    expect(pageSrc).toContain("links.facebook !== undefined");
    expect(pageSrc).toContain('icon: "facebook"');
    expect(pageSrc).toContain('label: "Facebook"');
  });

  test("T-08 SocialLinksRow renders the linkedin icon entry", () => {
    expect(pageSrc).toContain("links.linkedin !== undefined");
    expect(pageSrc).toContain('icon: "linkedin"');
    expect(pageSrc).toContain('label: "LinkedIn"');
  });

  test("T-09 renders tagline and bio as distinct styled text nodes", () => {
    const taglineIndex = pageSrc.indexOf("styles.taglineCentered");
    const bioIndex = pageSrc.indexOf("styles.bioLeadCentered");

    expect(taglineIndex).toBeGreaterThan(-1);
    expect(bioIndex).toBeGreaterThan(-1);
    expect(taglineIndex).toBeLessThan(bioIndex);
    expect(pageSrc).toContain("taglineCentered: {");
  });
});
