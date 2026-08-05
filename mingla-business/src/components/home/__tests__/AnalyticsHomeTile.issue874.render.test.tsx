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
  brandId: "brand-874",
  authorized: true,
  minglaDrove30d: 2,
  minglaDroveLifetime: 8,
  valueCents30d: { GBP: 1200, USD: 2500 },
  valueCentsLifetime: {},
  bySource: [],
};

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
 * #1616 — the tile is COLLAPSED on mount now, so every assertion about the
 * 30-day window, the figures, the error copy or the "Open ›" row needs an
 * expanded precondition. This helper renders and presses the card row once,
 * which (collapsed) expands it without navigating. It is a state precondition
 * only — no assertion below it was relaxed.
 */
const renderExpanded = async (
  overrides: Partial<TileProps> = {},
): Promise<RenderResult> => {
  const screen = await renderTile(overrides);
  await fireEvent.press(screen.getByTestId("analytics-home-tile"));
  return screen;
};

describe("issue #874 Analytics Home tile real render", () => {
  it("renders a single accessible multi-currency button and fires it", async () => {
    const onPress = jest.fn();
    const screen = await renderExpanded({ onPress });
    const button = screen.getByRole("button", { name: /Open Analytics/ });
    expect(button.props.accessibilityLabel).toContain("2 customers");
    expect(button.props.accessibilityLabel).toContain("£12.00 booking value");
    expect(button.props.accessibilityLabel).toContain("$25.00 booking value");
    // #1616 — expanded exposes TWO buttons: the navigating card and the
    // collapse chevron (a sibling Pressable, so VoiceOver can reach it).
    expect(screen.getAllByRole("button")).toHaveLength(2);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("keeps its action and footprint while loading", async () => {
    const loading = await renderExpanded({ data: undefined, isLoading: true });
    expect(loading.getByText("Customers Mingla drove you")).toBeTruthy();
    expect(loading.getByText("Open")).toBeTruthy();
  });

  it("renders an honest zero state", async () => {
    const zero = await renderExpanded({
      data: { ...data, minglaDrove30d: 0, valueCents30d: {} },
    });
    expect(zero.getByText("0 customers")).toBeTruthy();
    expect(zero.getByText("No paid booking value yet")).toBeTruthy();
  });

  it("keeps the button available after a preview error", async () => {
    const error = await renderExpanded({ data: undefined, isError: true });
    expect(error.getByText("Couldn't load your 30-day snapshot")).toBeTruthy();
    expect(error.getByRole("button", { name: /Open Analytics/ })).toBeTruthy();
  });
});

describe("issue #1616 Analytics Home tile collapses by default", () => {
  it("renders collapsed on mount — no window, no figures, no Open row", async () => {
    const screen = await renderTile();
    expect(screen.getByText("Customers Mingla drove you")).toBeTruthy();
    expect(screen.queryByText("Last 30 days")).toBeNull();
    expect(screen.queryByText("2 customers")).toBeNull();
    expect(screen.queryByText("Open")).toBeNull();
  });

  it("labels the collapsed row as an expander, never as Open Analytics", async () => {
    const screen = await renderTile();
    const card = screen.getByTestId("analytics-home-tile");
    expect(card.props.accessibilityLabel).toBe(
      "Expand analytics, Customers Mingla drove you",
    );
    expect(card.props.accessibilityLabel).not.toContain("Open Analytics");
    expect(card.props.accessibilityState.expanded).toBe(false);
  });

  it("reveals the window, the figures and the Open row when pressed", async () => {
    const screen = await renderTile();
    await fireEvent.press(screen.getByTestId("analytics-home-tile"));
    expect(screen.getByText("Last 30 days")).toBeTruthy();
    expect(screen.getByText("2 customers")).toBeTruthy();
    expect(screen.getByText("£12.00 booking value")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
  });

  it("collapses again when the expanded chevron is pressed", async () => {
    const screen = await renderExpanded();
    expect(screen.getByText("Last 30 days")).toBeTruthy();
    const chevron = screen.getByTestId("analytics-home-tile-chevron");
    expect(chevron.props.accessibilityLabel).toBe("Collapse analytics");
    expect(chevron.props.accessibilityState.expanded).toBe(true);
    await fireEvent.press(chevron);
    expect(screen.queryByText("Last 30 days")).toBeNull();
    expect(screen.queryByText("Open")).toBeNull();
    expect(screen.queryByTestId("analytics-home-tile-chevron")).toBeNull();
  });

  it("does not persist the open position across a remount", async () => {
    const first = await renderExpanded();
    expect(first.getByText("Last 30 days")).toBeTruthy();
    await first.unmount();

    const second = await renderTile();
    expect(second.queryByText("Last 30 days")).toBeNull();
    expect(second.getByTestId("analytics-home-tile").props.accessibilityLabel).toBe(
      "Expand analytics, Customers Mingla drove you",
    );
  });

  it("never mounts the loading skeleton while collapsed", async () => {
    const screen = await renderTile({ data: undefined, isLoading: true });
    expect(screen.queryByTestId("analytics-home-loading")).toBeNull();
    await fireEvent.press(screen.getByTestId("analytics-home-tile"));
    expect(screen.getByTestId("analytics-home-loading")).toBeTruthy();
  });
});
