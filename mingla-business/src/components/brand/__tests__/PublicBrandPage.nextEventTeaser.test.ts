/**
 * META-ORCH-0972 Sub-C — public brand upcoming teaser placement.
 *
 * The teaser now reflects the first chronological Upcoming row, regardless of
 * offering type.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("META-ORCH-0972 — NextEventTeaser placement", () => {
  const pageSrc = readFileSync(
    join(__dirname, "..", "PublicBrandPage.tsx"),
    "utf8",
  );
  const teaserSrc = readFileSync(
    join(__dirname, "..", "NextEventTeaser.tsx"),
    "utf8",
  );

  test("T-04a NextEventTeaser primitive is imported from its own file", () => {
    expect(pageSrc).toContain('import { NextEventTeaser as NextOfferingTeaser }');
    expect(teaserSrc).toContain("export const NextEventTeaser");
  });

  test("T-04b mount is guarded by chronological upcoming rows", () => {
    expect(pageSrc).toMatch(
      /\{\s*pagedUpcoming\.length\s*>\s*0\s*\?\s*\(\s*<NextOfferingTeaser/,
    );
  });

  test("T-04c teaser receives the first upcoming row", () => {
    expect(pageSrc).toMatch(
      /<NextOfferingTeaser\s+item=\{pagedUpcoming\[0\]\}\s+onPress=\{handleUpcomingPress\}/,
    );
  });

  test("T-04d teaser sits before the data-driven tab strip", () => {
    const socialsIdx = pageSrc.indexOf("<SocialLinksRow");
    const teaserIdx = pageSrc.indexOf("<NextOfferingTeaser");
    const tabsIdx = pageSrc.indexOf("{/* Tabs — META-ORCH-0972 data-driven labels. */}");
    expect(socialsIdx).toBeGreaterThan(-1);
    expect(teaserIdx).toBeGreaterThan(-1);
    expect(tabsIdx).toBeGreaterThan(-1);
    expect(teaserIdx).toBeGreaterThan(socialsIdx);
    expect(teaserIdx).toBeLessThan(tabsIdx);
  });

  test("T-04e stats card remains dropped", () => {
    expect(pageSrc).not.toMatch(/<GlassCard[^>]*style=\{styles\.statsCard\}/);
    expect(pageSrc).not.toMatch(/\sstatsCard:\s*\{/);
    expect(pageSrc).not.toMatch(/formatStatNumber\(/);
  });
});
