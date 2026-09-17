/**
 * #3402 [typeable guest limit] — NumberStepper: typeable count, clamping,
 * − / + taps, press-and-hold repeat, and the adjustable accessibility element.
 *
 * WHY: the RSVP creator's "Max guests" stepper only moved one per tap, so 80
 * guests took 79 taps and 300 was out of reach. The shared NumberStepper now
 * takes a typed number, clamps it, repeats on hold, and exposes one adjustable
 * element to screen readers.
 *
 * Runs under the STOCK jest config (the required `mingla-business jest (full
 * suite)` check): react-test-renderer over the passthrough react-native mock,
 * so every host node's props are the real props the component passes.
 *
 * #3402. FAILS-ON-REVERT: NumberStepper.tsx does not exist on main, so the
 * whole suite is red there. Within the file: a Text value instead of a
 * TextInput reddens N-1..N-6, dropping the clamp reddens N-3/N-4, dropping
 * onLongPress reddens N-9/N-10, dropping the adjustable role or its actions
 * reddens N-11/N-12.
 */

import React, { useState } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Platform } from "react-native";

import {
  NumberStepper,
  clampCount,
  holdRepeatStep,
  parseTypedCount,
  sanitizeTypedCount,
  stepCount,
} from "../NumberStepper";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (predicate: (node: HostNode) => boolean) => HostNode[] };
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};
const { act } = TestRenderer;

const TEST_ID = "count";

interface HarnessProps {
  initial: number;
  min?: number;
  max?: number;
  spy: (n: number) => void;
}

/** A parent that owns the value, like RsvpStep5Setup + the draft store. */
const Harness: React.FC<HarnessProps> = ({ initial, min = 1, max = 200, spy }) => {
  const [value, setValue] = useState(initial);
  return (
    <NumberStepper
      label="Max guests"
      value={value}
      min={min}
      max={max}
      onChange={(n) => {
        spy(n);
        setValue(n);
      }}
      testID={TEST_ID}
    />
  );
};

async function mount(element: React.ReactElement): Promise<Tree> {
  let created: Tree | undefined;
  await act(() => {
    created = TestRenderer.create(element);
  });
  return created as Tree;
}

/** The HOST node (string type) carrying a testID — re-read after every act. */
const host = (tree: Tree, testID: string): HostNode => {
  const found = tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  );
  if (found.length !== 1) {
    throw new Error(`expected one host node "${testID}", found ${found.length}`);
  }
  return found[0];
};

const call = async (
  tree: Tree,
  testID: string,
  handler: string,
  ...args: unknown[]
): Promise<void> => {
  await act(() => {
    (host(tree, testID).props[handler] as (...a: unknown[]) => void)(...args);
  });
};

const fieldText = (tree: Tree): unknown => host(tree, `${TEST_ID}-value`).props.value;

const originalOS = Platform.OS;
afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
  jest.useRealTimers();
});

describe("NumberStepper — typing", () => {
  test("N-1 the value is a number-pad TextInput under the existing -value testID", async () => {
    const tree = await mount(<Harness initial={50} spy={jest.fn()} />);
    const field = host(tree, `${TEST_ID}-value`);
    expect(field.type).toBe("TextInput");
    expect(field.props.keyboardType).toBe("number-pad");
    expect(field.props.selectTextOnFocus).toBe(true);
    expect(field.props.value).toBe("50");
    // max 200 → at most 3 digits can be typed
    expect(field.props.maxLength).toBe(3);
    expect(field.props.accessibilityLabel).toBe("Type max guests");
    await act(() => tree.unmount());
  });

  test("N-2 typing an in-range number writes it through (80 is one edit, not 79 taps)", async () => {
    const spy = jest.fn();
    const tree = await mount(<Harness initial={1} spy={spy} />);
    await call(tree, `${TEST_ID}-value`, "onFocus");
    await call(tree, `${TEST_ID}-value`, "onChangeText", "");
    await call(tree, `${TEST_ID}-value`, "onChangeText", "8");
    await call(tree, `${TEST_ID}-value`, "onChangeText", "80");
    expect(spy).toHaveBeenLastCalledWith(80);
    expect(fieldText(tree)).toBe("80");
    spy.mockClear();
    await call(tree, `${TEST_ID}-value`, "onBlur");
    // already committed — blur does not write again
    expect(spy).not.toHaveBeenCalled();
    expect(fieldText(tree)).toBe("80");
    await act(() => tree.unmount());
  });

  test("N-3 a number above max is held while typing and clamped to max on blur", async () => {
    const spy = jest.fn();
    const tree = await mount(<Harness initial={50} max={200} spy={spy} />);
    await call(tree, `${TEST_ID}-value`, "onFocus");
    await call(tree, `${TEST_ID}-value`, "onChangeText", "950");
    expect(spy).not.toHaveBeenCalledWith(950);
    expect(fieldText(tree)).toBe("950");
    await call(tree, `${TEST_ID}-value`, "onBlur");
    expect(spy).toHaveBeenLastCalledWith(200);
    expect(fieldText(tree)).toBe("200");
    await act(() => tree.unmount());
  });

  test("N-4 a number below min is clamped to min on submit", async () => {
    const spy = jest.fn();
    const tree = await mount(<Harness initial={50} min={1} spy={spy} />);
    await call(tree, `${TEST_ID}-value`, "onFocus");
    await call(tree, `${TEST_ID}-value`, "onChangeText", "0");
    expect(spy).not.toHaveBeenCalled();
    await call(tree, `${TEST_ID}-value`, "onSubmitEditing");
    expect(spy).toHaveBeenLastCalledWith(1);
    // the blur that follows a native submit is a no-op
    spy.mockClear();
    await call(tree, `${TEST_ID}-value`, "onBlur");
    expect(spy).not.toHaveBeenCalled();
    expect(fieldText(tree)).toBe("1");
    await act(() => tree.unmount());
  });

  test("N-5 non-digits are ignored (a pasted '1,2a0' is 120)", async () => {
    const spy = jest.fn();
    const tree = await mount(<Harness initial={50} spy={spy} />);
    await call(tree, `${TEST_ID}-value`, "onFocus");
    await call(tree, `${TEST_ID}-value`, "onChangeText", "1,2a0");
    expect(fieldText(tree)).toBe("120");
    expect(spy).toHaveBeenLastCalledWith(120);
    await call(tree, `${TEST_ID}-value`, "onChangeText", "-.");
    expect(fieldText(tree)).toBe("");
    await act(() => tree.unmount());
  });

  test("N-6 clearing the field and leaving puts back the value it had on focus", async () => {
    const spy = jest.fn();
    const tree = await mount(<Harness initial={80} spy={spy} />);
    await call(tree, `${TEST_ID}-value`, "onFocus");
    await call(tree, `${TEST_ID}-value`, "onChangeText", "8"); // live-writes 8
    await call(tree, `${TEST_ID}-value`, "onChangeText", "");
    await call(tree, `${TEST_ID}-value`, "onBlur");
    expect(spy).toHaveBeenLastCalledWith(80);
    expect(fieldText(tree)).toBe("80");
    await act(() => tree.unmount());
  });
});

describe("NumberStepper — − / + taps (existing behaviour kept)", () => {
  test("N-7 + and − move one step and keep their testIDs + labels", async () => {
    const spy = jest.fn();
    const tree = await mount(<Harness initial={50} spy={spy} />);
    const inc = host(tree, `${TEST_ID}-inc`);
    const dec = host(tree, `${TEST_ID}-dec`);
    expect(inc.props.accessibilityLabel).toBe("Increase Max guests");
    expect(dec.props.accessibilityLabel).toBe("Decrease Max guests");
    expect(inc.props.hitSlop).toBe(4); // 36 + 4 + 4 = 44pt touch target
    await call(tree, `${TEST_ID}-inc`, "onPress");
    expect(spy).toHaveBeenLastCalledWith(51);
    await call(tree, `${TEST_ID}-dec`, "onPress");
    await call(tree, `${TEST_ID}-dec`, "onPress");
    expect(spy).toHaveBeenLastCalledWith(49);
    expect(fieldText(tree)).toBe("49");
    await act(() => tree.unmount());
  });

  test("N-8 − is disabled at min and + is disabled at max", async () => {
    const atMin = await mount(<Harness initial={1} min={1} max={3} spy={jest.fn()} />);
    expect(host(atMin, `${TEST_ID}-dec`).props.disabled).toBe(true);
    expect(host(atMin, `${TEST_ID}-inc`).props.disabled).toBe(false);
    await act(() => atMin.unmount());
    const atMax = await mount(<Harness initial={3} min={1} max={3} spy={jest.fn()} />);
    expect(host(atMax, `${TEST_ID}-inc`).props.disabled).toBe(true);
    expect(host(atMax, `${TEST_ID}-inc`).props.accessibilityState).toEqual({
      disabled: true,
    });
    await act(() => atMax.unmount());
  });

  test("N-8b + while typing steps from the typed number", async () => {
    const spy = jest.fn();
    const tree = await mount(<Harness initial={50} spy={spy} />);
    await call(tree, `${TEST_ID}-value`, "onFocus");
    await call(tree, `${TEST_ID}-value`, "onChangeText", "120");
    await call(tree, `${TEST_ID}-inc`, "onPress");
    expect(spy).toHaveBeenLastCalledWith(121);
    expect(fieldText(tree)).toBe("121");
    await act(() => tree.unmount());
  });
});

describe("NumberStepper — press and hold", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  test("N-9 holding + repeats and speeds up; releasing stops it", async () => {
    const spy = jest.fn();
    const tree = await mount(<Harness initial={50} max={100_000} spy={spy} />);
    expect(host(tree, `${TEST_ID}-inc`).props.delayLongPress).toBe(350);
    await call(tree, `${TEST_ID}-inc`, "onLongPress");
    expect(spy).toHaveBeenLastCalledWith(51); // first repeat on long-press
    await act(() => {
      jest.advanceTimersByTime(150 * 7); // 7 more slow repeats
    });
    expect(spy).toHaveBeenLastCalledWith(58);
    await act(() => {
      jest.advanceTimersByTime(150 + 60 * 15); // 16 fast single steps
    });
    expect(spy).toHaveBeenLastCalledWith(74);
    await act(() => {
      jest.advanceTimersByTime(60 * 3); // now steps of ten, snapping
    });
    expect(spy).toHaveBeenLastCalledWith(100);
    const calls = spy.mock.calls.length;
    await call(tree, `${TEST_ID}-inc`, "onPressOut");
    await act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(spy.mock.calls.length).toBe(calls);
    await act(() => tree.unmount());
  });

  test("N-10 holding − stops at min instead of running on", async () => {
    const spy = jest.fn();
    const tree = await mount(<Harness initial={4} min={1} spy={spy} />);
    await call(tree, `${TEST_ID}-dec`, "onLongPress");
    await act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(spy.mock.calls.map((c) => c[0])).toEqual([3, 2, 1]);
    expect(jest.getTimerCount()).toBe(0);
    await act(() => tree.unmount());
  });

  test("N-10b unmounting mid-hold clears the timer", async () => {
    const spy = jest.fn();
    const tree = await mount(<Harness initial={4} spy={spy} />);
    await call(tree, `${TEST_ID}-inc`, "onLongPress");
    expect(jest.getTimerCount()).toBe(1);
    await act(() => tree.unmount());
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("NumberStepper — accessibility", () => {
  test("N-11 on native the label is one adjustable element with value + range", async () => {
    (Platform as { OS: string }).OS = "ios";
    const tree = await mount(<Harness initial={50} max={200} spy={jest.fn()} />);
    const adjust = host(tree, `${TEST_ID}-adjust`);
    expect(adjust.props.accessible).toBe(true);
    expect(adjust.props.accessibilityRole).toBe("adjustable");
    expect(adjust.props.accessibilityLabel).toBe("Max guests");
    expect(adjust.props.accessibilityValue).toEqual({
      min: 1,
      max: 200,
      now: 50,
      text: "50",
    });
    expect(adjust.props.accessibilityActions).toEqual([
      { name: "increment" },
      { name: "decrement" },
    ]);
    // The field and buttons are SIBLINGS of the adjustable element, not inside it.
    const inside = (
      adjust as unknown as { findAll: (p: (n: HostNode) => boolean) => HostNode[] }
    ).findAll((n) => n.type === "TextInput" || n.type === "Pressable");
    expect(inside).toHaveLength(0);
    await act(() => tree.unmount());
  });

  test("N-12 increment / decrement actions change the value", async () => {
    (Platform as { OS: string }).OS = "android";
    const spy = jest.fn();
    const tree = await mount(<Harness initial={50} spy={spy} />);
    const fire = (actionName: string) =>
      call(tree, `${TEST_ID}-adjust`, "onAccessibilityAction", {
        nativeEvent: { actionName },
      });
    await fire("increment");
    expect(spy).toHaveBeenLastCalledWith(51);
    await fire("decrement");
    await fire("decrement");
    expect(spy).toHaveBeenLastCalledWith(49);
    expect(host(tree, `${TEST_ID}-adjust`).props.accessibilityValue).toMatchObject({
      now: 49,
    });
    await act(() => tree.unmount());
  });

  test("N-13 web gets no slider role (the field + buttons are the keyboard path)", async () => {
    (Platform as { OS: string }).OS = "web";
    const tree = await mount(<Harness initial={50} spy={jest.fn()} />);
    const adjust = host(tree, `${TEST_ID}-adjust`);
    expect(adjust.props.accessibilityRole).toBeUndefined();
    expect(adjust.props.accessible).toBe(false);
    await act(() => tree.unmount());
  });
});

describe("NumberStepper — pure helpers", () => {
  test("clampCount rounds and clamps", () => {
    expect(clampCount(0, 1, 10)).toBe(1);
    expect(clampCount(11, 1, 10)).toBe(10);
    expect(clampCount(4.6, 1, 10)).toBe(5);
  });

  test("stepCount steps by one, or snaps to multiples for larger steps", () => {
    expect(stepCount(47, 1, 1, 1, 1000)).toBe(48);
    expect(stepCount(47, 1, 10, 1, 1000)).toBe(50);
    expect(stepCount(50, 1, 10, 1, 1000)).toBe(60);
    expect(stepCount(47, -1, 10, 1, 1000)).toBe(40);
    expect(stepCount(40, -1, 10, 1, 1000)).toBe(30);
    expect(stepCount(5, -1, 10, 1, 1000)).toBe(1);
    expect(stepCount(995, 1, 10, 1, 1000)).toBe(1000);
  });

  test("holdRepeatStep: slow, then fast, then tens", () => {
    expect(holdRepeatStep(0)).toEqual({ intervalMs: 150, step: 1 });
    expect(holdRepeatStep(7)).toEqual({ intervalMs: 150, step: 1 });
    expect(holdRepeatStep(8)).toEqual({ intervalMs: 60, step: 1 });
    expect(holdRepeatStep(23)).toEqual({ intervalMs: 60, step: 1 });
    expect(holdRepeatStep(24)).toEqual({ intervalMs: 60, step: 10 });
  });

  test("sanitizeTypedCount / parseTypedCount", () => {
    expect(sanitizeTypedCount("1,000", 6)).toBe("1000");
    expect(sanitizeTypedCount("12345678", 6)).toBe("123456");
    expect(sanitizeTypedCount(" 3 guests", 6)).toBe("3");
    expect(parseTypedCount("")).toBeNull();
    expect(parseTypedCount("007")).toBe(7);
  });
});
