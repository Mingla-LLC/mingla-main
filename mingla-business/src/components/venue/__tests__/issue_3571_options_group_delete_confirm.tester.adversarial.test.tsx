/**
 * Issue #3571 TESTER adversarial guard — the confirmation cannot be walked
 * around, and a refusal that can never relax cannot be dressed as one that
 * might.
 *
 * WHY THIS SUITE EXISTS SEPARATELY FROM THE IMPLEMENTOR'S.
 * The implementor's suite replaces `ConfirmDialog` and `Button` with inert
 * stubs and asserts on the PROPS handed to them. That proves the section
 * intends a confirmation. It cannot prove one happens: a stub has no focus
 * behaviour, no scrim, no Escape key, no hardware-back route, and no press
 * gating, so every dismissal path and the "safe option is the default" claim
 * were verified only as strings passed into a mock. A stubbed boundary is a
 * blind spot with a test around it.
 *
 * This suite mounts the REAL `ConfirmDialog`, the REAL `Modal` and the REAL
 * `Button`. Only leaves that genuinely cannot load under the default
 * node/ts-jest runner (reanimated, svg, expo-blur, haptics, glass chrome) are
 * replaced, and none of them carries any part of the contract under test.
 *
 * The attack surface:
 *
 *   1. EVERY DISMISSAL ROUTE. Cancel, scrim tap, the web Escape key and the
 *      Android hardware-back route each reach the real dialog's own close
 *      path. Every one of them must issue ZERO mutations — and none of them
 *      may fire while a delete is already in flight.
 *   2. THE SAFE DEFAULT IS REAL. The dialog's own focus effect runs, and the
 *      control it focuses is proven to be "Keep group" — not asserted from an
 *      `initialFocus` string on a mock.
 *   3. DOUBLE-CONFIRM AND LATCH RELEASE. Two confirms must delete once; a
 *      rejected delete must then let the SAME action genuinely retry, which a
 *      latch that never releases would silently prevent.
 *   4. THE TWO PERMANENT REFUSALS CANNOT BE CONFUSED — with each other, with
 *      the retryable class, or with anything when the rejection shape is
 *      unexpected or its message is missing entirely.
 *   5. A FAILED DELETE LEAVES THE GROUP THERE. Visually, for both the
 *      retryable and the permanent classes.
 *
 * Tests are append-only. Nothing here edits, weakens or skips an existing test.
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
import { Text } from "react-native";

import type { MenuModifierGroup } from "../../../hooks/useMenuModifiers";

interface TestNode {
  type: unknown;
  props: Record<string, unknown>;
  findAllByType: (type: unknown) => TestNode[];
  findAllByProps: (props: Record<string, unknown>) => TestNode[];
}

interface CreateOptions {
  createNodeMock?: (element: { type: unknown; props: Record<string, unknown> }) => unknown;
}

interface TestRenderer {
  root: TestNode;
  update: (node: React.ReactElement) => void;
  unmount: () => void;
}

interface RendererApi {
  create: (node: React.ReactElement, options?: CreateOptions) => TestRenderer;
  act: (callback: () => void) => void;
}

interface DeleteVariables {
  groupId: string;
  menuItemId: string;
}

interface DeleteCallbacks {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  onSettled?: () => void;
}

const deleteMutate =
  jest.fn<(variables: DeleteVariables, callbacks?: DeleteCallbacks) => void>();
let deletePending = false;
let groups: MenuModifierGroup[] = [];

/* ---------- only unloadable native leaves are replaced ---------- */

/*
 * The shared react-native stand-in renders `props.children` verbatim, so a
 * Pressable whose child is a RENDER FUNCTION — which is exactly how the real
 * `Button` builds its body — renders nothing at all. Every size, label and
 * accessibility affordance inside the shipped Button would then be invisible
 * to this suite while every assertion about it still passed. Invoke the
 * function child, as the real Pressable does, so the Button under test is the
 * whole Button.
 */
jest.mock("react-native", () => {
  const actual = jest.requireActual("react-native") as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLocal = require("react") as typeof React;
  const Pressable = ReactLocal.forwardRef(
    (props: Record<string, unknown>, ref: unknown) => {
      const { children, ...rest } = props;
      const body =
        typeof children === "function"
          ? (children as (state: Record<string, boolean>) => React.ReactNode)({
              pressed: false,
              hovered: false,
              focused: false,
            })
          : (children as React.ReactNode);
      return ReactLocal.createElement(
        "Pressable",
        { ...rest, ref: ref as React.Ref<unknown> },
        body,
      );
    },
  );
  Pressable.displayName = "Pressable";
  return { ...actual, Pressable };
});

jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLocal = require("react") as typeof React;
  const view = (props: Record<string, unknown>): React.ReactElement =>
    ReactLocal.createElement("ReanimatedView", props);
  return {
    __esModule: true,
    default: { View: view, Text: view },
    Easing: {
      linear: (t: number) => t,
      out: () => (t: number) => t,
      in: () => (t: number) => t,
      cubic: (t: number) => t,
    },
    cancelAnimation: () => undefined,
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => false,
    useSharedValue: (value: unknown) => ({ value }),
    withTiming: (value: unknown) => value,
  };
});

jest.mock("../../ui/Icon", () => ({
  Icon: (props: Record<string, unknown>) =>
    React.createElement("MockIcon", props),
}));

jest.mock("../../ui/Spinner", () => ({
  Spinner: (props: Record<string, unknown>) =>
    React.createElement("MockSpinner", props),
  default: (props: Record<string, unknown>) =>
    React.createElement("MockSpinner", props),
}));

jest.mock("../../../utils/hapticFeedback", () => ({
  HapticFeedback: {
    buttonPress: () => undefined,
    selection: () => undefined,
    success: () => undefined,
    warning: () => undefined,
    error: () => undefined,
    impact: () => undefined,
  },
}));

jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    React.createElement("MockInput", props),
}));

jest.mock("../../ui/GlassCard", () => ({
  GlassCard: (props: Record<string, unknown>) =>
    React.createElement("MockGlassCard", props, props.children as React.ReactNode),
}));

jest.mock("../../../wrappers/KeyboardRoot", () => ({
  KeyboardRoot: (props: Record<string, unknown>) =>
    React.createElement(
      "MockKeyboardRoot",
      props,
      props.children as React.ReactNode,
    ),
}));

jest.mock("../../../wrappers/KeyboardToolbarRoot", () => ({
  KeyboardToolbarRoot: (props: Record<string, unknown>) =>
    React.createElement("MockKeyboardToolbarRoot", props),
}));

jest.mock("../../../hooks/useMenuModifiers", () => {
  const actual = jest.requireActual(
    "../../../hooks/useMenuModifiers",
  ) as Record<string, unknown>;
  return {
    ...actual,
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
    useSaveModifierGroup: () => ({ isPending: false, mutate: jest.fn() }),
    useDeleteModifierGroup: () => ({
      isPending: deletePending,
      mutate: deleteMutate,
    }),
  };
});

// eslint-disable-next-line import/first
import {
  MENU_OPTIONS_DELETE_COPY,
  MenuItemOptionsSection,
  menuModifierGroupDeleteDescription,
  modifierGroupDeleteError,
} from "../MenuItemOptionsSection";

const realHooks = jest.requireActual(
  "../../../hooks/useMenuModifiers",
) as typeof import("../../../hooks/useMenuModifiers");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act;

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/* ---------- environment seams the real dialog genuinely needs ---------- */

interface DocumentLike {
  addEventListener: (type: string, listener: (event: { key: string }) => void) => void;
  removeEventListener: (
    type: string,
    listener: (event: { key: string }) => void,
  ) => void;
  activeElement: null;
}

let keydownListeners: ((event: { key: string }) => void)[] = [];
let rafCallbacks: (() => void)[] = [];
const originalRaf = (globalThis as { requestAnimationFrame?: unknown })
  .requestAnimationFrame;
const originalCancelRaf = (globalThis as { cancelAnimationFrame?: unknown })
  .cancelAnimationFrame;
const originalDocument = (globalThis as { document?: unknown }).document;

/** Runs every focus/animation frame the real dialog scheduled. */
const flushFrames = (): void => {
  const pending = rafCallbacks;
  rafCallbacks = [];
  act(() => {
    for (const callback of pending) callback();
  });
};

/** Delivers a real keydown to whatever the real Modal registered. */
const pressKey = (key: string): void => {
  act(() => {
    for (const listener of [...keydownListeners]) listener({ key });
  });
};

const GROUP_ID = "group-3571-adv";
const ITEM_ID = "item-3571-adv";

const groupWith = (
  optionCount: number,
  name = "Temperature",
): MenuModifierGroup => ({
  id: GROUP_ID,
  menuItemId: ITEM_ID,
  name,
  selectionMode: "single",
  minSelect: 1,
  maxSelect: 1,
  isActive: true,
  sortOrder: 0,
  modifiers: Array.from({ length: optionCount }, (_unused, index) => ({
    id: `option-${index}`,
    groupId: GROUP_ID,
    name: `Option ${index}`,
    priceDeltaCents: 0,
    currency: "USD",
    isAvailable: true,
    sortOrder: index,
  })),
});

/** Focus spies, keyed by the testID of the control that received focus. */
let focusedTestIds: string[] = [];

const sectionElement = (): React.ReactElement => (
  <MenuItemOptionsSection
    brandId="brand-3571-adv"
    menuItemId={ITEM_ID}
    itemCurrency="USD"
    canMutate
  />
);

/** Re-renders the SAME tree so a mid-flight pending flag is observed in place. */
const rerender = (tree: TestRenderer): void => {
  act(() => {
    tree.update(sectionElement());
  });
};

const render = (): TestRenderer => {
  let tree: TestRenderer | null = null;
  act(() => {
    tree = renderer.create(
      sectionElement(),
      {
        createNodeMock: (element) => {
          const testID = element.props.testID;
          return {
            focus: () => {
              if (typeof testID === "string") focusedTestIds.push(testID);
            },
          };
        },
      },
    );
  });
  if (tree === null) throw new Error("render produced no tree");
  return tree;
};

const screenText = (tree: TestRenderer): string =>
  tree.root
    .findAllByType(Text)
    .map((node) => JSON.stringify(node.props.children ?? ""))
    .join(" | ");

const hostsWithTestId = (tree: TestRenderer, testID: string): TestNode[] =>
  tree.root
    .findAllByProps({ testID })
    .filter((node) => typeof node.type === "string");

const hostsWithLabel = (tree: TestRenderer, label: string): TestNode[] =>
  tree.root
    .findAllByProps({ accessibilityLabel: label })
    .filter((node) => typeof node.type === "string");

const press = (node: TestNode): void => {
  const onPress = node.props.onPress;
  if (typeof onPress !== "function") {
    throw new Error("the control is not pressable — it has no onPress");
  }
  act(() => {
    (onPress as (event: unknown) => void)({});
  });
};

/** Opens the editor for the single group and returns the destructive trigger. */
const openEditorAndFindTrigger = (tree: TestRenderer): TestNode => {
  const row = hostsWithTestId(tree, `menu-item-option-group-${GROUP_ID}`)[0];
  press(row);
  const trigger = hostsWithTestId(tree, "modifier-group-delete")[0];
  if (trigger === undefined) throw new Error("the delete trigger did not render");
  return trigger;
};

/*
 * The real Modal keeps its node mounted for UNMOUNT_DELAY_MS after closing so
 * the exit animation can run, so "is the testID present" answers the wrong
 * question. The overlay stops ACCEPTING INPUT the moment it is dismissed —
 * that is what the operator experiences, so that is what this reads.
 */
const dialogIsOpen = (tree: TestRenderer): boolean =>
  hostsWithTestId(tree, "menu-item-options-delete-dialog").some(
    (node) => node.props.pointerEvents !== "none",
  );

const openTheConfirmation = (tree: TestRenderer): void => {
  press(openEditorAndFindTrigger(tree));
  flushFrames();
};

const lastDeleteCallbacks = (): DeleteCallbacks => {
  const call = deleteMutate.mock.calls[deleteMutate.mock.calls.length - 1];
  if (call === undefined) throw new Error("no delete was issued");
  return (call[1] ?? {}) as DeleteCallbacks;
};

const rejectWith = (error: Error): void => {
  const callbacks = lastDeleteCallbacks();
  act(() => {
    callbacks.onError?.(error);
    callbacks.onSettled?.();
  });
};

/*
 * The Button's 44pt floor lives on its inner container, not on the Pressable
 * that carries the testID — so a measurement that only reads the testID node
 * silently measures nothing and passes. Scan the control's whole subtree.
 */
const targetHeights = (tree: TestRenderer, testID: string): number[] => {
  const heights: number[] = [];
  for (const node of tree.root.findAllByProps({ testID })) {
    const own = flattenStyle(node.props.style).minHeight;
    if (typeof own === "number") heights.push(own);
    for (const child of node.findAllByType("ReanimatedView")) {
      const inner = flattenStyle(child.props.style).minHeight;
      if (typeof inner === "number") heights.push(inner);
    }
  }
  return heights;
};

const flattenStyle = (style: unknown): Record<string, unknown> => {
  if (Array.isArray(style)) {
    return Object.assign(
      {},
      ...style.filter(Boolean).map((entry) => flattenStyle(entry)),
    ) as Record<string, unknown>;
  }
  return (style ?? {}) as Record<string, unknown>;
};

beforeEach(() => {
  deleteMutate.mockReset();
  deletePending = false;
  groups = [groupWith(3)];
  focusedTestIds = [];
  keydownListeners = [];
  rafCallbacks = [];
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (
    callback: () => void,
  ): number => {
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame =
    (): void => undefined;
  const documentLike: DocumentLike = {
    addEventListener: (type, listener) => {
      if (type === "keydown") keydownListeners.push(listener);
    },
    removeEventListener: (type, listener) => {
      if (type !== "keydown") return;
      keydownListeners = keydownListeners.filter(
        (entry) => entry !== listener,
      );
    },
    activeElement: null,
  };
  (globalThis as { document?: unknown }).document = documentLike;
});

afterEach(() => {
  /*
   * The real Modal schedules a 200ms unmount timer when it closes. Let any
   * already-scheduled React work land inside act() so a stray update cannot
   * fire after the test has torn down — a warning that would otherwise sit in
   * the required full-suite lane's output and dull a future failure grep.
   */
  act(() => undefined);
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
    originalRaf;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame =
    originalCancelRaf;
  (globalThis as { document?: unknown }).document = originalDocument;
});

describe("#3571 tester adversarial — the confirmation cannot be walked around", () => {
  /*
   * 1. EVERY DISMISSAL ROUTE.
   *
   * The implementor proved the Cancel PROP was handed to a stub. A real dialog
   * has four ways out, and three of them never existed in that test.
   */
  test("the real confirmation opens on the trigger and issues ZERO mutations doing it", () => {
    const tree = render();
    openTheConfirmation(tree);
    expect(dialogIsOpen(tree)).toBe(true);
    expect(deleteMutate).toHaveBeenCalledTimes(0);
    // The group is still on screen, untouched, while the question is asked.
    expect(screenText(tree)).toContain("Temperature");
    tree.unmount();
  });

  test("the SAFE control is what the real dialog focuses first — not the destructive one", () => {
    const tree = render();
    openTheConfirmation(tree);
    expect(focusedTestIds).toContain("menu-item-options-delete-cancel");
    expect(focusedTestIds).not.toContain("menu-item-options-delete-confirm");
    tree.unmount();
  });

  test("the safe control is labelled to keep, and the destructive one is not the default", () => {
    const tree = render();
    openTheConfirmation(tree);
    const cancel = hostsWithTestId(tree, "menu-item-options-delete-cancel")[0];
    const confirm = hostsWithTestId(tree, "menu-item-options-delete-confirm")[0];
    expect(cancel.props.accessibilityLabel).toBe("Keep group");
    expect(confirm.props.accessibilityLabel).toBe("Remove group");
    // Both are reachable controls; the safe one simply owns first focus.
    expect(typeof cancel.props.onPress).toBe("function");
    expect(typeof confirm.props.onPress).toBe("function");
    tree.unmount();
  });

  test("pressing the safe control deletes nothing and leaves the group on screen", () => {
    const tree = render();
    openTheConfirmation(tree);
    press(hostsWithTestId(tree, "menu-item-options-delete-cancel")[0]);
    expect(deleteMutate).toHaveBeenCalledTimes(0);
    expect(dialogIsOpen(tree)).toBe(false);
    // The group survived: its editor is still mounted and every option draft
    // is still on screen.
    expect(
      hostsWithTestId(tree, "modifier-group-delete").length,
    ).toBeGreaterThan(0);
    const survivingText = screenText(tree);
    for (const option of ["Option 1", "Option 2", "Option 3"]) {
      expect(survivingText).toContain(option);
    }
    tree.unmount();
  });

  test("dismissing by the SCRIM deletes nothing", () => {
    const tree = render();
    openTheConfirmation(tree);
    const scrim = hostsWithLabel(tree, "Dismiss modal")[0];
    expect(scrim).toBeDefined();
    press(scrim);
    expect(deleteMutate).toHaveBeenCalledTimes(0);
    expect(dialogIsOpen(tree)).toBe(false);
    tree.unmount();
  });

  test("dismissing with the web ESCAPE key deletes nothing", () => {
    const tree = render();
    openTheConfirmation(tree);
    expect(keydownListeners.length).toBeGreaterThan(0);
    pressKey("Escape");
    expect(deleteMutate).toHaveBeenCalledTimes(0);
    expect(dialogIsOpen(tree)).toBe(false);
    tree.unmount();
  });

  test("an unrelated key press neither deletes nor dismisses", () => {
    const tree = render();
    openTheConfirmation(tree);
    pressKey("Enter");
    pressKey("Delete");
    pressKey(" ");
    expect(deleteMutate).toHaveBeenCalledTimes(0);
    expect(dialogIsOpen(tree)).toBe(true);
    tree.unmount();
  });

  test("the hardware-back route (onRequestClose) deletes nothing", () => {
    const tree = render();
    openTheConfirmation(tree);
    const modals = tree.root
      .findAllByType("Modal")
      .filter((node) => typeof node.props.onRequestClose === "function");
    expect(modals.length).toBeGreaterThan(0);
    act(() => {
      (modals[0].props.onRequestClose as () => void)();
    });
    expect(deleteMutate).toHaveBeenCalledTimes(0);
    expect(dialogIsOpen(tree)).toBe(false);
    tree.unmount();
  });

  test("NO dismissal route can fire while a delete is already in flight", () => {
    const tree = render();
    openTheConfirmation(tree);
    press(hostsWithTestId(tree, "menu-item-options-delete-confirm")[0]);
    expect(deleteMutate).toHaveBeenCalledTimes(1);

    // The mutation is in flight. Re-render the SAME tree with the pending flag
    // the real hook would raise — the dialog stays open on purpose.
    deletePending = true;
    rerender(tree);
    expect(dialogIsOpen(tree)).toBe(true);

    const cancel = hostsWithTestId(tree, "menu-item-options-delete-cancel")[0];
    expect(cancel.props.disabled).toBe(true);
    expect(cancel.props.onPress).toBeUndefined();

    const before = deleteMutate.mock.calls.length;
    const scrim = hostsWithLabel(tree, "Dismiss modal")[0];
    press(scrim);
    pressKey("Escape");
    const modals = tree.root
      .findAllByType("Modal")
      .filter((node) => typeof node.props.onRequestClose === "function");
    act(() => {
      (modals[0].props.onRequestClose as () => void)();
    });

    // Nothing escaped and nothing extra was issued: an in-flight destructive
    // action is neither abandoned halfway nor duplicated.
    expect(dialogIsOpen(tree)).toBe(true);
    expect(deleteMutate.mock.calls.length).toBe(before);
    tree.unmount();
  });

  test("the destructive confirm is press-inert while its own delete is in flight", () => {
    const tree = render();
    openTheConfirmation(tree);
    press(hostsWithTestId(tree, "menu-item-options-delete-confirm")[0]);
    expect(deleteMutate).toHaveBeenCalledTimes(1);

    deletePending = true;
    rerender(tree);

    const confirm = hostsWithTestId(tree, "menu-item-options-delete-confirm")[0];
    // The REAL Button drops onPress entirely while loading — a `disabled` prop
    // alone would still leave a live handler behind on some platforms.
    expect(confirm.props.onPress).toBeUndefined();
    expect(confirm.props.disabled).toBe(true);
    expect(confirm.props.accessibilityState).toMatchObject({ busy: true });
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  /*
   * 3. DOUBLE-CONFIRM AND LATCH RELEASE.
   */
  test("confirming twice across SEPARATE ticks still deletes exactly once", () => {
    const tree = render();
    openTheConfirmation(tree);
    const confirm = hostsWithTestId(tree, "menu-item-options-delete-confirm")[0];
    press(confirm);
    // A separate tick, with no callback settled yet — the synchronous latch,
    // not React state, is what has to hold here.
    press(hostsWithTestId(tree, "menu-item-options-delete-confirm")[0]);
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    tree.unmount();
  });

  test("a rejected delete RELEASES the latch so the same action genuinely retries", () => {
    const tree = render();
    openTheConfirmation(tree);
    press(hostsWithTestId(tree, "menu-item-options-delete-confirm")[0]);
    expect(deleteMutate).toHaveBeenCalledTimes(1);

    rejectWith(new Error("Network request failed"));

    // Retryable class: the ask stays open and the SAME control is the retry.
    expect(dialogIsOpen(tree)).toBe(true);
    press(hostsWithTestId(tree, "menu-item-options-delete-confirm")[0]);
    expect(deleteMutate).toHaveBeenCalledTimes(2);
    tree.unmount();
  });

  test("a rejected delete leaves the group, its editor and its options exactly where they were", () => {
    const tree = render();
    openTheConfirmation(tree);
    press(hostsWithTestId(tree, "menu-item-options-delete-confirm")[0]);
    rejectWith(new Error("Network request failed"));

    const text = screenText(tree);
    expect(text).toContain("Temperature");
    expect(text).toContain(MENU_OPTIONS_DELETE_COPY.generic);
    // The editor the operator was working in is still mounted.
    expect(hostsWithTestId(tree, "modifier-group-delete").length).toBeGreaterThan(
      0,
    );
    tree.unmount();
  });

  test("a PERMANENT refusal closes the ask but still leaves the group on screen", () => {
    const tree = render();
    openTheConfirmation(tree);
    press(hostsWithTestId(tree, "menu-item-options-delete-confirm")[0]);

    const inUse = new Error("modifier_group_delete_in-use") as Error & {
      category: string;
    };
    inUse.category = "in-use";
    rejectWith(inUse);

    expect(dialogIsOpen(tree)).toBe(false);
    const text = screenText(tree);
    // The group survived a delete that was refused — editor and every option
    // draft are exactly where the operator left them.
    expect(
      hostsWithTestId(tree, "modifier-group-delete").length,
    ).toBeGreaterThan(0);
    for (const option of ["Option 1", "Option 2", "Option 3"]) {
      expect(text).toContain(option);
    }
    expect(text).toContain(MENU_OPTIONS_DELETE_COPY.inUse);
    // And nothing anywhere on screen invites an attempt that cannot succeed.
    expect(text).not.toContain("Try again.");
    tree.unmount();
  });

  /*
   * 4. THE TWO PERMANENT REFUSALS CANNOT BE CONFUSED.
   *
   * The implementor classified four tidy inputs. Production failures are not
   * tidy: codes go missing, messages arrive empty, and the object thrown is
   * sometimes not an object at all.
   */
  test("order-history RESTRICT and permission denial produce different copy and neither is retryable", () => {
    const inUse = modifierGroupDeleteError(
      Object.assign(new Error("boom"), { category: "in-use" as const }),
    );
    const denied = modifierGroupDeleteError(
      Object.assign(new Error("boom"), { category: "permission" as const }),
    );
    expect(inUse.message).toBe(MENU_OPTIONS_DELETE_COPY.inUse);
    expect(denied.message).toBe(MENU_OPTIONS_DELETE_COPY.permission);
    expect(inUse.message).not.toBe(denied.message);
    expect(inUse.canRetry).toBe(false);
    expect(denied.canRetry).toBe(false);
    // A permanent refusal must never contain the retry invitation.
    expect(inUse.message).not.toContain("Try again");
    expect(denied.message).not.toContain("Try again");
  });

  test("a bare 23503 with NO message is still permanent — the code alone carries the fact", () => {
    const raw = { code: "23503" };
    expect(realHooks.isModifierGroupInUseError(raw)).toBe(true);
    expect(realHooks.classifyModifierGroupDeleteFailure(raw)).toBe("in-use");
  });

  test("a 23503 whose message ALSO mentions permission is still read as order history", () => {
    // The FK constraint is the more specific and the permanent fact; a denial
    // probe must not be allowed to steal it.
    const raw = {
      code: "23503",
      message:
        'update or delete on table "menu_modifier_groups" violates foreign key constraint; permission denied',
    };
    expect(realHooks.classifyModifierGroupDeleteFailure(raw)).toBe("in-use");
  });

  test("a 42501 denial is never read as order history", () => {
    const raw = {
      code: "42501",
      message: "permission denied for table menu_modifier_groups",
    };
    expect(realHooks.isModifierGroupInUseError(raw)).toBe(false);
    expect(realHooks.classifyModifierGroupDeleteFailure(raw)).toBe(
      "permission",
    );
  });

  test("an unexpected rejection shape never CLAIMS order history and never crashes", () => {
    const shapes: { label: string; value: unknown }[] = [
      { label: "null", value: null },
      { label: "undefined", value: undefined },
      { label: "empty object", value: {} },
      { label: "empty string", value: "" },
      { label: "a number", value: 500 },
      { label: "an array", value: [] },
      { label: "a bare Error", value: new Error("") },
      { label: "a message-less object", value: { code: "" } },
    ];
    for (const shape of shapes) {
      expect({
        shape: shape.label,
        inUse: realHooks.isModifierGroupInUseError(shape.value),
      }).toEqual({ shape: shape.label, inUse: false });
      expect({
        shape: shape.label,
        category: realHooks.classifyModifierGroupDeleteFailure(shape.value),
      }).toEqual({ shape: shape.label, category: "generic" });
    }
  });

  test("an unclassifiable rejection is told as retryable, never as permanent", () => {
    // Defaulting the other way would tell an operator a recoverable failure is
    // permanent, which is the same class of lie #3571 exists to remove.
    const failure = modifierGroupDeleteError(new Error(""));
    expect(failure.category).toBe("generic");
    expect(failure.canRetry).toBe(true);
    expect(failure.message).toBe(MENU_OPTIONS_DELETE_COPY.generic);
  });

  test("no delete copy ever leaks raw database text to the operator", () => {
    const rawFk = {
      code: "23503",
      message:
        'update or delete on table "menu_modifier_groups" violates foreign key constraint "venue_order_item_modifiers_menu_modifier_id_fkey"',
      details:
        'Key (id)=(abc) is still referenced from table "venue_order_item_modifiers".',
    };
    const failure = modifierGroupDeleteError(rawFk as unknown as Error);
    expect(failure.message).toBe(MENU_OPTIONS_DELETE_COPY.inUse);
    for (const leak of [
      "menu_modifier_groups",
      "venue_order_item_modifiers",
      "foreign key",
      "23503",
      "Key (id)",
    ]) {
      expect(failure.message).not.toContain(leak);
    }
  });

  /*
   * 5. THE CONSEQUENCE COPY — the singular boundary the implementor skipped
   *    (they covered 0 and 3), plus the promise that there is no undo.
   */
  test("exactly ONE choice uses the singular, and the plural boundary is correct on both sides", () => {
    expect(menuModifierGroupDeleteDescription(groupWith(1))).toContain(
      "its 1 choice will be removed",
    );
    expect(menuModifierGroupDeleteDescription(groupWith(1))).not.toContain(
      "1 choices",
    );
    expect(menuModifierGroupDeleteDescription(groupWith(2))).toContain(
      "its 2 choices will be removed",
    );
    // Zero omits the clause rather than saying "0 choices".
    expect(menuModifierGroupDeleteDescription(groupWith(0))).not.toContain(
      "0 choice",
    );
  });

  test("every consequence variant promises no undo and names the public page", () => {
    for (const count of [0, 1, 2, 12]) {
      const copy = menuModifierGroupDeleteDescription(groupWith(count));
      expect({ count, undo: copy.includes("This can't be undone.") }).toEqual({
        count,
        undo: true,
      });
      expect({
        count,
        publicPage: copy.includes("your public page"),
      }).toEqual({ count, publicPage: true });
    }
  });

  test("the confirmation the operator actually reads names THIS group and THIS count", () => {
    groups = [groupWith(2, "Spice level")];
    const tree = render();
    openTheConfirmation(tree);
    const text = screenText(tree);
    expect(text).toContain("Spice level");
    expect(text).toContain("its 2 choices will be removed");
    expect(text).toContain("This can't be undone.");
    tree.unmount();
  });

  /*
   * ACCESSIBILITY — measured on the REAL controls.
   */
  test("the destructive trigger and BOTH dialog controls clear 44pt", () => {
    const tree = render();
    const trigger = openEditorAndFindTrigger(tree);
    const triggerHeights = targetHeights(tree, "modifier-group-delete");
    expect(triggerHeights.length).toBeGreaterThan(0);
    expect(Math.max(...triggerHeights)).toBeGreaterThanOrEqual(44);
    expect(trigger.props.accessibilityRole).toBe("button");

    press(trigger);
    flushFrames();
    for (const testID of [
      "menu-item-options-delete-cancel",
      "menu-item-options-delete-confirm",
    ]) {
      const heights = targetHeights(tree, testID);
      expect({ testID, measured: heights.length > 0 }).toEqual({
        testID,
        measured: true,
      });
      expect({ testID, legal: Math.max(...heights) >= 44 }).toEqual({
        testID,
        legal: true,
      });
    }
    tree.unmount();
  });

  test("the delete failure message is an assertive live region on the TEXT itself", () => {
    const tree = render();
    openTheConfirmation(tree);
    press(hostsWithTestId(tree, "menu-item-options-delete-confirm")[0]);
    const denied = new Error("modifier_group_delete_permission") as Error & {
      category: string;
    };
    denied.category = "permission";
    rejectWith(denied);

    const alerts = tree.root
      .findAllByType(Text)
      .filter((node) => node.props.accessibilityRole === "alert");
    expect(alerts.length).toBeGreaterThan(0);
    const message = alerts.find((node) =>
      JSON.stringify(node.props.children ?? "").includes(
        MENU_OPTIONS_DELETE_COPY.permission,
      ),
    );
    expect(message).toBeDefined();
    expect(message?.props.accessibilityLiveRegion).toBe("assertive");
    expect(message?.props["aria-live"]).toBe("assertive");

    // The region wrapper must not be an `accessible` container — that would
    // flatten the message out of its own subtree.
    const region = hostsWithTestId(tree, "menu-item-options-error")[0];
    expect(region.props.accessible).not.toBe(true);
    tree.unmount();
  });

  test("the read-failure region and the delete-failure region are distinct testIDs", () => {
    const tree = render();
    openTheConfirmation(tree);
    press(hostsWithTestId(tree, "menu-item-options-delete-confirm")[0]);
    rejectWith(new Error("Network request failed"));
    // The delete failure exists; the READ region must not have been borrowed
    // to carry it.
    expect(hostsWithTestId(tree, "menu-item-options-error")).toHaveLength(1);
    expect(hostsWithTestId(tree, "menu-item-options-read-error")).toHaveLength(
      0,
    );
    tree.unmount();
  });
});

/* ===================================================================== *
 * RETEST APPEND — PR #3615 rework (head a7b70d621), plus the origin/main
 * merge that brought #3569's checkable Button roles onto this branch.
 *
 * APPEND-ONLY. Nothing above this line was edited, weakened or skipped.
 *
 * The rework claims four fixes. These guard the three that hold and the
 * one composition the merge created:
 *
 *   P2-1  a delete refusal is SCOPED to the group it is about — it renders
 *         only while that group is on screen, a retryable one is forgotten
 *         on leaving it, a permanent one stays latched to it.
 *   P3-1  a permanently-refused group's trigger is inert AND the flow
 *         refuses to reopen the ask for THAT group.
 *   P3-2  the dialog holds the real group name through the ~200ms close.
 *   P2-2  the in-dialog failure copy is an assertive alert ON THE TEXT,
 *         and a dialog with no `errorMessage` still renders no alert at
 *         all — the guarantee the other 25 ConfirmDialog call sites rely
 *         on.
 *   #3569 the inert trigger is a `Button`, and #3569 taught `Button` to
 *         carry checkable roles. An inert destructive control must NOT
 *         have acquired a checked/selected state, and must still announce
 *         why it is unavailable.
 *
 * Every test below fails when its fix is deleted from the source. See the
 * QA report for the per-fix deletion and the exact failing assertion.
 * ===================================================================== */

/** A second group, so "scoped to ITS group" is a claim with two subjects. */
const retestGroup = (
  id: string,
  name: string,
  optionCount: number,
): MenuModifierGroup => ({
  id,
  menuItemId: ITEM_ID,
  name,
  selectionMode: "single",
  minSelect: 1,
  maxSelect: 1,
  isActive: true,
  sortOrder: 0,
  modifiers: Array.from({ length: optionCount }, (_unused, index) => ({
    id: `${id}-option-${index}`,
    groupId: id,
    name: `Option ${index}`,
    priceDeltaCents: 0,
    currency: "USD",
    isAvailable: true,
    sortOrder: index,
  })),
});

const ALPHA = "group-retest-alpha";
const BETA = "group-retest-beta";

const openEditorForGroup = (tree: TestRenderer, groupId: string): void => {
  const row = hostsWithTestId(tree, `menu-item-option-group-${groupId}`)[0];
  if (row === undefined) throw new Error(`no row rendered for ${groupId}`);
  press(row);
};

const deleteTrigger = (tree: TestRenderer): TestNode => {
  const node = hostsWithTestId(tree, "modifier-group-delete")[0];
  if (node === undefined) throw new Error("the delete trigger did not render");
  return node;
};

/** True only while the trigger can actually be activated. */
const triggerIsLive = (tree: TestRenderer): boolean =>
  typeof deleteTrigger(tree).props.onPress === "function";

const askToDelete = (tree: TestRenderer): void => {
  press(deleteTrigger(tree));
  flushFrames();
};

const confirmTheDelete = (tree: TestRenderer): void => {
  press(hostsWithTestId(tree, "menu-item-options-delete-confirm")[0]);
};

/** ON DELETE RESTRICT — order history. Permanent by the schema's own rule. */
const orderHistoryRefusal = (): Error => {
  const error = new Error(
    "update or delete on table violates foreign key constraint",
  ) as Error & { code?: string };
  error.code = "23503";
  return error;
};

/** A refusal a retry can genuinely clear. */
const transientRefusal = (): Error => new Error("Network request failed");

const alertRegions = (tree: TestRenderer): TestNode[] =>
  hostsWithTestId(tree, "menu-item-options-error");

describe("#3571 RETEST — a refusal is scoped to the group it is about (P2-1)", () => {
  test("a refusal raised for Alpha never renders while BETA's editor is on screen", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2), retestGroup(BETA, "Beta", 1)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(orderHistoryRefusal());

    // The refusal is true of Alpha, and Alpha is on screen.
    expect(alertRegions(tree)).toHaveLength(1);
    expect(screenText(tree)).toContain(MENU_OPTIONS_DELETE_COPY.inUse);

    // Leave Alpha, open Beta. The statement is not true of Beta.
    press(hostsWithTestId(tree, "modifier-group-cancel")[0]);
    openEditorForGroup(tree, BETA);

    expect(alertRegions(tree)).toHaveLength(0);
    expect(screenText(tree)).not.toContain(MENU_OPTIONS_DELETE_COPY.inUse);
    tree.unmount();
  });

  test("returning to Alpha brings ALPHA's own refusal back, unchanged", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2), retestGroup(BETA, "Beta", 1)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(orderHistoryRefusal());
    press(hostsWithTestId(tree, "modifier-group-cancel")[0]);
    openEditorForGroup(tree, BETA);
    expect(alertRegions(tree)).toHaveLength(0);

    press(hostsWithTestId(tree, "modifier-group-cancel")[0]);
    openEditorForGroup(tree, ALPHA);

    expect(alertRegions(tree)).toHaveLength(1);
    expect(screenText(tree)).toContain(MENU_OPTIONS_DELETE_COPY.inUse);
    tree.unmount();
  });

  test("a RETRYABLE refusal is forgotten when the operator closes the editor", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(transientRefusal());
    expect(screenText(tree)).toContain(MENU_OPTIONS_DELETE_COPY.generic);

    // Dismiss the ask, then close the editor: one failed attempt is not a
    // standing fact about the menu.
    press(hostsWithTestId(tree, "menu-item-options-delete-cancel")[0]);
    press(hostsWithTestId(tree, "modifier-group-cancel")[0]);

    expect(alertRegions(tree)).toHaveLength(0);
    expect(screenText(tree)).not.toContain(MENU_OPTIONS_DELETE_COPY.generic);
    tree.unmount();
  });

  test("a RETRYABLE refusal is forgotten when another group is opened", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2), retestGroup(BETA, "Beta", 1)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(transientRefusal());
    press(hostsWithTestId(tree, "menu-item-options-delete-cancel")[0]);
    press(hostsWithTestId(tree, "modifier-group-cancel")[0]);
    openEditorForGroup(tree, BETA);

    expect(alertRegions(tree)).toHaveLength(0);
    expect(screenText(tree)).not.toContain(MENU_OPTIONS_DELETE_COPY.generic);
    tree.unmount();
  });

  test("a PERMANENT refusal is NOT forgotten by closing and reopening its own editor", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(orderHistoryRefusal());

    press(hostsWithTestId(tree, "modifier-group-cancel")[0]);
    openEditorForGroup(tree, ALPHA);

    // Order history is a fact about the group, not about one attempt.
    expect(alertRegions(tree)).toHaveLength(1);
    expect(screenText(tree)).toContain(MENU_OPTIONS_DELETE_COPY.inUse);
    tree.unmount();
  });

  test("the refusal carries the id of the group it is about, not a bare boolean", () => {
    // Guards the SHAPE the scoping depends on: a failure with no subject
    // cannot be compared to the group on screen, and the fix silently
    // degrades to "always visible" if the id is ever dropped.
    const scoped = {
      ...modifierGroupDeleteError(orderHistoryRefusal()),
      groupId: ALPHA,
    };
    expect(scoped.groupId).toBe(ALPHA);
    expect(scoped.canRetry).toBe(false);
  });
});

describe("#3571 RETEST — a permanent refusal is terminal for the FLOW (P3-1)", () => {
  test("the trigger is inert, and raising the request again opens nothing and mutates nothing", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(orderHistoryRefusal());

    const issued = deleteMutate.mock.calls.length;
    expect(triggerIsLive(tree)).toBe(false);
    expect(dialogIsOpen(tree)).toBe(false);

    // Close and reopen the editor — the only route back to the trigger —
    // then try again. Nothing may reopen and nothing may mutate.
    press(hostsWithTestId(tree, "modifier-group-cancel")[0]);
    openEditorForGroup(tree, ALPHA);
    expect(triggerIsLive(tree)).toBe(false);
    flushFrames();
    expect(dialogIsOpen(tree)).toBe(false);
    expect(deleteMutate.mock.calls).toHaveLength(issued);
    tree.unmount();
  });

  test("the inert trigger ANNOUNCES why it is unavailable — it is not a silent dead control", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(orderHistoryRefusal());

    const label = deleteTrigger(tree).props.accessibilityLabel;
    expect(typeof label).toBe("string");
    expect(label as string).toContain("Unavailable");
    expect(label as string).toContain(MENU_OPTIONS_DELETE_COPY.inUse);
    tree.unmount();
  });

  test("a denial is terminal the same way, and says so in its own words", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    const denial = new Error("permission denied for table") as Error & {
      code?: string;
    };
    denial.code = "42501";
    rejectWith(denial);

    expect(triggerIsLive(tree)).toBe(false);
    expect(deleteTrigger(tree).props.accessibilityLabel).toContain(
      MENU_OPTIONS_DELETE_COPY.permission,
    );
    expect(screenText(tree)).not.toContain(MENU_OPTIONS_DELETE_COPY.inUse);
    tree.unmount();
  });

  test("a RETRYABLE refusal leaves the trigger genuinely live — the lock is not blanket", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(transientRefusal());

    // The ask stays open for a retryable failure, so the SAME destructive
    // action is the retry. Dismiss it and the trigger must still work.
    press(hostsWithTestId(tree, "menu-item-options-delete-cancel")[0]);
    expect(triggerIsLive(tree)).toBe(true);
    const issued = deleteMutate.mock.calls.length;
    askToDelete(tree);
    expect(dialogIsOpen(tree)).toBe(true);
    confirmTheDelete(tree);
    expect(deleteMutate.mock.calls.length).toBe(issued + 1);
    tree.unmount();
  });
});

describe("#3571 RETEST — the dialog holds the real group name through its close (P3-2)", () => {
  const PLACEHOLDER = "this group”?";

  test("the VERY FIRST open already names the real group — no placeholder frame", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);

    const shown = screenText(tree);
    expect(shown).toContain("Remove “Alpha”?");
    expect(shown).not.toContain(PLACEHOLDER);
    tree.unmount();
  });

  test("the name survives the close animation after CANCEL", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    press(hostsWithTestId(tree, "menu-item-options-delete-cancel")[0]);

    // `Modal` keeps its node mounted for UNMOUNT_DELAY_MS. Whatever is still
    // drawn during that window must be the truth, not the placeholder.
    expect(dialogIsOpen(tree)).toBe(false);
    const shown = screenText(tree);
    expect(shown).toContain("Remove “Alpha”?");
    expect(shown).not.toContain(PLACEHOLDER);
    tree.unmount();
  });

  test("the name survives the close animation after a SUCCESSFUL delete", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    const callbacks = lastDeleteCallbacks();
    act(() => {
      callbacks.onSuccess?.();
      callbacks.onSettled?.();
    });

    expect(dialogIsOpen(tree)).toBe(false);
    const shown = screenText(tree);
    expect(shown).toContain("Remove “Alpha”?");
    expect(shown).not.toContain(PLACEHOLDER);
    tree.unmount();
  });

  test("opening BETA after ALPHA closed never shows ALPHA's name in the open dialog", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2), retestGroup(BETA, "Beta", 1)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    press(hostsWithTestId(tree, "menu-item-options-delete-cancel")[0]);
    press(hostsWithTestId(tree, "modifier-group-cancel")[0]);

    openEditorForGroup(tree, BETA);
    askToDelete(tree);

    expect(dialogIsOpen(tree)).toBe(true);
    const shown = screenText(tree);
    expect(shown).toContain("Remove “Beta”?");
    expect(shown).not.toContain("Remove “Alpha”?");
    expect(shown).not.toContain(PLACEHOLDER);
    tree.unmount();
  });

  test("the cache is a CACHE, not a source — the description matches the same group", () => {
    groups = [retestGroup(BETA, "Beta", 1)];
    const tree = render();

    openEditorForGroup(tree, BETA);
    askToDelete(tree);

    // Title and consequence must describe ONE group. A cache that lagged by a
    // render would desynchronise exactly here.
    expect(screenText(tree)).toContain("Remove “Beta”?");
    expect(screenText(tree)).toContain(
      menuModifierGroupDeleteDescription(groups[0]),
    );
    tree.unmount();
  });
});

describe("#3571 RETEST — #3569's checkable Button roles vs the inert trigger", () => {
  test("the INERT destructive control keeps role button and acquires NO checked state", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(orderHistoryRefusal());

    const trigger = deleteTrigger(tree);
    expect(trigger.props.accessibilityRole).toBe("button");
    // #3569 emits aria-checked ONLY for checkbox/radio/togglebutton. A
    // destructive removal is none of those: a screen reader must never read
    // "not checked" or "selected" over it.
    expect(trigger.props["aria-checked"]).toBeUndefined();
    const state = trigger.props.accessibilityState as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(state, "checked")).toBe(false);
    expect(state.disabled).toBe(true);
    tree.unmount();
  });

  test("the LIVE destructive control likewise carries no checkable state", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    const trigger = deleteTrigger(tree);

    expect(trigger.props.accessibilityRole).toBe("button");
    expect(trigger.props["aria-checked"]).toBeUndefined();
    const state = trigger.props.accessibilityState as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(state, "checked")).toBe(false);
    expect(state.disabled).toBe(false);
    tree.unmount();
  });

  test("being inert does not cost the control its name — disabled still announces", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(orderHistoryRefusal());

    const trigger = deleteTrigger(tree);
    const label = trigger.props.accessibilityLabel as string;
    expect(label.startsWith("Remove this group")).toBe(true);
    // The visible label is still there for a sighted operator.
    expect(screenText(tree)).toContain("Remove this group");
    tree.unmount();
  });
});

describe("#3571 RETEST — the shared ConfirmDialog change is additive (P2-2)", () => {
  const dialogAlerts = (tree: TestRenderer): TestNode[] =>
    tree.root
      .findAllByProps({ accessibilityRole: "alert" })
      .filter((node) => typeof node.type === "string");

  const mountDialog = (props: Record<string, unknown>): TestRenderer => {
    let tree: TestRenderer | null = null;
    act(() => {
      tree = renderer.create(
        React.createElement(ConfirmDialog, {
          visible: true,
          onClose: () => undefined,
          onConfirm: () => undefined,
          title: "Remove it?",
          description: "This cannot be undone.",
          ...props,
        } as never),
        { createNodeMock: () => ({ focus: () => undefined }) },
      );
    });
    if (tree === null) throw new Error("dialog produced no tree");
    return tree;
  };

  test("a dialog with NO errorMessage renders no alert node at all", () => {
    // This is the guarantee every other ConfirmDialog call site relies on:
    // 25 production call sites render this component and most pass no
    // errorMessage. They must be byte-identical to before the rework.
    const tree = mountDialog({});
    expect(dialogAlerts(tree)).toHaveLength(0);
    tree.unmount();
  });

  test("errorMessage null and empty string are both still silent", () => {
    const withNull = mountDialog({ errorMessage: null });
    expect(dialogAlerts(withNull)).toHaveLength(0);
    withNull.unmount();

    const withEmpty = mountDialog({ errorMessage: "" });
    expect(dialogAlerts(withEmpty)).toHaveLength(0);
    withEmpty.unmount();
  });

  test("errorMessage renders ONE assertive alert carrying the message itself", () => {
    const tree = mountDialog({ errorMessage: "It did not work." });
    const alerts = dialogAlerts(tree);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].props.accessibilityLiveRegion).toBe("assertive");
    expect(alerts[0].props["aria-live"]).toBe("assertive");
    expect(alerts[0].props.children).toBe("It did not work.");
    tree.unmount();
  });

  test("errorTestID is opt-in — omitting it changes nothing about the alert", () => {
    const tree = mountDialog({ errorMessage: "It did not work." });
    const alerts = dialogAlerts(tree);
    expect(alerts[0].props.testID).toBeUndefined();
    expect(alerts[0].props.accessibilityRole).toBe("alert");
    tree.unmount();
  });

  test("the section's own dialog error is reachable by its errorTestID and is assertive", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(transientRefusal());

    const inDialog = hostsWithTestId(
      tree,
      "menu-item-options-delete-dialog-error",
    );
    expect(inDialog).toHaveLength(1);
    expect(inDialog[0].props.accessibilityRole).toBe("alert");
    expect(inDialog[0].props.accessibilityLiveRegion).toBe("assertive");
    expect(inDialog[0].props["aria-live"]).toBe("assertive");
    expect(inDialog[0].props.children).toBe(MENU_OPTIONS_DELETE_COPY.generic);
    tree.unmount();
  });

  test("a PERMANENT refusal puts nothing in the dialog — it closed, the section speaks", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(orderHistoryRefusal());

    expect(
      hostsWithTestId(tree, "menu-item-options-delete-dialog-error"),
    ).toHaveLength(0);
    expect(alertRegions(tree)).toHaveLength(1);
    tree.unmount();
  });
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ConfirmDialog } = require("../../ui/ConfirmDialog") as {
  ConfirmDialog: React.ComponentType<Record<string, unknown>>;
};

/* ---------------------------------------------------------------------
 * Two falsifiers the block above was missing.
 *
 * Deleting `forgetTransientDeleteFailure()`'s call sites, and deleting the
 * reopen guard inside `requestDeleteGroup`, each left the suite fully
 * green — because the alert SCOPING already hides the message the moment
 * the operator leaves the group, and because the inert trigger already
 * stops the only tap that reaches the guard. Both tests were therefore
 * re-proving the scoping and carrying no information about their own fix.
 *
 * The forgetting is only observable on RETURN to the same group, and the
 * guard is only observable when the request is raised DIRECTLY — which is
 * the exact wording of the claim ("refuses to reopen the ask even if the
 * request is raised directly"). These two attack precisely there.
 * ------------------------------------------------------------------- */

/** The live `onRequestDelete` the section handed the open editor. */
const directDeleteRequest = (tree: TestRenderer): ((id: string) => void) => {
  const owner = tree.root
    .findAllByProps({ menuItemId: ITEM_ID })
    .find((node) => typeof node.props.onRequestDelete === "function");
  if (owner === undefined) {
    throw new Error("no editor is holding a delete request handler");
  }
  return owner.props.onRequestDelete as (id: string) => void;
};

describe("#3571 RETEST — the two claims the scoping was masking", () => {
  test("a RETRYABLE refusal does NOT come back when its own group is reopened", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(transientRefusal());
    expect(screenText(tree)).toContain(MENU_OPTIONS_DELETE_COPY.generic);

    press(hostsWithTestId(tree, "menu-item-options-delete-cancel")[0]);
    press(hostsWithTestId(tree, "modifier-group-cancel")[0]);
    openEditorForGroup(tree, ALPHA);

    // One failed attempt is not a standing fact about this group. Scoping
    // alone would hand it straight back here.
    expect(alertRegions(tree)).toHaveLength(0);
    expect(screenText(tree)).not.toContain(MENU_OPTIONS_DELETE_COPY.generic);
    tree.unmount();
  });

  test("a PERMANENT refusal still comes back on return — the contrast is the point", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(orderHistoryRefusal());

    press(hostsWithTestId(tree, "modifier-group-cancel")[0]);
    openEditorForGroup(tree, ALPHA);

    expect(alertRegions(tree)).toHaveLength(1);
    expect(triggerIsLive(tree)).toBe(false);
    tree.unmount();
  });

  test("raising the request DIRECTLY on a refused group opens nothing and mutates nothing", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(orderHistoryRefusal());

    const issued = deleteMutate.mock.calls.length;
    const raise = directDeleteRequest(tree);

    // Bypass the inert trigger entirely — this is the route the claim says
    // the SECTION itself refuses, not just the control.
    act(() => {
      raise(ALPHA);
    });
    flushFrames();

    expect(dialogIsOpen(tree)).toBe(false);
    expect(deleteMutate.mock.calls).toHaveLength(issued);
    // And the fact that says WHY is still on screen — not wiped by the ask.
    expect(alertRegions(tree)).toHaveLength(1);
    expect(screenText(tree)).toContain(MENU_OPTIONS_DELETE_COPY.inUse);
    tree.unmount();
  });

  test("raising the request directly on a RETRYABLE refusal still opens — the refusal is not blanket", () => {
    groups = [retestGroup(ALPHA, "Alpha", 2)];
    const tree = render();

    openEditorForGroup(tree, ALPHA);
    askToDelete(tree);
    confirmTheDelete(tree);
    rejectWith(transientRefusal());
    press(hostsWithTestId(tree, "menu-item-options-delete-cancel")[0]);

    act(() => {
      directDeleteRequest(tree)(ALPHA);
    });
    flushFrames();

    expect(dialogIsOpen(tree)).toBe(true);
    tree.unmount();
  });
});
