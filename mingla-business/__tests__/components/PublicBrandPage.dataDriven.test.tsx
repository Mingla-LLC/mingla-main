import fs from "fs";
import path from "path";

// META-ORCH-0972 Sub-C SC-C-15 — ORIGINALLY asserted the inline business brand
// component built data-driven tabs. Those tab/pane symbols moved into the SHARED
// renderer (packages/brand-rendering/PublicBrandPage.tsx) during the adapter
// extraction, then ORCH-1155 redesigned that renderer onto the Direction-A shell.
// RELOCATED by ORCH-1155 [public-brand-page] (spec-owned, [TEST-MOD-APPROVED
// ORCH-1155]) to assert the SHARED package's current data-driven shape so the
// signal is real again (was 3/4-failing on origin/main against the moved
// symbols). The service assertions stay (the service still lives in business).
// fails-on-revert verified at 2aea165d5 (original META-ORCH-0972 anchor) — the
// relocated assertions below now track the shared renderer.

const sharedBrandPage = fs.readFileSync(
  path.join(
    process.cwd(),
    "..",
    "packages",
    "brand-rendering",
    "PublicBrandPage.tsx",
  ),
  "utf8",
);
const publicEventsService = fs.readFileSync(
  path.join(process.cwd(), "src/services/publicEventsService.ts"),
  "utf8",
);

describe("META-ORCH-0972 Sub-C / ORCH-1155 PublicBrandPage data-driven tabs (shared renderer)", () => {
  test("builds public tabs from offering data, not brand kind (About first)", () => {
    expect(sharedBrandPage).toContain('const tabs: Tab[] = ["about"];');
    expect(sharedBrandPage).toContain('tabs.push("upcoming")');
    expect(sharedBrandPage).toContain('tabs.push("events")');
    expect(sharedBrandPage).toContain('tabs.push("trips")');
    expect(sharedBrandPage).toContain('tabs.push("experiences")');
    expect(sharedBrandPage).not.toContain("isTripBrand");
    expect(sharedBrandPage).not.toContain("brand.kind");
  });

  test("renders the zero-offering brand without hiding identity/about (About default)", () => {
    // About is the default-selected tab and always present even with no offerings.
    expect(sharedBrandPage).toContain('useState<Tab>("about")');
    expect(sharedBrandPage).toContain("const AboutTab");
    expect(sharedBrandPage).toContain("EmptyPane");
  });

  test("has dedicated Events, Trips, Experiences, Upcoming, and About panes", () => {
    expect(sharedBrandPage).toContain("const UpcomingList");
    expect(sharedBrandPage).toContain("const EventList");
    expect(sharedBrandPage).toContain("const TripList");
    expect(sharedBrandPage).toContain("const ExperienceList");
    expect(sharedBrandPage).toContain("ExperienceMiniCard");
    expect(sharedBrandPage).toContain("NextOfferingTeaser");
  });

  test("public service fetches all offering buckets in parallel without kind branching", () => {
    expect(publicEventsService).toContain("fetchPublicBrandEvents(brandSlug)");
    expect(publicEventsService).toContain("fetchPublicBrandTrips(brandSlug)");
    expect(publicEventsService).toContain(
      "fetchPublicBrandExperiences(brandSlug)",
    );
    expect(publicEventsService).toContain("fetchPublicBrandUpcoming(brandSlug)");
    expect(publicEventsService).toContain("Promise.all");
    expect(publicEventsService).not.toContain("brandRow.kind");
    expect(publicEventsService).not.toContain("isTripPlanner");
  });
});
