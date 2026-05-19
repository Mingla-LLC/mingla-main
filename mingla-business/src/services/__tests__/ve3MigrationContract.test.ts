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
  "20260619000000_ve3_admin_claim_review.sql",
);

describe("Ve3 migration contract", () => {
  const sql = () => readFileSync(MIGRATION, "utf8");

  test("adds admin review columns on brands", () => {
    const s = sql();
    expect(s).toContain("rejection_reason");
    expect(s).toContain("claim_follow_up_at");
    expect(s).toContain("duplicate_of_brand_id");
    expect(s).toContain("marked_called_at");
    expect(s).toContain("marked_called_by");
    expect(s).toContain("claim_decision_emailed_at");
  });

  test("biz_review_venue_claim supports Ve3 actions", () => {
    const s = sql();
    expect(s).toMatch(
      /mark_called.*approve.*reject.*need_more_info/s,
    );
    expect(s).toContain("must_mark_called_first");
    expect(s).toContain("rejection_reason_required");
    expect(s).toContain("duplicate_of_brand_id = p_brand_id");
    expect(s).toMatch(/RETURNS jsonb/);
  });

  test("approve flags sibling pending claims on same google_place_id", () => {
    const s = sql();
    expect(s).toMatch(/claim_status = 'pending_review'/);
    expect(s).toContain("google_place_id = v_brand.google_place_id");
    expect(s).toContain("duplicate_flagged_count");
  });

  test("rejects approve when another verified brand owns google_place_id", () => {
    expect(sql()).toContain("google_place_already_verified");
  });
});
