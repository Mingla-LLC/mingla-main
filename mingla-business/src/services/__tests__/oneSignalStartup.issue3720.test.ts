/**
 * #3720 — OneSignal initialization must happen during root-module startup,
 * before the root click-handler effect and never behind after-interactions.
 */

import fs from "node:fs";
import path from "node:path";

describe("#3720 OneSignal startup order", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../../app/_layout.tsx"),
    "utf8",
  );

  test("initializes before RootLayout renders and not inside deferred SDK work", () => {
    const startupCall = source.indexOf("initializeOneSignal();");
    const rootLayout = source.indexOf("function RootLayout");
    const deferredBlock = source.indexOf(
      "InteractionManager.runAfterInteractions",
    );

    expect(startupCall).toBeGreaterThan(-1);
    expect(rootLayout).toBeGreaterThan(-1);
    expect(startupCall).toBeLessThan(rootLayout);
    expect(source.indexOf("initializeOneSignal();", startupCall + 1)).toBe(-1);
    expect(startupCall).toBeLessThan(deferredBlock);
  });
});
