/**
 * #4037 — bundle budget (#943): the traffic dashboard and its service load on
 * demand, never on the web boot path, and the on-demand load resolves to the
 * real dashboard component.
 *
 * Runs in the full-suite Jest config, which has no React renderer installed by
 * design, so this proof loads modules and reads sources rather than rendering.
 * The dashboard itself keeps its render proofs in jest.issue4037.render.cjs.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A stand-in for the real dashboard module (whose chart dependencies only load
// under the render config): the proof is that the lazy loader resolves to
// exactly the module's exported component.
const mockDashboard = (): null => null;
jest.mock("../TrafficAnalyticsDashboard", () => ({
  TrafficAnalyticsDashboard: mockDashboard,
}));

const read = (path: string): string =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("#4037 traffic dashboard stays off the web boot chunk", () => {
  it("the lazy loader resolves to the dashboard component on demand", async () => {
    const { importTrafficAnalyticsDashboard, TrafficAnalyticsDashboard } =
      require("../LazyTrafficAnalyticsDashboard") as typeof import("../LazyTrafficAnalyticsDashboard");
    const loaded = await importTrafficAnalyticsDashboard();
    expect(loaded.default).toBe(mockDashboard);
    // The wrapper keeps the dashboard's name so screens (and the #1403 pin)
    // render <TrafficAnalyticsDashboard …/> unchanged.
    expect(typeof TrafficAnalyticsDashboard).toBe("function");
  });

  it("no eager importer pulls in the dashboard or the traffic service", () => {
    const valueImport = (name: string) =>
      new RegExp(`^import\\s+(?!type\\b)[^;]*?from\\s+"[^"]*/${name}";`, "m");
    for (const path of [
      "src/components/analytics/BrandAnalyticsScreen.tsx",
      "src/components/analytics/ListingInsightsScreen.tsx",
      "src/components/analytics/LazyTrafficAnalyticsDashboard.tsx",
      "src/hooks/useTrafficAnalytics.ts",
      "src/components/home/AnalyticsHomeTile.tsx",
      "app/(tabs)/home.tsx",
      "app/(tabs)/analytics.tsx",
      "app/insights/[id].tsx",
    ]) {
      const source = read(path);
      expect([
        path,
        valueImport("TrafficAnalyticsDashboard").test(source),
      ]).toEqual([path, false]);
      expect([
        path,
        valueImport("trafficAnalyticsService").test(source),
      ]).toEqual([path, false]);
      expect([
        path,
        /require\("[^"]*TrafficAnalyticsDashboard"\)/.test(source),
      ]).toEqual([path, false]);
    }
    const dashboard = read(
      "src/components/analytics/TrafficAnalyticsDashboard.tsx",
    );
    expect(valueImport("trafficAnalyticsService").test(dashboard)).toBe(false);
    expect(
      read("src/components/analytics/LazyTrafficAnalyticsDashboard.tsx"),
    ).toContain('import("./TrafficAnalyticsDashboard")');
  });

  it("public pages load the traffic sender only on first use", () => {
    const emitter = read("src/services/offeringEngagementCapture.web.ts");
    expect(emitter).not.toMatch(/^import\s+(?!type\b)/m);
    expect(emitter).toContain('import("./offeringEngagementSend")');
  });
});
