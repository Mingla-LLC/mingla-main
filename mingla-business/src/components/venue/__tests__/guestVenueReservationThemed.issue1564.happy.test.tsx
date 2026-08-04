/**
 * issue #1564 [venue-colours] — the reservation form wears the venue's colours.
 *
 * `GuestVenueReservation` hardcoded `#eb7825` (three times) and `#0c0e12`
 * while every other pixel of the public venue page was brand-themed, and while
 * the Stay booking body next to it already received the resolved palette. A
 * restaurant under a blue brand opened a form with an orange focus ring.
 *
 * This mounts the REAL component through react-test-renderer under two
 * unmistakably different palettes and reads the rendered style tree — not the
 * source. A source grep would pass on a component that imported the palette
 * and then never applied it.
 */

import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../../analytics/webAnalytics", () => ({
  captureWeb: () => undefined,
  getStoredClickAttribution: () => null,
}));
jest.mock("../../../services/venueOrganicCaptureService", () => ({
  captureVenueOrganicEvent: async () => undefined,
  getVenueOrganicJourneyToken: () => null,
}));
jest.mock("../../../services/venueOrganicCapturePolicy", () => ({
  runBuyerVenueOrganicCapture: () => undefined,
}));
jest.mock("../../../services/venueGuestReservationService", () => ({
  createGuestVenueReservation: async () => ({ ok: true, reservationId: "r1" }),
}));
// PASSTHROUGH, not a stub that swallows props (the issue1380 precedent): the
// element keeps its `theme` prop, so the phone field's resolved colours land in
// the rendered tree and can be read there. A mock that dropped props would make
// the strongest assertion in this file unfalsifiable.
jest.mock("@mingla/phone-input", () => ({
  __esModule: true,
  PhoneInput: (props: Record<string, unknown>) => {
    const ReactActual = require("react") as typeof import("react");
    return ReactActual.createElement("PhoneInput", props);
  },
  getCountryByCode: () => ({ dialCode: "+1" }),
  getDefaultCountryCode: () => "US",
}));
// `Button` and `Input` pull react-native-reanimated, which this node/ts-jest
// project cannot parse. Both are PASSTHROUGHS for the same reason as
// PhoneInput: `Button`'s `accentColor` is one of the values under test.
jest.mock("../../ui/Button", () => ({
  __esModule: true,
  Button: (props: Record<string, unknown>) => {
    const ReactActual = require("react") as typeof import("react");
    return ReactActual.createElement("Button", props);
  },
}));
jest.mock("../../ui/Input", () => ({
  __esModule: true,
  Input: (props: Record<string, unknown>) => {
    const ReactActual = require("react") as typeof import("react");
    return ReactActual.createElement("Input", props);
  },
}));
jest.mock("../../ui/Icon", () => ({
  __esModule: true,
  Icon: (props: Record<string, unknown>) => {
    const ReactActual = require("react") as typeof import("react");
    return ReactActual.createElement("Icon", props);
  },
}));
jest.mock("../../../hooks/usePublicVenueAvailability", () => ({
  usePublicVenueAvailability: () => ({
    data: [
      { slotStartUtc: "2026-08-05T19:00:00Z", slotLocalLabel: "7:00 PM", isFull: false },
      { slotStartUtc: "2026-08-05T20:00:00Z", slotLocalLabel: "8:00 PM", isFull: false },
    ],
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: () => undefined,
  }),
}));

import React from "react";

import {
  createThemePalette,
  resolveTheme,
} from "@mingla/offering-rendering";

import { GuestVenueReservation } from "../GuestVenueReservation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// The house shim (GuestVenueReservationAnalytics.issue1380 precedent):
// react-test-renderer ships no types under this config, so it is required
// through a narrow declared shape rather than imported.
interface TestInstance {
  props: Record<string, unknown>;
  findAll: (predicate: (node: TestInstance) => boolean) => TestInstance[];
}
interface TestRendererInstance {
  toJSON: () => unknown;
  root: TestInstance;
  unmount: () => void;
}
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => TestRendererInstance;
  act: (callback: () => void) => void;
};

/**
 * The two palettes, resolved through the SAME chain the public page uses.
 * BRAND_BLUE is the inherited state (the venue overrides nothing); VENUE_GREEN
 * is the same brand with a venue that has chosen its own colour.
 */
const BRAND_BLUE = createThemePalette(resolveTheme({ color: "#2563eb" }, null));
const VENUE_GREEN = createThemePalette(
  resolveTheme({ color: "#2563eb" }, { color: "#16a34a" }),
);

/** Every colour-ish value anywhere in the rendered style tree. */
const collectColours = (node: unknown, out: string[] = []): string[] => {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    for (const item of node) collectColours(item, out);
    return out;
  }
  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (typeof value === "string" && /^(#|rgba?\()/.test(value)) {
        out.push(value.toLowerCase());
      } else if (typeof value === "object" || Array.isArray(value)) {
        collectColours(value, out);
      }
      void key;
    }
  }
  return out;
};

/**
 * `selectSlot` drives the form open. The name/email/PHONE block only renders
 * once a time is chosen, so without this the phone field — the surface that
 * carried the loudest orange (`borderFocused`, `accent`) — is never mounted
 * and the assertion about it would be silently vacuous.
 */
const renderWith = (
  palette: ReturnType<typeof createThemePalette>,
  selectSlot = false,
): string[] => {
  let tree!: TestRendererInstance;
  TestRenderer.act(() => {
    tree = TestRenderer.create(
      <GuestVenueReservation
        venueId="venue-1564"
        brandId="brand-1564"
        currency="USD"
        analyticsSurface="buyer_web"
        palette={palette}
      />,
    );
  });
  if (selectSlot) {
    const matches = tree.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Select 7:00 PM" &&
        typeof node.props.onPress === "function",
    );
    // Vacuity guard: if the slot chip ever stops carrying that label, the
    // form would silently never open and every colour below would be missing.
    expect(matches.length).toBeGreaterThan(0);
    TestRenderer.act(() => {
      (matches[0].props.onPress as () => void)();
    });
  }
  const json = tree.toJSON();
  const colours = collectColours(json);
  TestRenderer.act(() => {
    tree.unmount();
  });
  return colours;
};

describe("#1564 — the form is painted from the page's palette", () => {
  test("the two palettes are genuinely different (vacuity guard)", () => {
    expect(BRAND_BLUE.accent).not.toBe(VENUE_GREEN.accent);
    expect(BRAND_BLUE.accent).toMatch(/^#[0-9a-f]{6}$/i);
    expect(VENUE_GREEN.accent).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("the render produces a real style tree (vacuity guard)", () => {
    const colours = renderWith(BRAND_BLUE);
    // A component that failed to mount, or a collector that walked nothing,
    // would give an empty list and make every `not.toContain` below trivially
    // true. Anchor on a substantial count first.
    expect(colours.length).toBeGreaterThan(5);
  });

  test("Mingla orange is GONE for a blue brand", () => {
    const colours = renderWith(BRAND_BLUE);
    expect(colours).not.toContain("#eb7825");
    expect(colours.join("|")).not.toContain("235,120,37");
    expect(colours).not.toContain("#0c0e12");
    expect(colours.join("|")).not.toContain("12, 14, 18");
  });

  test("the venue's OWN accent reaches the rendered tree", () => {
    const colours = renderWith(VENUE_GREEN);
    expect(colours).toContain(VENUE_GREEN.accent.toLowerCase());
    // …and the blue brand's accent is nowhere near it, which is the whole
    // point of a venue carrying its own colours.
    expect(colours).not.toContain(BRAND_BLUE.accent.toLowerCase());
  });

  test("changing the venue's palette changes what renders", () => {
    const blue = renderWith(BRAND_BLUE);
    const green = renderWith(VENUE_GREEN);
    expect(blue.join("|")).not.toBe(green.join("|"));
    expect(blue).toContain(BRAND_BLUE.accent.toLowerCase());
    expect(green).toContain(VENUE_GREEN.accent.toLowerCase());
  });

  test("the OPEN form's phone field carries the venue's accent, not orange", () => {
    const colours = renderWith(VENUE_GREEN, true);
    expect(colours.length).toBeGreaterThan(15);
    expect(colours).toContain(VENUE_GREEN.accent.toLowerCase());
    expect(colours).toContain(VENUE_GREEN.page.toLowerCase());
    expect(colours).not.toContain("#eb7825");
    expect(colours).not.toContain("#0c0e12");
    expect(colours.join("|")).not.toContain("rgba(12, 14, 18");
  });

  test("the error colour stays SEMANTIC, not brand-tinted", () => {
    // A red-accented venue must not make its error text look like decoration.
    const RED_VENUE = createThemePalette(
      resolveTheme({ color: "#2563eb" }, { color: "#dc2626" }),
    );
    const colours = renderWith(RED_VENUE, true);
    expect(colours.length).toBeGreaterThan(15);
    // `#ef4444` is passed to the phone field's borderError/errorText on every
    // palette; it is a constant by design.
    expect(colours).toContain("#ef4444");
    // …and the red venue's own accent is a DIFFERENT value, so the two are
    // still distinguishable to a guest.
    expect(RED_VENUE.accent.toLowerCase()).not.toBe("#ef4444");
  });
});
