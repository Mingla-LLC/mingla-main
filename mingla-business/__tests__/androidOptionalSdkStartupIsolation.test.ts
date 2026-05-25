import fs from "node:fs";
import path from "node:path";

const businessRoot = path.resolve(__dirname, "..");
const appConfigPath = path.join(businessRoot, "app.config.ts");
const appJsonPath = path.join(businessRoot, "app.json");

const read = (relPath: string): string =>
  fs.readFileSync(path.join(businessRoot, relPath), "utf8");

const loadConfig = (): { plugins?: unknown[] } => {
  jest.resetModules();
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, "utf8"));
  const mod = require(appConfigPath);
  return mod.default({ config: { plugins: appJson.expo.plugins } });
};

const pluginNames = (plugins: unknown[] = []): string[] =>
  plugins
    .map((plugin) => {
      if (typeof plugin === "string") return plugin;
      if (Array.isArray(plugin) && typeof plugin[0] === "string") {
        return plugin[0];
      }
      return null;
    })
    .filter((name): name is string => name !== null);

describe("META-ORCH-0972 Sub-B Android optional SDK startup isolation", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it("filters optional native startup plugins when their env keys are absent", () => {
    delete process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY;
    delete process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID;
    delete process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID;
    delete process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID;

    const names = pluginNames(loadConfig().plugins);

    expect(names).not.toContain("react-native-appsflyer");
    expect(names).not.toContain("onesignal-expo-plugin");
    expect(names).toContain("@stripe/stripe-react-native");
  });

  it("excludes env-absent optional install SDKs from Android native autolinking", () => {
    const packageJson = JSON.parse(read("package.json"));

    expect(packageJson.expo?.autolinking?.android?.exclude).toEqual(
      expect.arrayContaining([
        "react-native-appsflyer",
        "react-native-onesignal",
        "react-native-purchases",
      ]),
    );
  });

  it("keeps optional native startup plugins when their env keys are present", () => {
    process.env.EXPO_PUBLIC_APPSFLYER_DEV_KEY = "af_key";
    process.env.EXPO_PUBLIC_APPSFLYER_IOS_APP_ID = "ios_id";
    process.env.EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID = "android_id";
    process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID = "onesignal_id";

    const names = pluginNames(loadConfig().plugins);

    expect(names).toContain("react-native-appsflyer");
    expect(names).toContain("onesignal-expo-plugin");
  });

  it("defers optional SDK initialization until after the first interaction frame", () => {
    const rootLayout = read("app/_layout.tsx");

    expect(rootLayout).toMatch(/InteractionManager\.runAfterInteractions/);
    expect(rootLayout).toMatch(/setTimeout\(\(\) => \{/);
    expect(
      rootLayout.indexOf("InteractionManager.runAfterInteractions"),
    ).toBeLessThan(rootLayout.indexOf("initializeAppsFlyer();"));
    expect(
      rootLayout.indexOf("InteractionManager.runAfterInteractions"),
    ).toBeLessThan(rootLayout.indexOf("initializeOneSignal();"));
  });

  it("does not require optional native SDK modules before env guards pass", () => {
    const appsFlyer = read("src/services/appsFlyerService.ts");
    const oneSignal = read("src/services/oneSignalService.ts");
    const revenueCat = read("src/services/revenueCatService.ts");

    expect(appsFlyer).toMatch(
      /if \(Platform\.OS !== "web" && hasAppsFlyerEnv\) \{[\s\S]*require\("react-native-appsflyer"\)/,
    );
    expect(oneSignal).toMatch(
      /if \(Platform\.OS !== "web" && ONESIGNAL_APP_ID\) \{[\s\S]*require\("react-native-onesignal"\)/,
    );
    expect(revenueCat).toMatch(
      /if \(Platform\.OS !== "web" && REVENUECAT_API_KEY\) \{[\s\S]*require\("react-native-purchases"\)/,
    );
  });
});

// fails-on-revert verified at c2e1850cd: app.config.ts always carried the
// env-absent AppsFlyer and OneSignal config plugins, package.json did not
// exclude optional Android install SDKs from autolinking, app/_layout.tsx ran
// optional SDK init immediately at mount, and the optional SDK services
// required native modules before checking whether their env keys existed.
