/**
 * #4420 device round 2 (Android emulator): with edge-to-edge on, the status
 * bar draws over the root view. The root was unpainted, so the window's light
 * theme background showed as a light grey band under white icons. FAILS ON
 * REVERT: drop the canvas fill on the root view or the app-wide light status
 * bar and the band comes back.
 */
import fs from "fs";
import path from "path";

const layout = fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "app", "_layout.tsx"), "utf8");

describe("#4420 Android status bar sits on the dark canvas", () => {
  test("the root view is painted with the canvas token", () => {
    expect(layout).toMatch(/<GestureHandlerRootView style=\{rootStyles\.root\}>/);
    expect(layout).toMatch(/root: \{ flex: 1, backgroundColor: color\.canvas \}/);
  });

  test("the app's default status bar draws light icons", () => {
    expect(layout).toMatch(/import \{ StatusBar as ExpoStatusBar \} from "expo-status-bar";/);
    expect(layout).toMatch(/<ExpoStatusBar style="light" \/>/);
  });
});
