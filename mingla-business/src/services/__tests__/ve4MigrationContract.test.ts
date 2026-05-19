import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const MIGRATION = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "20260622000000_ve4_claimed_venues_public_view.sql",
);

describe("Ve4 claimed_venues_public_view (migration contract)", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  test("view filters verified physical non-deleted brands", () => {
    expect(sql).toContain("CREATE OR REPLACE VIEW public.claimed_venues_public_view");
    expect(sql).toMatch(/kind\s*=\s*'physical'/);
    expect(sql).toMatch(/claim_status\s*=\s*'verified'/);
    expect(sql).toMatch(/deleted_at IS NULL/);
  });

  test("projects hours aggregate and pool photos without claim internals", () => {
    expect(sql).toContain("brand_hours");
    expect(sql).toContain("pool_photo_urls");
    expect(sql).toContain("venue_category");
    expect(sql).not.toMatch(/\bclaim_status\b.*AS/);
    expect(sql).not.toMatch(/\bverified_by\b/);
    expect(sql).not.toMatch(/\bverified_at\b/);
    expect(sql).not.toMatch(/\baccount_id\b/);
  });

  test("grants anon select and adds public RLS for verified venues", () => {
    expect(sql).toContain(
      "GRANT SELECT ON public.claimed_venues_public_view TO anon",
    );
    expect(sql).toContain("Public can read verified physical venues");
    expect(sql).toContain("Public can read hours for verified physical venues");
    expect(sql).toContain("Public can read place_pool for verified physical venues");
  });
});
