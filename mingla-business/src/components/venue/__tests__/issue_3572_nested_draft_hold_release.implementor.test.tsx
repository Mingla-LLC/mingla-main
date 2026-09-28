/**
 * Issue #3572 REWORK guard — the hold must also LET GO.
 *
 * PR #3621 proved the guard direction: nothing can throw an unsaved options
 * draft away. TEST found the other direction, and it is the dangerous one —
 * the hold could get STUCK, and in one case it locked the venue owner out of
 * the sheet entirely while the on-screen note told them nothing was lost.
 *
 * Why this file and not the existing `issue_3572_nested_draft_guard
 * .implementor.test.tsx`: that suite doubles `ui/Sheet`, `ui/Button` and
 * `ui/Input` at MODULE scope, so its dismissal proofs are props echoed into a
 * mock — a `MockButton` forwards `onPress` whatever `disabled` says, so
 * "released" there cannot distinguish a control that is live from one that only
 * looks it. `jest.mock` cannot be scoped to a describe block, and re-pointing
 * those three doubles would mean rewriting eleven passing tests. So the RELEASE
 * direction gets its own file, mounting the SHIPPED primitives:
 *
 *   VenueMenuModule -> MenuItemSheet -> ui/Sheet (SheetMobile) -> RN Modal +
 *   the real scrim Pressable, with the real ui/Button, ui/Input, ui/GlassCard,
 *   ui/BrandSwitch and ui/ConfirmDialog, around the real lazily loaded
 *   MenuItemOptionsSection -> MenuModifierGroupEditor.
 *
 * Only the DEVICE layer is doubled, because a node environment has no native
 * module to bind to: reanimated, gesture-handler, react-native-svg, expo-blur,
 * expo-haptics, and the two data hooks. Every decision under test is taken by
 * shipped source in this tree — "released" here means the real `Button` left a
 * press handler attached and the real `Sheet` actually stopped taking input.
 *
 * One test per defect from the TEST verdict:
 *   P0-1  a refetch that drops the edited group must release the hold, say what
 *         happened to the draft, and hand every control back.
 *   P2-1  the comparison runs over what would be WRITTEN, not what was TYPED.
 *   P2-2  the note describes the freeze it actually causes.
 *   P2-3  the sibling-group row refuses on its own, not only via `disabled`.
 *
 * Honest limit: source + jest only. No simulator, device or signed-in web run
 * backs this file; the physical native drag remains Seth's pass.
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
  update: (node: React.ReactElement) => void;
  unmount: () => void;
}

interface RendererApi {
  create: (node: React.ReactElement) => TestRenderer;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
}

const upsertItemMutate =
  jest.fn<
    (
      payload: Record<string, unknown>,
      callbacks?: Record<string, unknown>,
    ) => void
  >();
const saveGroupMutate = jest.fn<(input: ModifierGroupSaveInput) => void>();
const idleMutate = jest.fn();

/**
 * "Rare" carries no delta, "Blue" carries 250 cents — so its hydrated draft
 * string is `"2.5"`, which is what makes the `"2.50"` retype a real test of the
 * write-shaped comparison rather than a string comparison in disguise.
 */
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
    {
      id: "opt-blue",
      groupId: "group-a",
      name: "Blue",
      priceDeltaCents: 250,
      currency: "USD",
      isAvailable: true,
      sortOrder: 1,
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

jest.mock("react-native", () => {
  /*
   * `jest.mock` factories hoist above every import and react-native is the
   * first module the product chain requires, so this is the earliest point at
   * which `__DEV__` can be defined. The REAL `SheetMobile.tsx` reads it at
   * module scope (its #1022 drag-band assertion), and this suite renders that
   * file rather than a double.
   */
  (globalThis as unknown as { __DEV__?: boolean }).__DEV__ ??= false;
  const actual = jest.requireActual("react-native") as Record<string, unknown>;
  const accessibility = actual.AccessibilityInfo as Record<string, unknown>;
  return {
    ...actual,
    AccessibilityInfo: {
      ...accessibility,
      announceForAccessibility: () => undefined,
      setAccessibilityFocus: () => undefined,
    },
    // `react-native-svg` (reached through the REAL `ui/Icon` inside the REAL
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

/* DEVICE LAYER ONLY — animation settles instantly; no decision lives here. */
jest.mock("react-native-reanimated", () => {
  const react = jest.requireActual("react") as typeof React;
  const rn = jest.requireActual("react-native") as Record<string, unknown>;
  const settle = (value: unknown): unknown => value;
  const easing = (): number => 0;
  return {
    __esModule: true,
    default: { View: rn.View, Text: rn.Text, ScrollView: rn.ScrollView },
    Easing: {
      cubic: easing,
      linear: easing,
      ease: easing,
      quad: easing,
      bezier: () => easing,
      in: (fn: unknown) => fn,
      out: (fn: unknown) => fn,
      inOut: (fn: unknown) => fn,
    },
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

/* DEVICE LAYER ONLY. */
jest.mock("react-native-gesture-handler", () => {
  const react = jest.requireActual("react") as typeof React;
  const rn = jest.requireActual("react-native") as Record<string, unknown>;
  const makePan = (): Record<string, unknown> => {
    const chain: Record<string, unknown> = {};
    const step = (): Record<string, unknown> => chain;
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
      chain[name] = step;
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

/* DEVICE LAYER ONLY — only the vector leaves are inert; `ui/Button` is real. */
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
  useDeleteMenuItem: () => ({ mutate: idleMutate, isPending: false }),
  useReorderMenuItems: () => ({ mutate: idleMutate, isPending: false }),
}));

/*
 * `groups` is read on every render, which is exactly how the real query
 * behaves: a reconnect refetch swaps the array under an open editor.
 */
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
import { Pressable, TextInput } from "react-native";
// eslint-disable-next-line import/first
import { VenueMenuModule } from "../VenueMenuModule";
// eslint-disable-next-line import/first
import { MENU_ITEM_OPTIONS_HOLD_NOTE } from "../MenuItemSheet";
// eslint-disable-next-line import/first
import { menuOptionsDraftDiscardedMessage } from "../MenuItemOptionsSection";

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
  if (last === undefined) throw new Error(`${testID} rendered no Pressable`);
  return last;
};

/** Whether the SHIPPED primitive left a press handler attached at all. */
const pressIsWired = (testID: string): boolean =>
  typeof pressableFor(testID).props.onPress === "function";

/** Press through the SHIPPED primitive: a stripped `onPress` is a refusal. */
const pressReal = (testID: string): void => {
  const handler = pressableFor(testID).props.onPress;
  if (typeof handler !== "function") return;
  act(() => {
    (handler as (event: unknown) => void)({});
  });
};

/** Invoke the raw handler, ignoring `disabled` — the P2-3 attack. */
const invokeHandler = (testID: string): void => {
  const handler = node(testID).props.onPress;
  if (typeof handler !== "function") throw new Error(`${testID} has no press`);
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

/**
 * The SHIPPED `Input`'s own statement about whether it takes typing — read off
 * the `TextInput` it renders, not off the `disabled` prop handed to it.
 */
const isEditable = (testID: string): boolean => {
  const host = nodes(testID)[0];
  if (host === undefined) throw new Error(`${testID} did not render`);
  const fields = host.findAllByType(TextInput);
  const target = fields[fields.length - 1];
  if (target === undefined) throw new Error(`${testID} rendered no TextInput`);
  return target.props.editable === true;
};

/** Whether the raw row `Pressable` is visually barred (its only old layer). */
const pressIsBarred = (testID: string): boolean =>
  pressableFor(testID).props.disabled === true;

const held = (): boolean => exists("menu-item-options-hold-note");

/**
 * Whether the SHIPPED sheet still takes input. Presence proves nothing — the
 * real primitive keeps its node mounted while the close animation plays — so
 * this reads the primitive's own `pointerEvents` statement.
 */
const sheetIsOpen = (): boolean => {
  const root = nodes("menu-item-sheet").find(
    (candidate) => candidate.props.pointerEvents !== undefined,
  );
  return root !== undefined && root.props.pointerEvents === "auto";
};

/** The real scrim: `SheetMobile` labels it for screen readers. */
const tapScrim = (): void => {
  const found = tree.root.findAllByProps({
    accessibilityLabel: "Dismiss sheet",
  });
  const target = found.find(
    (candidate) => typeof candidate.props.onPress === "function",
  );
  if (target === undefined) throw new Error("no scrim Pressable rendered");
  act(() => {
    (target.props.onPress as () => void)();
  });
};

/** Every visible text string in the tree, flattened. */
const screenText = (): string => {
  const out: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const entry of value) collect(entry);
  };
  for (const candidate of tree.root.findAllByProps({})) {
    collect(candidate.props.children);
  }
  return out.join(" ");
};

const openItemSheet = async (): Promise<void> => {
  await actAsync(async () => {
    tree = renderer.create(
      <VenueMenuModule brandId="brand-a" venueId="venue-a" />,
    );
  });
  invokeHandler("venue-menu-item-edit-item-a");
  await actAsync(async () => {
    await Promise.resolve();
  });
};

const openGroupA = (): void => {
  invokeHandler("menu-item-option-group-group-a");
};

/** A refetch lands with a different list, exactly as a reconnect would. */
const refetchWith = (next: MenuModifierGroup[]): void => {
  groups = next;
  act(() => {
    tree.update(<VenueMenuModule brandId="brand-a" venueId="venue-a" />);
  });
};

beforeEach(() => {
  upsertItemMutate.mockReset();
  saveGroupMutate.mockReset();
  idleMutate.mockReset();
  groups = [
    { ...GROUP_A, modifiers: [...GROUP_A.modifiers] },
    { ...GROUP_B, modifiers: [] },
  ];
});

describe("#3572 rework — the hold releases, through the shipped primitives", () => {
  test("P0-1: a refetch that drops the edited group releases the hold, says what happened, and hands every control back", async () => {
    await openItemSheet();
    openGroupA();
    type("modifier-option-name-opt-rare", "Blue rare");

    // Control run: the hold really is engaged before the refetch.
    expect(held()).toBe(true);
    expect(pressIsWired("menu-item-save")).toBe(false);
    expect(exists("menu-modifier-group-editor")).toBe(true);

    // The group is gone server-side — removed from another device or tab —
    // and a reconnect refetch brings back a list without it.
    refetchWith([{ ...GROUP_B, modifiers: [] }]);

    // The editor is gone, so the hold must be gone with it. Every one of these
    // is an independent way out; the lockout had none of them.
    expect(exists("menu-modifier-group-editor")).toBe(false);
    expect(held()).toBe(false);
    expect(pressIsWired("menu-item-save")).toBe(true);
    expect(pressIsWired("menu-item-delete")).toBe(true);
    expect(exists("menu-item-options-add")).toBe(true);

    // And the loss is stated, not swallowed: the note that used to promise
    // "nothing you typed is lost" is replaced by the truth.
    expect(exists("menu-item-options-draft-discarded")).toBe(true);
    expect(screenText()).toContain(
      menuOptionsDraftDiscardedMessage("Temperature"),
    );
    expect(screenText()).not.toContain(MENU_ITEM_OPTIONS_HOLD_NOTE);

    // The item mutation is reachable again...
    pressReal("menu-item-save");
    expect(upsertItemMutate).toHaveBeenCalledTimes(1);
  });

  test("P0-1: after the same refetch the shipped sheet can actually be dismissed", async () => {
    await openItemSheet();
    openGroupA();
    type("modifier-option-name-opt-rare", "Blue rare");

    tapScrim();
    expect(sheetIsOpen()).toBe(true); // control: refused while held

    refetchWith([{ ...GROUP_B, modifiers: [] }]);

    tapScrim();
    expect(sheetIsOpen()).toBe(false);
  });

  test("P2-1: a maximum typed in multi and abandoned by returning to single releases the hold", async () => {
    await openItemSheet();
    openGroupA();

    pressReal("modifier-group-mode-multi");
    expect(held()).toBe(true);
    type("modifier-group-max", "3");
    expect(held()).toBe(true);

    // The maximum field is not even rendered in single mode, so there is no
    // control left showing an unsaved change — and `handleSave` hard-codes the
    // written maximum to 1 here, so the payload is back to the hydrated one.
    pressReal("modifier-group-mode-single");
    expect(exists("modifier-group-max")).toBe(false);
    expect(held()).toBe(false);
    expect(pressIsWired("menu-item-save")).toBe(true);
  });

  test("P2-1: values the save canonicalises away do not hold the item", async () => {
    await openItemSheet();
    openGroupA();

    // A trailing space the text validator strips before writing.
    type("modifier-group-name", "Temperature ");
    expect(held()).toBe(false);

    // The same cents, typed with the trailing zero the hydrated draft omits.
    type("modifier-option-price-opt-blue", "2.50");
    expect(held()).toBe(false);

    // A real change still holds — the comparison is not simply switched off.
    type("modifier-option-price-opt-blue", "2.51");
    expect(held()).toBe(true);
    type("modifier-option-price-opt-blue", "2.5");
    expect(held()).toBe(false);
  });

  test("P2-2: the note names the read-only fields it actually causes", async () => {
    await openItemSheet();
    openGroupA();

    expect(isEditable("menu-item-name")).toBe(true);
    type("modifier-option-name-opt-rare", "Blue rare");

    // The freeze is real...
    expect(isEditable("menu-item-name")).toBe(false);
    expect(isEditable("menu-item-price")).toBe(false);
    expect(pressIsWired("menu-item-delete")).toBe(false);

    // ...so the sentence has to say so. All three consequences, in words.
    const note = MENU_ITEM_OPTIONS_HOLD_NOTE;
    expect(note).toContain("read-only");
    expect(note).toContain("deleted");
    expect(note).toContain("closed");
    expect(node("menu-item-options-hold-note").props.children).toBe(note);
    // P3-1: no id pointing at an association nothing ever consumed.
    expect(node("menu-item-options-hold-note").props.nativeID).toBeUndefined();
  });

  test("P2-3: the sibling-group row refuses on its own, not only through `disabled`", async () => {
    await openItemSheet();
    openGroupA();
    type("modifier-option-name-opt-rare", "Blue rare");

    // Control: the visual barrier is there. Unlike `ui/Button`, a raw
    // `Pressable` keeps its `onPress` prop while disabled — which is exactly
    // why `disabled` alone was never a real refusal here.
    expect(pressIsBarred("menu-item-option-group-group-b")).toBe(true);

    // Now fire the handler past it, the way a refactor that loses `disabled`
    // would. The draft must survive and the hold must stay engaged.
    invokeHandler("menu-item-option-group-group-b");

    expect(exists("modifier-option-name-opt-rare")).toBe(true);
    expect(held()).toBe(true);
    expect(exists("menu-modifier-group-editor")).toBe(true);
    expect(node("menu-modifier-group-editor")).toBeDefined();
    // Group B's editor never opened over the top of the unsaved draft.
    expect(exists("modifier-group-max")).toBe(false);
  });
});
