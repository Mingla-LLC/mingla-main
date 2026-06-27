import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/assert_string_includes.ts";
import { assert } from "https://deno.land/std@0.224.0/assert/assert.ts";

const MIGRATION = Deno.readTextFileSync(
  new URL("../20261128000000_orch_1240_issue_668_dual_account_deletion.sql", import.meta.url),
);

Deno.test("ORCH-1240 migration adds explorer_deleted_at", () => {
  assertStringIncludes(MIGRATION, "explorer_deleted_at");
});

Deno.test("ORCH-1240 migration fixes events_created_by_fkey to SET NULL", () => {
  assertStringIncludes(MIGRATION, "events_created_by_fkey");
  assertStringIncludes(MIGRATION, "ON DELETE SET NULL");
  assert(!MIGRATION.includes("marketing_campaigns") || !/marketing_campaigns[\s\S]*ON DELETE RESTRICT/.test(MIGRATION));
});

Deno.test("ORCH-1240 migration relaxes manual_buyer_reminders actor FK", () => {
  assertStringIncludes(MIGRATION, "manual_buyer_reminders_sent_by_user_id_fkey");
});
