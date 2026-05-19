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
  "20260618000000_ve2_pool_match_claim.sql",
);

describe("Ve2 migration contract", () => {
  test("allows duplicate pending_review per google_place_id", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("idx_brands_google_place_id_verified_unique");
    expect(sql).toMatch(/claim_status\s*=\s*'verified'/);
    expect(sql).not.toMatch(
      /claim_status IN \('pending_review', 'verified'\)/,
    );
  });

  test("create RPC accepts place_pool_id", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toContain("p_place_pool_id uuid");
    expect(sql).toContain("place_pool_google_place_id_mismatch");
  });
});
