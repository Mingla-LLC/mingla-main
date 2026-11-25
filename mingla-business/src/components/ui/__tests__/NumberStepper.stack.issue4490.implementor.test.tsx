/**
 * #4490 N3/N49 — a NumberStepper never squeezes its label. Below its own
 * width of 360 the label takes a line of its own above − / value / +, and
 * NumberStepperPair gives each stepper a cell that wraps instead of sharing
 * a narrow row (the labels printed one letter per line at 390 and broke
 * mid-word at 1440).
 *
 * Stock jest config: react-test-renderer over the passthrough react-native
 * mock (window 375 wide), so host props are the component's real props.
 */
import React from "react";
import { describe, expect, test } from "@jest/globals";
import { StyleSheet } from "react-native";

import { NUMBER_STEPPER_STACK_BELOW, NumberStepper, NumberStepperPair } from "../NumberStepper";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = { root: { findAll: (p: (n: HostNode) => boolean) => HostNode[] } };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => void) => void;
};

const rowOf = (tree: Tree, id: string): HostNode => {
  const found = tree.root.findAll((n) => n.props.testID === `${id}-row` && typeof n.type === "string");
  return found[0] ?? tree.root.findAll((n) => n.props.testID === `${id}-row`)[0];
};
const flat = (node: HostNode): Record<string, unknown> =>
  (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;

const render = (el: React.ReactElement): Tree => {
  let tree: Tree | undefined;
  TestRenderer.act(() => {
    tree = TestRenderer.create(el);
  });
  return tree as Tree;
};

describe("NumberStepper stacks below its own width (#4490 N3/N49)", () => {
  test("the stack threshold leaves room for the label beside the controls", () => {
    expect(NUMBER_STEPPER_STACK_BELOW).toBeGreaterThanOrEqual(340);
  });

  test("a phone-wide window starts stacked (label above the controls)", () => {
    const tree = render(<NumberStepper label="Smallest group" value={2} min={1} max={60} onChange={() => undefined} testID="min" />);
    expect(flat(rowOf(tree, "min")).flexDirection).toBe("column");
  });

  test("measured wide, it lays out in one row; measured narrow, it stacks", () => {
    const tree = render(<NumberStepper label="Fee (% of the booking)" value={0} min={0} max={100} onChange={() => undefined} testID="fee" />);
    const layout = (width: number): void =>
      TestRenderer.act(() => {
        (rowOf(tree, "fee").props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { width, height: 52, x: 0, y: 0 } } });
      });
    layout(520);
    expect(flat(rowOf(tree, "fee")).flexDirection).toBe("row");
    layout(300);
    expect(flat(rowOf(tree, "fee")).flexDirection).toBe("column");
  });

  test("`stacked` forces the label onto its own line", () => {
    const tree = render(<NumberStepper label="Guests" value={2} min={1} max={10} onChange={() => undefined} stacked testID="g" />);
    expect(flat(rowOf(tree, "g")).flexDirection).toBe("column");
  });

  test("a pair gives each stepper a wrapping cell of at least 280", () => {
    const tree = render(
      <NumberStepperPair testID="pair">
        <NumberStepper label="Smallest group" value={2} min={1} max={60} onChange={() => undefined} testID="a" />
        <NumberStepper label="Largest group" value={10} min={1} max={60} onChange={() => undefined} testID="b" />
      </NumberStepperPair>,
    );
    const pair = tree.root.findAll((n) => n.props.testID === "pair" && n.props.style !== undefined)[0];
    expect(flat(pair)).toMatchObject({ flexDirection: "row", flexWrap: "wrap" });
    const cells = tree.root.findAll(
      (n) => typeof n.type === "string" && (StyleSheet.flatten(n.props.style as never) as { flexBasis?: number } | undefined)?.flexBasis === 280,
    );
    expect(cells.length).toBe(2);
  });
});
