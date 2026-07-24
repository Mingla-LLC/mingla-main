import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  "supabase/migrations/20270110000001_issue_1171_dark_payout_ledger.sql",
);
const config = await Deno.readTextFile("supabase/config.toml");

Deno.test("#1171 schema is append-only, rail-neutral, and fee-normalized", () => {
  for (
    const table of [
      "brand_payout_releases",
      "payout_release_items",
      "payout_transfer_legs",
      "payout_ledger_adjustments",
      "organiser_payout_debts",
      "payout_debt_applications",
      "payout_debt_events",
    ]
  ) {
    assertStringIncludes(sql, `CREATE TABLE public.${table}`);
    assertStringIncludes(
      sql,
      `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`,
    );
  }
  assertStringIncludes(sql, "UNIQUE (source_type, source_id)");
  assertStringIncludes(sql, "payout_release_items_append_only");
  assertStringIncludes(sql, "provider_fee_cents integer NOT NULL");
  assertStringIncludes(sql, "CREATE TABLE public.payout_transfer_legs");
  assertStringIncludes(sql, "estimated_fee_cents");
  assertStringIncludes(sql, "stamp_duty_cents");
  assertStringIncludes(sql, "fee_schedule_version");
});

Deno.test("#1171 RPCs enforce live anchors, strict cutover, debt ordering and recovered-only recredit", () => {
  assertStringIncludes(sql, "public.resolve_payout_live_anchor");
  assertStringIncludes(sql, "ed.end_at >= p_finalized_at");
  assertStringIncludes(sql, "max(ed.end_at)");
  assertStringIncludes(sql, "p_finalized_at <= v_cutover");
  assertStringIncludes(sql, "cancelled_event_never_releases");
  assertStringIncludes(sql, "FOR UPDATE SKIP LOCKED");
  assertStringIncludes(sql, "kind <> 'post_release_postponement'");
  assertStringIncludes(sql, "v_debt.recovered_cents,'postpone-recredit:'");
  assertStringIncludes(sql, "v_debt.principal_cents-v_debt.recovered_cents");
  assertStringIncludes(sql, "'postpone:'||v_release.id");
  assertStringIncludes(sql, "'dark',true");
  assertStringIncludes(sql, "'executed',0");
  assertStringIncludes(sql, "FROM anon,authenticated");
});

Deno.test("#1171 cron and gateway contract are explicit and service-role sourced", () => {
  const blocks = [
    ...config.matchAll(
      /\[functions\.payout-release-sweep\][\s\S]*?(?=\n\[|$)/g,
    ),
  ];
  assertEquals(blocks.length, 1);
  assertStringIncludes(blocks[0][0], "verify_jwt = false");
  assertStringIncludes(sql, "issue_1171_payout_release_dark_sweep");
  assertStringIncludes(sql, "'*/30 * * * *'");
  assertStringIncludes(sql, "vault.decrypted_secrets");
  assertStringIncludes(sql, "'Authorization','Bearer ' ||");
  assert(!/\b(payouts|transfers)\.create\s*\(/.test(sql));
});
