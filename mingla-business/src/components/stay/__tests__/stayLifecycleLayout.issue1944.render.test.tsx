/**
 * Issue #1944 — lifecycle-aware Stay overview and responsive action geometry.
 *
 * Append-only implementor proof. This mounts the shipped shared Business tree
 * and fails if a live Stay regains publish framing, if desktop actions leave
 * the form scroll flow, or if phone/native loses its pinned action dock.
 */

import React from "react";
import { StyleSheet } from "react-native";
import type { ViewStyle } from "react-native";

interface RenderTreeNode {
  parent: RenderTreeNode | null;
  props: Record<string, unknown>;
  findAll: (predicate: (node: RenderTreeNode) => boolean) => RenderTreeNode[];
}
interface RenderTree {
  root: RenderTreeNode;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

async function mount(element: React.ReactElement): Promise<RenderTree> {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(element);
  });
  expect(tree).not.toBeNull();
  return tree as unknown as RenderTree;
}

async function unmount(tree: RenderTree): Promise<void> {
  await TestRenderer.act(async () => {
    tree.unmount();
  });
}

let mockWidth = 1440;
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  WIDE_DESKTOP_MIN_WIDTH: 1024,
  useResponsiveLayout: () => ({
    isWideDesktop: mockWidth >= 1024,
    isWeb: true,
    width: mockWidth,
  }),
}));

jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native");
  return {
    __esModule: true,
    ScrollView: RN.ScrollView,
    default: RN.ScrollView,
  };
});
jest.mock("react-native-reanimated", () => {
  const RN = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  const passthrough =
    (Component: unknown) =>
    (props: Record<string, unknown>): unknown =>
      ReactLocal.createElement(Component, props);
  return {
    __esModule: true,
    default: {
      View: passthrough(RN.View),
      Text: passthrough(RN.Text),
      ScrollView: passthrough(RN.ScrollView),
      createAnimatedComponent: (Component: unknown) => Component,
    },
    Easing: {
      bezier: () => () => 0,
      linear: () => 0,
      out: (fn: unknown) => fn,
      inOut: (fn: unknown) => fn,
      ease: () => 0,
    },
    cancelAnimation: () => undefined,
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: (fn: () => unknown) => fn(),
    useReducedMotion: () => false,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value,
    withRepeat: (value: unknown) => value,
  };
});
jest.mock("react-native-svg", () => {
  const RN = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  const Shape = (props: Record<string, unknown>): unknown =>
    ReactLocal.createElement(RN.View, props);
  return new Proxy(
    { __esModule: true, default: Shape },
    {
      get: (target: Record<string, unknown>, prop: string) =>
        prop === "__esModule" || prop === "default" ? target[prop] : Shape,
    },
  );
});
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

let mockBookingState: "draft" | "review" | "active" = "active";
let mockLiveSupply = true;
let mockSavePending = false;
let mockSaveError = false;
const STAY_SETTINGS = {
  property_kind: "hotel",
  summary: "A characterful city hotel with a rooftop bar and garden rooms.",
  timezone: "Africa/Lagos",
  check_in_time: "15:00:00",
  check_out_time: "11:00:00",
  default_booking_mode: "request",
  amenities: ["Pool"],
  accessibility_features: ["Lift"],
  arrival_instructions: "Front desk",
  house_rules: "No smoking",
  version: 3,
};
jest.mock("../../../hooks/useStayInventory", () => ({
  stayInventoryKeys: { all: ["stay-inventory"] },
  useStayInventory: () => ({
    data: {
      settings: { ...STAY_SETTINGS, booking_state: mockBookingState },
      offerings: [
        {
          id: "offering-1944",
          status: mockLiveSupply ? "live" : "draft",
          hasOpenAvailability: true,
          currentPrice: { amount_minor: 10000, currency_code: "NGN" },
          currentPolicy: { cancellation_policy: "flexible" },
          media: [{ is_cover: true, status: "ready" }],
        },
      ],
      permissions: { canManageInventory: true, canManageFinance: true },
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  usePublishStay: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useSaveStaySettings: () => ({
    mutate: jest.fn(),
    isPending: mockSavePending,
    isError: mockSaveError,
  }),
}));
jest.mock("../../../hooks/useBrandDiscoveryCurrency", () => ({
  useBrandDiscoveryCurrency: () => ({
    data: {
      authority: "settlement",
      canAcceptPaidReservations: true,
      currencyCode: "NGN",
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));
jest.mock("../StayInventoryManager", () => ({
  StayInventoryManager: (): null => null,
}));
jest.mock("../StayReservationsModule", () => ({
  StayReservationsModule: (): null => null,
}));
jest.mock("../../venue/VenueMenuModule", () => ({
  VenueMenuModule: (): null => null,
}));

import { suiteFormMaxWidth } from "../../../constants/designSystem";
import { StaySuiteShell } from "../StaySuiteShell";

const PROPS = {
  brandId: "brand-1944",
  venueId: "venue-1944",
  venueName: "Lifecycle Hotel",
  venueApproved: true,
};

function byTestId(tree: RenderTree, testID: string): RenderTreeNode[] {
  return tree.root.findAll((node) => node.props.testID === testID);
}

function interactiveByTestId(
  tree: RenderTree,
  testID: string,
): RenderTreeNode | undefined {
  return byTestId(tree, testID).find(
    (node) => typeof node.props.onPress === "function",
  );
}

function allText(tree: RenderTree): string {
  return tree.root
    .findAll((node) => typeof node.props.children === "string")
    .map((node) => node.props.children)
    .join(" ");
}

function hasAncestor(node: RenderTreeNode, testID: string): boolean {
  let cursor = node.parent;
  while (cursor !== null) {
    if (cursor.props.testID === testID) return true;
    cursor = cursor.parent;
  }
  return false;
}

async function openSettings(tree: RenderTree): Promise<void> {
  const rail = interactiveByTestId(tree, "stay-rail-settings");
  expect(rail).toBeDefined();
  await TestRenderer.act(async () => {
    (rail?.props.onPress as () => void)();
  });
}

describe("#1944 — Stay lifecycle and action layout", () => {
  beforeEach(() => {
    mockWidth = 1440;
    mockBookingState = "active";
    mockLiveSupply = true;
    mockSavePending = false;
    mockSaveError = false;
  });

  it("shows live management with no readiness or publish pseudo-action", async () => {
    const tree = await mount(<StaySuiteShell {...PROPS} />);
    const text = allText(tree);
    expect(text).toContain("Live");
    expect(text).toContain("Manage your live Stay");
    expect(text).not.toContain("Ready to publish");
    expect(text).not.toContain("required checks complete");
    expect(text).not.toContain("Stay is live");
    expect(byTestId(tree, "stay-live-management").length).toBeGreaterThan(0);
    expect(byTestId(tree, "stay-publish")).toHaveLength(0);
    expect(byTestId(tree, "stay-overview-action-bar")).toHaveLength(0);
    await unmount(tree);
  });

  it("keeps inactive readiness and places desktop Publish in scroll flow", async () => {
    mockBookingState = "review";
    mockLiveSupply = false;
    const tree = await mount(<StaySuiteShell {...PROPS} />);
    expect(allText(tree)).toContain("Ready to publish");
    const publish = interactiveByTestId(tree, "stay-publish");
    expect(publish).toBeDefined();
    expect(hasAncestor(publish as RenderTreeNode, "stay-overview-scroll")).toBe(
      true,
    );
    expect(byTestId(tree, "stay-overview-action-bar")).toHaveLength(0);
    await unmount(tree);
  });

  it.each([1024, 1440, 1920])(
    "keeps desktop Save inside the 720px form flow at %ipx",
    async (width) => {
      mockWidth = width;
      const tree = await mount(<StaySuiteShell {...PROPS} />);
      await openSettings(tree);
      const save = interactiveByTestId(tree, "stay-settings-save");
      const scroll = byTestId(tree, "stay-settings-scroll").find(
        (node) => node.props.contentContainerStyle !== undefined,
      );
      expect(save).toBeDefined();
      expect(scroll).toBeDefined();
      expect(hasAncestor(save as RenderTreeNode, "stay-settings-scroll")).toBe(
        true,
      );
      expect(byTestId(tree, "stay-settings-action-bar")).toHaveLength(0);
      const style = StyleSheet.flatten(
        scroll?.props.contentContainerStyle as ViewStyle,
      );
      expect(style.maxWidth).toBe(suiteFormMaxWidth);
      expect(style.alignSelf).toBe("flex-start");
      await unmount(tree);
    },
  );

  it("keeps narrow/native Save in the pinned bar instead of form flow", async () => {
    mockWidth = 390;
    const tree = await mount(<StaySuiteShell {...PROPS} />);
    const settingsTab = interactiveByTestId(tree, "stay-module-settings");
    expect(settingsTab).toBeDefined();
    await TestRenderer.act(async () => {
      (settingsTab?.props.onPress as () => void)();
    });
    const save = interactiveByTestId(tree, "stay-settings-save");
    expect(save).toBeDefined();
    expect(byTestId(tree, "stay-settings-action-bar").length).toBeGreaterThan(
      0,
    );
    expect(
      hasAncestor(save as RenderTreeNode, "stay-settings-action-bar"),
    ).toBe(true);
    expect(hasAncestor(save as RenderTreeNode, "stay-settings-scroll")).toBe(
      false,
    );
    await unmount(tree);
  });

  it("preserves save pending and error feedback on desktop", async () => {
    mockSavePending = true;
    mockSaveError = true;
    const tree = await mount(<StaySuiteShell {...PROPS} />);
    await openSettings(tree);
    expect(allText(tree)).toContain(
      "We couldn’t save these settings. Reload and try again.",
    );
    expect(interactiveByTestId(tree, "stay-settings-save")).toBeDefined();
    await unmount(tree);
  });
});
