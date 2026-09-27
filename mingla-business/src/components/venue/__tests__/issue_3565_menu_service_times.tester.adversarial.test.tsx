/**
 * #3565 independent tester guard — hostile schedule states and platform parity.
 *
 * This suite is intentionally separate from the implementor guard. It attacks
 * one-sided drafts, Android dismissal, day subsets, overnight windows, all-day
 * truth, unclamped card copy, and accessibility state.
 */

import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Platform, StyleSheet, View } from "react-native";
import type { Menu } from "../../../services/menusService";

interface TestNode {
  props: Record<string, unknown>;
  findAllByType: (type: unknown) => TestNode[];
  findByProps: (props: Record<string, unknown>) => TestNode;
  findAllByProps: (props: Record<string, unknown>) => TestNode[];
}

interface TestRenderer {
  root: TestNode;
  unmount: () => void;
}

interface RendererApi {
  create: (node: React.ReactElement) => TestRenderer;
  act: (callback: () => void) => void;
}

const mockMutate = jest.fn();
const mockSave = jest.fn();
let mockMenus: Menu[] = [];

const menu = (patch: Partial<Menu> & Pick<Menu, "id" | "name">): Menu => ({
  id: patch.id,
  brandId: "brand-a",
  venueId: "venue-a",
  name: patch.name,
  description: patch.description ?? null,
  sortOrder: patch.sortOrder ?? 0,
  isActive: patch.isActive ?? true,
  serviceWindowStart: patch.serviceWindowStart ?? null,
  serviceWindowEnd: patch.serviceWindowEnd ?? null,
  serviceDays: patch.serviceDays ?? null,
  items: patch.items ?? [],
});

jest.mock("@react-native-community/datetimepicker", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) =>
    React.createElement("NativeDateTimePicker", props),
}));

jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children, ...props }: { children?: React.ReactNode }) => (
    <View {...props}>{children}</View>
  ),
}));

jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("MockButton", props),
}));

jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));

jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children, ...props }: { children?: React.ReactNode }) => (
    <View {...props}>{children}</View>
  ),
}));

jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    React.createElement("MockInput", props),
}));

jest.mock("../../ui/Sheet", () => ({
  Sheet: ({
    visible,
    children,
    ...props
  }: {
    visible: boolean;
    children?: React.ReactNode;
  }) => (visible ? <View {...props}>{children}</View> : null),
}));

jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ defaultCurrency: "USD" }),
}));

jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100 }),
}));

jest.mock("../../../hooks/useMenus", () => ({
  useBrandMenus: () => ({ data: mockMenus, isLoading: false, isError: false }),
  useUpsertMenu: () => ({ mutate: mockMutate, isPending: false }),
  useDeleteMenu: () => ({ mutate: mockMutate, isPending: false }),
  useReorderMenus: () => ({ mutate: mockMutate, isPending: false }),
  useUpsertMenuItem: () => ({ mutate: mockMutate, isPending: false }),
  useDeleteMenuItem: () => ({ mutate: mockMutate, isPending: false }),
  useReorderMenuItems: () => ({ mutate: mockMutate, isPending: false }),
}));

jest.mock("../MenuItemSheet", () => ({ MenuItemSheet: () => null }));
jest.mock("../VenueHubEmptyState", () => ({ VenueHubEmptyState: () => null }));

// Imports stay below mocks so both production surfaces use the doubles above.
// eslint-disable-next-line import/first
import { MenuCategorySheet } from "../MenuCategorySheet";
// eslint-disable-next-line import/first
import { serviceWindowSummary, validateServiceWindow } from "../menuDepth";
// eslint-disable-next-line import/first
import { VenueMenuModule } from "../VenueMenuModule";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act;
let tree: TestRenderer | undefined;
const originalPlatform = Object.getOwnPropertyDescriptor(Platform, "OS");

const setPlatform = (os: "ios" | "android" | "web"): void => {
  Object.defineProperty(Platform, "OS", { configurable: true, value: os });
};

const renderCategory = (category: Menu): void => {
  act(() => {
    tree = renderer.create(
      <MenuCategorySheet
        visible
        onClose={jest.fn()}
        category={category}
        onSave={mockSave}
        saving={false}
      />,
    );
  });
};

const byTestID = (testID: string): TestNode => {
  if (tree === undefined) throw new Error("Renderer missing");
  const nodes = tree.root.findAllByProps({ testID });
  const node = nodes[nodes.length - 1];
  if (node === undefined) throw new Error(`Node not found: ${testID}`);
  return node;
};

const call = (node: TestNode, prop: string, ...args: unknown[]): void => {
  const callback = node.props[prop];
  if (typeof callback !== "function")
    throw new Error(`${prop} is not callable`);
  act(() => (callback as (...values: unknown[]) => void)(...args));
};

const textOf = (node: TestNode): string => {
  const visit = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
    if (Array.isArray(value)) return value.map(visit).join("");
    return "";
  };
  return visit(node.props.children);
};

const pressableStyle = (node: TestNode): Record<string, unknown> => {
  const raw = node.props.style;
  const style =
    typeof raw === "function"
      ? (raw as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : raw;
  return StyleSheet.flatten(style as never) as Record<string, unknown>;
};

beforeEach(() => {
  mockMutate.mockReset();
  mockSave.mockReset();
  mockMenus = [];
  setPlatform("ios");
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (tree !== undefined) {
    act(() => tree?.unmount());
    tree = undefined;
  }
  if (originalPlatform !== undefined) {
    Object.defineProperty(Platform, "OS", originalPlatform);
  }
});

describe("#3565 adversarial service-window truth", () => {
  test("a one-sided window is never presented or saved as all day", () => {
    renderCategory(
      menu({
        id: "one-sided",
        name: "Broken draft",
        serviceWindowStart: "17:00",
        serviceWindowEnd: null,
      }),
    );

    expect(textOf(byTestID("menu-category-window-summary"))).toBe(
      "Finish setting the service window",
    );
    const error = byTestID("menu-category-window-error");
    expect(textOf(error)).toBe(
      "Set both a start and an end time, or leave both blank.",
    );
    expect(error.props).toMatchObject({
      accessibilityRole: "alert",
      accessibilityLiveRegion: "polite",
    });
    expect(byTestID("menu-category-save").props.disabled).toBe(true);
    expect(mockSave).not.toHaveBeenCalled();
  });

  test("Android dismissal is lossless and selection commits canonical time", () => {
    setPlatform("android");
    renderCategory(menu({ id: "breakfast", name: "Breakfast" }));

    const start = byTestID("menu-category-window-start");
    expect(pressableStyle(start).minHeight).toBe(48);
    call(start, "onPress");
    let picker = tree?.root.findByProps({
      testID: "menu-category-native-time-picker",
    });
    expect(picker?.props).toMatchObject({ mode: "time", display: "default" });
    expect(picker?.props.is24Hour).toBeUndefined();
    if (picker === undefined) throw new Error("Android picker missing");
    call(picker, "onChange", { type: "dismissed" });
    expect(
      tree?.root.findAllByProps({
        testID: "menu-category-native-time-picker",
      }),
    ).toHaveLength(0);
    expect(
      byTestID("menu-category-window-start").props.accessibilityLabel,
    ).toBe("Service start time, not set");

    call(byTestID("menu-category-window-start"), "onPress");
    picker = tree?.root.findByProps({
      testID: "menu-category-native-time-picker",
    });
    if (picker === undefined) throw new Error("Android picker missing");
    call(picker, "onChange", { type: "set" }, new Date(2026, 0, 1, 7, 5));
    expect(textOf(byTestID("menu-category-window-summary"))).toBe(
      "Finish setting the service window",
    );

    call(byTestID("menu-category-window-end"), "onPress");
    picker = tree?.root.findByProps({
      testID: "menu-category-native-time-picker",
    });
    if (picker === undefined) throw new Error("Android picker missing");
    call(picker, "onChange", { type: "set" }, new Date(2026, 0, 1, 11, 0));
    expect(textOf(byTestID("menu-category-window-summary"))).toBe(
      "07:05–11:00 · every day",
    );
    call(byTestID("menu-category-save"), "onPress");
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceWindowStart: "07:05",
        serviceWindowEnd: "11:00",
      }),
    );
  });

  test("all-day day subsets remain explicit and save the exact ISO days", () => {
    renderCategory(menu({ id: "lunch", name: "Lunch" }));
    for (const isoDay of [2, 4, 6, 7]) {
      call(byTestID(`menu-category-day-${isoDay}`), "onPress");
    }
    expect(textOf(byTestID("menu-category-window-summary"))).toBe(
      "Available all day on Mon, Wed, Fri",
    );
    call(byTestID("menu-category-save"), "onPress");
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceWindowStart: null,
        serviceWindowEnd: null,
        serviceDays: [1, 3, 5],
      }),
    );
  });

  test("cards tell all-day, selected-day, and overnight schedules in full", () => {
    mockMenus = [
      menu({ id: "all-day", name: "All day" }),
      menu({
        id: "weekdays",
        name: "Selected days",
        serviceDays: [1, 3, 5],
        sortOrder: 1,
      }),
      menu({
        id: "overnight",
        name: "Late night",
        serviceWindowStart: "21:00",
        serviceWindowEnd: "02:00",
        serviceDays: [5, 6, 7],
        sortOrder: 2,
      }),
    ];
    act(() => {
      tree = renderer.create(
        <VenueMenuModule brandId="brand-a" venueId="venue-a" />,
      );
    });

    for (const [id, expected] of [
      ["all-day", "Available all day, every day"],
      ["weekdays", "Available all day on Mon, Wed, Fri"],
      ["overnight", "21:00–02:00 (wraps past midnight) · Fri, Sat, Sun"],
    ] as const) {
      const schedule = byTestID(`venue-menu-category-schedule-${id}`);
      expect(textOf(schedule)).toBe(expected);
      expect(schedule.props.accessibilityLabel).toBe(`Schedule: ${expected}`);
      expect(schedule.props.numberOfLines).toBeUndefined();
    }
  });

  test("pure validation rejects malformed values without changing valid summaries", () => {
    expect(
      validateServiceWindow({ start: "17:xx", end: "22:00", days: null }),
    ).toBe("Start time must look like 07:00.");
    expect(
      validateServiceWindow({ start: "17:00", end: "22:99", days: null }),
    ).toBe("End time must look like 11:00.");
    expect(
      serviceWindowSummary({ start: "21:00", end: "02:00", days: [5, 6, 7] }),
    ).toBe("21:00–02:00 (wraps past midnight) · Fri, Sat, Sun");
  });
});
