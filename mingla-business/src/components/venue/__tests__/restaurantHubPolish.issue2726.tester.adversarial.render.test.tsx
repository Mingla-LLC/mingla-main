/** Issue #2726 independent tester guards: boundary and shared-empty anatomy. */
import React from "react";
import { StyleSheet } from "react-native";

interface RenderNode {
  props: Record<string, unknown>;
  find: (predicate: (node: RenderNode) => boolean) => RenderNode;
  findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[];
}
interface RenderTree { root: RenderNode; unmount: () => void }
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void) => void;
};

jest.mock("expo-router", () => ({
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({ useCurrentBrandRole: () => ({ rank: 100 }) }));
jest.mock("../../../hooks/useVenueAvailability", () => ({
  useVenueAvailabilityConfig: jest.fn(), useVenueBlackouts: jest.fn(),
  useUpsertVenueAvailabilityConfig: jest.fn(), useUpsertVenueBlackout: jest.fn(),
  useDeleteVenueBlackout: jest.fn(),
}));
jest.mock("../../../hooks/useVenueTables", () => ({ useVenueTables: jest.fn() }));
jest.mock("../../ui/useShareNetworkState", () => ({ useShareNetworkState: () => true }));
jest.mock("../../../wrappers/KeyboardToolbarRoot", () => ({ setAvailabilityNumericToolbarState: jest.fn() }));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { ScrollView } = require("react-native");
  return { ScrollView };
});
jest.mock("../../ui/Input", () => ({ Input: () => null, default: () => null }));
jest.mock("../../ui/Skeleton", () => ({ Skeleton: () => null }));
jest.mock("../VenueBlackoutSheet", () => ({ VenueBlackoutSheet: () => null }));
jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));
jest.mock("../../ui/Button", () => {
  const React = require("react");
  const { Pressable, Text } = require("react-native");
  const Button = (props: Record<string, unknown>) => React.createElement(
    Pressable,
    props,
    React.createElement(Text, null, props.label),
  );
  return { Button, default: Button };
});

import { restaurantHubLayout } from "../../../constants/designSystem";
import { availabilityColumnCount } from "../VenueAvailabilityModule";
import { VenueHubEmptyState } from "../VenueHubEmptyState";

function byTestId(root: RenderNode, testID: string): RenderNode {
  return root.find((node) => node.props.testID === testID);
}

describe("#2726 tester adversarial native contract", () => {
  it.each([
    [0, 1], [959, 1], [960, 2], [1439, 2], [1440, 3], [4096, 3],
  ] as const)("maps measured width %i to exactly %i service columns", (width, expected) => {
    expect(availabilityColumnCount(width)).toBe(expected);
  });

  it("keeps layout rhythm on GlassCard contentStyle and the capped child", () => {
    let tree!: RenderTree;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <VenueHubEmptyState icon="waitlist" title="Nobody's waiting" body="Body" testID="adversarial-empty" />,
      );
    });
    const card = tree.root.find((node) =>
      node.props.testID === "adversarial-empty" && node.props.contentStyle !== undefined,
    );
    const anatomy = byTestId(tree.root, "adversarial-empty-anatomy");
    expect(StyleSheet.flatten(card.props.style)).toMatchObject({ width: "100%", alignSelf: "stretch" });
    expect(StyleSheet.flatten(card.props.contentStyle)).toMatchObject({ alignItems: "center" });
    expect(StyleSheet.flatten(anatomy.props.style)).toMatchObject({
      width: "100%", maxWidth: restaurantHubLayout.emptyContentMaxWidth,
      alignSelf: "center", paddingVertical: 8,
    });
    expect(tree.root.findAll((node) => node.props.testID === "adversarial-empty-action")).toHaveLength(0);
    TestRenderer.act(() => tree.unmount());
  });

  it.each([
    { actionLabel: "Add", onAction: undefined },
    { actionLabel: undefined, onAction: jest.fn() },
  ])("does not leak a CTA when the action contract is incomplete", (props) => {
    let tree!: RenderTree;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <VenueHubEmptyState icon="menu" title="Build your menu" testID="partial-action" {...props} />,
      );
    });
    expect(tree.root.findAll((node) => node.props.testID === "partial-action-action")).toHaveLength(0);
    TestRenderer.act(() => tree.unmount());
  });
});
