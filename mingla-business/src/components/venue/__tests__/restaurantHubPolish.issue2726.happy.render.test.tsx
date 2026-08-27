/**
 * Issue #2726 implementor happy path: native-resolved shared empty-state and
 * measured Availability layout contracts. New file; append-only.
 */
import React from "react";

interface RenderNode {
  props: Record<string, unknown>;
  find: (predicate: (node: RenderNode) => boolean) => RenderNode;
  findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[];
}
interface RenderTree {
  root: RenderNode;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => void) => void;
};

jest.mock("expo-router", () => ({
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100 }),
}));
jest.mock("../../../hooks/useVenueAvailability", () => ({
  useVenueAvailabilityConfig: (() => {
    const query = {
      data: {
      servicePeriods: [
        { name: "Breakfast", days: [1], start: "08:00", end: "11:00" },
        { name: "Lunch", days: [2], start: "12:00", end: "15:00" },
        { name: "Dinner", days: [3], start: "17:00", end: "23:00" },
      ],
      turnTimes: {}, bufferMinutes: 0, maxReservationsPerSlot: null,
      slotGranularityMinutes: 15, advanceWindowDays: 30, minNoticeMinutes: 0,
      ianaTimezone: "Africa/Lagos", ianaTimezoneSource: "operator",
    },
      isLoading: false, isError: false, isSuccess: true, refetch: jest.fn(),
    };
    return () => query;
  })(),
  useVenueBlackouts: () => ({ data: [] }),
  useUpsertVenueAvailabilityConfig: () => ({ mutate: jest.fn(), isPending: false }),
  useUpsertVenueBlackout: () => ({ mutate: jest.fn(), isPending: false }),
  useDeleteVenueBlackout: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../hooks/useVenueTables", () => ({ useVenueTables: () => ({ data: [] }) }));
jest.mock("../../ui/useShareNetworkState", () => ({ useShareNetworkState: () => true }));
jest.mock("../../../wrappers/KeyboardToolbarRoot", () => ({
  setAvailabilityNumericToolbarState: jest.fn(),
}));
jest.mock("../../../wrappers/SmartScrollView", () => {
  const { ScrollView } = require("react-native");
  return { ScrollView };
});
jest.mock("../../ui/Button", () => {
  const React = require("react");
  const { Pressable, Text } = require("react-native");
  const Button = (props: Record<string, unknown>) =>
    React.createElement(
      Pressable,
      { ...props, testID: props.testID },
      React.createElement(Text, null, props.label),
    );
  return { Button, default: Button };
});
jest.mock("../../ui/Input", () => {
  const React = require("react");
  const { View } = require("react-native");
  const Input = React.forwardRef((props: Record<string, unknown>, _ref: unknown) =>
    React.createElement(View, props),
  );
  Input.displayName = "InputMock";
  return { Input, default: Input };
});
jest.mock("../../ui/Skeleton", () => {
  const React = require("react");
  const { View } = require("react-native");
  return { Skeleton: (props: Record<string, unknown>) => React.createElement(View, props) };
});
jest.mock("../VenueBlackoutSheet", () => ({ VenueBlackoutSheet: () => null }));
jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../ui/Toast", () => ({ Toast: () => null }));

import { accent, restaurantHubLayout } from "../../../constants/designSystem";
import { VenueAvailabilityModule } from "../VenueAvailabilityModule";
import { emptyIconBorderColor, VenueHubEmptyState } from "../VenueHubEmptyState";

function byTestId(root: RenderNode, testID: string): RenderNode {
  return root.find((node) => node.props.testID === testID);
}

function callProp(node: RenderNode, prop: string, argument?: unknown): void {
  const callback = node.props[prop];
  if (typeof callback !== "function") throw new Error(`${prop} is not callable`);
  callback(argument);
}

describe("#2726 native happy path", () => {
  it("uses the opaque warm Android icon border without changing iOS/web glass", () => {
    expect(emptyIconBorderColor("android")).toBe(accent.warm);
    expect(emptyIconBorderColor("ios")).toBe(accent.border);
    expect(emptyIconBorderColor("web")).toBe(accent.border);
  });

  it.each([
    ["reservations", "No reservations today yet.", "Add one to test"],
    ["waitlist", "Nobody's waiting", "Add to waitlist"],
    ["menu", "Build your menu", "Add a category"],
  ] as const)("uses one compact warm CTA contract for %s", (icon, title, actionLabel) => {
    const onAction = jest.fn();
    let tree!: RenderTree;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <VenueHubEmptyState
          icon={icon}
          title={title}
          body="Body"
          actionLabel={actionLabel}
          onAction={onAction}
          testID={`empty-${icon}`}
        />,
      );
    });
    const action = byTestId(tree.root, `empty-${icon}-action`);
    expect(action.props).toMatchObject({
      variant: "primary", size: "md", shape: "pill", accentColor: accent.warm,
      fullWidth: false,
    });
    expect(action.props.style).toEqual(expect.objectContaining({ maxWidth: restaurantHubLayout.compactCtaMaxWidth }));
    TestRenderer.act(() => callProp(action, "onPress"));
    expect(onAction).toHaveBeenCalledTimes(1);
    TestRenderer.act(() => tree.unmount());
  });

  it("omits the action without reserving an empty CTA slot", () => {
    let tree!: RenderTree;
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <VenueHubEmptyState icon="menu" title="Build your menu" body="Read only" testID="empty-readonly" />,
      );
    });
    expect(tree.root.findAll((node) => node.props.testID === "empty-readonly-action")).toHaveLength(0);
    TestRenderer.act(() => tree.unmount());
  });

  it("reflows Availability from one to two to three measured-content columns", () => {
    let tree!: RenderTree;
    TestRenderer.act(() => { tree = TestRenderer.create(<VenueAvailabilityModule brandId="b1" />); });
    const grid = byTestId(tree.root, "venue-avail-service-grid");
    expect(grid.props.accessibilityLabel).toBe("Service periods, 1 column");
    TestRenderer.act(() => callProp(grid, "onLayout", { nativeEvent: { layout: { width: 1100 } } }));
    expect(byTestId(tree.root, "venue-avail-service-grid").props.accessibilityLabel).toBe("Service periods, 2 columns");
    TestRenderer.act(() => callProp(byTestId(tree.root, "venue-avail-service-grid"), "onLayout", { nativeEvent: { layout: { width: 1500 } } }));
    expect(byTestId(tree.root, "venue-avail-service-grid").props.accessibilityLabel).toBe("Service periods, 3 columns");
    TestRenderer.act(() => tree.unmount());
  });
});
