/**
 * #3565 implementor guard — platform time controls + visible saved schedule.
 *
 * Fails on product revert because the category sheet returns to plain Input
 * fields and the populated category card loses its service-window summary.
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
import { Platform, Pressable, View } from "react-native";
import type { Menu } from "../../../services/menusService";

interface TestNode {
  type: unknown;
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

const savedMenu: Menu = {
  id: "menu-evening",
  brandId: "brand-a",
  venueId: "venue-a",
  name: "Evening Plates",
  description: "Dinner and late-night dishes",
  sortOrder: 0,
  isActive: true,
  serviceWindowStart: "17:00",
  serviceWindowEnd: "22:30",
  serviceDays: null,
  items: [],
};

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
  useBrandMenus: () => ({
    data: [savedMenu],
    isLoading: false,
    isError: false,
  }),
  useUpsertMenu: () => ({ mutate: mockMutate, isPending: false }),
  useDeleteMenu: () => ({ mutate: mockMutate, isPending: false }),
  useReorderMenus: () => ({ mutate: mockMutate, isPending: false }),
  useUpsertMenuItem: () => ({ mutate: mockMutate, isPending: false }),
  useDeleteMenuItem: () => ({ mutate: mockMutate, isPending: false }),
  useReorderMenuItems: () => ({ mutate: mockMutate, isPending: false }),
}));

jest.mock("../MenuItemSheet", () => ({ MenuItemSheet: () => null }));
jest.mock("../VenueHubEmptyState", () => ({ VenueHubEmptyState: () => null }));

// Imports stay below mocks so the production modules bind to the test doubles.
// eslint-disable-next-line import/first
import { MenuCategorySheet } from "../MenuCategorySheet";
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

const renderCategory = (category: Menu | null = null): void => {
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
  const candidates = tree.root.findAllByProps({ testID });
  const node = candidates[candidates.length - 1];
  if (node === undefined) throw new Error(`Node not found: ${testID}`);
  return node;
};

const call = (node: TestNode, prop: string, ...args: unknown[]): void => {
  const callback = node.props[prop];
  if (typeof callback !== "function")
    throw new Error(`${prop} is not callable`);
  act(() => (callback as (...values: unknown[]) => void)(...args));
};

const copy = (node: TestNode): string => {
  const visit = (value: unknown): string => {
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
    if (Array.isArray(value)) return value.map(visit).join("");
    return "";
  };
  return visit(node.props.children);
};

beforeEach(() => {
  mockMutate.mockReset();
  mockSave.mockReset();
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

describe("#3565 menu service times", () => {
  test("iOS uses locale-aware time pickers and saves canonical HH:MM", () => {
    renderCategory();
    if (tree === undefined) throw new Error("Renderer missing");

    const name = tree.root.findByProps({ testID: "menu-category-name" });
    call(name, "onChangeText", "Evening Plates");

    const start = byTestID("menu-category-window-start");
    expect(start.props).toMatchObject({
      accessibilityRole: "button",
      accessibilityLabel: "Service start time, not set",
      accessibilityHint: "Opens the time picker",
    });
    call(start, "onPress");

    let picker = tree.root.findByProps({
      testID: "menu-category-native-time-picker",
    });
    expect(picker.props).toMatchObject({ mode: "time", display: "spinner" });
    expect(picker.props.is24Hour).toBeUndefined();
    call(picker, "onChange", { type: "set" }, new Date(2026, 0, 1, 17, 0));
    call(byTestID("menu-category-time-picker-done"), "onPress");

    call(byTestID("menu-category-window-end"), "onPress");
    picker = tree.root.findByProps({
      testID: "menu-category-native-time-picker",
    });
    call(picker, "onChange", { type: "set" }, new Date(2026, 0, 1, 22, 30));
    call(byTestID("menu-category-time-picker-done"), "onPress");

    expect(copy(byTestID("menu-category-window-summary"))).toBe(
      "17:00–22:30 · every day",
    );
    const save = byTestID("menu-category-save");
    expect(save.props.disabled).toBe(false);
    call(save, "onPress");
    expect(mockSave).toHaveBeenCalledWith({
      name: "Evening Plates",
      description: null,
      serviceWindowStart: "17:00",
      serviceWindowEnd: "22:30",
      serviceDays: null,
    });
  });

  test("web renders visible native time inputs and clear returns to all day", () => {
    setPlatform("web");
    renderCategory(savedMenu);
    if (tree === undefined) throw new Error("Renderer missing");

    const start = tree.root.findByProps({
      "data-testid": "menu-category-window-start",
    });
    const end = tree.root.findByProps({
      "data-testid": "menu-category-window-end",
    });
    expect(start.props).toMatchObject({
      type: "time",
      value: "17:00",
      "aria-label": "Service start time",
    });
    expect(end.props).toMatchObject({ type: "time", value: "22:30" });
    expect(tree.root.findAllByType("NativeDateTimePicker")).toHaveLength(0);

    call(byTestID("menu-category-window-clear"), "onPress");
    expect(copy(byTestID("menu-category-window-summary"))).toBe(
      "Available all day, every day",
    );
    call(byTestID("menu-category-save"), "onPress");
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceWindowStart: null,
        serviceWindowEnd: null,
        serviceDays: null,
      }),
    );
  });

  test("the populated card exposes the saved schedule without truncation", () => {
    setPlatform("ios");
    act(() => {
      tree = renderer.create(
        <VenueMenuModule brandId="brand-a" venueId="venue-a" />,
      );
    });

    const schedule = byTestID("venue-menu-category-schedule-menu-evening");
    expect(copy(schedule)).toBe("17:00–22:30 · every day");
    expect(schedule.props).toMatchObject({
      accessibilityLabel: "Schedule: 17:00–22:30 · every day",
    });
    expect(schedule.props.numberOfLines).toBeUndefined();

    const edit = tree?.root
      .findAllByProps({ testID: "venue-menu-category-edit-menu-evening" })
      .find(
        (node) => node.type === Pressable || node.props.onPress !== undefined,
      );
    expect(edit).toBeDefined();
  });
});
