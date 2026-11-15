/**
 * #4420 — "Who covers the costs" (shared by the event, trip and experience
 * wizards and brand pricing defaults) marks the chosen segment with the
 * neutral selected material, never an orange fill (orange is only for Create,
 * the active nav icon, progress/steppers and the upcoming dot).
 *
 * [TEST-MOD-APPROVED #4420] — was a source-text pin (I-PROPOSED-1047-NO-SOLE-SOURCE-PIN)
 *; now mounts the REAL WhoCoversCostsSection and reads the
 * painted styles off the selected segments. "No colour literal" is owned by
 * the I-HOST-CHROME-TOKENS-ONLY gate; "the three wizards mount it" by the
 * I-4420-HOST-WIRING gate.
 *
 * FAILS ON REVERT: `accent` (or any other fill) back on segSelected, the
 * selected label leaving color.textStrong, or a press not emitting onChange.
 */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any, import/first */
import { describe, expect, jest, test } from "@jest/globals";
import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../../services/supabase", () => ({ supabase: {} }));

type Node = { type: unknown; props: Record<string, any>; findAll: (p: (n: Node) => boolean) => Node[] };
type Tree = { root: Node };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (work: () => void) => void;
};
const { StyleSheet } = require("react-native") as { StyleSheet: { flatten: (s: unknown) => Record<string, unknown> } };
const { color, materials } = require("../../../constants/designSystem") as typeof import("../../../constants/designSystem");
const { WhoCoversCostsSection } = require("../WhoCoversCostsSection") as typeof import("../WhoCoversCostsSection");

const flatten = (style: unknown): Record<string, unknown> =>
  StyleSheet.flatten(Array.isArray(style) ? (style as unknown[]).flat(4).filter(Boolean) : style);

function mount(onChange: (next: unknown) => void): Tree {
  let tree!: Tree;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <WhoCoversCostsSection
        overrides={{ passTax: null, passMinglaFee: true, passServiceFee: null }}
        defaults={{ passTax: false, passMinglaFee: false, passServiceFee: false }}
        onChange={onChange}
        previewBaseCents={2500}
        currency="USD"
        effectiveTakeRateBps={500}
        format="event"
      />,
    );
  });
  return tree;
}

const radios = (tree: Tree): Node[] =>
  tree.root.findAll((n) => typeof n.type === "string" && n.props.accessibilityRole === "radio");

describe("#4420 WhoCoversCostsSection neutral selected", () => {
  test("every selected segment paints materials.selected, never orange", () => {
    const all = radios(mount(() => undefined));
    const selected = all.filter((n) => n.props.accessibilityState?.selected === true);
    expect(selected.length).toBeGreaterThan(0);
    for (const seg of selected) {
      const style = flatten(seg.props.style);
      expect(style.backgroundColor).toBe(materials.selected.solidFill);
      expect(style.backgroundColor).not.toBe(color.accent);
    }
    for (const seg of all.filter((n) => n.props.accessibilityState?.selected !== true)) {
      expect(flatten(seg.props.style).backgroundColor).not.toBe(materials.selected.solidFill);
    }
  });

  test("the selected label is textStrong, the other label stays text2", () => {
    const all = radios(mount(() => undefined));
    for (const seg of all) {
      const label = seg.findAll((n) => typeof n.type === "string" && n.type === "Text")[0];
      const expected = seg.props.accessibilityState?.selected === true ? color.textStrong : color.text2;
      expect(flatten(label.props.style).color).toBe(expected);
    }
  });

  test("pressing a segment emits the next override set", () => {
    const onChange = jest.fn();
    const all = radios(mount(onChange));
    const unselected = all.find((n) => n.props.accessibilityState?.selected !== true);
    expect(unselected).toBeDefined();
    TestRenderer.act(() => {
      unselected!.props.onPress();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
