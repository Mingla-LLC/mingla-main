import fs from "node:fs";
import path from "node:path";

type AasaComponent = { "/": string; comment?: string };
type AasaDetail = { appIDs: string[]; components: AasaComponent[] };
type IntentData = { scheme?: string; host?: string; pathPrefix?: string };
type IntentFilter = {
  action?: string;
  autoVerify?: boolean;
  data?: IntentData[];
  category?: string[];
};

const BUSINESS_APP_ID = "782KVMY869.com.sethogieva.minglabusiness";
const CONSUMER_APP_ID = "782KVMY869.com.mingla.app.v2";

const repoRoot = path.resolve(__dirname, "../..");
const aasa = JSON.parse(
  fs.readFileSync(
    path.join(
      repoRoot,
      "mingla-business/public/.well-known/apple-app-site-association",
    ),
    "utf8",
  ),
) as { applinks: { details: AasaDetail[] } };
const consumerApp = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "app-mobile/app.json"), "utf8"),
) as {
  expo: {
    ios: { associatedDomains: string[] };
    android: { intentFilters: IntentFilter[] };
  };
};
const businessApp = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "mingla-business/app.json"), "utf8"),
) as {
  expo: {
    android: { intentFilters: IntentFilter[] };
  };
};

const aasaPaths = (appId: string) => {
  const detail = aasa.applinks.details.find((entry) =>
    entry.appIDs.includes(appId),
  );
  expect(detail).toBeDefined();
  return detail!.components.map((component) => component["/"]);
};

const verifiedHttpsData = (filters: IntentFilter[]) =>
  filters
    .filter(
      (filter) =>
        filter.action === "VIEW" &&
        filter.autoVerify === true &&
        filter.category?.includes("BROWSABLE") &&
        filter.category?.includes("DEFAULT"),
    )
    .flatMap((filter) => filter.data ?? [])
    .filter((entry) => entry.scheme === "https");

const ownsAndroidPath = (
  filters: IntentFilter[],
  host: string,
  pathPrefix?: string,
) =>
  verifiedHttpsData(filters).some(
    (entry) => entry.host === host && entry.pathPrefix === pathPrefix,
  );

describe("issue #1957 event HTTPS ownership", () => {
  it("gives Mingla iOS every public guest route and keeps Mingla Host non-overlapping", () => {
    const publicGuestPaths = ["/b/*", "/e/*", "/t/*", "/exp/*"];
    expect(aasaPaths(CONSUMER_APP_ID)).toEqual(
      expect.arrayContaining(publicGuestPaths),
    );
    for (const publicPath of publicGuestPaths) {
      expect(aasaPaths(BUSINESS_APP_ID)).not.toContain(publicPath);
    }
  });

  it("gives native Mingla Android every public guest route and keeps Mingla Host non-overlapping", () => {
    const consumerFilters = consumerApp.expo.android.intentFilters;
    const businessFilters = businessApp.expo.android.intentFilters;
    for (const prefix of ["/b/", "/e/", "/t/", "/exp/"]) {
      expect(ownsAndroidPath(consumerFilters, "host.usemingla.com", prefix)).toBe(
        true,
      );
      expect(ownsAndroidPath(businessFilters, "host.usemingla.com", prefix)).toBe(
        false,
      );
    }
  });

  it("preserves usemingla.com and go.usemingla.com ownership", () => {
    for (const prefix of [
      "/b",
      "/p",
      "/s/",
      "/invite",
      "/board",
      "/orders",
      "/chat",
    ]) {
      expect(
        ownsAndroidPath(
          consumerApp.expo.android.intentFilters,
          "usemingla.com",
          prefix,
        ),
      ).toBe(true);
    }
    expect(
      ownsAndroidPath(consumerApp.expo.android.intentFilters, "go.usemingla.com"),
    ).toBe(true);
    expect(consumerApp.expo.ios.associatedDomains).toEqual(
      expect.arrayContaining([
        "applinks:usemingla.com",
        "applinks:host.usemingla.com",
        "applinks:go.usemingla.com",
      ]),
    );
  });
});
