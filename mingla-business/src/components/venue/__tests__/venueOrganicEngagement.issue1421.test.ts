import fs from "node:fs";
import path from "node:path";

describe("#1421 truthful Overview contract", () => {
  const section = fs.readFileSync(
    path.resolve(__dirname, "../VenueOrganicEngagementSection.tsx"),
    "utf8",
  );
  const module = fs.readFileSync(
    path.resolve(__dirname, "../VenueIntelligenceModule.tsx"),
    "utf8",
  );

  it("removes every roadmap placeholder and keeps the three real cards", () => {
    expect(module).not.toMatch(/Coming soon|COMING SOON|Busy hours/);
    expect(section).toContain("Venue page activity");
    expect(section).toContain("When people browse online");
    expect(section).toContain("Organic reservation journey");
  });

  it("pins honest zero/config/partial/error/accessibility states", () => {
    for (const copy of [
      "No organic page activity yet",
      "No online browsing pattern yet",
      "Menu not published",
      "Reservations not enabled",
      "Tracking began",
      "Couldn&apos;t load organic engagement",
      "Organic engagement unavailable",
      'accessibilityLabel="Retry organic engagement"',
    ]) {
      expect(section).toContain(copy);
    }
  });

  it("pins all four neutral server dayparts and the no-footfall qualifier", () => {
    for (const label of ["Morning", "Afternoon", "Evening", "Late night"]) {
      expect(section).toContain(label);
    }
    expect(section).toContain(
      "Online venue-page views by time of day — not physical visits.",
    );
    expect(section).not.toMatch(/busiest|best time|foot traffic/i);
  });
});
