/**
 * issue #2399 independent tester guard.
 *
 * Different angle from the implementor happy path: malformed, stale, and
 * offline occurrence truth must replace the checkbox rows with explicit
 * recovery, and retry must remain an actual action rather than decorative copy.
 */
import React from "react";

import DayChooser from "../MultiDateDayChooser";
import type { PublicEventOccurrence } from "../../../services/publicEventOccurrencesService";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Tree = {
  root: {
    findAllByProps: (props: Record<string, unknown>) => {
      props: Record<string, unknown>;
    }[];
  };
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

const occurrences = [
  {
    id: "day-1",
    startAt: "2026-08-29T10:00:00Z",
    endAt: "2026-08-29T17:00:00Z",
    timezone: "Europe/London",
    isMaster: true,
    ticketsRemaining: null,
  },
  {
    id: "day-2",
    startAt: "2026-08-30T10:00:00Z",
    endAt: "2026-08-30T17:00:00Z",
    timezone: "Europe/London",
    isMaster: false,
    ticketsRemaining: null,
  },
] as const;

const mount = async (
  state: "error" | "offline" | "stale",
  onRetry?: () => void,
  rows: readonly PublicEventOccurrence[] = occurrences,
): Promise<Tree> => {
  let tree!: Tree;
  await act(() => {
    tree = TestRenderer.create(
      <DayChooser
        timezone="Europe/London"
        palette={palette as never}
        occurrences={rows}
        selectedOccurrenceIds={["day-2"]}
        pricingMode="per_day"
        isPaid
        highlightUnchosen={false}
        state={state}
        onRetry={onRetry}
        onToggle={() => undefined}
      />,
    );
  });
  return tree;
};

describe("issue #2399 tester — day truth fails closed under recovery states", () => {
  test("zero-row malformed truth renders a real Try again action and no choices", async () => {
    const retry = jest.fn();
    const tree = await mount("error", retry, []);

    expect(JSON.stringify(tree.toJSON())).toContain(
      "We couldn’t load the event days.",
    );
    expect(tree.root.findAllByProps({ accessibilityRole: "checkbox" })).toHaveLength(0);
    const actions = tree.root
      .findAllByProps({ accessibilityLabel: "Try again" })
      .filter((node) => typeof node.props.onPress === "function");
    expect(actions.length).toBeGreaterThan(0);
    (actions[0]?.props.onPress as (() => void) | undefined)?.();
    expect(retry).toHaveBeenCalledTimes(1);
    await act(() => tree.unmount());
  });

  test("stale truth hides old choices and exposes Refresh days", async () => {
    const retry = jest.fn();
    const tree = await mount("stale", retry);

    expect(JSON.stringify(tree.toJSON())).toContain(
      "Those dates just changed. Refresh and choose again.",
    );
    expect(tree.root.findAllByProps({ accessibilityRole: "checkbox" })).toHaveLength(0);
    const actions = tree.root
      .findAllByProps({ accessibilityLabel: "Refresh days" })
      .filter((node) => typeof node.props.onPress === "function");
    expect(actions.length).toBeGreaterThan(0);
    (actions[0]?.props.onPress as (() => void) | undefined)?.();
    expect(retry).toHaveBeenCalledTimes(1);
    await act(() => tree.unmount());
  });

  test("offline truth is an alert with no deceptive retry or stale rows", async () => {
    const tree = await mount("offline", () => undefined);

    expect(JSON.stringify(tree.toJSON())).toContain(
      "You’re offline. Reconnect to continue.",
    );
    expect(
      tree.root.findAllByProps({ accessibilityRole: "alert" }).length,
    ).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ accessibilityRole: "checkbox" })).toHaveLength(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: "Try again" })).toHaveLength(0);
    expect(tree.root.findAllByProps({ accessibilityLabel: "Refresh days" })).toHaveLength(0);
    await act(() => tree.unmount());
  });
});
