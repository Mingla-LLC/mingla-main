/**
 * issue #4522 S-2 (spec §9.11) — the host money screen for plan-v2 orders.
 *
 * Every balance below is the raw jsonb issue_4522_balance returns (what
 * biz_trip_event_balances hands the screen), decoded by the real
 * decodeHostTripBalance + shared decodeTripBalance; the rows are the
 * order_installments shapes the screen tester seeded (sql/seed_orders.sql).
 *
 * FAILS ON REVERT: owed money summed from rows ("$0.00 left" mid-plan), a raw
 * "superseded" status, a closed flexible attempt listed as an instalment, a
 * written-off order offering Charge now, or Charge now while a traveler
 * payment is processing.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

type Props = Record<string, unknown>;

const chargeMutate = jest.fn();
let installments: unknown[] = [];
let balances: unknown[] = [];

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "4878b0a2-d135-4ec2-bae0-d3c306ad59dd" }),
  useRouter: () => ({ canGoBack: () => true, back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("../../../../../src/services/supabase", () => ({ supabase: {} }));
jest.mock("../../../../../src/components/ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../../../src/components/ui/SafeScreen", () => ({
  SafeScreen: (props: Props) => React.createElement("SafeScreen", props, props.children as React.ReactNode),
}));
jest.mock("../../../../../src/components/ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../../../../src/components/ui/TopBar", () => ({ TopBar: () => null }));
jest.mock("../../../../../src/components/ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Props) => React.createElement("ConfirmDialog", props),
}));
jest.mock("../../../../../src/components/trip/RefundPreviewSheet", () => ({ RefundPreviewSheet: () => null }));
jest.mock("../../../../../src/components/trip/InstallmentScheduleDisplay", () => ({
  InstallmentScheduleDisplay: (props: Props) => React.createElement("InstallmentScheduleDisplay", props),
}));
jest.mock("../../../../../src/hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ width: 390 }),
}));
jest.mock("../../../../../src/hooks/useTrips", () => ({
  useTrip: () => ({ isLoading: false, isError: false, data: { brandId: "brand-1", pricingTiers: [] } }),
}));
jest.mock("../../../../../src/hooks/useTripOrders", () => ({
  useTripOrders: () => ({ isLoading: false, isError: false, data: [], refetch: jest.fn() }),
}));
jest.mock("../../../../../src/hooks/useOrderInstallments", () => ({
  useInstallmentsForBrandTrips: () => ({ isLoading: false, isError: false, data: installments, refetch: jest.fn() }),
  useRetryInstallment: () => ({ isPending: false, mutate: jest.fn() }),
  useTripEventBalances: () => ({ isLoading: false, isError: false, data: balances, refetch: jest.fn() }),
}));
jest.mock("../../../../../src/hooks/useManualInstallmentActions", () => ({
  useChargeInstallmentNow: () => ({ isPending: false, mutate: chargeMutate }),
  useSendInstallmentReminder: () => ({ isPending: false, mutate: jest.fn() }),
  useRecentReminderForOrder: () => ({ isLoading: false, data: null }),
}));

import { decodeTripBalance } from "@mingla/offering-rendering/tripBalance";
import { decodeHostTripBalance } from "../../../../../src/services/orderInstallmentsService";
import TripMoneyRoute from "../index";

type Node = { type: unknown; props: Props; children: unknown[] };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (p: (n: Node) => boolean) => Node[] };
    toJSON: () => unknown;
    unmount: () => void;
  };
  act: (callback: () => void) => void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORDER = "c2450000-0000-4000-8000-00000000a002";
const TERMS = {
  v: 2,
  trip_start_at: "2027-03-12T00:00:00Z",
  final_due_at: "2027-02-10T00:00:00Z",
  time_zone: "UTC",
  auto_adjust: true,
  flex_enabled: true,
  min_payment_minor: 9000,
  deposit_minor: 30000,
  deposit_non_refundable: true,
  addon_payment_mode: null,
  count_offered: 3,
  count_given: 3,
};

const row = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  id: "inst-1",
  orderId: ORDER,
  ordinal: 1,
  kind: "scheduled",
  status: "scheduled",
  dueAt: "2026-12-19T09:00:00Z",
  amountCents: 30000,
  amountChargedCents: 30000,
  buyerTotalCents: null,
  refundedAmountCents: 0,
  currency: "USD",
  orderTotalCents: 30000,
  orderAtRisk: false,
  orderAtRiskSince: null,
  buyerName: "C24S Buyer",
  buyerEmail: "c24s-buyer@example.test",
  collectedAt: null,
  failedAt: null,
  failureReason: null,
  collectionMethod: "auto_card",
  provider: "stripe",
  buyerAction: "none",
  buyerActionAt: null,
  paymentCardLast4: "4242",
  retryCount: 0,
  nextRetryAt: null,
  ...overrides,
});

/** The raw jsonb issue_4522_balance builds (flex migration §3). */
const rawBalance = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  orderId: ORDER,
  eventId: "4878b0a2-d135-4ec2-bae0-d3c306ad59dd",
  currency: "USD",
  depositMinor: 30000,
  paidMinor: 30000,
  remainingMinor: 90000,
  totalMinor: 120000,
  terms: TERMS,
  addonPaymentMode: null,
  canPayAnyAmount: true,
  minPaymentMinor: 9000,
  maxPartialMinor: 89950,
  providerMinimumMinor: 50,
  waivedMinor: 0,
  paymentInFlight: false,
  heldCreditMinor: 0,
  overpaymentRefundedMinor: 0,
  overpayments: [],
  nextPayment: { installmentId: "inst-1", dueAt: "2026-12-19T09:00:00Z", amountMinor: 30000, status: "scheduled" },
  openRows: [],
  history: [],
  balanceEvents: [],
  ...overrides,
});

const host = (raw: Record<string, unknown>) => decodeHostTripBalance(raw, decodeTripBalance);

const render = () => {
  let tree!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    tree = TestRenderer.create(React.createElement(TripMoneyRoute));
  });
  return tree;
};
const text = (tree: ReturnType<typeof render>): string => JSON.stringify(tree.toJSON());
const byLabel = (tree: ReturnType<typeof render>, label: string): Node | undefined =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function")[0];
const press = (tree: ReturnType<typeof render>, label: string): void => {
  const node = byLabel(tree, label);
  expect(node).toBeDefined();
  TestRenderer.act(() => {
    (node?.props.onPress as () => void)();
  });
};
const findToggleLabel = (tree: ReturnType<typeof render>): string => {
  const node = tree.root.findAll(
    (n) => typeof n.props.accessibilityLabel === "string" &&
      (n.props.accessibilityLabel as string).startsWith("C24S Buyer, paid") &&
      typeof n.props.onPress === "function",
  )[0];
  return node.props.accessibilityLabel as string;
};
const charge = (tree: ReturnType<typeof render>): Node | undefined =>
  tree.root.findAll((n) => n.props.accessibilityLabel === "Charge now for C24S Buyer" && typeof n.props.onPress === "function")[0];

describe("#4522 S-2 host money screen, plan-v2 orders", () => {
  beforeEach(() => {
    chargeMutate.mockClear();
  });

  test("mid-plan: the server's $600 owed, not $0.00, and the plan terms line", () => {
    installments = [
      row({ id: "r1", status: "collected", dueAt: "2026-11-15T09:00:00Z", collectedAt: "2026-11-20T09:00:00Z" }),
      row({ id: "r2", ordinal: 2, dueAt: "2027-01-15T09:00:00Z" }),
      row({ id: "r3", ordinal: 3, dueAt: "2027-02-10T09:00:00Z" }),
    ];
    balances = [host(rawBalance({
      paidMinor: 60000,
      remainingMinor: 60000,
      maxPartialMinor: 59950,
      nextPayment: { installmentId: "r2", dueAt: "2027-01-15T09:00:00Z", amountMinor: 30000, status: "scheduled" },
      openRows: [
        { installmentId: "r2", dueAt: "2027-01-15T09:00:00Z", amountMinor: 30000, addonPortionMinor: 0, planLineId: "t1", status: "scheduled" },
        { installmentId: "r3", dueAt: "2027-02-10T09:00:00Z", amountMinor: 30000, addonPortionMinor: 0, planLineId: "t1", status: "scheduled" },
      ],
      history: [{ installmentId: "r1", kind: "scheduled", status: "collected", amountMinor: 30000, collectedAt: "2026-11-20T09:00:00Z", refundedMinor: 0 }],
    }))];
    const tree = render();
    const out = text(tree);
    expect(out).toContain("$600.00 left");
    expect(out).not.toContain("$0.00 left");
    expect(out).toContain("$600.00 / $1,200.00");
    expect(out).toContain("$300.00 deposit, then 3 payments, last one 30 days before departure · any amount allowed");
    expect(out).not.toContain("InstallmentScheduleDisplay");
    // Charge now acts on the next open scheduled row.
    press(tree, "Charge now for C24S Buyer");
    const confirm = tree.root.findAll((n) => n.type === "ConfirmDialog" && n.props.testID === "trip-money-charge-dialog")[0];
    TestRenderer.act(() => (confirm.props.onConfirm as () => void)());
    expect(chargeMutate).toHaveBeenCalledWith({ installmentId: "r2", atRiskOverride: false });
    TestRenderer.act(() => tree.unmount());
  });

  test("missed payment rolled over: Rebalanced chip and History, never raw superseded", () => {
    installments = [
      row({ id: "m1", status: "superseded", dueAt: "2026-11-10T09:00:00Z", failedAt: "2026-11-19T09:00:00Z", failureReason: "card_declined", retryCount: 3 }),
      row({ id: "m2", ordinal: 2, dueAt: "2027-01-15T09:00:00Z", amountCents: 45000, amountChargedCents: 45000 }),
      row({ id: "m3", ordinal: 3, dueAt: "2027-02-10T09:00:00Z", amountCents: 45000, amountChargedCents: 45000 }),
    ];
    balances = [host(rawBalance({
      nextPayment: { installmentId: "m2", dueAt: "2027-01-15T09:00:00Z", amountMinor: 45000, status: "scheduled" },
      openRows: [
        { installmentId: "m2", dueAt: "2027-01-15T09:00:00Z", amountMinor: 45000, addonPortionMinor: 0, planLineId: "t1", status: "scheduled" },
        { installmentId: "m3", dueAt: "2027-02-10T09:00:00Z", amountMinor: 45000, addonPortionMinor: 0, planLineId: "t1", status: "scheduled" },
      ],
      balanceEvents: [{ reason: "missed_rollover", triggerInstallmentId: "m1", createdAt: "2026-11-19T09:05:00Z", before: {}, after: {} }],
    }))];
    const tree = render();
    press(tree, findToggleLabel(tree));
    let out = text(tree);
    expect(out).toContain("$900.00 left");
    expect(out).toContain("Rebalanced");
    expect(out).not.toMatch(/"superseded"/);
    expect(out).not.toContain("Missed payment moved to later payments.");
    press(tree, "History");
    out = text(tree);
    expect(out).toContain("Missed payment moved to later payments.");
    TestRenderer.act(() => tree.unmount());
  });

  test("a closed flexible attempt is not an instalment; a paid one is Paid · partial", () => {
    installments = [
      row({ id: "f1", ordinal: 1, dueAt: "2026-12-19T09:00:00Z", amountCents: 26600, amountChargedCents: 26600 }),
      row({ id: "f2", ordinal: 2, dueAt: "2027-01-15T09:00:00Z", amountCents: 26600, amountChargedCents: 26600 }),
      row({ id: "f3", ordinal: 3, dueAt: "2027-02-10T09:00:00Z", amountCents: 26800, amountChargedCents: 26800 }),
      row({ id: "fx-closed", ordinal: 4, kind: "flex", status: "superseded", dueAt: "2026-11-21T09:00:00Z", amountCents: 10000, amountChargedCents: 10000, failureReason: "provider_create_failed" }),
      row({ id: "fx-paid", ordinal: 5, kind: "flex", status: "collected", dueAt: "2026-11-22T09:00:00Z", amountCents: 10000, amountChargedCents: 10000, collectedAt: "2026-11-22T09:01:00Z" }),
    ];
    balances = [host(rawBalance({
      paidMinor: 40000,
      remainingMinor: 80000,
      maxPartialMinor: 79950,
      nextPayment: { installmentId: "f1", dueAt: "2026-12-19T09:00:00Z", amountMinor: 26600, status: "scheduled" },
      openRows: [
        { installmentId: "f1", dueAt: "2026-12-19T09:00:00Z", amountMinor: 26600, addonPortionMinor: 0, planLineId: "t1", status: "scheduled" },
        { installmentId: "f2", dueAt: "2027-01-15T09:00:00Z", amountMinor: 26600, addonPortionMinor: 0, planLineId: "t1", status: "scheduled" },
        { installmentId: "f3", dueAt: "2027-02-10T09:00:00Z", amountMinor: 26800, addonPortionMinor: 0, planLineId: "t1", status: "scheduled" },
      ],
      history: [{ installmentId: "fx-paid", kind: "flex", status: "collected", amountMinor: 10000, collectedAt: "2026-11-22T09:01:00Z", refundedMinor: 0 }],
      balanceEvents: [{ reason: "flex_payment", triggerInstallmentId: "fx-paid", createdAt: "2026-11-22T09:01:30Z", before: {}, after: {} }],
    }))];
    const tree = render();
    press(tree, findToggleLabel(tree));
    press(tree, "History");
    const out = text(tree);
    expect(out).toContain("Paid · partial");
    expect(out).toContain("Traveler paid $100.00. Remaining payments updated.");
    // Deposit + three set payments + one paid flexible payment; the closed
    // attempt never shows.
    const ledgerLabels = [...new Set(tree.root
      .findAll((n) => n.props.accessibilityRole === "text" && typeof n.props.accessibilityLabel === "string")
      .map((n) => n.props.accessibilityLabel as string))];
    expect(ledgerLabels.filter((l) => l.startsWith("Deposit") || l.startsWith("Payment "))).toHaveLength(5);
    expect(ledgerLabels).toContain("Payment · Nov 22, 2026, $100.00, Paid · partial");
    expect(ledgerLabels).toContain("Payment 1 · Dec 19, 2026, $266.00, Scheduled");
    expect(ledgerLabels.filter((l) => l.includes("$100.00"))).toHaveLength(1);
    TestRenderer.act(() => tree.unmount());
  });

  test("written off below the provider minimum: settled, no Charge now", () => {
    installments = [
      row({ id: "w1", status: "superseded", dueAt: "2027-02-10T09:00:00Z", amountCents: 30, amountChargedCents: 30, failureReason: "waived_below_provider_minimum" }),
    ];
    balances = [host(rawBalance({
      depositMinor: 119970,
      paidMinor: 120000,
      remainingMinor: 0,
      totalMinor: 120000,
      canPayAnyAmount: false,
      minPaymentMinor: null,
      maxPartialMinor: null,
      waivedMinor: 30,
      nextPayment: null,
      openRows: [],
    }))];
    const tree = render();
    press(tree, findToggleLabel(tree));
    const out = text(tree);
    expect(out).toContain("$0.00 left");
    expect(out).not.toContain("$1,199.70 left");
    expect(out).toContain("Written off");
    expect(out).toContain("No reminder needed — paid in full");
    expect(charge(tree)?.props.disabled).toBe(true);
    TestRenderer.act(() => tree.unmount());
  });

  test("while a flexible payment is open, Charge now and Send reminder are disabled with the reason", () => {
    installments = [
      row({ id: "p1", dueAt: "2026-12-19T09:00:00Z" }),
      row({ id: "p2", ordinal: 2, dueAt: "2027-01-15T09:00:00Z" }),
      row({ id: "p3", ordinal: 3, dueAt: "2027-02-10T09:00:00Z" }),
      row({ id: "px", ordinal: 4, kind: "flex", status: "scheduled", dueAt: "2026-11-22T09:00:00Z", amountCents: 10000, amountChargedCents: 10000 }),
    ];
    balances = [host(rawBalance({
      paymentInFlight: true,
      openRows: ["p1", "p2", "p3"].map((id, i) => ({
        installmentId: id,
        dueAt: ["2026-12-19T09:00:00Z", "2027-01-15T09:00:00Z", "2027-02-10T09:00:00Z"][i],
        amountMinor: 30000,
        addonPortionMinor: 0,
        planLineId: "t1",
        status: "scheduled",
      })),
      nextPayment: { installmentId: "p1", dueAt: "2026-12-19T09:00:00Z", amountMinor: 30000, status: "scheduled" },
    }))];
    const tree = render();
    const out = text(tree);
    expect(out).toContain("A traveler payment is processing.");
    expect(charge(tree)?.props.disabled).toBe(true);
    const reminder = tree.root.findAll((n) => n.props.accessibilityLabel === "Send reminder" && typeof n.props.onPress === "function")[0];
    expect(reminder.props.disabled).toBe(true);
    TestRenderer.act(() => tree.unmount());
  });

  test("an overpayment refunded is shown on the order", () => {
    installments = [
      row({ id: "o1", status: "collected", dueAt: "2026-11-15T09:00:00Z", collectedAt: "2026-11-15T09:00:00Z" }),
      row({ id: "o2", ordinal: 2, status: "collected", dueAt: "2026-11-16T09:00:00Z", amountCents: 60000, amountChargedCents: 60000, collectedAt: "2026-11-16T09:00:00Z" }),
    ];
    balances = [host(rawBalance({
      paidMinor: 90000,
      remainingMinor: 0,
      totalMinor: 90000,
      canPayAnyAmount: false,
      minPaymentMinor: null,
      maxPartialMinor: null,
      nextPayment: null,
      overpaymentRefundedMinor: 30000,
    }))];
    const tree = render();
    press(tree, findToggleLabel(tree));
    expect(text(tree)).toContain("Paid $300.00 more than the balance · Refunded");
    TestRenderer.act(() => tree.unmount());
  });

  test("an old-plan order with no v2 balance keeps the ledger view exactly as before", () => {
    installments = [
      row({ id: "v1", kind: "scheduled", orderTotalCents: 120000, amountChargedCents: 40000, amountCents: 40000 }),
    ];
    balances = [];
    const tree = render();
    press(tree, findToggleLabel(tree));
    const out = text(tree);
    expect(out).toContain("InstallmentScheduleDisplay");
    expect(out).toContain("Installment 1, $400.00, Automatic · card ending 4242, Scheduled");
    expect(out).toContain("$1,200.00 left");
    expect(out).not.toContain("deposit, then");
    TestRenderer.act(() => tree.unmount());
  });

  test("a balance the shared decoder refuses fails closed", () => {
    expect(() => host(rawBalance({ paidMinor: 1 }))).toThrow("trip_balance_invalid");
    expect(() => host(rawBalance({ balanceEvents: [{ reason: 7 }] }))).toThrow("trip_balance_invalid");
  });
});
