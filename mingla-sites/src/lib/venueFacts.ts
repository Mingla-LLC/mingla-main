/*
 * #2830 — the hero's Visit / Hours / Contact strip is a VENUE's strip.
 *
 * It belongs on a site that sells a place: one whose pages carry venue facts
 * (opening hours and address, a table booking, a menu) or the pages Mingla
 * composes when the owner ticked a venue offering on the plan (Menu, Visit,
 * Rooms). A trips, events or experiences brand has none of those, and
 * printing "See restaurant details / See current opening hours / Contact the
 * restaurant" over its hero describes a business it is not.
 */
import { sitePages } from "./pageRouting";
import type { SiteArtifact } from "./siteArtifact";

const VENUE_FACT_BLOCKS: ReadonlySet<string> = new Set([
  "hours_location",
  "venue_reservation",
  "menu_link",
  "menu_board",
  "menu_preview",
]);

/** The addresses composeFromPlan gives the venue offering pages. */
const VENUE_PAGE_PATHS: ReadonlySet<string> = new Set(["menu", "visit", "rooms"]);

export function siteHasVenueFacts(artifact: SiteArtifact): boolean {
  return sitePages(artifact).some((page) =>
    page.enabled === true &&
    (VENUE_PAGE_PATHS.has(page.path) ||
      (page.blocks ?? []).some((block) => VENUE_FACT_BLOCKS.has(String(block.type))))
  );
}
