// #2107 — the version-gate coordinator keeps reporting the "allowed" outcome
// that the #2443 identity suite pins, and the default analytics reporter still
// captures it as version_gate_allowed (the captured prefix).
//
// FAILS ON REVERT: renaming the coordinator outcome back to
// version_gate_allowed fails the first test; dropping the reporter mapping
// fails the second.

jest.mock("../appVersionIdentity", () => ({
  APP_VERSION_APP_ID: "business",
  APP_VERSION_SCHEMA: 1,
  getInstalledNativeVersion: () => "1.1.6",
  getNativeAppPlatform: () => "ios",
}));

import {
  VersionGateCoordinator,
  capturedVersionGateOutcome,
  type AppVersionPolicy,
} from "../appVersionPolicy";

const policy = (minimumVersion: string): AppVersionPolicy => ({
  appId: "business",
  platform: "ios",
  minimumVersion,
  storeUrl: "https://apps.apple.com/app/id6760440898",
  message: "Update Mingla to keep using the app.",
  enforcementMode: "enforce",
  updatedAt: "2026-08-23T15:14:04.347Z",
});

describe("#2107 allowed outcome contract", () => {
  it("happy: an up-to-date install reports the stable allowed outcome", async () => {
    const reports: string[] = [];
    const gate = new VersionGateCoordinator({
      platform: "ios",
      installedVersion: "1.1.6",
      loadCache: async () => null,
      saveCache: async () => undefined,
      fetchPolicy: async () => policy("1.1.5"),
      report: (outcome) => reports.push(outcome),
    });
    await expect(gate.check(true)).resolves.toMatchObject({ phase: "allowed" });
    expect(reports).toContain("allowed");
    expect(reports).not.toContain("version_gate_allowed");
  });

  it("the analytics reporter captures allowed as version_gate_allowed and passes others through", () => {
    expect(capturedVersionGateOutcome("allowed")).toBe("version_gate_allowed");
    expect(capturedVersionGateOutcome("version_gate_required")).toBe("version_gate_required");
    expect(capturedVersionGateOutcome("installed_version_unavailable")).toBe(
      "installed_version_unavailable",
    );
    expect(capturedVersionGateOutcome("constructor")).toBe("constructor");
  });
});
