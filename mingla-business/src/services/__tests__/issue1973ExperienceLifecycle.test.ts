import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const business = join(__dirname, "..", "..", "..");

describe("#1973 Business experience lifecycle parity", () => {
  it("exposes guarded unpublish through one shared Expo route/service", () => {
    const service = readFileSync(
      join(business, "src/services/experienceDetailService.ts"),
      "utf8",
    );
    const route = readFileSync(
      join(business, "app/experience/[id]/index.tsx"),
      "utf8",
    );
    expect(service).toContain("unpublishExperienceToDraft");
    expect(service).toContain("business_unpublish_experience_to_draft");
    expect(service).toContain('graph.event.status !== "draft"');
    expect(route).toContain("experience-dashboard-unpublish-cta");
    expect(route).toContain("experience-dashboard-unpublish-dialog");
    expect(route).toContain("Its public dates and checkout will disappear");
    expect(route).toContain("await detailQuery.refetch()");
  });
});
