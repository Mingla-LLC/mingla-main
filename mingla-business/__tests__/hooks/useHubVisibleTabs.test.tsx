import { describe, expect, test } from "@jest/globals";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

jest.mock("../../src/hooks/useBrandOfferingCounts", () => ({
  useBrandOfferingCounts: jest.fn(),
}));

import {
  deriveHubVisibleTabs,
  pickHubInitialTab,
} from "../../src/hooks/useHubTabs";

// fails-on-revert verified at 6633be066

describe("META-ORCH-0972 Sub-B useHubVisibleTabs contract", () => {
  // ORCH-1038: the "Get started" fallback pill is removed — when the brand has no
  // offerings the shared to-do toggle (above the pills) carries the create action,
  // and the Hub lands on its canonical /hub/events route. So an empty brand yields
  // NO pills and a null initial tab.
  test("SC-B-13 empty brand returns no pills (Get started decommissioned)", () => {
    expect(
      deriveHubVisibleTabs({ events: 0, trips: 0, experiences: 0 }),
    ).toEqual([]);
  });

  test("SC-B-13 brand with only trips returns trips only", () => {
    expect(
      deriveHubVisibleTabs({ events: 0, trips: 2, experiences: 0 }),
    ).toEqual(["trips"]);
  });

  test("SC-B-13 brand with all buckets returns fixed Events Trips Experiences order", () => {
    expect(
      deriveHubVisibleTabs({ events: 1, trips: 1, experiences: 1 }),
    ).toEqual(["events", "trips", "experiences"]);
  });

  test("SC-B-6 sticky last tab falls back to first visible when stale", () => {
    expect(pickHubInitialTab("experiences", ["events", "trips"])).toBe("events");
    expect(pickHubInitialTab("trips", ["events", "trips"])).toBe("trips");
    expect(pickHubInitialTab(null, ["trips"])).toBe("trips");
  });

  test("adversarial stale stored tab yields null initial tab when every offering bucket is empty", () => {
    const visibleTabs = deriveHubVisibleTabs({
      events: 0,
      trips: 0,
      experiences: 0,
    });

    expect(visibleTabs).toEqual([]);
    // No visible tabs → no initial tab (Hub falls to its /hub/events index redirect).
    expect(pickHubInitialTab("experiences", visibleTabs)).toBeNull();
  });
});
