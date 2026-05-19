/**
 * ORCH-0881 — migration contract for hub pending actions extension.
 */
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
  "20260623000000_orch_0881_ve5_hub_pending_actions.sql",
);

describe("ORCH-0881 migration contract", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  test("extends agent_pending_actions with hub source columns", () => {
    expect(sql).toMatch(/ALTER COLUMN conversation_id DROP NOT NULL/);
    expect(sql).toMatch(/source text NOT NULL DEFAULT 'ari'/);
    expect(sql).toMatch(/hub_experience/);
    expect(sql).toMatch(/related_brand_id/);
    expect(sql).toMatch(/idx_agent_pending_hub_experience/);
  });
});
