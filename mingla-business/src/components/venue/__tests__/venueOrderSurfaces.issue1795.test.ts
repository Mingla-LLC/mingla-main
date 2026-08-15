import fs from "node:fs";
import path from "node:path";

const read = (relative: string): string =>
  fs.readFileSync(path.resolve(__dirname, relative), "utf8");

describe("#1795 venue-order Business surface wiring", () => {
  it("adds a distinct Overview card and direct Orders deep link without replacing Revenue", () => {
    const overview = read("../VenueIntelligenceModule.tsx");
    expect(overview).toContain('testID="venue-orders-overview-card"');
    expect(overview).toContain("Venue orders");
    expect(overview).toContain("module=insights&instrument=orders");
    expect(overview).toContain("Revenue");
    expect(overview).toContain("useVenueOrderMetrics(brandId, venueId, isAuthReady)");
    expect(overview).toContain("Offline — showing saved order numbers");
    expect(overview).toContain("Updating order numbers");
  });

  it("keeps one order-data owner across Overview, Insights and completeness to-dos", () => {
    const insights = read("../insights/VenueInsightsModule.tsx");
    const todos = read("../../../hooks/useBusinessTodos.ts");
    expect(insights).toContain("useVenueOrderMetrics(brandId, venueId, isAuthReady)");
    expect(insights).toContain("<OrderInsightsInstrument");
    expect(todos).toContain("useVenueOrderMetricsForVenues");
    expect(todos).toContain("metrics.orders30d === 0");
    expect(todos).toContain("!metrics.authorized");
    expect(todos).toContain("query.isError");
    expect(todos).toContain("?module=tables");
    expect(todos).toContain("?module=menu");
  });

  it("preserves the responsive and accessible Business iOS/Android/web seam", () => {
    const overview = read("../VenueIntelligenceModule.tsx");
    const insights = read("../insights/VenueInsightsModule.tsx");
    expect(overview).toContain('accessibilityLabel="See venue order insights"');
    expect(overview).toContain("minHeight: 44");
    expect(insights).toContain('accessibilityLabel="Open venue order insights"');
    expect(insights).toContain("instrumentPressable");
    expect(insights).not.toContain("pricingSeed");
  });
});
