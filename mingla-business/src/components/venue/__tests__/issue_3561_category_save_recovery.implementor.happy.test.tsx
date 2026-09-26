/**
 * #3561 implementor regression — category-save recovery.
 *
 * A rejected category write used to leave the open sheet with no explanation,
 * and an add retry carried no id, so a response lost after commit could create
 * a second row. This behavioral suite mounts the real VenueMenuModule and
 * MenuCategorySheet together. It proves both parent branches expose the same
 * in-sheet recovery and that an add retry reuses one logical category id.
 *
 * Fails-on-revert: reverting the #3561 product hunks removes the alert/retry
 * contract and the stable input id, so the assertions below fail.
 *
 * Run:
 *   npx jest src/components/venue/__tests__/issue_3561_category_save_recovery.implementor.happy.test.tsx --runInBand
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
import { Text, View } from "react-native";
import type { Menu } from "../../../services/menusService";

interface MutationCallbacks {
  onSuccess: () => void;
  onError: () => void;
}

interface TestNode {
  props: Record<string, unknown>;
  findAllByType: (type: unknown) => TestNode[];
  findByProps: (props: Record<string, unknown>) => TestNode;
  findAllByProps: (props: Record<string, unknown>) => TestNode[];
}

interface TestRenderer {
  root: TestNode;
  update: (node: React.ReactElement) => void;
  unmount: () => void;
}

interface RendererApi {
  create: (node: React.ReactElement) => TestRenderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
}

let mockMenus: Menu[] = [];
let mockPending = false;
const mockUpsertMutate =
  jest.fn<
    (input: Record<string, unknown>, callbacks: MutationCallbacks) => void
  >();
const mockIdleMutate = jest.fn();

jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ defaultCurrency: "USD" }),
}));

jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100 }),
}));

jest.mock("../../../hooks/useMenus", () => ({
  useBrandMenus: () => ({
    data: mockMenus,
    isLoading: false,
    isError: false,
  }),
  useUpsertMenu: () => ({
    mutate: mockUpsertMutate,
    isPending: mockPending,
  }),
  useDeleteMenu: () => ({ mutate: mockIdleMutate, isPending: false }),
  useReorderMenus: () => ({ mutate: mockIdleMutate, isPending: false }),
  useUpsertMenuItem: () => ({ mutate: mockIdleMutate, isPending: false }),
  useDeleteMenuItem: () => ({ mutate: mockIdleMutate, isPending: false }),
  useReorderMenuItems: () => ({ mutate: mockIdleMutate, isPending: false }),
}));

jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("MockButton", props),
}));

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
  }) => (visible ? React.createElement("MockSheet", props, children) : null),
}));

jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) => (
    <View>{children}</View>
  ),
}));

jest.mock("../MenuItemSheet", () => ({ MenuItemSheet: () => null }));

jest.mock("../VenueHubEmptyState", () => ({
  VenueHubEmptyState: (props: Record<string, unknown>) =>
    React.createElement(
      "MockEmptyState",
      props,
      typeof props.actionLabel === "string"
        ? React.createElement("MockButton", {
            label: props.actionLabel,
            onPress: props.onAction,
            testID: props.actionTestID,
          })
        : null,
    ),
}));

// Keep this import below the mocks so the real module binds to the test doubles.
// eslint-disable-next-line import/first
import { VenueMenuModule } from "../VenueMenuModule";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act;
let tree: TestRenderer;
let uuidSequence = 0;

const moduleNode = (): React.ReactElement => (
  <VenueMenuModule brandId="brand-a" venueId="venue-a" />
);

const button = (label: string): TestNode => {
  const found = tree.root
    .findAllByType("MockButton")
    .find((node) => node.props.label === label);
  if (found === undefined) throw new Error(`Button not found: ${label}`);
  return found;
};

const input = (testID: string): TestNode => tree.root.findByProps({ testID });

const call = (node: TestNode, propName: string, ...args: unknown[]): void => {
  const handler = node.props[propName];
  if (typeof handler !== "function") {
    throw new Error(`${propName} is not callable`);
  }
  (handler as (...values: unknown[]) => void)(...args);
};

const mutationCall = (
  index: number,
): {
  input: Record<string, unknown>;
  callbacks: MutationCallbacks;
} => {
  const callAtIndex = mockUpsertMutate.mock.calls[index];
  if (callAtIndex === undefined) throw new Error(`Mutation ${index} missing`);
  return { input: callAtIndex[0], callbacks: callAtIndex[1] };
};

const nodeText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(nodeText).join("");
  return "";
};

beforeEach(() => {
  mockMenus = [];
  mockPending = false;
  mockUpsertMutate.mockReset();
  mockIdleMutate.mockReset();
  uuidSequence = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID: () =>
        `35610000-0000-4000-8000-${String(++uuidSequence).padStart(12, "0")}`,
    },
  });
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => tree.unmount());
});

describe("#3561 category-save recovery", () => {
  test("empty menu keeps the full draft, announces failure, and retries one id", () => {
    act(() => {
      tree = renderer.create(moduleNode());
    });
    act(() => call(button("Add a category"), "onPress"));

    act(() => {
      call(input("menu-category-name"), "onChangeText", "Late plates");
      call(input("menu-category-desc"), "onChangeText", "Everything after ten");
      call(input("menu-category-window-start"), "onChangeText", "22:00");
      call(input("menu-category-window-end"), "onChangeText", "02:00");
      call(button("Sun"), "onPress");
    });

    act(() => call(button("Add category"), "onPress"));
    const first = mutationCall(0);
    expect(first.input).toMatchObject({
      name: "Late plates",
      description: "Everything after ten",
      serviceWindowStart: "22:00",
      serviceWindowEnd: "02:00",
      serviceDays: [1, 2, 3, 4, 5, 6],
    });
    expect(first.input.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    act(() => first.callbacks.onError());
    const alert = tree.root.findByProps({ testID: "menu-category-save-error" });
    expect(alert.props).toMatchObject({
      accessible: true,
      accessibilityRole: "alert",
      accessibilityLiveRegion: "assertive",
    });
    expect(
      tree.root
        .findAllByType(Text)
        .map((node) => nodeText(node.props.children)),
    ).toEqual(
      expect.arrayContaining([expect.stringContaining("Category not saved")]),
    );
    expect(input("menu-category-name").props.value).toBe("Late plates");
    expect(input("menu-category-desc").props.value).toBe(
      "Everything after ten",
    );
    expect(input("menu-category-window-start").props.value).toBe("22:00");
    expect(input("menu-category-window-end").props.value).toBe("02:00");
    expect(button("Sun").props.variant).toBe("secondary");
    expect(button("Try again").props.accessibilityLabel).toBe(
      "Try saving category again",
    );

    act(() => call(button("Try again"), "onPress"));
    const retry = mutationCall(1);
    expect(retry.input.id).toBe(first.input.id);
    expect(
      tree.root.findAllByProps({ testID: "menu-category-save-error" }),
    ).toHaveLength(0);

    act(() => retry.callbacks.onSuccess());
    expect(tree.root.findAllByType("MockSheet")).toHaveLength(0);
  });

  test("populated menu edit reports failure in-sheet and keeps the stored id", () => {
    mockMenus = [
      {
        id: "35610000-0000-4000-8000-000000000099",
        brandId: "brand-a",
        venueId: "venue-a",
        name: "Dinner",
        description: "Evening menu",
        sortOrder: 0,
        isActive: true,
        serviceWindowStart: "17:00",
        serviceWindowEnd: "23:00",
        serviceDays: [5, 6, 7],
        items: [],
      },
    ];
    act(() => {
      tree = renderer.create(moduleNode());
    });
    act(() =>
      call(
        tree.root.findByProps({
          testID:
            "venue-menu-category-edit-35610000-0000-4000-8000-000000000099",
        }),
        "onPress",
      ),
    );
    act(() => call(button("Save category"), "onPress"));
    const first = mutationCall(0);
    expect(first.input.id).toBe("35610000-0000-4000-8000-000000000099");

    act(() => first.callbacks.onError());
    expect(
      tree.root.findAllByProps({ testID: "menu-category-save-error" }),
    ).not.toHaveLength(0);
    expect(
      tree.root.findAllByProps({ testID: "venue-menu-error" }),
    ).toHaveLength(0);
    expect(button("Try again").props.accessibilityLabel).toBe(
      "Try saving category again",
    );
  });
});
