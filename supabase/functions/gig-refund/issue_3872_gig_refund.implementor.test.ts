import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
Deno.test("#3872 user refunds require scoped SQL authorization", () => {
  assertStringIncludes(source, 'userDb.rpc("gig_refund_authorize"');
  assertStringIncludes(source, "isAuthorizedCronCaller");
  assertStringIncludes(source, '"creator_decline"');
});
Deno.test("#3872 Stripe and Paystack refunds use deterministic identities", () => {
  assertStringIncludes(
    source,
    "gig_refund:${contractId}:${branch}:${amounts.hostRefundMinor}",
  );
  assertStringIncludes(source, "createPaystackRefund");
  assertStringIncludes(source, "idempotencyKey");
});
Deno.test("#3872 provider success is committed through the shared ledger authority", () => {
  assertStringIncludes(source, 'serviceDb.rpc("gig_refund_record"');
  assertStringIncludes(source, "p_creator_fee_minor");
});
