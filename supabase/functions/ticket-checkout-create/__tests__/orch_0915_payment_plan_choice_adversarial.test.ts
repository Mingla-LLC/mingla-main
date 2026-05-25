import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { checkoutIdempotencyKey } from "../../_shared/ticketCheckout.ts";

const edgeSource = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
const sharedSource = await Deno.readTextFile(
  new URL("../../_shared/ticketCheckout.ts", import.meta.url),
);
const migrationSource = await Deno.readTextFile(
  new URL(
    "../../../migrations/20260724000007_orch_0915_pay_in_full_opt_out.sql",
    import.meta.url,
  ),
);

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const edge = stripComments(edgeSource);
const shared = stripComments(sharedSource);
const migration = stripComments(migrationSource);

Deno.test("ORCH-0915 adversarial: banana is rejected at edge before RPC and at RPC source validation", () => {
  const invalidIndex = edge.indexOf('"payment_plan_choice_invalid"');
  const rpcIndex = edge.indexOf('supabase.rpc(\n    "biz_ticket_checkout_create_session"');

  assert(invalidIndex >= 0, "edge must emit structured payment_plan_choice_invalid");
  assert(rpcIndex >= 0, "edge must still call create-session RPC after validation");
  assert(
    invalidIndex < rpcIndex,
    "invalid payment_plan_choice must be rejected before any create-session RPC can create state",
  );
  assertStringIncludes(edge, 'return jsonResponse({ error: "payment_plan_choice_invalid" }, 400)');
  assertStringIncludes(migration, "IF COALESCE(p_payment_plan_choice, '') NOT IN ('auto', 'full', 'installments') THEN");
  assertStringIncludes(migration, "RAISE EXCEPTION 'payment_plan_choice_invalid'");
});

Deno.test("ORCH-0915 adversarial: idempotency keys separate full/installment branches but preserve legacy auto key", () => {
  const base = {
    eventId: "00000000-0000-0000-0000-000000000915",
    buyerEmail: "Buyer@Example.COM ",
    buyerPhoneE164: "+15555550123",
    lines: [
      { ticketTypeId: "tier-b", quantity: 1 },
      { ticketTypeId: "tier-a", quantity: 2 },
    ],
  };

  const legacy = checkoutIdempotencyKey(base);
  const auto = checkoutIdempotencyKey({ ...base, paymentPlanChoice: "auto" });
  const full = checkoutIdempotencyKey({ ...base, paymentPlanChoice: "full" });
  const installments = checkoutIdempotencyKey({
    ...base,
    paymentPlanChoice: "installments",
  });

  assertEquals(auto, legacy, "auto must not alter existing caller idempotency");
  assertNotEquals(full, legacy, "explicit full needs its own session namespace");
  assertNotEquals(installments, legacy, "explicit installments needs its own session namespace");
  assertNotEquals(full, installments, "cancelled full session must not be reused for installments");
  assertStringIncludes(full, "choice:full");
  assertStringIncludes(installments, "choice:installments");
});

Deno.test("ORCH-0915 adversarial: idempotency helper owns the explicit-choice suffix and excludes auto", () => {
  assertStringIncludes(shared, 'paymentPlanChoice?: "auto" | "full" | "installments"');
  assertStringIncludes(shared, 'input.paymentPlanChoice !== "auto"');
  assertStringIncludes(shared, "choice:${input.paymentPlanChoice}");
});

Deno.test("ORCH-0915 adversarial: mixed plan cart guard cannot be bypassed by choosing full", () => {
  const guardIndex = migration.indexOf("ticket_lines_mixed_with_installments");
  const fullSuppressionIndex = migration.indexOf("p_payment_plan_choice <> 'full'");
  assert(guardIndex >= 0, "mixed-cart guard must remain present");
  assert(fullSuppressionIndex > guardIndex, "guard must run before full-choice suppression");

  const guardWindow = migration.slice(
    migration.lastIndexOf("IF v_line_count > 1", guardIndex),
    migration.indexOf("END IF;", guardIndex) + "END IF;".length,
  );
  assertStringIncludes(guardWindow, "IF v_line_count > 1 THEN");
  assert(
    !guardWindow.includes("p_payment_plan_choice"),
    "mixed-cart guard must not branch on buyer choice",
  );
});

Deno.test("ORCH-0915 adversarial: full branch stays non-installment because Stripe fields remain schedule-derived", () => {
  assertStringIncludes(edge, "session.installmentSchedule !== null");
  assertStringIncludes(edge, "session.installmentSchedule !== undefined");
  assertStringIncludes(edge, '...(isInstallmentPlan ? { mingla_installment_plan_root: "true" } : {})');
  assertStringIncludes(edge, '...(isInstallmentPlan ? { setup_future_usage: "off_session" } : {})');
  assertStringIncludes(edge, '...(isInstallmentPlan ? { customer_creation: "always" as const } : {})');
});
