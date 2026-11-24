/**
 * #4523 REWRITE: DateField now renders the Mingla calendar (@mingla/calendar)
 * on every platform, so the old assertions (OS picker / browser date input)
 * were replaced in this change; the vacuity guards and the venue-blackout
 * single-day rule are kept.
 *
 * Issue #1503 [stay-date-pickers] — NATIVE-PARITY + blackout regression proof.
 * SPEC §10.2 T-18 + SC-1-iOS / SC-1-Android / SC-9-Web / SC-9-Native / SC-10.
 * Append-only: NEW file, modifies and deletes nothing.
 *
 * WHY THIS SUITE IS SEPARATE from the web-resolved one. The web proof
 * (`packages/brand-rendering/__tests__/stayDateRangeField.issue1503.test.tsx`)
 * renders through react-native-web and reads the emitted DOM. That harness can
 * only ever answer "what does the browser get". THIS suite answers the other
 * half of the Platform gate — "what does iOS/Android get" — which is exactly
 * the assertion #1027's own adversarial suite makes for `WebDateTimeInput`
 * (`webDateTimeInput.adversarial.1027.test.tsx` Part B): with
 * `Platform.OS === "ios"` there must be ZERO web `<input>` host nodes, because
 * a raw DOM input on native is an unknown host component, not a text box.
 *
 * It runs under the STOCK `mingla-business/jest.config.cjs` (the required
 * `mingla-business jest suite` PR check), so it can never become a dark test.
 *
 * FAILS-ON-REVERT (verified by TRUE LINE DELETION):
 *   - make DateField render a raw `<input>` / the OS picker again
 *                                  -> D-1, D-2, D-3 RED
 *   - put the `<Input variant="number">` date fields back in VenueBlackoutSheet
 *                                  -> D-4, D-5 RED
 *   - restore the `From (YYYY-MM-DD)` label
 *                                  -> D-5 RED
 *   - make the blackout range rule strict (checkout-style)
 *                                  -> D-6 RED (a single-day blackout stops saving)
 */

import React from "react";
import { afterAll, beforeAll, describe, expect, jest, test } from "@jest/globals";
import { Platform } from "react-native";

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

// #4523: DateField reaches ui/Sheet and ui/Icon through the Host calendar
// config; both need the native bridge, so both are stubbed (the Sheet shows its
// children while visible).
jest.mock("../Sheet", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const R = require("react") as typeof React;
  return {
    __esModule: true,
    Sheet: ({ visible, children }: { visible?: boolean; children?: React.ReactNode }) =>
      visible ? R.createElement(R.Fragment, null, children) : null,
  };
});
jest.mock("../Icon", () => ({ __esModule: true, Icon: (): null => null }));

// The OS picker must never be rendered any more. It is stubbed to a marker host
// node so its ABSENCE is what the assertions read.
jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>): React.ReactElement =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require("react") as typeof React).createElement(
      "NativeDateTimePicker",
      props,
    ),
}));

async function mount(element: React.ReactElement): Promise<Tree> {
  let created: Tree | undefined;
  await TestRenderer.act(async () => {
    created = TestRenderer.create(element);
  });
  // DateField loads its body through one React.lazy (#4523); let it resolve.
  await TestRenderer.act(async () => {
    await Promise.resolve();
  });
  return created as Tree;
}

const byType = (tree: Tree, type: string): HostNode[] =>
  tree.root.findAll((node) => node.type === type);

/**
 * HOST nodes only. `findAll` walks composite elements too, and a `testID` prop
 * threaded through a wrapper would match at every level — an ambiguity that
 * would quietly weaken the "exactly one" vacuity guards below. Web carries the
 * id as `data-testid` (the DOM attribute), native as `testID`.
 */
const byTestID = (tree: Tree, testID: string): HostNode[] =>
  tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      (node.props.testID === testID || node.props["data-testid"] === testID),
  );

describe("#1503 D-1…D-3 · DateField is the Mingla calendar on every platform", () => {
  const originalOS = Platform.OS;
  afterAll(() => {
    (Platform as { OS: string }).OS = originalOS;
  });

  const field = (props: Record<string, unknown>): React.ReactElement => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DateField } = require("../DateField") as {
      DateField: React.FC<Record<string, unknown>>;
    };
    return React.createElement(DateField, { timeZone: "Africa/Lagos", ...props });
  };

  test("D-1 (SC-1-iOS) on iOS the control is a Pressable — no web <input>, no OS picker", async () => {
    (Platform as { OS: string }).OS = "ios";
    const tree = await mount(
      field({
        label: "From",
        value: "2026-12-24",
        onChangeValue: () => undefined,
        accessibilityLabel: "Blackout start date",
        testID: "native-date",
      }),
    );
    // VACUITY GUARD — the component really mounted and really rendered its row.
    expect(byTestID(tree, "native-date")).toHaveLength(1);
    expect(byType(tree, "Pressable").length).toBeGreaterThan(0);
    expect(byType(tree, "input")).toHaveLength(0);
    expect(byType(tree, "NativeDateTimePicker")).toHaveLength(0);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });

  test("D-2 (SC-1-Android) tapping the row opens the Mingla calendar, bounded by min/max; a day commits YYYY-MM-DD", async () => {
    (Platform as { OS: string }).OS = "android";
    const committed: string[] = [];
    const tree = await mount(
      field({
        label: "From",
        value: "2026-12-10",
        min: "2026-12-01",
        max: "2026-12-31",
        onChangeValue: (next: string) => committed.push(next),
        accessibilityLabel: "Blackout start date",
        testID: "android-date",
      }),
    );
    // Closed to begin with — the calendar is not mounted until the row is tapped.
    expect(byTestID(tree, "android-date-calendar-grid")).toHaveLength(0);
    const row = byTestID(tree, "android-date")[0];
    expect(row).toBeDefined(); // vacuity guard
    await TestRenderer.act(async () => {
      (row.props.onPress as () => void)();
    });
    expect(byTestID(tree, "android-date-calendar-grid").length).toBeGreaterThan(0);
    expect(byType(tree, "NativeDateTimePicker")).toHaveLength(0);
    // Out-of-range days are UNSELECTABLE, not rejected later.
    const outside = tree.root.findAll(
      (node) => node.props.testID === "android-date-calendar-day-2026-12-31",
    );
    expect(outside.length).toBeGreaterThan(0);
    const inside = tree.root.findAll(
      (node) =>
        node.props.testID === "android-date-calendar-day-2026-12-24" &&
        typeof node.props.onPress === "function",
    )[0];
    expect(inside).toBeDefined();
    await TestRenderer.act(async () => {
      (inside.props.onPress as () => void)();
    });
    // The value contract: a picked day leaves as a `YYYY-MM-DD` STRING, once.
    expect(committed).toEqual(["2026-12-24"]);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });

  test("D-3 (SC-9-Web) on web the control is the same Pressable row — no <input type=\"date\">", async () => {
    (Platform as { OS: string }).OS = "web";
    const tree = await mount(
      field({
        label: "From",
        value: "2026-12-24",
        min: "2026-12-01",
        max: "2026-12-31",
        onChangeValue: () => undefined,
        accessibilityLabel: "Blackout start date",
        testID: "web-date",
      }),
    );
    expect(byTestID(tree, "web-date")).toHaveLength(1); // vacuity guard
    expect(byType(tree, "input")).toHaveLength(0);
    expect(byType(tree, "NativeDateTimePicker")).toHaveLength(0);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });
});

describe("#1503 D-4…D-6 · venue blackouts are picked, and a single day still saves", () => {
  const originalOS = Platform.OS;
  beforeAll(() => {
    (Platform as { OS: string }).OS = "web";
    // Only Date is faked, so "today" is a fixed December day; timers and
    // microtasks stay real for the lazy calendar chunk.
    jest.useFakeTimers({
      now: new Date("2026-12-10T12:00:00Z"),
      doNotFake: [
        "hrtime",
        "nextTick",
        "performance",
        "queueMicrotask",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "requestIdleCallback",
        "cancelIdleCallback",
        "setImmediate",
        "clearImmediate",
        "setInterval",
        "clearInterval",
        "setTimeout",
        "clearTimeout",
      ],
    });
  });
  afterAll(() => {
    jest.useRealTimers();
    (Platform as { OS: string }).OS = originalOS;
  });

  jest.mock("../../../wrappers/SmartScrollView", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const R = require("react") as typeof React;
    return {
      __esModule: true,
      ScrollView: ({ children }: { children?: React.ReactNode }) =>
        R.createElement(R.Fragment, null, children),
    };
  });
  jest.mock("../Button", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const R = require("react") as typeof React;
    return {
      __esModule: true,
      Button: (props: Record<string, unknown>) =>
        R.createElement("MockButton", props),
    };
  });
  // `Input` still renders the Reason row. It pulls ui/Icon -> react-native-svg,
  // which needs the native bridge and is irrelevant to a DATE proof.
  jest.mock("../Input", () => ({ __esModule: true, Input: (): null => null }));

  const renderSheet = async (
    onSave: (input: Record<string, unknown>) => void,
  ): Promise<Tree> => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { VenueBlackoutSheet } = require("../../venue/VenueBlackoutSheet") as {
      VenueBlackoutSheet: React.FC<Record<string, unknown>>;
    };
    return mount(
      React.createElement(VenueBlackoutSheet, {
        visible: true,
        onClose: () => undefined,
        blackout: null,
        tables: [],
        onSave,
        saving: false,
      }),
    );
  };

  const pickDay = async (tree: Tree, rowTestID: string, day: string): Promise<void> => {
    const row = byTestID(tree, rowTestID)[0];
    await TestRenderer.act(async () => {
      (row.props.onPress as () => void)();
    });
    const cell = tree.root.findAll(
      (node) =>
        node.props.testID === `${rowTestID}-calendar-day-${day}` &&
        typeof node.props.onPress === "function",
    )[0];
    expect(cell).toBeDefined(); // the day is on the open month
    await TestRenderer.act(async () => {
      (cell.props.onPress as () => void)();
    });
  };

  test("D-4 (SC-9-Web) From/To are calendar rows, not typed text boxes or date inputs", async () => {
    const tree = await renderSheet(() => undefined);
    const start = byTestID(tree, "venue-blackout-start");
    const end = byTestID(tree, "venue-blackout-end");
    // VACUITY GUARD — the two rows really exist under their original testIDs.
    expect(start).toHaveLength(1);
    expect(end).toHaveLength(1);
    expect(typeof start[0].props.onPress).toBe("function");
    expect(typeof end[0].props.onPress).toBe("function");
    expect(byType(tree, "input")).toHaveLength(0);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });

  test("D-5 the `(YYYY-MM-DD)` label crutch is gone", async () => {
    const tree = await renderSheet(() => undefined);
    const labels = tree.root
      .findAll((node) => node.type === "Text")
      .map((node) => String(node.props.children ?? ""));
    // VACUITY GUARD — labels really were collected.
    expect(labels).toContain("From");
    expect(labels).toContain("To (optional)");
    expect(labels.some((label) => label.includes("YYYY-MM-DD"))).toBe(false);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });

  test("D-6 (T-18) a SINGLE-DAY blackout still saves — the Stay strict rule is NOT applied here", async () => {
    const saved: Record<string, unknown>[] = [];
    const tree = await renderSheet((input) => saved.push(input));

    // Nothing chosen yet -> the CTA is disabled.
    expect(byType(tree, "MockButton")[0].props.disabled).toBe(true);

    await pickDay(tree, "venue-blackout-start", "2026-12-24");
    // From alone (To empty) is a legal one-day blackout.
    const cta = byType(tree, "MockButton")[0];
    expect(cta.props.disabled).toBe(false);
    await TestRenderer.act(() => {
      (cta.props.onPress as () => void)();
    });
    expect(saved).toHaveLength(1);
    expect(saved[0].dateStart).toBe("2026-12-24");
    expect(saved[0].dateEnd).toBe("2026-12-24");

    // To == From is equally legal (the same-day rule, deliberately different
    // from the Stay rule where check-out must be STRICTLY after check-in).
    await pickDay(tree, "venue-blackout-end", "2026-12-24");
    expect(byType(tree, "MockButton")[0].props.disabled).toBe(false);

    // …and an end BEFORE the start is refused: that day is unselectable in the
    // To calendar (min = the chosen start), so the value cannot move.
    const endRow = byTestID(tree, "venue-blackout-end")[0];
    await TestRenderer.act(async () => {
      (endRow.props.onPress as () => void)();
    });
    const before = tree.root.findAll(
      (node) => node.props.testID === "venue-blackout-end-calendar-day-2026-12-23",
    );
    expect(before.length).toBeGreaterThan(0);
    expect(
      before.some(
        (node) => (node.props.accessibilityState as { disabled?: boolean } | undefined)?.disabled === true,
      ),
    ).toBe(true);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });
});
