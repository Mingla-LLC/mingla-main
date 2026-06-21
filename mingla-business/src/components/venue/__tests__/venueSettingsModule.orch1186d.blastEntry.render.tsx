/**
 * ORCH-1186-D — venue blasts entry point — IMPLEMENTOR happy-path render-proof.
 *
 * REUSE-ONLY leg: the venue Settings module gets ONE "Message your guests"
 * action row that deep-links into the EXISTING marketing composer with the
 * venue's brand audience pre-selected (`?audience=brand:{brandId}`). Pure
 * navigation + audience pre-selection — no new composer / send path / audience
 * kind.
 *
 * This MOUNTS the real `VenueSettingsModule` (heavy data hooks mocked) and
 * asserts on the REAL rendered tree + the REAL `router.push` call:
 *
 *   T-4 (entry nav): with a brand id, pressing the row calls `router.push` ONCE
 *                    with exactly `/marketing/campaigns/compose?audience=brand:{id}`.
 *   T-5 (disabled):  with `brandId === null`, the row's accessibilityState is
 *                    disabled and `router.push` is NOT called.
 *
 * FAILS-ON-REVERT (verified by true line-deletion of the fix, NOT a comment-out):
 *   - Deleting the `handleBlast` `router.push(buildComposeAudienceHref(...))`
 *     line (or removing the row) → T-4 fails (push not called / wrong arg).
 *   - Wiring the row to the wrong audience (`event:` or a hardcoded id) → T-4's
 *     exact-string assertion fails.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run:
 *   cd mingla-business && npx jest \
 *     --config jest.orch1186d.render.cjs --runInBand
 */

import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

const mockPush = jest.fn();

// expo-router → capture navigation.
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Manager-plus brand role so the action affordance renders (matches the module's
// existing canMutate gate). rank 40 = event_manager == MANAGER_PLUS_RANK.
jest.mock("../../../hooks/useCurrentBrandRole", () => ({
  useCurrentBrandRole: () => ({ rank: 40 }),
}));

// Brand context — a plain venue brand; no place pool (keeps the photos/AI
// section out of the tree so we don't need its authoring hook to resolve).
jest.mock("../../../hooks/useCurrentBrand", () => ({
  useCurrentBrand: () => ({
    displayName: "Test Venue",
    defaultCurrency: "USD",
    placePoolId: null,
    stripeStatus: null,
    paystackSubaccountCode: null,
  }),
}));

jest.mock("../../../hooks/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isWideDesktop: false, isWeb: false, width: 390 }),
}));

// Reservations OFF → the reservation-fee / policy sections stay collapsed; the
// "Reach your guests" action row is OUTSIDE that branch and always renders.
jest.mock("../../../hooks/useVenueReservationSettings", () => ({
  useVenueReservationSettings: () => ({ data: { reservationsEnabled: false } }),
  useSetReservationsEnabled: () => ({ mutate: jest.fn(), isPending: false }),
  useUpdateReservationFee: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock("../../../hooks/useBrandHours", () => ({
  useBrandHours: () => ({ data: [], isError: false }),
  useUpsertBrandHours: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock("../../../hooks/useBrandPlacePipelineState", () => ({
  useBrandPlaceAuthoringContext: () => ({ data: null }),
}));

// `Input` pulls in the Sheet → SheetMobile → keyboard-controller native chain
// (irrelevant to the blast row, which lives outside the reservation-fee branch).
// Stub it to a plain TextInput so the import graph stays light under jest.
jest.mock("../../ui/Input", () => {
  const { TextInput } = require("react-native");
  return { Input: (props: Record<string, unknown>) => <TextInput {...props} /> };
});

// `BrandHoursEditor` is unrelated to this row; stub to avoid its subtree.
jest.mock("../BrandHoursEditor", () => ({ BrandHoursEditor: () => null }));

import { VenueSettingsModule } from "../VenueSettingsModule";

const BRAND_ID = "11111111-2222-3333-4444-555555555555";

describe("ORCH-1186-D — venue blasts entry point", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it("T-4 — pressing 'Message your guests' navigates the composer with the brand audience", () => {
    const r = render(<VenueSettingsModule brandId={BRAND_ID} />);

    const row = r.getByTestId("venue-settings-message-guests");
    fireEvent.press(row);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(
      `/marketing/campaigns/compose?audience=brand:${BRAND_ID}`,
    );
  });

  it("T-5 — with a null brand id the handler does not navigate", () => {
    // brandId === null: the action button is rendered disabled (defensive) and
    // the handler early-returns, so no navigation fires.
    const r = render(<VenueSettingsModule brandId={null} />);

    const row = r.getByTestId("venue-settings-message-guests");
    expect(row.props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(row);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
