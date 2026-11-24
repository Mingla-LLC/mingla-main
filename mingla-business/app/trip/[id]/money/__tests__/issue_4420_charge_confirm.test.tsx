/**
 * #4420 B1 — Charge now on a trip instalment asks once before it moves money.
 *
 * FAILS ON REVERT: pressing Charge now calls the charge mutation straight
 * away, Cancel charges anyway, or the confirm stops naming the amount and the
 * card. The at-risk path keeps its own "Charge anyway" confirm.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";

type Props = Record<string, unknown>;

const chargeMutate = jest.fn();
let installments: unknown[] = [];

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "trip-1" }),
  useRouter: () => ({ canGoBack: () => true, back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));
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
  InstallmentScheduleDisplay: () => null,
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
  // issue #4522 S-2 — no plan-v2 orders here: every row keeps the ledger view.
  useTripEventBalances: () => ({ isLoading: false, isError: false, data: [], refetch: jest.fn() }),
}));
jest.mock("../../../../../src/hooks/useManualInstallmentActions", () => ({
  useChargeInstallmentNow: () => ({ isPending: false, mutate: chargeMutate }),
  useSendInstallmentReminder: () => ({ isPending: false, mutate: jest.fn() }),
  useRecentReminderForOrder: () => ({ isLoading: false, data: null }),
}));
jest.mock("@mingla/offering-rendering/currencyGlyph", () => ({
  withCurrencyGlyph: (formatted: string) => formatted,
}));
jest.mock("../../../../../src/utils/currency", () => ({
  formatCurrency: (cents: number) => `$${(cents / 100).toFixed(2)}`,
}));

import TripMoneyRoute from "../index";

type Node = { type: unknown; props: Props };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => {
    root: { findAll: (p: (n: Node) => boolean) => Node[] };
    unmount: () => void;
  };
  act: (callback: () => void) => void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const installment = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  id: "inst-1",
  orderId: "order-1",
  ordinal: 1,
  status: "scheduled",
  dueAt: "2026-12-03T00:00:00Z",
  amountChargedCents: 173333,
  currency: "USD",
  orderTotalCents: 520000,
  orderAtRisk: false,
  buyerName: "Priya Shah",
  buyerEmail: "priya@example.com",
  collectedAt: null,
  failedAt: null,
  failureReason: null,
  collectionMethod: "auto_card",
  buyerAction: null,
  buyerActionAt: null,
  paymentCardLast4: "4242",
  ...overrides,
});

const render = () => {
  let tree!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    tree = TestRenderer.create(React.createElement(TripMoneyRoute));
  });
  return tree;
};

const pressByLabel = (tree: ReturnType<typeof render>, label: string): void => {
  const node = tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function")[0];
  expect(node).toBeDefined();
  TestRenderer.act(() => {
    (node.props.onPress as () => void)();
  });
};

const dialog = (tree: ReturnType<typeof render>, testID: string): Node =>
  tree.root.findAll((n) => n.type === "ConfirmDialog" && n.props.testID === testID)[0];

describe("#4420 B1 — Charge now confirm", () => {
  beforeEach(() => {
    chargeMutate.mockClear();
    installments = [installment({})];
  });

  test("pressing Charge now opens the confirm and charges nothing yet", () => {
    const tree = render();
    expect(dialog(tree, "trip-money-charge-dialog").props.visible).toBe(false);
    pressByLabel(tree, "Charge now for Priya Shah");
    expect(chargeMutate).not.toHaveBeenCalled();
    const confirm = dialog(tree, "trip-money-charge-dialog");
    expect(confirm.props.visible).toBe(true);
    expect(confirm.props.title).toBe("Charge $1733.33 now?");
    expect(confirm.props.description).toBe("Priya Shah's card ending 4242 is charged straight away.");
    expect(confirm.props.confirmLabel).toBe("Charge $1733.33");
    TestRenderer.act(() => tree.unmount());
  });

  test("Cancel closes the confirm and charges nothing", () => {
    const tree = render();
    pressByLabel(tree, "Charge now for Priya Shah");
    TestRenderer.act(() => {
      (dialog(tree, "trip-money-charge-dialog").props.onClose as () => void)();
    });
    expect(dialog(tree, "trip-money-charge-dialog").props.visible).toBe(false);
    expect(chargeMutate).not.toHaveBeenCalled();
    TestRenderer.act(() => tree.unmount());
  });

  test("Confirm charges the next instalment exactly once, without the at-risk override", () => {
    const tree = render();
    pressByLabel(tree, "Charge now for Priya Shah");
    TestRenderer.act(() => {
      (dialog(tree, "trip-money-charge-dialog").props.onConfirm as () => void)();
    });
    expect(chargeMutate).toHaveBeenCalledTimes(1);
    expect(chargeMutate).toHaveBeenCalledWith({ installmentId: "inst-1", atRiskOverride: false });
    expect(dialog(tree, "trip-money-charge-dialog").props.visible).toBe(false);
    TestRenderer.act(() => tree.unmount());
  });

  test("an at-risk buyer still goes through the Charge anyway confirm, not this one", () => {
    installments = [installment({ orderAtRisk: true })];
    const tree = render();
    pressByLabel(tree, "Charge now for Priya Shah");
    expect(dialog(tree, "trip-money-charge-dialog").props.visible).toBe(false);
    const atRisk = tree.root.findAll(
      (n) => n.type === "ConfirmDialog" && n.props.confirmLabel === "Charge anyway",
    )[0];
    expect(atRisk.props.visible).toBe(true);
    expect(chargeMutate).not.toHaveBeenCalled();
    TestRenderer.act(() => tree.unmount());
  });

  test("with no card on file the copy still names whose card is charged", () => {
    installments = [installment({ paymentCardLast4: null })];
    const tree = render();
    pressByLabel(tree, "Charge now for Priya Shah");
    expect(dialog(tree, "trip-money-charge-dialog").props.description).toBe(
      "Priya Shah's card is charged straight away.",
    );
    TestRenderer.act(() => tree.unmount());
  });
});
