// ORCH-0921 [Trip payment-plan finalize drops installments] migration tests.
//
// Run with:
//   deno test --allow-read supabase/functions/_shared/__tests__/orch_0921_compare_and_correct.test.ts

import {
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20260724000000_orch_0921_finalize_compare_and_correct.sql",
    import.meta.url,
  ),
);

Deno.test("ORCH-0921 T-05 - finalize compare-and-correct writes missing installment rows for half-finalized order", () => {
  assertMatch(
    migration,
    /IF\s+p_installment_plan_root[\s\S]*?v_session\.installment_schedule\s+IS\s+NOT\s+NULL[\s\S]*?p_stripe_customer_id_on_connected_account\s+IS\s+NOT\s+NULL[\s\S]*?p_saved_payment_method_id\s+IS\s+NOT\s+NULL/i,
    "self-heal branch must require plan-root, persisted schedule, Stripe Customer, and saved PM.",
  );
  assertMatch(
    migration,
    /EXISTS\s*\([\s\S]*?FROM\s+public\.orders[\s\S]*?id\s*=\s*v_session\.order_id[\s\S]*?installment_plan_root\s*=\s*false[\s\S]*?\)/i,
    "self-heal branch must only repair orders still marked installment_plan_root=false.",
  );
  assertStringIncludes(migration, "INSERT INTO public.order_installments");
  assertStringIncludes(migration, "v_session.order_id,");
  assertStringIncludes(migration, "(v_inst_item ->> 'ordinal')::smallint");
  assertStringIncludes(migration, "v_inst_amount");
  assertStringIncludes(migration, "v_inst_due");
});

Deno.test("ORCH-0921 T-06 - finalize compare-and-correct is idempotent after self-heal", () => {
  assertMatch(
    migration,
    /AND\s+NOT\s+EXISTS\s*\([\s\S]*?SELECT\s+1\s+FROM\s+public\.order_installments[\s\S]*?WHERE\s+order_id\s*=\s*v_session\.order_id[\s\S]*?\)/i,
    "self-heal branch must not insert duplicates once installments exist.",
  );
  assertMatch(
    migration,
    /UPDATE\s+public\.orders[\s\S]*?SET\s+installment_plan_root\s*=\s*true[\s\S]*?stripe_customer_id_on_connected_account\s*=\s*p_stripe_customer_id_on_connected_account[\s\S]*?saved_payment_method_id\s*=\s*p_saved_payment_method_id/i,
    "self-heal branch must flip the root flag and persist Customer/PM once.",
  );
});

Deno.test("ORCH-0921 T-07 - finalized orders still return existing data without legacy path regression", () => {
  assertMatch(
    migration,
    /IF\s+v_session\.order_id\s+IS\s+NOT\s+NULL\s+THEN[\s\S]*?SELECT\s+COALESCE\(jsonb_agg\(jsonb_build_object\([\s\S]*?FROM\s+public\.tickets\s+t[\s\S]*?WHERE\s+t\.order_id\s*=\s*v_session\.order_id/i,
    "existing-order path must still return the order's tickets.",
  );
  assertMatch(
    migration,
    /'installmentPlanRoot'\s*,\s*\(\s*SELECT\s+installment_plan_root\s+FROM\s+public\.orders\s+WHERE\s+id\s*=\s*v_session\.order_id\s*\)/i,
    "existing-order response must expose the possibly self-healed root flag.",
  );
  assertMatch(
    migration,
    /IF\s+\(SELECT\s+COUNT\(\*\)\s+FROM\s+pg_proc\s+WHERE\s+proname\s*=\s*'biz_ticket_checkout_finalize'\s+AND\s+pronargs\s*=\s*8\)\s*<>\s*1\s+THEN/i,
    "migration self-verification must assert exactly one 8-param finalize overload.",
  );
});
