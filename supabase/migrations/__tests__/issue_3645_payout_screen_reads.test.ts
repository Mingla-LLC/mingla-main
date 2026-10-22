import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  "supabase/migrations/20271213033645_issue_3645_payout_screen_reads.sql",
);

Deno.test("#3645 payout reads are display-only and never expose provider fees", () => {
  assertStringIncludes(
    sql,
    "CREATE OR REPLACE FUNCTION public.brand_get_payout_screen",
  );
  assertStringIncludes(
    sql,
    "CREATE OR REPLACE FUNCTION public.admin_list_payouts",
  );
  assertStringIncludes(sql, "LANGUAGE plpgsql STABLE SECURITY DEFINER");
  assertStringIncludes(
    sql,
    "provider processing cost is intentionally not a host deduction",
  );
  assertFalse(sql.includes("'provider_fee_cents', provider_fee_cents"));
  assertFalse(
    /\b(UPDATE|INSERT INTO|DELETE FROM)\s+public\.brand_payout_releases\b/i
      .test(sql),
  );
  assertFalse(sql.includes("stripe.payouts.create"));
  assertFalse(sql.includes("paystack" + "Transfer.create"));
});

Deno.test("#3645 host state starts late at due plus eight hours", () => {
  assertStringIncludes(sql, "p_releasable_at + interval '8 hours' <= p_as_of");
  assertStringIncludes(sql, "THEN 'late_on_us'");
  assertStringIncludes(sql, "WHEN p_status = 'released' THEN 'paid'");
  assertStringIncludes(sql, "WHEN p_paused THEN 'paused'");
  assert(
    sql.indexOf("WHEN p_status = 'released' THEN 'paid'") <
      sql.indexOf("WHEN p_paused THEN 'paused'"),
    "a current admin hold must not relabel historical paid rows",
  );
});

Deno.test("#3645 unified admin console names both rails, blockers and credits", () => {
  for (
    const token of [
      "r.provider",
      "waiting_for_bank_count",
      "transfer_fee_credits_owed_by_currency",
      "count_by_state",
      "The connected balance is short",
    ]
  ) assertStringIncludes(sql, token);
  assertEquals(
    (sql.match(/CREATE OR REPLACE FUNCTION public\.admin_list_payouts/g) ?? [])
      .length,
    1,
  );
});
