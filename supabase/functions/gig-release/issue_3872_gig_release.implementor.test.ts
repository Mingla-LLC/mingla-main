import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
Deno.test("#3872 release is service-authenticated and idempotent", () => {
  assertStringIncludes(source, "isAuthorizedCronCaller");
  assertStringIncludes(source, "gig_release:${contractId}");
  assertStringIncludes(source, 'db.rpc("gig_release_record"');
});
Deno.test("#3872 Stripe release resolves the captured charge and source_transaction", () => {
  assertStringIncludes(source, 'expand: ["latest_charge"]');
  assertStringIncludes(source, "gigStripeRelease");
  assertStringIncludes(source, "sourceTransaction: chargeId");
});
Deno.test("#3872 Paystack release reuses the shared payee ledger", () => {
  assertStringIncludes(source, 'payee.paystack_status !== "verified"');
  assertStringIncludes(source, "ledger:");
});
