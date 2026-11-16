// MINGLA-INVARIANT: I-4238-W6B-PAY-TERMS | issue #4238 W6b | The ad detail, Promote home, edit sheet, Ari suggestion confirm and withdraw show what the Host PAYS (credit ÷ 0.85); an edit sends credit back (pay × 0.85); a suggestion sends only its suggestion_id; a stop shows its true reason; no Host word names a payment provider; ad notices deep-link to the ad.
/**
 * FAILS-ON-REVERT (each was deleted, the suite failed, then restored):
 * - hostAdCreditCard showing the wallet as credit (no hostAdPayFromCredit) → "credit card" fails;
 * - hostAdEditMoney sending pay instead of credit, or dropping the gap round-up → "edit sheet" fails;
 * - hostAdSuggestionMoneyRows recomputing the fee → "suggestion confirm" fails;
 * - changeHostAdLive sending amounts with a suggestion → "suggestion id only" fails;
 * - the "ads" branch in parseBusinessDeepLink → "deep links" fails.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const mockInvoke = jest.fn<(name: string, options: { body: Record<string, unknown> }) => Promise<unknown>>();
jest.mock("../../../../services/supabase", () => ({
  supabase: { functions: { invoke: (name: string, options: { body: Record<string, unknown> }) => mockInvoke(name, options) } },
}));
jest.mock("../../../../services/mixpanelService", () => ({ mixpanelService: { track: jest.fn() } }));
jest.mock("../../../../store/currentBrandStore", () => ({
  useCurrentBrandStore: { getState: () => ({ currentBrandId: "brand-1" }) },
}));

import {
  hostAdAppMinimumFromDetail,
  hostAdBudgetCard,
  hostAdCompareRows,
  hostAdCreditCard,
  hostAdEditMoney,
  hostAdGoalFromResult,
  hostAdLatestStopCode,
  hostAdReasonFromCode,
  hostAdRejectionClass,
  hostAdResults,
  hostAdRoleBlock,
  hostAdSuggestionMoneyRows,
  hostAdTrueStopReason,
  hostAdWithdrawLines,
} from "../hostAdManageModel";
import { hostAdAriRefusal, hostAdAriRefusalIn } from "../hostAdManageCopy";
import { changeHostAdLive } from "../../../../services/hostAdPlanService";
import { parseBusinessDeepLink, resolveBusinessNavTarget } from "../../../../services/businessNotificationRouting";
import {
  BUSINESS_NOTIFICATION_TEMPLATES,
  interpolateTemplate,
} from "../../../../constants/businessNotificationTemplates";

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
const PLAN = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";

beforeEach(() => {
  mockInvoke.mockReset();
});

describe("#4238 W6b money in pay terms", () => {
  test("credit card: wallet (free) + held, both shown as what the Host pays", () => {
    // ₦53,125 credit free = ₦62,500 paid; a ₦100,000-credit ad that spent ₦60,000 holds ₦40,000 credit.
    const card = hostAdCreditCard({
      walletCredit: 5_312_500,
      ads: [
        { ended: false, capCredit: 10_000_000, spentCredit: 6_000_000 },
        { ended: true, capCredit: 9_000_000, spentCredit: 1_000_000 },
      ],
    });
    expect(card.freePay).toBe(6_250_000);
    expect(card.heldPay).toBe(4_705_883); // ceil(4,000,000 ÷ 0.85)
    expect(card.totalPay).toBe(6_250_000 + 4_705_883);
    expect(card.toAdsCredit).toBe(5_312_500 + 4_000_000);
  });

  test("budget card: a day and still held, in pay terms", () => {
    expect(hostAdBudgetCard({ dailyCredit: 425_000, capCredit: 10_000_000, spentCredit: 2_000_000 })).toEqual({
      dailyPay: 500_000,
      dailyToAds: 425_000,
      stillHeldPay: 9_411_765,
      totalPay: 11_764_706,
    });
  });

  test("edit sheet: new total goes back as credit; held after, extra and the top-up gap in pay terms", () => {
    const m = hostAdEditMoney({
      newTotalPay: 14_000_000,
      capCredit: 10_000_000,
      spentCredit: 2_000_000,
      walletCredit: 1_000_000,
      learning: true,
      step: 50_000,
    });
    expect(m.newCredit).toBe(11_900_000); // 14,000,000 × 0.85
    expect(m.heldAfterPay).toBe(11_647_059); // (11.9M − 2M) ÷ 0.85
    expect(m.changePay).toBe(2_235_295); // 1.9M credit more
    expect(m.freePay).toBe(1_176_471);
    // short 900,000 credit = 1,058,824 pay → rounded UP to the 50,000 step
    expect(m.topUpPay).toBe(1_100_000);
    expect(m.restartsLearning).toBe(false); // 19%: up to 20% passes without the restart confirm
    const big = hostAdEditMoney({ newTotalPay: 15_000_000, capCredit: 10_000_000, spentCredit: 0, walletCredit: 9_000_000, learning: true, step: 50_000 });
    expect(big.restartsLearning).toBe(true); // 27.5%
    const tiny = hostAdEditMoney({ newTotalPay: 12_000_000, capCredit: 10_000_000, spentCredit: 0, walletCredit: 9_000_000, learning: true, step: 50_000 });
    expect(tiny.restartsLearning).toBe(false);
    expect(tiny.topUpPay).toBe(0);
    const lower = hostAdEditMoney({ newTotalPay: 8_000_000, capCredit: 10_000_000, spentCredit: 1_000_000, walletCredit: 0, learning: false, step: 50_000 });
    expect(lower.changePay).toBe(-3_764_706); // 3.2M credit comes back
    expect(lower.minimumPay).toBe(1_176_471 + 50_000);
  });

  test("an app's minimum from the server reads in pay terms", () => {
    expect(hostAdAppMinimumFromDetail("tiktok:2000000")).toEqual({ platform: "tiktok", dailyPay: 2_352_942 });
    expect(hostAdAppMinimumFromDetail("nonsense")).toBeNull();
  });

  test("suggestion confirm: the server's pay figures as they are, fee only on a raise", () => {
    const rows = hostAdSuggestionMoneyRows({
      current_total_pay_cents: 11_764_706,
      new_total_pay_cents: 14_117_647,
      change_pay_cents: 2_352_941,
      change_fee_cents: 352_941,
    });
    expect(rows).toEqual({ nowPay: 11_764_706, afterPay: 14_117_647, changePay: 2_352_941, feePay: 352_941, direction: "raise" });
    const down = hostAdSuggestionMoneyRows({
      current_total_pay_cents: 10_000_000,
      new_total_pay_cents: 8_000_000,
      change_pay_cents: -2_000_000,
      change_fee_cents: 300_000,
    });
    expect(down?.feePay).toBe(0);
    expect(down?.direction).toBe("lower");
    expect(hostAdSuggestionMoneyRows(null)).toBeNull();
  });

  test("withdraw: what comes back includes the fee (the fee returns on a withdraw only)", () => {
    expect(hostAdWithdrawLines({ credit_cents: 1_955_000, refund_cents: 2_300_000, fee_returned_cents: 345_000 })).toEqual({
      backPay: 2_300_000,
      feeBack: 345_000,
      creditOut: 1_955_000,
    });
    const en = JSON.parse(read("src/i18n/locales/en/hostAds.json")).hostAds.manage;
    expect(en.withdraw.feeBack).toContain("{{fee}}");
    expect(en.money.withdrawV).toMatch(/fee included/);
  });

  test("results: pay terms per ticket, Mingla's 7-day counts, return multiple", () => {
    const r = hostAdResults({ goal: "sales", spentCredit: 1_997_500, tickets: 14, conversions: 99, salesValue: 8_500_000 });
    expect(r.spentPay).toBe(2_350_000);
    expect(r.count).toBe(14); // tickets beat raw conversions
    expect(r.eachPay).toBe(167_857);
    expect(r.returnX).toBe(3.6);
    expect(hostAdResults({ goal: "visits", spentCredit: 100, clicks7d: 4 }).count).toBe(4);
    expect(hostAdGoalFromResult("rsvp_registrations")).toBe("signups");
    expect(hostAdGoalFromResult("ticket_sales")).toBe("sales");
    expect(hostAdGoalFromResult("landing_page_views")).toBe("visits");
  });
});

describe("#4238 W6b true stop reasons", () => {
  test("every server reason maps to its own true reason", () => {
    expect(
      ["sold_out", "event_ended", "cap_98_percent", "credit_out", "host_paused", "not_on_sale", "bookings_closed", "destination_unavailable", "destination_not_public", "end_date_passed", "destination_check_failed", "spend_fetch_failed"].map(hostAdReasonFromCode),
    ).toEqual(["soldOut", "eventPassed", "budgetUsed", "creditOut", "youPaused", "notOnSale", "bookingsClosed", "notPublic", "notPublic", "endDate", "checkFailed", "spendUnreadable"]);
    expect(hostAdReasonFromCode("mystery")).toBeNull();
  });

  test("order: cancelled, stored reason, budget used, then the Host's own end", () => {
    const base = { spentCredit: 50, capCredit: 100, hostEnded: false, deleted: false, code: null };
    expect(hostAdTrueStopReason({ ...base, state: "running" })).toBeNull();
    expect(hostAdTrueStopReason({ ...base, state: "ended", deleted: true })).toBe("cancelled");
    expect(hostAdTrueStopReason({ ...base, state: "ended", code: "sold_out" })).toBe("soldOut");
    expect(hostAdTrueStopReason({ ...base, state: "ended", spentCredit: 98 })).toBe("budgetUsed");
    expect(hostAdTrueStopReason({ ...base, state: "ended", hostEnded: true })).toBe("youEnded");
    expect(hostAdTrueStopReason({ ...base, state: "paused", hostEnded: true })).toBe("youPaused");
    expect(hostAdTrueStopReason({ ...base, state: "ended" })).toBeNull();
    expect(
      hostAdLatestStopCode([
        { action: "pause", provider_response: { reason: "credit_out" }, created_at: "2026-11-01T00:00:00Z" },
        { action: "end", provider_response: { reason: "sold_out" }, created_at: "2026-11-09T00:00:00Z" },
        { action: "launch", provider_response: { reason: "x" }, created_at: "2026-11-10T00:00:00Z" },
      ]),
    ).toBe("sold_out");
  });

  test("the old 'ended or isn't public' line is gone; every reason has words", () => {
    const detail = read("src/screens/hostAds/HostAdDetailScreen.tsx");
    expect(detail).not.toMatch(/ended or isn't public/);
    const en = JSON.parse(read("src/i18n/locales/en/hostAds.json")).hostAds.manage;
    for (const key of ["soldOut", "eventPassed", "budgetUsed", "youEnded", "youPaused", "creditOut", "notOnSale", "bookingsClosed", "notPublic"]) {
      expect(typeof en.reason[key]).toBe("string");
    }
  });

  test("rejections read in plain words (mirror of the server classifier)", () => {
    expect(hostAdRejectionClass({ reason: "Image has too much text overlay" })).toBe("text_heavy");
    expect(hostAdRejectionClass("Ad promotes alcohol")).toBe("alcohol");
    expect(hostAdRejectionClass(null)).toBeNull();
  });
});

describe("#4238 W6b roles and Ari", () => {
  test("a teammate without the right sees the reason and who to ask", () => {
    expect(hostAdRoleBlock({ action: "pause", allowedByRole: true })).toEqual({ blocked: false });
    expect(hostAdRoleBlock({ action: "pause", allowedByRole: false })).toEqual({ blocked: true, askName: null });
    expect(
      hostAdRoleBlock({ action: "change_live", allowedByRole: true, capabilities: { change_live: { allowed: false, ask_name: "Tinoe" } } }),
    ).toEqual({ blocked: true, askName: "Tinoe" });
  });

  test("a suggestion sends only its id; a manual edit sends credit and the learning confirm", async () => {
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
    await changeHostAdLive({ brandId: "b", planId: "p", suggestionId: "sg1", newBudgetCents: 999, idempotencyKey: "k" });
    expect(mockInvoke.mock.calls[0][1].body).toEqual({ action: "change_live", brand_id: "b", plan_id: "p", suggestion_id: "sg1", idempotency_key: "k" });
    await changeHostAdLive({ brandId: "b", planId: "p", newBudgetCents: 11_900_000, idempotencyKey: "k2", acknowledgeLearningReset: true });
    expect(mockInvoke.mock.calls[1][1].body).toEqual({
      action: "change_live",
      brand_id: "b",
      plan_id: "p",
      new_budget_cents: 11_900_000,
      acknowledge_learning_reset: true,
      idempotency_key: "k2",
    });
  });

  test("Ari's refusal codes read in the Host's words", () => {
    expect(hostAdAriRefusal("ad_suggestion_over_cap")).toMatch(/20%/);
    expect(hostAdAriRefusal("ari_copy_unverified_name:Wizkid")).toContain("Wizkid");
    expect(hostAdAriRefusalIn("refused: ad_suggestion_learning")).toMatch(/7 days/);
    expect(hostAdAriRefusal("unknown_code")).toBeNull();
  });

  test("compare: same counting on every ad, cheapest first, unspent ads left out", () => {
    const rows = hostAdCompareRows([
      { id: "a", name: "A", result: "tickets", spentCredit: 850_000, count: 10 },
      { id: "b", name: "B", result: "sign_ups", spentCredit: 85_000, count: 10 },
      { id: "c", name: "C", result: "tickets", spentCredit: 0, count: 0 },
    ]);
    expect(rows.map((r) => [r.id, r.eachPay])).toEqual([["b", 10_000], ["a", 100_000]]);
  });
});

describe("#4238 W6b notices and deep links", () => {
  const TYPES = ["live", "rejected", "part_rejected", "paused", "credit_low", "ended", "slow_sales", "creative_tired", "last_tickets"];

  test("the nine ad notices have templates, push + in-app on, no raw {var} once filled", () => {
    for (const t of TYPES) {
      const row = BUSINESS_NOTIFICATION_TEMPLATES[`business.ad_${t}` as keyof typeof BUSINESS_NOTIFICATION_TEMPLATES];
      expect(row).toBeDefined();
      expect(row.defaultPush && row.defaultInApp).toBe(true);
      for (const text of [row.pushTitle, row.pushBody, row.inAppTitle, row.inAppBody]) {
        expect(interpolateTemplate(text, {})).not.toMatch(/\{\w+\}/);
      }
    }
    const low = BUSINESS_NOTIFICATION_TEMPLATES["business.ad_credit_low"];
    expect(low.pushBody).toContain("{date}");
    expect(low.pushBody).toContain("{amount}");
    expect(low.pushBody).not.toContain("{days}");
  });

  test("an ad notice opens its ad (by plan) or Promote", () => {
    expect(parseBusinessDeepLink(`mingla-business://brand/brand-1/ads/${PLAN}`)).toBe(`/(tabs)/marketing/ads/${PLAN}?by=plan`);
    expect(parseBusinessDeepLink("mingla-business://brand/brand-1/ads")).toBe("/(tabs)/marketing/ads");
    expect(resolveBusinessNavTarget({ type: "business.ad_paused", planId: PLAN })).toBe(`/(tabs)/marketing/ads/${PLAN}?by=plan`);
    expect(resolveBusinessNavTarget({ type: "business.ad_credit_low" })).toBe("/(tabs)/marketing/ads");
    expect(read("src/screens/hostAds/HostAdDetailScreen.tsx")).toContain("resolveHostAdCampaignForPlan");
  });
});

describe("#4238 W6b no payment provider in Host words", () => {
  test("screens, sheets and the English words name no provider", () => {
    const files = [
      "src/screens/hostAds/HostAdDetailScreen.tsx",
      "src/screens/hostAds/HostAdListScreen.tsx",
      "src/components/marketing/ads/HostAdManageSheets.tsx",
      "src/components/ari/AriAdCardExtras.tsx",
    ];
    for (const file of files) {
      const visible = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(/paystackReference|checkoutSessionId|mingla_adc_/g, "");
      expect({ file, provider: /stripe|paystack|flutterwave|adyen|paypal/i.test(visible) }).toEqual({ file, provider: false });
    }
    const manage = JSON.stringify(JSON.parse(read("src/i18n/locales/en/hostAds.json")).hostAds.manage);
    expect(/stripe|paystack|flutterwave|adyen|paypal|\bVAT\b/i.test(manage)).toBe(false);
  });
});
