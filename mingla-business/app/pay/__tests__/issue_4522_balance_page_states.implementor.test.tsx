/**
 * #4522 first screen test (S-3, S-4, S-5, S-6, S-14, S-15, S-16) — the buyer
 * web balance page `/pay/balance/[token]`, rendered with its real panel and
 * the shared tripBalance helpers; only the network service is mocked, with
 * the answers trip-balance-pay gives.
 *
 * FAILS ON REVERT: an Other amount that only greys the button, a written-off
 * 49c balance shown as "Something went wrong", a balance cleared elsewhere
 * shown as "We couldn't find this booking.", an unknown link shown as "Check
 * your connection", no refunded-overpayment line, no set-dates line, naira
 * with ".00", three identical option cards.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

type Props = Record<string, unknown>;

const mockView = jest.fn<(token: string) => Promise<unknown>>();
const mockStart = jest.fn<(input: unknown) => Promise<unknown>>();
const mockStatus = jest.fn<(token: string) => Promise<unknown>>();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ token: "tok-1" }),
}));
jest.mock("../../../src/components/ui/SafeScreen", () => ({
  SafeScreen: (props: Props) => React.createElement("SafeScreen", props, props.children as React.ReactNode),
}));
// Host stand-ins for the design-system controls (their animation stack is not
// what this suite tests); the props the page passes are what is asserted.
jest.mock("../../../src/components/ui/Button", () => ({
  Button: (props: Props) => React.createElement("Button", props),
}));
jest.mock("../../../src/components/ui/Input", () => ({
  Input: (props: Props) => React.createElement("Input", props),
}));
jest.mock("../../../src/components/trip/TripBalanceStripePayment", () => ({
  TripBalanceStripePayment: () => null,
}));
jest.mock("../../../src/services/tripBalancePayService", () => {
  class TripBalancePayError extends Error {
    readonly code: string;
    readonly status: number | null;
    constructor(code: string, status: number | null = null) {
      super(code);
      this.code = code;
      this.status = status;
    }
  }
  return {
    TripBalancePayError,
    viewTripBalanceLink: (token: string) => mockView(token),
    startTripBalanceLink: (input: unknown) => mockStart(input),
    statusTripBalanceLink: (token: string) => mockStatus(token),
  };
});

import { decodeTripBalance } from "@mingla/offering-rendering/tripBalance";
import TripBalancePayPage from "../balance/[token]";

const { TripBalancePayError } = require("../../../src/services/tripBalancePayService") as {
  TripBalancePayError: new (code: string, status?: number | null) => Error;
};

type Node = { type: unknown; props: Props; children: unknown[] };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (p: (n: Node) => boolean) => Node[] };
    toJSON: () => unknown;
    unmount: () => void;
  };
  act: (callback: () => unknown) => Promise<void>;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const raw = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  orderId: "order-1",
  currency: "USD",
  depositMinor: 30_000,
  paidMinor: 30_000,
  remainingMinor: 90_000,
  totalMinor: 120_000,
  canPayAnyAmount: true,
  minPaymentMinor: 9_000,
  maxPartialMinor: 89_950,
  providerMinimumMinor: 50,
  paymentInFlight: false,
  nextPayment: { installmentId: "r1", dueAt: "2026-12-19T09:00:00Z", amountMinor: 30_000 },
  openRows: [
    { installmentId: "r1", dueAt: "2026-12-19T09:00:00Z", amountMinor: 30_000 },
    { installmentId: "r2", dueAt: "2027-01-15T09:00:00Z", amountMinor: 30_000 },
    { installmentId: "r3", dueAt: "2027-02-10T09:00:00Z", amountMinor: 30_000 },
  ],
  history: [],
  heldCreditMinor: 0,
  overpaymentRefundedMinor: 0,
  ...overrides,
});
const view = (state: string, balance: Record<string, unknown> | null) => ({
  state,
  tripTitle: "Zanzibar",
  brandName: "C24S",
  provider: "stripe",
  balance: balance === null ? null : decodeTripBalance(balance),
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await TestRenderer.act(async () => {
      await Promise.resolve();
    });
  }
};
const mount = async () => {
  let tree!: ReturnType<typeof TestRenderer.create>;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(React.createElement(TripBalancePayPage));
  });
  await flush();
  return tree;
};
const allText = (tree: ReturnType<typeof TestRenderer.create>): string => {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      const n = node as { children?: unknown; props?: Props };
      if (typeof n.props?.value === "string") out.push(n.props.value as string);
      if (n.children) walk(n.children);
    }
  };
  walk(tree.toJSON());
  return out.join(" | ");
};
const pressable = (tree: ReturnType<typeof TestRenderer.create>, label: string): Node | undefined =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function")[0];
const pressPay = async (tree: ReturnType<typeof TestRenderer.create>): Promise<void> => {
  const button = tree.root.findAll(
    (n) => typeof n.props.label === "string" && (n.props.label as string).startsWith("Pay ") &&
      typeof n.props.onPress === "function",
  )[0];
  expect(button).toBeDefined();
  await TestRenderer.act(async () => {
    (button.props.onPress as () => void)();
  });
  await flush();
};

beforeEach(() => {
  mockView.mockReset();
  mockStart.mockReset();
  mockStatus.mockReset();
});

describe("#4522 buyer web balance page — first screen test findings", () => {
  test("S-3 Other amount says why it can't be paid, with the amounts that can", async () => {
    mockView.mockResolvedValue(view("payable", raw()));
    const tree = await mount();
    const other = pressable(tree, "Other amount");
    await TestRenderer.act(async () => {
      (other?.props.onPress as () => void)();
    });
    const input = tree.root.findAll(
      (n) => n.props.accessibilityLabel === "Other payment amount" && typeof n.props.onChangeText === "function",
    )[0];
    const type = async (value: string) => {
      await TestRenderer.act(async () => {
        (input.props.onChangeText as (v: string) => void)(value);
      });
    };
    expect(allText(tree)).not.toContain("The smallest payment");
    await type("50");
    expect(allText(tree)).toContain("The smallest payment is $90.");
    await type("901");
    expect(allText(tree)).toContain("That's more than your balance of $900.");
    await type("899.80");
    expect(allText(tree)).toContain("Pay up to $899.50, or the full $900.");
    await type("250");
    expect(allText(tree)).not.toContain("That would leave");
    expect(allText(tree)).not.toContain("The smallest payment");
    await TestRenderer.act(async () => { tree.unmount(); });
  });

  test("S-4 a balance below the provider's minimum stays owed: a short neutral line, no pay button, never paid in full", async () => {
    mockView.mockResolvedValue(view("payable", raw({
      paidMinor: 119_951, remainingMinor: 49, maxPartialMinor: null, minPaymentMinor: 49,
      providerMinimumMinor: 50,
      nextPayment: { installmentId: "r3", dueAt: "2027-02-10T09:00:00Z", amountMinor: 49 },
      openRows: [{ installmentId: "r3", dueAt: "2027-02-10T09:00:00Z", amountMinor: 49 }],
    })));
    const tree = await mount();
    const out = allText(tree);
    expect(out).toContain("A small balance of $0.49 is left. We'll be in touch about it.");
    expect(out).not.toContain("Paid in full");
    expect(out).not.toContain("too small to charge, so it has been cleared");
    const payButtons = tree.root.findAll((n) =>
      n.props.accessibilityRole === "radio" || (n.props.accessibilityRole === "button" && /^Pay/.test(String(n.props.accessibilityLabel ?? "")))
    );
    expect(payButtons).toHaveLength(0);
    expect(mockStart).not.toHaveBeenCalled();
    await TestRenderer.act(async () => { tree.unmount(); });
  });

  test("S-6 a balance cleared elsewhere shows paid in full, not 'couldn't find this booking'", async () => {
    mockView
      .mockResolvedValueOnce(view("payable", raw()))
      .mockResolvedValueOnce(view("paid", null));
    mockStart.mockRejectedValue(new TripBalancePayError("balance_not_found", 404));
    const tree = await mount();
    await pressPay(tree);
    const out = allText(tree);
    expect(out).not.toContain("We couldn't find this booking.");
    expect(out).toContain("Paid in full");
    await TestRenderer.act(async () => { tree.unmount(); });
  });

  test("S-14 an unknown link says the link isn't valid, not 'check your connection'", async () => {
    mockView.mockRejectedValue(new TripBalancePayError("balance_link_invalid", 404));
    const tree = await mount();
    const out = allText(tree);
    expect(out).toContain("This link isn't valid");
    expect(out).not.toContain("Check your connection");
    await TestRenderer.act(async () => { tree.unmount(); });
  });

  test("S-5 a refunded overpayment is shown on the paid-in-full page", async () => {
    mockView.mockResolvedValue(view("paid", raw({
      paidMinor: 120_000, remainingMinor: 0, canPayAnyAmount: false, minPaymentMinor: null,
      maxPartialMinor: null, nextPayment: null, openRows: [], overpaymentRefundedMinor: 30_000,
    })));
    const tree = await mount();
    const out = allText(tree);
    expect(out).toContain("Paid in full");
    expect(out).toContain("You paid $300 more than was due. It was refunded to your original payment method.");
    await TestRenderer.act(async () => { tree.unmount(); });
  });

  test("S-15 / S-16 set payment dates line, and naira without .00", async () => {
    mockView.mockResolvedValue(view("payable", raw({
      currency: "NGN", canPayAnyAmount: false, minPaymentMinor: null, maxPartialMinor: null,
      depositMinor: 30_000_000, paidMinor: 30_000_000, remainingMinor: 90_000_000, totalMinor: 120_000_000,
      nextPayment: { installmentId: "r1", dueAt: "2026-12-19T09:00:00Z", amountMinor: 30_000_000 },
      openRows: [
        { installmentId: "r1", dueAt: "2026-12-19T09:00:00Z", amountMinor: 30_000_000 },
        { installmentId: "r2", dueAt: "2027-01-15T09:00:00Z", amountMinor: 30_000_000 },
        { installmentId: "r3", dueAt: "2027-02-10T09:00:00Z", amountMinor: 30_000_000 },
      ],
    })));
    const tree = await mount();
    const out = allText(tree);
    expect(out).toContain("The host has set payment dates, so you can pay the next payment or everything.");
    expect(out).toContain("₦900,000");
    expect(out).not.toContain("₦900,000.00");
    await TestRenderer.act(async () => { tree.unmount(); });
  });
});
