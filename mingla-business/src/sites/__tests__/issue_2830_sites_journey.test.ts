import { readFileSync } from "fs";
import path from "path";
import {
  DEFERRED_WEBSITE_STATES,
  deriveWebsiteJourneyState,
  type BrandSiteOverview,
} from "../contracts";
import { BRAND_ROLE_RANK } from "../../utils/brandRole";
import { MIN_RANK, canPerformAction } from "../../utils/permissionGates";

const site = (status: BrandSiteOverview["status"]): BrandSiteOverview => ({
  id: "00000000-0000-4000-8000-000000000001",
  brand_id: "00000000-0000-4000-8000-000000000002",
  renderer_key: "restaurant-website-v1",
  renderer_version: 1,
  status,
  active_publication_id:
    status === "published" ? "00000000-0000-4000-8000-000000000003" : null,
  last_successful_publication_id: null,
  provisioning_error_code: null,
  created_at: "2026-08-30T00:00:00.000Z",
  updated_at: "2026-08-30T00:00:00.000Z",
  brand_site_hosts: [],
});

describe("#2830 Business Website journey", () => {
  test("fails-on-revert: the monotonic rank floors are exact across all six roles", () => {
    expect(MIN_RANK.WEBSITE_WORKSPACE).toBe(20);
    expect(MIN_RANK.WEBSITE_PROVISION).toBe(50);
    for (const rank of [10, 19]) {
      expect(canPerformAction(rank, "WEBSITE_WORKSPACE")).toBe(false);
    }
    for (const role of [
      "marketing_manager",
      "finance_manager",
      "event_manager",
      "brand_admin",
      "brand_owner",
    ] as const) {
      expect(canPerformAction(BRAND_ROLE_RANK[role], "WEBSITE_WORKSPACE")).toBe(
        true,
      );
    }
    expect(canPerformAction(49, "WEBSITE_PROVISION")).toBe(false);
    expect(canPerformAction(50, "WEBSITE_PROVISION")).toBe(true);
  });

  test("maps Core truth to the approved overview/progress/live/failure states", () => {
    expect(deriveWebsiteJourneyState(null)).toBe(2);
    expect(deriveWebsiteJourneyState(site("provisioning"))).toBe(4);
    expect(deriveWebsiteJourneyState(site("draft"))).toBe(5);
    expect(deriveWebsiteJourneyState(site("publishing"))).toBe(14);
    expect(deriveWebsiteJourneyState(site("published"))).toBe(15);
    expect(deriveWebsiteJourneyState(site("error"))).toBe(28);
  });

  test("custom-domain states remain registered but have no Slice A route", () => {
    expect(DEFERRED_WEBSITE_STATES).toEqual([18, 19, 20, 21, 22, 31, 32, 33]);
    const routeRoot = path.join(process.cwd(), "app/brand/[id]");
    const website = readFileSync(path.join(routeRoot, "website.tsx"), "utf8");
    expect(website).not.toMatch(
      /connect domain|dns|txt ownership|detach domain/i,
    );
  });

  test("Website stays route-lazy and provider neutral", () => {
    const profile = readFileSync(
      path.join(process.cwd(), "src/components/brand/BrandProfileView.tsx"),
      "utf8",
    );
    const route = readFileSync(
      path.join(process.cwd(), "app/brand/[id]/website.tsx"),
      "utf8",
    );
    expect(profile).not.toMatch(/payload|sharp|storage-s3|db-postgres/i);
    expect(route).toContain("Mingla Studio");
    expect(route).not.toMatch(/payload|supabase|vercel|neon|s3/i);
  });
});
