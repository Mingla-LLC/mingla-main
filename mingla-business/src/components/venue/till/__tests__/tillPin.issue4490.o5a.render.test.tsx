/**
 * #4490 spec 08 O5 part A — render proof for the PIN pad and the step-up prompt.
 *
 *  1. The step-up host shows the PIN pad IN PLACE of the open sheet's body, so
 *     a refund's fresh PIN never presents a second native modal (08-O3 fix 3):
 *     with a step-up pending there is still exactly one visible Modal, and the
 *     pad is inside it. With none pending the sheet's own body shows.
 *  2. The pad shows dots only, OK stays disabled below four digits, and OK
 *     hands the PIN to the answer once (the seller's own, or a manager's).
 *  3. Cancel answers "no PIN": the waiting refund moves nothing.
 *
 * Fails on revert: the host rendering its own <Sheet> gives two visible
 * Modals; a pad that submits below four digits answers early.
 *
 * Run: cd mingla-business && npx jest --config jest.issue1484.render.cjs --maxWorkers=2 tillPin
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

// ---- Boundary stubs (native-only deps with no jest side). ------------------
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
    Easing: {
      bezier: () => () => 0,
      linear: () => 0,
      out: (fn: unknown) => fn,
      inOut: (fn: unknown) => fn,
      ease: () => 0,
      in: (fn: unknown) => fn,
      cubic: () => 0,
    },
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
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
}));


import { Sheet } from "../../../ui/Sheet";
import { TillStepUpHost } from "../TillStepUp";
import {
  clearAllTillStaffSessions,
  requestStepUp,
  setTillStaffSession,
  type StepUpAnswer,
} from "../../../../services/tillStaffSession";

const VENUE = "00000000-4490-4000-8000-0000000000a1";
const APPROVERS = [
  { memberId: "mgr", name: "Chioma", role: "venue_staff", profile: "restaurant_manager", canSell: true, canApprove: true, canManage: true },
];

const press = async (tree: RenderTree, testID: string): Promise<void> => {
  const target = tree.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === "function")[0];
  expect({ testID, found: target !== undefined }).toEqual({ testID, found: true });
  await TestRenderer.act(async () => {
    (target.props.onPress as () => void)();
  });
};
const has = (tree: RenderTree, testID: string): boolean => tree.root.findAll((n) => n.props.testID === testID).length > 0;
const visibleModals = (tree: RenderTree): RenderTreeNode[] => tree.root.findAll((n) => n.type === Modal && n.props.visible === true);

function RefundLikeSheet(): React.ReactElement {
  return (
    <Sheet visible onClose={() => undefined} snapPoint={0.7} testID="till-refund">
      <TillStepUpHost venueId={VENUE} approvers={APPROVERS}>
        <Text testID="sheet-own-body">Refund body</Text>
      </TillStepUpHost>
    </Sheet>
  );
}

describe("O5A-R the step-up PIN pad lives inside the sheet that asked", () => {
  beforeEach(() => {
    clearAllTillStaffSessions();
    setTillStaffSession({ venueId: VENUE, token: "ab".repeat(32), memberId: "seller", memberUserId: "u1", name: "Ada", canApprove: false, autoLockMinutes: 2 });
  });

  test("no step-up pending: the sheet's own body; one modal", async () => {
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<RefundLikeSheet />);
    });
    const t = tree as unknown as RenderTree;
    expect(has(t, "sheet-own-body")).toBe(true);
    expect(has(t, "till-step-up")).toBe(false);
    t.unmount();
  });

  test("a pending step-up replaces the body inside the same modal; OK waits for four digits; a manager approves", async () => {
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<RefundLikeSheet />);
    });
    const t = tree as unknown as RenderTree;
    let answer: StepUpAnswer | null | undefined;
    await TestRenderer.act(async () => {
      void requestStepUp(VENUE, "refund").then((a) => { answer = a; });
    });
    expect(has(t, "till-step-up")).toBe(true);
    // TEST-MOD-APPROVED #4490: 08-O5 fix 5 (item 10) keeps the sheet's own body
    // mounted but hidden under the pad (display none), so the action that asked
    // can still show a refusal after the PIN; it is no longer unmounted.
    const content = t.root.findAll((n) => n.props.testID === "till-step-up-content" && n.props.style !== undefined)[0];
    expect(StyleSheet.flatten(content.props.style as never)).toMatchObject({ display: "none" });
    const modals = visibleModals(t);
    expect(modals).toHaveLength(1);
    expect(modals[0].findAll((n) => n.props.testID === "till-step-up-pad").length).toBeGreaterThan(0);
    // The seller has no money rights, so the manager is preselected.
    for (const d of ["4", "8", "2"]) await press(t, `till-step-up-pad-key-${d}`);
    const ok = t.root.findAll((n) => n.props.testID === "till-step-up-pad-ok" && typeof n.props.onPress === "function")[0];
    expect(ok.props.disabled).toBe(true);
    await press(t, "till-step-up-pad-key-6");
    await press(t, "till-step-up-pad-ok");
    expect(answer).toEqual({ pin: "4826", memberId: "mgr" });
    expect(has(t, "sheet-own-body")).toBe(true);
    expect(JSON.stringify(t.root.findAll((n) => n.type === Text).map((n) => n.props.children))).not.toContain("4826");
    t.unmount();
  });

  test("Cancel answers no PIN", async () => {
    let tree: RenderTree | null = null;
    await TestRenderer.act(async () => {
      tree = TestRenderer.create(<RefundLikeSheet />);
    });
    const t = tree as unknown as RenderTree;
    let answer: StepUpAnswer | null | undefined;
    await TestRenderer.act(async () => {
      void requestStepUp(VENUE, "refund").then((a) => { answer = a; });
    });
    await press(t, "till-step-up-cancel");
    expect(answer).toBeNull();
    t.unmount();
  });
});
