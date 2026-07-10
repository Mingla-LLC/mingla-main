/**
 * ORCH-1335 — RsvpStep5Setup chip-in bank-banner RENDER proof (§5.b).
 *
 * A REAL @testing-library/react-native mount of the production RsvpStep5Setup.
 * Source-grep tests are capped at "suspected"; this is the runtime evidence that
 * the payout-aware callout actually SWAPS at runtime:
 *   - chipInPayoutReady={true}  → positive "Payouts are on", nudge absent;
 *   - chipInPayoutReady={false} → neutral nudge, positive absent;
 *   - chipInPayoutReady omitted (undefined / loading) → nudge, positive ABSENT
 *     (the anti-false-positive guarantee — no green flash before confirmation).
 *
 * Run: npx jest --config jest.orch1335.render.cjs --runInBand
 */

import React from "react";
import { render } from "@testing-library/react-native";

// Icon is decorative here; stub it to a testID host so the mount is fast.
jest.mock("../../ui/Icon", () => {
  const { View: V } = require("react-native");
  return { Icon: ({ name }: any) => <V testID={`icon-${name}`} /> };
});

import { RsvpStep5Setup } from "../RsvpStep5Setup";

// Minimal DraftEvent with the RSVP-setup fields RsvpStep5Setup reads, chip-in ON
// so the callout cluster mounts.
const makeDraft = () =>
  ({
    id: "d_test",
    rsvpCapacity: null,
    rsvpAllowPlusOnes: false,
    rsvpPlusOnesMax: 0,
    rsvpWaitlistEnabled: false,
    rsvpApprovalMode: "auto",
    rsvpContributionEnabled: true,
    rsvpContributionSuggestedCents: null,
    rsvpContributionMinCents: null,
    currency: "USD",
    privateGuestList: false,
    hideRemainingCount: false,
    visibility: "public",
    rsvpDiscoverable: false,
  }) as any;

const NUDGE = "Connect your bank to collect contributions";
const CONNECT_TESTID = "rsvp-contribution-connect-callout";
const READY_TESTID = "rsvp-contribution-ready-callout";

describe("ORCH-1335 RENDER — chip-in bank callout swaps on chipInPayoutReady", () => {
  test("READY (true) → positive 'Payouts are on', neutral nudge absent", async () => {
    // RTL 14 `render` is async — await it (per EditPublishedTripScreen.render.README).
    const { getByText, getByTestId, queryByText, queryByTestId } = await render(
      <RsvpStep5Setup
        draft={makeDraft()}
        updateDraft={jest.fn()}
        brandDefaultCurrency="USD"
        chipInPayoutReady={true}
      />,
    );
    expect(getByText("Payouts are on")).toBeTruthy();
    expect(getByTestId(READY_TESTID)).toBeTruthy();
    expect(queryByText(NUDGE)).toBeNull();
    expect(queryByTestId(CONNECT_TESTID)).toBeNull();
  });

  test("NOT READY (false) → neutral nudge, positive callout absent", async () => {
    const { getByText, getByTestId, queryByText, queryByTestId } = await render(
      <RsvpStep5Setup
        draft={makeDraft()}
        updateDraft={jest.fn()}
        brandDefaultCurrency="USD"
        chipInPayoutReady={false}
      />,
    );
    expect(getByText(NUDGE)).toBeTruthy();
    expect(getByTestId(CONNECT_TESTID)).toBeTruthy();
    expect(queryByText("Payouts are on")).toBeNull();
    expect(queryByTestId(READY_TESTID)).toBeNull();
  });

  test("LOADING / UNKNOWN (prop omitted → undefined) → neutral nudge, NO false-positive flash", async () => {
    const { getByText, getByTestId, queryByText, queryByTestId } = await render(
      <RsvpStep5Setup
        draft={makeDraft()}
        updateDraft={jest.fn()}
        brandDefaultCurrency="USD"
      />,
    );
    // The positive callout must NEVER render before readiness is confirmed.
    expect(getByText(NUDGE)).toBeTruthy();
    expect(getByTestId(CONNECT_TESTID)).toBeTruthy();
    expect(queryByText("Payouts are on")).toBeNull();
    expect(queryByTestId(READY_TESTID)).toBeNull();
  });
});
