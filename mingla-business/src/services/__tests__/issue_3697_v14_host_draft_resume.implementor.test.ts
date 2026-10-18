import fs from "node:fs";
import path from "node:path";
import { randomUuid } from "../../utils/randomId";

const ROOT = path.resolve(__dirname, "../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("issue #3697 Host server draft resume", () => {
  const route = read("app/(tabs)/marketing/ads/create.tsx");
  const service = read("src/services/hostAdPlanService.ts");

  it("mints PostgreSQL-compatible draft UUIDs in every client runtime", () => {
    const ids = Array.from({ length: 20 }, () => randomUuid());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
  });

  it("uses a UUID deep link and restores the same Host draft", () => {
    expect(route).toContain("draft_id");
    expect(route).toContain("randomUuid()");
    expect(route).toMatch(
      /getHostAdDraft\(draftIdRef\.current(?:\s+as\s+string)?\)/,
    );
    expect(route).toContain("setCities(state.cities");
    expect(route).toContain("setInterests(state.interests");
    expect(route).toContain("setExistingPlanId(draft.plan_id)");
  });

  it("autosaves through the shared ad-plan engine after one second", () => {
    expect(route).toContain("saveHostAdDraft");
    expect(route).toMatch(/setTimeout\(\(\) => \{\s*void persistDraft\(\);\s*\}, 1000\)/);
    expect(service).toContain('action: "save_draft"');
    expect(service).toContain('action: "get_draft"');
    expect(service).toContain("expected_revision: input.expectedRevision");
    expect(route).toContain("Saved to Mingla");
  });

  it("never persists typed LAUNCH authority", () => {
    const snapshot = route.slice(
      route.indexOf("const draftSnapshot"),
      route.indexOf("const persistDraft"),
    );
    expect(snapshot).toContain("Typed LAUNCH is fresh authorization");
    expect(snapshot).not.toContain("launchPhrase");
  });
});
