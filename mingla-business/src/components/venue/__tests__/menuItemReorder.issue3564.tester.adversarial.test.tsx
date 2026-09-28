import fs from "node:fs";
import path from "node:path";
import React from "react";
import { Text, View } from "react-native";

import type { Menu } from "../../../services/menusService";
import { MenuItemReorderError } from "../../../hooks/menuItemReorder";

interface TestNode {
  props: Record<string, unknown>;
  findAllByType: (type: unknown) => TestNode[];
  findByProps: (props: Record<string, unknown>) => TestNode;
  findAllByProps: (props: Record<string, unknown>) => TestNode[];
  findAll: (predicate: (node: TestNode) => boolean) => TestNode[];
}

interface TestRenderer {
  root: TestNode;
  unmount: () => void;
  update: (node: React.ReactElement) => void;
}

interface RendererApi {
  create: (
    node: React.ReactElement,
    options?: { createNodeMock?: (element: React.ReactElement) => unknown },
  ) => TestRenderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
}

const mockIdleMutate = jest.fn();
const mockCategoryMutate = jest.fn();
const mockItemMutate = jest.fn();
const mockAnnounce = jest.fn();
const mockRefetch = jest.fn();
const mockFocus = new Map<string, jest.Mock>();
let mockMenus: Menu[] = [];
let mockNetwork = { isConnected: true, isInternetReachable: true };
let mockAppState = "active";
let appStateListener: ((state: string) => void) | undefined;
let operation = 0;

const menuItem = (id: string, menuId: string, sortOrder: number) => ({
  id,
  menuId,
  brandId: "brand-a",
  name: `${id.toUpperCase()} extremely descriptive item name`,
  description: `${id} description that must wrap instead of forcing controls off screen`,
  priceCents: 100 + sortOrder,
  currency: "USD",
  isAvailable: true,
  sortOrder,
  allowsNotes: false,
  prepStation: null,
  costCents: null,
});

const makeMenu = (id: string, ids: string[], sortOrder: number): Menu => ({
  id,
  brandId: "brand-a",
  venueId: "venue-a",
  name: `${id} category`,
  description: `${id} category description`,
  sortOrder,
  isActive: true,
  serviceWindowStart: null,
  serviceWindowEnd: null,
  serviceDays: null,
  items: ids.map((itemId, index) => menuItem(itemId, id, index)),
});

const boundaryMenus = (): Menu[] => [
  makeMenu("one", ["one-a"], 0),
  makeMenu("two", ["two-a", "two-b"], 1),
  makeMenu("three", ["three-a", "three-b", "three-c"], 2),
  makeMenu("four", ["four-a", "four-b", "four-c", "four-d"], 3),
];

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as Record<string, unknown>;
  return {
    ...actual,
    AccessibilityInfo: {
      ...(actual.AccessibilityInfo as Record<string, unknown>),
      announceForAccessibility: (...args: unknown[]) => mockAnnounce(...args),
    },
    AppState: {
      get currentState() {
        return mockAppState;
      },
      addEventListener: (_event: string, listener: (state: string) => void) => {
        appStateListener = listener;
        return {
          remove: () => {
            if (appStateListener === listener) appStateListener = undefined;
          },
        };
      },
    },
    Platform: {
      ...(actual.Platform as Record<string, unknown>),
      OS: "web",
    },
    useWindowDimensions: () => ({
      width: 360,
      height: 760,
      scale: 3,
      fontScale: 1.4,
    }),
  };
});

jest.mock("../../../utils/randomId", () => ({
  randomId: () => `tester-operation-${++operation}`,
}));

jest.mock("../../../lib/netinfoSafe", () => ({
  useNetInfoSafe: () => mockNetwork,
}));

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
    refetch: mockRefetch,
  }),
  useUpsertMenu: () => ({ mutate: mockIdleMutate, isPending: false }),
  useDeleteMenu: () => ({ mutate: mockIdleMutate, isPending: false }),
  useReorderMenus: () => ({ mutate: mockCategoryMutate, isPending: false }),
  useUpsertMenuItem: () => ({ mutate: mockIdleMutate, isPending: false }),
  useDeleteMenuItem: () => ({ mutate: mockIdleMutate, isPending: false }),
  useReorderMenuItems: () => ({ mutate: mockItemMutate, isPending: false }),
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

// Import after mocks so every external boundary remains controlled.
// eslint-disable-next-line import/first
import { VenueMenuModule } from "../VenueMenuModule";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act;
let tree: TestRenderer | undefined;

const node = (brandId = "brand-a", venueId = "venue-a") => (
  <VenueMenuModule brandId={brandId} venueId={venueId} />
);

const renderModule = (): void => {
  act(() => {
    tree = renderer.create(node(), {
      createNodeMock: (element) => {
        const testID = (element.props as Record<string, unknown>).testID as
          | string
          | undefined;
        if (testID?.startsWith("venue-menu-item-") === true) {
          const focus = jest.fn();
          mockFocus.set(testID, focus);
          return { focus };
        }
        return {};
      },
    });
  });
};

const rerender = (brandId = "brand-a", venueId = "venue-a"): void => {
  act(() => tree?.update(node(brandId, venueId)));
};

const byTestID = (testID: string): TestNode => {
  if (tree === undefined) throw new Error("renderer missing");
  return tree.root.findByProps({ testID });
};

const press = (testID: string): void => {
  const callback = byTestID(testID).props.onPress;
  if (typeof callback !== "function") throw new Error(`${testID} is not pressable`);
  act(() => (callback as () => void)());
};

const pressAsync = async (testID: string): Promise<void> => {
  const callback = byTestID(testID).props.onPress;
  if (typeof callback !== "function") throw new Error(`${testID} is not pressable`);
  await act(async () => {
    await (callback as () => void | Promise<void>)();
  });
};

const textValue = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textValue).join("");
  return "";
};

const textExists = (copy: string): boolean =>
  tree?.root
    .findAllByType(Text)
    .some((entry) => textValue(entry.props.children) === copy) ?? false;

const flattenStyle = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (result, entry) => Object.assign(result, flattenStyle(entry)),
      {},
    );
  }
  return style !== null && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
};

beforeEach(() => {
  jest.useFakeTimers();
  mockMenus = boundaryMenus();
  mockNetwork = { isConnected: true, isInternetReachable: true };
  mockAppState = "active";
  appStateListener = undefined;
  operation = 0;
  mockIdleMutate.mockReset();
  mockCategoryMutate.mockReset();
  mockItemMutate.mockReset();
  mockAnnounce.mockReset();
  mockRefetch.mockReset();
  mockRefetch.mockImplementation(async () => ({
    data: mockMenus,
    isError: false,
    error: null,
  }));
  mockFocus.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

afterEach(() => {
  if (tree !== undefined) {
    act(() => tree?.unmount());
    tree = undefined;
  }
  jest.useRealTimers();
});

describe("#3564 independent menu-item UI adversarial proof", () => {
  test("one/two/three/four boundaries expose exact labels, hints, reading order, wrapping, and 44pt targets", () => {
    renderModule();

    expect(byTestID("venue-menu-item-up-one-a").props.disabled).toBe(true);
    expect(byTestID("venue-menu-item-down-one-a").props.disabled).toBe(true);
    expect(byTestID("venue-menu-item-up-two-a").props.disabled).toBe(true);
    expect(byTestID("venue-menu-item-down-two-a").props.disabled).toBe(false);
    expect(byTestID("venue-menu-item-up-three-b").props.disabled).toBe(false);
    expect(byTestID("venue-menu-item-down-three-b").props.disabled).toBe(false);
    expect(byTestID("venue-menu-item-up-four-d").props.disabled).toBe(false);
    expect(byTestID("venue-menu-item-down-four-d").props.disabled).toBe(true);

    const middle = tree?.root
      .findAllByProps({ testID: "venue-menu-item-down-four-b" })
      .find((entry) => entry.props.accessibilityValue !== undefined);
    expect(middle?.props).toMatchObject({
      accessibilityLabel:
        "Move FOUR-B extremely descriptive item name down, position 2 of 4",
      accessibilityHint: "Moves after FOUR-C extremely descriptive item name",
      accessibilityValue: { text: "Position 2 of 4" },
      accessibilityRole: "button",
      accessibilityState: { disabled: false, busy: false },
    });
    const styleFactory = middle?.props.style;
    if (typeof styleFactory !== "function") throw new Error("arrow style missing");
    expect(flattenStyle((styleFactory as (state: { pressed: boolean }) => unknown)({ pressed: false })))
      .toMatchObject({ width: 44, height: 44 });

    expect(flattenStyle(byTestID("venue-menu-item-four-b").props.style)).toMatchObject({
      flexDirection: "column",
      alignItems: "stretch",
    });
    expect(
      flattenStyle(byTestID("venue-menu-item-controls-four-b").props.style),
    ).toMatchObject({
      width: "100%",
      flexWrap: "wrap",
    });
    const readingOrder = Array.from(
      new Set(
        tree?.root
          .findAll(
            (entry) =>
              typeof entry.props.testID === "string" &&
              (entry.props.testID as string).startsWith(
                "venue-menu-item-identity-four-",
              ),
          )
          .map((entry) => entry.props.testID),
      ),
    );
    expect(readingOrder).toEqual([
      "venue-menu-item-identity-four-a",
      "venue-menu-item-identity-four-b",
      "venue-menu-item-identity-four-c",
      "venue-menu-item-identity-four-d",
    ]);
  });

  test("rapid item activation is synchronously locked while #3567 category reorder stays isolated", () => {
    renderModule();
    const handler = byTestID("venue-menu-item-down-four-b").props.onPress;
    if (typeof handler !== "function") throw new Error("item handler missing");

    act(() => {
      (handler as () => void)();
      (handler as () => void)();
      (handler as () => void)();
    });

    expect(mockItemMutate).toHaveBeenCalledTimes(1);
    expect(mockItemMutate.mock.calls[0]?.[0]).toMatchObject({
      menuId: "four",
      movedItemId: "four-b",
      anchorItemId: "four-c",
      expectedItems: [
        { id: "four-a", sortOrder: 0 },
        { id: "four-b", sortOrder: 1 },
        { id: "four-c", sortOrder: 2 },
        { id: "four-d", sortOrder: 3 },
      ],
      orderedItemIds: ["four-a", "four-c", "four-b", "four-d"],
    });
    expect(byTestID("venue-menu-item-list-four").props.accessibilityState).toEqual({
      busy: true,
    });
    expect(byTestID("venue-menu-item-list-three").props.accessibilityState).toEqual({
      busy: false,
    });
    expect(byTestID("venue-menu-category-down-two").props.disabled).toBe(false);
    press("venue-menu-category-down-two");
    expect(mockCategoryMutate).toHaveBeenCalledWith(
      [
        { id: "two", sortOrder: 2 },
        { id: "three", sortOrder: 1 },
      ],
      expect.any(Object),
    );
    expect(mockItemMutate).toHaveBeenCalledTimes(1);
  });

  test.each([
    [
      new MenuItemReorderError("permission", "42501"),
      "You can’t reorder this menu with this account. The previous order is back.",
      false,
    ],
    [
      new MenuItemReorderError("generic", "P0001", true),
      "Couldn’t save the new order. The previous order is back.",
      true,
    ],
  ])("safe error copy restores focus and announces once", (error, copy, retryable) => {
    renderModule();
    press("venue-menu-item-down-four-b");
    const callbacks = mockItemMutate.mock.calls[0]?.[1] as {
      onError: (failure: MenuItemReorderError) => void;
    };
    error.retryable = retryable;

    act(() => callbacks.onError(error));
    act(() => jest.advanceTimersByTime(0));

    expect(textExists(copy)).toBe(true);
    expect(textExists("P0001")).toBe(false);
    expect(textExists("42501")).toBe(false);
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).toHaveBeenCalledWith(copy);
    expect(mockFocus.get("venue-menu-item-down-four-b")).toHaveBeenCalledTimes(1);
    expect(
      byTestID("venue-menu-item-reorder-feedback-four-b").props
        .accessibilityLiveRegion,
    ).toBe("none");
    rerender();
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    if (retryable) {
      const retry = byTestID("venue-menu-item-reorder-retry-four-b");
      const styleFactory = retry.props.style;
      if (typeof styleFactory !== "function") throw new Error("retry style missing");
      expect(
        flattenStyle(
          (styleFactory as (state: { pressed: boolean }) => unknown)({ pressed: false }),
        ),
      ).toMatchObject({ minHeight: 44, minWidth: 88 });
    }
  });

  test("retry refetches latest truth and missing anchor becomes an honest non-retryable result", async () => {
    renderModule();
    press("venue-menu-item-down-four-b");
    const callbacks = mockItemMutate.mock.calls[0]?.[1] as {
      onError: (failure: MenuItemReorderError) => void;
    };
    act(() => callbacks.onError(new MenuItemReorderError("conflict", "40001", true)));
    mockMenus = boundaryMenus().map((candidate) =>
      candidate.id === "four"
        ? {
            ...candidate,
            items: [
              menuItem("inserted", "four", 0),
              { ...candidate.items[0]!, sortOrder: 1 },
              { ...candidate.items[1]!, sortOrder: 2 },
              { ...candidate.items[3]!, sortOrder: 3 },
            ],
          }
        : candidate,
    );

    await pressAsync("venue-menu-item-reorder-retry-four-b");

    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockItemMutate).toHaveBeenCalledTimes(1);
    expect(
      textExists(
        "This menu changed elsewhere. We loaded the latest order. Review the list and choose a new move.",
      ),
    ).toBe(true);
    expect(
      tree?.root.findAllByProps({
        testID: "venue-menu-item-reorder-retry-four-b",
      }),
    ).toHaveLength(0);
  });

  test("offline retry waits for online truth, then rebuilds the same intent against the new list", async () => {
    renderModule();
    press("venue-menu-item-down-two-a");
    const callbacks = mockItemMutate.mock.calls[0]?.[1] as {
      onError: (failure: MenuItemReorderError) => void;
    };
    mockNetwork = { isConnected: false, isInternetReachable: false };
    rerender();
    act(() => callbacks.onError(new MenuItemReorderError("uncertain", "timeout", true)));

    expect(
      textExists("You’re offline. The previous order is back. Reconnect, then try again."),
    ).toBe(true);
    expect(byTestID("venue-menu-item-reorder-retry-two-a").props.disabled).toBe(true);
    await pressAsync("venue-menu-item-reorder-retry-two-a");
    expect(mockRefetch).not.toHaveBeenCalled();

    mockNetwork = { isConnected: true, isInternetReachable: true };
    mockMenus = boundaryMenus().map((candidate) =>
      candidate.id === "two"
        ? {
            ...candidate,
            items: [
              menuItem("remote", "two", 0),
              { ...candidate.items[0]!, sortOrder: 1 },
              { ...candidate.items[1]!, sortOrder: 2 },
            ],
          }
        : candidate,
    );
    rerender();
    await pressAsync("venue-menu-item-reorder-retry-two-a");

    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockItemMutate).toHaveBeenCalledTimes(2);
    expect(mockItemMutate.mock.calls[1]?.[0]).toMatchObject({
      movedItemId: "two-a",
      anchorItemId: "two-b",
      expectedItems: [
        { id: "remote", sortOrder: 0 },
        { id: "two-a", sortOrder: 1 },
        { id: "two-b", sortOrder: 2 },
      ],
      orderedItemIds: ["remote", "two-b", "two-a"],
    });
  });

  test("AppState resume confirms before announcing; failed confirmation stays retryable", async () => {
    renderModule();
    press("venue-menu-item-down-two-a");
    const callbacks = mockItemMutate.mock.calls[0]?.[1] as { onSuccess: () => void };
    act(() => {
      mockAppState = "background";
      appStateListener?.("background");
      callbacks.onSuccess();
    });
    expect(textExists("Saving new position…")).toBe(true);
    expect(mockAnnounce).not.toHaveBeenCalled();
    mockRefetch.mockResolvedValueOnce({
      data: undefined,
      isError: true,
      error: new Error("resume timeout"),
    });

    await act(async () => {
      mockAppState = "active";
      appStateListener?.("active");
      await Promise.resolve();
      await Promise.resolve();
    });

    const copy = "We couldn’t confirm the new order. The previous order is back.";
    expect(textExists(copy)).toBe(true);
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).toHaveBeenCalledWith(copy);
    expect(byTestID("venue-menu-item-reorder-retry-two-a").props.disabled).toBe(false);
  });

  test("scope change and unmount suppress stale callbacks, focus, and announcements", () => {
    renderModule();
    press("venue-menu-item-down-three-b");
    const stale = mockItemMutate.mock.calls[0]?.[1] as {
      onSuccess: () => void;
      onError: (failure: MenuItemReorderError) => void;
    };
    rerender("brand-b", "venue-b");
    act(() => stale.onError(new MenuItemReorderError("permission", "42501")));
    act(() => stale.onSuccess());
    act(() => jest.advanceTimersByTime(0));
    expect(mockAnnounce).not.toHaveBeenCalled();
    expect(textExists("Order saved.")).toBe(false);
    expect(textExists("Couldn’t save the new order. The previous order is back.")).toBe(
      false,
    );

    rerender();
    press("venue-menu-item-down-three-b");
    const unmounted = mockItemMutate.mock.calls[1]?.[1] as {
      onSuccess: () => void;
      onError: (failure: MenuItemReorderError) => void;
    };
    act(() => tree?.unmount());
    tree = undefined;
    act(() => unmounted.onError(new MenuItemReorderError("permission", "42501")));
    act(() => unmounted.onSuccess());
    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  test("success and later authoritative reconciliation each announce exactly once", () => {
    renderModule();
    press("venue-menu-item-down-two-a");
    const callbacks = mockItemMutate.mock.calls[0]?.[1] as { onSuccess: () => void };
    mockMenus = boundaryMenus().map((candidate) =>
      candidate.id === "two"
        ? {
            ...candidate,
            items: [
              { ...candidate.items[1]!, sortOrder: 0 },
              { ...candidate.items[0]!, sortOrder: 1 },
            ],
          }
        : candidate,
    );
    rerender();
    act(() => callbacks.onSuccess());
    expect(mockAnnounce).toHaveBeenCalledWith(
      "TWO-A extremely descriptive item name moved to position 2 of 2. Order saved.",
    );
    expect(mockAnnounce).toHaveBeenCalledTimes(1);

    mockMenus = boundaryMenus();
    rerender();
    rerender();
    expect(mockAnnounce).toHaveBeenLastCalledWith(
      "Menu order changed elsewhere. Showing the latest order.",
    );
    expect(mockAnnounce).toHaveBeenCalledTimes(2);
  });

  test("source retains narrow-screen and Android error recovery styling", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../VenueMenuModule.tsx"),
      "utf8",
    );
    expect(source).toContain("width < STACKED_ITEM_ROW_WIDTH");
    expect(source).toContain("fontScale >= STACKED_ITEM_ROW_FONT_SCALE");
    expect(source).toMatch(/reorderFeedbackError:\s*\{[\s\S]*?minHeight: 48/);
    expect(source).toMatch(/reorderFeedbackStacked:\s*\{[\s\S]*?flexDirection: "column"/);
    expect(source).toMatch(/reorderFeedbackErrorAndroid:\s*\{[\s\S]*?androidOpaque\.errorFill/);
    expect(source).toContain('Platform.OS === "android"');
  });
});
