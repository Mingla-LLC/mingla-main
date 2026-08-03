/**
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
 *   - remove DateField's `Platform.OS === "web"` gate so WebDateTimeInput
 *     renders unconditionally      -> D-1 RED (an <input> appears on iOS)
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

// The native picker has no web build and needs the RN bridge, so it is stubbed
// to a marker host node. Its PRESENCE/ABSENCE is what the assertions read.
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
  await TestRenderer.act(() => {
    created = TestRenderer.create(element);
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

describe("#1503 D-1…D-3 · DateField is a real Platform-gated PAIR", () => {
  const originalOS = Platform.OS;
  afterAll(() => {
    (Platform as { OS: string }).OS = originalOS;
  });

  test("D-1 (SC-1-iOS/Android) on native the control is a Pressable — ZERO web <input> nodes", async () => {
    (Platform as { OS: string }).OS = "ios";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DateField } = require("../DateField") as {
      DateField: React.FC<Record<string, unknown>>;
    };
    const tree = await mount(
      React.createElement(DateField, {
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
    // THE native-parity assertion: a raw DOM <input> must never leak onto native.
    expect(byType(tree, "input")).toHaveLength(0);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });

  test("D-2 (SC-9-Native) tapping the native row opens the native picker, bounded by min/max", async () => {
    (Platform as { OS: string }).OS = "android";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DateField } = require("../DateField") as {
      DateField: React.FC<Record<string, unknown>>;
    };
    const committed: string[] = [];
    const tree = await mount(
      React.createElement(DateField, {
        label: "From",
        value: "",
        min: "2026-12-01",
        max: "2026-12-31",
        onChangeValue: (next: string) => committed.push(next),
        accessibilityLabel: "Blackout start date",
        testID: "android-date",
      }),
    );
    // Closed to begin with — the picker is not mounted until the row is tapped.
    expect(byType(tree, "NativeDateTimePicker")).toHaveLength(0);
    const row = byTestID(tree, "android-date")[0];
    expect(row).toBeDefined(); // vacuity guard
    await TestRenderer.act(() => {
      (row.props.onPress as () => void)();
    });
    const pickers = byType(tree, "NativeDateTimePicker");
    expect(pickers).toHaveLength(1);
    expect(pickers[0].props.mode).toBe("date");
    // SC-3/SC-4 on native: out-of-range days are UNSELECTABLE, not rejected later.
    expect((pickers[0].props.minimumDate as Date).getDate()).toBe(1);
    expect((pickers[0].props.minimumDate as Date).getMonth()).toBe(11);
    expect((pickers[0].props.maximumDate as Date).getDate()).toBe(31);
    // The value contract: a picked Date leaves as a `YYYY-MM-DD` STRING.
    await TestRenderer.act(() => {
      (pickers[0].props.onChange as (e: unknown, d?: Date) => void)(
        { type: "set" },
        new Date(2026, 11, 24, 12, 0, 0, 0),
      );
    });
    expect(committed).toEqual(["2026-12-24"]);
    // Dismissal commits nothing.
    await TestRenderer.act(() => {
      (row.props.onPress as () => void)();
    });
    await TestRenderer.act(() => {
      (byType(tree, "NativeDateTimePicker")[0].props.onChange as (
        e: unknown,
        d?: Date,
      ) => void)({ type: "dismissed" }, undefined);
    });
    expect(committed).toEqual(["2026-12-24"]);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });

  test("D-3 (SC-9-Web, SC-11) on web the control is a real <input type=\"date\"> that tolerates \"\"", async () => {
    (Platform as { OS: string }).OS = "web";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DateField } = require("../DateField") as {
      DateField: React.FC<Record<string, unknown>>;
    };
    const committed: string[] = [];
    const tree = await mount(
      React.createElement(DateField, {
        label: "From",
        value: "2026-12-24",
        min: "2026-12-01",
        max: "2026-12-31",
        onChangeValue: (next: string) => committed.push(next),
        accessibilityLabel: "Blackout start date",
        testID: "web-date",
      }),
    );
    const inputs = byType(tree, "input");
    expect(inputs).toHaveLength(1); // vacuity guard
    expect(inputs[0].props.type).toBe("date");
    expect(inputs[0].props.value).toBe("2026-12-24");
    expect(inputs[0].props.min).toBe("2026-12-01");
    expect(inputs[0].props.max).toBe("2026-12-31");
    expect(inputs[0].props["aria-label"]).toBe("Blackout start date");
    expect(inputs[0].props["data-testid"]).toBe("web-date");
    // No native picker on web (it has no web build — the #1027 Class-2 bug).
    expect(byType(tree, "NativeDateTimePicker")).toHaveLength(0);
    let threw = false;
    await TestRenderer.act(() => {
      try {
        (inputs[0].props.onChange as (e: unknown) => void)({
          target: { value: "" },
        });
      } catch {
        threw = true;
      }
    });
    expect(threw).toBe(false);
    expect(committed).toEqual([""]);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });
});

describe("#1503 D-4…D-6 · venue blackouts are picked, and a single day still saves", () => {
  const originalOS = Platform.OS;
  beforeAll(() => {
    (Platform as { OS: string }).OS = "web";
  });
  afterAll(() => {
    (Platform as { OS: string }).OS = originalOS;
  });

  jest.mock("../Sheet", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const R = require("react") as typeof React;
    return {
      __esModule: true,
      Sheet: ({ children }: { children?: React.ReactNode }) =>
        R.createElement(R.Fragment, null, children),
    };
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

  test("D-4 (SC-9-Web) From/To render real date inputs, not typed text boxes", async () => {
    const tree = await renderSheet(() => undefined);
    const start = byTestID(tree, "venue-blackout-start");
    const end = byTestID(tree, "venue-blackout-end");
    // VACUITY GUARD — the two rows really exist under their original testIDs.
    expect(start).toHaveLength(1);
    expect(end).toHaveLength(1);
    expect(start[0].type).toBe("input");
    expect(end[0].type).toBe("input");
    expect(start[0].props.type).toBe("date");
    expect(end[0].props.type).toBe("date");
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
    const start = byTestID(tree, "venue-blackout-start")[0];
    expect(start).toBeDefined(); // vacuity guard

    // Nothing chosen yet -> the CTA is disabled.
    expect(byType(tree, "MockButton")[0].props.disabled).toBe(true);

    await TestRenderer.act(() => {
      (start.props.onChange as (e: unknown) => void)({
        target: { value: "2026-12-24" },
      });
    });
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
    const end = byTestID(tree, "venue-blackout-end")[0];
    await TestRenderer.act(() => {
      (end.props.onChange as (e: unknown) => void)({
        target: { value: "2026-12-24" },
      });
    });
    expect(byType(tree, "MockButton")[0].props.disabled).toBe(false);

    // …and an end BEFORE the start is still refused.
    await TestRenderer.act(() => {
      (end.props.onChange as (e: unknown) => void)({
        target: { value: "2026-12-23" },
      });
    });
    expect(byType(tree, "MockButton")[0].props.disabled).toBe(true);
    await TestRenderer.act(() => {
      tree.unmount();
    });
  });
});
