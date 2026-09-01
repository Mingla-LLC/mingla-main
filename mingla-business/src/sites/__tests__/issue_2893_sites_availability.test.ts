import fs from "node:fs";
import path from "node:path";
import { loadBrandWebsiteEntryContext } from "../brandWebsiteEntry";
import { supabase } from "../../services/supabase";

jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

describe("#2893 Business Website availability projection", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns zero Website signal for every non-pilot brand", async () => {
    const invoke = supabase.functions.invoke as jest.Mock;
    invoke.mockResolvedValueOnce({
      data: { ok: true, data: { available: false } },
      error: null,
    });

    await expect(
      loadBrandWebsiteEntryContext("00000000-0000-4000-8000-000000000002"),
    ).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith("brand-site-control", {
      body: {
        route:
          "/v1/brands/00000000-0000-4000-8000-000000000002/site-availability",
        method: "GET",
      },
    });
  });

  it("keeps the compile-time switch broad and hides loading/error rows", () => {
    const profile = fs.readFileSync(
      path.resolve(__dirname, "../../components/brand/BrandProfileView.tsx"),
      "utf8",
    );
    const route = fs.readFileSync(
      path.resolve(__dirname, "../../../app/brand/[id]/website.tsx"),
      "utf8",
    );
    const flags = fs.readFileSync(
      path.resolve(__dirname, "../../config/featureFlags.ts"),
      "utf8",
    );

    expect(flags).toContain(
      "sites: readEnvFlag(process.env.EXPO_PUBLIC_FF_SITES_ENABLED, false)",
    );
    expect(profile).toContain("websiteContext !== null");
    expect(profile).not.toContain("Checking website status…");
    expect(profile).not.toContain("Status unavailable");
    expect(route).toContain("websiteAvailable === false");
    expect(route).toContain("websiteAvailable !== true");
  });
});
