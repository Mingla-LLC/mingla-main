/**
 * #2664 [editing a sale window crashes on Android] — implementor happy path.
 * Append-only: NEW file. Modifies and deletes nothing.
 *
 * WHAT BROKE. `@react-native-community/datetimepicker` registers exactly two
 * Android pickers (`src/picker.android.js`): `date` and `time`. There is no
 * `datetime` key in either the default or the material registry. But
 * `constants.js` declares `datetime: 'datetime'` in the SHARED mode union, so
 * `mode="datetime"` type-checks and builds clean on Android and fails only at
 * runtime, on UNMOUNT: `datetimepicker.android.js:46` returns
 * `() => DateTimePickerAndroid.dismiss(mode, design)` and `dismiss` does
 * `pickers[mode].dismiss()` against `undefined`.
 *
 * WHY THE ASSERTIONS LOOK LIKE THIS. Three deliberate choices:
 *
 *  1. Every assertion reads the RENDERED `<DateTimePicker>` element, through a
 *     mock that materialises it as a `NativeDateTimePicker` host node carrying
 *     its props. A test that only exercised `combineAndroidDateAndTime` would
 *     stay green if the call site were deleted and `mode="datetime"` restored —
 *     which is precisely the bug. The `mode` prop at the render seam IS the
 *     defect, so that is what is read.
 *
 *  2. The Android fixture proves it is Android. `Platform.OS` is pinned BEFORE
 *     mount (the component branches on it in `handleOpenSalePicker` AND in the
 *     render), and D-0 asserts the pin actually took. A fixture that silently
 *     stayed on the default platform could not express this bug at all.
 *
 *  3. No `jest.fn().mockImplementation()` is installed per-test. `mockClear()`
 *     resets recorded calls but NOT the implementation, so a per-test impl
 *     leaks into every later test in the file.
 *
 * FAILS-ON-REVERT (verified by TRUE LINE DELETION, not comment-out):
 *   - restore `mode="datetime"` on the Android <DateTimePicker>  -> D-1, D-2 RED
 *   - delete the `step === "date"` branch so Android commits on the first
 *     dialog again                                              -> D-2, D-3 RED
 *   - make the time-step dismiss fall through to a commit        -> D-4 RED
 */

import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { Platform } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

// The native picker needs the RN bridge, so it is stubbed to a marker host node
// that CARRIES ITS PROPS. `mode` and `onChange` are read straight off it — this
// is the seam where #2664 lives.
jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>): React.ReactElement =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof React).createElement(
      "NativeDateTimePicker",
      props,
    ),
}));
jest.mock("../../../hooks/useEventWaitlist", () => ({
  useEventWaitlist: () => ({ data: [] }),
}));
jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({
    visible,
    children,
  }: {
    visible: boolean;
    children?: React.ReactNode;
  }) => (visible ? React.createElement("MockSheet", null, children) : null),
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("MockButton", props),
}));

// eslint-disable-next-line import/first
import { TicketTierEditSheet } from "../TicketTierEditSheet";
// eslint-disable-next-line import/first
import type { TicketStub } from "../../../store/draftEventStore";

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: {
    findAll: (predicate: (node: HostNode) => boolean) => HostNode[];
    findAllByType: (type: string) => HostNode[];
  };
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

const ticket = (overrides: Partial<TicketStub> = {}): TicketStub => ({
  id: "ticket-2664",
  name: "General Admission",
  priceGbp: 250,
  capacity: 200,
  isFree: false,
  isUnlimited: false,
  visibility: "public",
  displayOrder: 0,
  approvalRequired: false,
  passwordProtected: false,
  password: null,
  passwordConfigured: false,
  waitlistEnabled: false,
  minPurchaseQty: 1,
  maxPurchaseQty: null,
  allowTransfers: true,
  description: null,
  saleStartAt: null,
  saleEndAt: null,
  availableAt: "both",
  currency: "NGN",
  ...overrides,
});

const mount = async (
  initial: TicketStub | null,
  onSave: (saved: TicketStub) => void = () => undefined,
): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(
      <TicketTierEditSheet
        visible
        initial={initial}
        nextOrder={0}
        onClose={() => undefined}
        onSave={onSave}
        eventCurrency="NGN"
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

const button = (tree: Tree, label: string): HostNode => {
  const match = tree.root
    .findAllByType("MockButton")
    .find((node) => node.props.label === label);
  expect(match).toBeDefined();
  return match as HostNode;
};

/** Every rendered native picker. HOST nodes only — the composite would double. */
const pickers = (tree: Tree): HostNode[] =>
  tree.root.findAll((node) => node.type === "NativeDateTimePicker");

/** The single rendered picker. Asserts there is exactly one — never zero. */
const picker = (tree: Tree): HostNode => {
  const found = pickers(tree);
  expect(found).toHaveLength(1);
  return found[0];
};

const press = async (tree: Tree, label: string): Promise<void> => {
  await TestRenderer.act(() => {
    (byLabel(tree, label).props.onPress as () => void)();
  });
};

/** Drive the rendered picker's own onChange, as the native dialog would. */
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

const save = async (tree: Tree, label: string): Promise<void> => {
  await TestRenderer.act(() => {
    (button(tree, label).props.onPress as () => void)();
  });
};

// The wall clock every surface is driven to. Local components, because that is
// what all three pickers hand back and what the ISO comparison must agree on.
const PICKED_DATE = new Date(2027, 2, 14, 8, 5, 0, 0); // 14 Mar 2027, 08:05
const PICKED_TIME = new Date(2001, 0, 1, 21, 45, 0, 0); // 21:45, date irrelevant
const EXPECTED_ISO = new Date(2027, 2, 14, 21, 45, 0, 0).toISOString();

describe("#2664 the Android sale-window picker never uses mode=datetime", () => {
  test("D-0 the Android fixture really is Android", async () => {
    setOS("android");
    expect(Platform.OS).toBe("android");
    const tree = await mount(ticket());
    await press(tree, "Set sale start date and time");
    // If the fixture had not taken, the render would have gone down the iOS or
    // web branch and this picker would not exist at all.
    expect(pickers(tree)).toHaveLength(1);
    await TestRenderer.act(() => tree.unmount());
  });

  test("D-1 Android renders only real Android modes, never datetime", async () => {
    setOS("android");
    const tree = await mount(ticket());

    await press(tree, "Set sale start date and time");
    expect(picker(tree).props.mode).toBe("date");
    expect(picker(tree).props.mode).not.toBe("datetime");

    await fire(tree, "set", PICKED_DATE);
    // Still open — this is step 1 of 2, now showing the clock.
    expect(picker(tree).props.mode).toBe("time");
    expect(picker(tree).props.mode).not.toBe("datetime");

    await TestRenderer.act(() => tree.unmount());
  });

  test("D-2 the two steps combine into one full date AND time", async () => {
    setOS("android");
    const saved: TicketStub[] = [];
    const tree = await mount(ticket(), (v) => saved.push(v));

    await press(tree, "Set sale start date and time");
    await fire(tree, "set", PICKED_DATE);
    await fire(tree, "set", PICKED_TIME);

    // Dialog closed, and the committed value carries the DATE from step 1 and
    // the TIME from step 2 — not one or the other.
    expect(pickers(tree)).toHaveLength(0);
    await save(tree, "Save changes");
    expect(saved).toHaveLength(1);
    expect(saved[0].saleStartAt).toBe(EXPECTED_ISO);

    const committed = new Date(saved[0].saleStartAt as string);
    expect(committed.getFullYear()).toBe(2027);
    expect(committed.getMonth()).toBe(2);
    expect(committed.getDate()).toBe(14);
    expect(committed.getHours()).toBe(21);
    expect(committed.getMinutes()).toBe(45);

    await TestRenderer.act(() => tree.unmount());
  });

  test("D-3 cancelling the DATE step commits nothing", async () => {
    setOS("android");
    const saved: TicketStub[] = [];
    const tree = await mount(
      ticket({ saleStartAt: null }),
      (v) => saved.push(v),
    );

    await press(tree, "Set sale start date and time");
    await fire(tree, "dismissed");

    expect(pickers(tree)).toHaveLength(0);
    await save(tree, "Save changes");
    expect(saved).toHaveLength(1);
    expect(saved[0].saleStartAt).toBeNull();

    await TestRenderer.act(() => tree.unmount());
  });

  test("D-4 cancelling the TIME step does not persist the half-set date", async () => {
    setOS("android");
    const saved: TicketStub[] = [];
    const tree = await mount(
      ticket({ saleStartAt: null }),
      (v) => saved.push(v),
    );

    await press(tree, "Set sale start date and time");
    await fire(tree, "set", PICKED_DATE); // date chosen…
    expect(picker(tree).props.mode).toBe("time");
    await fire(tree, "dismissed"); // …then backed out of the clock.

    // THE assertion this issue turns on: a date picked in step 1 must not reach
    // saleStartAt when the operator abandons step 2. The window is set whole or
    // not at all.
    expect(pickers(tree)).toHaveLength(0);
    await save(tree, "Save changes");
    expect(saved).toHaveLength(1);
    expect(saved[0].saleStartAt).toBeNull();

    await TestRenderer.act(() => tree.unmount());
  });

  test("D-5 an existing sale window survives a cancelled time step unchanged", async () => {
    setOS("android");
    const existing = new Date(2027, 5, 1, 10, 30, 0, 0).toISOString();
    const saved: TicketStub[] = [];
    const tree = await mount(
      ticket({ saleStartAt: existing }),
      (v) => saved.push(v),
    );

    await press(tree, "Set sale start date and time");
    await fire(tree, "set", PICKED_DATE);
    await fire(tree, "dismissed");

    await save(tree, "Save changes");
    expect(saved[0].saleStartAt).toBe(existing);

    await TestRenderer.act(() => tree.unmount());
  });

  test("D-6 the time step opens on the existing time, not midnight", async () => {
    setOS("android");
    const existing = new Date(2027, 5, 1, 10, 30, 0, 0).toISOString();
    const tree = await mount(ticket({ saleStartAt: existing }));

    await press(tree, "Set sale start date and time");
    await fire(tree, "set", PICKED_DATE);

    const seeded = picker(tree).props.value as Date;
    expect(seeded.getHours()).toBe(10);
    expect(seeded.getMinutes()).toBe(30);
    // …and it carries the date the operator just picked.
    expect(seeded.getFullYear()).toBe(2027);
    expect(seeded.getMonth()).toBe(2);
    expect(seeded.getDate()).toBe(14);

    await TestRenderer.act(() => tree.unmount());
  });

  test("D-7 iOS still gets its real datetime spinner", async () => {
    setOS("ios");
    const tree = await mount(ticket());

    await press(tree, "Set sale start date and time");
    // `datetime` IS a real iOS mode and iOS has no unmount dismiss effect, so
    // the fix must not have "fixed" the platform that was never broken.
    expect(picker(tree).props.mode).toBe("datetime");
    expect(picker(tree).props.display).toBe("spinner");

    await TestRenderer.act(() => tree.unmount());
  });

  test("D-8 iOS and Android commit the IDENTICAL instant for the same wall clock", async () => {
    // iOS: one spinner, one Date, committed on Done.
    setOS("ios");
    const iosSaved: TicketStub[] = [];
    const iosTree = await mount(ticket(), (v) => iosSaved.push(v));
    await press(iosTree, "Set sale start date and time");
    await fire(iosTree, "set", new Date(2027, 2, 14, 21, 45, 0, 0));
    await TestRenderer.act(() => {
      (button(iosTree, "Done").props.onPress as () => void)();
    });
    await save(iosTree, "Save changes");
    await TestRenderer.act(() => iosTree.unmount());

    // Android: two dialogs, same wall clock.
    setOS("android");
    const androidSaved: TicketStub[] = [];
    const androidTree = await mount(ticket(), (v) => androidSaved.push(v));
    await press(androidTree, "Set sale start date and time");
    await fire(androidTree, "set", PICKED_DATE);
    await fire(androidTree, "set", PICKED_TIME);
    await save(androidTree, "Save changes");
    await TestRenderer.act(() => androidTree.unmount());

    expect(iosSaved[0].saleStartAt).toBe(EXPECTED_ISO);
    expect(androidSaved[0].saleStartAt).toBe(iosSaved[0].saleStartAt);
  });

  test("D-9 the sales-close window steps the same way", async () => {
    setOS("android");
    const saved: TicketStub[] = [];
    const tree = await mount(
      ticket({ saleStartAt: new Date(2027, 0, 1, 9, 0, 0, 0).toISOString() }),
      (v) => saved.push(v),
    );

    await press(tree, "Set sale end date and time");
    expect(picker(tree).props.mode).toBe("date");
    await fire(tree, "set", PICKED_DATE);
    expect(picker(tree).props.mode).toBe("time");
    await fire(tree, "set", PICKED_TIME);

    await save(tree, "Save changes");
    expect(saved[0].saleEndAt).toBe(EXPECTED_ISO);

    await TestRenderer.act(() => tree.unmount());
  });
});
