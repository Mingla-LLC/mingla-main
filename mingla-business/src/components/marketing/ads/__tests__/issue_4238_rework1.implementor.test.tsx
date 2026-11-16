// MINGLA-INVARIANT: I-4238-EDIT-TOTAL-IS-DAILY-TIMES-DAYS-LEFT | issue #4238 rework 1 | The live edit sheet starts from the plan's daily in the brand's money (server plan_daily_credit_cents) and sends the new total as spent + daily credit × days left to the end date; an unknown daily hides the stepper and never sends a total built on it.
/**
 * #4238 rework 1 (after the tester FAIL on 27212fe70f) — Host app side.
 *
 * Executed behaviour, rendered:
 *  P1-2 / P1-3  the edit sheet: TikTok-only and NGN-on-USD ads start from the
 *               plan's daily in the brand's money; the total is spent + daily
 *               × days left, never daily = total; an unknown daily hides the
 *               stepper.
 *  P1-1         Share results goes through sharePublicUrl, never Share.share.
 *  P2-2         Promote home summary in pay terms and in the Host's words.
 *  P2-3         a cancelled or re-amounted top-up starts a new attempt key.
 *  restored     unknown credit-history kinds never show their raw code.
 */
import React from "react";

type RenderNode = { props: Record<string, unknown>; type: unknown };
type ReactTestRenderer = {
  root: {
    findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[];
    findByProps: (props: Record<string, unknown>) => RenderNode;
  };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => Promise<void> | void) => Promise<void>;
  create: (el: React.ReactElement) => ReactTestRenderer;
};

const mockShare = jest.fn();
const mockQuote = jest.fn();
const mockStart = jest.fn();
const mockApply = jest.fn();
const mockPresent = jest.fn();
const mockStatement = jest.fn();

jest.mock("../../../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock("../../../../utils/sharePublicUrl", () => ({
  sharePublicUrl: (...args: unknown[]) => mockShare(...args),
}));
jest.mock("../../../ui/Button", () => {
  const { Pressable, Text: RNText } = jest.requireActual("react-native");
  return {
    Button: (props: { label: string; onPress: () => void; testID?: string; disabled?: boolean }) => (
      <Pressable onPress={props.onPress} testID={props.testID} accessibilityLabel={props.label} disabled={props.disabled}>
        <RNText>{props.label}</RNText>
      </Pressable>
    ),
  };
});
jest.mock("../../../ui/DateField", () => ({ DateField: () => null }));
jest.mock("../../../ui/Input", () => ({ Input: () => null }));
jest.mock("../../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../ui/Switch", () => ({ Switch: () => null }));
jest.mock("../../../../utils/hapticFeedback", () => ({ HapticFeedback: { selectionEnter: jest.fn(), success: jest.fn() } }));
jest.mock("../../../ui/Sheet", () => ({
  Sheet: (props: { visible: boolean; children: React.ReactNode }) => (props.visible ? props.children : null),
}));
jest.mock("../../../ui/GlassCard", () => ({
  GlassCard: (props: { children: React.ReactNode; testID?: string }) => {
    const { View } = jest.requireActual("react-native");
    return <View testID={props.testID}>{props.children}</View>;
  },
}));
jest.mock("react-native-svg", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require("react") as typeof React;
  const make = (name: string) => (props: Record<string, unknown>) =>
    ReactLib.createElement(name, props, props.children as React.ReactNode);
  return { __esModule: true, default: make("Svg"), Path: make("Path") };
});
jest.mock("../../../../payments/useAdCreditTopUpPay", () => ({ useAdCreditTopUpPay: () => mockPresent }));
jest.mock("../../../../services/adCreditService", () => ({
  quoteAdCreditTopUp: (...args: unknown[]) => mockQuote(...args),
  startAdCreditTopUp: (...args: unknown[]) => mockStart(...args),
  applyAdCreditTopUp: (...args: unknown[]) => mockApply(...args),
  applyAdCreditWithdraw: jest.fn(),
  getAdCreditReceipt: jest.fn(),
  getAdCreditStatement: (...args: unknown[]) => mockStatement(...args),
  quoteAdCreditWithdraw: jest.fn(),
}));
jest.mock("../../../../services/adCreditQuoteErrors", () => ({ mapAdCreditQuoteError: () => "That didn't work." }));

// eslint-disable-next-line import/first
import { HostAdEditBudgetSheet, HostAdReceiptsSheet, HostAdShareSheet } from "../HostAdManageSheets";
// eslint-disable-next-line import/first
import { HostAdTopUpSheet } from "../HostAdTopUpSheet";
// eslint-disable-next-line import/first
import { AdListSummaryCard } from "../results/AdListSummaryCard";
// eslint-disable-next-line import/first
import { hostAdCreditFromPay, hostAdPayFromCredit } from "../hostAdBuilderModel";
// eslint-disable-next-line import/first
import { hostAdLedgerLabel } from "../hostAdCopy";
// eslint-disable-next-line import/first
import { hostAdBudgetCard, hostAdDaysLeft, hostAdDetailDailyCredit, hostAdEditStep } from "../hostAdManageModel";

const naira = (cents: number): string => `₦${(cents / 100).toLocaleString("en-NG")}`;
const NOW = "2028-07-20T12:00:00.000Z";
const IN_20_DAYS = "2028-08-09T12:00:00.000Z";

function allText(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAll((node) => typeof node.props.children === "string" || (Array.isArray(node.props.children) && typeof node.type === "string"))
    .map((node) => {
      const children = node.props.children as unknown;
      return Array.isArray(children) ? children.join("") : String(children ?? "");
    })
    .join(" | ");
}

async function press(r: ReactTestRenderer, testID: string): Promise<void> {
  const node = r.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
  if (!node) throw new Error(`no pressable ${testID}`);
  await act(async () => {
    (node.props.onPress as () => void)();
  });
}

type EditProps = React.ComponentProps<typeof HostAdEditBudgetSheet>;
function editSheet(over: Partial<EditProps>, onSubmit: jest.Mock): React.ReactElement {
  return (
    <HostAdEditBudgetSheet
      visible
      currency="NGN"
      money={naira}
      capCredit={70_000_00}
      dailyCredit={2_333_00}
      minDailyPay={1_000_00}
      spentCredit={23_330_00}
      walletCredit={1_000_000_00}
      currentEndsAt={IN_20_DAYS}
      timezone="UTC"
      nowIso={NOW}
      learning={false}
      daysLive={10}
      busy={false}
      needsLearningConfirm={false}
      error={null}
      onTopUp={jest.fn()}
      onClose={jest.fn()}
      onSubmit={onSubmit}
      {...over}
    />
  );
}

describe("P1-2 / P1-3: the detail daily and the edit sheet", () => {
  test("the daily is the server's plan figure; anything else is unknown, never 0", () => {
    expect(hostAdDetailDailyCredit(2_333_00)).toBe(2_333_00);
    for (const bad of [0, -5, null, undefined, "2333", Number.NaN, 1.5]) {
      expect(hostAdDetailDailyCredit(bad)).toBeNull();
    }
    expect(hostAdBudgetCard({ dailyCredit: null, capCredit: 70_000_00, spentCredit: 0 }).dailyPay).toBeNull();
    expect(hostAdDaysLeft(NOW, IN_20_DAYS)).toBe(20);
    expect(hostAdDaysLeft(NOW, "2028-07-20T13:00:00.000Z")).toBe(1);
    expect(hostAdDaysLeft(NOW, null)).toBeNull();
  });

  test("P1-2: raising the daily on a live TikTok-only ad sends spent + daily × days left, never a one-day total (fail-on-revert)", async () => {
    const onSubmit = jest.fn();
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(editSheet({}, onSubmit));
    });
    // Starts at the plan's daily in pay terms (₦2,333 credit → ₦2,744.71 pay).
    expect(r.root.findByProps({ testID: "host-ad-edit-total" }).props.children).toBe(naira(hostAdPayFromCredit(2_333_00)));
    await press(r, "host-ad-edit-raise");
    await press(r, "host-ad-edit-save");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const sent = onSubmit.mock.calls[0][0] as { newBudgetCredit: number };
    const start = hostAdPayFromCredit(2_333_00);
    const newDailyPay = start + hostAdEditStep(start);
    expect(sent.newBudgetCredit).toBe(23_330_00 + hostAdCreditFromPay(newDailyPay) * 20);
    // The old bug: total = one day of the new daily (about 2,500 of 70,000).
    expect(sent.newBudgetCredit).toBeGreaterThan(70_000_00);
    expect(allText(r)).toContain("20 days left");
  });

  test("P1-3: an NGN brand on a USD ad account steps Naira (fail-on-revert)", async () => {
    // ₦16,000 a day of credit (the plan's NGN figure). The old screen summed the
    // USD account's daily_budget_cents (1,000 US cents) and showed ₦11.77.
    const onSubmit = jest.fn();
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(editSheet({ dailyCredit: 16_000_00, capCredit: 480_000_00, spentCredit: 160_000_00 }, onSubmit));
    });
    expect(r.root.findByProps({ testID: "host-ad-edit-total" }).props.children).toBe(naira(hostAdPayFromCredit(16_000_00)));
    expect(allText(r)).not.toContain("₦11.77");
    await press(r, "host-ad-edit-lower");
    await press(r, "host-ad-edit-save");
    const sent = onSubmit.mock.calls[0][0] as { newBudgetCredit: number };
    const step = hostAdEditStep(hostAdPayFromCredit(16_000_00));
    expect(sent.newBudgetCredit).toBe(160_000_00 + hostAdCreditFromPay(hostAdPayFromCredit(16_000_00) - step) * 20);
  });

  test("an unknown daily hides the stepper and never sends a total", async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(editSheet({ dailyCredit: null }, jest.fn()));
    });
    expect(r.root.findAll((n) => n.props.testID === "host-ad-edit-raise")).toHaveLength(0);
    expect(r.root.findAll((n) => n.props.testID === "host-ad-edit-daily-unknown").length).toBeGreaterThan(0);
  });

  test("an untouched sheet sends nothing", async () => {
    const onSubmit = jest.fn();
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(editSheet({}, onSubmit));
    });
    const save = r.root.findAll((n) => n.props.testID === "host-ad-edit-save" && typeof n.props.onPress === "function")[0];
    expect(save.props.disabled).toBe(true);
  });
});

describe("P1-1: Share results goes through the sanctioned share helper", () => {
  test("Share calls sharePublicUrl with the public link and the results line (fail-on-revert)", async () => {
    mockShare.mockReset().mockResolvedValue(undefined);
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <HostAdShareSheet
          visible
          title="Summer Jam"
          url="https://usemingla.com/e/rooftop/summer-jam"
          message="Summer Jam sold out: 40 tickets through Mingla."
          onClose={jest.fn()}
        />,
      );
    });
    await press(r, "host-ad-share-go");
    expect(mockShare).toHaveBeenCalledWith({
      title: "Summer Jam",
      url: "https://usemingla.com/e/rooftop/summer-jam",
      description: "Summer Jam sold out: 40 tickets through Mingla.",
    });
  });
});

describe("P2-2: Promote home summary", () => {
  test("shows what the Host pays, never the credit", async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <AdListSummaryCard
          summary={{ currency: "USD", spent_cents: 0, budget_cents: 700_00, results: 1, daily_spend: [] }}
        />,
      );
    });
    const text = allText(r);
    // USD 700.00 of credit is USD 823.53 paid (the detail page's figure).
    expect(text).toContain("of USD 823.53");
    expect(text).not.toContain("USD 700.00");
    expect(text).toContain("1 result");
  });
});

describe("P2-3: a top-up retried after a cancel or a new amount", () => {
  beforeEach(() => {
    mockQuote.mockReset().mockResolvedValue({ ok: true });
    mockStart.mockReset().mockResolvedValue({ ok: true, kind: "requires_checkout_redirect" });
    mockApply.mockReset().mockResolvedValue({ ok: true });
    mockPresent.mockReset();
  });

  async function sheet(): Promise<ReactTestRenderer> {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <HostAdTopUpSheet
          visible
          brandId="brand-1"
          currency="NGN"
          neededCents={50_000_00}
          returnPath="/marketing/ads"
          money={naira}
          onClose={jest.fn()}
          onApplied={jest.fn()}
        />,
      );
    });
    return r;
  }
  const keys = (): string[] => mockStart.mock.calls.map((call) => (call[0] as { idempotencyKey: string }).idempotencyKey);

  test("Pay after a cancel uses a new attempt key (fail-on-revert)", async () => {
    mockPresent.mockResolvedValueOnce({ outcome: "canceled" }).mockResolvedValueOnce({ outcome: "succeeded", paymentIntentId: "ref_2" });
    const r = await sheet();
    await press(r, "host-ad-topup-pay-button");
    expect(allText(r)).toContain("Payment cancelled");
    await press(r, "host-ad-topup-pay-button");
    expect(keys()).toHaveLength(2);
    expect(keys()[0]).not.toBe(keys()[1]);
  });

  test("the top-up resets when the amount changes (restored protection)", async () => {
    mockPresent.mockRejectedValueOnce(new Error("network")).mockRejectedValueOnce(new Error("network")).mockRejectedValueOnce(new Error("network"));
    const r = await sheet();
    await press(r, "host-ad-topup-pay-button");
    await press(r, "host-ad-topup-pay-button");
    // Same amount after a transport error: the same attempt (idempotent).
    expect(keys()[0]).toBe(keys()[1]);
    await press(r, "host-ad-topup-amount-1");
    await press(r, "host-ad-topup-pay-button");
    expect(keys()[2]).not.toBe(keys()[1]);
    expect((mockStart.mock.calls[2][0] as { payCents: number }).payCents).not.toBe(50_000_00);
  });
});

describe("restored: unknown credit-history kinds never show their raw code", () => {
  test("plain labels for every kind; unknown kinds get the generic phrase", () => {
    expect(hostAdLedgerLabel("top_up")).toBe("Credit added");
    expect(hostAdLedgerLabel("withdraw")).toBe("Credit withdrawn");
    expect(hostAdLedgerLabel("future_kind_x")).toBe("Ads credit change");
    expect(hostAdLedgerLabel(null)).toBe("Ads credit change");
  });

  test("the receipts sheet never renders an unknown kind's code", async () => {
    let r!: ReactTestRenderer;
    const row = (id: string, entry_kind: string) => ({
      id,
      entry_kind,
      amount_cents: 10_000_00,
      fee_cents: 0,
      pay_cents: 10_000_00,
      refund_cents: null,
      balance_after_cents: 0,
      currency: "NGN",
      created_at: NOW,
    });
    await act(async () => {
      r = create(
        <HostAdReceiptsSheet
          visible
          brandId="brand-1"
          money={naira}
          history={[row("a", "top_up"), row("b", "future_kind_x"), row("c", "campaign_spend")] as never}
          nowIso={NOW}
          onClose={jest.fn()}
        />,
      );
    });
    const text = allText(r);
    expect(text).not.toMatch(/future_kind_x|campaign_spend|top_up/);
    expect(r.root.findAll((n) => n.props.testID === "host-ad-receipt-row-0").length).toBeGreaterThan(0);
    expect(r.root.findAll((n) => n.props.testID === "host-ad-receipt-row-1")).toHaveLength(0);
  });

  test("the month statement names each ad by the server's ad name (W6c statement names)", async () => {
    mockStatement.mockReset().mockResolvedValue({
      month: "2028-07",
      currency: "NGN",
      opening_balance_cents: 0,
      top_ups_cents: 10_000_00,
      fees_cents: 1_500_00,
      returns_cents: 0,
      withdrawals_cents: 0,
      closing_balance_cents: 8_500_00,
      spend_by_ad: [{ ad_key: "plan:p1", ad_name: "  Summer Jam  ", net_cents: -2_000_00 }],
      lines: [],
    });
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <HostAdReceiptsSheet visible brandId="brand-1" money={naira} history={[]} nowIso={NOW} onClose={jest.fn()} />,
      );
    });
    await press(r, "host-ad-statement-row");
    const text = allText(r);
    expect(text).toContain("Summer Jam");
    expect(text).not.toMatch(/plan:p1|Ad 1/);
  });
});
