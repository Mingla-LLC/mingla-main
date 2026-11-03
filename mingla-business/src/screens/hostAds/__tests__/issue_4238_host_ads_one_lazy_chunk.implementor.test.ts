/**
 * #4238 — Host Ads stays out of the boot payload.
 *
 * Metro (web async routes) hoists every module that two lazy chunks share into
 * the eager `__common` chunk. When the Ads list, builder and detail routes, the
 * plan service and Ari's ad card each imported the Host ad words, money format,
 * lifecycle and builder rules, about 23 KB moved into `__common`
 * (bundle-baseline-movement and the initial-bundle budget went red). These pins
 * keep the one-lazy-chunk shape that fixed it.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");

const ROUTES: Record<string, string> = {
  "app/(tabs)/marketing/ads/index.tsx": "HostAdListScreen",
  "app/(tabs)/marketing/ads/create.tsx": "HostAdCreateScreen",
  "app/(tabs)/marketing/ads/[id].tsx": "HostAdDetailScreen",
};

const importsOf = (source: string): string[] =>
  [...source.matchAll(/(?:from|import\()\s*"([^"]+)"/g)].map((match) => match[1]);

describe("#4238 Host Ads load as one lazy chunk", () => {
  it.each(Object.entries(ROUTES))("%s only lazy-loads its screen from HostAdScreens", (route, screen) => {
    const source = read(route);
    expect(source).toContain('import("../../../../src/screens/hostAds/HostAdScreens")).' + screen);
    expect(source).toContain("React.lazy(");
    const others = importsOf(source).filter(
      (specifier) => specifier !== "../../../../src/screens/hostAds/HostAdScreens",
    );
    expect(others).toEqual(["react", "react-native", "../../../../src/constants/designSystem"]);
  });

  it("HostAdScreens holds the three screens and the plan service", () => {
    const barrel = read("src/screens/hostAds/HostAdScreens.ts");
    for (const screen of Object.values(ROUTES)) {
      expect(barrel).toContain(`export { default as ${screen} } from "./${screen}";`);
    }
    expect(barrel).toContain('export * from "../../services/hostAdPlanService";');
  });

  it("the plan service loader opens the same chunk, and the screens never loop back through it", () => {
    expect(read("src/services/lazyHostAdPlanService.ts")).toContain(
      'import("../screens/hostAds/HostAdScreens")',
    );
    for (const file of [
      "src/screens/hostAds/HostAdCreateScreen.tsx",
      "src/screens/hostAds/HostAdListScreen.tsx",
      "src/screens/hostAds/HostAdDetailScreen.tsx",
      "src/hooks/marketing/useHostAdPlans.ts",
    ]) {
      expect(read(file)).not.toContain("lazyHostAdPlanService");
    }
  });

  it("Ari's ad card and the design system do not pull Host Ads modules into the boot chunk", () => {
    const card = read("src/components/ari/ToolProposalCard.tsx");
    expect(card).not.toContain("marketing/ads/hostAdCopy");
    expect(card).toContain('import { adPlatformName } from "../../utils/adVideoFit";');
    expect(read("src/constants/designSystem.ts")).not.toContain("hostAdCharts");
    expect(read("src/components/marketing/ads/results/hostAdChartColors.ts")).toContain(
      "export const hostAdCharts",
    );
  });
});
