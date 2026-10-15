import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  checkoutSelectionUsesTripInstallments,
  tripInstallmentsSupported,
} from "../../../../packages/offering-rendering/tripInstallmentCapability.ts";

const source = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);

Deno.test("#3859 checkout refuses unsupported selected plans before session/provider I/O", () => {
  const preflight = source.indexOf(
    "checkoutSelectionUsesTripInstallments(",
  );
  const sessionRpc = source.indexOf(
    'supabase.rpc(\n      "biz_ticket_checkout_create_session"',
  );
  const providerInitialize = source.indexOf(
    "deps.paystackInitializeTransaction({",
  );
  assert(preflight > 0, "capability preflight is wired");
  assert(sessionRpc > preflight, "preflight runs before session creation");
  assert(
    providerInitialize > sessionRpc,
    "preflight and session guard both precede provider initialization",
  );
  assertStringIncludes(source, 'paymentPlanChoice !== "full"');
  assertStringIncludes(source, 'supabase.rpc("pg_trip_installments_supported"');
  assertStringIncludes(source, "installmentsSupported !== true");
});

Deno.test("#3859 full-pay and supported installments retain their semantic path", () => {
  const selectedPlan = [{
    tier_metadata: { installments: { deposit_pct: 25 } },
  }];
  assertEquals(
    checkoutSelectionUsesTripInstallments("full", selectedPlan),
    false,
  );
  assert(checkoutSelectionUsesTripInstallments("installments", selectedPlan));
  assert(tripInstallmentsSupported("stripe"));
  assertEquals(tripInstallmentsSupported("paystack"), false);
});
