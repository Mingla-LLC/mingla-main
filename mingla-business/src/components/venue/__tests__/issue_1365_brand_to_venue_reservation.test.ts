/**
 * Issue #1365 happy-path regression: Brand Reservations → exact Venue →
 * venue-owned Menu / existing reservation engine.
 *
 * Fails on revert: deleting the Reservations tab, exact venue filter, public
 * venue route, or guest/native reservation handoff fails a separate assertion.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isPublicBuyerRoute } from "../../../utils/coldLoadAuthGates";

const BUSINESS_ROOT = join(__dirname, "..", "..", "..", "..");
const REPO_ROOT = join(BUSINESS_ROOT, "..");
const readBusiness = (path: string): string =>
  readFileSync(join(BUSINESS_ROOT, path), "utf8");
const readRepo = (path: string): string =>
  readFileSync(join(REPO_ROOT, path), "utf8");

describe("issue #1365 Brand → venue reservation journey", () => {
  test("reservation return routes execute as public segment-safe paths", async () => {
    const allowed = await Promise.resolve(
      isPublicBuyerRoute("/reserve/brand-1/confirm"),
    );
    expect(allowed).toBe(true);
    expect(isPublicBuyerRoute("/reserved/brand-1/confirm")).toBe(false);
  });

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
      "supabase/migrations/20270122001365_issue_1365_menu_venue_ownership.sql",
    );
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS venue_id uuid NULL");
    expect(migration).toContain("JOIN public.venue_listings v");
    expect(migration).toContain("v.id = m.venue_id");
    expect(migration).toContain("v.claim_status = 'verified'");
    expect(migration).toContain("[TRANSITIONAL]");
    expect(migration).toContain("IF v_verified_count = 1 THEN");
    expect(migration).toContain("ELSIF v_total_count = 1 THEN");
    expect(migration).toContain("menu_venue_required");
    expect(migration).toContain("menu_venue_ambiguous");
  });

  test("buyer-web and consumer app both mount the shared venue tabs", () => {
    // [TEST-MOD-APPROVED #1559] — the buyer-web venue BODY moved to
// `packages/brand-rendering/PublicVenueScreen.tsx` (a pure move: render parity
// proven by publicVenueRenderParity.issue1559.happy.test.tsx). These assertions
// follow the code; the contract each one pins is unchanged.
    const webPage = readRepo("packages/brand-rendering/PublicVenueScreen.tsx");
    const webRoute = readBusiness("app/b/[brandSlug]/v/[venueSlug].tsx");
    const nativePage = readRepo(
      "app-mobile/src/screens/ConsumerPublicVenueScreen.tsx",
    );
    expect(webPage).toContain("<PublicVenueTabs");
    expect(nativePage).toContain("<PublicVenueTabs");
    expect(webRoute).toContain("<GuestVenueReservation");
    expect(nativePage).toContain("<VenueReserveSheet");
  });

  test("consumer venue failures stay isolated and expose retry/progressive state", () => {
    const hook = readRepo("app-mobile/src/hooks/useBrandBySlug.ts");
    const screen = readRepo(
      "app-mobile/src/screens/ConsumerBrandProfileScreen.tsx",
    );
    expect(hook).toContain("usePublicBrandVenues");
    expect(hook).toContain("useQueries");
    expect(screen).toContain("venuesLoadState=");
    expect(screen).toContain("onRetryVenues:");
    expect(screen).toContain("venuesQuery.data ?? []");
  });

  test("buyer-web venue cards also render before reservability settles", () => {
    const service = readBusiness("src/services/publicEventsService.ts");
    const hook = readBusiness("src/hooks/usePublicEvents.ts");
    const route = readBusiness("app/b/[brandSlug]/index.tsx");
    expect(service).toContain(
      'row.place_pool_id === null ? "unavailable" : "loading"',
    );
    expect(hook).toContain("useQueries");
    expect(hook).toContain('?? "loading"');
    expect(route).toContain(
      "brandVenuesQuery.isLoading || brandVenuesQuery.isFetching",
    );
  });

  test("guest phone input is shared and submits only composed E.164", () => {
    const guest = readBusiness(
      "src/components/venue/GuestVenueReservation.tsx",
    );
    expect(guest).toContain("<PhoneInput");
    expect(guest).toContain("composeE164(phoneDialCode, phoneLocal)");
    expect(guest).toContain("phone: normalizedPhone");
    expect(guest).not.toContain("phone: phone.trim()");
    expect(guest).toContain("Enter a valid phone number.");
  });

  test("native reservation analytics use the callback seam without PII", () => {
    const sheet = readRepo(
      "app-mobile/src/components/expandedCard/VenueReserveSheet.tsx",
    );
    const screen = readRepo(
      "app-mobile/src/screens/ConsumerPublicVenueScreen.tsx",
    );
    expect(sheet).toContain("onAvailabilityResultViewed?.()");
    expect(sheet).toContain("onSlotSelected?.()");
    expect(sheet).toContain("onReservationFailed?.");
    expect(screen).not.toContain("public_venue_reservations_viewed");
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
