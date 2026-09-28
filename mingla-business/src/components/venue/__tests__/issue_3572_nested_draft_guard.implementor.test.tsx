/**
 * Issue #3572 implementor guard — saving or dismissing a menu item can never
 * silently destroy an unsaved options draft.
 *
 * The reported loss was a RUNTIME sequence, so every proof below mounts the REAL
 * chain the operator touches: `VenueMenuModule` -> `MenuItemSheet` -> the lazily
 * loaded `MenuItemOptionsSection` -> `MenuModifierGroupEditor`. Nothing about
 * the guard is asserted from source text; each test drives a control and reads
 * what the tree does.
 *
 * Only the leaves are doubled — the shared `Sheet`, `Button`, `Input` and
 * `BrandSwitch` primitives, and the two data hooks. The `Sheet` double is what
 * makes the dismissal half testable: every dismissal route in the shipped
 * primitive (scrim tap, hardware back, web Escape, a committed drag, and a
 * programmatic close) funnels into the single `onClose` it receives, and the
 * native drag gesture is gated by the single `dismissDisabled` it receives, so
 * recording both props measures every route at once.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { View } from "react-native";

import type { Menu } from "../../../services/menusService";
import type {
  MenuModifierGroup,
  ModifierGroupSaveInput,
} from "../../../hooks/useMenuModifiers";

interface TestNode {
  props: Record<string, unknown>;
  findAllByProps: (props: Record<string, unknown>) => TestNode[];
}

interface TestRenderer {
  root: TestNode;
  unmount: () => void;
}

interface RendererApi {
  create: (node: React.ReactElement) => TestRenderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
}

interface SaveGroupCallbacks {
  onSuccess?: (saved: MenuModifierGroup) => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

interface UpsertItemCallbacks {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

const announce = jest.fn();
const upsertItemMutate =
  jest.fn<
    (payload: Record<string, unknown>, callbacks?: UpsertItemCallbacks) => void
  >();
const saveGroupMutate =
  jest.fn<
    (input: ModifierGroupSaveInput, callbacks?: SaveGroupCallbacks) => void
  >();
const idleMutate = jest.fn();

const GROUP_A: MenuModifierGroup = {
  id: "group-a",
  menuItemId: "item-a",
  name: "Temperature",
  selectionMode: "single",
  minSelect: 1,
  maxSelect: 1,
  isActive: true,
  sortOrder: 0,
  modifiers: [
    {
      id: "opt-rare",
      groupId: "group-a",
      name: "Rare",
      priceDeltaCents: 0,
      currency: "USD",
      isAvailable: true,
      sortOrder: 0,
    },
  ],
};

const GROUP_B: MenuModifierGroup = {
  id: "group-b",
  menuItemId: "item-a",
  name: "Extras",
  selectionMode: "multi",
  minSelect: 0,
  maxSelect: 3,
  isActive: true,
  sortOrder: 1,
  modifiers: [],
};

let groups: MenuModifierGroup[] = [];
let saveGroupPending = false;

const MENUS: Menu[] = [
  {
    id: "menu-a",
    brandId: "brand-a",
    venueId: "venue-a",
    name: "Mains",
    description: null,
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
        name: "Steak",
        description: null,
        priceCents: 2500,
        currency: "USD",
        isAvailable: true,
        sortOrder: 0,
        allowsNotes: true,
        prepStation: null,
        costCents: null,
      },
    ],
  },
];

jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as Record<string, unknown>;
  const accessibility = actual.AccessibilityInfo as Record<string, unknown>;
  return {
    ...actual,
    AccessibilityInfo: {
      ...accessibility,
      announceForAccessibility: (...args: unknown[]) => announce(...args),
      setAccessibilityFocus: () => undefined,
    },
    useWindowDimensions: () => ({
      width: 1024,
      height: 900,
      scale: 2,
      fontScale: 1,
    }),
  };
});

jest.mock("../../../lib/netinfoSafe", () => ({
  useNetInfoSafe: () => ({ isConnected: true, isInternetReachable: true }),
}));

jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({ defaultCurrency: "USD" }),
}));

jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 100 }),
}));

jest.mock("../../../hooks/useMenus", () => ({
  useBrandMenus: () => ({
    data: MENUS,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useUpsertMenu: () => ({ mutate: idleMutate, isPending: false }),
  useDeleteMenu: () => ({ mutate: idleMutate, isPending: false }),
  useReorderMenus: () => ({ mutate: idleMutate, isPending: false }),
  useUpsertMenuItem: () => ({ mutate: upsertItemMutate, isPending: false }),
  useDeleteMenuItem: () => ({ mutate: idleMutate, isPending: false }),
  useReorderMenuItems: () => ({ mutate: idleMutate, isPending: false }),
}));

jest.mock("../../../hooks/useMenuModifiers", () => {
  const real = jest.requireActual("../../../hooks/useMenuModifiers") as Record<
    string,
    unknown
  >;
  return {
    ...real,
    useMenuModifierGroups: () => ({
      status: "success",
      fetchStatus: "idle",
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      data: groups,
      refetch: jest.fn(),
    }),
    useSaveModifierGroup: () => ({
      isPending: saveGroupPending,
      mutate: saveGroupMutate,
    }),
    useDeleteModifierGroup: () => ({ isPending: false, mutate: idleMutate }),
  };
});

jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("MockButton", props),
}));

jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    React.createElement("MockInput", props),
}));

jest.mock("../../ui/BrandSwitch", () => ({
  BrandSwitch: (props: Record<string, unknown>) =>
    React.createElement("MockBrandSwitch", props),
}));

jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children, ...props }: { children?: React.ReactNode }) => (
    <View {...props}>{children}</View>
  ),
}));

jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) =>
    React.createElement("MockConfirmDialog", props),
}));

jest.mock("../../../wrappers/SmartScrollView", () => ({
  ScrollView: ({ children, ...props }: { children?: React.ReactNode }) => (
    <View {...props}>{children}</View>
  ),
}));

/*
 * The one double that carries part of the contract, so it is deliberately a
 * PASS-THROUGH rather than a stub: it renders its children exactly when the
 * real primitive mounts them (`visible`), and it records the two props every
 * dismissal route in the real primitive goes through.
 */
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({
    visible,
    children,
    ...props
  }: {
    visible: boolean;
    children?: React.ReactNode;
  }) =>
    React.createElement(
      "MockSheet",
      { visible, ...props },
      visible ? children : null,
    ),
}));

jest.mock("../MenuCategorySheet", () => ({ MenuCategorySheet: () => null }));
jest.mock("../VenueHubEmptyState", () => ({ VenueHubEmptyState: () => null }));

// Imports stay below the mocks so production binds to the doubles.
// eslint-disable-next-line import/first
import { VenueMenuModule } from "../VenueMenuModule";
// eslint-disable-next-line import/first
import { MENU_ITEM_OPTIONS_HOLD_NOTE } from "../MenuItemSheet";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act as (callback: () => void) => void;
const actAsync = renderer.act as (
  callback: () => Promise<void>,
) => Promise<void>;

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The options section focuses a saved row on the next frame; the node test
// environment has no rAF of its own.
const globalWithFrames = globalThis as unknown as {
  requestAnimationFrame?: (callback: () => void) => number;
  cancelAnimationFrame?: (handle: number) => void;
};
globalWithFrames.requestAnimationFrame ??= (callback) => {
  callback();
  return 0;
};
globalWithFrames.cancelAnimationFrame ??= () => undefined;

let tree: TestRenderer;

const nodes = (testID: string): TestNode[] =>
  tree.root.findAllByProps({ testID });

const node = (testID: string): TestNode => {
  const found = nodes(testID);
  if (found[0] === undefined) throw new Error(`${testID} did not render`);
  return found[0];
};

const exists = (testID: string): boolean => nodes(testID).length > 0;

const press = (testID: string): void => {
  const handler = node(testID).props.onPress;
  if (typeof handler !== "function") {
    throw new Error(`${testID} has no onPress`);
  }
  act(() => {
    (handler as () => void)();
  });
};

const type = (testID: string, value: string): void => {
  const handler = node(testID).props.onChangeText;
  if (typeof handler !== "function") {
    throw new Error(`${testID} has no onChangeText`);
  }
  act(() => {
    (handler as (next: string) => void)(value);
  });
};

const sheet = (): TestNode => node("menu-item-sheet");
const saveItem = (): TestNode => node("menu-item-save");
const itemSheetVisible = (): boolean => sheet().props.visible === true;

/** Open the item sheet and let the lazy options section resolve. */
const openItemSheet = async (): Promise<void> => {
  await actAsync(async () => {
    tree = renderer.create(
      <VenueMenuModule brandId="brand-a" venueId="venue-a" />,
    );
  });
  press("venue-menu-item-edit-item-a");
  await actAsync(async () => {
    await Promise.resolve();
  });
};

/** Open the editor for `group-a`. */
const openGroupEditor = (): void => {
  press("menu-item-option-group-group-a");
};

beforeEach(() => {
  announce.mockReset();
  upsertItemMutate.mockReset();
  saveGroupMutate.mockReset();
  idleMutate.mockReset();
  saveGroupPending = false;
  groups = [
    { ...GROUP_A, modifiers: [...GROUP_A.modifiers] },
    { ...GROUP_B, modifiers: [] },
  ];
});

describe("#3572 implementor — an unsaved options draft holds the item sheet", () => {
  test("opening the editor blocks nothing; the first keystroke does", async () => {
    await openItemSheet();
    openGroupEditor();

    // The panel being OPEN is not the trigger — an operator who opens a group
    // to read it must still be able to save the item.
    expect(exists("menu-modifier-group-editor")).toBe(true);
    expect(saveItem().props.disabled).toBe(false);
    expect(exists("menu-item-options-hold-note")).toBe(false);
    expect(sheet().props.dismissDisabled).toBe(false);

    type("modifier-option-name-opt-rare", "Blue rare");

    expect(saveItem().props.disabled).toBe(true);
    expect(sheet().props.dismissDisabled).toBe(true);
  });

  test("typing into an option disables Save item and says why, out loud", async () => {
    await openItemSheet();
    openGroupEditor();
    type("modifier-option-name-opt-rare", "Blue rare");

    expect(saveItem().props.disabled).toBe(true);

    const note = node("menu-item-options-hold-note");
    expect(note.props.children).toBe(MENU_ITEM_OPTIONS_HOLD_NOTE);
    expect(MENU_ITEM_OPTIONS_HOLD_NOTE).toBe(
      "Save or cancel the options group first. Until then this item can't be" +
        " saved or closed — nothing you typed is lost.",
    );
    // Reachable by a screen reader the moment it appears, on native and on web.
    expect(note.props.accessibilityRole).toBe("alert");
    expect(note.props.accessibilityLiveRegion).toBe("assertive");
    expect(note.props["aria-live"]).toBe("assertive");
    // And attached to the control it blocks, not only floating beside it.
    expect(saveItem().props.accessibilityLabel).toBe(
      `Save item. Unavailable. ${MENU_ITEM_OPTIONS_HOLD_NOTE}`,
    );
  });

  test("adding an empty option row is already enough to hold the item", async () => {
    await openItemSheet();
    openGroupEditor();
    press("modifier-option-add");

    expect(saveItem().props.disabled).toBe(true);
    expect(exists("menu-item-options-hold-note")).toBe(true);
  });

  test("the item mutation is unreachable even when Save is fired past `disabled`", async () => {
    await openItemSheet();
    openGroupEditor();
    type("modifier-option-name-opt-rare", "Blue rare");

    press("menu-item-save");

    expect(upsertItemMutate).not.toHaveBeenCalled();
    expect(itemSheetVisible()).toBe(true);
  });

  test("every dismissal route is refused while the draft is dirty", async () => {
    await openItemSheet();
    openGroupEditor();
    type("modifier-option-name-opt-rare", "Blue rare");

    /*
     * The native drag is gated BEFORE it starts: the shipped primitive builds
     * its pan gesture with `.enabled(!dismissDisabled)`. That matters more than
     * it looks — a committed drag that is merely intercepted calls `onClose` and
     * leaves the panel at its drag offset with nothing to restore it.
     */
    expect(sheet().props.dismissDisabled).toBe(true);

    // Scrim tap, hardware back, web Escape and a programmatic close all arrive
    // as this one callback in the shipped primitive.
    const onClose = sheet().props.onClose as () => void;
    act(() => {
      onClose();
    });
    act(() => {
      onClose();
    });

    expect(itemSheetVisible()).toBe(true);
    expect(exists("menu-modifier-group-editor")).toBe(true);
    expect(node("modifier-option-name-opt-rare").props.value).toBe("Blue rare");
  });

  test("a sibling group cannot be opened over an unsaved draft", async () => {
    await openItemSheet();
    openGroupEditor();
    type("modifier-option-name-opt-rare", "Blue rare");

    const sibling = node("menu-item-option-group-group-b");
    expect(sibling.props.disabled).toBe(true);
    expect(sibling.props.accessibilityLabel).toBe(
      "Edit the Extras options. Unavailable." +
        " Save or cancel the options group you are editing first.",
    );
  });

  test("returning the draft to its hydrated value releases the hold", async () => {
    await openItemSheet();
    openGroupEditor();
    type("modifier-option-name-opt-rare", "Blue rare");
    expect(saveItem().props.disabled).toBe(true);

    // Dirty is a COMPARISON, not a keystroke counter.
    type("modifier-option-name-opt-rare", "Rare");

    expect(saveItem().props.disabled).toBe(false);
    expect(exists("menu-item-options-hold-note")).toBe(false);
    expect(sheet().props.dismissDisabled).toBe(false);
  });

  test("cancelling the group releases the hold — the operator's way out", async () => {
    await openItemSheet();
    openGroupEditor();
    type("modifier-option-name-opt-rare", "Blue rare");
    expect(saveItem().props.disabled).toBe(true);

    press("modifier-group-cancel");

    expect(exists("menu-modifier-group-editor")).toBe(false);
    expect(saveItem().props.disabled).toBe(false);
    expect(sheet().props.dismissDisabled).toBe(false);

    const onClose = sheet().props.onClose as () => void;
    act(() => {
      onClose();
    });
    expect(itemSheetVisible()).toBe(false);
  });

  test("a FAILED nested save keeps the draft AND keeps the item held", async () => {
    await openItemSheet();
    openGroupEditor();
    type("modifier-option-name-opt-rare", "Blue rare");

    press("modifier-group-save");
    const failure = saveGroupMutate.mock.calls[0]?.[1];
    if (failure?.onError === undefined) throw new Error("no onError captured");
    act(() => {
      failure.onError?.(new Error("network down"));
      failure.onSettled?.();
    });

    expect(node("modifier-option-name-opt-rare").props.value).toBe("Blue rare");
    expect(saveItem().props.disabled).toBe(true);
    expect(exists("menu-item-options-hold-note")).toBe(true);
    press("menu-item-save");
    expect(upsertItemMutate).not.toHaveBeenCalled();
  });

  test("a successful nested save releases the hold and leaves the item form intact", async () => {
    await openItemSheet();
    type("menu-item-name", "Ribeye");
    type("menu-item-price", "31.50");
    openGroupEditor();
    type("modifier-option-name-opt-rare", "Blue rare");
    expect(saveItem().props.disabled).toBe(true);

    press("modifier-group-save");
    const settled = saveGroupMutate.mock.calls[0]?.[1];
    if (settled?.onSuccess === undefined) {
      throw new Error("no onSuccess captured");
    }
    const saved: MenuModifierGroup = {
      ...GROUP_A,
      modifiers: [
        { ...GROUP_A.modifiers[0]!, name: "Blue rare" },
      ],
    };
    groups = [saved, { ...GROUP_B, modifiers: [] }];
    act(() => {
      settled.onSuccess?.(saved);
      settled.onSettled?.();
    });

    // Released, and the item's own unsaved edits were never touched.
    expect(saveItem().props.disabled).toBe(false);
    expect(sheet().props.dismissDisabled).toBe(false);
    expect(node("menu-item-name").props.value).toBe("Ribeye");
    expect(node("menu-item-price").props.value).toBe("31.50");
    expect(exists("menu-item-options-hold-note")).toBe(false);

    // And the saved group SURVIVES the later item save.
    press("menu-item-save");
    expect(upsertItemMutate).toHaveBeenCalledTimes(1);
    expect(upsertItemMutate.mock.calls[0]?.[0]).toMatchObject({
      id: "item-a",
      name: "Ribeye",
      priceCents: 3150,
    });
    const itemCallbacks = upsertItemMutate.mock.calls[0]?.[1];
    act(() => {
      itemCallbacks?.onSuccess?.();
    });
    expect(itemSheetVisible()).toBe(false);

    press("venue-menu-item-edit-item-a");
    await actAsync(async () => {
      await Promise.resolve();
    });
    expect(exists("menu-item-option-group-group-a")).toBe(true);
    expect(node("menu-item-option-group-group-a").props.disabled).toBe(false);
  });

  test("a pristine sheet still dismisses; the same sheet dirty does not", async () => {
    await openItemSheet();

    expect(sheet().props.dismissDisabled).toBe(false);
    const dismissPristine = sheet().props.onClose as () => void;
    act(() => {
      dismissPristine();
    });
    expect(itemSheetVisible()).toBe(false);

    // Same sheet, same route, one unsaved choice later.
    press("venue-menu-item-edit-item-a");
    await actAsync(async () => {
      await Promise.resolve();
    });
    openGroupEditor();
    type("modifier-option-name-opt-rare", "Blue rare");

    const dismissDirty = sheet().props.onClose as () => void;
    act(() => {
      dismissDirty();
    });
    expect(itemSheetVisible()).toBe(true);
  });
});
