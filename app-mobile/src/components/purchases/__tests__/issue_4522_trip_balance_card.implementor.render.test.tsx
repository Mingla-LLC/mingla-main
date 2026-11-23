/**
 * issue #4522 (rework N6, N5) — the Explorer trip balance card, mounted.
 *
 *   V2        a v2 plan shows the balance and "Pay toward balance".
 *   V1        an older instalment plan (planVersion 1) draws nothing: the
 *             purchase screen stays as on main, no flexible actions and no
 *             "You can pay your next payment…" line.
 *   UNAVAIL   no balance endpoint / v2 schema yet (payment_plan_v2_unavailable,
 *             balance_not_found, a 404): nothing, no error card.
 *   ERROR     any other failure: the labelled retry.
 *   HELD      money paid beyond the trip price: one plain line, never a vendor.
 *   SMALL     rework 9 (T8-6): a balance below the provider's minimum shows the
 *             amount owed and the balance screen's small-balance line, never
 *             "Next $0.49 on <date>" nor "Pay toward balance".
 *
 * FAILS-ON-REVERT: drop the supportsBalancePayments check (V1 red) or the
 * isBalanceUnavailable check (UNAVAIL red), or the below-minimum check
 * (SMALL red) in TripBalanceCard.
 */
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestNode = {
  type: unknown;
  props: Record<string, unknown>;
  children: Array<TestNode | string>;
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
};
type Renderer = { root: TestNode; toJSON: () => unknown; unmount: () => void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Renderer;
  act: (fn: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;
const textOf = (node: TestNode | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

const mockQuery: { data: unknown; isError: boolean; isLoading: boolean; error: unknown; refetch: jest.Mock } = {
  data: undefined,
  isError: false,
  isLoading: false,
  error: null,
  refetch: jest.fn(),
};
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: mockQuery.data,
    isError: mockQuery.isError,
    isLoading: mockQuery.isLoading,
    error: mockQuery.error,
    refetch: mockQuery.refetch,
  }),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, rpc: jest.fn() },
  supabaseUrl: "https://example.supabase.co",
  getSupabaseFunctionHeaders: () => ({}),
}));

import { TripBalanceCard } from "../TripBalanceCard";
import { TripBalancePayError } from "../../../services/tripBalancePayService";

const balance = (over: Record<string, unknown> = {}) => ({
  orderId: "order-1",
  currency: "USD",
  depositMinor: 30000,
  paidMinor: 60000,
  remainingMinor: 60000,
  totalMinor: 120000,
  canPayAnyAmount: true,
  minPaymentMinor: 5000,
  paymentInFlight: false,
  nextPayment: { installmentId: "r2", dueAt: "2027-01-13T09:00:00Z", amountMinor: 30000 },
  openRows: [
    { installmentId: "r2", dueAt: "2027-01-13T09:00:00Z", amountMinor: 30000 },
    { installmentId: "r3", dueAt: "2027-02-10T09:00:00Z", amountMinor: 30000 },
  ],
  history: [],
  planVersion: 2,
  heldCreditMinor: 0,
  overpaymentRefundedMinor: 0,
  ...over,
});

const render = async (): Promise<Renderer> => {
  let tree!: Renderer;
  await act(async () => {
    tree = TestRenderer.create(<TripBalanceCard orderId="order-1" />);
  });
  return tree;
};
const texts = (tree: Renderer): string =>
  tree.root.findAll((n) => n.type === "Text" || n.type === "span" || n.type === "div").map(textOf).join(" | ");

beforeEach(() => {
  mockQuery.data = undefined;
  mockQuery.isError = false;
  mockQuery.isLoading = false;
  mockQuery.error = null;
});

test("V2 a v2 plan shows the balance and the pay action", async () => {
  mockQuery.data = { state: "payable", balance: balance() };
  const tree = await render();
  expect(texts(tree)).toContain("left");
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Pay toward balance").length).toBeGreaterThan(0);
  tree.unmount();
});

test("V1 an older instalment plan draws nothing (as on main)", async () => {
  mockQuery.data = {
    state: "payable",
    balance: balance({ planVersion: 1, canPayAnyAmount: false, minPaymentMinor: null }),
  };
  const tree = await render();
  expect(tree.toJSON()).toBeNull();
  tree.unmount();
});

test("UNAVAIL no balance endpoint or v2 schema yet: nothing, no error card", async () => {
  for (const error of [
    new TripBalancePayError("payment_plan_v2_unavailable", 409),
    new TripBalancePayError("balance_not_found", 404),
    new TripBalancePayError("request_failed", 404),
  ]) {
    mockQuery.isError = true;
    mockQuery.error = error;
    const tree = await render();
    expect(tree.toJSON()).toBeNull();
    tree.unmount();
  }
});

test("ERROR any other failure keeps the labelled retry", async () => {
  mockQuery.isError = true;
  mockQuery.error = new TripBalancePayError("request_failed", 500);
  const tree = await render();
  expect(texts(tree)).toContain("Couldn’t load your balance");
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Retry loading your balance").length).toBeGreaterThan(0);
  tree.unmount();
});

test("HELD money paid beyond the price is one plain line, naming no payment vendor", async () => {
  mockQuery.data = { state: "payable", balance: balance({ heldCreditMinor: 10000 }) };
  const tree = await render();
  const all = texts(tree);
  expect(all).toContain("more than was due. We’re refunding it to your original payment");
  expect(all).not.toMatch(/stripe|paystack/i);
  tree.unmount();
  mockQuery.data = { state: "paid", balance: balance({ remainingMinor: 0, openRows: [], nextPayment: null,
    paidMinor: 120000, heldCreditMinor: 10000 }) };
  const paid = await render();
  expect(texts(paid)).toContain("Paid in full");
  expect(texts(paid)).toContain("more than was due");
  paid.unmount();
  mockQuery.data = { state: "payable", balance: balance() };
  const none = await render();
  expect(texts(none)).not.toContain("more than was due");
  none.unmount();
});

// #4522 first screen test S-5 / S-16 — a refunded overpayment is shown (not
// only one being refunded), and whole amounts carry no ".00".
// FAILS-ON-REVERT: OverpaymentLine ignores overpaymentRefundedMinor; "£…​.00".
test("REFUNDED an overpayment already refunded is shown; whole amounts have no decimals", async () => {
  mockQuery.data = { state: "paid", balance: balance({ remainingMinor: 0, openRows: [], nextPayment: null,
    paidMinor: 120000, overpaymentRefundedMinor: 30000 }) };
  const paid = await render();
  expect(texts(paid)).toContain("Paid in full");
  expect(texts(paid)).toContain("more than was due. It was refunded to your original payment method.");
  expect(texts(paid)).not.toMatch(/\.00 more than was due/);
  paid.unmount();
});

test("SMALL a balance below the provider minimum stays owed: the small-balance line, no next payment, no pay action", async () => {
  mockQuery.data = { state: "payable", balance: balance({ remainingMinor: 49, providerMinimumMinor: 50,
    nextPayment: { installmentId: "r2", dueAt: "2027-01-13T09:00:00Z", amountMinor: 49 },
    openRows: [{ installmentId: "r2", dueAt: "2027-01-13T09:00:00Z", amountMinor: 49 }] }) };
  const tree = await render();
  const all = texts(tree);
  expect(all).toContain("left");
  expect(all).toContain("A small balance of");
  expect(all).toContain("We'll be in touch about it.");
  expect(all).not.toMatch(/Next/);
  expect(all).not.toMatch(/Paid in full|written off/i);
  expect(tree.root.findAll((n) => n.props.accessibilityLabel === "Pay toward balance").length).toBe(0);
  tree.unmount();
  // At the minimum it is payable as before.
  mockQuery.data = { state: "payable", balance: balance({ remainingMinor: 50, providerMinimumMinor: 50,
    nextPayment: { installmentId: "r2", dueAt: "2027-01-13T09:00:00Z", amountMinor: 50 } }) };
  const payable = await render();
  expect(texts(payable)).toContain("Next");
  expect(texts(payable)).not.toContain("A small balance of");
  expect(payable.root.findAll((n) => n.props.accessibilityLabel === "Pay toward balance").length).toBeGreaterThan(0);
  payable.unmount();
});
