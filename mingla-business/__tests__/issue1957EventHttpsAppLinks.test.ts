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

const aasaPaths = (appId: string) => {
  const detail = aasa.applinks.details.find((entry) =>
    entry.appIDs.includes(appId),
  );
  expect(detail).toBeDefined();
  return detail!.components.map((component) => component["/"]);
};

const verifiedHttpsData = consumerApp.expo.android.intentFilters
  .filter(
    (filter) =>
      filter.action === "VIEW" &&
      filter.autoVerify === true &&
      filter.category?.includes("BROWSABLE") &&
      filter.category?.includes("DEFAULT"),
  )
  .flatMap((filter) => filter.data ?? [])
  .filter((entry) => entry.scheme === "https");

const ownsAndroidPath = (host: string, pathPrefix?: string) =>
  verifiedHttpsData.some(
    (entry) => entry.host === host && entry.pathPrefix === pathPrefix,
  );

describe("issue #1957 event HTTPS ownership", () => {
  it("gives Explorer iOS /e ownership without removing Business /e or existing Explorer public routes", () => {
    expect(aasaPaths(CONSUMER_APP_ID)).toEqual(
      expect.arrayContaining(["/b/*", "/t/*", "/exp/*", "/e/*"]),
    );
    expect(aasaPaths(BUSINESS_APP_ID)).toContain("/e/*");
  });

  it("gives the native Explorer Android manifest /e ownership on the canonical buyer host", () => {
    expect(ownsAndroidPath("host.usemingla.com", "/e")).toBe(true);
  });

  it("preserves every pre-existing Business-host Explorer route", () => {
    for (const prefix of ["/b", "/t", "/exp"]) {
      expect(ownsAndroidPath("host.usemingla.com", prefix)).toBe(true);
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
      expect(ownsAndroidPath("usemingla.com", prefix)).toBe(true);
    }
    expect(ownsAndroidPath("go.usemingla.com")).toBe(true);
    expect(consumerApp.expo.ios.associatedDomains).toEqual(
      expect.arrayContaining([
        "applinks:usemingla.com",
        "applinks:host.usemingla.com",
        "applinks:go.usemingla.com",
      ]),
    );
  });
});
