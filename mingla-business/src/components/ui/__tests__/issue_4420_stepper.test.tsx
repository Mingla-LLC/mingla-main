/**
 * #4420 B7 — the clickable wizard stepper.
 *
 * FAILS ON REVERT: a locked step becomes pressable, a step past the furthest
 * valid step becomes reachable, or pressing a reachable step stops calling
 * `onStepPress`.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { describe, expect, jest, test } from "@jest/globals";
import React from "react";

jest.mock("react-native-reanimated", () => {
  const { View: V } = jest.requireActual("react-native") as { View: unknown };
  return {
    __esModule: true,
    default: { View: V },
    Easing: { out: () => 0, cubic: 0 },
    cancelAnimation: () => undefined,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useReducedMotion: () => true,
    useSharedValue: (value: number) => ({ value }),
    withTiming: (value: number) => value,
  };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock("../Icon", () => ({ Icon: () => null }));
// [TEST-MOD-APPROVED #4420] — wave 6: the Button probe keeps its props so the footer tests can read them.
jest.mock("../Button", () => ({
  Button: (props: Record<string, unknown>) => require("react").createElement("ButtonProbe", props),
}));
jest.mock("../Sheet", () => ({ Sheet: ({ children }: { children: React.ReactNode }) => children }));

import { Stepper, StepperFooter, chipScrollOffset, isStepReachable, isStepSegmentFilled, resolveStepState } from "../Stepper";
import type { StepperStep } from "../Stepper";

type Node = { type: unknown; props: Record<string, unknown> };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement, options?: unknown) => { root: { findAll: (p: (n: Node) => boolean) => Node[] }; update: (element: React.ReactElement) => void; unmount: () => void };
  act: (callback: () => void | Promise<void>) => Promise<void> | void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STEPS: StepperStep[] = [
  { id: "basics", label: "Basics" },
  { id: "when", label: "When", state: "error", firstError: "Add a start time" },
  { id: "tickets", label: "Tickets" },
  { id: "payouts", label: "Payouts", state: "locked", lockedReason: "Connect payouts first" },
  { id: "review", label: "Review" },
];

describe("#4420 Stepper — reachability", () => {
  test("states derive from the current index unless set explicitly", () => {
    expect(resolveStepState(STEPS[0], 0, 2)).toBe("done");
    expect(resolveStepState(STEPS[2], 2, 2)).toBe("current");
    expect(resolveStepState(STEPS[4], 4, 2)).toBe("todo");
    expect(resolveStepState(STEPS[1], 1, 2)).toBe("error");
    expect(resolveStepState(STEPS[3], 3, 2)).toBe("locked");
  });

  test("a step is reachable only up to the furthest valid step, and never when locked", () => {
    expect(isStepReachable(STEPS[0], 0, 2)).toBe(true);
    expect(isStepReachable(STEPS[1], 1, 2)).toBe(true);
    expect(isStepReachable(STEPS[4], 4, 2)).toBe(false);
    expect(isStepReachable(STEPS[4], 4, 2, 4)).toBe(true);
    expect(isStepReachable(STEPS[3], 3, 2, 4)).toBe(false);
  });

  test("list layout: locked and unreachable steps are not pressable; reachable ones call onStepPress", async () => {
    const onStepPress = jest.fn();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <Stepper steps={STEPS} currentIndex={2} furthestValidIndex={4} onStepPress={onStepPress} layout="list" testID="wiz" />,
      );
    });
    const row = (i: number): Node =>
      renderer.root.findAll((n) => n.props.testID === `wiz-step-${i}` && typeof n.props.accessibilityState === "object")[0];

    expect((row(3).props.accessibilityState as { disabled: boolean }).disabled).toBe(true);
    expect(row(3).props.onPress).toBeUndefined();
    expect(row(4).props.onPress).toBeDefined();

    await TestRenderer.act(async () => {
      (row(0).props.onPress as () => void)();
    });
    expect(onStepPress).toHaveBeenCalledWith(0);
    renderer.unmount();
  });

  test("without furthestValidIndex, steps after the current one are not reachable", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <Stepper steps={STEPS} currentIndex={2} onStepPress={() => undefined} layout="chips" testID="wiz" />,
      );
    });
    const chip = (i: number): Node =>
      renderer.root.findAll((n) => n.props.testID === `wiz-chip-${i}` && typeof n.props.accessibilityState === "object")[0];
    expect(chip(1).props.onPress).toBeDefined();
    expect(chip(4).props.onPress).toBeUndefined();
    renderer.unmount();
  });
});

describe("#4420 Stepper — phone progress and chip scroll", () => {
  // Brand setup's Get paid step: Basics and Contact were saved and are locked.
  const BRAND: StepperStep[] = [
    { id: "basics", label: "Basics", state: "locked", lockedReason: "Saved" },
    { id: "contact", label: "Contact", state: "locked", lockedReason: "Saved" },
    { id: "pay", label: "Get paid" },
    { id: "review", label: "Review", state: "locked", lockedReason: "Finish Get paid first" },
  ];

  test("a locked step the host already passed fills its segment; a locked step ahead does not", () => {
    expect(BRAND.map((step, i) => isStepSegmentFilled(step, i, 2))).toEqual([true, true, true, false]);
  });

  test("`passed` fills a segment wherever it sits; error steps never count as filled", () => {
    expect(isStepSegmentFilled({ id: "x", label: "X", state: "locked", passed: true }, 3, 1)).toBe(true);
    expect(isStepSegmentFilled({ id: "x", label: "X", state: "error" }, 0, 2)).toBe(false);
    expect(isStepSegmentFilled({ id: "x", label: "X" }, 3, 2)).toBe(false);
  });

  test("chips render the filled segments for passed locked steps", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<Stepper steps={BRAND} currentIndex={2} onStepPress={() => undefined} layout="chips" testID="brand" />);
    });
    const { StyleSheet } = require("react-native") as { StyleSheet: { flatten: (s: unknown) => Record<string, unknown> } };
    const segments = renderer.root
      .findAll((n) => typeof n.type === "string" && Array.isArray(n.props.style) && n.props.testID === undefined)
      .map((n) => StyleSheet.flatten(n.props.style))
      .filter((st) => st.height === 3);
    expect(segments).toHaveLength(4);
    expect(segments.map((st) => st.backgroundColor === segments[2].backgroundColor)).toEqual([true, true, true, false]);
    renderer.unmount();
  });

  test("the chip row centres the current chip, never scrolling before the start", () => {
    expect(chipScrollOffset(400, 80, 300)).toBe(290);
    expect(chipScrollOffset(20, 80, 300)).toBe(0);
  });

  test("the chip row scrolls to the current chip on mount and when the step changes", async () => {
    const scrollTo = jest.fn();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    const element = (current: number) => (
      <Stepper steps={STEPS} currentIndex={current} furthestValidIndex={4} onStepPress={() => undefined} layout="chips" testID="wiz" />
    );
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(element(3), {
        createNodeMock: (el: { props: { testID?: string } }) => (el.props.testID === "wiz-chips" ? { scrollTo } : null),
      } as never);
    });
    const layout = (testID: string, x: number, width: number) => {
      const [node] = renderer.root.findAll((n) => n.props.testID === testID && typeof n.props.onLayout === "function");
      (node.props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { x, y: 0, width, height: 36 } } });
    };
    await TestRenderer.act(async () => {
      layout("wiz-chips", 0, 300);
      [0, 1, 2, 3, 4].forEach((i) => layout(`wiz-chip-${i}`, i * 100, 90));
    });
    expect(scrollTo).toHaveBeenLastCalledWith({ x: chipScrollOffset(300, 90, 300), animated: true });
    await TestRenderer.act(async () => {
      renderer.update(element(4));
    });
    expect(scrollTo).toHaveBeenLastCalledWith({ x: chipScrollOffset(400, 90, 300), animated: true });
    renderer.unmount();
  });
});


describe("#4420 wave 6 — StepperFooter and step descriptions", () => {
  // [TEST-MOD-APPROVED #4420] — new cases for the wave 6 token requests.
  const probes = (renderer: ReturnType<typeof TestRenderer.create>): Node[] =>
    renderer.root.findAll((n) => n.type === "ButtonProbe");

  test("backDisabled keeps Back visible but not pressable; continueTestID names the primary", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <StepperFooter
          previousLabel="Tickets"
          onBack={() => undefined}
          backDisabled
          continueLabel="Publish event"
          onContinue={() => undefined}
          continueTestID="wiz-publish"
          testID="wiz"
        />,
      );
    });
    const [back, primary] = probes(renderer);
    expect(back.props.testID).toBe("wiz-back");
    expect(back.props.disabled).toBe(true);
    expect(primary.props.testID).toBe("wiz-publish");
    renderer.unmount();
  });

  test("Back is enabled by default and absent without a previous label; wide drops full width and the safe area", async () => {
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        <StepperFooter previousLabel="Back" onBack={() => undefined} continueLabel="Continue" onContinue={() => undefined} wide testID="wiz" />,
      );
    });
    const [back, primary] = probes(renderer);
    expect(back.props.disabled).toBe(false);
    expect(back.props.fullWidth).toBe(false);
    expect(primary.props.testID).toBe("wiz-continue");
    const { StyleSheet } = require("react-native") as { StyleSheet: { flatten: (s: unknown) => Record<string, unknown> } };
    const [bar] = renderer.root.findAll((n) => n.props.testID === "wiz" && Array.isArray(n.props.style));
    expect(StyleSheet.flatten(bar.props.style).paddingBottom).toBe(12);
    await TestRenderer.act(async () => {
      renderer.update(<StepperFooter continueLabel="Continue" onContinue={() => undefined} testID="wiz" />);
    });
    expect(probes(renderer)).toHaveLength(1);
    renderer.unmount();
  });

  test("the desktop list shows a step's description, and an error replaces it", async () => {
    const steps: StepperStep[] = [
      { id: "basics", label: "Basics", description: "Name and category" },
      { id: "when", label: "When", description: "Dates", state: "error", firstError: "Add a start time" },
    ];
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(<Stepper steps={steps} currentIndex={0} layout="list" testID="wiz" />);
    });
    const texts = renderer.root
      .findAll((n) => n.type === "Text" || (typeof n.type === "object" && n.props.children !== undefined && typeof n.props.children === "string"))
      .map((n) => n.props.children)
      .filter((c) => typeof c === "string");
    expect(texts).toContain("Name and category");
    expect(texts).toContain("Add a start time");
    expect(texts).not.toContain("Dates");
    renderer.unmount();
  });
});
