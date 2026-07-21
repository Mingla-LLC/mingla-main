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
// Each Mingla Android app has THREE signing identities, not two — Play app-signing,
// EAS upload/release, and the EAS debug keystore — and each one is the only thing
// keeping a different install path's App Links alive (Play install / release-signed
// sideload / `development` dev-client build). #1042.
//
// Business (com.sethogieva.minglabusiness), in array order:
//   [0] 25:4F:86:64:… — EAS UPLOAD/RELEASE key (signs the AAB we upload and every
//                       preview/production APK). SHA-1 A5:DC:F9:60:…
//   [1] F7:5A:A7:54:… — PLAY APP-SIGNING key (Google's; signs every Play install,
//                       all tracks).                SHA-1 F6:42:B1:8C:…
//   Business's EAS DEBUG keystore is absent — its fingerprint is unknown to this
//   repo (#1042 F-5, OP-2). It was deliberately not guessed.
//
// Consumer/Explorer (com.mingla.app.v2), in array order:
//   [0] 06:4E:20:DE:… — PLAY APP-SIGNING key.        SHA-1 44:10:56:99:…
//   [1] 6B:21:64:88:… — EAS UPLOAD/RELEASE key, added at #1042. Its absence is why
//                       App Links died on every release-signed sideload (F-3).
//                                                    SHA-1 D0:19:42:E6:…
//   [2] 90:28:F8:B1:… — EAS DEBUG keystore. NOT STALE: #1042 F-2 proved from commit
//                       b9be365a4 that both Explorer Play certificates have been
//                       unchanged since 2026-04-12, so no rotation ever happened and
//                       this cannot be a former upload cert. Deleting it breaks App
//                       Links on every development-profile dev-client build.
//
// NONE OF THESE MAY BE DELETED. The set is append-only (invariant
// I-PROPOSED-1042-ANDROID-FINGERPRINT-SET-APPEND-ONLY); removal requires a Play
// Console or `eas credentials` readback cited in the PR body.
// Provenance, registration matrix and the pre-release check:
// docs/runbooks/ANDROID_SIGNING_AND_DEEP_LINK_REGISTRY.md
const BUSINESS_SHA256_FINGERPRINTS = [
  "25:4F:86:64:00:44:5B:7F:EA:88:32:22:72:D1:39:B2:AB:DD:84:A9:58:E2:15:AC:51:F2:4F:F9:CD:F1:67:25",
  "F7:5A:A7:54:67:6F:AE:0B:CE:2C:71:9B:A3:C3:8D:AD:96:EB:66:AD:1E:70:C7:9A:B5:AF:C4:3E:D0:A2:2F:6F",
];
const CONSUMER_PACKAGE = "com.mingla.app.v2";
const CONSUMER_SHA256_FINGERPRINTS = [
  "06:4E:20:DE:0E:A7:4E:AC:72:9D:D7:68:66:5E:B2:70:56:3E:5B:9C:65:C9:12:B5:AC:E5:D6:A0:84:47:7A:BC",
  "6B:21:64:88:74:B9:3F:A4:7F:19:78:75:88:33:5F:64:C0:1D:21:7B:A9:F0:4E:71:6D:83:29:D0:AE:18:CC:DD",
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
        sha256_cert_fingerprints: BUSINESS_SHA256_FINGERPRINTS,
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
