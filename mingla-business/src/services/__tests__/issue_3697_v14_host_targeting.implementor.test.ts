import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("issue #3697 Host provider targeting parity", () => {
  const service = read("src/services/hostAdPlanService.ts");
  const create = read("app/(tabs)/marketing/ads/create.tsx");
  const search = read(
    "../supabase/functions/admin-ad-targeting-search/index.ts",
  );

  it("uses the permission-scoped business-lane taxonomy search", () => {
    expect(service).toContain("export async function searchHostAdTargeting");
    expect(service).toContain('lane: "business"');
    expect(service).toContain('owner_kind: "host"');
    expect(search).toContain("ad_can_host_action");
    expect(search).toContain('p_action: "plan"');
    expect(search).toContain('requestedLane !== "business"');
  });

  it("freezes city, radius and logical interest references per platform", () => {
    expect(service).toContain("input.cities.map");
    expect(service).toContain("input.radiusKm");
    expect(service).toContain("input.interests.map");
    expect(service).toContain("refs_by_platform: refsByPlatform");
    expect(create).toContain("Search resolves provider-native city IDs");
    expect(create).toContain("Missing mappings block the plan");
    expect(create).toContain("handleCitySearch");
    expect(create).toContain("handleInterestSearch");
  });

  it("validates and executes from each frozen compiled snapshot", () => {
    expect(service).toContain("hostExecutionTargeting(snapshot)");
    expect(service).toContain("compiled.geo_locations");
    expect(service).toContain("compiled.location_ids");
    expect(service).toContain("compiled.geo_circles");
    expect(service).toContain("compiled.audience_ids");
    expect(service).toContain("compiled.interests");
    expect(service).toContain("hostTargetingSelectionsFromAggregate");
  });
});
