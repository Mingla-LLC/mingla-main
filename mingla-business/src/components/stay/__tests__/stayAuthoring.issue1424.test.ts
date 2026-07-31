import { readFileSync } from "fs";
import { join } from "path";

const read = (...parts: string[]): string =>
  readFileSync(join(__dirname, "..", "..", "..", ...parts), "utf8");

describe("Issue #1424 Stay business authoring", () => {
  test("the existing venue-create entry point exposes one canonical Stay category only behind the server flag", () => {
    const picker = read("components", "brand", "VenueCategoryPicker.tsx");
    const route = read("..", "app", "venue", "create.tsx");
    const claim = read("components", "venue", "claim", "ClaimStepCategory.tsx");

    expect(picker).toContain('id: "stay"');
    expect(picker).toContain('label: "Stay"');
    expect(picker).toContain("Hotels, resorts & short stays");
    expect(picker).not.toContain('id: "hotel"');
    expect(picker).not.toContain('id: "resort"');
    expect(route).toContain('useFeatureFlag("STAY_VENUE_AUTHORING")');
    expect(route).toContain("includeStay={stayAuthoringEnabled}");
    expect(route).toContain(
      '(venueCategory === "stay" && !stayAuthoringEnabled)',
    );
    expect(claim).toContain('useFeatureFlag("STAY_VENUE_AUTHORING")');
    expect(claim).toContain('draft.venueCategory === "stay"');
  });

  test("a Stay listing gets its own management shell while other venues keep the restaurant suite", () => {
    const route = read("..", "app", "venue", "[venueId]", "index.tsx");
    expect(route).toContain('venue.venueCategory === "stay"');
    expect(route).toContain("<StaySuiteShell");
    expect(route).toContain("<VenueSuiteShell");
    expect(route).toContain('venue.venueCategory !== "stay"');
  });

  test("the Stay overview contains every approved setup path and the connected-bank currency authority", () => {
    const shell = read("components", "stay", "StaySuiteShell.tsx");
    for (const label of [
      "Stay basics",
      "Amenities & accessibility",
      "Rooms & Places",
      "Availability & pricing",
      "Menus",
      "Bank & currency",
      "Venue review",
    ]) {
      expect(shell).toContain(label);
    }
    expect(shell).toContain("router.push(`/brand/${brandId}/payments`");
    expect(shell).toContain('currency.data?.authority === "settlement"');
    expect(shell).toContain("canAcceptPaidReservations");
    expect(shell).toContain("currency.data.currencyCode");
    expect(shell).not.toContain('currencyCode ?? "USD"');
    expect(shell).not.toMatch(/["'`]\$[0-9]/);
  });

  test("property settings capture the approved Stay fields and publish uses the dedicated action", () => {
    const shell = read("components", "stay", "StaySuiteShell.tsx");
    const service = read("services", "stayInventoryService.ts");
    for (const field of [
      "Property type",
      "Stay summary",
      "IANA timezone",
      "Check-in",
      "Check-out",
      "Default confirmation",
      "Property amenities",
      "Accessibility",
      "Arrival instructions",
      "House rules",
    ]) {
      expect(shell).toContain(field);
    }
    expect(shell).toContain("Instant");
    expect(shell).toContain("Request");
    expect(shell).toContain(
      'label={isActive ? "Stay is live" : "Publish Stay"}',
    );
    expect(service).toContain('action: "publish_stay"');
    expect(service).toContain('action: "save_settings"');
  });
});
