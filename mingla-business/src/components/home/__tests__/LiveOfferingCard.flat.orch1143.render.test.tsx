/**
 * ORCH-1143 §4.4-A (continuous-section fix v2) — LiveOfferingCard `flat` prop
 * RENDER proof.
 *
 * Seth device-tested the prior fix and said the "Live now" header + content read
 * as "two different sections as opposed to one continuous section with a
 * divider." The fix makes them ONE continuous surface: the single-live card is
 * rendered FLAT (chrome-less) directly on the shared `base` section surface in
 * home.tsx, while the carousel (≥2 live) keeps each card's own elevated glass.
 *
 * This is the runtime evidence that:
 *   - `flat` mode renders the content WITHOUT its own GlassCard chrome (no
 *     glass-on-glass / no air gap = the continuous-section requirement), while
 *   - default/elevated mode (carousel) DOES wrap in a GlassCard, AND
 *   - in BOTH modes the scan button still renders + fires (behavior unchanged).
 *
 * The GlassCard stub emits a `glasscard` marker testID so its presence/absence
 * is directly assertable.
 *
 * Run: npx jest --config jest.orch1143.render.cjs --runInBand
 */

import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

// GlassCard stub emits a marker so we can assert presence/absence of the chrome.
jest.mock("../../ui/GlassCard", () => {
  const { View: V } = require("react-native");
  return {
    GlassCard: ({ children, testID }: any) => (
      <V testID={testID}>
        <V testID="glasscard-marker" />
        {children}
      </V>
    ),
  };
});
jest.mock("../../ui/Pill", () => {
  const { Text: T } = require("react-native");
  return { Pill: ({ children }: any) => <T>{children}</T> };
});
jest.mock("../../ui/Icon", () => {
  const { View: V } = require("react-native");
  return { Icon: ({ name }: any) => <V testID={`icon-${name}`} /> };
});
jest.mock("../../../utils/tripToLiveEvent", () => ({
  tripToLiveEvent: (t: any) => ({ id: t.id, name: t.name, event_type: "trip" }),
}));
jest.mock("../../../utils/eventDateDisplay", () => ({
  formatDraftDateLine: () => "Today · 7:00 PM",
}));

import { LiveOfferingCard, type LiveCardMetrics } from "../LiveOfferingCard";

const metrics: LiveCardMetrics = {
  revenueLabel: "$120",
  soldValue: "6",
  capacityLabel: "20",
  capacity: 20,
  progress: 0.3,
};

const item = {
  key: "k-e1",
  id: "e1",
  kind: "event" as const,
  status: "live" as const,
  startAtUtc: new Date(),
  endAtUtc: new Date(),
  source: { id: "e1", name: "event name", event_type: "event" } as any,
};

describe("ORCH-1143 §4.4-A v2 — flat (single-live) renders chrome-less, elevated (carousel) keeps glass", () => {
  test("flat mode renders WITHOUT a GlassCard (continuous-section: no glass-on-glass / no air gap)", () => {
    const { queryByTestId } = render(
      <LiveOfferingCard flat item={item as any} metrics={metrics} onScanPress={jest.fn()} testID="home-live-card" />,
    );
    // The shared section surface lives in home.tsx; the flat card must NOT add
    // its own GlassCard chrome.
    expect(queryByTestId("glasscard-marker")).toBeNull();
    // The flat wrapper still carries the testID so render-test selectors resolve.
    expect(queryByTestId("home-live-card")).toBeTruthy();
  });

  test("default/elevated mode (carousel card) DOES wrap in a GlassCard", () => {
    const { queryByTestId } = render(
      <LiveOfferingCard item={item as any} metrics={metrics} onScanPress={jest.fn()} width={320} />,
    );
    expect(queryByTestId("glasscard-marker")).toBeTruthy();
  });

  test("scan button renders + fires in BOTH modes (behavior unchanged by the chrome split)", () => {
    const onScanFlat = jest.fn();
    const flatView = render(
      <LiveOfferingCard flat item={item as any} metrics={metrics} onScanPress={onScanFlat} />,
    );
    fireEvent.press(flatView.getByTestId("home-live-card-scan-button"));
    expect(onScanFlat).toHaveBeenCalledWith("e1");

    const onScanElevated = jest.fn();
    const elevatedView = render(
      <LiveOfferingCard item={item as any} metrics={metrics} onScanPress={onScanElevated} width={320} />,
    );
    fireEvent.press(elevatedView.getByTestId("home-live-card-scan-button"));
    expect(onScanElevated).toHaveBeenCalledWith("e1");
  });
});
