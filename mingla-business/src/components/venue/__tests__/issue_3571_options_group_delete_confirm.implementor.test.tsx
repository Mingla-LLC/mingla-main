/**
 * Issue #3571 implementor guard — "Remove this group" ASKS before it deletes,
 * and a rejected delete tells the truth about why.
 *
 * "One tap deletes" is a runtime-behaviour claim, so every proof below mounts
 * the REAL `MenuItemOptionsSection` with the editor open and counts actual
 * mutation calls. Two independent defects are covered: the missing
 * confirmation, and the failure copy that told an operator to "try again" on a
 * delete that an `ON DELETE RESTRICT` from order history makes permanent.
 */

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Text } from "react-native";

import type { MenuModifierGroup } from "../../../hooks/useMenuModifiers";

interface TestNode {
  props: Record<string, unknown>;
  findAllByType: (type: unknown) => TestNode[];
  findAllByProps: (props: Record<string, unknown>) => TestNode[];
}

interface TestRenderer {
  root: TestNode;
  unmount: () => void;
}

interface RendererApi {
  create: (node: React.ReactElement) => TestRenderer;
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
/*
 * PR #3615 rework cycle 2. React Query's `dataUpdatedAt` advances only when a
 * fetch settles SUCCESSFULLY, so it is the one signal a terminal delete
 * refusal can honestly be released by. Bumping this stands in for a successful
 * refetch of the group list.
 */
let groupsUpdatedAt = 1;

jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("MockButton", props),
}));

jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) =>
    React.createElement("MockConfirmDialog", props),
}));

// ui/Input pulls ui/Icon -> react-native-svg, whose Flow source cannot load
// under the default node/ts-jest runner.
jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    React.createElement("MockInput", props),
}));

/*
 * PR #3615 rework, P2-2 — the in-dialog failure alert is proved against the
 * REAL `ConfirmDialog` further down, so its two unloadable dependencies are
 * replaced here. Neither carries any part of the contract under test:
 * `ui/Modal` is a pass-through portal, and reanimated only drives the
 * hold-to-confirm progress fill, which the `simple` variant never renders.
 */
jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLocal = require("react") as typeof React;
  const view = (props: Record<string, unknown>): React.ReactElement =>
    ReactLocal.createElement(
      "ReanimatedView",
      props,
      props.children as React.ReactNode,
    );
  return {
    __esModule: true,
    default: { View: view, Text: view },
    Easing: { linear: (t: number) => t, out: () => (t: number) => t, in: () => (t: number) => t },
    cancelAnimation: () => undefined,
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: () => ({}),
    useReducedMotion: () => false,
    useSharedValue: (value: unknown) => ({ value }),
    withTiming: (value: unknown) => value,
  };
});

jest.mock("../../ui/Modal", () => ({
  Modal: (props: Record<string, unknown>) =>
    React.createElement("MockModal", props, props.children as React.ReactNode),
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
      dataUpdatedAt: groupsUpdatedAt,
      refetch: jest.fn(),
    }),
    useSaveModifierGroup: () => ({ isPending: false, mutate: jest.fn() }),
    useDeleteModifierGroup: () => ({
      isPending: deletePending,
      mutate: deleteMutate,
    }),
  };
});

// Imports stay below the mocks so production binds to the test doubles.
// eslint-disable-next-line import/first
import {
  MenuItemOptionsSection,
  modifierGroupDeleteError,
} from "../MenuItemOptionsSection";

// eslint-disable-next-line import/first
import { MenuModifierGroupEditor } from "../MenuModifierGroupEditor";

const realHooks = jest.requireActual(
  "../../../hooks/useMenuModifiers",
) as typeof import("../../../hooks/useMenuModifiers");

/*
 * PR #3615 rework, P2-2 — the section-level assertions above run against the
 * inert `MockConfirmDialog`, which has no rendering of its own. The in-dialog
 * alert is a claim about what the SHIPPED dialog renders, so it is proved
 * against the real component.
 */
const RealConfirmDialog = (
  jest.requireActual(
    "../../ui/ConfirmDialog",
  ) as typeof import("../../ui/ConfirmDialog")
).ConfirmDialog;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act;

// React only enforces act() when told it is in an act environment; without it
// every update below is merely warned about instead of being scheduled the way
// the component tree actually schedules it.
(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const IN_USE_COPY =
  "Guests have already ordered these choices, so this group can't be removed. Turn the options off instead.";
const PERMISSION_COPY = "You cannot remove this group with this account.";
const GENERIC_COPY = "We couldn't remove this group. Try again.";

const groupWith = (optionCount: number): MenuModifierGroup => ({
  id: "group-3571",
  menuItemId: "item-3571",
  name: "Temperature",
  selectionMode: "single",
  minSelect: 1,
  maxSelect: 1,
  isActive: true,
  sortOrder: 0,
  modifiers: Array.from({ length: optionCount }, (_unused, index) => ({
    id: `option-${index}`,
    groupId: "group-3571",
    name: `Option ${index}`,
    priceDeltaCents: 0,
    currency: "USD",
    isAvailable: true,
    sortOrder: index,
  })),
});

const render = (): TestRenderer => {
  let tree: TestRenderer | null = null;
  act(() => {
    tree = renderer.create(
      <MenuItemOptionsSection
        brandId="brand-3571"
        menuItemId="item-3571"
        itemCurrency="USD"
        canMutate
      />,
    );
  });
  if (tree === null) throw new Error("render produced no tree");
  return tree;
};

const textOf = (tree: TestRenderer): string =>
  tree.root
    .findAllByType(Text)
    .map((node) => JSON.stringify(node.props.children ?? ""))
    .join(" | ");

const nodesWithTestId = (tree: TestRenderer, testID: string): TestNode[] =>
  tree.root.findAllByProps({ testID });

/** Open the editor for the only group, then hand back the delete trigger. */
const openEditorAndFindTrigger = (tree: TestRenderer): TestNode => {
  const row = nodesWithTestId(tree, "menu-item-option-group-group-3571")[0];
  act(() => {
    (row.props.onPress as () => void)();
  });
  const trigger = nodesWithTestId(tree, "modifier-group-delete")[0];
  if (trigger === undefined) {
    throw new Error("the delete trigger did not render");
  }
  return trigger;
};

const dialogOf = (tree: TestRenderer): TestNode =>
  nodesWithTestId(tree, "menu-item-options-delete-dialog")[0];

beforeEach(() => {
  deleteMutate.mockReset();
  deletePending = false;
  groups = [groupWith(3)];
  groupsUpdatedAt = 1;
});

describe("#3571 implementor — removing an options group is confirmed, not instant", () => {
  test("tapping the trigger issues ZERO mutations and opens the confirmation", () => {
    const tree = render();
    const trigger = openEditorAndFindTrigger(tree);
    expect(dialogOf(tree).props.visible).toBe(false);

    act(() => {
      (trigger.props.onPress as () => void)();
    });

    expect(deleteMutate).toHaveBeenCalledTimes(0);
    expect(dialogOf(tree).props.visible).toBe(true);
  });

  test("the trigger is a legal 44pt destructive target", () => {
    const tree = render();
    const trigger = openEditorAndFindTrigger(tree);
    // ui/Button size="sm" maps to 36pt, below the venue surface's target.
    expect(trigger.props.size).toBe("md");
    expect(trigger.props.variant).toBe("destructive");
  });

  test("the confirmation names the group, the exact count, and the safe default", () => {
    const tree = render();
    const trigger = openEditorAndFindTrigger(tree);
    act(() => {
      (trigger.props.onPress as () => void)();
    });
    const dialog = dialogOf(tree);

    expect(dialog.props.title).toContain("Temperature");
    expect(dialog.props.title).toContain("Remove");
    expect(dialog.props.description).toContain("Temperature");
    expect(dialog.props.description).toContain("3 choices");
    expect(dialog.props.description).toContain("public page");
    expect(dialog.props.description).toContain("This can't be undone.");
    expect(dialog.props.cancelLabel).toBe("Keep group");
    expect(dialog.props.confirmLabel).toBe("Remove group");
    expect(dialog.props.initialFocus).toBe("cancel");
    expect(dialog.props.destructive).toBe(true);
  });

  test.each([
    [1, "its 1 choice"],
    [3, "its 3 choices"],
  ])(
    "the description uses correct grammar for %i option(s)",
    (optionCount, expected) => {
      groups = [groupWith(optionCount)];
      const tree = render();
      const trigger = openEditorAndFindTrigger(tree);
      act(() => {
        (trigger.props.onPress as () => void)();
      });
      expect(dialogOf(tree).props.description).toContain(expected);
    },
  );

  test("a group with no options omits the choice clause instead of saying 0", () => {
    groups = [groupWith(0)];
    const tree = render();
    const trigger = openEditorAndFindTrigger(tree);
    act(() => {
      (trigger.props.onPress as () => void)();
    });
    const description = dialogOf(tree).props.description as string;
    expect(description).toContain("Temperature");
    expect(description).not.toContain("0 choice");
    expect(description).toContain("This can't be undone.");
  });

  test("cancelling issues zero mutations and leaves the group rendered", () => {
    const tree = render();
    const trigger = openEditorAndFindTrigger(tree);
    act(() => {
      (trigger.props.onPress as () => void)();
    });
    act(() => {
      (dialogOf(tree).props.onClose as () => void)();
    });

    expect(deleteMutate).toHaveBeenCalledTimes(0);
    expect(dialogOf(tree).props.visible).toBe(false);
    expect(nodesWithTestId(tree, "modifier-group-delete")).not.toHaveLength(0);
  });

  test("confirming issues exactly one mutation even under a same-tick repeat", () => {
    const tree = render();
    const trigger = openEditorAndFindTrigger(tree);
    act(() => {
      (trigger.props.onPress as () => void)();
    });
    const confirm = dialogOf(tree).props.onConfirm as () => void;
    act(() => {
      confirm();
      confirm();
      confirm();
    });

    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(deleteMutate.mock.calls[0][0]).toEqual({
      groupId: "group-3571",
      menuItemId: "item-3571",
    });
  });

  test("success closes the confirmation and the editor", () => {
    const tree = render();
    const trigger = openEditorAndFindTrigger(tree);
    act(() => {
      (trigger.props.onPress as () => void)();
    });
    act(() => {
      (dialogOf(tree).props.onConfirm as () => void)();
    });
    const callbacks = deleteMutate.mock.calls[0][1];
    act(() => {
      callbacks?.onSuccess?.();
      callbacks?.onSettled?.();
    });

    expect(dialogOf(tree).props.visible).toBe(false);
    expect(nodesWithTestId(tree, "modifier-group-delete")).toHaveLength(0);
  });

  test("a generic failure keeps the group, keeps the ask open, and the same action retries", () => {
    const tree = render();
    const trigger = openEditorAndFindTrigger(tree);
    act(() => {
      (trigger.props.onPress as () => void)();
    });
    act(() => {
      (dialogOf(tree).props.onConfirm as () => void)();
    });
    act(() => {
      deleteMutate.mock.calls[0][1]?.onError?.(new Error("boom"));
      deleteMutate.mock.calls[0][1]?.onSettled?.();
    });

    expect(textOf(tree)).toContain(GENERIC_COPY);
    expect(dialogOf(tree).props.visible).toBe(true);
    expect(dialogOf(tree).props.errorMessage).toBe(GENERIC_COPY);
    expect(nodesWithTestId(tree, "modifier-group-delete")).not.toHaveLength(0);

    act(() => {
      (dialogOf(tree).props.onConfirm as () => void)();
    });
    expect(deleteMutate).toHaveBeenCalledTimes(2);
  });

  test("an order-history RESTRICT failure says so and offers NO retry", () => {
    const tree = render();
    const trigger = openEditorAndFindTrigger(tree);
    act(() => {
      (trigger.props.onPress as () => void)();
    });
    act(() => {
      (dialogOf(tree).props.onConfirm as () => void)();
    });
    const inUse = new Error("modifier_group_delete_in-use") as Error & {
      category?: string;
    };
    inUse.category = "in-use";
    act(() => {
      deleteMutate.mock.calls[0][1]?.onError?.(inUse);
      deleteMutate.mock.calls[0][1]?.onSettled?.();
    });

    expect(textOf(tree)).toContain(IN_USE_COPY);
    expect(textOf(tree)).not.toContain("Try again");
    expect(dialogOf(tree).props.visible).toBe(false);
    expect(nodesWithTestId(tree, "modifier-group-delete")).not.toHaveLength(0);
  });

  test("a permission failure says so and offers NO retry", () => {
    const tree = render();
    const trigger = openEditorAndFindTrigger(tree);
    act(() => {
      (trigger.props.onPress as () => void)();
    });
    act(() => {
      (dialogOf(tree).props.onConfirm as () => void)();
    });
    const denied = new Error("modifier_group_delete_permission") as Error & {
      category?: string;
    };
    denied.category = "permission";
    act(() => {
      deleteMutate.mock.calls[0][1]?.onError?.(denied);
      deleteMutate.mock.calls[0][1]?.onSettled?.();
    });

    expect(textOf(tree)).toContain(PERMISSION_COPY);
    expect(textOf(tree)).not.toContain("Try again");
    expect(dialogOf(tree).props.visible).toBe(false);
    expect(nodesWithTestId(tree, "modifier-group-delete")).not.toHaveLength(0);
  });

  test("the delete message carries an assertive alert role", () => {
    const tree = render();
    const trigger = openEditorAndFindTrigger(tree);
    act(() => {
      (trigger.props.onPress as () => void)();
    });
    act(() => {
      (dialogOf(tree).props.onConfirm as () => void)();
    });
    act(() => {
      deleteMutate.mock.calls[0][1]?.onError?.(new Error("boom"));
      deleteMutate.mock.calls[0][1]?.onSettled?.();
    });

    const alert = nodesWithTestId(tree, "menu-item-options-error")[0];
    expect(alert).toBeDefined();
    const message = alert
      .findAllByType(Text)
      .find((node) => node.props.accessibilityRole === "alert");
    expect(message).toBeDefined();
    expect(message?.props.accessibilityLiveRegion).toBe("assertive");
    expect(message?.props["aria-live"]).toBe("assertive");
  });

  test("a raw PostgREST foreign-key rejection reaches the in-use copy unaided", () => {
    // The hook carries a safe `category`, but the copy must also be correct
    // when it classifies the rejection itself — a delete blocked by order
    // history is permanent whichever path it arrives on.
    const raw = new Error(
      'update or delete on table "menu_modifiers" violates foreign key constraint',
    ) as Error & { code?: string };
    raw.code = "23503";
    const failure = modifierGroupDeleteError(raw);
    expect(failure.category).toBe("in-use");
    expect(failure.message).toBe(IN_USE_COPY);
    expect(failure.canRetry).toBe(false);
    expect(failure.message).not.toContain("Try again");
  });

  test("the delete classifier separates in-use, permission, offline and generic", () => {
    const fk = new Error("boom") as Error & { code?: string };
    fk.code = "23503";
    const denied = new Error("permission denied for table") as Error & {
      code?: string;
    };
    denied.code = "42501";

    expect(realHooks.classifyModifierGroupDeleteFailure(fk)).toBe("in-use");
    expect(realHooks.classifyModifierGroupDeleteFailure(denied)).toBe(
      "permission",
    );
    expect(
      realHooks.classifyModifierGroupDeleteFailure(
        new Error("Network request failed"),
      ),
    ).toBe("offline");
    expect(
      realHooks.classifyModifierGroupDeleteFailure(new Error("something else")),
    ).toBe("generic");
    // PostgREST hands back a PLAIN OBJECT, not an Error, on the {data,error}
    // path this codebase uses — the classifier must read that shape too.
    expect(
      realHooks.classifyModifierGroupDeleteFailure({
        code: "23503",
        message: "violates foreign key constraint",
      }),
    ).toBe("in-use");
  });

  test("the delete hook no longer throws its error away", () => {
    const hooks = fs.readFileSync(
      path.join(__dirname, "../../../hooks/useMenuModifiers.ts"),
      "utf8",
    );
    // `onError: () => undefined` was the single line that made every delete
    // failure indistinguishable to every consumer of this hook.
    expect(hooks).not.toContain("onError: () => undefined");
    expect(hooks).toContain("[delete_menu_modifier_group] failed");
    expect(hooks).toContain("modifier_group_delete_");
  });

  test("the read failure and the delete failure stay separate surfaces", () => {
    const tree = render();
    const trigger = openEditorAndFindTrigger(tree);
    act(() => {
      (trigger.props.onPress as () => void)();
    });
    act(() => {
      (dialogOf(tree).props.onConfirm as () => void)();
    });
    act(() => {
      deleteMutate.mock.calls[0][1]?.onError?.(new Error("boom"));
      deleteMutate.mock.calls[0][1]?.onSettled?.();
    });

    expect(nodesWithTestId(tree, "menu-item-options-error")).not.toHaveLength(
      0,
    );
    // The read is healthy, so no read message may borrow the delete's region.
    expect(nodesWithTestId(tree, "menu-item-options-read-error")).toHaveLength(
      0,
    );
    expect(textOf(tree)).not.toContain("Couldn't load choices");
    expect(textOf(tree)).not.toContain("Couldn't refresh choices");
  });
});

/**
 * PR #3615 REWORK — the four residual defects the independent adversarial pass
 * found in the delete-failure messaging.
 *
 * Every one of them is a claim about what the operator SEES and HEARS, so each
 * proof drives the real section and reads what it rendered. Two of them put a
 * false statement on screen, which is the same defect class #3570 and #3571
 * exist to remove: a surface that asserts something untrue about the thing in
 * front of the person using it.
 */

/** A second, unrelated group — the one a refusal must never follow into. */
const otherGroup = (): MenuModifierGroup => ({
  id: "group-3571-beta",
  menuItemId: "item-3571",
  name: "Sides",
  selectionMode: "single",
  minSelect: 0,
  maxSelect: 1,
  isActive: true,
  sortOrder: 1,
  modifiers: [],
});

const openEditorFor = (tree: TestRenderer, groupId: string): void => {
  const row = nodesWithTestId(tree, `menu-item-option-group-${groupId}`)[0];
  if (row === undefined) throw new Error(`no row for ${groupId}`);
  act(() => {
    (row.props.onPress as () => void)();
  });
};

const deleteTriggerOf = (tree: TestRenderer): TestNode => {
  const trigger = nodesWithTestId(tree, "modifier-group-delete")[0];
  if (trigger === undefined) throw new Error("the delete trigger did not render");
  return trigger;
};

/** Ask, confirm, and settle the mutation with `rejection`. */
const refuseTheDelete = (tree: TestRenderer, rejection: Error): void => {
  act(() => {
    (deleteTriggerOf(tree).props.onPress as () => void)();
  });
  act(() => {
    (dialogOf(tree).props.onConfirm as () => void)();
  });
  const callbacks = deleteMutate.mock.calls[deleteMutate.mock.calls.length - 1][1];
  act(() => {
    callbacks?.onError?.(rejection);
    callbacks?.onSettled?.();
  });
};

const inUseRejection = (): Error => {
  const rejection = new Error("modifier_group_delete_in-use") as Error & {
    category?: string;
  };
  rejection.category = "in-use";
  return rejection;
};

describe("#3615 rework — a delete refusal is scoped, terminal, announced and named", () => {
  /*
   * P2-1. The defect: `deleteFailure` was cleared only when a NEW delete was
   * requested, so a refusal raised for "Temperature" stayed on screen — as an
   * assertive live region — above the editor for "Sides". The alert then
   * asserted something false about the group the operator was looking at, and
   * a screen reader re-announced it out of context.
   */
  test("a refusal raised for one group never renders above a DIFFERENT group", () => {
    groups = [groupWith(3), otherGroup()];
    const tree = render();
    openEditorFor(tree, "group-3571");
    refuseTheDelete(tree, inUseRejection());
    expect(textOf(tree)).toContain(IN_USE_COPY);

    // The operator leaves Temperature and opens Sides. Nothing about
    // Temperature may travel with them.
    openEditorFor(tree, "group-3571-beta");
    expect(textOf(tree)).not.toContain(IN_USE_COPY);
    expect(nodesWithTestId(tree, "menu-item-options-error")).toHaveLength(0);

    // And the fact is not destroyed either — it is still true of Temperature,
    // so returning to Temperature finds it intact.
    openEditorFor(tree, "group-3571");
    expect(textOf(tree)).toContain(IN_USE_COPY);
    act(() => {
      tree.unmount();
    });
  });

  test("closing the editor takes a RETRYABLE refusal with it", () => {
    groups = [groupWith(3)];
    const tree = render();
    openEditorFor(tree, "group-3571");
    refuseTheDelete(tree, new Error("Network request failed"));
    expect(textOf(tree)).toContain(GENERIC_COPY);

    act(() => {
      (dialogOf(tree).props.onClose as () => void)();
    });
    act(() => {
      (nodesWithTestId(tree, "modifier-group-cancel")[0].props
        .onPress as () => void)();
    });

    // One attempt failed; that is not a standing fact about the menu.
    expect(textOf(tree)).not.toContain(GENERIC_COPY);
    expect(nodesWithTestId(tree, "menu-item-options-error")).toHaveLength(0);
    act(() => {
      tree.unmount();
    });
  });

  /*
   * P3-1. "No retry" was true of the DIALOG and false of the FLOW: pressing
   * the trigger again wiped the terminal message and issued a second mutation
   * against a delete the database can never accept.
   */
  test("a PERMANENT refusal is terminal for the flow, not just for the dialog", () => {
    groups = [groupWith(3)];
    const tree = render();
    openEditorFor(tree, "group-3571");
    refuseTheDelete(tree, inUseRejection());
    expect(deleteMutate).toHaveBeenCalledTimes(1);

    // The trigger is inert rather than absent — the operator still sees WHAT
    // is unavailable, and the control carries its own reason for a screen
    // reader that never heard the live region.
    const trigger = deleteTriggerOf(tree);
    expect(trigger.props.disabled).toBe(true);
    expect(trigger.props.accessibilityLabel).toContain(IN_USE_COPY);
    act(() => {
      (trigger.props.onPress as () => void)();
    });
    expect(dialogOf(tree).props.visible).toBe(false);
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(textOf(tree)).toContain(IN_USE_COPY);

    // The guard is in the FLOW, not only in the disabled control: raising the
    // request straight at the section changes nothing either.
    const editor = tree.root.findAllByType(MenuModifierGroupEditor)[0];
    act(() => {
      (editor.props.onRequestDelete as (groupId: string) => void)(
        "group-3571",
      );
    });
    expect(dialogOf(tree).props.visible).toBe(false);
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    // The permanent fact is not erasable by the operator's own next tap.
    expect(textOf(tree)).toContain(IN_USE_COPY);
    act(() => {
      tree.unmount();
    });
  });

  test("a RETRYABLE refusal leaves the trigger live — only the permanent one is inert", () => {
    groups = [groupWith(3)];
    const tree = render();
    openEditorFor(tree, "group-3571");
    refuseTheDelete(tree, new Error("Network request failed"));

    const trigger = deleteTriggerOf(tree);
    expect(trigger.props.disabled).toBe(false);
    expect(trigger.props.accessibilityLabel).toBeUndefined();
    act(() => {
      tree.unmount();
    });
  });

  /*
   * P3-2. `ui/Modal` keeps its node mounted for 200ms after `visible` drops so
   * the exit animation can play. The group was already null by then, so the
   * dialog swapped the real name for the literal placeholder mid-dismissal.
   */
  test("the dialog keeps the real group name through its close animation", () => {
    groups = [groupWith(3)];
    const tree = render();
    openEditorFor(tree, "group-3571");
    act(() => {
      (deleteTriggerOf(tree).props.onPress as () => void)();
    });
    expect(dialogOf(tree).props.title).toContain("Temperature");

    act(() => {
      (dialogOf(tree).props.onClose as () => void)();
    });

    const closing = dialogOf(tree);
    expect(closing.props.visible).toBe(false);
    // Still mounted, still rendering — and still about the real group.
    expect(closing.props.title).toContain("Temperature");
    expect(closing.props.title).not.toContain("this group");
    expect(closing.props.description).toContain("Temperature");
    expect(closing.props.description).not.toContain("This group");
    act(() => {
      tree.unmount();
    });
  });

  /*
   * P2-2. On iOS the native `Modal` owns the accessibility container, so the
   * assertive alert the section renders BEHIND the dialog is unreachable while
   * the dialog is open. For a retryable failure the in-dialog copy is the only
   * message a screen reader can get to — and it carried no role and no live
   * region at all.
   */
  test("the REAL ConfirmDialog announces the in-dialog failure copy assertively", () => {
    groups = [groupWith(3)];
    const tree = render();
    openEditorFor(tree, "group-3571");
    refuseTheDelete(tree, new Error("Network request failed"));

    const dialogProps = dialogOf(tree).props;
    expect(dialogProps.visible).toBe(true);
    expect(dialogProps.errorMessage).toBe(GENERIC_COPY);

    // Hand the REAL dialog exactly the props the section just produced.
    let dialogTree: TestRenderer | null = null;
    act(() => {
      dialogTree = renderer.create(
        <RealConfirmDialog
          visible
          onClose={(): void => undefined}
          onConfirm={(): void => undefined}
          title={dialogProps.title as string}
          description={dialogProps.description as string}
          variant="simple"
          destructive
          confirmLabel="Remove group"
          cancelLabel="Keep group"
          errorMessage={dialogProps.errorMessage as string}
          errorTestID={dialogProps.errorTestID as string}
        />,
      );
    });
    if (dialogTree === null) throw new Error("the real dialog did not render");
    const rendered = dialogTree as TestRenderer;

    const alert = rendered.root.findAllByProps({
      testID: "menu-item-options-delete-dialog-error",
    })[0];
    expect(alert).toBeDefined();
    expect(alert.props.accessibilityRole).toBe("alert");
    expect(alert.props.accessibilityLiveRegion).toBe("assertive");
    expect(alert.props["aria-live"]).toBe("assertive");
    expect(alert.props.children).toBe(GENERIC_COPY);

    act(() => {
      rendered.unmount();
    });
    act(() => {
      tree.unmount();
    });
  });

  test("a dialog with no failure renders no alert at all — the change is additive", () => {
    let dialogTree: TestRenderer | null = null;
    act(() => {
      dialogTree = renderer.create(
        <RealConfirmDialog
          visible
          onClose={(): void => undefined}
          onConfirm={(): void => undefined}
          title="Remove something?"
          description="This can't be undone."
        />,
      );
    });
    if (dialogTree === null) throw new Error("the real dialog did not render");
    const rendered = dialogTree as TestRenderer;

    const alerts = rendered.root
      .findAllByType(Text)
      .filter((node) => node.props.accessibilityRole === "alert");
    expect(alerts).toHaveLength(0);
    act(() => {
      rendered.unmount();
    });
  });
});

/* =====================================================================
 * PR #3615 REWORK CYCLE 2 — one root cause, three symptoms.
 *
 * The retest of cycle 1 found that `MenuItemOptionsSection` held delete
 * refusals in a single unkeyed slot and never reconciled `editing` or that
 * slot against the live `groups` list. One defect produced three symptoms,
 * and each test below attacks exactly one of them:
 *
 *   1. the permanent lock was erased by the next tap on another group;
 *   2. the terminal lock had no release tied to any server signal;
 *   3. a refusal outlived the group it named, and took every control on the
 *      section with it.
 *
 * Each fails when its own fix line is deleted from the source. The
 * per-symptom deletion is recorded in the implementation report.
 * ================================================================== */

/** Re-renders the SAME tree so a changed query result is observed in place. */
const rerenderSection = (tree: TestRenderer): void => {
  act(() => {
    (tree as unknown as { update: (node: React.ReactElement) => void }).update(
      <MenuItemOptionsSection
        brandId="brand-3571"
        menuItemId="item-3571"
        itemCurrency="USD"
        canMutate
      />,
    );
  });
};

describe("#3615 rework cycle 2 — a refusal is reconciled against server truth", () => {
  /*
   * SYMPTOM 1. `requestDeleteGroup` cleared the whole refusal slot, for ANY
   * group. One tap on a second group's Remove therefore erased a permanent
   * refusal about the first, erased the only on-screen explanation of it, and
   * re-armed a delete the database can never accept — the app contradicting
   * on camera what it said thirty seconds earlier.
   */
  test("asking about ANOTHER group cannot erase a standing permanent refusal", () => {
    groups = [groupWith(3), otherGroup()];
    const tree = render();
    openEditorFor(tree, "group-3571");
    refuseTheDelete(tree, inUseRejection());
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    expect(textOf(tree)).toContain(IN_USE_COPY);

    // Leave Temperature, open Sides, and raise the ask about SIDES. This is
    // the exact tap that used to wipe Temperature's refusal.
    openEditorFor(tree, "group-3571-beta");
    act(() => {
      (deleteTriggerOf(tree).props.onPress as () => void)();
    });
    expect(dialogOf(tree).props.visible).toBe(true);
    // Back out of Sides without deleting anything at all.
    act(() => {
      (dialogOf(tree).props.onClose as () => void)();
    });

    // Return to Temperature. Its refusal is a fact about Temperature and
    // nothing the operator did to Sides can have touched it.
    openEditorFor(tree, "group-3571");
    expect(nodesWithTestId(tree, "menu-item-options-error")).not.toHaveLength(
      0,
    );
    expect(textOf(tree)).toContain(IN_USE_COPY);

    const trigger = deleteTriggerOf(tree);
    expect(trigger.props.disabled).toBe(true);
    act(() => {
      (trigger.props.onPress as () => void)();
    });
    // And the flow itself still refuses, so no second doomed mutation exists.
    const editor = tree.root.findAllByType(MenuModifierGroupEditor)[0];
    act(() => {
      (editor.props.onRequestDelete as (groupId: string) => void)(
        "group-3571",
      );
    });
    expect(dialogOf(tree).props.visible).toBe(false);
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    act(() => {
      tree.unmount();
    });
  });

  /*
   * SYMPTOM 2. Nothing released a permanent refusal — not a successful
   * refetch, not a role change, not closing the editor. On a single-group dish
   * there was no in-sheet escape at all, and the lock was decided by a
   * client-side classification, so one misread SQLSTATE disabled a legitimate
   * destructive control for the life of the dish sheet behind copy that may
   * have been untrue. `dataUpdatedAt` advances only when a read SETTLES
   * SUCCESSFULLY, so it is a real server signal and not a client guess.
   */
  test("a NEWER successful read of the group list releases the terminal lock", () => {
    groups = [groupWith(3)];
    const tree = render();
    openEditorFor(tree, "group-3571");
    refuseTheDelete(tree, inUseRejection());
    expect(deleteTriggerOf(tree).props.disabled).toBe(true);
    expect(textOf(tree)).toContain(IN_USE_COPY);

    // A re-render that carries no newer read is NOT a release. A refusal is
    // not forgotten just because the component painted again.
    rerenderSection(tree);
    expect(deleteTriggerOf(tree).props.disabled).toBe(true);
    expect(textOf(tree)).toContain(IN_USE_COPY);

    // Now the group list is genuinely re-read, and it still reports the group.
    groupsUpdatedAt = 2;
    rerenderSection(tree);

    expect(nodesWithTestId(tree, "menu-item-options-error")).toHaveLength(0);
    expect(textOf(tree)).not.toContain(IN_USE_COPY);
    const releasedTrigger = deleteTriggerOf(tree);
    expect(releasedTrigger.props.disabled).toBe(false);
    act(() => {
      (releasedTrigger.props.onPress as () => void)();
    });
    expect(dialogOf(tree).props.visible).toBe(true);
    act(() => {
      tree.unmount();
    });
  });

  /*
   * SYMPTOM 3. A refusal outlived its subject. With the group gone from a
   * refetch the assertive alert about it stayed on screen, and because
   * `editing` still pointed at the vanished group the section rendered no
   * rows, no editor and no "Add a choice" — zero controls, underneath an
   * assertive statement about a group that does not exist and the contradictory
   * "No choices yet."
   *
   * The read version is deliberately held constant here: this test must be
   * falsified by the group-gone reconciliation alone, not by the newer-read
   * release that symptom 2 owns.
   */
  test("a refusal about a group the list no longer returns leaves with it, and the section stays actionable", () => {
    groups = [groupWith(3)];
    const tree = render();
    openEditorFor(tree, "group-3571");
    refuseTheDelete(tree, inUseRejection());
    expect(textOf(tree)).toContain(IN_USE_COPY);
    // While the editor is genuinely open, Add is correctly hidden.
    expect(nodesWithTestId(tree, "menu-item-options-add")).toHaveLength(0);

    // Another manager, another device or another tab removes the group.
    groups = [];
    rerenderSection(tree);

    // Nothing on screen asserts anything about the group that is gone.
    expect(nodesWithTestId(tree, "menu-item-options-error")).toHaveLength(0);
    expect(textOf(tree)).not.toContain(IN_USE_COPY);
    // And the section can still be acted on — it is not a dead surface the
    // owner has to close the whole dish to escape.
    expect(textOf(tree)).toContain("No choices yet");
    expect(nodesWithTestId(tree, "modifier-group-cancel")).toHaveLength(0);
    expect(nodesWithTestId(tree, "menu-item-options-add")).not.toHaveLength(0);
    act(() => {
      tree.unmount();
    });
  });
});

/* ================================================================== *
 * PR #3615 REWORK CYCLE 3 — the refusal that was born already
 * superseded, and never rendered at all.
 *
 * APPEND-ONLY. Nothing above this line was edited, weakened or skipped.
 *
 * Cycle 2 released a refusal on a newer read, and stamped WHICH read it
 * was recorded against inside the delete mutation's `onError`, from a
 * ref written during render. That ref could only ever hold the newest
 * version the component had RENDERED — never the newest the client
 * HELD. React Query writes the new `dataUpdatedAt` into the cache the
 * instant a read settles; the render that observes it comes afterwards.
 * A rejection landing in that gap was stamped with the superseded
 * version and dropped by the very next render, before anyone saw it:
 *
 *   - permanent refusal: the confirmation closed, the group stayed, and
 *     NOTHING was said. A destructive action failed in silence, which is
 *     the exact defect class #3570 and #3571 were opened to remove;
 *   - retryable refusal: worse. The confirmation stayed OPEN carrying no
 *     reason at all, so the obvious next action was to tap Remove again
 *     on a delete that had just failed.
 *
 * The window is narrow — `refetchOnWindowFocus` is off globally, so it
 * needs a reconnect refetch, a configured retry succeeding, or another
 * group's save writing the cached list — but every one of those is real.
 *
 * Each test below drives exactly that ordering: the cached list's version
 * advances while the mutation is in flight, and NO render happens in
 * between, which is the whole point. `groupsUpdatedAt` is the version the
 * mock query reports, read fresh on every render.
 * ================================================================== */

/** Ask, and confirm — but leave the mutation in flight. */
const askThenConfirmDelete = (tree: TestRenderer): void => {
  act(() => {
    (deleteTriggerOf(tree).props.onPress as () => void)();
  });
  act(() => {
    (dialogOf(tree).props.onConfirm as () => void)();
  });
};

/** Settle the in-flight delete with `rejection`. */
const rejectPendingDelete = (rejection: Error): void => {
  const callbacks =
    deleteMutate.mock.calls[deleteMutate.mock.calls.length - 1][1];
  act(() => {
    callbacks?.onError?.(rejection);
    callbacks?.onSettled?.();
  });
};

const sectionAlerts = (tree: TestRenderer): TestNode[] =>
  nodesWithTestId(tree, "menu-item-options-error");

describe("#3615 rework cycle 3 — a refusal can never be born already superseded", () => {
  test("a read settling inside the delete's in-flight window cannot swallow a PERMANENT refusal", () => {
    groups = [groupWith(3)];
    groupsUpdatedAt = 1;
    const tree = render();
    openEditorFor(tree, "group-3571");

    // The last render the component performed saw version 1.
    askThenConfirmDelete(tree);

    // A read settles in the CACHE while the delete is still in flight —
    // a reconnect refetch, a retry succeeding, or another group's save
    // writing the list. No render has observed it yet.
    groupsUpdatedAt = 2;
    rejectPendingDelete(inUseRejection());

    // The owner MUST be told. Under the defect the dialog closed, the
    // group stayed, and the screen carried no error copy at all.
    expect(sectionAlerts(tree)).not.toHaveLength(0);
    expect(textOf(tree)).toContain(IN_USE_COPY);
    // And the refusal is a real refusal, not a flicker: the trigger is inert.
    expect(deleteTriggerOf(tree).props.disabled).toBe(true);
    // The ask is closed, because this failure can never succeed.
    expect(dialogOf(tree).props.visible).toBe(false);
    act(() => {
      tree.unmount();
    });
  });

  test("a read settling inside the delete's in-flight window cannot swallow a RETRYABLE refusal", () => {
    groups = [groupWith(3)];
    groupsUpdatedAt = 1;
    const tree = render();
    openEditorFor(tree, "group-3571");

    askThenConfirmDelete(tree);
    groupsUpdatedAt = 2;
    rejectPendingDelete(new Error("boom"));

    // The section states the failure. This is the assertion the P1 owns:
    // the in-dialog copy alone would be satisfied by the dialog's own
    // hold, so the silence must be disproved where the refusal lives.
    expect(sectionAlerts(tree)).not.toHaveLength(0);
    expect(textOf(tree)).toContain(GENERIC_COPY);
    // The dialog stays open because this IS retryable — and it says why
    // the last attempt failed, instead of sitting there blank inviting a
    // second tap on a delete that just failed.
    expect(dialogOf(tree).props.visible).toBe(true);
    expect(dialogOf(tree).props.errorMessage).toBe(GENERIC_COPY);
    // Exactly one attempt has been made.
    expect(deleteMutate).toHaveBeenCalledTimes(1);
    act(() => {
      tree.unmount();
    });
  });

  test("a control run with NO version change still renders exactly the same refusal", () => {
    // The two tests above must fail because of the race and nothing else.
    groups = [groupWith(3)];
    groupsUpdatedAt = 1;
    const tree = render();
    openEditorFor(tree, "group-3571");
    askThenConfirmDelete(tree);
    rejectPendingDelete(inUseRejection());

    expect(sectionAlerts(tree)).not.toHaveLength(0);
    expect(textOf(tree)).toContain(IN_USE_COPY);
    expect(deleteTriggerOf(tree).props.disabled).toBe(true);
    act(() => {
      tree.unmount();
    });
  });

  test("the release still works: the anchored refusal is dropped by the NEXT read after it was shown", () => {
    // Anchoring on first render must not turn the refusal permanent again.
    groups = [groupWith(3)];
    groupsUpdatedAt = 1;
    const tree = render();
    openEditorFor(tree, "group-3571");
    askThenConfirmDelete(tree);
    groupsUpdatedAt = 2;
    rejectPendingDelete(inUseRejection());
    expect(textOf(tree)).toContain(IN_USE_COPY);

    // Version 2 is the version this refusal was anchored to, so the read
    // AFTER it releases — one read later than before, which is exactly
    // what "survives until the next read after it became visible" means.
    groupsUpdatedAt = 3;
    rerenderSection(tree);

    expect(sectionAlerts(tree)).toHaveLength(0);
    expect(textOf(tree)).not.toContain(IN_USE_COPY);
    expect(deleteTriggerOf(tree).props.disabled).toBe(false);
    act(() => {
      tree.unmount();
    });
  });

  test("a forgotten refusal leaves no anchor behind for the next refusal on the same group", () => {
    // The anchor map is rebuilt from the live refusal store every run. If
    // a stale anchor could be inherited, a later refusal on the same group
    // would be measured against a version that is already gone — which is
    // the same "born already superseded" defect reached another way.
    groups = [groupWith(3)];
    groupsUpdatedAt = 1;
    const tree = render();
    openEditorFor(tree, "group-3571");
    askThenConfirmDelete(tree);
    rejectPendingDelete(new Error("boom"));
    expect(textOf(tree)).toContain(GENERIC_COPY);

    // Leaving the group forgets a RETRYABLE refusal — the store empties.
    act(() => {
      (
        nodesWithTestId(tree, "modifier-group-cancel")[0].props
          .onPress as () => void
      )();
    });
    expect(sectionAlerts(tree)).toHaveLength(0);

    // Reads move on, then the same group is refused again.
    groupsUpdatedAt = 5;
    rerenderSection(tree);
    openEditorFor(tree, "group-3571");
    askThenConfirmDelete(tree);
    rejectPendingDelete(inUseRejection());

    expect(sectionAlerts(tree)).not.toHaveLength(0);
    expect(textOf(tree)).toContain(IN_USE_COPY);
    act(() => {
      tree.unmount();
    });
  });
});

/* ================================================================== *
 * PR #3615 REWORK CYCLE 3, P3 — the in-dialog error is held for as
 * long as its dialog is open.
 *
 * The copy inside the confirmation is the assertive alert cycle 1 added
 * precisely so a VoiceOver or TalkBack operator hears WHY the delete
 * failed. Read through the reconciliation, a newer read could remove it
 * mid-announcement while the dialog the operator was still reading sat
 * open with no stated reason at all. Reconciliation answers "is the
 * SECTION still telling the truth about this group?"; the open dialog is
 * a different question — one attempt the operator is still inside.
 * ================================================================== */

describe("#3615 rework cycle 3 — the open confirmation holds its own failure copy", () => {
  test("a newer read cannot wipe the in-dialog error while the dialog is still open", () => {
    groups = [groupWith(3)];
    groupsUpdatedAt = 1;
    const tree = render();
    openEditorFor(tree, "group-3571");
    refuseTheDelete(tree, new Error("boom"));
    expect(dialogOf(tree).props.visible).toBe(true);
    expect(dialogOf(tree).props.errorMessage).toBe(GENERIC_COPY);

    // A read settles underneath the open dialog. The SECTION's standing
    // statement is released — that is cycle 2's deliberate semantic and
    // it is not being undone — but the dialog must keep the reason the
    // attempt the operator is still looking at failed.
    groupsUpdatedAt = 2;
    rerenderSection(tree);

    expect(dialogOf(tree).props.visible).toBe(true);
    expect(dialogOf(tree).props.errorMessage).toBe(GENERIC_COPY);
    act(() => {
      tree.unmount();
    });
  });

  test("the held copy is not immortal — starting the retry clears it", () => {
    groups = [groupWith(3)];
    groupsUpdatedAt = 1;
    const tree = render();
    openEditorFor(tree, "group-3571");
    refuseTheDelete(tree, new Error("boom"));
    expect(dialogOf(tree).props.errorMessage).toBe(GENERIC_COPY);

    // The same destructive action IS the retry. Once it is in flight the
    // previous attempt's reason is no longer the current state of play.
    act(() => {
      (dialogOf(tree).props.onConfirm as () => void)();
    });

    expect(deleteMutate).toHaveBeenCalledTimes(2);
    expect(dialogOf(tree).props.errorMessage).toBeNull();
    act(() => {
      tree.unmount();
    });
  });

  test("closing the confirmation takes the held copy with it", () => {
    groups = [groupWith(3)];
    groupsUpdatedAt = 1;
    const tree = render();
    openEditorFor(tree, "group-3571");
    refuseTheDelete(tree, new Error("boom"));
    expect(dialogOf(tree).props.errorMessage).toBe(GENERIC_COPY);

    act(() => {
      (dialogOf(tree).props.onClose as () => void)();
    });

    expect(dialogOf(tree).props.visible).toBe(false);
    expect(dialogOf(tree).props.errorMessage).toBeNull();
    act(() => {
      tree.unmount();
    });
  });
});
