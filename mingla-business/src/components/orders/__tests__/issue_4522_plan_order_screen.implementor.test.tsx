/* eslint-disable import/first */
// issue #4522 G-7 — the Host order screen for a trip order bought on a payment
// plan. The real route is mounted with orders shaped like REAL plan orders: the
// order's own total is only the DEPOSIT ($300 of a $1,200 room), a card cancel
// leaves payment_status at 'partial_refund' (so the generic status reads
// "refunded_partial") and orders.refunded_amount_cents holds only the deposit's
// refund. Every plan figure comes from the balance reader's JSON, through the
// real decoder.
//
// WHAT THIS FILE PROVES
//   PO-1 a cancelled, fully refunded plan order never says "Partially
//        refunded", shows the server's paid figure, and offers no refund button.
//   PO-2 a partly paid plan order shows "Paid $300 of $1,200 · $900 left" (not
//        "Paid $1,200.00 each"), no refund button, and a pointer that opens the
//        trip's money screen.
//   PO-3 the same for an older plan (planVersion 1).
//   PO-4 an order the reader does not list (an event order, or no reader on the
//        server yet) looks exactly as before: Refund order + Partial refund.
//
// FAILS-ON-REVERT: restore app/event/[id]/orders/[oid]/index.tsx from the
// commit before this one and PO-1..PO-3 go red.

import React from "react";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  children: unknown[];
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface Renderer {
  root: TestInstance;
  unmount: () => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const probe =
  (name: string) =>
  (props: Record<string, unknown>): React.ReactElement =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement(name, props, props.children as React.ReactNode);

const EVENT_ID = "event-4522";
const ORDER_ID = "order-4522";

let mockOrder: Record<string, unknown> | null = null;
let mockBalances: unknown[] | undefined = [];
let mockEventType = "trip";
const mockPush = jest.fn();

jest.mock("../../../services/supabase", () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "event-4522", oid: "order-4522" }),
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));
jest.mock("../../../context/AuthContext", () => ({
  useAuth: () => ({ isAuthReady: true }),
}));
jest.mock("@tanstack/react-query", () => ({
  QueryClient: class {},
  useQuery: () => ({ data: undefined, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  useMutation: (options: unknown) => options,
}));
jest.mock("../../../hooks/useEventOrders", () => ({
  useEventOrderById: () => ({ data: mockOrder, status: "success", isLoading: false, isError: false }),
}));
jest.mock("../../../hooks/useOrderInstallments", () => ({
  // A disabled query (no event id asked for) is "pending" with no data, as in react-query.
  useTripEventBalances: (id: string | null) => ({
    data: id === null ? undefined : mockBalances,
    isPending: id === null || mockBalances === undefined,
  }),
}));
jest.mock("../../../hooks/useBrandPayoutScreen", () => ({
  useBrandPayoutScreen: () => ({ data: undefined }),
}));
jest.mock("../../../hooks/useManagedEventRoute", () => ({
  useManagedEventRoute: () => ({
    event: { id: "event-4522", event_type: mockEventType, refundPolicy: null, masterStartAtUtc: null },
    replacementEventId: null,
  }),
}));
jest.mock("../../../hooks/usePublicEvents", () => ({
  usePublicEventById: () => ({ data: undefined }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100, role: "account_owner", accepted: true }),
}));
jest.mock("../../../utils/brandPaymentsPermission", () => ({
  canViewBrandPayments: () => false,
}));
jest.mock("../../../hooks/useEventDoorSales", () => ({
  useEventDoorSales: () => ({ data: undefined, isPending: false }),
}));
jest.mock("../../../utils/deferAfterDismiss", () => ({
  deferAfterDismiss: (fn: () => void) => fn(),
}));
jest.mock("../../forms/formsOwner", () => ({ GuestAnswersCard: (): null => null }));
jest.mock("../../ui/Button", () => ({ Button: probe("ButtonProbe") }));
jest.mock("../../ui/EmptyState", () => ({ EmptyState: probe("EmptyStateProbe") }));
jest.mock("../../ui/GlassCard", () => ({ GlassCard: probe("GlassCardProbe") }));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/IconChrome", () => ({ IconChrome: probe("IconChromeProbe") }));
jest.mock("../../ui/Toast", () => ({ Toast: (): null => null }));
jest.mock("../RefundSheet", () => ({ RefundSheet: probe("ProviderRefundSheetProbe") }));
jest.mock("../CancelOrderDialog", () => ({ CancelOrderDialog: (): null => null }));
jest.mock("../../door/LazyDoorRefundSheet", () => ({ LazyDoorRefundSheet: (): null => null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OrderDetailRoute = require("../../../../app/event/[id]/orders/[oid]/index")
  .default as React.FC;
import { decodeTripBalance } from "@mingla/offering-rendering/tripBalance";
import { decodeHostTripBalance } from "../../../services/orderInstallmentsService";

const rawBalance = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  orderId: ORDER_ID,
  eventId: EVENT_ID,
  currency: "USD",
  depositMinor: 30000,
  paidMinor: 30000,
  remainingMinor: 90000,
  totalMinor: 120000,
  terms: { v: 2, deposit_minor: 30000, count_given: 3 },
  canPayAnyAmount: false,
  minPaymentMinor: null,
  maxPartialMinor: null,
  providerMinimumMinor: 0,
  paymentInFlight: false,
  heldCreditMinor: 0,
  overpaymentRefundedMinor: 0,
  overpayments: [],
  nextPayment: null,
  openRows: [],
  history: [],
  balanceEvents: [],
  planVersion: 2,
  ...overrides,
});
const balance = (overrides: Record<string, unknown>): unknown =>
  decodeHostTripBalance(rawBalance(overrides), decodeTripBalance);

// A REAL plan order: the order total is the deposit, not the $1,200 room.
const planOrder = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: ORDER_ID,
  eventId: EVENT_ID,
  brandId: "brand-4522",
  buyer: { name: "Ada Lovelace", email: "ada@example.test", phone: "", marketingOptIn: false },
  lines: [
    {
      orderLineItemId: "line-1",
      ticketTypeId: "ticket-room",
      ticketNameAtPurchase: "New plan room",
      unitPriceGbpAtPurchase: 1200,
      isFreeAtPurchase: false,
      quantity: 1,
      refundedQuantity: 0,
      refundedAmountGbp: 0,
    },
  ],
  totalGbpAtPurchase: 300,
  totalCents: 30000,
  buyerTotalCents: 30000,
  refundedAmountCents: 0,
  currency: "USD",
  paymentMethod: "card",
  paidAt: "2026-11-20T20:00:00.000Z",
  status: "paid",
  refundedAmountGbp: 0,
  refunds: [],
  cancelledAt: null,
  lastSeenEventUpdatedAt: "2026-11-20T20:00:00.000Z",
  source: "online_checkout",
  ...overrides,
});

const mount = async (): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<OrderDetailRoute />);
  });
  return tree;
};

const textOf = (node: unknown): string => {
  if (typeof node === "string") return node;
  if (typeof node === "object" && node !== null && "children" in node) {
    return ((node as { children: unknown[] }).children ?? []).map(textOf).join("");
  }
  return "";
};
const screenText = (tree: Renderer): string =>
  tree.root
    .findAll((n) => n.type === "Text")
    .map((n) => textOf(n))
    .join(" | ");
const labels = (tree: Renderer): string[] =>
  tree.root
    .findAll((n) => n.type === "ButtonProbe" || n.props.accessibilityRole === "button")
    .map((n) => String(n.props.accessibilityLabel ?? n.props.label ?? ""));

beforeEach(() => {
  mockPush.mockReset();
  mockEventType = "trip";
  mockBalances = [];
});

describe("#4522 G-7 the Host order screen for a plan order", () => {
  test("PO-1 a cancelled, fully refunded plan order says so and offers no refund", async () => {
    mockOrder = planOrder({
      status: "refunded_partial", // payment_status 'partial_refund' after a card cancel
      refundedAmountGbp: 300,
      refundedAmountCents: 30000, // the deposit's refund only
      cancelledAt: "2026-11-22T10:00:00.000Z",
      refunds: [
        { id: "r1", orderId: ORDER_ID, amountGbp: 300, amount: 300, currency: "USD", reason: "", refundedAt: "2026-11-22T10:00:00Z", lines: [] },
        { id: "r2", orderId: ORDER_ID, amountGbp: 900, amount: 900, currency: "USD", reason: "", refundedAt: "2026-11-22T10:00:01Z", lines: [] },
      ],
    });
    mockBalances = [balance({ paidMinor: 120000, remainingMinor: 0, totalMinor: 120000 })];
    const tree = await mount();
    const out = screenText(tree);
    expect(out).not.toContain("Partially refunded");
    expect(out).toContain("Cancelled · refunds are listed below");
    expect(out).toContain("$1,200.00");
    expect(labels(tree)).not.toContain("Refund again");
    expect(labels(tree)).not.toContain("Refund order");
    expect(labels(tree)).not.toContain("Partial refund");
    expect(labels(tree)).not.toContain("Resend ticket to buyer");
    expect(out).not.toContain("Total | $300.00");
    await act(async () => tree.unmount());
  });

  test.each([2, 1])("PO-2/3 a partly paid plan v%s order shows the server's paid / left and points to the money screen", async (planVersion) => {
    mockOrder = planOrder();
    mockBalances = [
      balance({
        planVersion,
        nextPayment: { installmentId: "i1", dueAt: "2026-12-19T09:00:00Z", amountMinor: 90000, status: "scheduled" },
        openRows: [{ installmentId: "i1", dueAt: "2026-12-19T09:00:00Z", amountMinor: 90000, addonPortionMinor: 0, planLineId: "t1", status: "scheduled" }],
      }),
    ];
    const tree = await mount();
    const out = screenText(tree);
    expect(out).toContain("Paid $300.00 of $1,200.00 · $900.00 left");
    expect(out).not.toContain("each");
    expect(labels(tree)).not.toContain("Refund order");
    expect(labels(tree)).not.toContain("Partial refund");
    expect(labels(tree)).not.toContain("Refund again");
    expect(out).toContain("Refunds for a booking on a payment plan are made from the trip's money screen");
    const open = tree.root.findAll(
      (n) => n.type === "ButtonProbe" && n.props.label === "Open trip money",
    )[0];
    expect(open).toBeDefined();
    await act(async () => {
      (open.props.onPress as () => void)();
    });
    expect(mockPush).toHaveBeenCalledWith(`/trip/${EVENT_ID}/money`);
    await act(async () => tree.unmount());
  });

  test("PO-4 an order the balance reader does not list looks exactly as before", async () => {
    mockOrder = planOrder({ lines: [{ ...(planOrder().lines as Array<Record<string, unknown>>)[0], unitPriceGbpAtPurchase: 300 }] });
    mockBalances = []; // deploy window: no reader (or not a plan order)
    const tree = await mount();
    const out = screenText(tree);
    expect(labels(tree)).toContain("Refund order");
    expect(labels(tree)).toContain("Partial refund");
    expect(out).toContain("Total");
    expect(out).not.toContain("Open trip money");
    expect(out).not.toContain("payment plan");
    await act(async () => tree.unmount());
  });

  test("PO-4b an event order never asks the trip balance reader", async () => {
    mockEventType = "event";
    mockOrder = planOrder();
    mockBalances = undefined; // would read "pending" if the screen waited on it
    const tree = await mount();
    expect(labels(tree)).toContain("Refund order");
    await act(async () => tree.unmount());
  });
});
