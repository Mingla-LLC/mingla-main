// MINGLA-INVARIANT: I-4238-SKAN-IDS | issue #4238 | both iOS apps declare the same SKAdNetwork roster, including TikTok global (mj797d8u6f, 22mmun2rn5), Snap (424m5254lk) and Reddit (2tdux39lx8) and never ByteDance China's 238da6jt44, and both set the top-level AttributionCopyEndpoint to AppsFlyer.
/**
 * #4238 W4-2 (D23). Ids from AppsFlyer's SKAN partner CSV (Step 0 Z11);
 * AttributionCopyEndpoint from Apple's AdAttributionKit docs (Z11b). Takes
 * effect only in a store build Seth approves (native Info.plist, not OTA).
 *
 * Behavioural: for each app this runs the same pipeline `expo prebuild` runs to
 * produce the iOS Info.plist. It evaluates the app's real `app.config.js` over
 * its `app.json` (no EAS profile, as a local build), compiles the iOS base mods
 * in introspection mode (Expo's `infoPlist` provider merges `ios.infoPlist` into
 * the Info.plist template), then writes that object as Info.plist XML with
 * Expo's own plist writer and parses the XML back. The assertions are on what
 * the shipped Info.plist would contain, not on app.json text.
 */
import path from "node:path";

import { describe, expect, test } from "@jest/globals";

type InfoPlist = Record<string, unknown>;
type ConfigFn = (ctx: { config: Record<string, unknown> }) => Record<string, unknown>;

const REPO = path.resolve(__dirname, "..", "..");

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

async function builtInfoPlist(app: "mingla-business" | "app-mobile"): Promise<InfoPlist> {
  const projectRoot = path.join(REPO, app);
  const { compileModsAsync } = await import("@expo/config-plugins");
  const plist = (await import("@expo/plist")).default;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const appJson = require(path.join(projectRoot, "app.json")) as { expo: Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const configFn = require(path.join(projectRoot, "app.config.js")) as ConfigFn;
  const savedProfile = process.env.EAS_BUILD_PROFILE;
  delete process.env.EAS_BUILD_PROFILE;
  try {
    const resolved = configFn({ config: JSON.parse(JSON.stringify(appJson.expo)) });
    const compiled = (await compileModsAsync(resolved as never, {
      projectRoot,
      platforms: ["ios"],
      introspect: true,
      assertMissingModProviders: false,
    })) as { ios?: { infoPlist?: InfoPlist } };
    const infoPlist = compiled.ios?.infoPlist;
    if (infoPlist === undefined) throw new Error(`${app}: no ios.infoPlist after compile`);
    return plist.parse(plist.build(infoPlist)) as InfoPlist;
  } finally {
    if (savedProfile !== undefined) process.env.EAS_BUILD_PROFILE = savedProfile;
  }
}

const skanIds = (p: InfoPlist): string[] =>
  (p.SKAdNetworkItems as { SKAdNetworkIdentifier: string }[]).map(
    (i) => i.SKAdNetworkIdentifier,
  );

describe("#4238 W4-2 SKAdNetwork roster and AdAttributionKit endpoint in the built Info.plist", () => {
  test("both apps build the same roster with TikTok global, Snap and Reddit, never ByteDance China", async () => {
    const host = await builtInfoPlist("mingla-business");
    const explorer = await builtInfoPlist("app-mobile");
    expect(skanIds(host)).toEqual(skanIds(explorer));
    for (const id of REQUIRED) expect(skanIds(host)).toContain(id);
    expect(skanIds(host)).not.toContain("238da6jt44.skadnetwork");
    expect(new Set(skanIds(host)).size).toBe(skanIds(host).length);
  });

  test("both apps build a top-level string AttributionCopyEndpoint (and the SKAN report endpoint) for AppsFlyer", async () => {
    for (const app of ["mingla-business", "app-mobile"] as const) {
      const p = await builtInfoPlist(app);
      expect(p.AttributionCopyEndpoint).toBe(ENDPOINT);
      expect(p.NSAdvertisingAttributionReportEndpoint).toBe(ENDPOINT);
    }
  });
});
