/**
 * #4420 (c_6876753693 item 4): Ari's icon is the Ari orb everywhere, never the
 * sparkle.
 *
 * [TEST-MOD-APPROVED #4420] — was a source-text pin (I-PROPOSED-1047-NO-SOLE-
 * SOURCE-PIN); now renders the real Icon. The rule that no Ari nav entry names
 * the sparkle lives in the I-4420-HOST-WIRING strict-grep gate.
 *
 * FAILS ON REVERT: Icon "ari" draws an SVG glyph (or a second orb component)
 * instead of the still HomeAriOrb, or the orb ignores the icon size.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { describe, expect, jest, test } from "@jest/globals";
import React from "react";

jest.mock("../../home/HomeAriOrb", () => ({
  HomeAriOrb: (props: Record<string, unknown>) => {
    const { View } = jest.requireActual("react-native") as { View: React.ComponentType<Record<string, unknown>> };
    return <View {...props} testID="mock-home-ari-orb" />;
  },
}));
jest.mock("react-native-svg", () => {
  const { View } = jest.requireActual("react-native") as { View: React.ComponentType<Record<string, unknown>> };
  const el = (name: string) => (props: Record<string, unknown>) => <View {...props} testID={`svg-${name}`} />;
  return new Proxy({ __esModule: true, default: el("Svg") }, { get: (t, k: string) => (k in t ? (t as never)[k] : el(k)) });
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { type: unknown; props: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] } };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (work: () => void) => void;
};
const { Icon } = require("../Icon") as typeof import("../Icon");

function mount(element: React.ReactElement): Tree {
  let tree: Tree | undefined;
  TestRenderer.act(() => {
    tree = TestRenderer.create(element);
  });
  return tree as Tree;
}
const byId = (tree: Tree, id: string): Node[] => tree.root.findAll((n) => n.props.testID === id);

describe("#4420 Ari icon is the Ari orb", () => {
  test('Icon "ari" draws the still orb at the icon size and no SVG glyph', () => {
    const tree = mount(<Icon name="ari" size={26} />);
    const orb = byId(tree, "mock-home-ari-orb");
    expect(orb.length).toBeGreaterThan(0);
    expect(orb[0]?.props.size).toBe(26);
    expect(orb[0]?.props.still).toBe(true);
    expect(byId(tree, "svg-Svg")).toHaveLength(0);
  });

  test("any other icon is still an SVG glyph, never the orb", () => {
    const tree = mount(<Icon name="home" />);
    expect(byId(tree, "mock-home-ari-orb")).toHaveLength(0);
    expect(byId(tree, "svg-Svg").length).toBeGreaterThan(0);
  });

  test("the sparkle glyph is not what Ari resolves to", () => {
    const ari = mount(<Icon name="ari" />);
    const sparkle = mount(<Icon name="sparkle" />);
    expect(byId(ari, "svg-Svg")).toHaveLength(0);
    expect(byId(sparkle, "svg-Svg").length).toBeGreaterThan(0);
  });
});
