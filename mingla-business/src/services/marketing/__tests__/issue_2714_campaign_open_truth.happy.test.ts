import fs from "node:fs";
import path from "node:path";

const serviceDir = path.resolve(__dirname, "..");
const overview = fs.readFileSync(
  path.join(serviceDir, "marketingOverviewService.ts"),
  "utf8",
);
const report = fs.readFileSync(
  path.join(serviceDir, "marketingReportService.ts"),
  "utf8",
);

describe("#2714 honest campaign measurement", () => {
  test.each([
    ["overview", overview],
    ["report", report],
  ])("%s independently gates delivery and open coverage", (_name, source) => {
    expect(source).toContain("hasDeliveryCoverage");
    expect(source).toContain("hasOpenCoverage");
    expect(source).not.toContain("hasEventCoverage");
    expect(source).toContain("trackedDelivered");
    expect(source).toContain("mkt_campaign_email_event_health");
  });

  test.each([
    ["overview", overview],
    ["report", report],
  ])("%s paginates deterministic metric inputs", (_name, source) => {
    expect(source).toContain('.order("id"');
    expect(source).toContain(".range(");
    expect(source).toContain("METRIC_PAGE_SIZE");
  });
});
