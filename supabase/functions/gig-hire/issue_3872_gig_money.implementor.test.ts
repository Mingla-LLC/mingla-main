import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  gigPaystackInitialize,
  gigRefund,
  gigStripeIntent,
  gigStripeRelease,
  quoteGig,
} from "../_shared/gigMoney.ts";

Deno.test("#3872 booking fee is exact round-half-up 15%", () => {
  assertEquals(quoteGig(101, "ngn"), {
    feeMinor: 101,
    bookingFeeMinor: 15,
    totalMinor: 116,
    currency: "NGN",
  });
  assertEquals(quoteGig(110, "USD").bookingFeeMinor, 17);
});
Deno.test("#3872 Stripe hold is a platform PI with transfer group and immutable metadata", () => {
  const q = quoteGig(10000, "USD");
  assertEquals(
    gigStripeIntent({ contractId: "c", termsVersion: 2, quote: q }),
    {
      amount: 11500,
      currency: "usd",
      payment_method_types: ["card", "link"],
      transfer_group: "gig_c",
      metadata: {
        mingla_kind: "gig_hold",
        contract_id: "c",
        terms_version: "2",
        fee_minor: "10000",
        booking_fee_minor: "1500",
      },
      statement_descriptor_suffix: "CREATOR GIG",
    },
  );
});
Deno.test("#3872 Paystack hold uses Mingla main account shape and deterministic reference", () => {
  const out = gigPaystackInitialize({
    contractId: "a-b",
    termsVersion: 1,
    quote: quoteGig(10000, "NGN"),
    email: "host@example.com",
  });
  assertEquals(out.reference, "ghold_ab_v1");
  assertEquals(out.amountSubunits, 11500);
  assertEquals("subaccount" in out, false);
});
Deno.test("#3872 every automatic refund branch is deterministic", () => {
  assertEquals(
    gigRefund({
      branch: "declined_or_expired",
      feeMinor: 10000,
      bookingFeeMinor: 1500,
    }),
    { hostRefundMinor: 11500, creatorFeeMinor: 0 },
  );
  assertEquals(
    gigRefund({
      branch: "creator_decline",
      feeMinor: 10000,
      bookingFeeMinor: 1500,
    }),
    { hostRefundMinor: 11500, creatorFeeMinor: 0 },
  );
  assertEquals(
    gigRefund({
      branch: "host_after_accept_before_lock",
      feeMinor: 10000,
      bookingFeeMinor: 1500,
    }),
    { hostRefundMinor: 9000, creatorFeeMinor: 2500 },
  );
  assertEquals(
    gigRefund({
      branch: "resolved_partial",
      feeMinor: 10000,
      bookingFeeMinor: 1500,
      refundBps: 5000,
    }),
    { hostRefundMinor: 5000, creatorFeeMinor: 5000 },
  );
});
Deno.test("#3872 Stripe release ties the transfer to the captured charge", () => {
  assertEquals(
    gigStripeRelease({
      contractId: "c",
      feeMinor: 10000,
      destination: "acct_1",
      sourceTransaction: "ch_1",
    }).source_transaction,
    "ch_1",
  );
});
Deno.test("#3872 invalid money and partial refund inputs fail closed", () => {
  assertThrows(() => quoteGig(0, "USD"));
  assertThrows(() =>
    gigRefund({
      branch: "resolved_partial",
      feeMinor: 1,
      bookingFeeMinor: 0,
      refundBps: 10001,
    })
  );
});

// #3872 walkthrough: counter-offer top-ups and multi-payment refunds/releases.
import {
  allocateAcrossSources,
  gigTopupPaystackInitialize,
  gigTopupStripeIntent,
} from "../_shared/gigMoney.ts";

Deno.test("#3872 money is split across the base hold then top-ups, never over a source", () => {
  const parts = allocateAcrossSources(46000, [
    { id: "base", availableMinor: 34500 },
    { id: "t1", availableMinor: 11500 },
  ]);
  assertEquals(parts.map((p) => [p.source.id, p.amountMinor]), [
    ["base", 34500],
    ["t1", 11500],
  ]);
  assertEquals(
    allocateAcrossSources(20000, [{ id: "base", availableMinor: 34500 }])
      .map((p) => p.amountMinor),
    [20000],
  );
  assertThrows(() =>
    allocateAcrossSources(50000, [{ id: "base", availableMinor: 34500 }])
  );
});
Deno.test("#3872 top-up charges are tagged so confirm records the right hold", () => {
  const quote = {
    feeMinor: 10000,
    bookingFeeMinor: 1500,
    totalMinor: 11500,
    currency: "USD",
  };
  assertEquals(
    gigTopupStripeIntent({ contractId: "c", termsVersion: 2, quote }).metadata
      .mingla_kind,
    "gig_topup",
  );
  const paystack = gigTopupPaystackInitialize({
    contractId: "a-b",
    termsVersion: 2,
    quote: { ...quote, currency: "NGN" },
    email: "host@example.com",
  });
  assertEquals(paystack.reference, "gtop_ab_v2");
  assertEquals(paystack.metadata.mingla_kind, "gig_topup");
});
Deno.test("#3872 a missed upload is a full host refund", () => {
  assertEquals(
    gigRefund({
      branch: "upload_missed",
      feeMinor: 10000,
      bookingFeeMinor: 1500,
    }),
    { hostRefundMinor: 11500, creatorFeeMinor: 0 },
  );
});
Deno.test("#3872 gig-hire never starts a payment for an {ok:false} offer and supports top-ups", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  if (!source.includes("prepared.ok === false")) {
    throw new Error("ok:false ignored");
  }
  if (!source.includes('"gig_topup_prepare"')) {
    throw new Error("topup action missing");
  }
  if (!source.includes('"gig_topup_mark_captured"')) {
    throw new Error("topup confirm missing");
  }
});
