/**
 * Issue #1735 rework P2-4 — the add-competitor sheet's keyboard contract.
 *
 * Tester evidence: typeahead results rendered BEHIND the iOS keyboard and a
 * body tap did not dismiss it. The fix is the GlobalSearchSheet typeahead
 * idiom: full-height TOP-anchored sheet (input + results above the keyboard)
 * with the results in a ScrollView that persists taps (result rows tappable
 * with the keyboard up) and dismisses the keyboard on drag.
 *
 * Fails-on-revert: deleting `snapPoint="full"` / `verticalAlign="top"` from
 * the Sheet, or the keyboard props from the results ScrollView, turns these
 * assertions RED.
 */

import React from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ReactLocal = require("react") as typeof React;

jest.mock("../../../ui/Sheet", () => ({
  __esModule: true,
  Sheet: (props: { children?: unknown }) =>
    ReactLocal.createElement("Sheet", props, props.children as never),
}));
jest.mock("../../../ui/Button", () => ({
  __esModule: true,
  Button: (props: Record<string, unknown>) =>
    ReactLocal.createElement("Button", props),
}));
jest.mock("../../../ui/Input", () => ({
  __esModule: true,
  Input: (props: Record<string, unknown>) =>
    ReactLocal.createElement("Input", props),
}));
jest.mock("../../../ui/ConfirmDialog", () => ({
  __esModule: true,
  ConfirmDialog: (props: Record<string, unknown>) =>
    ReactLocal.createElement("ConfirmDialog", props),
}));
jest.mock("../../../../context/AuthContext", () => ({
  __esModule: true,
  useAuth: () => ({ loading: false, session: { user: { id: "u1" } } }),
}));
jest.mock("../../../../hooks/useCompetitorIntelligence", () => ({
  __esModule: true,
  useAddCompetitor: () => ({
    mutate: jest.fn(),
    reset: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));
jest.mock("@tanstack/react-query", () => ({
  __esModule: true,
  useQuery: () => ({
    data: [],
    isFetching: false,
    isFetched: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

import { CompetitorAddSheet } from "../CompetitorAddSheet";

interface RenderNode {
  type?: unknown;
  props: Record<string, unknown> & { testID?: string };
}
interface RenderTree {
  root: { findAll: (predicate: (node: RenderNode) => boolean) => RenderNode[] };
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const render = async (): Promise<RenderTree> => {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <CompetitorAddSheet
        visible
        onClose={jest.fn()}
        brandId="brand-1"
        venueListingId="venue-1"
        venueCity="London"
      />,
    );
  });
  return tree!;
};

describe("issue #1735 rework — add-sheet keyboard contract (P2-4)", () => {
  it("the sheet is FULL-height and TOP-anchored (results live above the keyboard)", async () => {
    const tree = await render();
    const sheet = tree.root.findAll(
      (n) => typeof n.type === "string" && n.type === "Sheet",
    )[0]!;
    expect(sheet.props.snapPoint).toBe("full");
    expect(sheet.props.verticalAlign).toBe("top");
    tree.unmount();
  });

  it("the results ScrollView persists taps and dismisses the keyboard on drag", async () => {
    const tree = await render();
    const scroll = tree.root.findAll(
      (n) =>
        typeof n.type === "string" &&
        n.props.testID === "competitor-add-sheet-scroll",
    )[0]!;
    expect(scroll).toBeDefined();
    // Result rows must be TAPPABLE with the keyboard up (a plain tap on a row
    // must select it, not just dismiss the keyboard).
    expect(scroll.props.keyboardShouldPersistTaps).toBe("handled");
    // Dragging the results dismisses the keyboard (the body-tap/drag door the
    // tester found missing).
    expect(scroll.props.keyboardDismissMode).toBe("on-drag");
    tree.unmount();
  });
});
