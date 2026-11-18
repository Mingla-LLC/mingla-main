/**
 * #4238 W6a — the builder's top-up sheet: every amount is what the Host
 * pays, the fee is said once under it with the exact split, the way to pay
 * names no provider, and Pay sends the pay figure to the server.
 * FAILS-ON-REVERT: showing the credit as "You pay", dropping the fee split,
 * or naming a payment provider fails below.
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

const mockQuote = jest.fn();
const mockStart = jest.fn();
const mockApply = jest.fn();
const mockPresent = jest.fn();

jest.mock("../../../ui/Button", () => {
  const { Pressable, Text: RNText } = jest.requireActual("react-native");
  return {
    Button: (props: { label: string; onPress: () => void; testID?: string }) => (
      <Pressable onPress={props.onPress} testID={props.testID} accessibilityLabel={props.label}>
        <RNText>{props.label}</RNText>
      </Pressable>
    ),
  };
});
jest.mock("../../../ui/Input", () => ({ Input: () => null }));
jest.mock("../../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../ui/Switch", () => ({ Switch: () => null }));
jest.mock("../../../../utils/hapticFeedback", () => ({ HapticFeedback: { selectionEnter: jest.fn(), success: jest.fn() } }));
jest.mock("../../../ui/Sheet", () => ({
  Sheet: (props: { visible: boolean; children: React.ReactNode }) => (props.visible ? props.children : null),
}));
jest.mock("../../../../payments/useAdCreditTopUpPay", () => ({
  useAdCreditTopUpPay: () => mockPresent,
}));
jest.mock("../../../../services/adCreditService", () => ({
  quoteAdCreditTopUp: (...args: unknown[]) => mockQuote(...args),
  startAdCreditTopUp: (...args: unknown[]) => mockStart(...args),
  applyAdCreditTopUp: (...args: unknown[]) => mockApply(...args),
}));
jest.mock("../../../../services/adCreditQuoteErrors", () => ({
  mapAdCreditQuoteError: () => "That didn't work.",
}));

// eslint-disable-next-line import/first
import { HostAdTopUpSheet } from "../HostAdTopUpSheet";

const money = (cents: number): string => `₦${(cents / 100).toLocaleString("en-NG")}`;

function allText(renderer: ReactTestRenderer): string {
  return renderer.root
    .findAll((node) => typeof node.props.children === "string" || (Array.isArray(node.props.children) && typeof node.type === "string"))
    .map((node) => {
      const children = node.props.children as unknown;
      return Array.isArray(children) ? children.join("") : String(children ?? "");
    })
    .join(" | ");
}

describe("#4238 W6a top-up sheet", () => {
  beforeEach(() => {
    mockQuote.mockReset().mockResolvedValue({ ok: true });
    mockStart.mockReset().mockResolvedValue({ ok: true, kind: "requires_payment_sheet" });
    mockApply.mockReset().mockResolvedValue({ ok: true });
    mockPresent.mockReset().mockResolvedValue({ outcome: "succeeded", paymentIntentId: "pi_1" });
  });

  it("shows what the Host pays, the 15% split once, and no provider name", async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <HostAdTopUpSheet
          visible
          brandId="brand-1"
          currency="NGN"
          neededCents={72_500_00}
          returnPath="/marketing/ads/create?draft_id=d1&step=review"
          money={money}
          onClose={jest.fn()}
          onApplied={jest.fn()}
        />,
      );
    });
    const text = allText(r);
    expect(r.root.findByProps({ testID: "host-ad-topup-pay" }).props.children).toBe("₦72,500");
    // ₦72,500 → ₦61,625 to the ads, ₦10,875 Mingla fee.
    expect(text).toContain("Of this, ₦61,625 goes to the ads and ₦10,875 is the 15% Mingla fee.");
    expect(text).toContain("What you need");
    expect(text).toContain("Card and other ways to pay · in NGN");
    expect(text).not.toMatch(/stripe|paystack|flutterwave|link\b/i);
  });

  it("Pay sends the pay figure, then applies the payment", async () => {
    const onApplied = jest.fn();
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <HostAdTopUpSheet
          visible
          brandId="brand-1"
          currency="NGN"
          neededCents={72_500_00}
          returnPath="/marketing/ads/create?draft_id=d1&step=review"
          money={money}
          onClose={jest.fn()}
          onApplied={onApplied}
        />,
      );
    });
    await act(async () => {
      (r.root.findByProps({ testID: "host-ad-topup-pay-button" }).props.onPress as () => void)();
    });
    expect(mockQuote).toHaveBeenCalledWith("brand-1", 72_500_00);
    expect(mockStart.mock.calls[0][0]).toMatchObject({ brandId: "brand-1", payCents: 72_500_00 });
    expect(String((mockStart.mock.calls[0][0] as { returnUrl: string }).returnUrl)).toContain("/marketing/ads/create?draft_id=d1&step=review");
    expect(mockApply).toHaveBeenCalledWith({ brandId: "brand-1", paymentRef: "pi_1", idempotencyKey: "top_up:pi_1" });
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("#4238: starts at the currency minimum and keeps Pay off below it", async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <HostAdTopUpSheet
          visible
          brandId="brand-1"
          currency="NGN"
          neededCents={50_000_00}
          options={[20_000_00, 50_000_00, 100_000_00]}
          limits={{ min_pay_cents: 25_000_00, max_pay_cents: 7_500_000_00 }}
          returnPath="/marketing/ads"
          money={money}
          onClose={jest.fn()}
          onApplied={jest.fn()}
        />,
      );
    });
    const labels = [0, 1, 2].map(
      (i) => r.root.findByProps({ testID: `host-ad-topup-amount-${i}` }).props.accessibilityLabel,
    );
    expect(labels).toEqual(["₦25,000", "₦50,000", "₦100,000"]);
    expect(allText(r)).toContain("The least you can top up is ₦25,000.");
    // Pick the minimum: Pay is on and sends it.
    await act(async () => {
      (r.root.findByProps({ testID: "host-ad-topup-amount-0" }).props.onPress as () => void)();
    });
    await act(async () => {
      (r.root.findByProps({ testID: "host-ad-topup-pay-button" }).props.onPress as () => void)();
    });
    expect(mockQuote).toHaveBeenCalledWith("brand-1", 25_000_00);
  });

  it("#4238: a shortfall under the minimum is offered as the minimum", async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <HostAdTopUpSheet
          visible
          brandId="brand-1"
          currency="NGN"
          neededCents={5_000_00}
          limits={{ min_pay_cents: 25_000_00, max_pay_cents: 7_500_000_00 }}
          returnPath="/marketing/ads"
          money={money}
          onClose={jest.fn()}
          onApplied={jest.fn()}
        />,
      );
    });
    expect(r.root.findByProps({ testID: "host-ad-topup-pay" }).props.children).toBe("₦25,000");
    await act(async () => {
      (r.root.findByProps({ testID: "host-ad-topup-pay-button" }).props.onPress as () => void)();
    });
    expect(mockQuote).toHaveBeenCalledWith("brand-1", 25_000_00);
  });
});
