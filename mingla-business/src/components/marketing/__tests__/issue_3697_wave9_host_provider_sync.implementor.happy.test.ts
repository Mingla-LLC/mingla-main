/**
 * toward #3697 Wave 9 — Host Meta provider sync surface (creative id on Ari path).
 * Source contracts only — no RN imports.
 */

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("issue #3697 Wave 9 Host Meta provider sync", () => {
  it("Host Ads service still launches/pauses via host-ad-campaign", () => {
    const svc = read("src/services/hostAdCampaignService.ts");
    expect(svc).toContain('invoke("host-ad-campaign"');
    expect(svc).toContain('action: "launch"');
    expect(svc).toContain('action: "pause"');
  });

  it("edge Host create requires creative_library_id and Meta sync helpers", () => {
    // Repo root is one level above mingla-business.
    const host = fs.readFileSync(
      path.join(root, "../supabase/functions/host-ad-campaign/index.ts"),
      "utf8",
    );
    expect(host).toContain("createFullCampaignAtomic");
    expect(host).toContain("creative_library_id_required");
    expect(host).toContain("setCampaignTreeStatus");
    expect(host).toContain("launch_activate_fail_return:host:");
  });
});
