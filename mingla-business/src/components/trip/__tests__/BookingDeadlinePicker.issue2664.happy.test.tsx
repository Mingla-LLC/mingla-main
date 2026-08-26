/**
 * #2664 [editing a sale window crashes on Android] — the SECOND instance.
 * Append-only: NEW file. Modifies and deletes nothing.
 *
 * `BookingDeadlinePicker` carried the identical defect and had simply not been
 * reported yet. Its picker was gated `Platform.OS !== "web"`, which reaches
 * Android exactly as `Platform.OS === "android"` does, and it rendered
 * `mode="datetime"` — a mode Android has no implementation for. Any sweep that
 * had looked only for the literal `Platform.OS === "android"` would have missed
 * it, which is the reason the guard gate keys on ios-PINNING rather than on
 * android-naming.
 *
 * The commit path here is stricter than the sale window's: this component
 * VALIDATES (future, and before trip start) before calling `onChange`, so a
 * half-set date leaking through would not merely be wrong, it would be
 * validated against the wrong instant.
 *
 * FAILS-ON-REVERT (verified by TRUE LINE DELETION, not comment-out):
 *   - restore the single `mode="datetime"` picker under the `!== "web"` gate
 *                                                          -> B-1, B-2 RED
 *   - delete the `androidStep === "date"` branch            -> B-2, B-3 RED
 *   - let the time-step dismiss fall through to onChange    -> B-4 RED
 */

import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Platform } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// Marker host node carrying its props — `mode`, `value` and `onChange` are read
// straight off the rendered element. This is the seam the bug lives at.
jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>): React.ReactElement =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof React).createElement(
      "NativeDateTimePicker",
      props,
    ),
}));

// eslint-disable-next-line import/first
import { BookingDeadlinePicker } from "../BookingDeadlinePicker";

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

const ORIGINAL_OS = Platform.OS;
const setOS = (os: string): void => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
};
afterEach(() => setOS(ORIGINAL_OS));

const TRIP_START = new Date(2028, 0, 1, 0, 0, 0, 0).toISOString();
const PICKED_DATE = new Date(2027, 2, 14, 8, 5, 0, 0);
const PICKED_TIME = new Date(2001, 0, 1, 21, 45, 0, 0);
const EXPECTED_ISO = new Date(2027, 2, 14, 21, 45, 0, 0).toISOString();

const mount = async (
  value: string | null,
  onChange: (next: string | null) => void,
): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <BookingDeadlinePicker
        value={value}
        tripStartIso={TRIP_START}
        brandTimezone="Europe/London"
        onChange={onChange}
      />,
    );
  });
  return tree as Tree;
};

const byLabel = (tree: Tree, label: string): HostNode => {
  const matches = tree.root.findAll(
    (node) => node.props.accessibilityLabel === label,
  );
  expect(matches.length).toBeGreaterThan(0);
  return matches[matches.length - 1];
};

const pickers = (tree: Tree): HostNode[] =>
  tree.root.findAll((node) => node.type === "NativeDateTimePicker");

const picker = (tree: Tree): HostNode => {
  const found = pickers(tree);
  expect(found).toHaveLength(1);
  return found[0];
};

/** Flip the Switch on, which opens the picker. */
const openPicker = async (tree: Tree): Promise<void> => {
  await TestRenderer.act(() => {
    (byLabel(tree, "Set a booking deadline").props.onValueChange as (
      v: boolean,
    ) => void)(true);
  });
};

const fire = async (
  tree: Tree,
  type: "set" | "dismissed",
  date?: Date,
): Promise<void> => {
  const onChange = picker(tree).props.onChange as (
    event: { type: string; nativeEvent: { timestamp: number } },
    selected?: Date,
  ) => void;
  await TestRenderer.act(() => {
    onChange(
      { type, nativeEvent: { timestamp: date?.getTime() ?? 0 } },
      type === "set" ? date : undefined,
    );
  });
};

describe("#2664 the booking-deadline picker is safe on Android too", () => {
  test("B-0 the Android fixture really is Android", async () => {
    setOS("android");
    expect(Platform.OS).toBe("android");
    const tree = await mount(null, () => undefined);
    await openPicker(tree);
    expect(pickers(tree)).toHaveLength(1);
    await TestRenderer.act(() => tree.unmount());
  });

  test("B-1 Android never renders mode=datetime", async () => {
    setOS("android");
    const tree = await mount(null, () => undefined);

    await openPicker(tree);
    expect(picker(tree).props.mode).toBe("date");
    expect(picker(tree).props.mode).not.toBe("datetime");

    await fire(tree, "set", PICKED_DATE);
    expect(picker(tree).props.mode).toBe("time");
    expect(picker(tree).props.mode).not.toBe("datetime");

    await TestRenderer.act(() => tree.unmount());
  });

  test("B-2 both steps combine into one committed deadline", async () => {
    setOS("android");
    const committed: (string | null)[] = [];
    const tree = await mount(null, (next) => committed.push(next));

    await openPicker(tree);
    await fire(tree, "set", PICKED_DATE);
    // Step 1 must NOT have committed anything on its own.
    expect(committed).toHaveLength(0);

    await fire(tree, "set", PICKED_TIME);
    expect(committed).toEqual([EXPECTED_ISO]);
    expect(pickers(tree)).toHaveLength(0);

    await TestRenderer.act(() => tree.unmount());
  });

  test("B-3 cancelling the DATE step commits nothing", async () => {
    setOS("android");
    const committed: (string | null)[] = [];
    const tree = await mount(null, (next) => committed.push(next));

    await openPicker(tree);
    await fire(tree, "dismissed");

    expect(committed).toHaveLength(0);
    expect(pickers(tree)).toHaveLength(0);

    await TestRenderer.act(() => tree.unmount());
  });

  test("B-4 cancelling the TIME step does not persist the half-set date", async () => {
    setOS("android");
    const committed: (string | null)[] = [];
    const tree = await mount(null, (next) => committed.push(next));

    await openPicker(tree);
    await fire(tree, "set", PICKED_DATE);
    expect(picker(tree).props.mode).toBe("time");
    await fire(tree, "dismissed");

    // onChange must never have fired — not with the date, not with anything.
    expect(committed).toHaveLength(0);
    expect(pickers(tree)).toHaveLength(0);

    await TestRenderer.act(() => tree.unmount());
  });

  test("B-5 an existing deadline is untouched by a cancelled time step", async () => {
    setOS("android");
    const existing = new Date(2027, 5, 1, 10, 30, 0, 0).toISOString();
    const committed: (string | null)[] = [];
    const tree = await mount(existing, (next) => committed.push(next));

    await TestRenderer.act(() => {
      (byLabel(tree, "Edit booking deadline").props.onPress as () => void)();
    });
    await fire(tree, "set", PICKED_DATE);
    await fire(tree, "dismissed");

    expect(committed).toHaveLength(0);

    await TestRenderer.act(() => tree.unmount());
  });

  test("B-6 the time step opens on the existing time, not midnight", async () => {
    setOS("android");
    const existing = new Date(2027, 5, 1, 10, 30, 0, 0).toISOString();
    const tree = await mount(existing, () => undefined);

    await TestRenderer.act(() => {
      (byLabel(tree, "Edit booking deadline").props.onPress as () => void)();
    });
    await fire(tree, "set", PICKED_DATE);

    const seeded = picker(tree).props.value as Date;
    expect(seeded.getHours()).toBe(10);
    expect(seeded.getMinutes()).toBe(30);
    expect(seeded.getDate()).toBe(14);

    await TestRenderer.act(() => tree.unmount());
  });

  test("B-7 iOS keeps its real datetime spinner", async () => {
    setOS("ios");
    const tree = await mount(null, () => undefined);
    await openPicker(tree);

    expect(picker(tree).props.mode).toBe("datetime");
    expect(picker(tree).props.display).toBe("spinner");

    await TestRenderer.act(() => tree.unmount());
  });

  test("B-8 iOS and Android commit the IDENTICAL instant for the same wall clock", async () => {
    setOS("ios");
    const iosCommitted: (string | null)[] = [];
    const iosTree = await mount(null, (next) => iosCommitted.push(next));
    await openPicker(iosTree);
    await fire(iosTree, "set", new Date(2027, 2, 14, 21, 45, 0, 0));
    await TestRenderer.act(() => {
      (
        byLabel(iosTree, "Set this booking deadline").props.onPress as () => void
      )();
    });
    await TestRenderer.act(() => iosTree.unmount());

    setOS("android");
    const androidCommitted: (string | null)[] = [];
    const androidTree = await mount(null, (next) => androidCommitted.push(next));
    await openPicker(androidTree);
    await fire(androidTree, "set", PICKED_DATE);
    await fire(androidTree, "set", PICKED_TIME);
    await TestRenderer.act(() => androidTree.unmount());

    expect(iosCommitted).toEqual([EXPECTED_ISO]);
    expect(androidCommitted).toEqual(iosCommitted);
  });

  test("B-9 validation still runs against the COMBINED instant", async () => {
    setOS("android");
    const committed: (string | null)[] = [];
    const tree = await mount(null, (next) => committed.push(next));

    await openPicker(tree);
    // A date BEFORE trip start, but a time that pushes past it would be caught
    // — here the whole combined instant is after trip start, so it is rejected.
    await fire(tree, "set", new Date(2028, 5, 1, 0, 0, 0, 0));
    await fire(tree, "set", new Date(2001, 0, 1, 12, 0, 0, 0));

    expect(committed).toHaveLength(0);
    const errors = tree.root.findAll(
      (node) => node.props.accessibilityLiveRegion === "polite",
    );
    expect(errors.length).toBeGreaterThan(0);

    await TestRenderer.act(() => tree.unmount());
  });
});
