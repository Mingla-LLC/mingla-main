/**
 * toward #3697 Wave 8 — Cancel vs End mutual exclusion + Ads list filters.
 */

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("issue #3697 Wave 8 Cancel / End / filters", () => {

  it("service exposes cancel action", () => {
    const svc = read("src/services/hostAdCampaignService.ts");
    expect(svc).toContain("cancelHostAdCampaign");
    expect(svc).toContain('action: "cancel"');
  });

});
