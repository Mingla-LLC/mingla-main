import fs from "node:fs";
import path from "node:path";

type AssetLinksEntry = {
  relation: string[];
  target: {
    namespace: string;
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
};

const EXPECTED_RELATION = ["delegate_permission/common.handle_all_urls"];
const BUSINESS_PACKAGE = "com.sethogieva.minglabusiness";
const BUSINESS_SHA256 =
  "25:4F:86:64:00:44:5B:7F:EA:88:32:22:72:D1:39:B2:AB:DD:84:A9:58:E2:15:AC:51:F2:4F:F9:CD:F1:67:25";
const CONSUMER_PACKAGE = "com.mingla.app.v2";
const CONSUMER_SHA256_FINGERPRINTS = [
  "06:4E:20:DE:0E:A7:4E:AC:72:9D:D7:68:66:5E:B2:70:56:3E:5B:9C:65:C9:12:B5:AC:E5:D6:A0:84:47:7A:BC",
  "90:28:F8:B1:A5:80:79:26:73:AE:DF:DE:00:C3:3D:C1:BC:0A:2A:C6:A3:B2:C0:5B:56:6F:97:67:53:48:0E:02",
];

const assetLinksPath =
  process.env.ORCH_0964_ASSETLINKS_PATH ??
  path.resolve(__dirname, "../public/.well-known/assetlinks.json");

const loadAssetLinks = () =>
  JSON.parse(fs.readFileSync(assetLinksPath, "utf8")) as AssetLinksEntry[];

const findTarget = (entries: AssetLinksEntry[], packageName: string) =>
  entries.find((entry) => entry.target.package_name === packageName);

describe("ORCH-0964 Android App Links asset links", () => {
  it("preserves the existing business-app target", () => {
    const entries = loadAssetLinks();
    const businessTarget = findTarget(entries, BUSINESS_PACKAGE);

    expect(businessTarget).toEqual({
      relation: EXPECTED_RELATION,
      target: {
        namespace: "android_app",
        package_name: BUSINESS_PACKAGE,
        sha256_cert_fingerprints: [BUSINESS_SHA256],
      },
    });
  });

  it("declares the consumer app target with both verified SHA-256 fingerprints", () => {
    const entries = loadAssetLinks();
    const consumerTarget = findTarget(entries, CONSUMER_PACKAGE);

    expect(consumerTarget).toEqual({
      relation: EXPECTED_RELATION,
      target: {
        namespace: "android_app",
        package_name: CONSUMER_PACKAGE,
        sha256_cert_fingerprints: CONSUMER_SHA256_FINGERPRINTS,
      },
    });
  });

  it("does not duplicate Android package targets", () => {
    const packageNames = loadAssetLinks().map(
      (entry) => entry.target.package_name,
    );

    expect(packageNames).toEqual([BUSINESS_PACKAGE, CONSUMER_PACKAGE]);
  });
});
