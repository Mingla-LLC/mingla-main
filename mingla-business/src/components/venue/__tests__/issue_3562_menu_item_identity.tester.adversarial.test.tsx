/**
 * #3562 independent tester guard — adversarial menu-item layout boundaries.
 *
 * This suite was authored after the implementation review. It challenges the
 * responsive threshold, unknown width, large text on a wide surface, a much
 * longer dish identity, price-on-request, and the unavailable state.
 *
 * Fails-on-revert: the baseline product exposes none of the responsive item
 * nodes, still clamps the name to one line, and cannot satisfy these proofs.
 *
 * Run:
 *   npx jest src/components/venue/__tests__/issue_3562_menu_item_identity.tester.adversarial.test.tsx --runInBand
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

interface RenderNode {
  props: Record<string, unknown>;
  findAllByProps: (props: Record<string, unknown>) => RenderNode[];
  findAllByType: (type: unknown) => RenderNode[];
  findByProps: (props: Record<string, unknown>) => RenderNode;
}

interface RenderTree {
  root: RenderNode;
  update: (node: React.ReactElement) => void;
  unmount: () => void;
}

interface RenderApi {
  create: (node: React.ReactElement) => RenderTree;
  act: (callback: () => void) => void;
}

const LONG_DISH_NAME =
  "Whole Roasted Heritage Cauliflower with Smoked Groundnut Suya and Pickled Shallots";
const LONG_DESCRIPTION =
  "Finished with fermented lime, crisp herbs, toasted sesame, and a slow chilli glaze.";

let mockDimensions = { width: 375, height: 667, scale: 2, fontScale: 1 };
const mockMutate = jest.fn();

const menuFixture: Menu[] = [
  {
    id: "menu-adversarial",
    brandId: "brand-a",
    venueId: "venue-a",
    name: "Late menu",
    description: null,
    sortOrder: 0,
    isActive: true,
    serviceWindowStart: "22:00",
    serviceWindowEnd: "02:00",
    serviceDays: [5, 6, 7],
    items: [
      {
        id: "long-item",
        menuId: "menu-adversarial",
        brandId: "brand-a",
        name: LONG_DISH_NAME,
        description: LONG_DESCRIPTION,
        priceCents: null,
        currency: "USD",
        isAvailable: false,
        sortOrder: 0,
        allowsNotes: false,
        prepStation: "kitchen",
        costCents: null,
      },
    ],
  },
];

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as Record<string, unknown>;
  return { ...actual, useWindowDimensions: () => mockDimensions };
});

jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ defaultCurrency: "USD" }),
}));
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100 }),
}));
jest.mock("../../../hooks/useMenus", () => ({
  useBrandMenus: () => ({
    data: menuFixture,
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
jest.mock("../VenueHubEmptyState", () => ({ VenueHubEmptyState: () => null }));

// eslint-disable-next-line import/first
import { VenueMenuModule } from "../VenueMenuModule";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderApi = require("react-test-renderer") as RenderApi;
const act = renderApi.act;
let tree: RenderTree | undefined;

const component = (): React.ReactElement => (
  <VenueMenuModule brandId="brand-a" venueId="venue-a" />
);

const flatten = (node: RenderNode): Record<string, unknown> =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

const flattenPressable = (node: RenderNode): Record<string, unknown> => {
  const style = node.props.style;
  const resolved =
    typeof style === "function"
      ? (style as (state: { pressed: boolean }) => unknown)({ pressed: false })
      : style;
  return StyleSheet.flatten(resolved as never) as Record<string, unknown>;
};

const renderAt = (width: number, fontScale: number): RenderTree => {
  mockDimensions = { width, height: 900, scale: 3, fontScale };
  act(() => {
    if (tree === undefined) tree = renderApi.create(component());
    else tree.update(component());
  });
  if (tree === undefined) throw new Error("Renderer missing");
  return tree;
};

const textValue = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return Array.isArray(value) ? value.map(textValue).join("") : "";
};

const exactText = (copy: string): RenderNode => {
  const found = tree?.root
    .findAllByType(Text)
    .find((node) => textValue(node.props.children) === copy);
  if (found === undefined) throw new Error(`Text missing: ${copy}`);
  return found;
};

const nativeControl = (testID: string, label: string): RenderNode => {
  const found = tree?.root
    .findAllByProps({ testID })
    .find((node) => node.props.accessibilityLabel === label);
  if (found === undefined) throw new Error(`Control missing: ${testID}`);
  return found;
};

beforeEach(() => {
  mockMutate.mockReset();
  mockDimensions = { width: 375, height: 667, scale: 2, fontScale: 1 };
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

describe("#3562 adversarial responsive identity", () => {
  test("compact unavailable price-on-request row preserves full truth and targets", () => {
    const rendered = renderAt(375, 1);
    const row = rendered.root.findByProps({
      testID: "venue-menu-item-long-item",
    });
    expect(flatten(row)).toMatchObject({
      flexDirection: "column",
      alignItems: "stretch",
      opacity: 0.5,
    });
    expect(row.props.accessibilityLabel).toBe(
      `${LONG_DISH_NAME}, price on request, hidden`,
    );
    expect(
      flatten(
        rendered.root.findByProps({
          testID: "venue-menu-item-identity-long-item",
        }),
      ),
    ).toMatchObject({ width: "100%" });
    expect(
      flatten(
        rendered.root.findByProps({
          testID: "venue-menu-item-controls-long-item",
        }),
      ),
    ).toMatchObject({
      width: "100%",
      alignSelf: "stretch",
      justifyContent: "space-between",
      flexWrap: "wrap",
    });

    expect(exactText(LONG_DISH_NAME).props.numberOfLines).toBeUndefined();
    expect(exactText(LONG_DESCRIPTION).props).toMatchObject({
      numberOfLines: 3,
      ellipsizeMode: "tail",
    });
    expect(exactText("Price on request")).toBeDefined();

    const toggle = nativeControl(
      "venue-menu-item-86-long-item",
      `${LONG_DISH_NAME} is off the menu. Tap to put it back.`,
    );
    expect(toggle.props).toMatchObject({
      accessibilityRole: "switch",
      accessibilityState: { checked: false },
      hitSlop: 12,
    });
    expect(flattenPressable(toggle).minHeight).toBe(44);

    for (const [testID, label] of [
      ["venue-menu-item-up-long-item", `Move ${LONG_DISH_NAME} up`],
      ["venue-menu-item-down-long-item", `Move ${LONG_DISH_NAME} down`],
      ["venue-menu-item-edit-long-item", `Edit ${LONG_DISH_NAME}`],
    ] as const) {
      const control = nativeControl(testID, label);
      const style = flattenPressable(control);
      expect(style.minWidth ?? style.width).toBe(44);
      expect(style.minHeight ?? style.height).toBe(44);
    }
  });

  test.each([
    [0, 1, "unknown width"],
    [719, 1, "last narrow point"],
    [1440, 1.3, "wide large text"],
  ])("%s at font scale %s stacks (%s)", (width, fontScale) => {
    const rendered = renderAt(width, fontScale);
    expect(
      flatten(
        rendered.root.findByProps({ testID: "venue-menu-item-long-item" }),
      ),
    ).toMatchObject({ flexDirection: "column", alignItems: "stretch" });
  });

  test("720-point normal text is the first regular layout", () => {
    const rendered = renderAt(720, 1);
    expect(
      flatten(
        rendered.root.findByProps({ testID: "venue-menu-item-long-item" }),
      ),
    ).toMatchObject({ flexDirection: "row", alignItems: "center" });
    expect(exactText(LONG_DISH_NAME).props.numberOfLines).toBeUndefined();
  });
});
