/**
 * issue #3237 [after Publish, land on the manage screen] — TESTER adversarial.
 * Append-only: NEW file. Angles the implementor suite does not take:
 *
 *  - the LAZY host the four manage screens actually mount: it renders nothing
 *    (and throws nothing) while its chunk loads, then the real banner with the
 *    screen's handlers and test id;
 *  - "View public page" WITHOUT Share (not a combination the implementor
 *    renders): the share invitation must not be shown or announced;
 *  - handler isolation: each control fires its own handler only;
 *  - what a screen reader is told, per type, with and without Share;
 *  - the trip options menu when the public rows are hidden but the trip can
 *    still be cancelled: nothing else goes missing and the rest still fires;
 *  - the draft rule across every status a trip or experience can have.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

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
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({
    visible,
    children,
  }: {
    visible: boolean;
    children?: React.ReactNode;
  }) => (visible ? React.createElement("MockSheet", null, children) : null),
}));

// eslint-disable-next-line import/first
import { LazyPublishedBanner } from "../LazyPublishedBanner";
// eslint-disable-next-line import/first
import { PublishedBanner } from "../PublishedBanner";
// eslint-disable-next-line import/first
import {
  PUBLISHED_BANNER_TITLE,
  publishedBannerSupportingLine,
  publishedEventBannerKind,
  type PublishedBannerKind,
} from "../publishedBannerCopy";
// eslint-disable-next-line import/first
import { TripManageMenu } from "../../trip/TripManageMenu";
// eslint-disable-next-line import/first
import { canOfferPublicLinks } from "../../../utils/offeringPublicLinks";

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
  toJSON: () => unknown;
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
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await TestRenderer.act(async () => {
      await Promise.resolve();
    });
  }
};
const buttons = (tree: Tree): HostNode[] => tree.root.findAllByType("MockButton");
const labels = (tree: Tree): unknown[] => buttons(tree).map((n) => n.props.label);
const pressNode = async (node: HostNode): Promise<void> => {
  await TestRenderer.act(() => {
    (node.props.onPress as () => void)();
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
const alertLabel = (tree: Tree): string => {
  const regions = tree.root.findAll(
    (n) =>
      n.props.accessibilityRole === "alert" &&
      typeof n.props.accessibilityLabel === "string",
  );
  expect(regions.length).toBeGreaterThan(0);
  return regions[0].props.accessibilityLabel as string;
};

const KINDS: PublishedBannerKind[] = [
  "paid_event",
  "free_event",
  "rsvp",
  "trip",
  "experience",
];

describe("#3237 tester — the lazy host the manage screens mount", () => {
  test("renders nothing, and throws nothing, while the banner loads; then the banner with the screen's handlers", async () => {
    const onShare = jest.fn();
    const onViewPublic = jest.fn();
    const onDismiss = jest.fn();
    let tree: Tree | undefined;
    // Synchronous first commit: the Suspense fallback is null, so the screen
    // above and below the banner renders without it.
    TestRenderer.act(() => {
      tree = TestRenderer.create(
        <LazyPublishedBanner
          kind="trip"
          onShare={onShare}
          onViewPublic={onViewPublic}
          onDismiss={onDismiss}
          testID="trip-published-banner"
        />,
      );
    });
    expect((tree as Tree).toJSON()).toBeNull();
    expect((tree as Tree).root.findAllByType("MockGlassCard")).toHaveLength(0);
    await settle();
    const mounted = tree as Tree;
    const cards = mounted.root.findAllByType("MockGlassCard");
    expect(cards).toHaveLength(1);
    expect(cards[0].props.testID).toBe("trip-published-banner");
    expect(labels(mounted)).toEqual(["Share", "View public page"]);

    await pressNode(buttons(mounted)[0]);
    await pressNode(buttons(mounted)[1]);
    await pressNode(mounted.root.findAllByType("MockIconChrome")[0]);
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onViewPublic).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test("the lazy host passes a private RSVP through with no buttons", async () => {
    const tree = await mount(
      <LazyPublishedBanner kind="rsvp" onDismiss={() => undefined} />,
    );
    await settle();
    expect(tree.root.findAllByType("MockGlassCard")).toHaveLength(1);
    expect(buttons(tree)).toHaveLength(0);
  });
});

describe("#3237 tester — banner combinations the screens can produce", () => {
  test("View public page without Share: no share invitation is shown or announced", async () => {
    const onViewPublic = jest.fn();
    const tree = await mount(
      <PublishedBanner
        kind="experience"
        onViewPublic={onViewPublic}
        onDismiss={() => undefined}
      />,
    );
    expect(labels(tree)).toEqual(["View public page"]);
    expect(textOf(tree)).not.toContain("Share it");
    expect(alertLabel(tree)).toBe(PUBLISHED_BANNER_TITLE);
    await pressNode(buttons(tree)[0]);
    expect(onViewPublic).toHaveBeenCalledTimes(1);
  });

  test("each control fires its own handler and no other", async () => {
    const onShare = jest.fn();
    const onViewPublic = jest.fn();
    const onDismiss = jest.fn();
    const tree = await mount(
      <PublishedBanner
        kind="paid_event"
        onShare={onShare}
        onViewPublic={onViewPublic}
        onDismiss={onDismiss}
      />,
    );
    await pressNode(buttons(tree)[0]);
    expect([onShare, onViewPublic, onDismiss].map((f) => f.mock.calls.length)).toEqual([1, 0, 0]);
    await pressNode(buttons(tree)[1]);
    expect([onShare, onViewPublic, onDismiss].map((f) => f.mock.calls.length)).toEqual([1, 1, 0]);
    await pressNode(tree.root.findAllByType("MockIconChrome")[0]);
    expect([onShare, onViewPublic, onDismiss].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  test("Share and View public page never dismiss the banner by themselves", async () => {
    // The screen decides: opening the share sheet must not lose the confirmation.
    const onDismiss = jest.fn();
    const tree = await mount(
      <PublishedBanner
        kind="trip"
        onShare={() => undefined}
        onViewPublic={() => undefined}
        onDismiss={onDismiss}
      />,
    );
    await pressNode(buttons(tree)[0]);
    await pressNode(buttons(tree)[1]);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(tree.root.findAllByType("MockGlassCard")).toHaveLength(1);
  });

  test("a screen reader hears the confirmation plus the type's next step; without Share, the confirmation only", async () => {
    for (const kind of KINDS) {
      const withShare = await mount(
        <PublishedBanner kind={kind} onShare={() => undefined} onDismiss={() => undefined} />,
      );
      expect(alertLabel(withShare)).toBe(
        `${PUBLISHED_BANNER_TITLE} ${publishedBannerSupportingLine(kind)}`,
      );
      const without = await mount(
        <PublishedBanner kind={kind} onDismiss={() => undefined} />,
      );
      expect(alertLabel(without)).toBe(PUBLISHED_BANNER_TITLE);
    }
  });

  test("every control has a label and a test id derived from the screen's own id", async () => {
    const tree = await mount(
      <PublishedBanner
        kind="rsvp"
        onShare={() => undefined}
        onViewPublic={() => undefined}
        onDismiss={() => undefined}
        testID="rsvp-published-banner"
      />,
    );
    const controls = [...buttons(tree), ...tree.root.findAllByType("MockIconChrome")];
    expect(controls.map((n) => n.props.testID)).toEqual([
      "rsvp-published-banner-share",
      "rsvp-published-banner-view-public",
      "rsvp-published-banner-dismiss",
    ]);
    for (const control of controls) {
      expect(typeof control.props.accessibilityLabel).toBe("string");
      expect((control.props.accessibilityLabel as string).length).toBeGreaterThan(0);
      expect(typeof control.props.onPress).toBe("function");
    }
  });

  test("nothing on the banner names a payment provider, an internal status or an id", async () => {
    for (const kind of KINDS) {
      const tree = await mount(
        <PublishedBanner
          kind={kind}
          onShare={() => undefined}
          onViewPublic={() => undefined}
          onDismiss={() => undefined}
        />,
      );
      const everything = `${textOf(tree)} ${alertLabel(tree)} ${labels(tree).join(" ")}`;
      expect(everything).not.toMatch(/stripe|paystack|connect|scheduled|undefined|null|\[object/i);
    }
  });
});

describe("#3237 tester — paid or free, decided by the tickets on the event", () => {
  test("a zero-price ticket not flagged free still counts as selling; mixed and empty lists resolve honestly", () => {
    expect(publishedEventBannerKind([])).toBe("free_event");
    expect(publishedEventBannerKind([{ isFree: true }, { isFree: true }])).toBe("free_event");
    expect(publishedEventBannerKind([{ isFree: true }, { isFree: false }])).toBe("paid_event");
    expect(publishedEventBannerKind([{ isFree: false }])).toBe("paid_event");
    // The two event lines are different sentences.
    expect(publishedBannerSupportingLine("paid_event")).not.toBe(
      publishedBannerSupportingLine("free_event"),
    );
    expect(publishedBannerSupportingLine("paid_event")).toMatch(/tickets/);
    expect(publishedBannerSupportingLine("free_event")).not.toMatch(/sell|ticket/);
  });
});

describe("#3237 tester — hiding the public rows hides nothing else", () => {
  const menuHandlers = () => ({
    onClose: jest.fn(),
    onShare: jest.fn(),
    onEdit: jest.fn(),
    onViewPublic: jest.fn(),
    onCancelTrip: jest.fn(),
  });
  const rowIds = (tree: Tree): string[] => {
    const seen: string[] = [];
    for (const node of tree.root.findAll(
      (n) =>
        typeof n.props.testID === "string" &&
        (n.props.testID as string).startsWith("trip-manage-") &&
        typeof n.props.onPress === "function",
    )) {
      const id = node.props.testID as string;
      if (!seen.includes(id)) seen.push(id);
    }
    return seen;
  };
  const pressRow = async (tree: Tree, testID: string): Promise<void> => {
    const row = tree.root.findAll(
      (n) => n.props.testID === testID && typeof n.props.onPress === "function",
    )[0];
    expect(row).toBeDefined();
    await pressNode(row);
  };

  test("no public page but still cancellable: Edit and Cancel remain and fire; the hidden handlers cannot be reached", async () => {
    const h = menuHandlers();
    const tree = await mount(
      <TripManageMenu visible {...h} canOpenPublicPage={false} canCancelTrip />,
    );
    expect(rowIds(tree)).toEqual(["trip-manage-edit", "trip-manage-cancel"]);
    await pressRow(tree, "trip-manage-edit");
    await pressRow(tree, "trip-manage-cancel");
    expect(h.onEdit).toHaveBeenCalledTimes(1);
    expect(h.onCancelTrip).toHaveBeenCalledTimes(1);
    expect(h.onShare).not.toHaveBeenCalled();
    expect(h.onViewPublic).not.toHaveBeenCalled();
    // Each row closes the sheet first, as before.
    expect(h.onClose).toHaveBeenCalledTimes(2);
  });

  test("a published trip keeps all four rows in the original order", async () => {
    const tree = await mount(
      <TripManageMenu visible {...menuHandlers()} canOpenPublicPage canCancelTrip />,
    );
    expect(rowIds(tree)).toEqual([
      "trip-manage-view-public",
      "trip-manage-share",
      "trip-manage-edit",
      "trip-manage-cancel",
    ]);
  });

  test("a closed menu renders no rows at all, whatever the flags", async () => {
    const tree = await mount(
      <TripManageMenu visible={false} {...menuHandlers()} canOpenPublicPage={false} />,
    );
    expect(rowIds(tree)).toEqual([]);
  });

  test("only a draft loses its public links: scheduled, live, ended and cancelled keep them", () => {
    for (const status of ["scheduled", "live", "ended", "cancelled"]) {
      expect(canOfferPublicLinks({ status, brandSlug: "lantern" })).toBe(true);
    }
    expect(canOfferPublicLinks({ status: "draft", brandSlug: "lantern" })).toBe(false);
    // Missing data never opens a link.
    for (const status of ["scheduled", "live", "ended", "cancelled", "draft"]) {
      expect(canOfferPublicLinks({ status, brandSlug: "" })).toBe(false);
      expect(canOfferPublicLinks({ status, brandSlug: null })).toBe(false);
      expect(canOfferPublicLinks({ status, brandSlug: undefined })).toBe(false);
    }
  });
});
