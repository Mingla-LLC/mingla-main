/**
 * #3562 implementor regression — readable menu-item identity.
 *
 * Populated menu rows used to force the dish name and description into the
 * sliver left after price, availability, reorder, and Edit controls. This
 * render-level suite proves the real builder gives identity its own width on
 * phones and under large text without removing any service control.
 *
 * Fails-on-revert: the unchanged product keeps one horizontal row, clamps the
 * name to one line, clamps the description to two, and exposes no responsive
 * identity/control test contract.
 *
 * Run:
 *   npx jest src/components/venue/__tests__/issue_3562_menu_item_identity.implementor.happy.test.tsx --runInBand
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
import { StyleSheet, Text, View } from "react-native";
import type { Menu } from "../../../services/menusService";

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
  act: (callback: () => void) => void;
}

let mockViewport = { width: 402, height: 874, scale: 3, fontScale: 1 };
const mockIdleMutate = jest.fn();

const mockMenus: Menu[] = [
  {
    id: "menu-a",
    brandId: "brand-a",
    venueId: "venue-a",
    name: "Dinner",
    description: "Evening menu",
    sortOrder: 0,
    isActive: true,
    serviceWindowStart: null,
    serviceWindowEnd: null,
    serviceDays: null,
    items: [
      {
        id: "item-a",
        menuId: "menu-a",
        brandId: "brand-a",
        name: "Charred Suya Cauliflower",
        description: "Peanut spice, lime, pickled onion.",
        priceCents: 1400,
        currency: "USD",
        isAvailable: true,
        sortOrder: 0,
        allowsNotes: true,
        prepStation: "kitchen",
        costCents: null,
      },
      {
        id: "item-b",
        menuId: "menu-a",
        brandId: "brand-a",
        name: "Plantain",
        description: null,
        priceCents: 800,
        currency: "USD",
        isAvailable: true,
        sortOrder: 1,
        allowsNotes: false,
        prepStation: null,
        costCents: null,
      },
    ],
  },
];

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as Record<string, unknown>;
  return {
    ...actual,
    useWindowDimensions: () => mockViewport,
  };
});

jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ defaultCurrency: "USD" }),
}));

jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100 }),
}));

jest.mock("../../../hooks/useMenus", () => ({
  useBrandMenus: () => ({ data: mockMenus, isLoading: false, isError: false }),
  useUpsertMenu: () => ({ mutate: mockIdleMutate, isPending: false }),
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

jest.mock("../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../MenuCategorySheet", () => ({ MenuCategorySheet: () => null }));
jest.mock("../MenuItemSheet", () => ({ MenuItemSheet: () => null }));
jest.mock("../VenueHubEmptyState", () => ({
  VenueHubEmptyState: () => null,
}));

// Keep this import below the mocks so the real module binds to test doubles.
// eslint-disable-next-line import/first
import { VenueMenuModule } from "../VenueMenuModule";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act;
let tree: TestRenderer | undefined;

const moduleNode = (): React.ReactElement => (
  <VenueMenuModule brandId="brand-a" venueId="venue-a" />
);

const nodeText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(nodeText).join("");
  return "";
};

const textNode = (copy: string): TestNode => {
  const node = tree?.root
    .findAllByType(Text)
    .find((candidate) => nodeText(candidate.props.children) === copy);
  if (node === undefined) throw new Error(`Text not found: ${copy}`);
  return node;
};

const resolvedStyle = (node: TestNode): Record<string, unknown> =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

const pressableStyle = (node: TestNode): Record<string, unknown> => {
  const style = node.props.style;
  const value =
    typeof style === "function"
      ? (style as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : style;
  return StyleSheet.flatten(value as never) as Record<string, unknown>;
};

const renderAt = (width: number, fontScale: number): void => {
  mockViewport = { width, height: 900, scale: 3, fontScale };
  act(() => {
    if (tree === undefined) tree = renderer.create(moduleNode());
    else tree.update(moduleNode());
  });
};

beforeEach(() => {
  mockIdleMutate.mockReset();
  mockViewport = { width: 402, height: 874, scale: 3, fontScale: 1 };
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (tree !== undefined) {
    act(() => tree?.unmount());
    tree = undefined;
  }
});

describe("#3562 readable menu-item identity", () => {
  test("phone gives the complete dish identity its own row above every control", () => {
    renderAt(402, 1);
    if (tree === undefined) throw new Error("Renderer missing");

    expect(
      resolvedStyle(
        tree.root.findByProps({ testID: "venue-menu-item-item-a" }),
      ),
    ).toMatchObject({ flexDirection: "column", alignItems: "stretch" });
    expect(
      resolvedStyle(
        tree.root.findByProps({
          testID: "venue-menu-item-identity-item-a",
        }),
      ),
    ).toMatchObject({ width: "100%" });
    expect(
      resolvedStyle(
        tree.root.findByProps({
          testID: "venue-menu-item-controls-item-a",
        }),
      ),
    ).toMatchObject({
      width: "100%",
      alignSelf: "stretch",
      justifyContent: "space-between",
      flexWrap: "wrap",
    });

    expect(
      textNode("Charred Suya Cauliflower").props.numberOfLines,
    ).toBeUndefined();
    expect(textNode("Peanut spice, lime, pickled onion.").props).toMatchObject({
      numberOfLines: 3,
      ellipsizeMode: "tail",
    });
    expect(textNode("$14.00")).toBeDefined();

    const toggle = tree.root.findByProps({
      testID: "venue-menu-item-86-item-a",
    });
    expect(toggle.props).toMatchObject({
      accessibilityRole: "switch",
      accessibilityState: { checked: true },
      accessibilityLabel:
        "Charred Suya Cauliflower is on the menu. Tap to take it off.",
    });
    expect(pressableStyle(toggle).minHeight).toBe(44);

    for (const [testID, label] of [
      ["venue-menu-item-up-item-a", "Move Charred Suya Cauliflower up"],
      ["venue-menu-item-down-item-a", "Move Charred Suya Cauliflower down"],
      ["venue-menu-item-edit-item-a", "Edit Charred Suya Cauliflower"],
    ] as const) {
      const control = tree.root
        .findAllByProps({ testID })
        .find((candidate) => candidate.props.accessibilityLabel === label);
      if (control === undefined) {
        throw new Error(`Accessible control not found: ${testID}`);
      }
      expect(control.props.accessibilityLabel).toBe(label);
      const style = pressableStyle(control);
      expect(style.minWidth ?? style.width).toBe(44);
      expect(style.minHeight ?? style.height).toBe(44);
    }
  });

  test("wide normal text stays horizontal while large text stacks", () => {
    renderAt(1024, 1);
    if (tree === undefined) throw new Error("Renderer missing");
    expect(
      resolvedStyle(
        tree.root.findByProps({ testID: "venue-menu-item-item-a" }),
      ),
    ).toMatchObject({ flexDirection: "row", alignItems: "center" });

    renderAt(1024, 1.5);
    expect(
      resolvedStyle(
        tree.root.findByProps({ testID: "venue-menu-item-item-a" }),
      ),
    ).toMatchObject({ flexDirection: "column", alignItems: "stretch" });
    expect(
      textNode("Charred Suya Cauliflower").props.numberOfLines,
    ).toBeUndefined();
  });
});
