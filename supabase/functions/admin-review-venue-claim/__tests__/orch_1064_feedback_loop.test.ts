// ORCH-1064 — IMPLEMENTOR happy-path regression for the admin↔business
// venue-claim feedback loop (backend layer).
//
// Run: deno test --allow-read supabase/functions/admin-review-venue-claim/__tests__/orch_1064_feedback_loop.test.ts
//
// Covers two fails-on-revert axes:
//   (A) the pure edge-fn input/copy logic added to reviewLogic.ts
//       (normalizeFeedbackBody + feedbackPushCopy), which gate the add_feedback
//       branch before the RPC round-trip; and
//   (B) the migration DDL contract — asserts the new table, the three RPCs,
//       the owner-SELECT-only RLS, the security_invoker view, and the bundle
//       feedback extension are present in
//       20260901000000_orch_1064_venue_claim_feedback.sql.
//
// fails-on-revert: removing the migration (axis B) or reverting reviewLogic.ts
// (axis A) makes the corresponding assertions throw.

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  feedbackPushCopy,
  normalizeFeedbackBody,
} from "../reviewLogic.ts";

const BRAND = "11111111-1111-1111-1111-111111111111";

// ─── Axis A: normalizeFeedbackBody (the add_feedback input gate) ─────────────

Deno.test("normalizeFeedbackBody accepts a valid round and trims fields", () => {
  const r = normalizeFeedbackBody({
    brand_id: `  ${BRAND}  `,
    action: "add_feedback",
    items: [
      { category: "photos", note: "  Add an interior shot  " },
      { category: "hours", note: "Confirm Sunday hours" },
    ],
    overall_message: "  Thanks for submitting!  ",
  });
  assertEquals(r.ok, true);
  if (r.ok) {
    assertEquals(r.brandId, BRAND);
    assertEquals(r.items.length, 2);
    assertEquals(r.items[0], { category: "photos", note: "Add an interior shot" });
    assertEquals(r.items[1], { category: "hours", note: "Confirm Sunday hours" });
    assertEquals(r.overallMessage, "Thanks for submitting!");
  }
});

Deno.test("normalizeFeedbackBody requires a brand_id", () => {
  const r = normalizeFeedbackBody({ items: [{ category: "photos", note: "x" }] });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, "brand_id_required");
});

Deno.test("normalizeFeedbackBody rejects an empty items array", () => {
  const r = normalizeFeedbackBody({ brand_id: BRAND, items: [] });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, "items_required");
});

Deno.test("normalizeFeedbackBody rejects an invalid category", () => {
  const r = normalizeFeedbackBody({
    brand_id: BRAND,
    items: [{ category: "menu", note: "x" }],
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, "invalid_category");
});

Deno.test("normalizeFeedbackBody rejects a blank note", () => {
  const r = normalizeFeedbackBody({
    brand_id: BRAND,
    items: [{ category: "photos", note: "   " }],
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, "note_required");
});

Deno.test("normalizeFeedbackBody null overall_message → null (not empty string)", () => {
  const r = normalizeFeedbackBody({
    brand_id: BRAND,
    items: [{ category: "address", note: "Fix the street number" }],
    overall_message: "   ",
  });
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.overallMessage, null);
});

Deno.test("feedbackPushCopy points the owner at the fix surface (F-2 fix)", () => {
  const copy = feedbackPushCopy("Lumen Wine Bar");
  assertEquals(copy.title, "Your venue listing needs a few updates");
  assertStringIncludes(copy.body, "Lumen Wine Bar");
  assertStringIncludes(copy.body, "re-submit");
});

// ─── Axis B: migration DDL contract (fails-on-revert if the migration is gone)

const MIGRATION_PATH = new URL(
  "../../../migrations/20260901000000_orch_1064_venue_claim_feedback.sql",
  import.meta.url,
).pathname;

async function migrationSql(): Promise<string> {
  return await Deno.readTextFile(MIGRATION_PATH);
}

Deno.test("migration creates the venue_claim_feedback table with RLS", async () => {
  const sql = await migrationSql();
  assertStringIncludes(sql, "create table if not exists public.venue_claim_feedback");
  assertStringIncludes(sql, "alter table public.venue_claim_feedback enable row level security");
  // category + status enums + brand FK.
  assertStringIncludes(sql, "'photos','address','hours','category','description','quality','other'");
  assertStringIncludes(sql, "check (status in ('open','fixed'))");
  assertStringIncludes(sql, "references public.brands(id) on delete cascade");
});

Deno.test("migration grants admin-ALL + owner-SELECT only (no owner write policy)", async () => {
  const sql = await migrationSql();
  assertStringIncludes(sql, 'create policy "admin manages venue_claim_feedback"');
  assertStringIncludes(sql, 'create policy "owner reads own venue_claim_feedback"');
  assertStringIncludes(sql, "for select to authenticated");
  // I-1064-RPC-WRITES-ONLY: there must be NO owner insert/update/delete policy.
  assertEquals(sql.includes('for insert to authenticated'), false);
  assertEquals(sql.includes('for update to authenticated'), false);
  assertEquals(sql.includes('for delete to authenticated'), false);
});

Deno.test("migration defines the three SECURITY DEFINER RPCs with pinned search_path", async () => {
  const sql = await migrationSql();
  for (
    const fn of [
      "admin_add_venue_claim_feedback",
      "biz_mark_feedback_item_fixed",
      "biz_resubmit_venue_claim",
    ]
  ) {
    assertStringIncludes(sql, `function public.${fn}`);
  }
  // search_path pinned on each (count >= 4: 3 new RPCs + the bundle extension).
  const pins = sql.match(/set search_path to 'public', 'pg_temp'/g) ?? [];
  assertEquals(pins.length >= 4, true);
  // grant matrix: execute to authenticated, revoke from anon.
  assertStringIncludes(sql, "grant execute on function public.admin_add_venue_claim_feedback(uuid, jsonb, text) to authenticated");
  assertStringIncludes(sql, "from public, anon");
});

Deno.test("migration extends admin_get_claim_review_bundle with a feedback key + security_invoker view + pgrst reload", async () => {
  const sql = await migrationSql();
  assertStringIncludes(sql, "create or replace view public.venue_claim_active_feedback");
  assertStringIncludes(sql, "security_invoker = true");
  assertStringIncludes(sql, "create or replace function public.admin_get_claim_review_bundle(p_brand_id uuid)");
  assertStringIncludes(sql, "'feedback', v_feedback");
  assertStringIncludes(sql, "notify pgrst, 'reload schema'");
});
