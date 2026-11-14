// MINGLA-INVARIANT: I-4238-SKAN-IDS | issue #4238 | both iOS apps declare the same SKAdNetwork roster, including TikTok global (mj797d8u6f, 22mmun2rn5), Snap (424m5254lk) and Reddit (2tdux39lx8) and never ByteDance China's 238da6jt44, and both set the top-level AttributionCopyEndpoint to AppsFlyer.
/**
 * #4238 W4-2 (D23). Ids from AppsFlyer's SKAN partner CSV (Step 0 Z11);
 * AttributionCopyEndpoint from Apple's AdAttributionKit docs (Z11b). Takes
 * effect only in a store build Seth approves (native Info.plist, not OTA).
 */
import fs from "node:fs";
import path from "node:path";

type Plist = {
  SKAdNetworkItems: { SKAdNetworkIdentifier: string }[];
  AttributionCopyEndpoint?: unknown;
  NSAdvertisingAttributionReportEndpoint?: unknown;
};

const ROOT = path.resolve(__dirname, "..", "..");
const plist = (rel: string): Plist =>
  JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")).expo.ios.infoPlist;
const ids = (p: Plist): string[] =>
  p.SKAdNetworkItems.map((i) => i.SKAdNetworkIdentifier);

const REQUIRED = [
  "v9wttpbfk9.skadnetwork",
  "n38lu8286q.skadnetwork",
  "cstr6suwn9.skadnetwork",
  "mj797d8u6f.skadnetwork",
  "22mmun2rn5.skadnetwork",
  "424m5254lk.skadnetwork",
  "2tdux39lx8.skadnetwork",
];
const ENDPOINT = "https://appsflyer-skadnetwork.com/";

describe("#4238 W4-2 SKAdNetwork roster and AdAttributionKit endpoint", () => {
  const host = plist("mingla-business/app.json");
  const explorer = plist("app-mobile/app.json");

  it("both apps' lists are equal and contain TikTok, Snap and Reddit", () => {
    expect(ids(host)).toEqual(ids(explorer));
    for (const id of REQUIRED) expect(ids(host)).toContain(id);
    expect(ids(host)).not.toContain("238da6jt44.skadnetwork");
  });

  it("both apps set the top-level AttributionCopyEndpoint to AppsFlyer", () => {
    for (const p of [host, explorer]) {
      expect(p.AttributionCopyEndpoint).toBe(ENDPOINT);
      expect(p.NSAdvertisingAttributionReportEndpoint).toBe(ENDPOINT);
    }
  });
});
