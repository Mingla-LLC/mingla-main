/**
 * issue #4522 (rework N10) — a schema-probe error that is not "does not
 * exist" never skips the whole cron run and is never read as "schema
 * present": this run skips only the v2 steps (notices, the flexible-payment
 * check, the overpayment lane), counts that loudly in the summary, and the
 * pre-#4522 reconcile and charging passes still run without the kind filter.
 *
 * FAILS-ON-REVERT: restore the early `return result` on a probe failure ->
 * the reconcile and due queries never run -> red.
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { processScheduledInstallments } from "../index.ts";
import { fakeSupabase } from "../../_shared/installments/__tests__/issue_3645_fake_supabase.ts";
import { resetPlanV2SchemaProbeForTests } from "../../_shared/installments/planV2Schema.ts";

Deno.test("N10 a probe outage fails only the v2 steps; reconcile and charging run on the old path", async () => {
  resetPlanV2SchemaProbeForTests();
  const fake = fakeSupabase({
    rpc: (name) =>
      name === "issue_4522_plan_v2_enabled"
        ? { data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } as { message: string } }
        : { data: [], error: null },
    table: () => ({ data: [], error: null }),
  });
  // deno-lint-ignore no-explicit-any
  const result = await processScheduledInstallments(fake.client as any, {});
  assertEquals(result.errors, [{ installment_id: "scheduler", reason: "schema_probe_failed" }]);
  assertEquals(result.v2_steps_skipped, ["notices", "flex_verify", "overpayment_refunds"]);
  const selects = fake.tableOps.filter((op) => op.kind === "select");
  // the reconcile pass read the open attempts; the charge pass read due and retry rows
  assertEquals(selects.some((op) => op.table === "order_installment_charge_attempts"), true);
  assertEquals(
    selects.filter((op) => op.table === "order_installments" &&
      op.filters.some((f) => f[1] === "status" && (f[2] === "scheduled" || f[2] === "failed"))).length >= 2,
    true,
  );
  // never read as "present": no kind filter, no v2 RPC, no notices query
  assertEquals(fake.tableOps.some((op) => op.filters.some((f) => f[1] === "kind")), false);
  assertEquals(fake.rpcCalls.some((c) => c.name.startsWith("issue_4522_") && c.name !== "issue_4522_plan_v2_enabled"), false);
  assertEquals(fake.tableOps.some((op) => op.filters.some((f) => f[1] === "pre_charge_notice_sent_at")), false);
  resetPlanV2SchemaProbeForTests();
});
