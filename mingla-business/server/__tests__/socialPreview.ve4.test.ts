import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

declare const require: <T = unknown>(path: string) => T;

const { renderBrandHtml } = require("../socialPreview") as {
  renderBrandHtml: (input: {
    brand: Record<string, unknown>;
    events: Record<string, unknown>[];
    venue?: Record<string, unknown> | null;
  }) => string;
};

const brand = {
  id: "brand-1",
  slug: "brand-3",
  name: "Brand 3",
  description: "Small-room popups and careful hosting.",
  profile_photo_url: null,
  cover_media_url: null,
  cover_media_type: null,
};

describe("Ve4 social preview render", () => {
  test("renders verified venue brand metadata with city in title", () => {
    const html = renderBrandHtml({
      brand: {
        ...brand,
        slug: "joes-pizza",
        name: "Joe's Pizza",
        description: "Neighbourhood slice shop.",
        kind: "physical",
        city: "Brooklyn",
      },
      venue: {
        kind: "physical",
        city: "Brooklyn",
      },
      events: [],
    });

    expect(html).toContain("Joe&#39;s Pizza · Brooklyn on Mingla</title>");
    expect(html).toContain("No upcoming events from this venue");
  });
});

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
