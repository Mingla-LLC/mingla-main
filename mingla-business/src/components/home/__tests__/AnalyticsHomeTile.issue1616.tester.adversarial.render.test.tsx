/**
 * #1616 [analytics card collapse] — TESTER-OWNED ADVERSARIAL render proof.
 *
 * The implementor's happy-path suite
 * (`AnalyticsHomeTile.issue874.render.test.tsx`) proves the card EXPANDS and
 * COLLAPSES. It never once proves what must NOT happen. That is the entire
 * failure mode intake amendment 1 was written to prevent:
 *
 *   > "a naive implementation that leaves the card-level `onPress`
 *   >  unconditional passes every 'does it expand?' test while silently
 *   >  jumping to Analytics on the first tap."
 *
 * Every assertion below is a NEGATIVE or a STRUCTURAL invariant, deliberately
 * attacking the angles the happy-path suite leaves open:
 *
 *   A. navigation is never reachable from the collapsed row (spec §I-3)
 *   B. navigation IS reachable from the expanded card body (§I-3)
 *   C. navigation is never reachable from the expanded chevron (§D-5 R-4)
 *   D. `accessibilityState.expanded` is absent on the navigating node (§F-2/§F-4)
 *   E. the chevron is a SIBLING, not a descendant, of the card `Pressable`
 *      (§D-1/§D-2) — the invariant iOS VoiceOver reachability rests on, and
 *      the one a future "simplifying" refactor would silently destroy
 *   F. the collapsed label is INVARIANT across loading / error / unauthorized
 *      (§C-1.3) — the implementor only ever asserts the loaded case
 *   G. the collapsed chevron is inert (§D-4)
 *   H. the chevron's effective target clears WCAG AA (§D-3)
 *   I. `minHeight: 188` is expanded-only (§B-3)
 *
 * All of A–I fail on a true revert of `AnalyticsHomeTile.tsx`.
 *
 * HARNESS: `react-test-renderer`, NOT `@testing-library/react-native`.
 * `@testing-library/react-native` is NOT declared in `mingla-business/
 * package.json` — it resolves locally only as a hoisted transitive install, so
 * every import of it is a `TS2307` in CI. 59 existing test files already carry
 * that diagnostic in the ratcheted baseline, and the typecheck-delta gates fail
 * on any ADDED instance, so a 60th trips them. `react-test-renderer` is a real
 * declared devDependency (19.1.0) and produces no diagnostic. The tree/node
 * interfaces and the `require(...) as {...}` handle mirror the precedent in
 * `src/components/stay/__tests__/stayGuardReachability.issue1532.tester.render.test.tsx`.
 */
import React from "react";
import { AnalyticsHomeTile } from "../AnalyticsHomeTile";

jest.mock("../../ui/Skeleton", () => {
  const ReactModule = require("react") as typeof React;
  const { View } = require("react-native") as typeof import("react-native");
  return { Skeleton: (props: object) => ReactModule.createElement(View, props) };
});

/**
 * Minimal shape of a rendered node. Mirrors the local `RenderTreeNode`
 * precedent rather than inventing a type, and deliberately avoids `any`, which
 * would leave every tree walk below unsound while silencing the typecheck gate.
 */
interface RenderTreeNode {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: RenderTreeNode) => boolean) => RenderTreeNode[];
}
interface RenderTree {
  root: RenderTreeNode;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => RenderTree;
  act: (callback: () => Promise<void> | void) => Promise<void>;
};

const CARD_TESTID = "analytics-home-tile";
const CHEVRON_TESTID = "analytics-home-tile-chevron";
const ROOT_TESTID = "analytics-home-tile-root";
const LOADING_TESTID = "analytics-home-loading";
const COLLAPSED_LABEL = "Expand analytics, Customers Mingla drove you";

const data = {
  brandId: "brand-1616",
  authorized: true,
  minglaDrove30d: 2,
  minglaDroveLifetime: 8,
  valueCents30d: { GBP: 1200 },
  valueCentsLifetime: {},
  bySource: [],
};

type TileProps = React.ComponentProps<typeof AnalyticsHomeTile>;

const renderTile = async (
  overrides: Partial<TileProps> = {},
): Promise<RenderTree> => {
  let tree: RenderTree | null = null;
  await TestRenderer.act(async () => {
    tree = TestRenderer.create(
      <AnalyticsHomeTile
        data={data}
        isLoading={false}
        isError={false}
        onPress={jest.fn()}
        {...overrides}
      />,
    );
  });
  expect(tree).not.toBeNull();
  return tree as unknown as RenderTree;
};

const allNodes = (scope: RenderTreeNode): RenderTreeNode[] =>
  scope.findAll(() => true);

/** Every node carrying `testID` — composite AND host instance. */
const nodesWithTestId = (
  scope: RenderTreeNode,
  testID: string,
): RenderTreeNode[] =>
  allNodes(scope).filter((node) => node.props.testID === testID);

const queryPressable = (
  tree: RenderTree,
  testID: string,
): RenderTreeNode | undefined =>
  allNodes(tree.root).find(
    (node) =>
      node.props.testID === testID && typeof node.props.onPress === "function",
  );

/**
 * The single node that both carries `testID` and owns the press handler — i.e.
 * the `Pressable` itself. Absence is a FAILURE, never a silent skip: a missing
 * control would make every later assertion vacuous.
 */
const pressable = (tree: RenderTree, testID: string): RenderTreeNode => {
  const found = allNodes(tree.root).filter(
    (node) =>
      node.props.testID === testID && typeof node.props.onPress === "function",
  );
  expect({ testID, pressables: found.length }).toEqual({
    testID,
    pressables: 1,
  });
  return found[0];
};

const press = async (tree: RenderTree, testID: string): Promise<void> => {
  const node = pressable(tree, testID);
  await TestRenderer.act(() => {
    (node.props.onPress as () => void)();
  });
};

const collectStrings = (value: unknown, out: string[]): void => {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) value.forEach((entry) => collectStrings(entry, out));
};

/** Every rendered string in the tree — the `getByText` equivalent. */
const hasText = (tree: RenderTree, needle: string): boolean => {
  const out: string[] = [];
  allNodes(tree.root).forEach((node) =>
    collectStrings(node.props.children, out),
  );
  return out.includes(needle);
};

const flatten = (style: unknown): Record<string, unknown> => {
  const acc: Record<string, unknown> = {};
  const visit = (s: unknown): void => {
    if (!s) return;
    if (Array.isArray(s)) {
      s.forEach(visit);
      return;
    }
    if (typeof s === "object") Object.assign(acc, s as Record<string, unknown>);
  };
  visit(style);
  return acc;
};

/**
 * The card's glass stack (`GlassChrome`) also renders `pointerEvents="none"`
 * `absoluteFill` layers, so "the first pointerEvents:none node" is NOT the
 * chevron. Select the decorative chevron by its 24 x 24 absolute slot.
 */
const decorativeChevronNodes = (scope: RenderTreeNode): RenderTreeNode[] =>
  allNodes(scope).filter((node) => {
    if (node.props.pointerEvents !== "none") return false;
    const s = flatten(node.props.style);
    return s.position === "absolute" && s.width === 24 && s.height === 24;
  });

const collapsedChevronSlot = (card: RenderTreeNode): Record<string, unknown> => {
  const matches: Record<string, unknown>[] = decorativeChevronNodes(card).map(
    (node) => flatten(node.props.style),
  );
  // `findAll` reports the composite element AND its host instance, so dedupe by
  // value: there must be exactly ONE distinct decorative slot.
  const distinct = new Set(matches.map((s) => JSON.stringify(s)));
  expect(distinct.size).toBe(1);
  return matches[0];
};

describe("#1616 adversarial — the collapsed row must never navigate", () => {
  // A. THE assertion this entire issue exists to protect.
  it("does NOT call onPress when the collapsed row is pressed", async () => {
    const onPress = jest.fn();
    const tree = await renderTile({ onPress });

    expect(pressable(tree, CARD_TESTID).props.accessibilityLabel).toBe(
      COLLAPSED_LABEL,
    );

    await press(tree, CARD_TESTID);

    // It must have EXPANDED (proving the press was actually delivered) …
    expect(hasText(tree, "Last 30 days")).toBe(true);
    // … and it must NOT have navigated.
    expect(onPress).not.toHaveBeenCalled();
  });

  it("does NOT navigate on repeated collapse/expand cycles", async () => {
    const onPress = jest.fn();
    const tree = await renderTile({ onPress });

    for (let i = 0; i < 3; i += 1) {
      await press(tree, CARD_TESTID);
      expect(hasText(tree, "Last 30 days")).toBe(true);
      await press(tree, CHEVRON_TESTID);
      expect(hasText(tree, "Last 30 days")).toBe(false);
    }
    // Six presses, three full open/close cycles, zero navigations.
    expect(onPress).not.toHaveBeenCalled();
  });

  // B. The whole-card shortcut survives once open (amendment 1).
  it("DOES call onPress exactly once when the expanded card is pressed", async () => {
    const onPress = jest.fn();
    const tree = await renderTile({ onPress });

    await press(tree, CARD_TESTID);
    expect(onPress).not.toHaveBeenCalled();

    await press(tree, CARD_TESTID);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // C. §D-5 R-4 — the chevron collapses and must never navigate.
  it("does NOT call onPress when the expanded chevron is pressed", async () => {
    const onPress = jest.fn();
    const tree = await renderTile({ onPress });

    await press(tree, CARD_TESTID);
    await press(tree, CHEVRON_TESTID);

    expect(hasText(tree, "Last 30 days")).toBe(false);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("#1616 adversarial — accessibility contract", () => {
  /**
   * D. §F-2 / amendment 1 §4. Asserted across EVERY node carrying the card's
   * testID — composite and host alike — because RN 0.81's `Pressable`
   * materialises its own `accessibilityState` object on the host with all five
   * keys. "Absent" therefore means `accessibilityState?.expanded === undefined`,
   * NOT a missing object; `expect(accessibilityState).toBeUndefined()` would
   * fail a CORRECT build and is deliberately not written that way.
   */
  it("never reports an expanded/collapsed state on the node that NAVIGATES", async () => {
    const tree = await renderTile();
    await press(tree, CARD_TESTID);

    const cardNodes = nodesWithTestId(tree.root, CARD_TESTID);
    expect(cardNodes.length).toBeGreaterThan(0);
    cardNodes.forEach((node) => {
      const state = node.props.accessibilityState as
        | Record<string, unknown>
        | undefined;
      expect(String(node.props.accessibilityLabel)).toContain("Open Analytics");
      expect(state?.expanded).toBeUndefined();
      // Guard both directions: a "harmless" `{ expanded: true }` here is a real
      // screen-reader lie, because this node does not toggle.
      expect(state?.expanded).not.toBe(true);
      expect(state?.expanded).not.toBe(false);
    });

    // …while the node that DOES own the toggle carries it.
    const chevron = pressable(tree, CHEVRON_TESTID);
    const chevronState = chevron.props.accessibilityState as Record<
      string,
      unknown
    >;
    expect(chevronState.expanded).toBe(true);
    expect(chevron.props.accessibilityLabel).toBe("Collapse analytics");
  });

  /**
   * E. The structural invariant the iOS VoiceOver contract rests on (§D-2).
   * RN `Pressable` defaults `accessible={true}`; on iOS an accessible parent
   * collapses its whole subtree into ONE element. If a future refactor nests
   * the chevron back inside the card `Pressable`, VoiceOver silently loses it
   * and the card becomes a one-way door for screen-reader users — expandable,
   * never collapsible. No other test in the repo catches that.
   */
  it("keeps the chevron a SIBLING of the card Pressable, never a descendant", async () => {
    const tree = await renderTile();
    await press(tree, CARD_TESTID);

    const card = pressable(tree, CARD_TESTID);
    expect(nodesWithTestId(card, CHEVRON_TESTID)).toHaveLength(0);

    // …but both live under the shared padding-free root.
    const root = allNodes(tree.root).find(
      (node) => node.props.testID === ROOT_TESTID,
    );
    expect(root).toBeDefined();
    expect(
      nodesWithTestId(root as RenderTreeNode, CHEVRON_TESTID).length,
    ).toBeGreaterThan(0);
    expect(
      nodesWithTestId(root as RenderTreeNode, CARD_TESTID).length,
    ).toBeGreaterThan(0);
  });

  // F. §C-1.3 — the collapsed label must not vary by query state. The
  // implementor only ever asserts the loaded case.
  it.each([
    ["loading", { data: undefined, isLoading: true, isError: false }],
    ["error", { data: undefined, isLoading: false, isError: true }],
    [
      "unauthorized",
      {
        data: { ...data, authorized: false },
        isLoading: false,
        isError: false,
      },
    ],
  ])(
    "announces the collapsed row identically while %s, and never as Open Analytics",
    async (_name, overrides) => {
      const tree = await renderTile(overrides as Partial<TileProps>);
      const card = pressable(tree, CARD_TESTID);

      expect(card.props.accessibilityLabel).toBe(COLLAPSED_LABEL);
      expect(String(card.props.accessibilityLabel)).not.toContain(
        "Open Analytics",
      );
      const state = card.props.accessibilityState as Record<string, unknown>;
      expect(state.expanded).toBe(false);
      // A closed drawer shows no data, so it has nothing to be wrong about.
      expect(hasText(tree, "Couldn't load your 30-day snapshot")).toBe(false);
      expect(nodesWithTestId(tree.root, LOADING_TESTID)).toHaveLength(0);
    },
  );

  // The chevron must work in EVERY state — the card is never a dead tap
  // (Constitution #1). The toggle reads no query state, so prove it.
  it.each([
    ["loading", { data: undefined, isLoading: true, isError: false }],
    ["error", { data: undefined, isLoading: false, isError: true }],
  ])("still toggles while %s", async (_name, overrides) => {
    const onPress = jest.fn();
    const tree = await renderTile({
      ...(overrides as Partial<TileProps>),
      onPress,
    });

    await press(tree, CARD_TESTID);
    expect(hasText(tree, "Last 30 days")).toBe(true);
    await press(tree, CHEVRON_TESTID);
    expect(hasText(tree, "Last 30 days")).toBe(false);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("#1616 adversarial — geometry and target-size contracts", () => {
  // G. §D-4 — the collapsed chevron must never intercept the card's touch and
  // must add no node inside the flattened accessible button.
  it("keeps the collapsed chevron inert and invisible to a screen reader", async () => {
    const tree = await renderTile();

    expect(queryPressable(tree, CHEVRON_TESTID)).toBeUndefined();

    const card = pressable(tree, CARD_TESTID);
    const decorative = decorativeChevronNodes(card);
    expect(decorative.length).toBeGreaterThan(0);
    // EVERY node carrying that slot must be inert to a screen reader.
    decorative.forEach((node) => expect(node.props.accessible).toBe(false));
  });

  // H. §D-3 — 24pt slot + 13pt hitSlop on all four sides = 50 x 50 effective,
  // comfortably over the WCAG AA 44pt floor.
  it("gives the chevron an effective target of at least 44 x 44", async () => {
    const tree = await renderTile();
    await press(tree, CARD_TESTID);

    const chevron = pressable(tree, CHEVRON_TESTID);
    const slot = flatten(chevron.props.style);
    const hitSlop = chevron.props.hitSlop as Record<string, number>;

    const width = Number(slot.width) + hitSlop.left + hitSlop.right;
    const height = Number(slot.height) + hitSlop.top + hitSlop.bottom;

    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
    expect(width).toBe(50);
    expect(height).toBe(50);
  });

  // The chevron must not move a single point when the card toggles — it is
  // absolutely positioned against a padding-free root precisely so that a
  // wrapping headline cannot drift it (§A-4).
  it("pins the chevron to the same offset in both states", async () => {
    const tree = await renderTile();

    const collapsedSlot = collapsedChevronSlot(pressable(tree, CARD_TESTID));

    await press(tree, CARD_TESTID);
    const expandedSlot = flatten(pressable(tree, CHEVRON_TESTID).props.style);

    expect(collapsedSlot.position).toBe("absolute");
    expect(expandedSlot.position).toBe("absolute");
    expect(expandedSlot.top).toBe(collapsedSlot.top);
    expect(expandedSlot.right).toBe(collapsedSlot.right);
    expect(expandedSlot.width).toBe(collapsedSlot.width);
    expect(expandedSlot.height).toBe(collapsedSlot.height);
  });

  // I. §B-3 — the 188pt jitter guard is for the EXPANDED body only. Applying
  // it while collapsed would defeat the entire issue.
  it("applies minHeight 188 only while expanded", async () => {
    const tree = await renderTile();

    const glassCollapsed = allNodes(tree.root).filter(
      (node) => node.props.variant === "base",
    );
    expect(glassCollapsed.length).toBeGreaterThan(0);
    expect(flatten(glassCollapsed[0].props.style).minHeight).toBeUndefined();

    await press(tree, CARD_TESTID);

    const glassExpanded = allNodes(tree.root).filter(
      (node) => node.props.variant === "base",
    );
    expect(glassExpanded.length).toBeGreaterThan(0);
    expect(flatten(glassExpanded[0].props.style).minHeight).toBe(188);
  });
});
