import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  applicationFeeWithReferralShare,
  referralShareForPayment,
} from "../../_shared/attribution.ts";

const ticketSource = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);
const venueSource = await Deno.readTextFile(
  new URL("../../venue-order-create/index.ts", import.meta.url),
);
const installmentSource = await Deno.readTextFile(
  new URL(
    "../../_shared/installments/createInstallmentPI.ts",
    import.meta.url,
  ),
);

function assertOrdered(source: string, earlier: string, later: string): void {
  const first = source.indexOf(earlier);
  const second = source.indexOf(later);
  assert(first >= 0, `missing earlier token: ${earlier}`);
  assert(second >= 0, `missing later token: ${later}`);
  assert(first < second, `${earlier} must precede ${later}`);
}

Deno.test("#3872 ticket share is frozen before finalize/provider and buyer totals do not move", () => {
  assertStringIncludes(
    ticketSource,
    '"issue_3872_freeze_ticket_referral_snapshot"',
  );
  assertOrdered(
    ticketSource,
    '"issue_3872_freeze_ticket_referral_snapshot"',
    '"biz_ticket_checkout_finalize"',
  );
  assertOrdered(
    ticketSource,
    '"issue_3872_freeze_ticket_referral_snapshot"',
    "psInit = await deps.paystackInitializeTransaction",
  );
  assertOrdered(
    ticketSource,
    '"issue_3872_freeze_ticket_referral_snapshot"',
    "stripe.paymentIntents.create",
  );
  assertStringIncludes(
    ticketSource,
    "referralShareForPayment(\n      referralAttribution,",
  );
  assertStringIncludes(
    ticketSource,
    "{ shareMinor: referralShareOnCurrentPayment }",
  );
  assertStringIncludes(ticketSource, "amountSubunits: psBuyerTotalCents");
  assertStringIncludes(
    ticketSource,
    "amount: buyerSubtotal.buyerSubtotalCents",
  );
});

Deno.test("#3872 venue share changes both provider fees, never the buyer amount", () => {
  assertStringIncludes(
    venueSource,
    "referral_attribution_snapshot: referralAttribution",
  );
  assertStringIncludes(
    venueSource,
    "venueOrderSplitFields(\n          isCutover,\n          paystackSubaccount,\n          applicationFeeAmountCents,",
  );
  assertStringIncludes(
    venueSource,
    "piBody.application_fee_amount = applicationFeeAmountCents",
  );
  assertStringIncludes(venueSource, "amountSubunits: money.totalCents");
  assertStringIncludes(venueSource, "amount: money.totalCents");
});

Deno.test("#3872 application fee adds gross share and leaves buyer truth unchanged", () => {
  const buyerTotal = 24_000;
  assertEquals(
    applicationFeeWithReferralShare(1_080, { shareMinor: 2_400 }),
    3_480,
  );
  assertEquals(buyerTotal, 24_000);
});

Deno.test("#3872 installment slices collect the exact whole-order share", () => {
  const resolution = { eligibleMinor: 10_000, shareMinor: 3_333 };
  const deposit = referralShareForPayment(resolution, 0, 1_000);
  const middle = referralShareForPayment(resolution, 1_000, 4_000);
  const final = referralShareForPayment(resolution, 5_000, 5_000);
  assertEquals([deposit, middle, final], [333, 1_334, 1_666]);
  assertEquals(deposit + middle + final, resolution.shareMinor);
  assertEquals(
    applicationFeeWithReferralShare(45, { shareMinor: deposit }),
    378,
  );
  assertStringIncludes(installmentSource, "referral_share_minor");
  assertStringIncludes(
    installmentSource,
    "applicationFeeWithReferralShare(\n    minglaApplicationFeeAmountCents,",
  );
});
