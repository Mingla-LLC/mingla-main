/**
 * issue #3237 — the trip options menu does not offer public links for a draft.
 * Append-only: NEW file.
 *
 * "View public page" and "Share trip link" both open the buyer's page, which
 * does not exist until the trip is published — on a draft they opened
 * "not found". Published trips keep both rows.
 *
 * FAILS-ON-REVERT (true line deletion): delete the `canOpenPublicPage ?` guard
 * around the two rows in TripManageMenu -> "draft" RED.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("../../ui/Sheet", () => ({
  Sheet: ({
    visible,
    children,
  }: {
    visible: boolean;
    children?: React.ReactNode;
  }) => (visible ? React.createElement("MockSheet", null, children) : null),
}));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));

// eslint-disable-next-line import/first
import { TripManageMenu } from "../TripManageMenu";

type HostNode = { type: unknown; props: Record<string, unknown> };
type Tree = {
  root: { findAll: (predicate: (node: HostNode) => boolean) => HostNode[] };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const handlers = () => ({
  onClose: jest.fn(),
  onShare: jest.fn(),
  onEdit: jest.fn(),
  onViewPublic: jest.fn(),
  onCancelTrip: jest.fn(),
});

const mount = async (
  props: Partial<React.ComponentProps<typeof TripManageMenu>>,
  h = handlers(),
): Promise<{ tree: Tree; h: ReturnType<typeof handlers> }> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(<TripManageMenu visible {...h} {...props} />);
  });
  return { tree: tree as Tree, h };
};

/** Row labels in render order, one per row (deduped across host layers). */
const rowLabels = (tree: Tree): string[] => {
  const seen: string[] = [];
  for (const node of tree.root.findAll(
    (n) =>
      typeof n.props.testID === "string" &&
      (n.props.testID as string).startsWith("trip-manage-") &&
      typeof n.props.accessibilityLabel === "string",
  )) {
    const label = node.props.accessibilityLabel as string;
    if (!seen.includes(label)) seen.push(label);
  }
  return seen;
};
const row = (tree: Tree, testID: string): HostNode => {
  const matches = tree.root.findAll(
    (n) => n.props.testID === testID && typeof n.props.onPress === "function",
  );
  expect(matches.length).toBeGreaterThan(0);
  return matches[0];
};

describe("#3237 TripManageMenu on a draft", () => {
  test("a draft is offered Edit only — no public page, no share link", async () => {
    const { tree } = await mount({ canOpenPublicPage: false, canCancelTrip: false });
    expect(rowLabels(tree)).toEqual(["Edit trip"]);
  });

  test("a published trip still offers View public page and Share trip link", async () => {
    const { tree } = await mount({ canOpenPublicPage: true });
    expect(rowLabels(tree)).toEqual([
      "View public page",
      "Share trip link",
      "Edit trip",
      "Cancel trip",
    ]);
  });

  test("the default (no prop) keeps both rows, so existing callers are unchanged", async () => {
    const { tree } = await mount({});
    expect(rowLabels(tree)).toContain("View public page");
    expect(rowLabels(tree)).toContain("Share trip link");
  });

  test("the published rows still fire the screen's handlers", async () => {
    const { tree, h } = await mount({ canOpenPublicPage: true });
    await TestRenderer.act(() => {
      (row(tree, "trip-manage-share").props.onPress as () => void)();
    });
    expect(h.onShare).toHaveBeenCalledTimes(1);
    await TestRenderer.act(() => {
      (row(tree, "trip-manage-view-public").props.onPress as () => void)();
    });
    expect(h.onViewPublic).toHaveBeenCalledTimes(1);
  });
});
