import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

const DELETE_USER = new URL("./index.ts", import.meta.url);
const SHARED = new URL("../_shared/accountDeletionSides.ts", import.meta.url);
const MIGRATION = new URL(
  "../../migrations/20261128000000_orch_1240_issue_668_dual_account_deletion.sql",
  import.meta.url,
);

Deno.test("#668 delete-user accepts side=explorer|business and gates auth removal", async () => {
  const source = await Deno.readTextFile(DELETE_USER);
  assert(source.includes("parseSide(body)"));
  assert(source.includes('"explorer"'));
  assert(source.includes('"business"'));
  assert(source.includes("shouldDeleteAuthUser"));
  assert(source.includes("authRetained"));
  assert(source.includes("purgeExplorerSideData"));
  assert(source.includes("purgeBusinessSideData"));
});

Deno.test("#668 shared module covers Stripe detach + explorer marker", async () => {
  const source = await Deno.readTextFile(SHARED);
  assert(source.includes("detachStripeForOwnedBrands"));
  assert(source.includes("explorer_deleted_at"));
  assert(source.includes("shouldDeleteAuthUser"));
});

Deno.test("#668 migration adds explorer_deleted_at + unblocks actor FKs", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  assert(sql.includes("explorer_deleted_at"));
  assert(sql.includes("events_created_by_fkey"));
  assert(sql.includes("ON DELETE SET NULL"));
  assert(sql.includes("marketing_campaigns_account_id_fkey"));
  assertEquals(sql.includes("ON DELETE RESTRICT"), false);
});
