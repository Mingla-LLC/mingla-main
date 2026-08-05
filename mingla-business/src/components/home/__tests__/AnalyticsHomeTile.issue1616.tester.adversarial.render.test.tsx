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
 */
import React from "react";
import {
  fireEvent,
  render,
  type RenderResult,
} from "@testing-library/react-native";
import { AnalyticsHomeTile } from "../AnalyticsHomeTile";

jest.mock("../../ui/Skeleton", () => {
  const ReactModule = require("react") as typeof React;
  const { View } = require("react-native") as typeof import("react-native");
  return { Skeleton: (props: object) => ReactModule.createElement(View, props) };
});

const data = {
  brandId: "brand-1616",
  authorized: true,
  minglaDrove30d: 2,
  minglaDroveLifetime: 8,
  valueCents30d: { GBP: 1200 },
  valueCentsLifetime: {},
  bySource: [],
};

const COLLAPSED_LABEL = "Expand analytics, Customers Mingla drove you";

type TileProps = React.ComponentProps<typeof AnalyticsHomeTile>;

const renderTile = async (
  overrides: Partial<TileProps> = {},
): Promise<RenderResult> =>
  render(
    <AnalyticsHomeTile
      data={data}
      isLoading={false}
      isError={false}
      onPress={jest.fn()}
      {...overrides}
    />,
  );

/**
 * The card's glass stack (`GlassChrome`) also renders `pointerEvents="none"`
 * `absoluteFill` layers, so "the first pointerEvents:none node" is NOT the
 * chevron. Select the decorative chevron by its 24 x 24 absolute slot.
 */
const collapsedChevronSlot = (
  card: ReturnType<RenderResult["getByTestId"]>,
): Record<string, unknown> => {
  const matches = card
    .findAllByProps({ pointerEvents: "none" })
    .map((node) => flatten(node.props.style))
    .filter(
      (s) => s.position === "absolute" && s.width === 24 && s.height === 24,
    );
  // `findAllByProps` reports the composite element AND its host instance, so
  // dedupe by value: there must be exactly ONE distinct decorative slot.
  const distinct = new Set(matches.map((s) => JSON.stringify(s)));
  expect(distinct.size).toBe(1);
  return matches[0];
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

describe("#1616 adversarial — the collapsed row must never navigate", () => {
  // A. THE assertion this entire issue exists to protect.
  it("does NOT call onPress when the collapsed row is pressed", async () => {
    const onPress = jest.fn();
    const screen = await renderTile({ onPress });

    const card = screen.getByTestId("analytics-home-tile");
    expect(card.props.accessibilityLabel).toBe(COLLAPSED_LABEL);

    await fireEvent.press(card);

    // It must have EXPANDED (proving the press was actually delivered) …
    expect(screen.getByText("Last 30 days")).toBeTruthy();
    // … and it must NOT have navigated.
    expect(onPress).not.toHaveBeenCalled();
  });

  it("does NOT navigate on repeated collapse/expand cycles", async () => {
    const onPress = jest.fn();
    const screen = await renderTile({ onPress });

    for (let i = 0; i < 3; i += 1) {
      await fireEvent.press(screen.getByTestId("analytics-home-tile"));
      expect(screen.getByText("Last 30 days")).toBeTruthy();
      await fireEvent.press(screen.getByTestId("analytics-home-tile-chevron"));
      expect(screen.queryByText("Last 30 days")).toBeNull();
    }
    // Six presses, three full open/close cycles, zero navigations.
    expect(onPress).not.toHaveBeenCalled();
  });

  // B. The whole-card shortcut survives once open (amendment 1).
  it("DOES call onPress exactly once when the expanded card is pressed", async () => {
    const onPress = jest.fn();
    const screen = await renderTile({ onPress });

    await fireEvent.press(screen.getByTestId("analytics-home-tile"));
    expect(onPress).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("analytics-home-tile"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  // C. §D-5 R-4 — the chevron collapses and must never navigate.
  it("does NOT call onPress when the expanded chevron is pressed", async () => {
    const onPress = jest.fn();
    const screen = await renderTile({ onPress });

    await fireEvent.press(screen.getByTestId("analytics-home-tile"));
    await fireEvent.press(screen.getByTestId("analytics-home-tile-chevron"));

    expect(screen.queryByText("Last 30 days")).toBeNull();
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("#1616 adversarial — accessibility contract", () => {
  /**
   * D. §F-2 / amendment 1 §4. RN 0.81's `Pressable` ALWAYS materialises an
   * `accessibilityState` object with all five keys, so "absent" is
   * `accessibilityState?.expanded === undefined` — NOT a missing object.
   * `expect(card.props.accessibilityState).toBeUndefined()` would fail a
   * CORRECT build, so it is deliberately not written that way.
   */
  it("never reports an expanded/collapsed state on the node that NAVIGATES", async () => {
    const screen = await renderTile();
    await fireEvent.press(screen.getByTestId("analytics-home-tile"));

    const card = screen.getByTestId("analytics-home-tile");
    expect(card.props.accessibilityLabel).toContain("Open Analytics");
    expect(card.props.accessibilityState?.expanded).toBeUndefined();
    // Guard both directions: a "harmless" `{ expanded: true }` here is a real
    // screen-reader lie, because this node does not toggle.
    expect(card.props.accessibilityState?.expanded).not.toBe(true);
    expect(card.props.accessibilityState?.expanded).not.toBe(false);

    // …while the node that DOES own the toggle carries it.
    const chevron = screen.getByTestId("analytics-home-tile-chevron");
    expect(chevron.props.accessibilityState.expanded).toBe(true);
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
    const screen = await renderTile();
    await fireEvent.press(screen.getByTestId("analytics-home-tile"));

    const card = screen.getByTestId("analytics-home-tile");
    const nestedChevron = card.findAllByProps({
      testID: "analytics-home-tile-chevron",
    });
    expect(nestedChevron).toHaveLength(0);

    // …but both live under the shared padding-free root.
    const root = screen.getByTestId("analytics-home-tile-root");
    expect(
      root.findAllByProps({ testID: "analytics-home-tile-chevron" }).length,
    ).toBeGreaterThan(0);
    expect(
      root.findAllByProps({ testID: "analytics-home-tile" }).length,
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
      const screen = await renderTile(overrides as Partial<TileProps>);
      const card = screen.getByTestId("analytics-home-tile");

      expect(card.props.accessibilityLabel).toBe(COLLAPSED_LABEL);
      expect(card.props.accessibilityLabel).not.toContain("Open Analytics");
      expect(card.props.accessibilityState.expanded).toBe(false);
      // A closed drawer shows no data, so it has nothing to be wrong about.
      expect(screen.queryByText("Couldn't load your 30-day snapshot")).toBeNull();
      expect(screen.queryByTestId("analytics-home-loading")).toBeNull();
    },
  );

  // The chevron must work in EVERY state — the card is never a dead tap
  // (Constitution #1). The toggle reads no query state, so prove it.
  it.each([
    ["loading", { data: undefined, isLoading: true, isError: false }],
    ["error", { data: undefined, isLoading: false, isError: true }],
  ])("still toggles while %s", async (_name, overrides) => {
    const onPress = jest.fn();
    const screen = await renderTile({
      ...(overrides as Partial<TileProps>),
      onPress,
    });

    await fireEvent.press(screen.getByTestId("analytics-home-tile"));
    expect(screen.getByText("Last 30 days")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("analytics-home-tile-chevron"));
    expect(screen.queryByText("Last 30 days")).toBeNull();
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("#1616 adversarial — geometry and target-size contracts", () => {
  // G. §D-4 — the collapsed chevron must never intercept the card's touch and
  // must add no node inside the flattened accessible button.
  it("keeps the collapsed chevron inert and invisible to a screen reader", async () => {
    const screen = await renderTile();

    expect(screen.queryByTestId("analytics-home-tile-chevron")).toBeNull();

    const card = screen.getByTestId("analytics-home-tile");
    // The 24 x 24 absolute slot specifically — not a GlassChrome absoluteFill.
    const decorative = card
      .findAllByProps({ pointerEvents: "none" })
      .filter((node) => {
        const s = flatten(node.props.style);
        return s.position === "absolute" && s.width === 24 && s.height === 24;
      });
    expect(decorative.length).toBeGreaterThan(0);
    // EVERY node carrying that slot must be inert to a screen reader.
    decorative.forEach((node) => expect(node.props.accessible).toBe(false));
  });

  // H. §D-3 — 24pt slot + 13pt hitSlop on all four sides = 50 x 50 effective,
  // comfortably over the WCAG AA 44pt floor.
  it("gives the chevron an effective target of at least 44 x 44", async () => {
    const screen = await renderTile();
    await fireEvent.press(screen.getByTestId("analytics-home-tile"));

    const chevron = screen.getByTestId("analytics-home-tile-chevron");
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
    const screen = await renderTile();

    const card = screen.getByTestId("analytics-home-tile");
    const collapsedSlot = collapsedChevronSlot(card);

    await fireEvent.press(screen.getByTestId("analytics-home-tile"));
    const expandedSlot = flatten(
      screen.getByTestId("analytics-home-tile-chevron").props.style,
    );

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
    const screen = await renderTile();

    const collapsedCard = screen.getByTestId("analytics-home-tile");
    const glassCollapsed = collapsedCard.findAllByProps({ variant: "base" })[0];
    expect(flatten(glassCollapsed.props.style).minHeight).toBeUndefined();

    await fireEvent.press(screen.getByTestId("analytics-home-tile"));

    const expandedCard = screen.getByTestId("analytics-home-tile");
    const glassExpanded = expandedCard.findAllByProps({ variant: "base" })[0];
    expect(flatten(glassExpanded.props.style).minHeight).toBe(188);
  });
});
