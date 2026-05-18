import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("Ve1 public brand visibility (migration contract)", () => {
  test("business_public_brands_view keeps unverified physical brands hidden", () => {
    const migration = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "supabase",
        "migrations",
        "20260613000000_ve1_physical_venue_brand_onboarding.sql",
      ),
      "utf8",
    );
    expect(migration).toContain("business_public_brands_view");
    expect(migration).toMatch(/physical.*claim_status\s*=\s*'verified'/s);
  });
});
