import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("Ve4 PublicBrandPage anon tolerance", () => {
  const pageSrc = readFileSync(
    join(__dirname, "..", "PublicBrandPage.tsx"),
    "utf8",
  );
  const routeSrc = readFileSync(
    join(__dirname, "..", "..", "..", "..", "app", "b", "[brandSlug]", "index.tsx"),
    "utf8",
  );

  test("PublicBrandPage does not call useAuth (buyer /b/ route)", () => {
    expect(pageSrc).not.toMatch(/\buseAuth\b/);
    expect(pageSrc).not.toContain("AuthContext");
  });

  test("route passes venue prop from public brand query", () => {
    expect(routeSrc).toContain("venue={publicBrandQuery.data.venue}");
  });

  test("renders VerifiedBadge only via isVerifiedVenue branch", () => {
    expect(pageSrc).toContain("isVerifiedVenue ? <VerifiedBadge />");
    expect(pageSrc).toContain("VenueHoursTable");
    expect(pageSrc).toContain("VenueLocationPreview");
    expect(pageSrc).toContain("VenuePhotoGallery");
  });
});
