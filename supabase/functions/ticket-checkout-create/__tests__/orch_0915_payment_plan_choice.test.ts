import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const activeSource = stripComments(source);

Deno.test("ORCH-0915 edge parses full/installments and rejects invalid payment_plan_choice before RPC", () => {
  assertStringIncludes(activeSource, 'type PaymentPlanChoice = "auto" | "full" | "installments"');
  assertStringIncludes(activeSource, "body.payment_plan_choice");
  assertStringIncludes(activeSource, '"payment_plan_choice_invalid"');

  const validationIndex = activeSource.indexOf('"payment_plan_choice_invalid"');
  const rpcIndex = activeSource.indexOf('supabase.rpc(\n    "biz_ticket_checkout_create_session"');
  assert(validationIndex >= 0, "expected invalid-choice validation");
  assert(rpcIndex >= 0, "expected create-session RPC call");
  assert(
    validationIndex < rpcIndex,
    "invalid payment_plan_choice must be rejected before creating a checkout session",
  );
});

Deno.test("ORCH-0915 edge passes p_payment_plan_choice and keeps omitted callers on auto", () => {
  assertStringIncludes(activeSource, "p_payment_plan_choice: paymentPlanChoice");
  assertStringIncludes(activeSource, 'paymentPlanChoice: PaymentPlanChoice = "auto"');
  assertStringIncludes(activeSource, "checkoutIdempotencyKey({");
  assertStringIncludes(activeSource, "paymentPlanChoice");
});

Deno.test("ORCH-0915 full branch is non-installment because Stripe shape is still schedule-derived", () => {
  assertStringIncludes(
    activeSource,
    "session.installmentSchedule !== null",
    "isInstallmentPlan must remain derived from returned session.installmentSchedule",
  );
  assertStringIncludes(
    activeSource,
    '...(isInstallmentPlan ? { mingla_installment_plan_root: "true" } : {})',
    "installment metadata must stay guarded by isInstallmentPlan",
  );
  assertStringIncludes(
    activeSource,
    '...(isInstallmentPlan ? { setup_future_usage: "off_session" } : {})',
    "setup_future_usage must stay guarded by isInstallmentPlan",
  );
  assertStringIncludes(
    activeSource,
    '...(isInstallmentPlan ? { customer_creation: "always" as const } : {})',
    "hosted Checkout customer creation must stay installment-only",
  );
});

Deno.test("ORCH-0915 invalid RPC choice maps to structured HTTP 400", () => {
  const sessionErrorWindow = activeSource.slice(
    activeSource.indexOf("if (sessionError || !sessionResult)"),
    activeSource.indexOf("const session = sessionResult"),
  );
  assertStringIncludes(sessionErrorWindow, "payment_plan_choice_invalid");
  assertStringIncludes(sessionErrorWindow, "400");
});

Deno.test("ORCH-0915 accepted edge values are exactly full/installments for callers", () => {
  const accepted = ["full", "installments"];
  assertEquals(accepted.includes("full"), true);
  assertEquals(accepted.includes("installments"), true);
  assertEquals(accepted.includes("auto"), false);
});
