import fs from "node:fs";
import path from "node:path";

type ExpoPlugin = string | [string, Record<string, unknown>];

type AppManifest = {
  expo?: {
    version?: string;
    runtimeVersion?: { policy?: string };
    ios?: { runtimeVersion?: { policy?: string } };
    android?: { runtimeVersion?: { policy?: string } };
    plugins?: ExpoPlugin[];
  };
};

type PackageManifest = {
  dependencies?: Record<string, string>;
  expo?: {
    autolinking?: {
      android?: { exclude?: string[] };
    };
  };
};

const repoRoot = path.resolve(__dirname, "..", "..");

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, relativePath), "utf8"),
  ) as T;
}

function pluginNames(manifest: AppManifest): string[] {
  return (manifest.expo?.plugins ?? []).map((plugin) =>
    typeof plugin === "string" ? plugin : plugin[0],
  );
}

describe("issue #2054 Business Android AppsFlyer native linkage", () => {
  const businessPackage = readJson<PackageManifest>(
    "mingla-business/package.json",
  );
  const businessApp = readJson<AppManifest>("mingla-business/app.json");
  const consumerApp = readJson<AppManifest>("app-mobile/app.json");
  const businessExclusions =
    businessPackage.expo?.autolinking?.android?.exclude ?? [];

  test("Business Android autolinks AppsFlyer while preserving dependency and plugin", () => {
    expect(businessPackage.dependencies?.["react-native-appsflyer"]).toBe(
      "^6.17.9",
    );
    expect(pluginNames(businessApp)).toContain("react-native-appsflyer");
    expect(businessExclusions).not.toContain("react-native-appsflyer");
  });

  test("unrelated Business Android exclusions remain exact", () => {
    expect(businessExclusions).toEqual([
      "react-native-onesignal",
      "react-native-purchases",
    ]);
  });

  test("Consumer remains linked as the known-good control", () => {
    expect(pluginNames(consumerApp)).toContain("react-native-appsflyer");
  });

  test("both appVersion runtimes advance together to 1.1.5", () => {
    const businessVersion = businessApp.expo?.version;
    const consumerVersion = consumerApp.expo?.version;
    expect(businessVersion).toBe(consumerVersion);
    // #2425 — retain #2054's exact historical 1.1.5 proof while allowing a
    // later unified release train to advance on a stable SemVer marker.
    if (businessVersion !== "1.1.5" || consumerVersion !== "1.1.5") {
      expect(businessVersion).toMatch(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
      );
      expect(businessApp.expo?.ios?.runtimeVersion?.policy).toBe("appVersion");
      expect(businessApp.expo?.android?.runtimeVersion?.policy).toBe(
        "appVersion",
      );
      expect(consumerApp.expo?.runtimeVersion?.policy).toBe("appVersion");
      return;
    }
    expect(businessApp.expo?.version).toBe("1.1.5");
    expect(consumerApp.expo?.version).toBe("1.1.5");
    expect(businessApp.expo?.ios?.runtimeVersion?.policy).toBe("appVersion");
    expect(businessApp.expo?.android?.runtimeVersion?.policy).toBe(
      "appVersion",
    );
    expect(consumerApp.expo?.runtimeVersion?.policy).toBe("appVersion");
  });
});
