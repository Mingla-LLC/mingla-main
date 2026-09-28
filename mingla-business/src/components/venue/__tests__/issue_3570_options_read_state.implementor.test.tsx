/**
 * Issue #3570 implementor guard — an options READ failure can never be told as
 * "No choices yet."
 *
 * The defect was that the rendered output LIED: a thrown read arrived at the
 * component as `data ?? []`, and the render branched only on `isLoading`, so a
 * failed load was indistinguishable from an item that genuinely has no
 * choices. A source-string assertion passes over a component that throws, and
 * the whole defect class here is "what the tree says", so every proof below
 * mounts the REAL `MenuItemOptionsSection` against controlled query results and
 * reads the rendered tree.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Text, View } from "react-native";

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

interface QueryStub {
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "paused" | "idle";
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  data: MenuModifierGroup[] | undefined;
  refetch: () => Promise<unknown>;
}

const refetch = jest.fn<() => Promise<unknown>>(() => Promise.resolve());
let queryStub: QueryStub;

jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("MockButton", props),
}));

jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) =>
    React.createElement("MockConfirmDialog", props),
}));

// ui/Input pulls ui/Icon -> react-native-svg, whose Flow source cannot load
// under the default node/ts-jest runner. The section under test never renders
// an Input directly; this keeps the module graph loadable.
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
    useMenuModifierGroups: () => queryStub,
    useSaveModifierGroup: () => ({ isPending: false, mutate: jest.fn() }),
    useDeleteModifierGroup: () => ({ isPending: false, mutate: jest.fn() }),
  };
});

// Imports stay below the mocks so production binds to the test doubles.
// eslint-disable-next-line import/first
import { MenuItemOptionsSection } from "../MenuItemOptionsSection";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act;

const EMPTY_COPY =
  "No choices yet. Add one so guests can say how they want it.";
const LOADING_COPY = "Loading options…";
const FATAL_COPY =
  "Couldn't load choices. Check your connection and try again.";
const PERMISSION_COPY = "You cannot load choices with this account.";
const STALE_COPY = "Couldn't refresh choices. Showing the last saved version.";

const group = (id: string, name: string): MenuModifierGroup => ({
  id,
  menuItemId: "item-3570",
  name,
  selectionMode: "single",
  minSelect: 1,
  maxSelect: 1,
  isActive: true,
  sortOrder: 0,
  modifiers: [],
});

const permissionError = (): Error => {
  const error = new Error("permission denied for table menu_modifier_groups");
  (error as Error & { code?: string }).code = "42501";
  return error;
};

const settledSuccess = (groups: MenuModifierGroup[]): QueryStub => ({
  status: "success",
  fetchStatus: "idle",
  isLoading: false,
  isError: false,
  isFetching: false,
  error: null,
  data: groups,
  refetch,
});

const render = (): TestRenderer => {
  let tree: TestRenderer | null = null;
  act(() => {
    tree = renderer.create(
      <MenuItemOptionsSection
        brandId="brand-3570"
        menuItemId="item-3570"
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

beforeEach(() => {
  refetch.mockClear();
  refetch.mockImplementation(() => Promise.resolve());
});

describe("#3570 implementor — the options read state machine tells the truth", () => {
  test("a disabled, never-fetched query shows the loading status and NEVER the empty copy", () => {
    // React Query v5 leaves `isLoading` false for a disabled query, which is
    // exactly how a never-issued request used to render "No choices yet."
    queryStub = {
      status: "pending",
      fetchStatus: "idle",
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      data: undefined,
      refetch,
    };
    const tree = render();
    expect(textOf(tree)).toContain(LOADING_COPY);
    expect(textOf(tree)).not.toContain("No choices yet");
  });

  test("a first load in flight shows the loading status", () => {
    queryStub = {
      status: "pending",
      fetchStatus: "fetching",
      isLoading: true,
      isError: false,
      isFetching: true,
      error: null,
      data: undefined,
      refetch,
    };
    const tree = render();
    expect(textOf(tree)).toContain(LOADING_COPY);
    expect(textOf(tree)).not.toContain("No choices yet");
  });

  test("a settled success with zero groups is the ONLY route to the empty copy", () => {
    queryStub = settledSuccess([]);
    const tree = render();
    expect(textOf(tree)).toContain(EMPTY_COPY);
    expect(nodesWithTestId(tree, "menu-item-options-read-error")).toHaveLength(
      0,
    );
  });

  test("a settled success with groups renders the rows and no message", () => {
    queryStub = settledSuccess([group("g-1", "Temperature")]);
    const tree = render();
    expect(
      nodesWithTestId(tree, "menu-item-option-group-g-1"),
    ).not.toHaveLength(0);
    expect(textOf(tree)).not.toContain("No choices yet");
    expect(nodesWithTestId(tree, "menu-item-options-read-error")).toHaveLength(
      0,
    );
  });

  test("a fatal read error renders an alert-role message plus retry, and NOT the empty copy", () => {
    queryStub = {
      status: "error",
      fetchStatus: "idle",
      isLoading: false,
      isError: true,
      isFetching: false,
      error: new Error("network request failed"),
      data: undefined,
      refetch,
    };
    const tree = render();
    expect(textOf(tree)).toContain(FATAL_COPY);
    expect(textOf(tree)).not.toContain("No choices yet");

    const alerts = tree.root.findAllByProps({ accessibilityRole: "alert" });
    expect(alerts.length).toBeGreaterThan(0);
    expect(
      alerts.some((node) => node.props.accessibilityLiveRegion === "assertive"),
    ).toBe(true);

    const retry = nodesWithTestId(tree, "menu-item-options-read-retry");
    expect(retry).not.toHaveLength(0);
    expect(retry[0].props.accessibilityLabel).toBe("Retry loading options");
    // ui/Button size="sm" is 36pt — below the venue surface's 44pt target.
    expect(retry[0].props.size).toBe("md");
  });

  test("a permission denial states it plainly and offers NO retry", () => {
    queryStub = {
      status: "error",
      fetchStatus: "idle",
      isLoading: false,
      isError: true,
      isFetching: false,
      error: permissionError(),
      data: undefined,
      refetch,
    };
    const tree = render();
    expect(textOf(tree)).toContain(PERMISSION_COPY);
    expect(textOf(tree)).not.toContain("No choices yet");
    expect(nodesWithTestId(tree, "menu-item-options-read-retry")).toHaveLength(
      0,
    );
  });

  test("a failed REFETCH keeps every cached row on screen and marks it stale", () => {
    queryStub = {
      status: "error",
      fetchStatus: "idle",
      isLoading: false,
      isError: true,
      isFetching: false,
      error: new Error("failed to fetch"),
      data: [group("g-1", "Temperature"), group("g-2", "Extras")],
      refetch,
    };
    const tree = render();
    expect(
      nodesWithTestId(tree, "menu-item-option-group-g-1"),
    ).not.toHaveLength(0);
    expect(
      nodesWithTestId(tree, "menu-item-option-group-g-2"),
    ).not.toHaveLength(0);
    expect(textOf(tree)).toContain(STALE_COPY);
    expect(textOf(tree)).not.toContain("No choices yet");
  });

  test("an error over a previously empty list still refuses the success-shaped copy", () => {
    queryStub = {
      status: "error",
      fetchStatus: "idle",
      isLoading: false,
      isError: true,
      isFetching: false,
      error: new Error("boom"),
      data: [],
      refetch,
    };
    const tree = render();
    expect(textOf(tree)).toContain(STALE_COPY);
    expect(textOf(tree)).not.toContain("No choices yet");
  });

  test("activating retry calls refetch exactly once, and a same-tick repeat adds none", () => {
    queryStub = {
      status: "error",
      fetchStatus: "idle",
      isLoading: false,
      isError: true,
      isFetching: false,
      error: new Error("network request failed"),
      data: undefined,
      refetch,
    };
    const tree = render();
    const retry = nodesWithTestId(tree, "menu-item-options-read-retry")[0];
    const press = retry.props.onPress as () => void;
    act(() => {
      press();
      press();
      press();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test("a retry already in flight is busy-disabled and issues no second request", () => {
    queryStub = {
      status: "error",
      fetchStatus: "fetching",
      isLoading: false,
      isError: true,
      isFetching: true,
      error: new Error("network request failed"),
      data: undefined,
      refetch,
    };
    const tree = render();
    const retry = nodesWithTestId(tree, "menu-item-options-read-retry")[0];
    expect(retry.props.disabled).toBe(true);
    expect(retry.props.loading).toBe(true);
    act(() => {
      (retry.props.onPress as () => void)();
    });
    expect(refetch).toHaveBeenCalledTimes(0);
  });

  test("recovery removes the message and renders current server truth", () => {
    queryStub = settledSuccess([group("g-1", "Temperature")]);
    const tree = render();
    expect(nodesWithTestId(tree, "menu-item-options-read-error")).toHaveLength(
      0,
    );
    expect(textOf(tree)).not.toContain(FATAL_COPY);
    expect(textOf(tree)).not.toContain(STALE_COPY);
    expect(tree.root.findAllByType(View).length).toBeGreaterThan(0);
  });

  /*
   * PR #3615 rework, P3-3 — the retry latch must release on EVERY exit.
   *
   * `refetch()` does not throw under React Query v5, so this is a latent
   * defect rather than a live one — which is exactly what makes it dangerous:
   * if it ever did throw, the exception escaped before `.finally` was attached,
   * the latch stayed closed forever, and the only escape route from a failed
   * read went permanently dead while every source signal stayed green.
   */
  test("a refetch that throws SYNCHRONOUSLY still releases the retry latch", () => {
    queryStub = {
      status: "error",
      fetchStatus: "idle",
      isLoading: false,
      isError: true,
      isFetching: false,
      error: new Error("network request failed"),
      data: undefined,
      refetch,
    };
    refetch.mockImplementationOnce(() => {
      throw new Error("refetch exploded before it returned a promise");
    });
    const tree = render();
    const press = nodesWithTestId(tree, "menu-item-options-read-retry")[0].props
      .onPress as () => void;

    // The throw must not escape the handler and take the press down with it.
    act(() => {
      press();
    });
    expect(refetch).toHaveBeenCalledTimes(1);

    // And the control must still be alive: a second activation genuinely asks
    // the server again.
    act(() => {
      press();
    });
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
