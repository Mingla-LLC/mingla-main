/**
 * issue #3281 (main-red repair) — the guest day chooser wraps the shared
 * EventDatePicker WITHOUT losing the row contract earlier work pinned:
 *
 *   - #2160 / #2399: every day is a CHECKBOX (multi-select), never a chip with
 *     an unlabelled role, and a sold-out day cannot be toggled.
 *   - #2209 / I-14: the row's accessible name is `formatOccurrenceLine` — the
 *     same owner the public page eyebrow reads — so the two never disagree.
 *   - #3281: per-date override title / location / places-left still reach the
 *     guest, and an all-days pass shows no day choices, naming the price basis
 *     ("One price for all days") before any total (#2160 §7(b)).
 *
 * Fails on revert: deleting the chooser's `renderOccurrence` slot falls back to
 * the picker's bare chips, whose label is the day only ("Sun 29 Aug") and whose
 * ids differ — every assertion on label equality and hint below goes red.
 */
import React from "react";

import DayChooser from "../MultiDateDayChooser";
import type { PublicEventOccurrence } from "../../../services/publicEventOccurrencesService";
import { formatOccurrenceLine } from "../../../utils/eventDateDisplay";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { props: Record<string, unknown> };
type Tree = {
  root: { findAllByProps: (props: Record<string, unknown>) => Node[] };
  toJSON: () => unknown;
  unmount: () => void;
};

// react-test-renderer does not ship declarations in this workspace.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => Tree;
  act: (fn: () => void | Promise<void>) => Promise<void>;
};
const { act } = TestRenderer;

const palette = {
  primaryText: "#ffffff",
  secondaryText: "#dddddd",
  tertiaryText: "#bbbbbb",
  accent: "#eb7825",
  accentText: "#111111",
  accentWash: "#2f2420",
  panelBorder: "#444444",
};

// Dates far enough ahead to survive the many-dates upcoming filter.
const occurrences = [
  {
    id: "day-1",
    startAt: "2030-08-29T10:00:00Z",
    endAt: "2030-08-29T17:00:00Z",
    timezone: "Europe/London",
    isMaster: true,
    ticketsRemaining: null,
    overrideTitle: "Opening night",
  },
  {
    id: "day-2",
    startAt: "2030-08-30T10:00:00Z",
    endAt: "2030-08-30T17:00:00Z",
    timezone: "Europe/London",
    isMaster: false,
    ticketsRemaining: null,
    soldOut: true,
  },
] as unknown as readonly PublicEventOccurrence[];

const mount = async (
  pricingMode: "per_day" | "all_days",
  onToggle: (id: string) => void = () => undefined,
): Promise<Tree> => {
  let tree!: Tree;
  await act(() => {
    tree = TestRenderer.create(
      <DayChooser
        timezone="Europe/London"
        palette={palette as never}
        occurrences={occurrences}
        selectedOccurrenceIds={["day-1"]}
        pricingMode={pricingMode}
        isPaid
        highlightUnchosen={false}
        onToggle={onToggle}
      />,
    );
  });
  return tree;
};

const row = (tree: Tree, id: string): Node => {
  const rows = tree.root.findAllByProps({ testID: `issue-2135-day-row-${id}` });
  expect(rows.length).toBeGreaterThan(0);
  return rows[0]!;
};

describe("issue #3281 — shared picker keeps the guest day-row contract", () => {
  test("each day is a checkbox named by formatOccurrenceLine, with checked state", async () => {
    const tree = await mount("per_day");
    for (const occurrence of occurrences) {
      const node = row(tree, occurrence.id);
      expect(node.props.accessibilityRole).toBe("checkbox");
      expect(node.props.accessibilityLabel).toBe(
        formatOccurrenceLine(occurrence, "Europe/London"),
      );
      // The label carries the time, not only the day.
      expect(String(node.props.accessibilityLabel)).toContain(" · ");
      expect(node.props.nativeID).toBe(`issue-2160-day-row-${occurrence.id}`);
    }
    expect(row(tree, "day-1").props.accessibilityState).toEqual({
      checked: true,
      disabled: false,
    });
    tree.unmount();
  });

  test("a press toggles that day; a sold-out day is disabled", async () => {
    const onToggle = jest.fn();
    const tree = await mount("per_day", onToggle);
    await act(() => {
      (row(tree, "day-1").props.onPress as () => void)();
    });
    expect(onToggle).toHaveBeenCalledWith("day-1");
    const soldOut = row(tree, "day-2");
    expect(soldOut.props.disabled).toBe(true);
    expect(soldOut.props.accessibilityState).toEqual({
      checked: false,
      disabled: true,
    });
    tree.unmount();
  });

  test("per-date override detail still reaches the guest", async () => {
    const tree = await mount("per_day");
    expect(row(tree, "day-1").props.accessibilityHint).toBe("Opening night");
    expect(JSON.stringify(tree.toJSON())).toContain("Opening night");
    tree.unmount();
  });

  test("an all-days pass shows no day choices and names the price basis", async () => {
    const tree = await mount("all_days");
    expect(
      tree.root.findAllByProps({ accessibilityRole: "checkbox" }),
    ).toHaveLength(0);
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain("One price for all days");
    expect(text).toContain("Your dates");
    tree.unmount();
  });
});
