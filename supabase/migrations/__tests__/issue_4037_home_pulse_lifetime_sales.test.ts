import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const sql = await Deno.readTextFile(
  "supabase/migrations/20280106004037_issue_4037_home_pulse_lifetime_sales.sql",
);

Deno.test("#4037 payout screen exposes ledger-wide lifetime sales per currency", () => {
  const lifetimeBlock = sql.slice(
    sql.indexOf("SELECT COALESCE(jsonb_object_agg"),
    sql.indexOf("SELECT COALESCE(sum(i.gross_cents)"),
  );
  assertStringIncludes(sql, "'lifetime_sales_cents',v_lifetime_sales");
  assertStringIncludes(sql, "FROM public.payout_release_items i");
  assertStringIncludes(
    sql,
    "JOIN public.brand_payout_releases r ON r.id=i.release_id",
  );
  assertStringIncludes(
    sql,
    "sum(i.gross_cents::bigint-i.refunded_cents::bigint)",
  );
  assertStringIncludes(sql, "GROUP BY upper(r.currency)");
  assertFalse(
    /r\.currency\s*=\s*v_currency/i.test(lifetimeBlock),
    "lifetime sales must include every currency rather than only the payout-screen currency",
  );
});

Deno.test("#4037 migration changes only the payout-screen function", () => {
  assertEquals(
    (sql.match(/CREATE OR REPLACE FUNCTION/gi) ?? []).length,
    1,
  );
  assertEquals(
    (sql.match(/CREATE OR REPLACE FUNCTION public\.brand_get_payout_screen/gi) ?? [])
      .length,
    1,
  );
  assertFalse(/\b(CREATE|ALTER|DROP)\s+TABLE\b/i.test(sql));
});
