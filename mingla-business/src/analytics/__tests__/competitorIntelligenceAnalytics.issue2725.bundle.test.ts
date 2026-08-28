import { Platform } from "react-native";

const nativeCapture = jest.fn();
const webCapture = jest.fn();

jest.mock("../../services/postHogService", () => ({
  postHogService: { capture: (...args: unknown[]) => nativeCapture(...args) },
}));
jest.mock("../webAnalytics", () => ({
  captureWeb: (...args: unknown[]) => webCapture(...args),
}));

import {
  captureCompetitorIntelligenceEvent,
  captureIntelCompetitorAdded,
} from "../competitorIntelligenceAnalytics";
import {
  captureIntelCardShown,
  captureIntelRunCompleted,
} from "../venueInsightsAnalytics";

const expectedPlatform = Platform.OS === "web"
  ? "web"
  : Platform.OS === "android" ? "android" : "ios";

describe("issue #2725 lazy analytics ownership", () => {
  beforeEach(() => {
    nativeCapture.mockClear();
    webCapture.mockClear();
  });

  it("preserves the exact privacy-allowlisted competitor event payload", () => {
    captureCompetitorIntelligenceEvent("competitor_source_added", {
      watch_id: "watch-1",
      source_count: 2,
      schema_version: 2,
    });
    expect(nativeCapture).toHaveBeenCalledWith("competitor_source_added", {
      watch_id: "watch-1",
      source_count: 2,
      schema_version: 2,
      platform: expectedPlatform,
    });
    expect(webCapture).toHaveBeenCalledWith(...nativeCapture.mock.calls[0]);
  });

  it("preserves the legacy competitor-added event and site insight payloads", () => {
    captureIntelCompetitorAdded();
    captureIntelCardShown("insights_site", "A");
    captureIntelRunCompleted("insights_site", "B");
    expect(nativeCapture.mock.calls).toEqual([
      ["intel_competitor_added", {
        tool: "venues",
        surface: "insights_competitor",
        door: "hub",
        verdict_or_band: null,
        platform: expectedPlatform,
      }],
      ["intel_card_shown", {
        tool: "venues",
        surface: "insights_site",
        door: "hub",
        verdict_or_band: "A",
        platform: expectedPlatform,
      }],
      ["intel_run_completed", {
        tool: "venues",
        surface: "insights_site",
        door: "hub",
        verdict_or_band: "B",
        platform: expectedPlatform,
      }],
    ]);
    expect(webCapture.mock.calls).toEqual(nativeCapture.mock.calls);
  });
});
