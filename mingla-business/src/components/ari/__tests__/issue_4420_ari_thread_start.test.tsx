/**
 * #4420 (Seth's screenshot): opening an Ari thread showed the orb jammed at
 * x=0 beside an empty grey pill holding a lone caret. The thinking bubble now
 * holds dots and the row keeps the screen gutter.
 *
 * [TEST-MOD-APPROVED #4420] — was a source-text pin (I-PROPOSED-1047-NO-SOLE-
 * SOURCE-PIN); now renders the real StreamingText. The structural halves (the
 * thread-opening gate in AriChatScreen, the web sheet's width cap) live in the
 * I-4420-HOST-WIRING strict-grep gate.
 *
 * FAILS ON REVERT: the lone caret comes back, the dots go, or the row loses
 * its space[4] gutter.
 */
/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import { describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { StyleSheet } from "react-native";

import { space } from "../../../constants/designSystem";

jest.mock("react-native-reanimated", () => {
  const { View: V } = jest.requireActual("react-native") as { View: unknown };
  return {
    __esModule: true,
    default: { View: V },
    Easing: { inOut: () => 0, cubic: 0 },
    cancelAnimation: () => undefined,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useReducedMotion: () => true,
    useSharedValue: (value: number) => ({ value }),
    withRepeat: (value: number) => value,
    withTiming: (value: number) => value,
  };
});
jest.mock("../AriOrb", () => ({ AriOrb: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { type: unknown; props: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Tree = { root: { findAll: (p: (n: Node) => boolean) => Node[] }; toJSON: () => unknown };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (work: () => void) => void;
};
const { StreamingText } = require("../StreamingText") as typeof import("../StreamingText");

function mount(visible: boolean): Tree {
  let tree: Tree | undefined;
  TestRenderer.act(() => {
    tree = TestRenderer.create(<StreamingText visible={visible} />);
  });
  return tree as Tree;
}

describe("#4420 Ari thread start", () => {
  test("the thinking bubble holds three dots, not a lone caret", () => {
    const tree = mount(true);
    const bubble = tree.root.findAll((n) => typeof n.type === "string" && n.props.testID === "ari-thinking-dots");
    expect(bubble).toHaveLength(1);
    const dots = (bubble[0] as unknown as { children: unknown[] }).children;
    expect(dots).toHaveLength(3);
  });

  test("the row keeps the screen gutter so the orb never touches the edge", () => {
    const tree = mount(true);
    const row = tree.root.findAll(
      (n) => typeof n.type === "string" && n.props.accessibilityLabel === "Ari is thinking",
    )[0] as Node;
    expect(StyleSheet.flatten(row.props.style).paddingHorizontal).toBe(space[4]);
  });

  test("nothing renders once the reply has started", () => {
    expect(mount(false).toJSON()).toBeNull();
  });
});
