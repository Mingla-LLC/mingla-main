import { execFileSync } from "node:child_process";
import path from "node:path";

type AndroidNativeDependency = {
  root?: string;
  platforms?: {
    android?: {
      sourceDir?: string;
      packageImportPath?: string;
      packageInstance?: string;
    };
  };
};

type ReactNativeConfig = {
  dependencies?: Record<string, AndroidNativeDependency>;
};

const businessRoot = path.resolve(__dirname, "..");
const autolinkingCli = path.join(
  businessRoot,
  "node_modules",
  ".bin",
  "expo-modules-autolinking",
);

function resolveAndroidNativeConfig(): ReactNativeConfig {
  const output = execFileSync(
    autolinkingCli,
    ["react-native-config", "--platform", "android", "--json"],
    {
      cwd: businessRoot,
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    },
  );
  return JSON.parse(output) as ReactNativeConfig;
}

describe("issue #2054 tester adversarial Android native resolution", () => {
  const config = resolveAndroidNativeConfig();
  const dependencies = config.dependencies ?? {};
  const appsFlyer = dependencies["react-native-appsflyer"];
  const android = appsFlyer?.platforms?.android;

  test("the generated Android package graph contains the real AppsFlyer bridge", () => {
    expect(appsFlyer?.root).toBe(
      path.join(businessRoot, "node_modules", "react-native-appsflyer"),
    );
    expect(android?.sourceDir).toBe(
      path.join(
        businessRoot,
        "node_modules",
        "react-native-appsflyer",
        "android",
      ),
    );
    expect(android?.packageImportPath).toBe(
      "import com.appsflyer.reactnative.RNAppsFlyerPackage;",
    );
    expect(android?.packageInstance?.split(/\s+/).join(" ")).toBe(
      "new RNAppsFlyerPackage(), new com.appsflyer.reactnative.PCAppsFlyerPackage()",
    );
  });

  test("the resolver still omits the two intentionally excluded Android SDKs", () => {
    expect(dependencies["react-native-onesignal"]).toBeUndefined();
    expect(dependencies["react-native-purchases"]).toBeUndefined();
  });
});
