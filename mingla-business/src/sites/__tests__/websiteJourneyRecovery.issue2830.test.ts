import fs from "node:fs";
import path from "node:path";
import type { BrandSiteOverview } from "../contracts";
import {
  deriveBusinessWebsiteState,
  WEBSITE_JOURNEY,
} from "../websiteJourney";
import { loadBrandWebsiteEntryContext } from "../brandWebsiteEntry";
import { supabase } from "../../services/supabase";

jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const executable = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 23, 24,
  25, 26, 27, 28, 29, 30,
] as const;

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
  created_at: "2026-08-30T12:00:00Z",
  updated_at: "2026-08-30T12:00:00Z",
  brand_site_hosts: [],
});

const derive = (
  overrides: Partial<Parameters<typeof deriveBusinessWebsiteState>[0]> = {},
) => deriveBusinessWebsiteState({
  site: site("draft"),
  panel: "overview",
  operation: null,
  operationPending: false,
  isOpeningStudio: false,
  isPreviewing: false,
  studioReturnResult: null,
  ...overrides,
});

describe("#2830 explicit Website journey owner", () => {
  it("owns every approved executable state with an action and recovery contract", () => {
    expect(Object.keys(WEBSITE_JOURNEY).map(Number).sort((a, b) => a - b)).toEqual(
      [...executable],
    );
    for (const state of executable) {
      expect(WEBSITE_JOURNEY[state].title.length).toBeGreaterThan(2);
      expect(WEBSITE_JOURNEY[state].recovery.length).toBeGreaterThan(10);
    }
  });

  it("distinguishes setup, review, secure handoff, preview, publication, history and failures", () => {
    expect(derive({ site: null })).toBe(2);
    expect(derive({ site: null, panel: "setup_review" })).toBe(3);
    expect(derive({ site: site("provisioning") })).toBe(4);
    expect(derive({ isOpeningStudio: true })).toBe(6);
    expect(derive({ isPreviewing: true })).toBe(12);
    expect(derive({ panel: "publish_review" })).toBe(13);
    expect(derive({ operationPending: true })).toBe(14);
    expect(derive({ site: site("published") })).toBe(15);
    expect(derive({ panel: "address" })).toBe(17);
    expect(derive({ panel: "analytics" })).toBe(23);
    expect(derive({ panel: "versions" })).toBe(24);
    expect(derive({ panel: "rollback_review" })).toBe(25);
    expect(derive({ site: site("error") })).toBe(28);
    expect(derive({ studioReturnResult: "preview_expired" })).toBe(30);
  });

  it("keeps the lazy Brand Profile entry customer-safe and status-aware", async () => {
    const invoke = supabase.functions.invoke as jest.Mock;
    for (const [status, expected] of [
      ["provisioning", "Setting up…"],
      ["publishing", "Publishing…"],
      ["error", "Publish needs attention"],
    ]) {
      invoke.mockResolvedValueOnce({
        data: { ok: true, data: site(status as BrandSiteOverview["status"]) },
        error: null,
      });
      await expect(
        loadBrandWebsiteEntryContext(site("draft").brand_id),
      ).resolves.toBe(expected);
    }
    invoke.mockResolvedValueOnce({
      data: { ok: false, error: { code: "NOT_FOUND" } },
      error: null,
    });
    await expect(
      loadBrandWebsiteEntryContext(site("draft").brand_id),
    ).resolves.toBe("Not set up");
  });

  it("fails when internal state numbers leak into customer UI", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../components/sites/BrandWebsiteView.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/Journey state|rank\s*[-:=]\s*10/i);
    expect(source).toContain("website-publication-running");
    expect(source).toContain("website-publication-failed");
    expect(source).toContain("website-session-expired");
  });
});
