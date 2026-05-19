import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("Ve4 social preview fetch", () => {
  const src = readFileSync(
    join(__dirname, "..", "socialPreview.js"),
    "utf8",
  );

  test("fetchPublicBrandBySlug prefers claimed_venues_public_view", () => {
    expect(src).toContain("claimed_venues_public_view");
    expect(src).toMatch(
      /fetchPublicBrandBySlug[\s\S]*claimed_venues_public_view[\s\S]*business_public_brands_view/,
    );
  });
});
