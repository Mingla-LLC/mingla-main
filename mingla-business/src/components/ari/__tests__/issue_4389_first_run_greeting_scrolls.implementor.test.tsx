/**
 * #4389 P2 — Ari's first-run greeting overlapped the new top bar.
 *
 * The phone greeting was a bottom-anchored View (flex-end) inside an absolute
 * overlay under Ari's top bar. The A1 setup card (footer) made it taller than
 * that space, so it grew upward over the bar: 17pt overlap, the orb over the
 * brand chip. Fix: the phone greeting is a ScrollView (it clips to its box),
 * its content grows from the bottom (flexGrow + flex-end, so short content is
 * unchanged), keeps a top inset, and scrolls when tall.
 *
 * FAILS ON REVERT: the phone host back to a plain View → T1 and T2.
 */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { ScrollView, StyleSheet, Text } from "react-native";

jest.mock("../AriOrb", () => {
  const R = jest.requireActual("react") as typeof React;
  const RN = jest.requireActual("react-native") as typeof import("react-native");
  return { AriOrb: () => R.createElement(RN.View, { testID: "ari-orb" }) };
});

/* eslint-disable import/first */
import { FirstRunGreeting } from "../FirstRunGreeting";
/* eslint-enable import/first */

interface Node {
  type: unknown;
  props: Record<string, unknown>;
  findAll(p: (n: Node) => boolean): Node[];
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create(el: React.ReactElement): { root: Node; unmount(): void };
  act(cb: () => void): void;
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const copy = {
  headline: "What are you hosting?",
  body: "Tell me and I will set it up.",
  chips: [{ id: "event", label: "An event", primary: true }],
} as unknown as React.ComponentProps<typeof FirstRunGreeting>["copy"];

let tree: { root: Node; unmount(): void } | null = null;
function render(el: React.ReactElement): Node {
  TestRenderer.act(() => {
    tree = TestRenderer.create(el);
  });
  return (tree as unknown as { root: Node }).root;
}
afterEach(() => {
  if (tree !== null) TestRenderer.act(() => tree?.unmount());
  tree = null;
});

describe("#4389 P2 — the first-run greeting stays under Ari's top bar", () => {
  test("T1: the phone greeting is a scroll box holding the orb, the copy and the setup card", () => {
    const root = render(
      <FirstRunGreeting copy={copy} onChip={() => undefined} footer={<Text testID="setup-card">Set up</Text>} />,
    );
    const scroll = root.findAll((n) => n.type === ScrollView);
    expect(scroll).toHaveLength(1);
    const box = scroll[0] as Node;
    expect(box.props.testID).toBe("ari-first-run-greeting");
    for (const id of ["ari-orb", "setup-card", "ari-first-run-chips"]) {
      expect(box.findAll((n) => n.props.testID === id).length).toBeGreaterThan(0);
    }
  });

  test("T2: short content stays bottom-anchored, tall content scrolls, with a top inset", () => {
    const root = render(<FirstRunGreeting copy={copy} onChip={() => undefined} footer={<Text>card</Text>} />);
    const box = root.findAll((n) => n.type === ScrollView)[0] as Node;
    const content = StyleSheet.flatten(box.props.contentContainerStyle as object) as Record<string, unknown>;
    expect(content.flexGrow).toBe(1);
    expect(content.justifyContent).toBe("flex-end");
    expect(content.flex).toBeUndefined();
    expect(Number(content.paddingTop)).toBeGreaterThan(0);
    expect((StyleSheet.flatten(box.props.style as object) as Record<string, unknown>).flex).toBe(1);
  });

  test("T3: desktop keeps its centred layout (no scroll box)", () => {
    const root = render(<FirstRunGreeting copy={copy} onChip={() => undefined} desktop />);
    expect(root.findAll((n) => n.type === ScrollView)).toHaveLength(0);
  });
});
