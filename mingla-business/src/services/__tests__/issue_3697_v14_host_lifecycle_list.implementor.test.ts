import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("issue #3697 Host Ads lifecycle list", () => {
  const route = read("src/screens/hostAds/HostAdListScreen.tsx");
  const lifecycle = read("src/services/hostAdLifecycle.ts");
  const planService = read("src/services/hostAdPlanService.ts");
  const endpoint = read("../supabase/functions/host-ad-campaign/index.ts");


  it("includes the current user's active brand drafts", () => {
    expect(planService).toContain("export async function listHostAdWorkspace");
    expect(planService).toContain("include_drafts: true");
    expect(lifecycle).toContain("Continue draft");
    expect(lifecycle).toContain("?draft_id=${draft.id}");
  });


});
