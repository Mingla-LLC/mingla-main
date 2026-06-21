/**
 * ORCH-1184 — bare rail + full-width workspace — TESTER-OWNED ADVERSARIAL
 * RENDER proof.
 *
 * DIFFERENT ANGLE from the implementor's happy-path test
 * (`venueSuiteShell.orch1184.fullwidth.test.ts`), which is entirely SOURCE-TEXT
 * assertion (regex over the .tsx file + a registry derive). The implementor's
 * test never mounts the component, never resolves the StyleSheet, and never
 * inspects a real rendered tree — so it cannot catch a render-tree regression
 * that source-grep would miss (e.g. a caption re-introduced via a variable, a
 * `maxWidth` re-applied through a merged style array, or a label rendered out of
 * order).
 *
 * This test ACTUALLY MOUNTS `VenueSuiteShell` in the `isWideDesktop` branch via
 * react-test-renderer + @testing-library/react-native and asserts on the REAL
 * rendered output and the REAL flattened style:
 *
 *   (a) The rendered rail tree contains NO "Command" / "Booking" text node, yet
 *       all SIX item labels (Overview, Tables, Availability, Reservations,
 *       Waitlist, Settings) are present IN ORDER.
 *   (b) The resolved (flattened) `desktopCentered` View style has NO numeric
 *       `maxWidth` (the workspace fills the page) while KEEPING the left anchor
 *       (`alignSelf: "flex-start"`) and the edge gutters
 *       (`paddingHorizontal` > 0).
 *
 * FAILS-ON-REVERT (verified by true line-deletion of the fix, NOT a comment-out):
 *   - Re-adding the `<Text style={styles.railSection}>Command/Booking</Text>`
 *     captions → assertion (a) "no Command/Booking text node" FAILS.
 *   - Restoring `maxWidth: venueSuiteMaxWidth` in `desktopCentered` → assertion
 *     (b) "no numeric maxWidth" FAILS.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run:
 *   cd mingla-business && npx jest \
 *     --config jest.orch1184.adversarial.render.cjs --runInBand
 */

import React from "react";
import { Text, View } from "react-native";
import { render, within } from "@testing-library/react-native";

// ---- Mock the heavy hooks/store/modules so we reach the desktop rail cleanly.

// Force the wide-desktop branch.
jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: true, isWeb: true, width: 1600 }),
}));

// Reservations ON → deriveVenueModules returns all six modules.
jest.mock("../../../hooks/useVenueReservationSettings", () => ({
  useVenueReservationSettings: () => ({
    data: { reservationsEnabled: true },
    isLoading: false,
  }),
  useSetReservationsEnabled: () => ({ mutate: jest.fn(), isPending: false }),
}));

// Zustand store bridge — no-op sync selector.
jest.mock("../../../store/venueSuiteStore", () => ({
  useVenueSuiteStore: (selector: (s: { sync: () => void }) => unknown) =>
    selector({ sync: () => undefined }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Light stubs for the six workspace module bodies — we only assert on the RAIL
// and the layout style, not the module internals. (`settings` is the active
// module, so only VenueSettingsModule actually renders; the rest are stubbed
// defensively to keep the import graph cheap.)
const stub =
  (id: string) =>
  (): React.ReactElement =>
    <Text testID={`stub-${id}`}>{id}</Text>;
jest.mock("../VenueListingContent", () => ({ VenueListingContent: stub("listing") }));
jest.mock("../VenueSettingsModule", () => ({ VenueSettingsModule: stub("settings") }));
jest.mock("../VenueTablesModule", () => ({ VenueTablesModule: stub("tables") }));
jest.mock("../VenueAvailabilityModule", () => ({ VenueAvailabilityModule: stub("availability") }));
jest.mock("../VenueReservationsModule", () => ({ VenueReservationsModule: stub("reservations") }));
jest.mock("../VenueWaitlistModule", () => ({ VenueWaitlistModule: stub("waitlist") }));

import { StyleSheet } from "react-native";

import { VenueSuiteShell } from "../VenueSuiteShell";

/**
 * Collect every rendered <Text> string in document order. We read the host-tree
 * (`*-scroll` excluded is unnecessary; we just gather all text content).
 */
function allTextStrings(root: ReturnType<typeof render>): string[] {
  // Every `venue-rail-<m>` Pressable holds exactly one label Text; gather them
  // in render order via the testID prefix.
  return root.UNSAFE_root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        node.type === "Text" &&
        node.props?.testID === undefined,
    )
    .map((node) => {
      const kids = node.props.children;
      return Array.isArray(kids) ? kids.join("") : String(kids ?? "");
    });
}

describe("ORCH-1184 ADVERSARIAL render — bare rail + full-width workspace", () => {
  it("(a) rail tree has NO Command/Booking caption yet all six labels in order", () => {
    const r = render(
      <VenueSuiteShell brandId="brand-test" initialModule="settings" />,
    );

    // The six rail rows are tagged `venue-rail-<module>`; read each row's label
    // in DOM order. This is the REAL rendered tree, not the source string.
    // Each rail row carries a unique testID `venue-rail-<module>`. RTR's host
    // tree repeats the same testID across the composite Pressable + its host
    // Views, so we DEDUPE by first-seen testID (preserving render order) to get
    // exactly the six rows. From each first node we read its single label Text.
    const seen = new Set<string>();
    const railLabels: string[] = [];
    r.UNSAFE_root
      .findAll(
        (n) =>
          typeof n.props?.testID === "string" &&
          n.props.testID.startsWith("venue-rail-"),
      )
      .forEach((node) => {
        const id = node.props.testID as string;
        if (seen.has(id)) return;
        seen.add(id);
        const label = within(node).UNSAFE_getAllByType(Text)[0];
        const kids = label.props.children;
        railLabels.push(Array.isArray(kids) ? kids.join("") : String(kids ?? ""));
      });

    expect(railLabels).toEqual([
      "Overview",
      "Tables",
      "Availability",
      "Reservations",
      "Waitlist",
      "Settings",
    ]);

    // NO caption text node anywhere in the rendered tree.
    const texts = allTextStrings(r);
    expect(texts).not.toContain("Command");
    expect(texts).not.toContain("Booking");
  });

  it("(b) resolved desktopCentered style has NO numeric maxWidth, keeps anchor + gutters", () => {
    const r = render(
      <VenueSuiteShell brandId="brand-test" initialModule="settings" />,
    );

    // The desktop two-column block is the View whose testID parent is
    // `venue-suite-shell-desktop`; it is that host's only child View. Resolve
    // its REAL flattened style (not the source text).
    const desktopHost = r.UNSAFE_getByProps({
      testID: "venue-suite-shell-desktop",
    });
    const centered = desktopHost.props.children; // <View style={styles.desktopCentered}>
    const flat = StyleSheet.flatten(centered.props.style) as Record<
      string,
      unknown
    >;

    // The 1200px cap is GONE — no numeric maxWidth survives in the resolved style.
    expect(typeof flat.maxWidth).not.toBe("number");
    expect(flat.maxWidth).toBeUndefined();

    // KEEP the left anchor + the edge gutters.
    expect(flat.alignSelf).toBe("flex-start");
    expect(typeof flat.paddingHorizontal).toBe("number");
    expect(flat.paddingHorizontal as number).toBeGreaterThan(0);
    // Sanity: the row layout is still the two-column flex row at full width.
    expect(flat.flexDirection).toBe("row");
    expect(flat.width).toBe("100%");
  });
});
