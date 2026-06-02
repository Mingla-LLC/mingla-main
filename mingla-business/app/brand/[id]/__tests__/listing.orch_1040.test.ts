/**
 * ORCH-1040 — venue listing management page + entry wiring (source-contract,
 * node/ts-jest harness has no RN renderer). Locks: the page reads the right
 * data, renders the loop's previously-hidden surfaces (AI scores + changes
 * remaining + rejection message), reuses the deck-readiness wizard to edit, and
 * is reachable from the brand profile.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const here = (rel: string): string =>
  readFileSync(join(__dirname, rel), "utf8");
const biz = (rel: string): string =>
  readFileSync(join(__dirname, "../../../..", rel), "utf8");

const PAGE = here("../listing.tsx");
const ROUTE = here("../index.tsx");
const PROFILE = biz("src/components/brand/BrandProfileView.tsx");

describe("ORCH-1040 listing management page", () => {
  test("reads pipeline state + authoring context for the brand's venue", () => {
    expect(PAGE).toContain("useBrandPlacePipelineState(brandId)");
    expect(PAGE).toContain("useBrandPlaceAuthoringContext(brandId, placePoolId)");
    expect(PAGE).toContain("listingStatusView(");
  });

  test("surfaces the previously-hidden loop data: scores, changes-remaining, rejection", () => {
    expect(PAGE).toContain("ai_signal_scores");
    expect(PAGE).toContain("venueSignalLabel(");
    expect(PAGE).toContain("recommend_edits_remaining");
    expect(PAGE).toContain("rejectionReason");
  });

  test("edit reuses the deck-readiness wizard; public page only when live", () => {
    expect(PAGE).toContain("/venue/deck-readiness?brand_id=");
    expect(PAGE).toContain('claimStatus === "verified"'); // isLive gate
    expect(PAGE).toContain("/b/${brand.slug}");
  });

  test("no-venue brand is guided to add a venue", () => {
    expect(PAGE).toContain('router.push("/venue/create"');
  });

  test("reachable from the brand profile via onListing → /brand/{id}/listing", () => {
    expect(PROFILE).toContain('label: "Venue listing"');
    expect(PROFILE).toContain("onListing(brand.id)");
    expect(ROUTE).toContain("/brand/${brandId}/listing");
    expect(ROUTE).toContain("onListing={handleOpenListing}");
  });
});
