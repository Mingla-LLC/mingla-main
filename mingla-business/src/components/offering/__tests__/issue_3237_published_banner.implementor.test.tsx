/**
 * issue #3237 [after Publish, land on the manage screen] — implementor happy
 * path for the banner and the one-shot arrival hook. Append-only: NEW file.
 *
 * The UI-kit primitives are stubbed to marker host nodes that CARRY THEIR
 * PROPS (the approach of TicketTierEditSheet.issue2664.happy.test.tsx), so each
 * assertion reads the rendered button and presses the handler it was given.
 *
 * FAILS-ON-REVERT (true line deletion):
 *  - delete `onPress={onShare}` / `onPress={onViewPublic}` / `onPress={onDismiss}`
 *    in PublishedBanner                                  -> the wiring tests RED
 *  - delete the `onViewPublic !== undefined ?` guard     -> "private RSVP" RED
 *  - delete the `consumeJustPublished` effect in the hook -> "shows once" RED
 */
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({
    children,
    testID,
  }: {
    children?: React.ReactNode;
    testID?: string;
  }) => React.createElement("MockGlassCard", { testID }, children),
}));
jest.mock("../../ui/Icon", () => ({ Icon: (): null => null }));
jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) =>
    React.createElement("MockButton", props),
}));
jest.mock("../../ui/IconChrome", () => ({
  IconChrome: (props: Record<string, unknown>) =>
    React.createElement("MockIconChrome", props),
}));

// eslint-disable-next-line import/first
import { PublishedBanner } from "../PublishedBanner";
// eslint-disable-next-line import/first
import { useJustPublishedArrival } from "../../../hooks/useJustPublishedArrival";
// eslint-disable-next-line import/first
import {
  markJustPublished,
  resetJustPublishedForTests,
} from "../../../utils/justPublishedSignal";

type HostNode = {
  type: unknown;
  props: Record<string, unknown>;
  children: (HostNode | string)[];
};
type Tree = {
  root: {
    findAll: (predicate: (node: HostNode) => boolean) => HostNode[];
    findAllByType: (type: string) => HostNode[];
  };
  unmount: () => void;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const mount = async (element: React.ReactElement): Promise<Tree> => {
  let tree: Tree | undefined;
  await TestRenderer.act(() => {
    tree = TestRenderer.create(element);
  });
  return tree as Tree;
};

const buttons = (tree: Tree): HostNode[] => tree.root.findAllByType("MockButton");
const button = (tree: Tree, label: string): HostNode | undefined =>
  buttons(tree).find((node) => node.props.label === label);
const press = async (node: HostNode | undefined): Promise<void> => {
  expect(node).toBeDefined();
  await TestRenderer.act(() => {
    ((node as HostNode).props.onPress as () => void)();
  });
};
const textOf = (tree: Tree): string => {
  const out: string[] = [];
  const walk = (node: HostNode | string): void => {
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    node.children.forEach(walk);
  };
  walk(tree.root as unknown as HostNode);
  return out.join(" ");
};

afterEach(() => resetJustPublishedForTests());

describe("#3237 PublishedBanner", () => {
  test("confirms the publish and names the next step for the type", async () => {
    const tree = await mount(
      <PublishedBanner
        kind="paid_event"
        onShare={() => undefined}
        onViewPublic={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    const text = textOf(tree);
    expect(text).toContain("Published. It's live.");
    expect(text).toContain("Share it to start selling tickets.");
  });

  test("Share and View public page call the handlers the screen passed in", async () => {
    const onShare = jest.fn();
    const onViewPublic = jest.fn();
    const tree = await mount(
      <PublishedBanner
        kind="trip"
        onShare={onShare}
        onViewPublic={onViewPublic}
        onDismiss={() => undefined}
      />,
    );
    await press(button(tree, "Share"));
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onViewPublic).not.toHaveBeenCalled();
    await press(button(tree, "View public page"));
    expect(onViewPublic).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  test("both buttons and the dismiss control carry accessible labels", async () => {
    const tree = await mount(
      <PublishedBanner
        kind="experience"
        onShare={() => undefined}
        onViewPublic={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(button(tree, "Share")?.props.accessibilityLabel).toBe("Share");
    expect(button(tree, "View public page")?.props.accessibilityLabel).toBe(
      "View public page",
    );
    const dismiss = tree.root.findAllByType("MockIconChrome");
    expect(dismiss).toHaveLength(1);
    expect(dismiss[0].props.accessibilityLabel).toBe("Dismiss");
  });

  test("the dismiss control calls onDismiss", async () => {
    const onDismiss = jest.fn();
    const tree = await mount(
      <PublishedBanner kind="rsvp" onShare={() => undefined} onDismiss={onDismiss} />,
    );
    await press(tree.root.findAllByType("MockIconChrome")[0]);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test("a private RSVP gets the confirmation with no public-page or share button", async () => {
    const tree = await mount(
      <PublishedBanner kind="rsvp" onDismiss={() => undefined} />,
    );
    expect(textOf(tree)).toContain("Published. It's live.");
    expect(buttons(tree)).toHaveLength(0);
    // The "Share it…" line is not shown without a Share button to act on.
    expect(textOf(tree)).not.toContain("Share it");
  });

  test("Share without a public page shows Share only", async () => {
    const tree = await mount(
      <PublishedBanner kind="rsvp" onShare={() => undefined} onDismiss={() => undefined} />,
    );
    expect(buttons(tree).map((node) => node.props.label)).toEqual(["Share"]);
    expect(textOf(tree)).toContain("Share it to start getting guests.");
  });
});

/** A manage screen in miniature: the real hook gating the real banner. */
const ManageScreenProbe: React.FC<{ id: string | null }> = ({ id }) => {
  const arrival = useJustPublishedArrival(id);
  return arrival.justPublished ? (
    <PublishedBanner
      kind="trip"
      onShare={() => undefined}
      onViewPublic={() => undefined}
      onDismiss={arrival.dismiss}
    />
  ) : null;
};
const bannerCount = (tree: Tree): number =>
  tree.root.findAllByType("MockGlassCard").length;

describe("#3237 the banner shows once, only after a publish", () => {
  test("no banner when the item was not just published", async () => {
    const tree = await mount(<ManageScreenProbe id="trip-1" />);
    expect(bannerCount(tree)).toBe(0);
  });

  test("no banner for a different item than the one published", async () => {
    markJustPublished("trip-1");
    const tree = await mount(<ManageScreenProbe id="trip-2" />);
    expect(bannerCount(tree)).toBe(0);
  });

  test("the banner shows on arrival, and not again on a later visit", async () => {
    markJustPublished("trip-1");
    const first = await mount(<ManageScreenProbe id="trip-1" />);
    expect(bannerCount(first)).toBe(1);
    await TestRenderer.act(() => first.unmount());
    // Refresh / back-navigation / reopening the screen: the signal is spent.
    const second = await mount(<ManageScreenProbe id="trip-1" />);
    expect(bannerCount(second)).toBe(0);
  });

  test("dismissing removes the banner", async () => {
    markJustPublished("trip-1");
    const tree = await mount(<ManageScreenProbe id="trip-1" />);
    expect(bannerCount(tree)).toBe(1);
    await press(tree.root.findAllByType("MockIconChrome")[0]);
    expect(bannerCount(tree)).toBe(0);
  });

  test("the banner still shows when the route id resolves after the first render", async () => {
    markJustPublished("trip-1");
    let tree: Tree | undefined;
    await TestRenderer.act(() => {
      tree = TestRenderer.create(<ManageScreenProbe id={null} />);
    });
    expect(bannerCount(tree as Tree)).toBe(0);
    await TestRenderer.act(() => {
      (tree as unknown as { update: (el: React.ReactElement) => void }).update(
        <ManageScreenProbe id="trip-1" />,
      );
    });
    expect(bannerCount(tree as Tree)).toBe(1);
  });
});
