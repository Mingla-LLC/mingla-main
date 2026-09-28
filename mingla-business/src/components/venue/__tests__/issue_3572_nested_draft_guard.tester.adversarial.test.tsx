/**
 * Issue #3572 TESTER adversarial guard — the nested options draft lock, proven
 * through the SHIPPED primitives instead of around them.
 *
 * # Why this suite exists beside the implementor's
 *
 * The implementor's suite doubles `ui/Sheet`, `ui/Button` and `ui/Input`, so
 * every one of its dismissal proofs reduces to reading a prop off a `MockSheet`
 * (`dismissDisabled === true`, then calling the recorded `onClose`). A prop
 * echoed into a mock is not a refusal: it proves the sheet was ASKED to fail
 * closed, never that the shipped primitive does. Same for Save — a `MockButton`
 * forwards `onPress` regardless of `disabled`, so "fired past disabled" measures
 * `MenuItemSheet.handleSave`'s own guard and says nothing about whether the
 * control an operator's thumb lands on is inert.
 *
 * A stubbed boundary is a blind spot with a test around it. So this suite mounts
 * the REAL chain AND the REAL primitives:
 *
 *   VenueMenuModule -> MenuItemSheet -> ui/Sheet (SheetMobile: SheetNative and
 *   SheetWeb) -> RN Modal + the scrim Pressable + Gesture.Pan(), with the real
 *   ui/Button, ui/Input, ui/ConfirmDialog and ui/Modal, and the real lazily
 *   loaded MenuItemOptionsSection -> MenuModifierGroupEditor.
 *
 * Only the DEVICE layer is doubled, and only because a node test environment has
 * no native module to bind to: reanimated, gesture-handler, expo-blur, haptics,
 * and the two data hooks. Every decision under test — which dismissal routes
 * fail closed, whether the pan gesture is even constructed enabled, whether the
 * Save and Delete controls are genuinely inert, when the lock releases — is
 * taken by shipped source in this tree.
 *
 * # Angles this suite attacks that the implementor's does not
 *
 *  1. The real scrim Pressable and the real `Modal.onRequestClose`, driven —
 *     with a pristine control run proving the same route still dismisses.
 *  2. `Gesture.Pan().enabled(...)` recorded at construction: the mechanism the
 *     implementation chose INSTEAD of intercepting `onClose` (an intercepted
 *     close strands the panel at its drag offset on native).
 *  3. The real `Button`, which strips `onPress` while disabled — so the barrier
 *     on Save and on Delete item is proven to be a real one, not a style.
 *  4. Deleting the ITEM: the route that destroys the draft AND the item. The
 *     implementor's suite never touches it.
 *  5. The RELEASE direction, per control: mode, required and price each
 *     reverted on their own, and an option row added then removed. A lock that
 *     cannot release traps a venue owner in a sheet they can neither save nor
 *     close, which is worse than the bug it replaces.
 *  6. Baseline ownership: dirtied group A, cancelled, then group B dirtied and
 *     reverted — no leak between editor instances.
 *  7. `SheetWeb` parity: the same two routes re-driven with `Platform.OS` on
 *     "web", which selects an entirely different variant of the primitive.
 *  8. The written item payload, read off the mutation call, carrying no options
 *     field — instead of asserting it from the source text of a type.
 *
 * # Honest limits (source + jest only)
 *
 * No simulator, device or signed-in web run backs this file. A REAL native pan
 * gesture cannot be performed here: test 3 proves the gesture is CONSTRUCTED
 * disabled, which is the whole mechanism, but the physical drag-and-release on
 * an iPhone is Seth's pass. There is no Android SDK on this machine, so Android
 * is unverified rather than claimed.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

import type { Menu } from "../../../services/menusService";
import type {
  MenuModifierGroup,
  ModifierGroupSaveInput,
} from "../../../hooks/useMenuModifiers";

interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
  findAllByProps: (props: Record<string, unknown>) => TestNode[];
  findAllByType: (type: unknown) => TestNode[];
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

/** Flipped per test so the ONE dispatcher in `ui/Sheet` picks each variant. */
let platformOS: "ios" | "web" = "ios";

/** Every `Gesture.Pan()` built during a render, newest last. */
const panGestures: { enabled: boolean | null }[] = [];

const upsertItemMutate =
  jest.fn<
    (
      payload: Record<string, unknown>,
      callbacks?: Record<string, unknown>,
    ) => void
  >();
const deleteItemMutate = jest.fn();
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

/*
 * `Platform.OS` is a GETTER so one module registry can render both variants of
 * the shipped `Sheet` dispatcher. Everything else is the repo's own mapped
 * react-native double.
 */
jest.mock("react-native", () => {
  /*
   * `jest.mock` factories are hoisted above every import, and react-native is
   * the first module the product chain requires — so this is the earliest point
   * at which `__DEV__` can be defined. The REAL `SheetMobile.tsx` reads it at
   * module scope (its #1022 drag-band assertion), and this suite renders that
   * file rather than a double.
   */
  (globalThis as unknown as { __DEV__?: boolean }).__DEV__ ??= false;
  const actual = jest.requireActual("react-native") as Record<string, unknown>;
  const accessibility = actual.AccessibilityInfo as Record<string, unknown>;
  const platform = actual.Platform as Record<string, unknown>;
  return {
    ...actual,
    Platform: {
      ...platform,
      get OS(): string {
        return platformOS;
      },
      select: (choices: Record<string, unknown>) =>
        choices[platformOS] ?? choices.default,
    },
    AccessibilityInfo: {
      ...accessibility,
      announceForAccessibility: () => undefined,
      setAccessibilityFocus: () => undefined,
    },
    // `react-native-svg` (pulled in by the REAL `ui/Icon` inside the REAL
    // `ui/Button`) reads this at module load; the repo's react-native double
    // does not carry it.
    Touchable: { Mixin: {} },
    useWindowDimensions: () => ({
      width: 420,
      height: 900,
      scale: 2,
      fontScale: 1,
    }),
  };
});

/*
 * DEVICE LAYER ONLY. Shared values behave like shared values, `runOnJS` runs on
 * JS, animation helpers settle instantly. None of the sheet's dismissal
 * decisions live in here — they live in `SheetMobile.tsx`, which this suite
 * renders for real.
 */
jest.mock("react-native-reanimated", () => {
  const react = jest.requireActual("react") as typeof React;
  const rn = jest.requireActual("react-native") as Record<string, unknown>;
  const settle = (value: unknown): unknown => value;
  const easing = (): number => 0;
  const Easing = {
    cubic: easing,
    linear: easing,
    ease: easing,
    quad: easing,
    bezier: () => easing,
    in: (fn: unknown) => fn,
    out: (fn: unknown) => fn,
    inOut: (fn: unknown) => fn,
  };
  return {
    __esModule: true,
    default: { View: rn.View, Text: rn.Text, ScrollView: rn.ScrollView },
    Easing,
    cancelAnimation: () => undefined,
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => false,
    useSharedValue: (initial: unknown) =>
      react.useRef({ value: initial }).current,
    withDelay: (_ms: number, value: unknown) => value,
    withSpring: settle,
    withTiming: settle,
  };
});

/*
 * DEVICE LAYER ONLY — but the Pan builder RECORDS its `.enabled(...)` argument,
 * because whether the gesture is constructed enabled is the entire mechanism
 * #3572 chose over intercepting `onClose`.
 */
jest.mock("react-native-gesture-handler", () => {
  const react = jest.requireActual("react") as typeof React;
  const rn = jest.requireActual("react-native") as Record<string, unknown>;
  const makePan = (): Record<string, unknown> => {
    const record: { enabled: boolean | null } = { enabled: null };
    panGestures.push(record);
    const chain: Record<string, unknown> = {};
    const step =
      (name: string) =>
      (...args: unknown[]): Record<string, unknown> => {
        if (name === "enabled") record.enabled = args[0] === true;
        return chain;
      };
    for (const name of [
      "enabled",
      "onStart",
      "onUpdate",
      "onEnd",
      "onFinalize",
      "activeOffsetY",
      "failOffsetY",
      "simultaneousWithExternalGesture",
      "withTestId",
      "shouldCancelWhenOutside",
    ]) {
      chain[name] = step(name);
    }
    return chain;
  };
  return {
    __esModule: true,
    Gesture: {
      Pan: makePan,
      Simultaneous: (...gs: unknown[]) => gs[0],
      Native: makePan,
      Race: (...gs: unknown[]) => gs[0],
    },
    GestureDetector: ({ children }: { children?: React.ReactNode }) =>
      react.createElement(rn.View as React.ComponentType, null, children),
    GestureHandlerRootView: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
    }) => react.createElement(rn.View as React.ComponentType, props, children),
  };
});

/*
 * DEVICE LAYER ONLY. `react-native-svg`'s source reads native-only bindings
 * (`Touchable.Mixin`, `processColor`) at module load, which the repo's mapped
 * react-native double does not provide. The REAL `ui/Icon` and the REAL
 * `ui/Button` still render — only the vector leaves are inert.
 */
jest.mock("react-native-svg", () => {
  const react = jest.requireActual("react") as typeof React;
  const leaf =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      react.createElement(name, props, children);
  return {
    __esModule: true,
    default: leaf("Svg"),
    Svg: leaf("Svg"),
    Circle: leaf("Circle"),
    Ellipse: leaf("Ellipse"),
    G: leaf("G"),
    Line: leaf("Line"),
    Path: leaf("Path"),
    Polygon: leaf("Polygon"),
    Polyline: leaf("Polyline"),
    Rect: leaf("Rect"),
    Text: leaf("SvgText"),
    Defs: leaf("Defs"),
    LinearGradient: leaf("LinearGradient"),
    Stop: leaf("Stop"),
    ClipPath: leaf("ClipPath"),
    Mask: leaf("Mask"),
  };
});

jest.mock("expo-blur", () => {
  const react = jest.requireActual("react") as typeof React;
  const rn = jest.requireActual("react-native") as Record<string, unknown>;
  return {
    __esModule: true,
    BlurView: ({ children, ...props }: { children?: React.ReactNode }) =>
      react.createElement(rn.View as React.ComponentType, props, children),
  };
});

jest.mock("expo-haptics", () => ({
  __esModule: true,
  impactAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
  NotificationFeedbackType: {
    Success: "success",
    Warning: "warning",
    Error: "error",
  },
}));

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
  useDeleteMenuItem: () => ({ mutate: deleteItemMutate, isPending: false }),
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
    useSaveModifierGroup: () => ({ isPending: false, mutate: saveGroupMutate }),
    useDeleteModifierGroup: () => ({ isPending: false, mutate: idleMutate }),
  };
});

/*
 * Neither carries any part of the guard: one is a keyboard-avoidance wrapper,
 * the other a sibling sheet that never renders in these flows. `ui/Sheet`,
 * `ui/Button`, `ui/Input`, `ui/ConfirmDialog`, `ui/Modal`, `ui/GlassCard` and
 * `ui/BrandSwitch` are all REAL here.
 */
jest.mock("../../../wrappers/SmartScrollView", () => {
  const react = jest.requireActual("react") as typeof React;
  const rn = jest.requireActual("react-native") as Record<string, unknown>;
  return {
    ScrollView: ({ children, ...props }: { children?: React.ReactNode }) =>
      react.createElement(rn.View as React.ComponentType, props, children),
  };
});

jest.mock("../MenuCategorySheet", () => ({ MenuCategorySheet: () => null }));
jest.mock("../VenueHubEmptyState", () => ({ VenueHubEmptyState: () => null }));

// Imports stay below the mocks so production binds to the doubles above.
// eslint-disable-next-line import/first
import { Modal as RNModal, Pressable } from "react-native";
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

/** The innermost host node for a testID — the real `Pressable` a thumb hits. */
const pressableFor = (testID: string): TestNode => {
  const found = nodes(testID).filter(
    (candidate) => candidate.type === Pressable,
  );
  const last = found[found.length - 1];
  if (last === undefined) {
    throw new Error(`${testID} rendered no Pressable`);
  }
  return last;
};

/** Press through the REAL primitive: a stripped `onPress` is a real refusal. */
const pressReal = (testID: string): void => {
  const target = pressableFor(testID);
  const handler = target.props.onPress;
  if (typeof handler !== "function") return;
  act(() => {
    (handler as (event: unknown) => void)({});
  });
};

/** Whether the REAL primitive left a press handler attached at all. */
const pressIsWired = (testID: string): boolean =>
  typeof pressableFor(testID).props.onPress === "function";

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
  const candidates = nodes(testID).filter(
    (candidate) => typeof candidate.props.onChangeText === "function",
  );
  const target = candidates[candidates.length - 1];
  if (target === undefined) throw new Error(`${testID} has no onChangeText`);
  act(() => {
    (target.props.onChangeText as (next: string) => void)(value);
  });
};

const valueOf = (testID: string): unknown => {
  const candidates = nodes(testID).filter(
    (candidate) => candidate.props.value !== undefined,
  );
  return candidates[candidates.length - 1]?.props.value;
};

const held = (): boolean => exists("menu-item-options-hold-note");

/**
 * Whether the SHIPPED sheet is open.
 *
 * Not `exists("menu-item-sheet")`: the real primitive keeps its node mounted
 * for `UNMOUNT_DELAY_MS` after `visible` drops so the close animation can play,
 * so presence proves nothing for 280ms. Both variants render the testID'd root
 * with `pointerEvents={visible ? "auto" : "none"}`, which is the primitive's own
 * statement about whether it is still taking input. The options subtree is the
 * corroborating signal — `VenueMenuModule` drops that node the instant the
 * sheet closes, which is exactly how the draft used to be destroyed.
 */
const sheetIsOpen = (): boolean => {
  const root = nodes("menu-item-sheet").find(
    (candidate) => candidate.props.pointerEvents !== undefined,
  );
  return root !== undefined && root.props.pointerEvents === "auto";
};

const optionsSubtreeMounted = (): boolean =>
  exists("menu-modifier-group-editor") ||
  exists("menu-item-option-group-group-a") ||
  exists("menu-item-options-add");

/** The real scrim: `SheetMobile` labels it for screen readers. */
const scrim = (): TestNode => {
  const found = tree.root.findAllByProps({
    accessibilityLabel: "Dismiss sheet",
  });
  const target = found.find(
    (candidate) => typeof candidate.props.onPress === "function",
  );
  if (target === undefined) throw new Error("no scrim Pressable rendered");
  return target;
};

const tapScrim = (): void => {
  const handler = scrim().props.onPress as () => void;
  act(() => {
    handler();
  });
};

/** Hardware back on Android, Escape on web: one prop on the real RN `Modal`. */
const requestClose = (): void => {
  const modals = tree.root
    .findAllByType(RNModal)
    .filter(
      (candidate) => typeof candidate.props.onRequestClose === "function",
    );
  const target = modals[0];
  if (target === undefined) throw new Error("no Modal with onRequestClose");
  act(() => {
    (target.props.onRequestClose as () => void)();
  });
};

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

const openGroupA = (): void => {
  press("menu-item-option-group-group-a");
};

/** Dirty group A by renaming its one option. */
const dirtyGroupA = (): void => {
  type("modifier-option-name-opt-rare", "Blue rare");
};

beforeEach(() => {
  upsertItemMutate.mockReset();
  deleteItemMutate.mockReset();
  saveGroupMutate.mockReset();
  idleMutate.mockReset();
  panGestures.length = 0;
  platformOS = "ios";
  groups = [
    { ...GROUP_A, modifiers: [...GROUP_A.modifiers] },
    { ...GROUP_B, modifiers: [] },
  ];
});

describe("#3572 tester adversarial — the shipped primitives, not their doubles", () => {
  test("the real scrim Pressable dismisses a pristine sheet and refuses a dirty one", async () => {
    await openItemSheet();
    openGroupA();

    // Control run FIRST: if the scrim could never close this sheet, the refusal
    // below would prove nothing at all.
    expect(sheetIsOpen()).toBe(true);
    tapScrim();
    expect(sheetIsOpen()).toBe(false);
    expect(optionsSubtreeMounted()).toBe(false);

    // Reopen and dirty the nested draft, then drive the SAME route.
    press("venue-menu-item-edit-item-a");
    await actAsync(async () => {
      await Promise.resolve();
    });
    openGroupA();
    dirtyGroupA();
    expect(held()).toBe(true);

    tapScrim();
    tapScrim();

    expect(sheetIsOpen()).toBe(true);
    expect(exists("menu-modifier-group-editor")).toBe(true);
    expect(valueOf("modifier-option-name-opt-rare")).toBe("Blue rare");
  });

  test("the real Modal's onRequestClose — hardware back and web Escape — is refused while dirty", async () => {
    await openItemSheet();
    openGroupA();

    // Control: the same prop closes the pristine sheet.
    requestClose();
    expect(sheetIsOpen()).toBe(false);
    expect(optionsSubtreeMounted()).toBe(false);

    press("venue-menu-item-edit-item-a");
    await actAsync(async () => {
      await Promise.resolve();
    });
    openGroupA();
    dirtyGroupA();

    requestClose();
    requestClose();

    expect(sheetIsOpen()).toBe(true);
    expect(valueOf("modifier-option-name-opt-rare")).toBe("Blue rare");
  });

  test("the native pan gesture is CONSTRUCTED disabled while dirty, so a committed drag never starts", async () => {
    await openItemSheet();
    openGroupA();

    const latestPan = (): { enabled: boolean | null } => {
      const last = panGestures[panGestures.length - 1];
      if (last === undefined) throw new Error("no Gesture.Pan() was built");
      return last;
    };

    // Pristine: the swipe-to-dismiss affordance is live, as it is on every
    // other sheet in the app.
    expect(latestPan().enabled).toBe(true);

    dirtyGroupA();

    /*
     * This is the mechanism the implementation chose over intercepting
     * `onClose`, and the reason matters: `SheetMobile`'s committed-drag branch
     * calls `onClose` and leaves `translateY` at the drag offset, restored only
     * by an effect keyed on `visible`. A guard that swallowed `onClose` would
     * strand the panel mid-screen. A gesture that never activates cannot.
     */
    expect(latestPan().enabled).toBe(false);

    type("modifier-option-name-opt-rare", "Rare");
    expect(latestPan().enabled).toBe(true);
  });

  test("the real Button leaves NO press handler on Save item while held", async () => {
    await openItemSheet();
    openGroupA();

    expect(pressIsWired("menu-item-save")).toBe(true);

    dirtyGroupA();

    // The shipped `Button` passes `onPress` only when interactive, so the
    // control an operator's thumb lands on is genuinely inert — the barrier is
    // not a 0.6 opacity.
    expect(pressIsWired("menu-item-save")).toBe(false);
    pressReal("menu-item-save");
    expect(upsertItemMutate).not.toHaveBeenCalled();

    // And it says why, on the control itself, to a screen reader.
    expect(pressableFor("menu-item-save").props.accessibilityLabel).toBe(
      `Save item. Unavailable. ${MENU_ITEM_OPTIONS_HOLD_NOTE}`,
    );
    expect(
      (
        pressableFor("menu-item-save").props.accessibilityState as {
          disabled?: boolean;
        }
      ).disabled,
    ).toBe(true);

    type("modifier-option-name-opt-rare", "Rare");
    expect(pressIsWired("menu-item-save")).toBe(true);
  });

  test("Delete item cannot fire while a draft is unsaved — the route that loses the draft AND the dish", async () => {
    await openItemSheet();
    openGroupA();

    expect(pressIsWired("menu-item-delete")).toBe(true);

    dirtyGroupA();

    expect(pressIsWired("menu-item-delete")).toBe(false);
    pressReal("menu-item-delete");

    // The confirmation never even opens, so the destructive action behind it is
    // unreachable rather than merely guarded.
    expect(exists("menu-item-delete-confirm")).toBe(false);
    expect(deleteItemMutate).not.toHaveBeenCalled();
    expect(sheetIsOpen()).toBe(true);
  });

  test("mode, required and price each release the hold on their own when put back", async () => {
    await openItemSheet();
    openGroupA();

    // Required: a boolean toggled and toggled back is not "touched forever".
    pressReal("modifier-group-required");
    expect(held()).toBe(true);
    pressReal("modifier-group-required");
    expect(held()).toBe(false);

    // Mode: the same, through the two-button choice control.
    pressReal("modifier-group-mode-multi");
    expect(held()).toBe(true);
    pressReal("modifier-group-mode-single");
    expect(held()).toBe(false);

    // Price: typed onto a zero-delta option, then cleared back to blank.
    type("modifier-option-price-opt-rare", "2.50");
    expect(held()).toBe(true);
    type("modifier-option-price-opt-rare", "");
    expect(held()).toBe(false);
  });

  test("an option row added then removed releases the hold — the lock is not a one-way latch", async () => {
    await openItemSheet();
    openGroupA();

    pressReal("modifier-option-add");
    expect(held()).toBe(true);

    const addedRemove = nodes("modifier-option-remove-opt-rare").length;
    expect(addedRemove).toBeGreaterThan(0);
    const newRowRemove = tree.root.findAllByProps({}).filter((candidate) => {
      const id = candidate.props.testID;
      return (
        typeof id === "string" &&
        id.startsWith("modifier-option-remove-") &&
        id !== "modifier-option-remove-opt-rare" &&
        candidate.type === Pressable
      );
    });
    const target = newRowRemove[newRowRemove.length - 1];
    if (target === undefined) throw new Error("the added row has no remove");
    act(() => {
      (target.props.onPress as (event: unknown) => void)({});
    });

    expect(held()).toBe(false);
    expect(pressIsWired("menu-item-save")).toBe(true);
  });

  test("the baseline belongs to the editor instance — A dirtied and cancelled leaves B clean", async () => {
    await openItemSheet();
    openGroupA();
    dirtyGroupA();
    expect(held()).toBe(true);

    pressReal("modifier-group-cancel");
    expect(held()).toBe(false);

    // A sibling opened AFTER the release hydrates its OWN baseline; nothing
    // leaks from the instance that was just discarded.
    press("menu-item-option-group-group-b");
    expect(held()).toBe(false);
    type("modifier-group-name", "Extras and sides");
    expect(held()).toBe(true);
    type("modifier-group-name", "Extras");
    expect(held()).toBe(false);
  });

  test("a brand-new group panel holds nothing until it differs, and releases when emptied again", async () => {
    groups = [];
    await openItemSheet();

    pressReal("menu-item-options-add");
    expect(exists("menu-modifier-group-editor")).toBe(true);

    // Merely opening the panel must not hold the item — an operator who opens
    // it to look at it can still save the dish.
    expect(held()).toBe(false);
    expect(pressIsWired("menu-item-save")).toBe(true);

    type("modifier-group-name", "Sides");
    expect(held()).toBe(true);
    type("modifier-group-name", "");
    expect(held()).toBe(false);
  });

  test("a FAILED nested save keeps the draft, the hold, and every real dismissal route shut", async () => {
    await openItemSheet();
    openGroupA();
    dirtyGroupA();

    pressReal("modifier-group-save");
    const call = saveGroupMutate.mock.calls[0];
    if (call === undefined) throw new Error("the group save never fired");
    const callbacks = call[1] as SaveGroupCallbacks;
    act(() => {
      callbacks.onError?.(new Error("network unreachable"));
      callbacks.onSettled?.();
    });

    // A failed write is the one case where clearing the flag would reopen the
    // exact hole this guard closes.
    expect(held()).toBe(true);
    expect(valueOf("modifier-option-name-opt-rare")).toBe("Blue rare");
    expect(pressIsWired("menu-item-save")).toBe(false);
    expect(pressIsWired("menu-item-delete")).toBe(false);

    tapScrim();
    requestClose();
    expect(sheetIsOpen()).toBe(true);
    expect(valueOf("modifier-option-name-opt-rare")).toBe("Blue rare");

    // The retry is the recovery: the nested save succeeding releases everything.
    pressReal("modifier-group-save");
    const retry = saveGroupMutate.mock.calls[1];
    if (retry === undefined) throw new Error("the retry never fired");
    const saved: MenuModifierGroup = {
      ...GROUP_A,
      modifiers: [{ ...GROUP_A.modifiers[0]!, name: "Blue rare" }],
    };
    groups = [saved, { ...GROUP_B, modifiers: [] }];
    act(() => {
      (retry[1] as SaveGroupCallbacks).onSuccess?.(saved);
      (retry[1] as SaveGroupCallbacks).onSettled?.();
    });

    expect(held()).toBe(false);
    expect(pressIsWired("menu-item-save")).toBe(true);
    expect(pressIsWired("menu-item-delete")).toBe(true);
  });

  test("after the release the item writes its OWN edits, with no options field in the payload", async () => {
    await openItemSheet();

    // The item form is edited BEFORE the options detour, so this also proves the
    // parent's unsaved work survived the whole hold.
    type("menu-item-name", "Ribeye");
    type("menu-item-price", "31.50");

    openGroupA();
    dirtyGroupA();

    // The detour holds the item first — pressing Save here is what used to
    // write the dish and take the choices with it.
    expect(pressIsWired("menu-item-save")).toBe(false);
    pressReal("menu-item-save");
    expect(upsertItemMutate).not.toHaveBeenCalled();

    pressReal("modifier-group-save");
    const call = saveGroupMutate.mock.calls[0];
    if (call === undefined) throw new Error("the group save never fired");
    const saved: MenuModifierGroup = {
      ...GROUP_A,
      modifiers: [{ ...GROUP_A.modifiers[0]!, name: "Blue rare" }],
    };
    groups = [saved, { ...GROUP_B, modifiers: [] }];
    act(() => {
      (call[1] as SaveGroupCallbacks).onSuccess?.(saved);
      (call[1] as SaveGroupCallbacks).onSettled?.();
    });

    expect(held()).toBe(false);
    pressReal("menu-item-save");

    const payload = upsertItemMutate.mock.calls[0]?.[0];
    if (payload === undefined) throw new Error("the item never saved");
    expect(payload.name).toBe("Ribeye");
    expect(payload.priceCents).toBe(3150);
    // Read off the ACTUAL write, not from the source text of a type: the two
    // tables are still two writes, and no pseudo-transaction was smuggled in.
    expect(Object.keys(payload)).not.toContain("modifiers");
    expect(Object.keys(payload)).not.toContain("options");
    expect(Object.keys(payload)).not.toContain("modifierGroups");

    // The reported symptom, read back: reopening used to show "0 options".
    const itemCallbacks = upsertItemMutate.mock.calls[0]?.[1] as
      { onSuccess?: () => void } | undefined;
    act(() => {
      itemCallbacks?.onSuccess?.();
    });
    expect(sheetIsOpen()).toBe(false);

    press("venue-menu-item-edit-item-a");
    await actAsync(async () => {
      await Promise.resolve();
    });
    const summaries = nodes("menu-item-option-group-group-a")
      .flatMap((row) => row.findAllByProps({}))
      .map((child) => child.props.children)
      .filter((child): child is string => typeof child === "string");
    expect(summaries).toContain("Pick one · required · 1 option");
  });

  test("SheetWeb — the same two routes fail closed on the web variant of the primitive", async () => {
    platformOS = "web";
    await openItemSheet();
    openGroupA();

    // Control: on web the scrim still closes a pristine sheet.
    tapScrim();
    expect(sheetIsOpen()).toBe(false);
    expect(optionsSubtreeMounted()).toBe(false);

    press("venue-menu-item-edit-item-a");
    await actAsync(async () => {
      await Promise.resolve();
    });
    openGroupA();
    dirtyGroupA();

    tapScrim();
    requestClose();

    expect(sheetIsOpen()).toBe(true);
    expect(valueOf("modifier-option-name-opt-rare")).toBe("Blue rare");
    expect(pressIsWired("menu-item-save")).toBe(false);
  });
});
