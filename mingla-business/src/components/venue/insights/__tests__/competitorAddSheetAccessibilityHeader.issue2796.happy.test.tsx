import React from "react";
import { StyleSheet } from "react-native";
import type { ViewStyle } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ReactLocal = require("react") as typeof React;
let mockFontScale = 1;

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native");
  return {
    ...actual,
    useWindowDimensions: () => ({
      width: 393,
      height: 852,
      scale: 3,
      fontScale: mockFontScale,
    }),
  };
});
jest.mock("../../../ui/Sheet", () => ({
  Sheet: (props: Record<string, unknown> & { children?: unknown }) =>
    ReactLocal.createElement("Sheet", props, props.children as never),
}));
jest.mock("../../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    ReactLocal.createElement("Button", props),
}));
jest.mock("../../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    ReactLocal.createElement("Input", props),
}));
jest.mock("../../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) =>
    ReactLocal.createElement("ConfirmDialog", props),
}));
jest.mock("../../../../context/AuthContext", () => ({
  useAuth: () => ({ loading: false, session: { user: { id: "user-1" } } }),
}));
jest.mock("../../../../hooks/useCompetitorIntelligence", () => ({
  useAddCompetitor: () => ({
    mutate: jest.fn(),
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: [],
    isFetching: false,
    isFetched: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock("../../../../wrappers/SmartScrollView", () => ({
  ScrollView: (props: Record<string, unknown> & { children?: unknown }) =>
    ReactLocal.createElement("ScrollView", props, props.children as never),
}));

import { CompetitorAddSheet } from "../CompetitorAddSheet";

interface RenderNode {
  type?: unknown;
  props: Record<string, unknown> & { testID?: string };
}
interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
  unmount: () => void;
}
const Renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

async function renderAt(fontScale: number): Promise<RenderTree> {
  mockFontScale = fontScale;
  let tree: RenderTree | null = null;
  await Renderer.act(async () => {
    tree = Renderer.create(
      <CompetitorAddSheet
        visible
        onClose={jest.fn()}
        brandId="brand-1"
        venueListingId="venue-1"
        venueCity="Lagos"
      />,
    );
  });
  return tree!;
}

function byId(tree: RenderTree, testID: string): RenderNode {
  return tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  )[0]!;
}

function button(tree: RenderTree, label: string): RenderNode {
  return tree.root.findAll(
    (node) => node.type === "Button" && node.props.label === label,
  )[0]!;
}

describe("issue 2796 add-sheet accessibility header", () => {
  afterEach(() => {
    mockFontScale = 1;
  });

  it("preserves the normal horizontal header and full-size Close action", async () => {
    const tree = await renderAt(1);
    const headerStyle = StyleSheet.flatten(
      byId(tree, "competitor-source-sheet-header").props.style,
    ) as ViewStyle;

    expect(headerStyle.flexDirection).toBe("row");
    expect(headerStyle.alignItems).toBe("center");
    expect(button(tree, "Close").props.style).toBeUndefined();
    expect(byId(tree, "competitor-source-sheet-title").props.maxFontSizeMultiplier).toBe(2);
    await Renderer.act(async () => tree.unmount());
  });

  it("stacks title then Close inside the safe inset at 200% in nearby and manual states", async () => {
    const tree = await renderAt(2);
    const headerStyle = StyleSheet.flatten(
      byId(tree, "competitor-source-sheet-header").props.style,
    ) as ViewStyle;
    const close = byId(tree, "competitor-source-sheet-close");
    const closeStyle = StyleSheet.flatten(close.props.style) as ViewStyle;

    expect(headerStyle).toMatchObject({
      flexDirection: "column",
      alignItems: "stretch",
      justifyContent: "flex-start",
    });
    expect(closeStyle).toMatchObject({
      alignSelf: "flex-end",
      minWidth: 44,
      minHeight: 44,
      flexShrink: 0,
    });
    expect(close.props.accessibilityLabel).toBe("Close watch a competitor");

    await Renderer.act(async () => {
      (button(tree, "Enter details manually").props.onPress as () => void)();
    });

    expect(byId(tree, "competitor-source-sheet-close").props.style).toEqual(
      close.props.style,
    );
    expect(button(tree, "Watch competitor")).toBeDefined();
    await Renderer.act(async () => tree.unmount());
  });
});
