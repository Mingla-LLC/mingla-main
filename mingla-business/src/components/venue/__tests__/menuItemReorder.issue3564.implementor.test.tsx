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
import { MenuItemReorderError } from "../../../hooks/menuItemReorder";

interface TestNode {
  props: Record<string, unknown>;
  findAllByType: (type: unknown) => TestNode[];
  findByProps: (props: Record<string, unknown>) => TestNode;
  findAllByProps: (props: Record<string, unknown>) => TestNode[];
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
const mockReorderMutate = jest.fn();
const mockAnnounce = jest.fn();
const mockRefetch = jest.fn();
const mockFocusByTestID = new Map<string, jest.Mock>();
let operationNumber = 0;
let mockAppState = "active";
let appStateListener: ((state: string) => void) | undefined;
let mockNetwork = { isConnected: true, isInternetReachable: true };

const menuItem = (id: string, menuId: string, sortOrder: number) => ({
  id,
  menuId,
  brandId: "brand-a",
  name: id.toUpperCase(),
  description: null,
  priceCents: 100,
  currency: "USD",
  isAvailable: true,
  sortOrder,
  allowsNotes: false,
  prepStation: null,
  costCents: null,
});

const makeMenu = (
  id: string,
  ids: string[],
  sortOrder: number,
  venueId: string | null = "venue-a",
): Menu => ({
  id,
  brandId: "brand-a",
  venueId,
  name: id,
  description: null,
  sortOrder,
  isActive: true,
  serviceWindowStart: null,
  serviceWindowEnd: null,
  serviceDays: null,
  items: ids.map((itemId, index) => menuItem(itemId, id, index)),
});

const mockMenus = [
  makeMenu("one", ["single"], 0),
  makeMenu("two", ["alpha", "bravo"], 1),
  makeMenu("many", ["charlie", "delta", "echo"], 2),
];
let mockMenusValue: Menu[] = mockMenus;

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as Record<string, unknown>;
  const accessibility = actual.AccessibilityInfo as Record<string, unknown>;
  return {
    ...actual,
    AccessibilityInfo: {
      ...accessibility,
      announceForAccessibility: (...args: unknown[]) => mockAnnounce(...args),
    },
    AppState: {
      get currentState() {
        return mockAppState;
      },
      addEventListener: (
        _event: string,
        listener: (state: string) => void,
      ) => {
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
      width: 1024,
      height: 900,
      scale: 2,
      fontScale: 1,
    }),
  };
});

jest.mock("../../../utils/randomId", () => ({
  randomId: () => `operation-${++operationNumber}`,
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
    data: mockMenusValue,
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  }),
  useUpsertMenu: () => ({ mutate: mockIdleMutate, isPending: false }),
  useDeleteMenu: () => ({ mutate: mockIdleMutate, isPending: false }),
  useReorderMenus: () => ({ mutate: mockIdleMutate, isPending: false }),
  useUpsertMenuItem: () => ({ mutate: mockIdleMutate, isPending: false }),
  useDeleteMenuItem: () => ({ mutate: mockIdleMutate, isPending: false }),
  useReorderMenuItems: () => ({ mutate: mockReorderMutate, isPending: false }),
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

// Import after mocks so the production module binds to controlled hooks.
// eslint-disable-next-line import/first
import { VenueMenuModule } from "../VenueMenuModule";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act;
let tree: TestRenderer | undefined;

const renderModule = (venueId: string | null = "venue-a"): void => {
  act(() => {
    tree = renderer.create(
      <VenueMenuModule brandId="brand-a" venueId={venueId} />,
      {
        createNodeMock: (element) => {
          const testID = (element.props as Record<string, unknown>).testID as
            | string
            | undefined;
          if (testID?.startsWith("venue-menu-item-") === true) {
            const focus = jest.fn();
            mockFocusByTestID.set(testID, focus);
            return { focus };
          }
          return {};
        },
      },
    );
  });
};

const rerenderModule = (): void => {
  act(() => {
    tree?.update(<VenueMenuModule brandId="brand-a" venueId="venue-a" />);
  });
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

const nodeText = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(nodeText).join("");
  return "";
};

const textExists = (copy: string): boolean =>
  tree?.root
    .findAllByType(Text)
    .some((node) => nodeText(node.props.children) === copy) ?? false;

beforeEach(() => {
  jest.useFakeTimers();
  mockIdleMutate.mockReset();
  mockReorderMutate.mockReset();
  mockAnnounce.mockReset();
  mockRefetch.mockReset();
  mockRefetch.mockImplementation(async () => ({
    data: mockMenusValue,
    isError: false,
    error: null,
  }));
  mockFocusByTestID.clear();
  mockMenusValue = mockMenus;
  mockNetwork = { isConnected: true, isInternetReachable: true };
  mockAppState = "active";
  appStateListener = undefined;
  operationNumber = 0;
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  if (tree !== undefined) {
    act(() => tree?.unmount());
    tree = undefined;
  }
  jest.useRealTimers();
});

describe("#3564 menu-item reorder interaction", () => {
  test("one/two/multi boundaries expose adjacent position guidance and synchronously lock repeat activation", () => {
    renderModule();

    expect(byTestID("venue-menu-item-up-single").props.disabled).toBe(true);
    expect(byTestID("venue-menu-item-down-single").props.disabled).toBe(true);
    expect(byTestID("venue-menu-item-up-alpha").props.disabled).toBe(true);
    expect(byTestID("venue-menu-item-down-alpha").props.disabled).toBe(false);
    expect(byTestID("venue-menu-item-up-bravo").props.disabled).toBe(false);
    expect(byTestID("venue-menu-item-down-bravo").props.disabled).toBe(true);
    expect(byTestID("venue-menu-item-up-delta").props.disabled).toBe(false);
    expect(byTestID("venue-menu-item-down-delta").props.disabled).toBe(false);
    const positionedControl = tree?.root
      .findAllByProps({ testID: "venue-menu-item-up-delta" })
      .find((node) => node.props.accessibilityValue !== undefined);
    expect(positionedControl?.props.accessibilityValue).toEqual({
      text: "Position 2 of 3",
    });
    expect(positionedControl?.props.accessibilityLabel).toBe(
      "Move DELTA up, position 2 of 3",
    );
    expect(positionedControl?.props.accessibilityHint).toBe(
      "Moves before CHARLIE",
    );

    const repeatHandler = byTestID("venue-menu-item-up-delta").props.onPress;
    act(() => {
      (repeatHandler as () => void)();
      (repeatHandler as () => void)();
    });
    expect(mockReorderMutate).toHaveBeenCalledTimes(1);
    expect(mockReorderMutate.mock.calls[0]?.[0]).toMatchObject({
      brandId: "brand-a",
      venueId: "venue-a",
      menuId: "many",
      movedItemId: "delta",
      anchorItemId: "charlie",
      direction: "up",
      orderedItemIds: ["delta", "charlie", "echo"],
    });
    for (const itemId of ["single", "alpha", "bravo", "charlie", "delta", "echo"]) {
      expect(byTestID(`venue-menu-item-up-${itemId}`).props.disabled).toBe(true);
      expect(byTestID(`venue-menu-item-down-${itemId}`).props.disabled).toBe(true);
    }
    expect(byTestID("venue-menu-item-edit-delta").props.disabled).toBeUndefined();
    expect(byTestID("venue-menu-item-86-delta").props.disabled).toBe(false);
    expect(byTestID("venue-menu-item-list-many").props.accessibilityState)
      .toEqual({ busy: true });
    expect(byTestID("venue-menu-item-list-two").props.accessibilityState)
      .toEqual({ busy: false });
    expect(textExists("Saving new position…")).toBe(true);
  });

  test("success announces the exact final position once and clears visible copy after 2.5 seconds", () => {
    renderModule();
    press("venue-menu-item-down-alpha");
    const callbacks = mockReorderMutate.mock.calls[0]?.[1] as {
      onSuccess: () => void;
    };
    act(() => callbacks.onSuccess());
    expect(textExists("Order saved.")).toBe(true);
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).toHaveBeenCalledWith(
      "ALPHA moved to position 2 of 2. Order saved.",
    );
    expect(
      byTestID("venue-menu-item-reorder-feedback-alpha").props
        .accessibilityLiveRegion,
    ).toBe("none");

    act(() => jest.advanceTimersByTime(2_499));
    expect(textExists("Order saved.")).toBe(true);
    act(() => jest.advanceTimersByTime(1));
    expect(textExists("Order saved.")).toBe(false);
  });

  test("conflict announces once, restores original focus, refetches, and rebuilds intent from latest truth", async () => {
    renderModule();
    press("venue-menu-item-down-alpha");
    act(() => jest.advanceTimersByTime(0));
    expect(
      mockFocusByTestID.get("venue-menu-item-up-alpha"),
    ).toHaveBeenCalledTimes(1);
    const callbacks = mockReorderMutate.mock.calls[0]?.[1] as {
      onError: (error: MenuItemReorderError) => void;
    };
    const conflict = new MenuItemReorderError("conflict", "40001", true);
    act(() => callbacks.onError(conflict));
    act(() => jest.advanceTimersByTime(0));
    expect(
      textExists(
        "This menu changed elsewhere. We loaded the latest order. Try your move again.",
      ),
    ).toBe(true);
    expect(
      byTestID("venue-menu-item-reorder-feedback-alpha").props
        .accessibilityLiveRegion,
    ).toBe("none");
    expect(
      byTestID("venue-menu-item-reorder-retry-alpha").props.accessibilityLabel,
    ).toBe("Try moving ALPHA down again");
    expect(mockAnnounce).toHaveBeenCalledWith(
      "This menu changed elsewhere. We loaded the latest order. Try your move again.",
    );
    expect(
      mockFocusByTestID.get("venue-menu-item-down-alpha"),
    ).toHaveBeenCalledTimes(1);
    rerenderModule();
    expect(mockAnnounce).toHaveBeenCalledTimes(1);

    const remote = menuItem("foxtrot", "two", 0);
    mockMenusValue = mockMenus.map((menu) =>
      menu.id === "two"
        ? {
            ...menu,
            items: [
              remote,
              { ...menu.items[0]!, sortOrder: 1 },
              { ...menu.items[1]!, sortOrder: 2 },
            ],
          }
        : menu,
    );

    await pressAsync("venue-menu-item-reorder-retry-alpha");
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockReorderMutate).toHaveBeenCalledTimes(2);
    expect(mockReorderMutate.mock.calls[1]?.[0]).toMatchObject({
      movedItemId: "alpha",
      anchorItemId: "bravo",
      direction: "down",
      expectedItems: [
        { id: "foxtrot", sortOrder: 0 },
        { id: "alpha", sortOrder: 1 },
        { id: "bravo", sortOrder: 2 },
      ],
      orderedItemIds: ["foxtrot", "bravo", "alpha"],
    });
  });

  test("failed confirmation stays visibly uncertain and never claims latest truth loaded", () => {
    renderModule();
    press("venue-menu-item-down-alpha");
    const callbacks = mockReorderMutate.mock.calls[0]?.[1] as {
      onError: (error: MenuItemReorderError) => void;
    };
    const confirmationFailed = new MenuItemReorderError(
      "conflict",
      "40001",
    );
    confirmationFailed.markConfirmationFailed(true);

    act(() => callbacks.onError(confirmationFailed));

    expect(
      textExists(
        "We couldn’t confirm the new order. The previous order is back.",
      ),
    ).toBe(true);
    expect(
      textExists(
        "This menu changed elsewhere. We loaded the latest order. Try your move again.",
      ),
    ).toBe(false);
    expect(
      byTestID("venue-menu-item-reorder-retry-alpha").props.accessibilityLabel,
    ).toBe("Try moving ALPHA down again");
    expect(mockAnnounce).toHaveBeenCalledWith(
      "We couldn’t confirm the new order. The previous order is back.",
    );
  });

  test("retry that refetches an already-applied relationship settles success without a second write", async () => {
    renderModule();
    press("venue-menu-item-down-alpha");
    const callbacks = mockReorderMutate.mock.calls[0]?.[1] as {
      onError: (error: MenuItemReorderError) => void;
    };
    act(() => callbacks.onError(new MenuItemReorderError("uncertain", "timeout", true)));
    mockMenusValue = mockMenus.map((menu) =>
      menu.id === "two"
        ? {
            ...menu,
            items: [
              { ...menu.items[1]!, sortOrder: 0 },
              { ...menu.items[0]!, sortOrder: 1 },
            ],
          }
        : menu,
    );

    await pressAsync("venue-menu-item-reorder-retry-alpha");

    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockReorderMutate).toHaveBeenCalledTimes(1);
    expect(textExists("Order saved.")).toBe(true);
    expect(mockAnnounce).toHaveBeenLastCalledWith(
      "ALPHA moved to position 2 of 2. Order saved.",
    );
  });

  test("lost acknowledgement announces the moved position from authoritative changed truth", () => {
    renderModule();
    press("venue-menu-item-down-alpha");
    const callbacks = mockReorderMutate.mock.calls[0]?.[1] as {
      onError: (error: MenuItemReorderError) => void;
    };
    const confirmed = new MenuItemReorderError("uncertain", "timeout");
    confirmed.resolvedAsSuccess = true;
    const remote = menuItem("remote", "two", 0);
    confirmed.authoritativeMenus = mockMenus.map((menu) =>
      menu.id === "two"
        ? {
            ...menu,
            items: [
              remote,
              { ...menu.items[1]!, sortOrder: 1 },
              { ...menu.items[0]!, sortOrder: 2 },
            ],
          }
        : menu,
    );

    act(() => callbacks.onError(confirmed));

    expect(mockAnnounce).toHaveBeenLastCalledWith(
      "ALPHA moved to position 3 of 3. Order saved.",
    );
  });

  test("a deleted moved row keeps a visible menu-anchored non-retryable recovery", () => {
    renderModule();
    press("venue-menu-item-down-alpha");
    const callbacks = mockReorderMutate.mock.calls[0]?.[1] as {
      onError: (error: MenuItemReorderError) => void;
    };
    mockMenusValue = mockMenus.map((menu) =>
      menu.id === "two"
        ? { ...menu, items: [{ ...menu.items[1]!, sortOrder: 0 }] }
        : menu,
    );
    rerenderModule();
    act(() =>
      callbacks.onError(new MenuItemReorderError("conflict", "40001", false)),
    );

    expect(
      textExists(
        "This menu changed elsewhere. We loaded the latest order. Review the list and choose a new move.",
      ),
    ).toBe(true);
    expect(byTestID("venue-menu-item-reorder-feedback-menu-two")).toBeDefined();
    expect(
      tree?.root.findAllByProps({
        testID: "venue-menu-item-reorder-retry-menu-two",
      }),
    ).toHaveLength(0);
  });

  test("legacy unassigned categories expose an honest disabled reorder state", () => {
    mockMenusValue = [makeMenu("legacy", ["old-a", "old-b"], 0, null)];
    renderModule();

    expect(byTestID("venue-menu-item-up-old-b").props.disabled).toBe(true);
    const legacyControl = tree?.root
      .findAllByProps({ testID: "venue-menu-item-up-old-b" })
      .find((node) => node.props.accessibilityHint !== undefined);
    expect(legacyControl?.props.accessibilityHint).toBe(
      "Save this category to this venue before changing item order.",
    );
    expect(
      textExists(
        "Save this category to this venue before changing item order.",
      ),
    ).toBe(true);
    press("venue-menu-item-up-old-b");
    expect(mockReorderMutate).not.toHaveBeenCalled();

    act(() => tree?.unmount());
    tree = undefined;
    renderModule(null);
    expect(byTestID("venue-menu-item-down-old-a").props.disabled).toBe(true);
    expect(
      textExists(
        "Save this category to this venue before changing item order.",
      ),
    ).toBe(true);
    press("venue-menu-item-down-old-a");
    expect(mockReorderMutate).not.toHaveBeenCalled();
  });

  test("offline retry is disabled until reconnection, then reads latest truth before writing", async () => {
    renderModule();
    press("venue-menu-item-down-alpha");
    const callbacks = mockReorderMutate.mock.calls[0]?.[1] as {
      onError: (error: MenuItemReorderError) => void;
    };
    mockNetwork = { isConnected: false, isInternetReachable: false };
    rerenderModule();
    act(() => callbacks.onError(new MenuItemReorderError("uncertain", "offline", true)));

    expect(
      textExists(
        "You’re offline. The previous order is back. Reconnect, then try again.",
      ),
    ).toBe(true);
    expect(
      textExists(
        "We couldn’t confirm the new order. The previous order is back.",
      ),
    ).toBe(false);
    expect(byTestID("venue-menu-item-reorder-retry-alpha").props.disabled).toBe(
      true,
    );
    await pressAsync("venue-menu-item-reorder-retry-alpha");
    expect(mockRefetch).not.toHaveBeenCalled();
    expect(mockReorderMutate).toHaveBeenCalledTimes(1);

    mockNetwork = { isConnected: true, isInternetReachable: true };
    rerenderModule();
    expect(byTestID("venue-menu-item-reorder-retry-alpha").props.disabled).toBe(
      false,
    );
    await pressAsync("venue-menu-item-reorder-retry-alpha");
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(mockReorderMutate).toHaveBeenCalledTimes(2);
  });

  test("background success stays guarded until active reconciliation", async () => {
    renderModule();
    press("venue-menu-item-down-alpha");
    const callbacks = mockReorderMutate.mock.calls[0]?.[1] as {
      onSuccess: () => void;
    };
    act(() => {
      mockAppState = "background";
      appStateListener?.("background");
      callbacks.onSuccess();
    });
    expect(textExists("Saving new position…")).toBe(true);
    expect(mockAnnounce).not.toHaveBeenCalled();

    mockMenusValue = mockMenus.map((menu) =>
      menu.id === "two"
        ? {
            ...menu,
            items: [
              { ...menu.items[1]!, sortOrder: 0 },
              { ...menu.items[0]!, sortOrder: 1 },
            ],
          }
        : menu,
    );
    await act(async () => {
      mockAppState = "active";
      appStateListener?.("active");
      await Promise.resolve();
    });
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(textExists("Order saved.")).toBe(true);
    expect(mockAnnounce).toHaveBeenCalledWith(
      "ALPHA moved to position 2 of 2. Order saved.",
    );
  });

  test("a newer authoritative order wins after success and is announced once", () => {
    renderModule();
    press("venue-menu-item-down-alpha");
    const callbacks = mockReorderMutate.mock.calls[0]?.[1] as {
      onSuccess: () => void;
    };
    mockMenusValue = mockMenus.map((menu) =>
      menu.id === "two"
        ? {
            ...menu,
            items: [
              { ...menu.items[1]!, sortOrder: 0 },
              { ...menu.items[0]!, sortOrder: 1 },
            ],
          }
        : menu,
    );
    rerenderModule();
    act(() => callbacks.onSuccess());
    expect(mockAnnounce).toHaveBeenCalledTimes(1);

    mockMenusValue = mockMenus;
    rerenderModule();
    expect(mockAnnounce).toHaveBeenLastCalledWith(
      "Menu order changed elsewhere. Showing the latest order.",
    );
    expect(mockAnnounce).toHaveBeenCalledTimes(2);
    rerenderModule();
    expect(mockAnnounce).toHaveBeenCalledTimes(2);
  });
});
