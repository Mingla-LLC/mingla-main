import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "../../..");
const read = (relativePath: string): string =>
  readFileSync(join(ROOT, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("#3176 Host public search measurement", () => {
  const web = read("src/analytics/webAnalytics.web.ts");
  const layout = read("app/_layout.tsx");

  it("disables query-bearing automatic page lifecycle events in both web sinks", () => {
    expect(web).toMatch(/capture_pageview:\s*false/);
    expect(web).toMatch(/capture_pageleave:\s*false/);
    expect(web).toMatch(/gtag\("config",\s*measurementId,\s*\{\s*send_page_view:\s*false\s*\}\)/);
    expect(web).not.toContain('posthog.capture("$pageview")');
  });

  it("routes public inventory pageviews through the fail-closed shared sanitizer", () => {
    expect(web).toContain("sanitizeSearchMeasurement(event, properties)");
    expect(web).toContain('captureWebSearchOutcome("page_view"');
    expect(web).toContain("cleanPageLocation(");
    expect(web).toContain("cleanReferrerOrigin(");
    expect(web).toContain('page_family: "public_inventory"');
  });

  it("measures each public route after consent-aware initialization", () => {
    expect(layout).toContain("captureHostPublicSearchPageView(pathname)");
    expect(layout).toMatch(/initWebAnalytics\(\)\.then\(\(\)\s*=>/);
    expect(web).toContain("captureHostPublicSearchPageView(window.location.pathname)");
  });
});
