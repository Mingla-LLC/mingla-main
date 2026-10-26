import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
Deno.test("#3872 user refunds require scoped SQL authorization", () => {
  assertStringIncludes(source, 'userDb.rpc("gig_refund_authorize"');
  assertStringIncludes(source, "isAuthorizedCronCaller");
  assertStringIncludes(source, '"creator_decline"');
});
Deno.test("#3872 refund amounts come only from the server quote (QA #1)", () => {
  assertStringIncludes(source, 'serviceDb.rpc(\n    "gig_refund_quote"');
  // A client-chosen percentage must never reach the amount computation.
  assert(!source.includes("body?.refund_bps"), "client refund_bps is read");
  assert(!source.includes("refundBps:"), "client refund_bps is used");
});
Deno.test("#3872 timer-only branches stay off the user path", () => {
  assertStringIncludes(source, '"upload_missed"');
  assertStringIncludes(source, '"counter_lower"');
  assertStringIncludes(source, "branch_requires_service");
});
Deno.test("#3872 Stripe and Paystack refunds use deterministic identities per source", () => {
  assertStringIncludes(
    source,
    "gig_refund:${contractId}:${branch}:${source.kind}:${source.id}:${amount}",
  );
  assertStringIncludes(source, "createPaystackRefund");
  assertStringIncludes(source, "idempotencyKey");
});
Deno.test("#3872 provider success is committed through the shared ledger authority", () => {
  assertStringIncludes(source, 'serviceDb.rpc("gig_refund_record"');
  assertStringIncludes(source, "p_creator_fee_minor");
});
