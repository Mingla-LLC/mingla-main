/**
 * Issue #1365 happy-path regression: Brand Reservations → exact Venue →
 * venue-owned Menu / existing reservation engine.
 *
 * Fails on revert: deleting the Reservations tab, exact venue filter, public
 * venue route, or guest/native reservation handoff fails a separate assertion.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BUSINESS_ROOT = join(__dirname, "..", "..", "..", "..");
const REPO_ROOT = join(BUSINESS_ROOT, "..");
const readBusiness = (path: string): string =>
  readFileSync(join(BUSINESS_ROOT, path), "utf8");
const readRepo = (path: string): string =>
  readFileSync(join(REPO_ROOT, path), "utf8");

describe("issue #1365 Brand → venue reservation journey", () => {
  test("Brand owns Reservations navigation but no brand-level Menu tab", () => {
    const brandPage = readRepo("packages/brand-rendering/PublicBrandPage.tsx");
    expect(brandPage).toContain('tabs.push("reservations")');
    expect(brandPage).toContain('activeTab === "reservations"');
    expect(brandPage).not.toContain('tabs.push("menu")');
    expect(brandPage).not.toContain('activeTab === "menu"');
  });

  test("public menu read is scoped by both brand and exact venue slug", () => {
    const service = readBusiness("src/services/publicMenusService.ts");
    expect(service).toContain('.eq("brand_slug", brandSlug)');
    expect(service).toContain('.eq("venue_slug", venueSlug)');
  });

  test("database contract owns menus by venue and keeps ambiguous legacy rows private", () => {
    const migration = readRepo(
      "supabase/migrations/20270120001365_issue_1365_menu_venue_ownership.sql",
    );
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS venue_id uuid NULL");
    expect(migration).toContain("JOIN public.venue_listings v");
    expect(migration).toContain("v.id = m.venue_id");
    expect(migration).toContain("v.claim_status = 'verified'");
    expect(migration).toContain("menu_venue_required");
  });

  test("buyer-web and consumer app both mount the shared venue tabs", () => {
    const webPage = readBusiness("src/components/venue/PublicVenuePage.tsx");
    const nativePage = readRepo(
      "app-mobile/src/screens/ConsumerPublicVenueScreen.tsx",
    );
    expect(webPage).toContain("<PublicVenueTabs");
    expect(nativePage).toContain("<PublicVenueTabs");
    expect(webPage).toContain("<GuestVenueReservation");
    expect(nativePage).toContain("<VenueReserveSheet");
  });

  test("public reservation creation reuses the canonical venue edge function", () => {
    const service = readBusiness(
      "src/services/venueGuestReservationService.ts",
    );
    expect(service).toContain('"venue-reservation-create"');
    expect(service).toContain('"venue-reservation-confirm"');
    expect(service).toContain('surface: "web"');
  });
});
