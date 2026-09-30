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

/* ------------------------------------------------------------------------- *
 * RETEST — appended at head `c734d366f`, after the P0-1 / P2-1 / P2-2 / P2-3
 * rework. Nothing above this line was touched.
 *
 * The rework derives the hold from the editor that is actually rendered, using
 * the SAME predicate that decides whether it renders, and moves the dirty
 * comparison onto the payload the save would WRITE. Both are structural claims,
 * so these tests attack them structurally: not "does this one sequence work"
 * but "is there any frame in which the hold exists without a way out", and "is
 * there any edit the comparison now calls clean that the save would still
 * write" — the second being the dangerous direction, because a false clean
 * silently restores the original data loss.
 * ------------------------------------------------------------------------- */

/** A refetch lands with a different list, exactly as a reconnect would. */
const refetchWith = (next: MenuModifierGroup[]): void => {
  groups = next;
  act(() => {
    (tree as unknown as { update: (n: React.ReactElement) => void }).update(
      <VenueMenuModule brandId="brand-a" venueId="venue-a" />,
    );
  });
};

const screenText = (): string =>
  tree.root
    .findAllByProps({})
    .map((candidate) => candidate.props.children)
    .filter((child): child is string => typeof child === "string")
    .join(" ␟ ");

/**
 * The whole P0-1 fix in one sentence: the hold may never exist without a
 * control that releases it. Every editor — the one inside `groups.map` and the
 * one for a brand-new group — renders `modifier-group-cancel`, so "the hold is
 * on" must imply "Cancel is on screen". The lockout was exactly the state where
 * that implication failed.
 */
const holdAlwaysHasAWayOut = (): boolean =>
  !held() || exists("modifier-group-cancel");

describe("#3572 tester adversarial RETEST — the hold cannot outlive its editor", () => {
  test("no perturbation produces a frame where the hold is on and there is no way out", async () => {
    const perturbations: [string, () => void][] = [
      [
        "the edited group vanishes",
        () => refetchWith([{ ...GROUP_B, modifiers: [] }]),
      ],
      ["the list empties entirely", () => refetchWith([])],
      [
        "the group vanishes, then comes back",
        () => {
          refetchWith([{ ...GROUP_B, modifiers: [] }]);
          refetchWith([
            { ...GROUP_A, modifiers: [...GROUP_A.modifiers] },
            { ...GROUP_B, modifiers: [] },
          ]);
        },
      ],
      [
        "two refetches inside one burst",
        () => {
          groups = [{ ...GROUP_B, modifiers: [] }];
          act(() => {
            const api = tree as unknown as {
              update: (n: React.ReactElement) => void;
            };
            api.update(<VenueMenuModule brandId="brand-a" venueId="venue-a" />);
            groups = [];
            api.update(<VenueMenuModule brandId="brand-a" venueId="venue-a" />);
          });
        },
      ],
    ];

    for (const [label, perturb] of perturbations) {
      groups = [
        { ...GROUP_A, modifiers: [...GROUP_A.modifiers] },
        { ...GROUP_B, modifiers: [] },
      ];
      await openItemSheet();
      openGroupA();
      dirtyGroupA();
      // Control: the hold is genuinely engaged, with its way out, before each.
      expect(holdAlwaysHasAWayOut()).toBe(true);
      expect(held()).toBe(true);

      perturb();

      // The assertion that the lockout failed.
      expect([label, holdAlwaysHasAWayOut()]).toEqual([label, true]);
      // And the sheet is genuinely usable again, not merely un-held.
      expect([label, pressIsWired("menu-item-save")]).toEqual([label, true]);
      tapScrim();
      expect([label, sheetIsOpen()]).toEqual([label, false]);
    }
  });

  test("the group vanishing while the delete confirmation is open still releases everything", async () => {
    await openItemSheet();
    openGroupA();
    dirtyGroupA();
    pressReal("modifier-group-delete");
    expect(exists("menu-item-options-delete-confirm")).toBe(true);
    expect(held()).toBe(true);

    refetchWith([{ ...GROUP_B, modifiers: [] }]);

    expect(held()).toBe(false);
    expect(holdAlwaysHasAWayOut()).toBe(true);
    expect(exists("menu-modifier-group-editor")).toBe(false);
    expect(pressIsWired("menu-item-save")).toBe(true);
    expect(pressIsWired("menu-item-delete")).toBe(true);
    expect(exists("menu-item-options-draft-discarded")).toBe(true);
    tapScrim();
    expect(sheetIsOpen()).toBe(false);
  });

  test("the whole list emptying releases the hold, states the loss, and gives the Add control back", async () => {
    await openItemSheet();
    openGroupA();
    dirtyGroupA();

    refetchWith([]);

    expect(held()).toBe(false);
    expect(exists("menu-modifier-group-editor")).toBe(false);
    // The loss is STATED. Releasing the hold silently would trade a lockout for
    // a disappearance, which is the same failure pointing the other way.
    expect(screenText()).toContain(
      "“Temperature” is no longer listed on this item, so your" +
        " unsaved changes to it could not be kept.",
    );
    expect(screenText()).not.toContain(MENU_ITEM_OPTIONS_HOLD_NOTE);
    expect(exists("menu-item-options-add")).toBe(true);
    expect(pressIsWired("menu-item-save")).toBe(true);
  });

  test("a brand-new group's dirty draft is NOT collateral — the list changing under it keeps the hold", async () => {
    groups = [{ ...GROUP_A, modifiers: [...GROUP_A.modifiers] }];
    await openItemSheet();
    pressReal("menu-item-options-add");
    type("modifier-group-name", "Sides");
    expect(held()).toBe(true);

    // A new group belongs to no server row, so no refetch can invalidate it.
    // Releasing here would discard real typed work on a Wi-Fi blip.
    refetchWith([]);

    expect(held()).toBe(true);
    expect(holdAlwaysHasAWayOut()).toBe(true);
    expect(valueOf("modifier-group-name")).toBe("Sides");
    expect(exists("menu-item-options-draft-discarded")).toBe(false);
    expect(pressIsWired("menu-item-save")).toBe(false);

    // Still releasable the ordinary way.
    pressReal("modifier-group-cancel");
    expect(held()).toBe(false);
    expect(pressIsWired("menu-item-save")).toBe(true);
  });
});

describe("#3572 tester adversarial RETEST — the signature compares what would be WRITTEN", () => {
  /*
   * The dangerous direction. A comparison that under-reports is not a stuck
   * guard, it is the original bug back: the item saves, the sheet closes, the
   * options subtree unmounts, and the change the operator typed is gone. So
   * every edit below is one the save WOULD carry, and each must hold.
   */
  test("no edit the save would carry is ever reported clean", async () => {
    await openItemSheet();
    openGroupA();

    const writesSomething: [string, () => void, () => void][] = [
      [
        "an option renamed",
        () => type("modifier-option-name-opt-rare", "Medium"),
        () => type("modifier-option-name-opt-rare", "Rare"),
      ],
      [
        "an existing option's name cleared, which drops it from the payload",
        () => type("modifier-option-name-opt-rare", ""),
        () => type("modifier-option-name-opt-rare", "Rare"),
      ],
      [
        "a price delta that parses to different cents",
        () => type("modifier-option-price-opt-rare", "2.50"),
        () => type("modifier-option-price-opt-rare", ""),
      ],
      [
        "required turned off, which writes minSelect 0",
        () => pressReal("modifier-group-required"),
        () => pressReal("modifier-group-required"),
      ],
      [
        "the selection mode changed",
        () => pressReal("modifier-group-mode-multi"),
        () => pressReal("modifier-group-mode-single"),
      ],
      [
        "the group renamed to something canonicalisation keeps",
        () => type("modifier-group-name", "Doneness"),
        () => type("modifier-group-name", "Temperature"),
      ],
    ];

    for (const [label, edit, undo] of writesSomething) {
      expect([label, held()]).toEqual([label, false]);
      edit();
      expect([label, held()]).toEqual([label, true]);
      expect([label, pressIsWired("menu-item-save")]).toEqual([label, false]);
      undo();
      expect([label, held()]).toEqual([label, false]);
    }
  });

  test("a maximum is a written value in multi mode and dead text in single mode", async () => {
    await openItemSheet();
    openGroupA();

    pressReal("modifier-group-mode-multi");
    expect(held()).toBe(true);

    // In multi mode the maximum IS written, so changing it holds.
    type("modifier-group-max", "3");
    expect(held()).toBe(true);

    // Text the parser refuses is not a value, but it is also not nothing: the
    // group save is blocked while it stands, so reporting "no unsaved change"
    // over a field the operator is mid-way through fixing would be a lie.
    type("modifier-group-max", "abc");
    expect(held()).toBe(true);

    /*
     * Returning to single mode makes the maximum unwritable — `handleSave`
     * hard-codes 1 and never reads the field, which is not even rendered any
     * more. This is the exact sequence that used to hold the item forever with
     * nothing on screen to put back, and it is the line Episode 18 narrates.
     */
    pressReal("modifier-group-mode-single");
    expect(exists("modifier-group-max")).toBe(false);
    expect(held()).toBe(false);
    expect(pressIsWired("menu-item-save")).toBe(true);
    expect(pressIsWired("menu-item-delete")).toBe(true);
    tapScrim();
    expect(sheetIsOpen()).toBe(false);
  });

  test("text the save canonicalises away never holds the item — either end of the string", async () => {
    await openItemSheet();
    openGroupA();

    for (const typed of ["Temperature ", " Temperature", "  Temperature  "]) {
      type("modifier-group-name", typed);
      expect([typed, held()]).toEqual([typed, false]);
    }
    for (const typed of ["Rare ", " Rare"]) {
      type("modifier-option-name-opt-rare", typed);
      expect([typed, held()]).toEqual([typed, false]);
    }
    // A price written the long way is the same money.
    type("modifier-option-price-opt-rare", "0");
    expect(held()).toBe(false);
    type("modifier-option-price-opt-rare", "0.00");
    expect(held()).toBe(false);
  });
});

describe("#3572 tester adversarial RETEST — the held sentence is true of every control it names", () => {
  test("the sentence is exact, and every field it calls read-only genuinely is", async () => {
    await openItemSheet();
    openGroupA();
    dirtyGroupA();

    // The copy Seth is approving for the tutorial, character for character.
    expect(MENU_ITEM_OPTIONS_HOLD_NOTE).toBe(
      "Save or cancel the options group first. Until then the item's own" +
        " fields are read-only and it can't be saved, deleted or closed —" +
        " nothing you typed is lost.",
    );
    expect(node("menu-item-options-hold-note").props.children).toBe(
      MENU_ITEM_OPTIONS_HOLD_NOTE,
    );
    expect(pressableFor("menu-item-save").props.accessibilityLabel).toBe(
      `Save item. Unavailable. ${MENU_ITEM_OPTIONS_HOLD_NOTE}`,
    );

    // "the item's own fields are read-only" — all six of them.
    for (const field of [
      "menu-item-name",
      "menu-item-desc",
      "menu-item-price",
      "menu-item-cost",
      "menu-item-available",
      "menu-item-allows-notes",
    ]) {
      const controls = nodes(field).filter(
        (candidate) => candidate.props.disabled !== undefined,
      );
      expect([field, controls.length]).not.toEqual([field, 0]);
      for (const control of controls) {
        expect([field, control.props.disabled]).toEqual([field, true]);
      }
    }
    // ...and the prep-station chips, which are fields in everything but name.
    for (const station of ["kitchen", "bar", "other"]) {
      expect([station, pressIsWired(`menu-item-station-${station}`)]).toEqual([
        station,
        false,
      ]);
    }

    // "it can't be saved, deleted or closed" — all three, at the primitive.
    expect(pressIsWired("menu-item-save")).toBe(false);
    expect(pressIsWired("menu-item-delete")).toBe(false);
    tapScrim();
    requestClose();
    expect(sheetIsOpen()).toBe(true);

    // "nothing you typed is lost" — the draft is still there to prove it, and
    // the editor holding it is on screen, which is what makes the claim safe.
    expect(valueOf("modifier-option-name-opt-rare")).toBe("Blue rare");
    expect(exists("modifier-group-cancel")).toBe(true);
  });

  test("the sibling row refuses in its own handler, and the draft survives the attempt", async () => {
    await openItemSheet();
    openGroupA();
    dirtyGroupA();

    const sibling = nodes("menu-item-option-group-group-b").find(
      (candidate) => typeof candidate.props.onPress === "function",
    );
    if (sibling === undefined) throw new Error("no sibling row rendered");
    expect(sibling.props.disabled).toBe(true);

    // Invoked directly, past `disabled` — the barrier must not be a style.
    act(() => {
      (sibling.props.onPress as () => void)();
    });

    expect(exists("modifier-option-name-opt-rare")).toBe(true);
    expect(valueOf("modifier-option-name-opt-rare")).toBe("Blue rare");
    expect(held()).toBe(true);
    expect(holdAlwaysHasAWayOut()).toBe(true);
  });
});

/* ------------------------------------------------------------------------- *
 * RETEST CYCLE 2 — appended at head `c6e64ad34`, after the P2-4 / P3-3 fix.
 * Nothing above this line was touched.
 *
 * The discard notice is a sentence read out of an assertive live region, and a
 * sentence that was true when it was written can be made false by the very
 * next refetch. One guarded statement now reconciles it, with two disjuncts,
 * and the point of these four tests is that each disjunct is INDEPENDENTLY
 * load-bearing and neither test can be satisfied by the other's disjunct:
 *
 *   - the group comes back          -> only `groups.some(...)` can clear it
 *   - a save in flight then SUCCEEDS -> only `successMessage !== null` can,
 *     because the invalidation refetch has not landed and the live list still
 *     lacks the group at that moment. The test asserts that explicitly, so it
 *     cannot silently start passing for the other reason.
 *
 * The two tests after them guard the opposite direction — a reconciliation
 * that clears too eagerly would turn the lockout's replacement into the
 * disappearance it was supposed to prevent.
 * ------------------------------------------------------------------------- */

const discardNoticeShown = (): boolean =>
  exists("menu-item-options-draft-discarded");

const sentenceOnScreen = (fragment: string): boolean =>
  screenText().includes(fragment);

const DISCARD_SENTENCE =
  "“Temperature” is no longer listed on this item, so your unsaved" +
  " changes to it could not be kept.";

describe("#3572 tester adversarial RETEST 2 — the notice is taken back the moment it stops being true", () => {
  test("the group coming back takes the notice with it, and only the list disjunct can do that", async () => {
    await openItemSheet();
    openGroupA();
    dirtyGroupA();

    refetchWith([{ ...GROUP_B, modifiers: [] }]);
    expect(discardNoticeShown()).toBe(true);
    expect(sentenceOnScreen(DISCARD_SENTENCE)).toBe(true);

    // A corrective refetch brings it back. No save ran, so there is no success
    // message: the list disjunct is the only thing that can clear this.
    refetchWith([
      { ...GROUP_A, modifiers: [...GROUP_A.modifiers] },
      { ...GROUP_B, modifiers: [] },
    ]);

    // The row and the sentence denying it must never share the screen.
    expect(exists("menu-item-option-group-group-a")).toBe(true);
    expect(discardNoticeShown()).toBe(false);
    expect(sentenceOnScreen(DISCARD_SENTENCE)).toBe(false);
    expect(held()).toBe(false);
    expect(pressIsWired("menu-item-save")).toBe(true);
  });

  test("a save that succeeds after the discard takes the notice back, with the list still lacking the group", async () => {
    await openItemSheet();
    openGroupA();
    dirtyGroupA();

    pressReal("modifier-group-save");
    const call = saveGroupMutate.mock.calls[0];
    if (call === undefined) throw new Error("the group save never fired");

    // The refetch lands mid-flight and the group is gone from the list.
    refetchWith([{ ...GROUP_B, modifiers: [] }]);
    expect(discardNoticeShown()).toBe(true);

    /*
     * The write then SUCCEEDS, so the changes were kept after all. The
     * invalidation refetch has not landed yet, which is the whole reason the
     * list disjunct cannot carry this case — asserted, not assumed, so this
     * test can never quietly start passing for the other reason.
     */
    act(() => {
      (call[1] as SaveGroupCallbacks).onSuccess?.({
        ...GROUP_A,
        modifiers: [{ ...GROUP_A.modifiers[0]!, name: "Blue rare" }],
      });
      (call[1] as SaveGroupCallbacks).onSettled?.();
    });
    expect(groups.some((group) => group.id === "group-a")).toBe(false);
    expect(groups.some((group) => group.name === "Temperature")).toBe(false);

    // "could not be kept" and "saved with 1 option" must never share a screen.
    expect(discardNoticeShown()).toBe(false);
    expect(sentenceOnScreen(DISCARD_SENTENCE)).toBe(false);
    expect(sentenceOnScreen("Temperature saved with 1 option.")).toBe(true);
    expect(held()).toBe(false);
    expect(pressIsWired("menu-item-save")).toBe(true);
  });

  test("a save that FAILS after the discard keeps the notice, because nothing else would say so", async () => {
    await openItemSheet();
    openGroupA();
    dirtyGroupA();

    pressReal("modifier-group-save");
    const call = saveGroupMutate.mock.calls[0];
    if (call === undefined) throw new Error("the group save never fired");

    refetchWith([{ ...GROUP_B, modifiers: [] }]);
    act(() => {
      (call[1] as SaveGroupCallbacks).onError?.(new Error("network"));
      (call[1] as SaveGroupCallbacks).onSettled?.();
    });

    /*
     * Here the changes really were lost. The editor is gone with the group, and
     * the group's own save-failure surface renders INSIDE that editor, so this
     * notice is the only thing on screen that can state the loss. Clearing it
     * would trade the lockout for the silent disappearance the notice exists
     * to prevent.
     */
    expect(exists("menu-modifier-group-editor")).toBe(false);
    expect(exists("modifier-group-save-error")).toBe(false);
    expect(discardNoticeShown()).toBe(true);
    expect(sentenceOnScreen(DISCARD_SENTENCE)).toBe(true);
    expect(sentenceOnScreen("saved with")).toBe(false);

    // Stated, not trapped: the sheet is usable again.
    expect(held()).toBe(false);
    expect(pressIsWired("menu-item-save")).toBe(true);
  });

  test("a success message left over from an EARLIER save cannot swallow a later notice", async () => {
    await openItemSheet();
    openGroupA();
    dirtyGroupA();

    // Save group A for real, which leaves "Temperature saved with 1 option."
    pressReal("modifier-group-save");
    const first = saveGroupMutate.mock.calls[0];
    if (first === undefined) throw new Error("the group save never fired");
    const saved: MenuModifierGroup = {
      ...GROUP_A,
      modifiers: [{ ...GROUP_A.modifiers[0]!, name: "Blue rare" }],
    };
    groups = [saved, { ...GROUP_B, modifiers: [] }];
    act(() => {
      (first[1] as SaveGroupCallbacks).onSuccess?.(saved);
      (first[1] as SaveGroupCallbacks).onSettled?.();
    });
    expect(sentenceOnScreen("Temperature saved with 1 option.")).toBe(true);

    /*
     * Now a DIFFERENT group is opened and dirtied, and that one vanishes. If
     * the success message from the previous save were still live, the
     * `successMessage` disjunct would swallow this notice and the second loss
     * would go unstated. Entering an editor is the only route to a dirty
     * draft, and every route into an editor clears the success message — this
     * is that argument, tested rather than reasoned.
     */
    press("menu-item-option-group-group-b");
    type("modifier-group-name", "Extras and sides");
    expect(held()).toBe(true);

    refetchWith([saved]);

    expect(discardNoticeShown()).toBe(true);
    expect(
      sentenceOnScreen(
        "“Extras” is no longer listed on this item, so your unsaved" +
          " changes to it could not be kept.",
      ),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------------- *
 * RETEST CYCLE 3 — appended at head `977c5c5c0`, after the P3-5 fix keyed the
 * retraction on identity. Nothing above this line was touched.
 *
 * One test, deliberately. The implementor's own P3-5 proof asserts only that
 * the notice IS present, which is sound against the two disjunct deletions —
 * removing a disjunct can only make the retraction fire LESS, so a presence
 * assertion cannot be broken by one. But presence-only is one-directional in
 * two ways it does not cover:
 *
 *   1. It never exercises the id key in the FIRING direction with a twin on
 *      screen. It proves a sibling cannot retract; it does not prove the real
 *      group returning still can while that sibling is there.
 *   2. Over two identically-named groups it cannot see WHICH group the notice
 *      is about, so an id and a name that had drifted apart would read the
 *      same.
 *
 * This closes both on one timeline, with the twin present throughout, and it
 * is falsifiable in both directions: keying back to `name` reds the presence
 * half, deleting `groups.some(...)` reds the retraction half.
 * ------------------------------------------------------------------------- */

/** A second group with the SAME name on the same item. */
const GROUP_A_TWIN: MenuModifierGroup = {
  ...GROUP_A,
  id: "group-a-twin",
  sortOrder: 2,
  modifiers: [],
};

const freshGroupA = (): MenuModifierGroup => ({
  ...GROUP_A,
  modifiers: [...GROUP_A.modifiers],
});

describe("#3572 tester adversarial RETEST 3 — the retraction follows identity, in both directions", () => {
  test("with a same-named twin on screen throughout, the notice tracks the group that actually went", async () => {
    groups = [
      freshGroupA(),
      { ...GROUP_A_TWIN },
      { ...GROUP_B, modifiers: [] },
    ];
    await openItemSheet();
    openGroupA();
    dirtyGroupA();
    expect(held()).toBe(true);

    /*
     * (a) `group-a` goes; `group-a-twin` stays, carrying the same name.
     *
     * `menu_modifier_groups.name` has no unique constraint and
     * `validateModifierGroup` never checks uniqueness, so this is an ordinary
     * dish, not a contrived one. A retraction keyed on the name would let the
     * twin speak for the group that actually vanished and the loss would go
     * unstated — the silent disappearance, back for this case.
     */
    refetchWith([{ ...GROUP_A_TWIN }, { ...GROUP_B, modifiers: [] }]);
    expect(exists("menu-item-option-group-group-a")).toBe(false);
    expect(exists("menu-item-option-group-group-a-twin")).toBe(true);
    expect(discardNoticeShown()).toBe(true);
    expect(sentenceOnScreen(DISCARD_SENTENCE)).toBe(true);
    expect(held()).toBe(false);
    expect(pressIsWired("menu-item-save")).toBe(true);

    /*
     * (b) The FIRING direction, which presence alone never reaches: the real
     * group comes back while the twin is still there. Identity is what makes
     * this a return rather than a coincidence, and the sentence must be taken
     * back.
     */
    refetchWith([
      freshGroupA(),
      { ...GROUP_A_TWIN },
      { ...GROUP_B, modifiers: [] },
    ]);
    expect(exists("menu-item-option-group-group-a")).toBe(true);
    expect(discardNoticeShown()).toBe(false);
    expect(sentenceOnScreen(DISCARD_SENTENCE)).toBe(false);

    /*
     * (c) Round again, with the twin RENAMED in the very refetch that drops
     * the edited group. Now the two groups are distinguishable, so this reads
     * WHICH group the notice is about — the one that went, not the one still
     * listed. Two identically-named groups cannot tell those apart, which is
     * why an id and a name that had drifted would look identical without this.
     */
    openGroupA();
    dirtyGroupA();
    refetchWith([
      { ...GROUP_A_TWIN, name: "Doneness" },
      { ...GROUP_B, modifiers: [] },
    ]);
    expect(discardNoticeShown()).toBe(true);
    expect(sentenceOnScreen(DISCARD_SENTENCE)).toBe(true);
    expect(sentenceOnScreen("“Doneness” is no longer listed")).toBe(false);

    // (d) And the twin leaving too changes nothing: the notice is about
    // `group-a`, and `group-a` is still gone.
    refetchWith([{ ...GROUP_B, modifiers: [] }]);
    expect(discardNoticeShown()).toBe(true);
    expect(sentenceOnScreen(DISCARD_SENTENCE)).toBe(true);
    expect(held()).toBe(false);
    expect(pressIsWired("menu-item-save")).toBe(true);
  });
});
