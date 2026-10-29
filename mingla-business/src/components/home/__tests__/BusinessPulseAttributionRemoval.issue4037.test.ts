import fs from "node:fs";
import path from "node:path";

const read = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("#4037 Home Pulse attribution correction", () => {
  it("keeps lifetime revenue authoritative and does not fetch an all-time traffic summary", () => {
    const source = read("src/components/home/BusinessPulsePanel.tsx");
    expect(source).toContain("TOTAL LIFETIME REVENUE");
    expect(source).not.toContain('useBrandTrafficRollup(brandId, "all"');
    expect(source).not.toContain("came through Mingla");
    expect(source).not.toContain("valueMinglaBrought");
  });

  it("keeps both traffic authorities fresh when Home refreshes", () => {
    const source = read("app/(tabs)/home.tsx");
    expect(source).toContain(
      'trafficAnalyticsKeys.brand(currentBrand.id, "30d")',
    );
    expect(source).toContain(
      'trafficAnalyticsKeys.brand(currentBrand.id, "all")',
    );
  });
});
