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

// Imports stay below the mocks so production binds to the test doubles.
// eslint-disable-next-line import/first
import {
  MenuItemOptionsSection,
  modifierGroupDeleteError,
} from "../MenuItemOptionsSection";

const realHooks = jest.requireActual(
  "../../../hooks/useMenuModifiers",
) as typeof import("../../../hooks/useMenuModifiers");

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act;

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
