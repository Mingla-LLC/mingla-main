/*
 * #4453 — Gameland Lagos's live publish (2026-11-18) failed four times with
 * only "Publishing failed": twice while Draft sections waited for review
 * (Studio: UNREVIEWED_SECTIONS), twice after "Mark all as reviewed" because
 * Publish still sent the Home revision it checked before the review saved a
 * new one (REVISION_CONFLICT). Core reports both as
 * PUBLISH_FAILED_LAST_GOOD_PRESERVED, so Host must prevent them: Publish
 * waits until nothing needs review, and marking reviewed re-runs the check
 * whose revision Publish sends. The top-bar button only opens Publish, so it
 * says so.
 */
import fs from "node:fs";
import path from "node:path";
import { unreviewedSectionCount } from "../setupStatus";

const read = (file: string) => fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8");

describe("#4453 Publish waits for review", () => {
  it("counts Draft sections on enabled pages only", () => {
    expect(unreviewedSectionCount(undefined)).toBe(0);
    expect(unreviewedSectionCount({ pages: [] })).toBe(0);
    expect(unreviewedSectionCount({ pages: [
      { enabled: true, count: 6 },
      { enabled: false, count: 3 },
      { enabled: true, count: 0 },
      { enabled: true, count: 1 },
    ] })).toBe(7);
  });

  it("keeps Publish off while sections need review, and says why", () => {
    const section = read("components/sites/website/sections/PublishSection.tsx");
    expect(section).toMatch(/const unreviewed = unreviewedSectionCount\(useReviewStatus\(site\.id\)\.data\);/);
    expect(section).toMatch(/const readyToPublish = [^;]*&& unreviewed === 0;/);
    expect(section).toContain('testID="publish-needs-review"');
  });

  it("re-runs the publish check after marking sections reviewed", () => {
    const api = read("sites/contentApi.ts");
    const markReviewed = api.slice(api.indexOf("export function useMarkReviewed"));
    expect(markReviewed.slice(0, 1200)).toContain('brandSiteKeys.siteData(siteId, "validation")');
  });

  it("labels the top-bar button by what it does (it opens Publish, it does not publish)", () => {
    const app = read("components/sites/website/WebsiteApp.tsx");
    expect(app).toMatch(/label="Review and publish"[^\n]*testID="topbar-publish"/);
    expect(app).toMatch(/label="Review and publish"[^\n]*testID="phone-status-publish"/);
    expect(app).not.toMatch(/label="Publish"[^\n]*testID="topbar-publish"/);
  });
});
