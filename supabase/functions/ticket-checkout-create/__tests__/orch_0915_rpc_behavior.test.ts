import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const migration = await Deno.readTextFile(
  new URL(
    "../../../migrations/20260724000007_orch_0915_pay_in_full_opt_out.sql",
    import.meta.url,
  ),
);

Deno.test("ORCH-0915 RPC has backward-compatible p_payment_plan_choice default and validation", () => {
  assertStringIncludes(
    migration,
    "p_payment_plan_choice text DEFAULT 'auto'",
    "new RPC parameter must default to auto for legacy callers",
  );
  assertStringIncludes(migration, "payment_plan_choice_invalid");
  assertStringIncludes(migration, "('auto', 'full', 'installments')");
});

Deno.test("ORCH-0915 RPC full choice suppresses installment schedule while retaining full total", () => {
  assertStringIncludes(
    migration,
    "p_payment_plan_choice <> 'full'",
    "installment schedule generation must be skipped when buyer chooses full",
  );
  assertStringIncludes(
    migration,
    "v_total := v_deposit_cents::integer",
    "deposit override must remain inside the non-full branch",
  );
  assertStringIncludes(
    migration,
    "WHEN v_installments_out <> '[]'::jsonb THEN",
    "schedule JSON must only persist when generated installments exist",
  );
});

Deno.test("ORCH-0915 RPC preserves mixed-installment cart guard and installment branch", () => {
  assertStringIncludes(migration, "ticket_lines_mixed_with_installments");
  assertStringIncludes(migration, "installmentSchedule");
  assert(
    migration.indexOf("ticket_lines_mixed_with_installments") <
      migration.indexOf("p_payment_plan_choice <> 'full'"),
    "mixed plan cart guard must run before the full-choice schedule suppression branch",
  );
});
