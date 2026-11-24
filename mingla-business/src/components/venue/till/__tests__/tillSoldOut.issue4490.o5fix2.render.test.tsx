/**
 * #4490 spec 08 O5 fix 2 (carried 1): a Till DEVICE login (Today, Till,
 * Check-in; no Orders screen) can reach a guest order that sold out after
 * payment, with Swap item and Refund, and a refund asks for the PIN again.
 *
 *  1. A flagged order with a line still waiting shows the Till banner; one with
 *     every line resolved, or no flagged order, shows nothing.
 *  2. The banner opens ONE sheet; a tap on the order opens its card in place
 *     (Swap item, Refund); a swap needs no PIN.
 *  3. A refund on a Till device asks for the PIN again INSIDE that same sheet
 *     (one visible modal; the pad takes the card's place), and the answer goes
 *     back with the refund. Cancel moves nothing.
 *
 * Fails on revert: without TillSoldOutHost the banner never shows; a pad that
 * opened its own sheet gives two visible Modals.
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 tillSoldOut.issue4490.o5fix2
 */
import React from "react";
import { Modal, StyleSheet, Text } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

interface RenderTreeNode {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: RenderTreeNode) => boolean) => RenderTreeNode[];
}
interface RenderTree {
  root: RenderTreeNode;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

jest.mock("react-native-reanimated", () => {
  const RN = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  const passthrough =
    (Component: unknown) =>
    (props: Record<string, unknown>): unknown =>
      ReactLocal.createElement(Component, props);
  return {
    __esModule: true,
    default: {
      View: passthrough(RN.View),
      Text: passthrough(RN.Text),
      ScrollView: passthrough(RN.ScrollView),
      createAnimatedComponent: (Component: unknown) => Component,
    },
    Easing: { bezier: () => () => 0, linear: () => 0, out: (fn: unknown) => fn, inOut: (fn: unknown) => fn, ease: () => 0, in: (fn: unknown) => fn, cubic: () => 0 },
    cancelAnimation: () => undefined,
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: (fn: () => unknown) => {
      try {
        return typeof fn === "function" ? fn() : {};
      } catch {
        return {};
      }
    },
    useReducedMotion: () => false,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    withRepeat: (value: unknown) => value,
    withDelay: (_d: unknown, value: unknown) => value,
  };
});
jest.mock("../../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native");
  return { __esModule: true, ScrollView: RN.ScrollView, default: RN.ScrollView };
});
jest.mock("expo-linear-gradient", () => {
  const RN = jest.requireActual("react-native");
  return { LinearGradient: RN.View };
});
jest.mock("../../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn(), rpc: jest.fn(), auth: {}, channel: jest.fn(), removeChannel: jest.fn() },
}));
jest.mock("../../../../context/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true }) }));
jest.mock("../../../../hooks/useVenueTill", () => ({
  useTillCatalog: () => ({ data: { brandId: "b1" } }),
  venueTillKeys: { all: (v: string) => ["venueTill", v], catalog: (v: string) => ["venueTill", v, "catalog"] },
}));
const mockOrders: { data: unknown[] } = { data: [] };
jest.mock("../../../../hooks/useVenueOrders", () => ({ useVenueOrders: () => ({ data: mockOrders.data }) }));
const mockDetail = jest.fn();
const mockResolve = jest.fn();
jest.mock("../../../../services/venueStockService", () => {
  const actual = jest.requireActual("../../../../services/venueStockService");
  return { ...actual, fetchOrderSoldOut: (...a: unknown[]) => mockDetail(...a), resolveSoldOut: (...a: unknown[]) => mockResolve(...a) };
});
jest.mock("../../../../services/venueTillService", () => {
  const actual = jest.requireActual("../../../../services/venueTillService");
  return {
    ...actual,
    fetchTillPinStaff: jest.fn(async () => ({
      gated: true,
      people: [{ memberId: "mgr", name: "Chioma", role: "venue_staff", profile: "restaurant_manager", canSell: true, canApprove: true, canManage: true }],
    })),
  };
});

import { TillSoldOutHost } from "../TillSoldOut";
import { flaggedOrders, listedOrders, waitingOrders } from "../tillSoldOutModel";
import { parseOrderSoldOut, StockError } from "../../../../services/venueStockService";
import { clearAllTillStaffSessions, requestStepUp, setTillStaffSession } from "../../../../services/tillStaffSession";

const VENUE = "00000000-4490-4000-8000-0000000005d1";
const order = (over: Record<string, unknown> = {}) => ({
  id: "o1", venueId: VENUE, brandId: "b1", currency: "NGN", soldOutAfterPayment: true,
  spotLabel: null, pickupCode: "4F2", buyerName: "Ada", lines: [], ...over,
});
const detail = (resolution: string | null) => parseOrderSoldOut({
  orderId: "o1", currency: "NGN", canRefund: true, canSwap: true, refundUsed: false,
  lines: [{ orderItemId: "i1", menuItemId: "suya", name: "Suya", quantity: 1, lineTotalMinor: 400000, refundPreviewMinor: 440000,
    station: "kitchen", resolution, swappedToName: null, refundedMinor: null }],
  swapOptions: [{ menuItemId: "pp", name: "Puff puff", priceMinor: 150000, station: "kitchen" }],
});

const wrap = (): React.ReactElement => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  return <QueryClientProvider client={client}><TillSoldOutHost venueId={VENUE} /></QueryClientProvider>;
};
const mounted: RenderTree[] = [];
const flush = async (): Promise<void> => { await TestRenderer.act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
async function mount(): Promise<RenderTree> {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => { tree = TestRenderer.create(wrap()); });
  mounted.push(tree as unknown as RenderTree);
  await flush();
  return tree as unknown as RenderTree;
}
const has = (t: RenderTree, id: string): boolean => t.root.findAll((n) => n.props.testID === id).length > 0;
const press = async (t: RenderTree, id: string): Promise<void> => {
  const target = t.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === "function")[0];
  expect({ id, found: target !== undefined }).toEqual({ id, found: true });
  await TestRenderer.act(async () => { (target.props.onPress as () => void)(); });
  await flush();
};
const modals = (t: RenderTree): RenderTreeNode[] => t.root.findAll((n) => n.type === Modal && n.props.visible === true);
const text = (t: RenderTree): string => JSON.stringify(t.root.findAll((n) => n.type === Text).map((n) => n.props.children));

jest.setTimeout(30_000);

afterEach(async () => {
  while (mounted.length > 0) {
    const tree = mounted.pop() as RenderTree;
    await TestRenderer.act(async () => { tree.unmount(); });
  }
  clearAllTillStaffSessions();
});
beforeEach(() => {
  jest.clearAllMocks();
  clearAllTillStaffSessions();
  setTillStaffSession({ venueId: VENUE, token: "ab".repeat(32), memberId: "seller", memberUserId: "u1", name: "Ada", canApprove: false, autoLockMinutes: 2 });
  mockOrders.data = [order()];
  mockDetail.mockResolvedValue(detail(null));
  mockResolve.mockResolvedValue({ resolution: "swap", refundMinor: 0, swapName: "Puff puff", replayed: false });
});

describe("carried 1: the model", () => {
  test("only flagged orders, newest first, at most eight", () => {
    const many = Array.from({ length: 12 }, (_, i) => order({ id: `o${i}`, soldOutAfterPayment: i % 2 === 0 }));
    const flagged = flaggedOrders(many as never);
    expect(flagged.map((o) => o.id)).toEqual(["o0", "o2", "o4", "o6", "o8", "o10"]);
    expect(flaggedOrders(Array.from({ length: 20 }, (_, i) => order({ id: `x${i}` })) as never)).toHaveLength(8);
  });
  test("an order is waiting only while a line has no resolution; unknown reads are skipped", () => {
    expect(waitingOrders([order()] as never, [detail(null)])).toHaveLength(1);
    expect(waitingOrders([order()] as never, [detail("swap")])).toHaveLength(0);
    expect(waitingOrders([order()] as never, [undefined])).toHaveLength(0);
    expect(waitingOrders([order()] as never, [detail(null)])[0]).toMatchObject({ orderId: "o1", items: ["1 × Suya"] });
  });
  test("the order being read stays listed after its last line is resolved", () => {
    const w = waitingOrders([order()] as never, [detail(null)]);
    expect(listedOrders([], "o1", w[0])).toEqual([w[0]]);
    expect(listedOrders([], null, w[0])).toEqual([]);
    expect(listedOrders(w, "o1", w[0])).toEqual(w);
  });
});

describe("carried 1: on a Till device", () => {
  test("a waiting order shows the banner; resolved orders and no orders show nothing", async () => {
    const t = await mount();
    expect(has(t, "till-sold-out-banner")).toBe(true);
    expect(text(t)).toContain("1 guest order needs a swap or refund");
    mockDetail.mockResolvedValue(detail("refund"));
    const t2 = await mount();
    expect(has(t2, "till-sold-out-banner")).toBe(false);
    mockOrders.data = [];
    const t3 = await mount();
    expect(has(t3, "till-sold-out-banner")).toBe(false);
  });

  test("the banner opens one sheet; a tap on the order opens its Swap item and Refund card", async () => {
    const t = await mount();
    expect(modals(t)).toHaveLength(0);
    await press(t, "till-sold-out-open");
    expect(modals(t)).toHaveLength(1);
    expect(has(t, "till-sold-out-row-o1")).toBe(true);
    await press(t, "till-sold-out-row-o1");
    expect(has(t, "order-sold-out-swap-i1")).toBe(true);
    expect(has(t, "order-sold-out-refund-i1")).toBe(true);
    expect(text(t)).toContain("Sold out after payment");
    expect(modals(t)).toHaveLength(1);
  });

  // TEST-MOD-APPROVED #4490: 08-O5 fix 6 — Puff puff is cheaper than the line,
  // so the swap gives money back and asks "Swap and give back ₦X?" first.
  test("a swap needs no PIN and is sent as that device's session", async () => {
    const t = await mount();
    await press(t, "till-sold-out-open");
    await press(t, "till-sold-out-row-o1");
    await press(t, "order-sold-out-swap-i1");
    await press(t, "order-sold-out-swap-option-pp");
    await TestRenderer.act(async () => {
      const dlg = t.root.findAll((n) => n.props.testID === "order-sold-out-swap-confirm" && typeof n.props.onConfirm === "function")[0];
      (dlg.props.onConfirm as () => void)();
    });
    await flush();
    expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({
      venueId: VENUE, orderId: "o1", orderItemIds: ["i1"], resolution: "swap", swapMenuItemId: "pp",
    }));
  });

  test("a refund asks for the PIN again inside the same sheet, and the answer goes with the refund", async () => {
    mockResolve.mockImplementation(async (input: { venueId: string }) => {
      const answer = await requestStepUp(input.venueId, "refund");
      if (answer === null) throw new StockError("pin_step_up_cancelled");
      return { resolution: "refund", refundMinor: 440000, swapName: null, replayed: false, answer };
    });
    const t = await mount();
    await press(t, "till-sold-out-open");
    await press(t, "till-sold-out-row-o1");
    await press(t, "order-sold-out-refund-i1");
    // the refund confirm, then its Confirm button
    const confirm = t.root.findAll((n) => n.props.testID === "order-sold-out-refund-confirm");
    expect(confirm.length).toBeGreaterThan(0);
    await TestRenderer.act(async () => {
      const dlg = t.root.findAll((n) => n.props.testID === "order-sold-out-refund-confirm" && typeof n.props.onConfirm === "function")[0];
      (dlg.props.onConfirm as () => void)();
    });
    await flush();
    expect(has(t, "till-step-up")).toBe(true);
    // TEST-MOD-APPROVED #4490: 08-O5 fix 5 keeps the card mounted (hidden) under
    // the PIN pad, so its closed refund confirm finishes its close animation
    // before it leaves; once it has, the sheet is the only modal.
    await TestRenderer.act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(modals(t)).toHaveLength(1);
    // The manager's fresh PIN goes back with the refund.
    for (const d of ["4", "8", "2", "6"]) await press(t, `till-step-up-pad-key-${d}`);
    await press(t, "till-step-up-pad-ok");
    expect(mockResolve).toHaveBeenCalledTimes(1);
    const sent = (await mockResolve.mock.results[0].value) as { answer: { pin: string; memberId?: string } };
    expect(sent.answer).toEqual({ pin: "4826", memberId: "mgr" });
    expect(text(t)).not.toContain("4826");
  });

  test("Cancel on the PIN pad moves nothing and the card is back", async () => {
    mockResolve.mockImplementation(async (input: { venueId: string }) => {
      const answer = await requestStepUp(input.venueId, "refund");
      if (answer === null) throw new StockError("pin_step_up_cancelled");
      return { resolution: "refund", refundMinor: 440000, swapName: null, replayed: false };
    });
    const t = await mount();
    await press(t, "till-sold-out-open");
    await press(t, "till-sold-out-row-o1");
    await press(t, "order-sold-out-refund-i1");
    await TestRenderer.act(async () => {
      const dlg = t.root.findAll((n) => n.props.testID === "order-sold-out-refund-confirm" && typeof n.props.onConfirm === "function")[0];
      (dlg.props.onConfirm as () => void)();
    });
    await flush();
    await press(t, "till-step-up-cancel");
    expect(has(t, "till-step-up")).toBe(false);
    expect(has(t, "order-sold-out-refund-i1")).toBe(true);
    expect(text(t)).not.toContain("Refunded");
  });
});

// #4490 08-O5 fix 5 (items 6 and 11). Fails on revert: with swapPickable back
// to "same price is always pickable" (no canSwapEven) a finance manager can
// pick the same-price swap the server refuses; with the action buttons back on
// flexBasis 140 the refund label is cut ("Refund ₦8,000.…").
describe("08-O5 fix 5: a finance manager's swap list, and a whole refund label", () => {
  const financeView = () => parseOrderSoldOut({
    orderId: "o1", currency: "NGN", canRefund: true, canSwap: true, canSwapEven: false, refundUsed: false,
    lines: [{ orderItemId: "i1", menuItemId: "suya", name: "Suya", quantity: 1, lineTotalMinor: 400000, refundPreviewMinor: 440000,
      station: "kitchen", resolution: null, swappedToName: null, refundedMinor: null }],
    swapOptions: [
      { menuItemId: "pp", name: "Puff puff", priceMinor: 150000, station: "kitchen" },
      { menuItemId: "jr", name: "Jollof rice", priceMinor: 400000, station: "kitchen" },
    ],
  });

  test("the cheaper swap can be picked; the same-price swap cannot, and says who can", async () => {
    mockDetail.mockResolvedValue(financeView());
    const t = await mount();
    await press(t, "till-sold-out-open");
    await press(t, "till-sold-out-row-o1");
    await press(t, "order-sold-out-swap-i1");
    const option = (id: string) => t.root.findAll((n) => n.props.testID === `order-sold-out-swap-option-${id}` && typeof n.props.onPress === "function")[0];
    expect(option("pp").props.disabled).toBe(false);
    expect(option("jr").props.disabled).toBe(true);
    expect(text(t)).toContain("same price, ask someone who sells or runs the kitchen");
  });

  test("an older server (no canSwapEven) keeps same-price swaps for whoever may swap", () => {
    const old = parseOrderSoldOut({ orderId: "o1", currency: "NGN", canRefund: false, canSwap: true, lines: [], swapOptions: [] });
    expect(old.canSwapEven).toBe(true);
  });

  test("Swap item and Refund are wide enough that the refund amount is never cut on a phone", async () => {
    const t = await mount();
    await press(t, "till-sold-out-open");
    await press(t, "till-sold-out-row-o1");
    const refund = t.root.findAll((n) => n.props.testID === "order-sold-out-refund-i1" && n.props.style !== undefined)[0];
    const style = StyleSheet.flatten(refund.props.style as never) as Record<string, unknown>;
    expect(Number(style.flexBasis)).toBeGreaterThanOrEqual(200);
  });
});

// #4490 08-O5 fix 6 (item 5). Fails on revert: with the swap option calling
// run() straight away, the cheaper swap is sent on one tap with no confirm.
describe("08-O5 fix 6: a swap that gives money back asks first, like a refund", () => {
  const twoOptions = () => parseOrderSoldOut({
    orderId: "o1", currency: "NGN", canRefund: true, canSwap: true, canSwapEven: true, refundUsed: false,
    lines: [{ orderItemId: "i1", menuItemId: "suya", name: "Suya", quantity: 1, lineTotalMinor: 400000, refundPreviewMinor: 440000,
      station: "kitchen", resolution: null, swappedToName: null, refundedMinor: null }],
    swapOptions: [
      { menuItemId: "pp", name: "Puff puff", priceMinor: 100000, station: "kitchen" },
      { menuItemId: "jr", name: "Jollof rice", priceMinor: 400000, station: "kitchen" },
    ],
  });
  const dialog = (t: RenderTree): RenderTreeNode | undefined =>
    t.root.findAll((n) => n.props.testID === "order-sold-out-swap-confirm" && typeof n.props.onConfirm === "function")[0];

  test("the cheaper swap opens 'Swap and give back ₦3,000.00?' and sends nothing until confirmed", async () => {
    mockDetail.mockResolvedValue(twoOptions());
    const t = await mount();
    await press(t, "till-sold-out-open");
    await press(t, "till-sold-out-row-o1");
    await press(t, "order-sold-out-swap-i1");
    await press(t, "order-sold-out-swap-option-pp");
    expect(mockResolve).not.toHaveBeenCalled();
    const dlg = dialog(t);
    expect(dlg?.props.visible).toBe(true);
    expect(dlg?.props.title).toBe("Swap and give back ₦3,000.00?");
    expect(dlg?.props.confirmLabel).toBe("Swap and give back ₦3,000.00");
    expect(String(dlg?.props.description)).toContain("Puff puff");
    // Keep it: nothing sent, the confirm closes.
    await TestRenderer.act(async () => { (dlg?.props.onClose as () => void)(); });
    await flush();
    expect(mockResolve).not.toHaveBeenCalled();
    expect(dialog(t)?.props.visible).toBe(false);
    // Again, and confirm: the swap goes.
    await press(t, "order-sold-out-swap-option-pp");
    await TestRenderer.act(async () => { (dialog(t)?.props.onConfirm as () => void)(); });
    await flush();
    expect(mockResolve).toHaveBeenCalledTimes(1);
    expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({ resolution: "swap", swapMenuItemId: "pp" }));
  });

  test("a same-price swap moves no money and stays one tap", async () => {
    mockDetail.mockResolvedValue(twoOptions());
    const t = await mount();
    await press(t, "till-sold-out-open");
    await press(t, "till-sold-out-row-o1");
    await press(t, "order-sold-out-swap-i1");
    await press(t, "order-sold-out-swap-option-jr");
    expect(dialog(t)?.props.visible).toBe(false);
    expect(mockResolve).toHaveBeenCalledWith(expect.objectContaining({ resolution: "swap", swapMenuItemId: "jr" }));
  });

  test("a confirmed cheaper swap on a Till device still takes the PIN step-up, inside the same sheet", async () => {
    mockDetail.mockResolvedValue(twoOptions());
    mockResolve.mockImplementation(async (input: { venueId: string }) => {
      const answer = await requestStepUp(input.venueId, "refund");
      if (answer === null) throw new StockError("pin_step_up_cancelled");
      return { resolution: "swap", refundMinor: 300000, swapName: "Puff puff", replayed: false };
    });
    const t = await mount();
    await press(t, "till-sold-out-open");
    await press(t, "till-sold-out-row-o1");
    await press(t, "order-sold-out-swap-i1");
    await press(t, "order-sold-out-swap-option-pp");
    await TestRenderer.act(async () => { (dialog(t)?.props.onConfirm as () => void)(); });
    await flush();
    expect(has(t, "till-step-up")).toBe(true);
    // Fix 6 item 7: a swipe or back on the sold-out sheet cancels the pad like Cancel.
    const sheet = t.root.findAll((n) => n.props.testID === "till-sold-out-sheet" && typeof n.props.dismissGuard === "function")[0];
    expect((sheet.props.dismissGuard as () => boolean)()).toBe(true);
    await TestRenderer.act(async () => { (sheet.props.onRequestClose as () => void)(); });
    await flush();
    expect(has(t, "till-step-up")).toBe(false);
    expect(has(t, "order-sold-out-swap-i1")).toBe(true);
  });
});
