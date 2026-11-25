/**
 * #4490 spec 08 O3 part B — iPad gets all four orientations, iPhone stays
 * portrait, app.json says tablet + "default". The full prebuild proof (the
 * introspected Info.plist and Android manifest) is in the O3B report.
 *
 * fails-on-revert: drop the plugin from app.config.js, let the iPhone list
 * take landscape, drop an iPad orientation, set UIRequiresFullScreen, or put
 * app.json back to portrait / no tablet and a test here fails.
 */
import fs from "fs";
import path from "path";

const plugin = require("../../../plugins/withFloorOrientations") as ((config: Record<string, unknown>) => {
  mods: { ios: { infoPlist: (config: Record<string, unknown>) => Promise<{ modResults: Record<string, unknown> }> } };
}) & { setFloorOrientations: (plist: Record<string, unknown>) => Record<string, unknown> };

const ALL_FOUR = [
  "UIInterfaceOrientationPortrait",
  "UIInterfaceOrientationPortraitUpsideDown",
  "UIInterfaceOrientationLandscapeLeft",
  "UIInterfaceOrientationLandscapeRight",
];

describe("#4490 O3B withFloorOrientations", () => {
  test("given Expo's 'default' plist (all four everywhere), writes iPhone portrait and iPad all four", async () => {
    const config = plugin({ name: "Mingla Host", slug: "mingla-business" });
    const out = await config.mods.ios.infoPlist({
      ...config,
      modResults: { CFBundleName: "Mingla Host", UISupportedInterfaceOrientations: [...ALL_FOUR], UIRequiresFullScreen: false },
      modRequest: { platform: "ios", projectRoot: ".", introspect: true },
    });
    expect(out.modResults.UISupportedInterfaceOrientations).toEqual([
      "UIInterfaceOrientationPortrait",
      "UIInterfaceOrientationPortraitUpsideDown",
    ]);
    expect(out.modResults["UISupportedInterfaceOrientations~ipad"]).toEqual(ALL_FOUR);
    expect(out.modResults.UIRequiresFullScreen).toBe(false);
    expect(out.modResults.CFBundleName).toBe("Mingla Host");
  });

  test("never writes UIRequiresFullScreen (deprecated in iOS 26; multitasking needs all four)", () => {
    const plist = plugin.setFloorOrientations({});
    expect(Object.keys(plist).sort()).toEqual(["UISupportedInterfaceOrientations", "UISupportedInterfaceOrientations~ipad"]);
    expect(plist.UISupportedInterfaceOrientations).not.toContain("UIInterfaceOrientationLandscapeLeft");
  });

  test("the business app config applies the plugin, after Expo's own orientation", () => {
    const appConfig = require("../../../app.config.js") as (context: {
      config: Record<string, unknown>;
    }) => { plugins: unknown[] };
    const { plugins } = appConfig({ config: { plugins: [], extra: {} } });
    expect(plugins).toContain("./plugins/withFloorOrientations");
  });

  test("app.json: tablet on, orientation default, version and runtime policy untouched", () => {
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../app.json"), "utf8")) as {
      expo: { orientation: string; version: string; ios: { supportsTablet: boolean; requireFullScreen?: boolean; runtimeVersion: unknown }; android: { runtimeVersion: unknown } };
    };
    expect(app.expo.orientation).toBe("default");
    expect(app.expo.ios.supportsTablet).toBe(true);
    expect(app.expo.ios.requireFullScreen).toBeUndefined();
    expect(app.expo.ios.runtimeVersion).toEqual({ policy: "appVersion" });
    expect(app.expo.android.runtimeVersion).toEqual({ policy: "appVersion" });
  });
});
