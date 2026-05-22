import {
  assertMatch,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const FUNCTION_SOURCE = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);
const HELPER_SOURCE = await Deno.readTextFile(
  new URL("../../_shared/installments/createInstallmentPI.ts", import.meta.url),
);
const MIGRATION_SOURCE = await Deno.readTextFile(
  new URL("../../../migrations/20260723000001_orch_0914_manual_charge_installment.sql", import.meta.url),
);

Deno.test("ORCH-0914 manual charge calls auth RPC before shared PI helper", () => {
  const rpcIdx = FUNCTION_SOURCE.indexOf("biz_manual_charge_installment");
  const helperIdx = FUNCTION_SOURCE.indexOf("createInstallmentPI({");
  if (rpcIdx < 0 || helperIdx < 0 || rpcIdx > helperIdx) {
    throw new Error("manual-charge-installment must call RPC before helper");
  }
});

Deno.test("ORCH-0914 manual charge preserves explicit at-risk override guard", () => {
  assertStringIncludes(FUNCTION_SOURCE, "atRiskOverride === true");
  assertStringIncludes(FUNCTION_SOURCE, "override: { atRisk: atRiskOverride }");
  assertStringIncludes(MIGRATION_SOURCE, "at_risk IS TRUE");
  assertStringIncludes(MIGRATION_SOURCE, "p_atrisk_override IS NOT TRUE");
});

Deno.test("ORCH-0914 shared helper owns installment PI metadata", () => {
  assertMatch(HELPER_SOURCE, /stripe\.paymentIntents\.create\(/);
  assertStringIncludes(HELPER_SOURCE, "mingla_installment_id");
  assertStringIncludes(HELPER_SOURCE, "idempotencyKey");
});
