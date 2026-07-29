import React, { useMemo, useReducer, useRef } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pressable, Text, View } from "react-native";
import { describe, expect, jest, test } from "@jest/globals";

import type { PublicVenueTab } from "@mingla/brand-rendering/publicVenueTabState";
import {
  createPublicVenueReservationUiState,
  normalizePublicVenueReservationUiState,
  publicVenueReservationUiReducer,
} from "../publicVenueReservationUiState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface TestInstance {
  type: unknown;
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}

interface TestRendererInstance {
  root: TestInstance;
  unmount: () => void;
}

const TestRenderer = require("react-test-renderer") as {
  create: (
    element: React.ReactElement,
    options?: { createNodeMock?: () => object },
  ) => TestRendererInstance;
  act: (callback: () => Promise<void> | void) => Promise<void> | void;
};

const BUSINESS_ROOT = join(__dirname, "..", "..", "..", "..");
const readBusiness = (path: string): string =>
  readFileSync(join(BUSINESS_ROOT, path), "utf8");

const press = (node: TestInstance): void => {
  const onPress = node.props.onPress;
  if (typeof onPress !== "function") {
    throw new Error("Expected an interactive node");
  }
  onPress();
};

const byLabel = (root: TestInstance, label: string): TestInstance[] =>
  root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel === label,
  );

const selectedTab = (root: TestInstance, label: string): boolean => {
  const tab = byLabel(root, label)[0];
  if (tab === undefined) return false;
  const state = tab.props.accessibilityState;
  return (
    typeof state === "object" &&
    state !== null &&
    "selected" in state &&
    state.selected === true
  );
};

interface HarnessProps {
  initialTab?: PublicVenueTab;
  reservable?: boolean;
  onStarted: () => void;
}

function ReservationHarness({
  initialTab = "overview",
  reservable = true,
  onStarted,
}: HarnessProps): React.ReactElement {
  const context = useMemo(
    () => ({ hasMenu: true, canOpenReservationSheet: reservable }),
    [reservable],
  );
  const [state, dispatch] = useReducer(
    publicVenueReservationUiReducer,
    initialTab,
    (tab) => createPublicVenueReservationUiState(tab, context),
  );
  const normalized = normalizePublicVenueReservationUiState(state, context);
  const showCta = reservable && normalized.activeTab !== "reservations";
  const guestFlow = <View accessibilityLabel="Guest reservation flow" />;
  const reservationsTabRef = useRef<React.ElementRef<typeof Pressable> | null>(
    null,
  );

  const close = (): void => {
    dispatch({ type: "RESERVATION_SHEET_CLOSED", context });
    setTimeout(() => reservationsTabRef.current?.focus(), 0);
  };

  return (
    <View>
      {(["overview", "menu", "reservations"] as const).map((tab) => (
        <Pressable
          key={tab}
          ref={tab === "reservations" ? reservationsTabRef : undefined}
          accessibilityRole="tab"
          accessibilityLabel={
            tab === "overview"
              ? "Overview"
              : tab === "menu"
                ? "Menu"
                : "Reservations"
          }
          accessibilityState={{ selected: normalized.activeTab === tab }}
          onPress={() =>
            dispatch({ type: "TAB_SELECTED", tab, context })
          }
        />
      ))}
      {normalized.activeTab === "overview" ? <Text>Overview pane</Text> : null}
      {normalized.activeTab === "menu" ? <Text>Menu pane</Text> : null}
      {normalized.activeTab === "reservations" &&
      !normalized.reservationSheetOpen
        ? guestFlow
        : null}
      {showCta ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reserve a table"
          onPress={() => {
            dispatch({ type: "RESERVE_CTA_PRESSED", context });
            onStarted();
          }}
        />
      ) : null}
      {normalized.reservationSheetOpen ? (
        <View accessibilityLabel="Reservation sheet">
          {guestFlow}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss reservation sheet"
            onPress={close}
          />
        </View>
      ) : null}
    </View>
  );
}

describe("issue #1380 public venue Reserve CTA", () => {
  test("state contract is atomic and closes illegal sheet states", () => {
    const ready = { hasMenu: true, canOpenReservationSheet: true };
    let state = createPublicVenueReservationUiState("overview", ready);

    state = publicVenueReservationUiReducer(state, {
      type: "RESERVE_CTA_PRESSED",
      context: ready,
    });
    expect(state).toEqual({
      activeTab: "reservations",
      reservationSheetOpen: true,
    });

    state = publicVenueReservationUiReducer(state, {
      type: "RESERVATION_SHEET_CLOSED",
      context: ready,
    });
    expect(state).toEqual({
      activeTab: "reservations",
      reservationSheetOpen: false,
    });

    state = publicVenueReservationUiReducer(state, {
      type: "TAB_SELECTED",
      tab: "menu",
      context: ready,
    });
    expect(state).toEqual({
      activeTab: "menu",
      reservationSheetOpen: false,
    });

    state = publicVenueReservationUiReducer(state, {
      type: "RESERVE_CTA_PRESSED",
      context: ready,
    });
    state = publicVenueReservationUiReducer(state, {
      type: "ENVIRONMENT_CHANGED",
      context: { hasMenu: false, canOpenReservationSheet: false },
    });
    expect(state).toEqual({
      activeTab: "reservations",
      reservationSheetOpen: false,
    });

    expect(
      createPublicVenueReservationUiState("menu", {
        hasMenu: false,
        canOpenReservationSheet: true,
      }),
    ).toEqual({
      activeTab: "overview",
      reservationSheetOpen: false,
    });
  });

  test("CTA opens one flow, close leaves Reservations selected, and Overview restores the CTA", async () => {
    const started = jest.fn();
    const focus = jest.fn();
    let tree!: TestRendererInstance;

    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        <ReservationHarness onStarted={started} />,
        { createNodeMock: () => ({ focus }) },
      );
    });
    expect(byLabel(tree.root, "Reserve a table")).toHaveLength(1);
    expect(selectedTab(tree.root, "Overview")).toBe(true);
    expect(byLabel(tree.root, "Guest reservation flow")).toHaveLength(0);

    await TestRenderer.act(async () => {
      press(byLabel(tree.root, "Reserve a table")[0]);
    });

    expect(byLabel(tree.root, "Reserve a table")).toHaveLength(0);
    expect(byLabel(tree.root, "Reservation sheet")).toHaveLength(1);
    expect(byLabel(tree.root, "Guest reservation flow")).toHaveLength(1);
    expect(selectedTab(tree.root, "Reservations")).toBe(true);
    expect(started).toHaveBeenCalledTimes(1);

    await TestRenderer.act(async () => {
      press(byLabel(tree.root, "Dismiss reservation sheet")[0]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(byLabel(tree.root, "Reservation sheet")).toHaveLength(0);
    expect(byLabel(tree.root, "Guest reservation flow")).toHaveLength(1);
    expect(byLabel(tree.root, "Reserve a table")).toHaveLength(0);
    expect(selectedTab(tree.root, "Reservations")).toBe(true);
    expect(focus).toHaveBeenCalled();

    await TestRenderer.act(async () => {
      press(byLabel(tree.root, "Overview")[0]);
    });
    expect(byLabel(tree.root, "Reserve a table")).toHaveLength(1);
    expect(selectedTab(tree.root, "Overview")).toBe(true);

    await TestRenderer.act(async () => {
      tree.unmount();
    });
  });

  test("production page wiring keeps one content instance and one CTA-derived visibility contract", () => {
    const page = readBusiness("src/components/venue/PublicVenuePage.tsx");
    const sheet = readBusiness(
      "src/components/venue/PublicVenueReservationSheet.tsx",
    );
    const tabs = readFileSync(
      join(BUSINESS_ROOT, "..", "packages/brand-rendering/PublicVenueTabs.tsx"),
      "utf8",
    );

    expect(page).toContain(
      'type: "RESERVE_CTA_PRESSED"',
    );
    expect(page).toContain(
      'normalizedReservationUiState.activeTab !== "reservations"',
    );
    expect(page).toContain("showReserveCta && !isDesktop");
    expect(page).toContain("showReserveCta ? reserveCta : null");
    expect(page).toContain(
      "normalizedReservationUiState.reservationSheetOpen\n            ? null\n            : reservationsBlock",
    );
    expect(page).toContain("<PublicVenueReservationSheet");
    expect(page).toContain("{reservationsBlock}");
    expect(page).toContain(
      "activeTab={normalizedReservationUiState.activeTab}",
    );
    expect(sheet).toContain('snapPoint="full"');
    expect(sheet).toContain("{visible ? children : null}");
    expect(sheet).toContain('accessibilityLabel="Reserve a table"');
    expect(tabs).toContain("activeTab?: PublicVenueTab");
    expect(tabs).toContain("onTabChange?: (tab: PublicVenueTab) => void");
    expect(tabs).toContain("focusTab: (tab: PublicVenueTab) => void");
    expect(tabs).toContain("if (!isControlled)");
  });
});
