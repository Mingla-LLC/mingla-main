/**
 * toward #3697 Wave 6 — Ads credit fee split, limits, withdraw refund.
 */
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  AD_CREDIT_TOP_UP_LIMITS_CENTS,
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

Deno.test("Wave 6: withdraw refunds unused credit + its fee", () => {
  // $85 credit → refund $100
  assertEquals(refundCentsFromCredit(8500), 10000);
  const q = quoteWithdraw(8500);
  assertEquals(q.ok, true);
  if (q.ok) {
    assertEquals(q.refund_cents, 10000);
    assertEquals(q.fee_returned_cents, 1500);
  }
});

Deno.test("Wave 6: top-up min/max — $25 / £20 / ₦25,000 and $5,000 ceil", () => {
  assertEquals(AD_CREDIT_TOP_UP_LIMITS_CENTS.USD.min_pay_cents, 2500);
  assertEquals(AD_CREDIT_TOP_UP_LIMITS_CENTS.GBP.min_pay_cents, 2000);
  assertEquals(AD_CREDIT_TOP_UP_LIMITS_CENTS.NGN.min_pay_cents, 2_500_000);
  assertEquals(quoteTopUp(2499, "USD").ok, false);
  assertEquals(quoteTopUp(2500, "USD").ok, true);
  assertEquals(quoteTopUp(500_001, "USD").ok, false);
  assertEquals(quoteTopUp(1999, "GBP").ok, false);
  assertEquals(quoteTopUp(2000, "GBP").ok, true);
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
  assertEquals(mig.includes("ad_credit_apply"), true);
  assertEquals(mig.includes("REVOKE ALL ON FUNCTION public.ad_credit_apply"), true);
  assertEquals(mig.includes("GRANT EXECUTE ON FUNCTION public.ad_credit_apply"), true);
  assertEquals(mig.includes("TO service_role"), true);
  assertEquals(mig.includes("anon"), true);

  const edge = await Deno.readTextFile(
    new URL("../../ad-credit/index.ts", import.meta.url),
  );
  assertEquals(edge.includes('action === "apply_top_up"'), true);
  assertEquals(edge.includes('action === "apply_withdraw"'), true);
  assertEquals(edge.includes("payment_ref_required"), true);
  assertEquals(edge.includes("RANK_EVENT_MANAGER"), true);
  assertEquals(edge.includes("provider_refund_cents"), true);
});
