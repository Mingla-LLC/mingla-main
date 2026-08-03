/**
 * Issue #1484 [stay-desktop-shell] — implementor-owned happy-path RENDER
 * regression proof.
 *
 * WHAT IT PROVES (by MOUNTING the real shells and reading the REAL rendered
 * tree + the REAL flattened styles — not source text):
 *
 *  T-1  DESKTOP (>=1024px web): `StaySuiteShell` renders the shared
 *       `SuiteDesktopShell` — host `stay-suite-shell-desktop`, a `tablist` rail
 *       with all six `stay-rail-<module>` rows — and the horizontal
 *       `stay-module-<module>` pill row does NOT render.
 *  T-2  The resolved `desktopCentered` style has NO `maxWidth` (the ORCH-1184
 *       full-width decision), KEEPS `alignSelf: "flex-start"` + numeric
 *       `paddingHorizontal`, and is the two-column `row` at `width: "100%"`
 *       with the 220px rail.
 *  T-3  PER-MODULE DESKTOP WIDTHS: Overview runs uncapped + left-anchored;
 *       Settings (an editable form) keeps the `suiteFormMaxWidth` readable
 *       measure, also left-anchored.
 *  T-4  NATIVE / PHONE PARITY (<1024px): the pill row still renders, the rail
 *       and the desktop host do NOT, and the Overview page keeps today's exact
 *       centred `stayPageMaxWidth` measure.
 *  T-5  VENUE NON-REGRESSION: `VenueSuiteShell` still renders
 *       `venue-suite-shell-desktop` with its `venue-rail-<module>` rows in the
 *       existing order and the identical uncapped `desktopCentered` style,
 *       after the layout was extracted into the shared shell.
 *
 * FAILS-ON-REVERT: deleting the `if (isWideDesktop) { return <SuiteDesktopShell
 * …> }` branch from `StaySuiteShell.tsx` makes the desktop render fall back to
 * the pill row → T-1 fails on BOTH the missing `stay-suite-shell-desktop` host
 * and the pill row that should not exist. Verified by TRUE LINE DELETION of the
 * fix (not a comment-out).
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run: cd mingla-business &&
 *   npx jest --config jest.issue1484.render.cjs --runInBand
 */

import React from "react";
import { StyleSheet, Text } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";

// ---------------------------------------------------------------------------
// Desktop gate — flipped per test. Read at RENDER time, so the `let` is already
// initialised by the time any mocked hook call actually reads it.
// ---------------------------------------------------------------------------
let mockIsWideDesktop = true;
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  WIDE_DESKTOP_MIN_WIDTH: 1024,
  useResponsiveLayout: () => ({
    isWideDesktop: mockIsWideDesktop,
    isWeb: true,
    width: mockIsWideDesktop ? 1440 : 390,
  }),
}));

// ---- Boundary stubs (native-only deps that have no jest side). -------------
jest.mock("react-native-reanimated", () => {
  const RN = jest.requireActual("react-native");
  const ReactLocal = jest.requireActual("react");
  const passthrough =
    (Component: unknown) =>
    (props: Record<string, unknown>): unknown =>
      ReactLocal.createElement(Component, props);
  return {
    __esModule: true,
    default: {
      View: passthrough(RN.View),
      Text: passthrough(RN.Text),
      ScrollView: passthrough(RN.ScrollView),
      createAnimatedComponent: (Component: unknown) => Component,
    },
    Easing: {
      bezier: () => () => 0,
      linear: () => 0,
      out: (fn: unknown) => fn,
      inOut: (fn: unknown) => fn,
      ease: () => 0,
    },
    runOnJS: (fn: unknown) => fn,
    useAnimatedStyle: (fn: () => unknown) => {
      try {
        return typeof fn === "function" ? fn() : {};
      } catch {
        return {};
      }
    },
    useReducedMotion: () => false,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value,
  };
});
jest.mock("../../../wrappers/SmartScrollView", () => {
  const RN = jest.requireActual("react-native");
  return { __esModule: true, ScrollView: RN.ScrollView, default: RN.ScrollView };
});
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// ---- Stay data hooks — a READY snapshot so Overview renders its full body. --
const STAY_SNAPSHOT = {
  settings: {
    property_kind: "hotel",
    summary: "A characterful city hotel with a rooftop bar and garden rooms.",
    timezone: "Africa/Lagos",
    check_in_time: "15:00:00",
    check_out_time: "11:00:00",
    default_booking_mode: "request",
    amenities: ["Pool"],
    accessibility_features: ["Lift"],
    arrival_instructions: "Front desk",
    house_rules: "No smoking",
    booking_state: "review",
    version: 3,
  },
  offerings: [],
};
jest.mock("../../../hooks/useStayInventory", () => ({
  stayInventoryKeys: { all: ["stay-inventory"] },
  useStayInventory: () => ({
    data: STAY_SNAPSHOT,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  usePublishStay: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useSaveStaySettings: () => ({
    mutate: jest.fn(),
    isPending: false,
    isError: false,
  }),
}));
jest.mock("../../../hooks/useBrandDiscoveryCurrency", () => ({
  useBrandDiscoveryCurrency: () => ({
    data: {
      authority: "settlement",
      canAcceptPaidReservations: true,
      currencyCode: "NGN",
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
}));

// ---- Venue data hooks + store (T-5). ---------------------------------------
jest.mock("../../../hooks/useVenueReservationSettings", () => ({
  useVenueReservationSettings: () => ({
    data: { reservationsEnabled: true },
    isLoading: false,
  }),
  useSetReservationsEnabled: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("../../../store/venueSuiteStore", () => ({
  useVenueSuiteStore: (selector: (s: { sync: () => void }) => unknown) =>
    selector({ sync: () => undefined }),
}));

// ---- Workspace module bodies — stubbed; this suite asserts on the SHELL. ----
const stub = (id: string): (() => React.ReactElement) => {
  const Stub = (): React.ReactElement => (
    <Text testID={`stub-${id}`}>{id}</Text>
  );
  Stub.displayName = `Stub_${id}`;
  return Stub;
};
jest.mock("../StayInventoryManager", () => ({
  StayInventoryManager: stub("inventory"),
}));
jest.mock("../StayReservationsModule", () => ({
  StayReservationsModule: stub("reservations"),
}));
jest.mock("../../venue/VenueMenuModule", () => ({
  VenueMenuModule: stub("menu"),
}));
jest.mock("../../venue/VenueIntelligenceModule", () => ({
  VenueIntelligenceModule: stub("intelligence"),
}));
jest.mock("../../venue/VenueSettingsModule", () => ({
  VenueSettingsModule: stub("venue-settings"),
}));
jest.mock("../../venue/VenueTablesModule", () => ({
  VenueTablesModule: stub("tables"),
}));
jest.mock("../../venue/VenueAvailabilityModule", () => ({
  VenueAvailabilityModule: stub("availability"),
}));
jest.mock("../../venue/VenueReservationsModule", () => ({
  VenueReservationsModule: stub("venue-reservations"),
}));
jest.mock("../../venue/VenueWaitlistModule", () => ({
  VenueWaitlistModule: stub("waitlist"),
}));

import {
  spacing,
  stayPageMaxWidth,
  suiteFormMaxWidth,
  venueRailWidth,
} from "../../../constants/designSystem";
import { StaySuiteShell } from "../StaySuiteShell";
import { VenueSuiteShell } from "../../venue/VenueSuiteShell";

type Flat = Record<string, unknown>;

const STAY_PROPS = {
  brandId: "brand-1484",
  venueId: "venue-1484",
  venueName: "Test Hotel",
  venueApproved: true,
};

const STAY_MODULE_IDS = [
  "overview",
  "rooms_places",
  "availability_pricing",
  "reservations",
  "menu",
  "settings",
] as const;

/** Resolve the two-column block's REAL flattened style from a desktop host. */
function centeredStyle(
  tree: ReturnType<typeof render>,
  hostTestId: string,
): Flat {
  const host = tree.getByTestId(hostTestId);
  const centered = host.props.children as React.ReactElement<{
    style?: unknown;
  }>;
  return (StyleSheet.flatten(centered.props.style) ?? {}) as Flat;
}

/** Rail row labels in render order, deduped by testID prefix. */
function railLabels(
  tree: ReturnType<typeof render>,
  prefix: string,
): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  tree.UNSAFE_root
    .findAll(
      (node) =>
        typeof node.props?.testID === "string" &&
        node.props.testID.startsWith(prefix),
    )
    .forEach((node) => {
      const id = node.props.testID as string;
      if (seen.has(id)) return;
      seen.add(id);
      const text = node.findAllByType(Text)[0];
      const kids = text?.props.children;
      labels.push(Array.isArray(kids) ? kids.join("") : String(kids ?? ""));
    });
  return labels;
}

beforeEach(() => {
  mockIsWideDesktop = true;
});

describe("#1484 — Stay suite adopts the shared desktop shell", () => {
  it("T-1 — at >=1024px the rail renders and the pill row does NOT", () => {
    mockIsWideDesktop = true;
    const r = render(<StaySuiteShell {...STAY_PROPS} />);

    // The shared desktop shell is mounted.
    expect(r.getByTestId("stay-suite-shell-desktop")).toBeTruthy();

    // Every module is a rail row, in the declared order.
    expect(railLabels(r, "stay-rail-")).toEqual([
      "Overview",
      "Rooms & Places",
      "Availability & pricing",
      "Reservations",
      "Menus",
      "Settings",
    ]);
    for (const id of STAY_MODULE_IDS) {
      expect(r.getByTestId(`stay-rail-${id}`)).toBeTruthy();
    }

    // The horizontal pill row is GONE at this width — the rail replaces it.
    for (const id of STAY_MODULE_IDS) {
      expect(r.queryByTestId(`stay-module-${id}`)).toBeNull();
    }
    expect(r.queryAllByTestId(/^stay-module-/)).toHaveLength(0);
  });

  it("T-2 — desktopCentered has NO maxWidth, keeps the anchor + gutters", () => {
    mockIsWideDesktop = true;
    const r = render(<StaySuiteShell {...STAY_PROPS} />);
    const flat = centeredStyle(r, "stay-suite-shell-desktop");

    // ORCH-1184's decision, inherited: the workspace FILLS the page width.
    expect(typeof flat.maxWidth).not.toBe("number");
    expect(flat.maxWidth).toBeUndefined();

    // ...while keeping the left anchor + the edge gutters.
    expect(flat.alignSelf).toBe("flex-start");
    expect(typeof flat.paddingHorizontal).toBe("number");
    expect(flat.paddingHorizontal as number).toBeGreaterThan(0);
    expect(flat.paddingHorizontal).toBe(spacing.md);

    // Two-column row at full width, with the fixed-width rail.
    expect(flat.flexDirection).toBe("row");
    expect(flat.width).toBe("100%");

    const rail = r.getByTestId("stay-rail-overview");
    expect(rail.props.accessibilityRole).toBe("tab");
  });

  it("T-2b — the rail is a tablist of the canonical width", () => {
    mockIsWideDesktop = true;
    const r = render(<StaySuiteShell {...STAY_PROPS} />);
    const host = r.getByTestId("stay-suite-shell-desktop");
    const centered = host.props.children as React.ReactElement<{
      children: React.ReactElement[];
    }>;
    const railHost = centered.props.children[0];
    const railFlat = (StyleSheet.flatten(
      (railHost.props as { style?: unknown }).style,
    ) ?? {}) as Flat;
    expect(railFlat.width).toBe(venueRailWidth);
    expect(
      (railHost.props as { accessibilityRole?: string }).accessibilityRole,
    ).toBe("tablist");
  });

  it("T-3 — per-module desktop widths: Overview uncapped, Settings capped", () => {
    mockIsWideDesktop = true;

    // Overview (default module) — uncapped + left-anchored.
    const overview = render(<StaySuiteShell {...STAY_PROPS} />);
    // Sanity: the Overview body actually rendered before we read its measure.
    expect(overview.getByText("Stay overview")).toBeTruthy();
    const overviewScroll = overview.UNSAFE_root
      .findAll(
        (node) =>
          node.props?.contentContainerStyle !== undefined &&
          typeof node.type !== "string",
      )
      .map(
        (node) =>
          (StyleSheet.flatten(node.props.contentContainerStyle) ?? {}) as Flat,
      )
      .find((flat) => flat.paddingBottom !== undefined);
    expect(overviewScroll).toBeDefined();
    expect(overviewScroll?.maxWidth).toBeUndefined();
    expect(overviewScroll?.alignSelf).toBe("flex-start");

    // Settings — an editable form keeps the readable measure, left-anchored.
    overview.unmount();
    const settings = render(<StaySuiteShell {...STAY_PROPS} />);
    fireEvent.press(settings.getByTestId("stay-rail-settings"));
    const settingsScroll = settings.UNSAFE_root
      .findAll(
        (node) =>
          node.props?.contentContainerStyle !== undefined &&
          typeof node.type !== "string",
      )
      .map(
        (node) =>
          (StyleSheet.flatten(node.props.contentContainerStyle) ?? {}) as Flat,
      )
      .find((flat) => flat.paddingBottom !== undefined);
    expect(settingsScroll?.maxWidth).toBe(suiteFormMaxWidth);
    expect(settingsScroll?.alignSelf).toBe("flex-start");
  });

  it("T-4 — below 1024px the pill row renders and the rail does NOT", () => {
    mockIsWideDesktop = false;
    const r = render(<StaySuiteShell {...STAY_PROPS} />);

    // The phone/native layout is untouched: pills on top of the workspace.
    for (const id of STAY_MODULE_IDS) {
      expect(r.getByTestId(`stay-module-${id}`)).toBeTruthy();
    }
    expect(r.getByTestId("stay-suite-shell")).toBeTruthy();

    // No desktop shell, no rail.
    expect(r.queryByTestId("stay-suite-shell-desktop")).toBeNull();
    expect(r.queryAllByTestId(/^stay-rail-/)).toHaveLength(0);

    // ...and the Overview page keeps today's exact centred readable measure.
    const page = r.UNSAFE_root
      .findAll(
        (node) =>
          node.props?.contentContainerStyle !== undefined &&
          typeof node.type !== "string",
      )
      .map(
        (node) =>
          (StyleSheet.flatten(node.props.contentContainerStyle) ?? {}) as Flat,
      )
      .find((flat) => flat.paddingBottom !== undefined);
    expect(page?.maxWidth).toBe(stayPageMaxWidth);
    expect(page?.alignSelf).toBe("center");
  });
});

describe("#1484 — Venue suite is NOT regressed by the extraction", () => {
  it("T-5 — venue desktop rail + full-width workspace are unchanged", () => {
    mockIsWideDesktop = true;
    const r = render(
      <VenueSuiteShell brandId="brand-test" initialModule="settings" />,
    );

    expect(r.getByTestId("venue-suite-shell-desktop")).toBeTruthy();
    expect(railLabels(r, "venue-rail-")).toEqual([
      "Overview",
      "Tables",
      "Availability",
      "Reservations",
      "Waitlist",
      "Menu",
      "Settings",
    ]);

    const flat = centeredStyle(r, "venue-suite-shell-desktop");
    expect(typeof flat.maxWidth).not.toBe("number");
    expect(flat.maxWidth).toBeUndefined();
    expect(flat.alignSelf).toBe("flex-start");
    expect(flat.paddingHorizontal).toBe(spacing.md);
    expect(flat.flexDirection).toBe("row");
    expect(flat.width).toBe("100%");
  });

  it("T-6 — venue phone branch still renders the phone host, not the rail", () => {
    mockIsWideDesktop = false;
    const r = render(
      <VenueSuiteShell brandId="brand-test" initialModule="settings" />,
    );
    expect(r.getByTestId("venue-suite-shell-phone")).toBeTruthy();
    expect(r.queryByTestId("venue-suite-shell-desktop")).toBeNull();
    expect(r.queryAllByTestId(/^venue-rail-/)).toHaveLength(0);
  });
});
