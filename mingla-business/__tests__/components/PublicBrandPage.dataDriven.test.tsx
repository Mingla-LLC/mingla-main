import fs from "fs";
import path from "path";

// META-ORCH-0972 Sub-C SC-C-15
// fails-on-revert verified at 2aea165d5

const publicBrandPage = fs.readFileSync(
  path.join(process.cwd(), "src/components/brand/PublicBrandPage.tsx"),
  "utf8",
);
const publicEventsService = fs.readFileSync(
  path.join(process.cwd(), "src/services/publicEventsService.ts"),
  "utf8",
);

describe("META-ORCH-0972 Sub-C PublicBrandPage data-driven tabs", () => {
  test("builds public tabs from offering data, not brand kind", () => {
    expect(publicBrandPage).toContain("const visibleTabs = useMemo<PublicTab[]>");
    expect(publicBrandPage).toContain('tabs.push("upcoming")');
    expect(publicBrandPage).toContain('tabs.push("events")');
    expect(publicBrandPage).toContain('tabs.push("trips")');
    expect(publicBrandPage).toContain('tabs.push("experiences")');
    expect(publicBrandPage).toContain('tabs.push("about")');
    expect(publicBrandPage).not.toContain("isTripBrand");
    expect(publicBrandPage).not.toContain("brand.kind");
  });

  test("renders the zero-offering brand empty state without hiding identity/about", () => {
    expect(publicBrandPage).toContain("const hasOfferings =");
    expect(publicBrandPage).toContain("More coming soon from this brand.");
    expect(publicBrandPage).toContain('useState<PublicTab>("about")');
  });

  test("has dedicated Events, Trips, Experiences, and Upcoming tab bodies", () => {
    expect(publicBrandPage).toContain("const UpcomingTab");
    expect(publicBrandPage).toContain("const EventsTab");
    expect(publicBrandPage).toContain("const TripsTab");
    expect(publicBrandPage).toContain("const ExperiencesTab");
    expect(publicBrandPage).toContain("<ExperienceMiniCard");
    expect(publicBrandPage).toContain("<NextOfferingTeaser");
  });

  test("public service fetches all offering buckets in parallel without kind branching", () => {
    expect(publicEventsService).toContain("fetchPublicBrandEvents(brandSlug)");
    expect(publicEventsService).toContain("fetchPublicBrandTrips(brandSlug)");
    expect(publicEventsService).toContain("fetchPublicBrandExperiences(brandSlug)");
    expect(publicEventsService).toContain("fetchPublicBrandUpcoming(brandSlug)");
    expect(publicEventsService).toContain("Promise.all");
    expect(publicEventsService).not.toContain("brandRow.kind");
    expect(publicEventsService).not.toContain("isTripPlanner");
  });
});
