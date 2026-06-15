/**
 * ORCH-1040 — venue listing management surface + entry wiring (source-contract,
 * node/ts-jest harness has no RN renderer). Locks: the surface reads the right
 * data, renders the loop's previously-hidden surfaces (AI scores + changes
 * remaining + rejection message), reuses the deck-readiness wizard to edit, and
 * is reachable.
 *
 * [TEST-MOD-APPROVED ORCH-1145] — the venue-listing management UI MOVED from a
 * row on the brand profile page into a Hub "Venue" tab. The management body was
 * extracted into the shared `src/components/venue/VenueListingContent.tsx`, so
 * the data/scores/edit assertions now read that shared component. The
 * reachability assertion is re-pointed from the removed brand-page Operations
 * row (`label: "Venue listing"` / `onListing`) to the Hub-tab reachability:
 *   - the brand-page row + `onListing` prop are GONE (single doorway),
 *   - the new Hub tab renders `VenueListingContent`,
 *   - the standalone `/brand/{id}/listing` route is preserved as a redirect.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const here = (rel: string): string =>
  readFileSync(join(__dirname, rel), "utf8");
const biz = (rel: string): string =>
  readFileSync(join(__dirname, "../../../..", rel), "utf8");

// [TEST-MOD-APPROVED ORCH-1145] — management body extracted to the shared
// VenueListingContent component; the old `../listing.tsx` is now a redirect.
const CONTENT = biz("src/components/venue/VenueListingContent.tsx");
const REDIRECT = here("../listing.tsx");
const HUB_TAB = biz("app/(tabs)/hub/listing.tsx");
const PROFILE = biz("src/components/brand/BrandProfileView.tsx");

describe("ORCH-1040 listing management surface (ORCH-1145 relocation)", () => {
  test("reads pipeline state + authoring context for the brand's venue", () => {
    expect(CONTENT).toContain("useBrandPlacePipelineState(brandId)");
    expect(CONTENT).toContain("useBrandPlaceAuthoringContext(brandId, placePoolId)");
    expect(CONTENT).toContain("listingStatusView(");
  });

  test("surfaces the previously-hidden loop data: scores, changes-remaining, rejection", () => {
    expect(CONTENT).toContain("ai_signal_scores");
    expect(CONTENT).toContain("venueSignalLabel(");
    expect(CONTENT).toContain("recommend_edits_remaining");
    expect(CONTENT).toContain("rejectionReason");
  });

  test("edit reuses the deck-readiness wizard; public page only when live", () => {
    expect(CONTENT).toContain("/venue/deck-readiness?brand_id=");
    expect(CONTENT).toContain('claimStatus === "verified"'); // isLive gate
    expect(CONTENT).toContain("/b/${brand.slug}");
  });

  test("no-venue brand is guided to add a venue", () => {
    expect(CONTENT).toContain('router.push("/venue/create"');
  });

  // [TEST-MOD-APPROVED ORCH-1145] — re-pointed from the removed brand-page row.
  test("brand-page Venue listing row + onListing prop are REMOVED (single doorway)", () => {
    expect(PROFILE).not.toContain('label: "Venue listing"');
    expect(PROFILE).not.toContain("onListing");
  });

  // [TEST-MOD-APPROVED ORCH-1145] — reachable now via the Hub "Venue" tab.
  test("reachable via the Hub Venue tab rendering VenueListingContent", () => {
    expect(HUB_TAB).toContain("VenueListingContent");
    expect(HUB_TAB).toContain('chromeMode="tab"');
    expect(HUB_TAB).toContain("useCurrentBrand");
  });

  // [TEST-MOD-APPROVED ORCH-1145] — the standalone route is preserved (NOT 404).
  test("standalone /brand/[id]/listing route is preserved as a redirect to the Hub tab", () => {
    expect(REDIRECT).toContain("Redirect");
    expect(REDIRECT).toContain("/(tabs)/hub/listing");
  });
});
