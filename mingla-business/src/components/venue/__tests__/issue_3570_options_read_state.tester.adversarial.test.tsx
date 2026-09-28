/**
 * Issue #3570 TESTER adversarial guard — the options read state cannot be
 * talked into lying, and the honest message cannot be talked out of existing.
 *
 * WHY THIS SUITE EXISTS SEPARATELY FROM THE IMPLEMENTOR'S.
 * The implementor's suite walks the six states the spec names and proves each
 * one renders its own copy. That proves the happy shape of the machine. It
 * does NOT prove the machine is closed: that no input outside the six — an
 * unexpected error shape, a non-array `data`, an error riding on a `success`
 * status, a permission denial arriving on a REFETCH rather than a first load —
 * can steer a state into somebody else's voice.
 *
 * This suite attacks the closure, not the happy shape:
 *
 *   1. EXHAUSTIVE SWEEP. Every combination of status x isError x data-shape x
 *      error-shape is derived, and two invariants are asserted over the whole
 *      product: the success-shaped empty copy is reachable ONLY from a settled
 *      success over a real empty array, and no state ever renders an error
 *      message together with the empty copy.
 *   2. THE TWO FAILURE CLASSES CANNOT SWAP. A transient failure and a
 *      permission denial must never produce the same (message, canRetry) pair,
 *      in the fatal case AND in the cached-data case the implementor's suite
 *      only exercised for the transient class.
 *   3. ERROR-WITHIN-ERROR. A retry that fails again, and a retry issued after
 *      a previous retry settled — the synchronous latch must block the
 *      duplicate and then RELEASE, because a latch that never releases is a
 *      retry button that silently dies while every source signal stays green.
 *   4. THE TWO MESSAGE REGIONS CANNOT MERGE. #3570 and #3571 both write to the
 *      area under the "Options" label. A load failure and a delete failure are
 *      different facts; this suite raises both at once and proves each keeps
 *      its own region, its own testID and its whole text.
 *
 * Tests are append-only. Nothing here edits, weakens or skips an existing test.
 */

import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Text } from "react-native";

import type { MenuModifierGroup } from "../../../hooks/useMenuModifiers";

interface TestNode {
  type: unknown;
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

/* ---- the query double. Every field the section reads is steerable. ---- */
interface QueryShape {
  status: string;
  fetchStatus: string;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  data: MenuModifierGroup[] | undefined;
}

let query: QueryShape;
const refetchSpy = jest.fn<() => unknown>();
const deleteMutate =
  jest.fn<(variables: DeleteVariables, callbacks?: DeleteCallbacks) => void>();
let deletePending = false;

/*
 * Only the leaves that cannot load under the default node/ts-jest runner are
 * replaced. `Button` stays REAL so the retry control's rendered accessibility
 * name and its real 44pt floor are measured rather than asserted from props.
 */
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

// Button -> Spinner -> react-native-svg, whose Flow source cannot load under
// the default node/ts-jest runner. The spinner is decoration; the Button's own
// press gating, accessibility props and size floor are what this suite reads.
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

// ui/Input -> Sheet -> expo-blur ships ESM that the default runner cannot parse.
jest.mock("../../ui/Input", () => ({
  Input: (props: Record<string, unknown>) =>
    React.createElement("MockInput", props),
}));

jest.mock("../../ui/ConfirmDialog", () => ({
  ConfirmDialog: (props: Record<string, unknown>) =>
    React.createElement("MockConfirmDialog", props),
}));

jest.mock("../../../hooks/useMenuModifiers", () => {
  const actual = jest.requireActual(
    "../../../hooks/useMenuModifiers",
  ) as Record<string, unknown>;
  return {
    ...actual,
    useMenuModifierGroups: () => ({ ...query, refetch: refetchSpy }),
    useSaveModifierGroup: () => ({ isPending: false, mutate: jest.fn() }),
    useDeleteModifierGroup: () => ({
      isPending: deletePending,
      mutate: deleteMutate,
    }),
  };
});

// eslint-disable-next-line import/first
import {
  MENU_OPTIONS_READ_COPY,
  MenuItemOptionsSection,
  deriveMenuOptionsReadState,
  type MenuOptionsReadState,
} from "../MenuItemOptionsSection";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const renderer = require("react-test-renderer") as RendererApi;
const act = renderer.act;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const EMPTY_COPY = "No choices yet. Add one so guests can say how they want it.";
const LOADING_COPY = "Loading options…";
const DELETE_GENERIC_COPY = "We couldn't remove this group. Try again.";

const groupFixture = (id: string): MenuModifierGroup => ({
  id,
  menuItemId: "item-3570",
  name: `Group ${id}`,
  selectionMode: "single",
  minSelect: 1,
  maxSelect: 1,
  isActive: true,
  sortOrder: 0,
  modifiers: [
    {
      id: `${id}-opt`,
      groupId: id,
      name: "Hot",
      priceDeltaCents: 0,
      currency: "USD",
      isAvailable: true,
      sortOrder: 0,
    },
  ],
});

const permissionError = (): unknown => ({
  code: "42501",
  message: "permission denied for table menu_modifier_groups",
});

const transientError = (): unknown => ({
  message: "Network request failed",
});

const render = (): TestRenderer => {
  let tree: TestRenderer | null = null;
  act(() => {
    tree = renderer.create(
      <MenuItemOptionsSection
        brandId="brand-3570"
        menuItemId="item-3570"
        currency="USD"
        canMutate
      />,
    );
  });
  if (tree === null) throw new Error("render produced no tree");
  return tree;
};

/** Every string the section actually put on screen, flattened. */
const screenText = (tree: TestRenderer): string =>
  tree.root
    .findAllByType(Text)
    .map((node) => JSON.stringify(node.props.children ?? ""))
    .join(" | ");

const nodesWithTestId = (tree: TestRenderer, testID: string): TestNode[] =>
  tree.root.findAllByProps({ testID });

/*
 * `findAllByProps` returns the composite element AND the host element it
 * renders into, so a naive count double-counts every region. Collapse to the
 * HOST nodes — "how many of these did the operator actually see" is the only
 * question worth asking, and the host node is also the one carrying the
 * resolved accessibility props.
 */
const hostsWithTestId = (tree: TestRenderer, testID: string): TestNode[] =>
  tree.root
    .findAllByProps({ testID })
    .filter((node) => typeof node.type === "string");

const readStateMessage = (state: MenuOptionsReadState): string | null =>
  state.kind === "fatal-error" || state.kind === "stale-error"
    ? state.message
    : null;

beforeEach(() => {
  refetchSpy.mockReset();
  refetchSpy.mockReturnValue(Promise.resolve({}));
  deleteMutate.mockReset();
  deletePending = false;
  query = {
    status: "success",
    fetchStatus: "idle",
    isLoading: false,
    isError: false,
    isFetching: false,
    error: null,
    data: [],
  };
});

describe("#3570 tester adversarial — the read state machine is CLOSED", () => {
  /*
   * 1. EXHAUSTIVE SWEEP.
   *
   * The implementor proved six named states render six named strings. That is
   * a statement about six points. This is a statement about the whole space:
   * sweep every status x isError x data-shape x error-shape and assert the two
   * invariants that make the fix meaningful at all.
   */
  const STATUSES = ["pending", "success", "error", "idle", "loading", ""];
  const DATA_SHAPES: { label: string; value: unknown }[] = [
    { label: "undefined", value: undefined },
    { label: "null", value: null },
    { label: "empty array", value: [] },
    { label: "one group", value: [groupFixture("g1")] },
    { label: "a non-array object", value: { length: 0 } },
    { label: "a string", value: "" },
    { label: "a number", value: 0 },
  ];
  const ERROR_SHAPES: { label: string; value: unknown }[] = [
    { label: "null", value: null },
    { label: "undefined", value: undefined },
    { label: "a permission denial", value: permissionError() },
    { label: "a transient failure", value: transientError() },
    { label: "an empty object", value: {} },
    { label: "a bare string", value: "boom" },
    { label: "a number", value: 500 },
    { label: "an Error with no code", value: new Error("something broke") },
  ];

  test("the success-shaped empty copy is reachable ONLY from a settled success over a real empty array", () => {
    const reachedEmptyFrom: string[] = [];
    for (const status of STATUSES) {
      for (const isError of [true, false]) {
        for (const data of DATA_SHAPES) {
          for (const error of ERROR_SHAPES) {
            const state = deriveMenuOptionsReadState({
              status,
              isError,
              error: error.value,
              data: data.value as MenuModifierGroup[] | undefined,
            });
            if (state.kind !== "empty") continue;
            reachedEmptyFrom.push(
              `status=${status || "<empty>"} isError=${isError} data=${data.label} error=${error.label}`,
            );
            // Every route into the empty copy must be a settled success over a
            // genuinely empty array with no error flag anywhere.
            expect(status).toBe("success");
            expect(isError).toBe(false);
            expect(Array.isArray(data.value)).toBe(true);
            expect((data.value as unknown[]).length).toBe(0);
          }
        }
      }
    }
    // The sweep must actually have reached it — an assertion that never runs
    // proves nothing.
    expect(reachedEmptyFrom.length).toBeGreaterThan(0);
  });

  test("no point in the whole state space renders an error message and the empty copy together", () => {
    for (const status of STATUSES) {
      for (const isError of [true, false]) {
        for (const data of DATA_SHAPES) {
          for (const error of ERROR_SHAPES) {
            const state = deriveMenuOptionsReadState({
              status,
              isError,
              error: error.value,
              data: data.value as MenuModifierGroup[] | undefined,
            });
            const message = readStateMessage(state);
            if (message !== null) expect(state.kind).not.toBe("empty");
            if (state.kind === "empty") expect(message).toBeNull();
          }
        }
      }
    }
  });

  test("an error flag OVERRIDES a success status — a stale success can never bury a failure", () => {
    const state = deriveMenuOptionsReadState({
      status: "success",
      isError: true,
      error: transientError(),
      data: undefined,
    });
    expect(state.kind).toBe("fatal-error");
    expect(readStateMessage(state)).toBe(MENU_OPTIONS_READ_COPY.fatal);
  });

  test("a success whose data is not an array is LOADING, never empty, for every non-array shape", () => {
    for (const shape of DATA_SHAPES) {
      if (Array.isArray(shape.value)) continue;
      const state = deriveMenuOptionsReadState({
        status: "success",
        isError: false,
        error: null,
        data: shape.value as MenuModifierGroup[] | undefined,
      });
      expect({ shape: shape.label, kind: state.kind }).toEqual({
        shape: shape.label,
        kind: "loading",
      });
    }
  });

  /*
   * 2. THE TWO FAILURE CLASSES CANNOT SWAP.
   *
   * The implementor proved a permission denial on a FIRST LOAD says so and
   * offers no retry. The denial-on-REFETCH case — cached rows already on
   * screen — was never exercised, and that is the case where a wrong answer
   * is most expensive: the operator is looking at data, so a "Try again" they
   * can never satisfy reads as a broken button rather than a refused account.
   */
  test("a permission denial and a transient failure never produce the same (message, canRetry) pair — fatal case", () => {
    const denial = deriveMenuOptionsReadState({
      status: "error",
      isError: true,
      error: permissionError(),
      data: undefined,
    });
    const transient = deriveMenuOptionsReadState({
      status: "error",
      isError: true,
      error: transientError(),
      data: undefined,
    });
    expect(denial.kind).toBe("fatal-error");
    expect(transient.kind).toBe("fatal-error");
    expect(readStateMessage(denial)).toBe(
      MENU_OPTIONS_READ_COPY.fatalPermission,
    );
    expect(readStateMessage(transient)).toBe(MENU_OPTIONS_READ_COPY.fatal);
    expect(readStateMessage(denial)).not.toBe(readStateMessage(transient));
    // A denial must never be handed a retry; a transient failure must always
    // be handed one. These two facts are the whole point of the split.
    expect(
      denial.kind === "fatal-error" ? denial.canRetry : "unreachable",
    ).toBe(false);
    expect(
      transient.kind === "fatal-error" ? transient.canRetry : "unreachable",
    ).toBe(true);
  });

  test("a permission denial on a REFETCH keeps the cached rows and still refuses to offer a retry", () => {
    const denial = deriveMenuOptionsReadState({
      status: "error",
      isError: true,
      error: permissionError(),
      data: [groupFixture("g1")],
    });
    expect(denial.kind).toBe("stale-error");
    expect(denial.kind === "stale-error" ? denial.canRetry : "unreachable").toBe(
      false,
    );

    const transient = deriveMenuOptionsReadState({
      status: "error",
      isError: true,
      error: transientError(),
      data: [groupFixture("g1")],
    });
    expect(transient.kind).toBe("stale-error");
    expect(
      transient.kind === "stale-error" ? transient.canRetry : "unreachable",
    ).toBe(true);

    // Same message region, opposite affordance — the classes stay separable.
    const denialRetry =
      denial.kind === "stale-error" ? denial.canRetry : "unreachable";
    const transientRetry =
      transient.kind === "stale-error" ? transient.canRetry : "unreachable";
    expect(denialRetry).not.toBe(transientRetry);
  });

  test("a denied account sees NO retry control rendered at all, not a disabled one", () => {
    query = {
      status: "error",
      fetchStatus: "idle",
      isLoading: false,
      isError: true,
      isFetching: false,
      error: permissionError(),
      data: undefined,
    };
    const tree = render();
    expect(screenText(tree)).toContain(
      MENU_OPTIONS_READ_COPY.fatalPermission,
    );
    expect(hostsWithTestId(tree, "menu-item-options-read-retry")).toHaveLength(
      0,
    );
    // And the word that would make the refusal a lie is nowhere on screen.
    expect(screenText(tree)).not.toContain("Try again");
    tree.unmount();
  });

  test("an unrecognisable failure shape is retryable and generic — never a denial, never the empty copy", () => {
    for (const shape of ERROR_SHAPES) {
      if (shape.label === "a permission denial") continue;
      const state = deriveMenuOptionsReadState({
        status: "error",
        isError: true,
        error: shape.value,
        data: undefined,
      });
      expect({ shape: shape.label, kind: state.kind }).toEqual({
        shape: shape.label,
        kind: "fatal-error",
      });
      expect({
        shape: shape.label,
        message: readStateMessage(state),
      }).toEqual({ shape: shape.label, message: MENU_OPTIONS_READ_COPY.fatal });
      expect({
        shape: shape.label,
        canRetry: state.kind === "fatal-error" ? state.canRetry : "unreachable",
      }).toEqual({ shape: shape.label, canRetry: true });
    }
  });

  /*
   * 3. ERROR-WITHIN-ERROR — the retry path under repeated failure.
   *
   * The implementor proved a same-tick double activation issues one request.
   * They never proved the latch RELEASES. A latch that sticks turns the only
   * escape from a failed read into a dead control, and every source signal
   * (the button renders, the handler is wired, the test that counts one call
   * passes) stays green while it happens.
   */
  test("the retry latch RELEASES — a second retry after the first settles issues a genuine second request", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    refetchSpy.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    query = {
      status: "error",
      fetchStatus: "idle",
      isLoading: false,
      isError: true,
      isFetching: false,
      error: transientError(),
      data: undefined,
    };
    const tree = render();
    const retry = hostsWithTestId(tree, "menu-item-options-read-retry")[0];
    const press = (): void => {
      act(() => {
        (retry.props.onPress as (event: unknown) => void)({});
      });
    };

    press();
    expect(refetchSpy).toHaveBeenCalledTimes(1);

    // Still in flight — the duplicate is refused.
    press();
    expect(refetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({});
      await Promise.resolve();
    });

    // Settled. The control must be alive again.
    press();
    expect(refetchSpy).toHaveBeenCalledTimes(2);
    tree.unmount();
  });

  test("a retry that RESOLVES carrying another failure still releases the latch — a failed escape is not a permanent one", async () => {
    /*
     * React Query's `refetch()` resolves with the query result even when the
     * fetch failed; it does not reject. So the realistic second-failure shape
     * is a RESOLVED promise carrying an error, and the latch must release on
     * it exactly as it does on a success. A latch that only releases on the
     * happy path leaves the one escape from a failed read dead after a single
     * unlucky press.
     */
    let settleFirst: (value: unknown) => void = () => undefined;
    refetchSpy.mockReturnValueOnce(
      new Promise((resolve) => {
        settleFirst = resolve;
      }),
    );
    query = {
      status: "error",
      fetchStatus: "idle",
      isLoading: false,
      isError: true,
      isFetching: false,
      error: transientError(),
      data: undefined,
    };
    const tree = render();
    const retry = hostsWithTestId(tree, "menu-item-options-read-retry")[0];
    const press = (): void => {
      act(() => {
        (retry.props.onPress as (event: unknown) => void)({});
      });
    };

    press();
    expect(refetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      settleFirst({
        isError: true,
        error: transientError(),
        data: undefined,
      });
      await Promise.resolve();
    });

    press();
    expect(refetchSpy).toHaveBeenCalledTimes(2);
    tree.unmount();
  });

  test("a retry that fails AGAIN renders exactly one error region and still offers the escape", () => {
    query = {
      status: "error",
      fetchStatus: "idle",
      isLoading: false,
      isError: true,
      isFetching: false,
      error: transientError(),
      data: undefined,
    };
    const tree = render();
    expect(hostsWithTestId(tree, "menu-item-options-read-error")).toHaveLength(
      1,
    );
    expect(hostsWithTestId(tree, "menu-item-options-read-retry")).toHaveLength(
      1,
    );
    expect(screenText(tree)).not.toContain(EMPTY_COPY);
    tree.unmount();
  });

  test("while a retry is in flight the control is busy-disabled and the rows stay on screen", () => {
    query = {
      status: "error",
      fetchStatus: "fetching",
      isLoading: false,
      isError: true,
      isFetching: true,
      error: transientError(),
      data: [groupFixture("g1")],
    };
    const tree = render();
    const retry = hostsWithTestId(tree, "menu-item-options-read-retry")[0];
    expect(retry.props.disabled).toBe(true);
    // The cached row must not vanish because a refresh is in flight.
    expect(
      nodesWithTestId(tree, "menu-item-option-group-g1").length,
    ).toBeGreaterThan(0);
    expect(screenText(tree)).toContain(MENU_OPTIONS_READ_COPY.stale);
    tree.unmount();
  });

  /*
   * 4. THE TWO MESSAGE REGIONS CANNOT MERGE.
   *
   * #3570 and #3571 both write under the "Options" label. A load failure and a
   * delete failure are different facts about different actions; if either can
   * overwrite or absorb the other, the fix for one becomes the bug in the
   * other. Raise BOTH at once and prove each survives whole.
   */
  test("a load failure and a delete failure raised together keep separate regions and whole text", () => {
    query = {
      status: "error",
      fetchStatus: "idle",
      isLoading: false,
      isError: true,
      isFetching: false,
      error: transientError(),
      data: [groupFixture("g1")],
    };
    const tree = render();

    // Open the editor on the cached row and drive a rejected delete through
    // the real confirm path, so both failures are live at the same moment.
    const row = nodesWithTestId(tree, "menu-item-option-group-g1")[0];
    act(() => {
      (row.props.onPress as () => void)();
    });
    const trigger = nodesWithTestId(tree, "modifier-group-delete")[0];
    act(() => {
      (trigger.props.onPress as (event: unknown) => void)({});
    });
    const dialog = nodesWithTestId(tree, "menu-item-options-delete-dialog")[0];
    act(() => {
      (dialog.props.onConfirm as () => void)();
    });
    const callbacks = deleteMutate.mock.calls[0][1] as DeleteCallbacks;
    act(() => {
      callbacks.onError?.(new Error("network glitch"));
      callbacks.onSettled?.();
    });

    const readRegion = hostsWithTestId(tree, "menu-item-options-read-error");
    const deleteRegion = hostsWithTestId(tree, "menu-item-options-error");
    expect(readRegion).toHaveLength(1);
    expect(deleteRegion).toHaveLength(1);

    const text = screenText(tree);
    expect(text).toContain(MENU_OPTIONS_READ_COPY.stale);
    expect(text).toContain(DELETE_GENERIC_COPY);
    // Neither fact was replaced by the other, and the read failure did not
    // borrow the delete vocabulary or vice versa.
    expect(MENU_OPTIONS_READ_COPY.stale).not.toContain("remove");
    expect(DELETE_GENERIC_COPY).not.toContain("load");
    expect(DELETE_GENERIC_COPY).not.toContain("refresh");
    tree.unmount();
  });

  test("the read error region never carries the delete copy and the delete region never carries the read copy", () => {
    const readCopies = [
      MENU_OPTIONS_READ_COPY.fatal,
      MENU_OPTIONS_READ_COPY.fatalPermission,
      MENU_OPTIONS_READ_COPY.stale,
    ];
    // Disjointness is what makes "separate regions" mean anything: identical
    // strings in two places would be indistinguishable to a screen reader.
    for (const copy of readCopies) {
      expect(copy).not.toBe(DELETE_GENERIC_COPY);
      expect(copy.toLowerCase()).not.toContain("group");
    }
  });

  /*
   * ACCESSIBILITY — measured on the REAL Button, not asserted from a prop on a
   * stub. A stub cannot tell you the shipped control is reachable or legal.
   */
  test("the retry control is a REAL 44pt target carrying the contract's accessible name", () => {
    query = {
      status: "error",
      fetchStatus: "idle",
      isLoading: false,
      isError: true,
      isFetching: false,
      error: transientError(),
      data: undefined,
    };
    const tree = render();
    const retry = hostsWithTestId(tree, "menu-item-options-read-retry")[0];
    expect(retry.props.accessibilityLabel).toBe(
      MENU_OPTIONS_READ_COPY.retryAccessibleName,
    );
    expect(retry.props.accessibilityRole).toBe("button");

    const flatten = (style: unknown): Record<string, unknown> => {
      if (Array.isArray(style)) {
        return Object.assign(
          {},
          ...style.filter(Boolean).map((entry) => flatten(entry)),
        ) as Record<string, unknown>;
      }
      return (style ?? {}) as Record<string, unknown>;
    };
    const heights = tree.root
      .findAllByProps({ testID: "menu-item-options-read-retry" })
      .map((node) => flatten(node.props.style).minHeight)
      .filter((value): value is number => typeof value === "number");
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.max(...heights)).toBeGreaterThanOrEqual(44);
    tree.unmount();
  });

  test("the error message itself is the live region, so the adjacent retry stays reachable", () => {
    query = {
      status: "error",
      fetchStatus: "idle",
      isLoading: false,
      isError: true,
      isFetching: false,
      error: transientError(),
      data: undefined,
    };
    const tree = render();
    const alerts = tree.root
      .findAllByType(Text)
      .filter((node) => node.props.accessibilityRole === "alert");
    expect(alerts.length).toBeGreaterThan(0);
    const alert = alerts[0];
    expect(alert.props.accessibilityLiveRegion).toBe("assertive");
    expect(alert.props["aria-live"]).toBe("assertive");
    // The live region must NOT be an `accessible` wrapper around both the
    // message and the button — that flattens the button out of the subtree.
    const region = hostsWithTestId(tree, "menu-item-options-read-error")[0];
    expect(region.props.accessible).not.toBe(true);
    expect(region.props.accessibilityRole).toBeUndefined();
    tree.unmount();
  });

  test("a never-fetched disabled query says loading and renders neither the empty copy nor an error", () => {
    query = {
      status: "pending",
      fetchStatus: "idle",
      isLoading: false,
      isError: false,
      isFetching: false,
      error: null,
      data: undefined,
    };
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain(LOADING_COPY);
    expect(text).not.toContain(EMPTY_COPY);
    expect(hostsWithTestId(tree, "menu-item-options-read-error")).toHaveLength(
      0,
    );
    tree.unmount();
  });
});
