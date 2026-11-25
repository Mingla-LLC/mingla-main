/**
 * #4490 spec 08 O5 part B — render proof for Close the day.
 *
 *  1. Open checks block the close: the banner, each row's Pay / Void / Move to
 *     tomorrow, Count the cash disabled; Move to tomorrow sends that check.
 *  2. With nothing blocking, Count the cash opens ONE sheet (one visible
 *     Modal) whose primary button is Close the day; "Add a paid out" turns the
 *     same sheet into the drawer (still one Modal: the iOS rule).
 *  3. A closed day shows Day closed with the difference in words, the late
 *     list, Export, Print, Reopen; Reopen opens one sheet, and on a Till
 *     device the PIN for the reopen shows INSIDE that sheet (step-up host),
 *     never a second Modal.
 *  4. Every amount is the server's: the takings tile shows the snapshot, not
 *     snapshot + late.
 *
 * Fails on revert: a reopen sheet that renders its own Sheet gives two
 * visible Modals; dropping `disabled={!summary.canClose}` makes Count
 * pressable while checks block.
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 dayClose.issue4490.o5b
 */

import React from "react";
import { Modal, StyleSheet, Text } from "react-native";

interface RenderTreeNode {
  type: unknown;
  props: Record<string, unknown>;
  parent: RenderTreeNode | null;
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
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  router: { push: jest.fn() },
}));
jest.mock("../../../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn(), rpc: jest.fn(), auth: {} },
}));
jest.mock("../../../../utils/dayCloseCsv", () => ({ exportDayCloseCsv: jest.fn(async () => ({ method: "downloaded" })) }));
jest.mock("../../../../utils/floorPdf", () => ({ openFloorPdf: jest.fn(async () => ({ signedUrl: "x", expiresAt: "", filename: "x" })) }));

const mockState: { summary: unknown; drawer: unknown } = { summary: null, drawer: null };
const mockCarry = jest.fn(async () => undefined);
const mutation = (fn: (...a: unknown[]) => Promise<unknown>) => ({ mutateAsync: fn, isPending: false });
jest.mock("../../../../hooks/useVenueDayClose", () => ({
  useDaySummary: () => ({ data: mockState.summary, isLoading: false, isError: false, error: null, refetch: jest.fn() }),
  useCashDrawer: () => ({ data: mockState.drawer, isLoading: false, isError: false, error: null, refetch: jest.fn() }),
  useDayCloseActions: () => ({
    close: mutation(jest.fn(async () => ({}))),
    reopen: mutation(jest.fn(async () => ({}))),
    carryOver: mutation(mockCarry),
    cashMovement: mutation(jest.fn(async () => ({}))),
  }),
}));

import { DayCloseScreen } from "../DayCloseScreen";
import { clearAllTillStaffSessions, requestStepUp, setTillStaffSession } from "../../../../services/tillStaffSession";
import { mapDaySummary } from "../../../../services/venueDayCloseService";

const VENUE = "00000000-4490-4000-8000-0000000005a1";
const APPROVERS = [
  { memberId: "mgr", name: "Chioma", role: "venue_staff", profile: "restaurant_manager", canSell: true, canApprove: true, canManage: true },
];

const totals = {
  currency: "NGN",
  takings: { count: 18, amountMinor: 12900000, tipMinor: 215000, serviceChargeMinor: 954545, guestFeesMinor: 8250 },
  byMethod: [{ method: "cash", count: 10, amountMinor: 7450000, tipMinor: 110000 }],
  people: [{ kind: "person", name: "Ada", userId: "u1", salesCount: 15, salesMinor: 11250000, tipsTakenMinor: 155000,
    cashTakenMinor: 7000000, tipsServedMinor: 155000, refundCount: 0, refundMinor: 0, voidCount: 1, voidMinor: 500000 }],
  tipsByServer: [{ kind: "person", name: "Ada", userId: "u1", tipsServedMinor: 155000 }],
  tipsOtherMinor: 10000,
  refunds: { count: 3, amountMinor: 1700000, tipMinor: 0, byMethod: [] },
  voids: { count: 1, amountMinor: 500000 },
  serviceChargeMinor: 954545,
  net: { takingsMinor: 11200000, tipMinor: 215000 },
  depositsUsed: { count: 2, amountMinor: 1050000 },
  depositRefunded: { count: 1, amountMinor: 1450000 },
  orderedOnline: { count: 1, amountMinor: 330000 },
  door: { count: 1, amountMinor: 600000, byMethod: [] },
  categories: { bookingsMinor: 2400000, onOpenChecksMinor: 0, foodAndDrinkMinor: 10500000 },
  card: { chargedMinor: 3963250, minglaFeesMinor: 173250, refundedMinor: 550000, toBankMinor: 3240000 },
  cash: { floatMinor: 5500000, cashPaymentsMinor: 7450000, cashTipsMinor: 110000, doorCashMinor: 600000,
    cashRefundsMinor: 1150000, paidOutMinor: 300000, paidOuts: [{ id: "p1", amountMinor: 300000, note: "Ice", atLocal: "19:40" }],
    expectedMinor: 12210000 },
  paidInToday: { paidInMinor: 950000, paidIn: { atVenue: 3000000, online: 0 } },
  reconcile: { byMethodMatches: true, byPersonMatches: true, atVenueMatches: true, onlineMatches: true },
};
const open = (blocking: boolean) => mapDaySummary({
  venueId: VENUE, venueName: "Close Club", businessDate: "2026-11-21", today: "2026-11-22", timezone: "Africa/Lagos",
  currency: "NGN", state: "open", close: null, totals,
  late: { count: 0, amountMinor: 0, tipMinor: 0, payments: [], refundCount: 0, refundMinor: 0 },
  openChecks: [
    ...(blocking ? [{ saleId: "s19", checkLabel: "Table 9", server: { kind: "person", name: "Kemi" }, ageMinutes: 112,
      dueMinor: 1800000, state: "open", version: 2, waitingForScan: false, carriedPast: null, blocks: true }] : []),
    { saleId: "s20", checkLabel: "S20", server: { kind: "person", name: "Ada" }, ageMinutes: 10, dueMinor: 550000,
      state: "paying", version: 3, waitingForScan: true, carriedPast: null, blocks: false },
  ],
  blockingCount: blocking ? 1 : 0, canClose: !blocking, history: [],
});
const closed = mapDaySummary({
  venueId: VENUE, venueName: "Close Club", businessDate: "2026-11-21", today: "2026-11-22", timezone: "Africa/Lagos",
  currency: "NGN", state: "closed",
  close: { closedAtLocal: "23:48", closedBy: { kind: "person", name: "Chioma" }, cashCountedMinor: 12160000,
    cashExpectedMinor: 12210000, differenceMinor: -50000, reopenCount: 0, canReopen: true },
  totals,
  late: { count: 1, amountMinor: 550000, tipMinor: 0, refundCount: 0, refundMinor: 0,
    payments: [{ paymentId: "late1", method: "scan_transfer", amountMinor: 550000, tipMinor: 0, paidAtLocal: "23:55", checkLabel: "S20" }] },
  openChecks: [], blockingCount: 0, canClose: false, history: [],
});

const find = (tree: RenderTree, testID: string): RenderTreeNode | undefined =>
  tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
const press = async (tree: RenderTree, testID: string): Promise<void> => {
  const target = find(tree, testID);
  expect({ testID, found: target !== undefined }).toEqual({ testID, found: true });
  await TestRenderer.act(async () => {
    (target!.props.onPress as () => void)();
  });
};
const has = (tree: RenderTree, testID: string): boolean => tree.root.findAll((n) => n.props.testID === testID).length > 0;
const visibleModals = (tree: RenderTree): RenderTreeNode[] => tree.root.findAll((n) => n.type === Modal && n.props.visible === true);
const texts = (tree: RenderTree): string => JSON.stringify(tree.root.findAll((n) => n.type === Text).map((n) => n.props.children));

async function render(approvers: typeof APPROVERS | null = null): Promise<RenderTree> {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(<DayCloseScreen venueId={VENUE} approvers={approvers} />);
  });
  return tree as unknown as RenderTree;
}

// The first native Sheet mount is slow on a busy machine (cold transform).
jest.setTimeout(30_000);

describe("O5B-R Close the day", () => {
  beforeEach(() => {
    clearAllTillStaffSessions();
    mockCarry.mockClear();
  });

  test("open checks block: banner, Pay / Void / Move to tomorrow, Count disabled; Move sends the check", async () => {
    mockState.summary = open(true);
    const t = await render();
    expect(has(t, "day-close-blocked")).toBe(true);
    expect(texts(t)).toContain("1 check is still open");
    expect(has(t, "day-close-check-pay-s19")).toBe(true);
    expect(has(t, "day-close-check-void-s19")).toBe(true);
    expect(has(t, "day-close-waiting")).toBe(true);
    expect(find(t, "day-close-count-open")!.props.disabled).toBe(true);
    await press(t, "day-close-check-move-s19");
    expect(mockCarry).toHaveBeenCalledWith({ saleId: "s19", date: "2026-11-21" });
    await press(t, "day-close-check-pay-s19");
    expect(mockPush).toHaveBeenCalledWith(`/venue/${VENUE}/till?checks=1`);
    t.unmount();
  });

  test("Count the cash opens one sheet; Add a paid out turns the same sheet into the drawer", async () => {
    mockState.summary = open(false);
    mockState.drawer = { businessDate: "2026-11-21", currency: "NGN", floatMinor: 5500000, previousFloatMinor: 5000000,
      dayClosed: false, movements: [] };
    const t = await render();
    expect(find(t, "day-close-count-open")!.props.disabled).toBe(false);
    await press(t, "day-close-count-open");
    expect(visibleModals(t)).toHaveLength(1);
    expect(visibleModals(t)[0].findAll((n) => n.props.testID === "day-close-confirm").length).toBeGreaterThan(0);
    expect(texts(t)).toContain("Expected in the drawer");
    await press(t, "day-close-count-paid-out");
    expect(visibleModals(t)).toHaveLength(1);
    expect(has(t, "day-close-drawer-save")).toBe(true);
    t.unmount();
  });

  test("a closed day: Day closed, the difference in words, the late list, Export / Print / Reopen; the snapshot's takings", async () => {
    mockState.summary = closed;
    const t = await render();
    expect(has(t, "day-close-done")).toBe(true);
    const all = texts(t);
    expect(all).toContain("Day closed");
    expect(all).toContain("short");
    expect(all).toContain("Late payments since close");
    expect(has(t, "day-close-export")).toBe(true);
    expect(has(t, "day-close-print")).toBe(true);
    expect(has(t, "day-close-reopen")).toBe(true);
    const takings = t.root.findAll((n) => n.props.testID === "day-close-done-takings")[0];
    expect(JSON.stringify(takings.props)).not.toContain("134,500");
    t.unmount();
  });

  test("on a Till device the reopen PIN shows inside the reopen sheet: still one Modal", async () => {
    mockState.summary = closed;
    setTillStaffSession({ venueId: VENUE, token: "ab".repeat(32), memberId: "seller", memberUserId: "u1", name: "Ada",
      canApprove: false, autoLockMinutes: 2 });
    const t = await render(APPROVERS);
    await press(t, "day-close-reopen");
    expect(visibleModals(t)).toHaveLength(1);
    expect(has(t, "day-close-reopen-reason")).toBe(true);
    await TestRenderer.act(async () => {
      void requestStepUp(VENUE, "reopen");
    });
    const modals = visibleModals(t);
    expect(modals).toHaveLength(1);
    expect(modals[0].findAll((n) => n.props.testID === "till-step-up-pad").length).toBeGreaterThan(0);
    // TEST-MOD-APPROVED #4490: 08-O5 fix 5 keeps the sheet's own body mounted
    // but hidden (display none) under the PIN pad, so a refusal after the PIN
    // can still be shown; the reason field is no longer unmounted.
    const hidden = t.root.findAll((n) => n.props.testID === "till-step-up-content" && n.props.style !== undefined)[0];
    expect((StyleSheet.flatten(hidden.props.style as never) as Record<string, unknown>).display).toBe("none");
    expect(hidden.findAll((n) => n.props.testID === "day-close-reopen-reason").length).toBeGreaterThan(0);
    t.unmount();
  });
});
