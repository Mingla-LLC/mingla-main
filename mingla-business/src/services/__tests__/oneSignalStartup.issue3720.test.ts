/**
 * #3720 — cold-click capture must attach during module evaluation even though
 * the optional OneSignal SDK remains intentionally initialized after the first
 * interaction frame for Android startup safety.
 */

import fs from "node:fs";
import path from "node:path";

describe("#3720 OneSignal cold-click startup order", () => {
  const rootLayout = fs.readFileSync(
    path.resolve(__dirname, "../../../app/_layout.tsx"),
    "utf8",
  );
  const service = fs.readFileSync(
    path.resolve(__dirname, "../oneSignalService.ts"),
    "utf8",
  );

  test("captures clicks early while preserving deferred optional-SDK initialization", () => {
    const captureCall = service.indexOf(
      "ensureNativeNotificationClickCapture();",
      service.indexOf("function ensureNativeNotificationClickCapture"),
    );
    const clickSubscriber = service.indexOf(
      "export function onNotificationClicked",
    );
    const deferredBlock = rootLayout.indexOf(
      "InteractionManager.runAfterInteractions",
    );
    const initializeCall = rootLayout.indexOf("initializeOneSignal();");

    expect(captureCall).toBeGreaterThan(-1);
    expect(clickSubscriber).toBeGreaterThan(-1);
    expect(captureCall).toBeLessThan(clickSubscriber);
    expect(deferredBlock).toBeGreaterThan(-1);
    expect(initializeCall).toBeGreaterThan(deferredBlock);
    expect(rootLayout.indexOf("initializeOneSignal();", initializeCall + 1)).toBe(
      -1,
    );
  });

  test("holds push navigation until boot index → Home has settled", () => {
    expect(rootLayout).toContain("isBusinessNavigationStartupSettled");
    expect(rootLayout).toContain("navigationStartupSettled");
    expect(rootLayout).toContain("holdLaunchTarget: holdBusinessPushLaunchTarget");
    const holdCall = rootLayout.indexOf(
      "holdLaunchTarget: holdBusinessPushLaunchTarget",
    );
    const flushCall = rootLayout.indexOf("consumeBusinessPushLaunchTarget()");
    expect(holdCall).toBeGreaterThan(-1);
    expect(flushCall).toBeGreaterThan(holdCall);
  });
});
