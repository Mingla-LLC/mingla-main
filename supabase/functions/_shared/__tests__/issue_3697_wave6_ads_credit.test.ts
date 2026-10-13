/**
 * toward #3697 Wave 6 — Ads credit fee split, limits, FIFO withdraw lots.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  AD_CREDIT_TOP_UP_LIMITS_CENTS,
  allocateWithdrawFromLots,
  creditCentsFromPay,
  feeCentsFromPay,
  HOST_FEE_RATIO,
  quoteTopUp,
  quoteWithdraw,
  refundCentsFromCredit,
} from "../adMoney.ts";

Deno.test("Wave 6: 15% fee at top-up — $100 pay → $85 credit + $15 fee", () => {
  assertEquals(HOST_FEE_RATIO, 0.15);
  assertEquals(creditCentsFromPay(10000), 8500);
  assertEquals(feeCentsFromPay(10000), 1500);
  const q = quoteTopUp(10000, "USD");
  assertEquals(q.ok, true);
  if (q.ok) {
    assertEquals(q.credit_cents, 8500);
    assertEquals(q.fee_cents, 1500);
    assertEquals(q.pay_cents, 10000);
  }
});

Deno.test("Wave 6: FIFO lots preserve odd top-up fee (2501 → 2125/376)", () => {
  assertEquals(creditCentsFromPay(2501), 2125);
  assertEquals(feeCentsFromPay(2501), 376);
  const full = allocateWithdrawFromLots(
    [{
      id: "lot-a",
      credit_remaining_cents: 2125,
      pay_remaining_cents: 2501,
      fee_remaining_cents: 376,
    }],
    2125,
  );
  assertEquals(full.ok, true);
  if (full.ok) {
    assertEquals(full.refund_cents, 2501);
    assertEquals(full.fee_returned_cents, 376);
  }
  // Aggregate inverse would wrongly refund 2500 — lots keep 2501.
  assertEquals(refundCentsFromCredit(2125), 2500);
});

Deno.test("Wave 6: FIFO across two lots", () => {
  const allocated = allocateWithdrawFromLots(
    [
      {
        id: "a",
        credit_remaining_cents: 8500,
        pay_remaining_cents: 10000,
        fee_remaining_cents: 1500,
      },
      {
        id: "b",
        credit_remaining_cents: 2125,
        pay_remaining_cents: 2501,
        fee_remaining_cents: 376,
      },
    ],
    8500 + 1000,
  );
  assertEquals(allocated.ok, true);
  if (allocated.ok) {
    assertEquals(allocated.allocations.length, 2);
    assertEquals(allocated.allocations[0].pay_cents, 10000);
    assertEquals(allocated.allocations[1].credit_cents, 1000);
    assertEquals(allocated.refund_cents > 10000, true);
  }
});

Deno.test("Wave 6: top-up min/max — $25 / £20 / ₦25,000 and $5,000 ceil", () => {
  assertEquals(AD_CREDIT_TOP_UP_LIMITS_CENTS.USD.min_pay_cents, 2500);
  assertEquals(AD_CREDIT_TOP_UP_LIMITS_CENTS.GBP.min_pay_cents, 2000);
  assertEquals(AD_CREDIT_TOP_UP_LIMITS_CENTS.NGN.min_pay_cents, 2_500_000);
  assertEquals(quoteTopUp(2499, "USD").ok, false);
  assertEquals(quoteTopUp(2500, "USD").ok, true);
  assertEquals(quoteTopUp(500_001, "USD").ok, false);
  assertEquals(quoteWithdraw(8500).ok, true);
});

Deno.test("Wave 6: migration + edge gate source contracts", async () => {
  const mig = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270821003697_issue_3697_wave6_ads_credit.sql",
      import.meta.url,
    ),
  );
  assertEquals(mig.includes("ad_credit_wallets"), true);
  assertEquals(mig.includes("ad_credit_ledger"), true);
  assertEquals(mig.includes("ad_credit_lots"), true);
  assertEquals(mig.includes("ad_credit_ledger_immutable"), true);
  assertEquals(mig.includes("is_supported_offering_currency"), true);
  assertEquals(mig.includes("supported_brand_currencies"), true);
  assertEquals(mig.includes("ON DELETE RESTRICT"), true);
  // Append-only ledger must not use ON DELETE SET NULL (that UPDATEs rows).
  assertEquals(
    /ad_credit_ledger[\s\S]*?ON DELETE SET NULL/.test(mig),
    false,
  );
  assertEquals(mig.includes("biz_can_view_payments_for_brand_for_caller"), true);
  assertEquals(mig.includes("campaign_hold"), false);
  assertEquals(mig.includes("GRANT SELECT, INSERT ON public.ad_credit_ledger"), true);

  const edge = await Deno.readTextFile(
    new URL("../../ad-credit/index.ts", import.meta.url),
  );
  assertEquals(edge.includes("biz_can_manage_payments_for_brand"), true);
  assertEquals(edge.includes("biz_can_view_payments_for_brand"), true);
  assertEquals(edge.includes("RANK_EVENT_MANAGER"), false);
  assertEquals(edge.includes('action === "apply_top_up"'), true);
  assertEquals(edge.includes("payment_ref_required"), true);
});
