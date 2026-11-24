/**
 * issue #4522 (rework N10) — a schema-probe error that is not "does not
 * exist" never skips the whole cron run and is never read as "schema
 * present": this run skips only the v2 steps (notices, the flexible-payment
 * check, the overpayment lane), counts that loudly in the summary, and the
 * pre-#4522 reconcile and charging passes still run without the kind filter.
 * T3-8: the probe first asks the table itself; only when that read fails
 * too is the run degraded like this. When the switch function keeps
 * failing but the table answers, the run takes the full path.
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
    // the probe's own table read (kind, no rows) fails the same way
    table: (op) =>
      op.columns === "kind"
        ? { data: null, error: { message: "canceling statement due to statement timeout" } }
        : { data: [], error: null },
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
  assertEquals(fake.tableOps.some((op) => op.columns !== "kind" && op.filters.some((f) => f[1] === "kind")), false);
  assertEquals(fake.rpcCalls.some((c) => c.name.startsWith("issue_4522_") && c.name !== "issue_4522_plan_v2_enabled"), false);
  assertEquals(fake.tableOps.some((op) => op.filters.some((f) => f[1] === "pre_charge_notice_sent_at")), false);
  resetPlanV2SchemaProbeForTests();
});

Deno.test("T3-8 the switch function keeps failing but the table answers: the run takes the full path, every run", async () => {
  for (let run = 0; run < 2; run++) {
    resetPlanV2SchemaProbeForTests();
    const fake = fakeSupabase({
      rpc: (name) =>
        name === "issue_4522_plan_v2_enabled"
          ? { data: null, error: { message: "injected", code: "XX000" } as { message: string } }
          : { data: [], error: null },
      table: () => ({ data: [], error: null }),
    });
    // deno-lint-ignore no-explicit-any
    const result = await processScheduledInstallments(fake.client as any, {});
    assertEquals(result.errors, [], `run ${run}`);
    assertEquals(result.v2_steps_skipped, undefined);
    // charging ran with the planned-rows filter (v2 schema present)
    assertEquals(fake.tableOps.some((op) => op.filters.some((f) => f[1] === "kind" && f[2] === "scheduled")), true);
  }
  resetPlanV2SchemaProbeForTests();
});
