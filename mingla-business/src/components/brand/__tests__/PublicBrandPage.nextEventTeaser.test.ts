/**
 * ORCH-0963 [Public brand page business-case optimization] T-04 happy-path.
 *
 * NextEventTeaser placement contract:
 *   - Renders ONLY when !isTripBrand AND upcomingEvents.length > 0
 *   - Sits BETWEEN the SocialLinksRow and the Tabs strip (above the bio is the
 *     prose goal; in DOM order between bio + socials and tabs, per SPEC §3.4)
 *   - NEVER renders for trip-planner brands
 *   - NEVER renders when upcomingEvents is empty
 *
 * Fails-on-revert: deleting the `{!isTripBrand && upcomingEvents.length > 0 ?`
 * guard or removing the <NextEventTeaser> mount FAILs the placement assertions.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

describe("ORCH-0963 T-04 — NextEventTeaser placement (event-brand polish)", () => {
  const pageSrc = readFileSync(
    join(__dirname, "..", "PublicBrandPage.tsx"),
    "utf8",
  );

  test("T-04a NextEventTeaser component is defined", () => {
    expect(pageSrc).toMatch(
      /const\s+NextEventTeaser:\s*React\.FC<NextEventTeaserProps>/,
    );
  });

  test("T-04b mount is guarded by !isTripBrand AND upcomingEvents.length > 0", () => {
    expect(pageSrc).toMatch(
      /\{\s*!isTripBrand\s*&&\s*upcomingEvents\.length\s*>\s*0\s*\?\s*\(\s*<NextEventTeaser/,
    );
  });

  test("T-04c NextEventTeaser receives the FIRST upcoming event (soonest)", () => {
    expect(pageSrc).toMatch(
      /<NextEventTeaser\s+event=\{upcomingEvents\[0\]\}\s+onPress=\{handleEventCardPress\}/,
    );
  });

  test("T-04d teaser DOM position: between socials/venueCard and tabs", () => {
    // Pin DOM order by index comparison.
    const socialsIdx = pageSrc.indexOf("<SocialLinksRow");
    const teaserIdx = pageSrc.search(/\{\s*!isTripBrand\s*&&\s*upcomingEvents\.length\s*>\s*0\s*\?\s*\(\s*<NextEventTeaser/);
    const tabsIdx = pageSrc.indexOf("{/* Tabs — ORCH-0963 kind-branched labels. */}");
    expect(socialsIdx).toBeGreaterThan(-1);
    expect(teaserIdx).toBeGreaterThan(-1);
    expect(tabsIdx).toBeGreaterThan(-1);
    expect(teaserIdx).toBeGreaterThan(socialsIdx);
    expect(teaserIdx).toBeLessThan(tabsIdx);
  });

  test("T-04e NextEventTeaser is NOT rendered inside the Trips tab body", () => {
    // Extract the UpcomingTripsTab block and assert no NextEventTeaser ref inside.
    const tripsTabBlock = pageSrc.match(
      /const\s+UpcomingTripsTab:[\s\S]*?\n\};/,
    );
    expect(tripsTabBlock).not.toBeNull();
    expect(tripsTabBlock![0]).not.toMatch(/NextEventTeaser/);
  });

  test("T-04f stats card is DROPPED (SC-12) — no statsCard reference left in JSX", () => {
    // SC-12: stats card removed for both kinds. Style def + JSX usage must
    // both be absent from active code (comments noting the removal are OK).
    expect(pageSrc).not.toMatch(/<GlassCard[^>]*style=\{styles\.statsCard\}/);
    expect(pageSrc).not.toMatch(/\sstatsCard:\s*\{/);
    expect(pageSrc).not.toMatch(/formatStatNumber\(/);
  });
});
