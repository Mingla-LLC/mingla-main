/**
 * ORCH-1143 — LiveOfferingCard RENDER proof (tester runtime evidence).
 *
 * A REAL @testing-library/react-native mount of the production LiveOfferingCard.
 * Source-grep tests are capped at "suspected"; this is the runtime evidence that
 * the scan button actually RENDERS and FIRES for EVERY live kind (event /
 * experience / trip) and routes the correct id to onScanPress, plus that the
 * Scanned tile is honest-empty ("—") at runtime.
 *
 * Heavy presentational deps (GlassCard / Pill / Icon) are stubbed to lightweight
 * hosts so the mount is fast + deterministic; the component's OWN logic (the
 * unconditional scan Pressable, the per-kind display normalization, the honest
 * Scanned cell) runs for real.
 *
 * Run: npx jest --config jest.orch1143.render.cjs --runInBand
 */

import React from "react";
import { Text, View } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";

// Lightweight stubs for the visual primitives (not under test here).
jest.mock("../../ui/GlassCard", () => {
  const { View: V } = require("react-native");
  return { GlassCard: ({ children, testID }: any) => <V testID={testID}>{children}</V> };
});
jest.mock("../../ui/Pill", () => {
  const { Text: T } = require("react-native");
  return { Pill: ({ children }: any) => <T>{children}</T> };
});
jest.mock("../../ui/Icon", () => {
  const { View: V } = require("react-native");
  return { Icon: ({ name }: any) => <V testID={`icon-${name}`} /> };
});
// Trip adapter: return a LiveEvent-shaped object so the card's trip branch runs.
// The card imports `../../utils/tripToLiveEvent`; from this test that resolves
// at `../../../utils/tripToLiveEvent`.
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

const makeItem = (kind: "event" | "experience" | "trip", id: string) => ({
  key: `k-${id}`,
  id,
  kind,
  status: "live" as const,
  startAtUtc: new Date(),
  endAtUtc: new Date(),
  source: { id, name: `${kind} name`, event_type: kind } as any,
});

describe("ORCH-1143 RENDER — scan button fires for EVERY live kind", () => {
  test.each(["event", "experience", "trip"] as const)(
    "a live %s renders a scan button that fires onScanPress with the offering id",
    (kind) => {
      const onScan = jest.fn();
      const id = `id-${kind}`;
      const { getByTestId, getByText } = render(
        <LiveOfferingCard item={makeItem(kind, id) as any} metrics={metrics} onScanPress={onScan} />,
      );
      // The button RENDERS (not gated by kind).
      const btn = getByTestId("home-live-card-scan-button");
      expect(btn).toBeTruthy();
      // Kind-neutral copy.
      expect(getByText("Scan QR codes")).toBeTruthy();
      // It FIRES with the correct id (proves not a dead tap).
      fireEvent.press(btn);
      expect(onScan).toHaveBeenCalledTimes(1);
      expect(onScan).toHaveBeenCalledWith(id);
    },
  );

  test("Scanned tile is honest-empty '—' at runtime (Constitution #9, no fabrication)", () => {
    const { getByText, queryAllByText } = render(
      <LiveOfferingCard item={makeItem("event", "e1") as any} metrics={metrics} onScanPress={jest.fn()} />,
    );
    expect(getByText("Scanned")).toBeTruthy();
    // The dash is present as a stat value (the Scanned cell).
    expect(queryAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  test("a11y label is kind-neutral + disambiguated by offering name", () => {
    const { getByLabelText } = render(
      <LiveOfferingCard item={makeItem("trip", "t9") as any} metrics={metrics} onScanPress={jest.fn()} />,
    );
    // Trip name comes via the mocked tripToLiveEvent → "trip name".
    expect(getByLabelText("Scan tickets for trip name")).toBeTruthy();
  });
});
