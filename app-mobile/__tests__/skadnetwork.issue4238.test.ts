// MINGLA-INVARIANT: I-4238-SKAN-IDS-EXPLORER | issue #4238 | both iOS apps declare the same SKAdNetwork roster, including TikTok global (mj797d8u6f, 22mmun2rn5), Snap (424m5254lk) and Reddit (2tdux39lx8) and never ByteDance China's 238da6jt44, and both set the top-level AttributionCopyEndpoint to AppsFlyer.
// @ts-nocheck — Deno-runtime config contract (app-mobile has no jest runner).
// #4238 W4-2 (D23). Ids from AppsFlyer's SKAN partner CSV (Step 0 Z11);
// AttributionCopyEndpoint key from Apple's AdAttributionKit docs (Z11b). The
// mingla-business twin of this test is mingla-business/__tests__/skadnetwork.issue4238.test.ts.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../../", import.meta.url);
const plist = async (rel: string) =>
  JSON.parse(await Deno.readTextFile(new URL(rel, ROOT))).expo.ios.infoPlist;

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

Deno.test("#4238 W4-2 both apps carry the TikTok, Snap and Reddit SKAdNetwork ids, identically", async () => {
  const explorer = await plist("app-mobile/app.json");
  const host = await plist("mingla-business/app.json");
  const ids = (p) => p.SKAdNetworkItems.map((i) => i.SKAdNetworkIdentifier);
  assertEquals(ids(explorer), ids(host), "the two apps' lists must be equal");
  for (const id of REQUIRED) assert(ids(explorer).includes(id), `missing ${id}`);
  assert(!ids(explorer).includes("238da6jt44.skadnetwork"), "238da6jt44 is ByteDance China, not TikTok");
});

Deno.test("#4238 W4-2 both apps send AdAttributionKit postback copies to AppsFlyer", async () => {
  for (const rel of ["app-mobile/app.json", "mingla-business/app.json"]) {
    const p = await plist(rel);
    assertEquals(p.AttributionCopyEndpoint, ENDPOINT, `${rel} AttributionCopyEndpoint`);
    assertEquals(typeof p.AttributionCopyEndpoint, "string", "top-level String key, not a dict");
    assertEquals(p.NSAdvertisingAttributionReportEndpoint, ENDPOINT, `${rel} SKAN endpoint kept`);
  }
});
