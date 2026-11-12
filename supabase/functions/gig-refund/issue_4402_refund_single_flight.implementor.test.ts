// #4402 F3 — every gig refund claims its hold in the database before any
// provider call, finishes the claim, and alerts once retries are exhausted.
// The claim race itself (two recorders, one claim) is proven in
// supabase/migrations/__tests__/issue_4402_gig_payment_capture.implementor.pg17.test.sql.
//
// fails-on-revert: deleting the gig_refund_claim call (or moving it after the
// provider loop) fails the ordering assertions below.
import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("#4402 F3: the refund is claimed before any provider call", () => {
  const quote = source.indexOf('"gig_refund_quote"');
  const claim = source.indexOf('"gig_refund_claim"');
  const stripe = source.indexOf("stripeTicketRefund().refunds.create");
  const paystack = source.indexOf("createPaystackRefund({");
  const record = source.indexOf('"gig_refund_record"');
  assert(quote > 0 && claim > quote, "claim must follow the server quote");
  assert(
    stripe > claim && paystack > claim,
    "provider calls must follow the claim",
  );
  assert(record > stripe, "the ledger record follows the provider");
});

Deno.test("#4402 F3: a second recorder never reaches the provider", () => {
  assertStringIncludes(source, "if (claim.claimed !== true) {");
  assertStringIncludes(source, '"refund_in_progress"');
  assertStringIncludes(source, 'claim.reason === "completed"');
});

Deno.test("#4402 P3: a failing refund backs off, then stops and alerts", () => {
  assertStringIncludes(source, '"gig_refund_claim_finish"');
  assertStringIncludes(source, "p_max_attempts: GIG_REFUND_MAX_ATTEMPTS");
  assertStringIncludes(source, 'finished?.status === "gave_up"');
  assertStringIncludes(source, "notifyGigRefundGaveUp(");
  assertStringIncludes(source, '"payment_late"');
});
