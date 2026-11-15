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
jest.mock("../Button", () => ({ Button: () => null }));
jest.mock("../Sheet", () => ({ Sheet: ({ children }: { children: React.ReactNode }) => children }));

import { Stepper, isStepReachable, resolveStepState } from "../Stepper";
import type { StepperStep } from "../Stepper";

type Node = { type: unknown; props: Record<string, unknown> };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => { root: { findAll: (p: (n: Node) => boolean) => Node[] }; unmount: () => void };
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
