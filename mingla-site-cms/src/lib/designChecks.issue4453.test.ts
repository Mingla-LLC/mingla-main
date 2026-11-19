/*
 * #4453 — the publish truth check reads only the words a visitor sees. Found
 * live on Gameland Lagos (2026-11-18): every composed Draft block carries
 * Studio's hidden review stamp, whose ISO time ("2026-11-18T22:11:13.266Z")
 * was read as ~50 claims ('11', '13.266', '2026-11-18'...) on every block.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("./config", () => ({ cmsConfig: () => ({ approvedBucket: "approved", artifactBucket: "artifacts" }) }));
vi.mock("./objectStore", () => ({ presignedGet: vi.fn(), readObject: vi.fn(), writeObject: vi.fn() }));
vi.mock("./observability", () => ({ observeCmsEndpoint: (_p: string, _d: string, handler: unknown) => handler, emitCmsObservation: vi.fn() }));

import { runDesignChecks } from "./designChecks";

const stamp = { state: "draft", source: "composer", at: "2026-11-18T22:11:13.266Z", by: null };
const OFFERING = "0b0f6a52-7f3c-4c1e-9a55-2a8f8e6c1d10";

function truthOf(blocks: Record<string, unknown>[]) {
  const checks = runDesignChecks({
    pages: [{ id: "p1", slug: "", title: "Home", enabled: true, blocks }],
    settings: { design: "pop" },
    navigation: { items: [] },
    media: [],
    content: {},
    evidence: { offerings: [], brand_texts: ["Gameland Lagos"] },
    owner_texts: [],
  });
  return checks.find((check) => check.key === "truth")!;
}

describe("#4453 truth check skips machine fields", () => {
  it("a composed Home of Draft blocks (review stamp, ids, enums) has no claims", () => {
    const truth = truthOf([
      { id: "6740a1b2c3d4e5f600000011", blockType: "hero", variant: "pop-stack", blockName: "Hero 10", heading: "Play all night", media: "m-1", ctas: [{ label: "Book now", href: "/sessions" }], booking_bar: "experience", booking_target_id: OFFERING, review: stamp },
      { id: "6740a1b2c3d4e5f600000012", blockType: "offering_grid", variant: "cards", heading: "Experiences", kind: "experience", mode: "upcoming", offering_ids: [], limit: 3, review: stamp },
      { id: "6740a1b2c3d4e5f600000013", blockType: "availability", heading: "Times you can book", source: "experience_slots", offering_id: OFFERING, review: stamp },
      { id: "6740a1b2c3d4e5f600000014", blockType: "ticket_tiers", heading: "Tickets", offering_id: OFFERING, review: stamp },
    ]);
    expect(truth.items).toEqual([]);
    expect(truth.status).toBe("pass");
  });

  it("still flags a claim in a block's words (text fields, list rows and fields the catalogue does not name)", () => {
    const truth = truthOf([
      { blockType: "hero", heading: "The best arcade in town", media: "m-1", ctas: [], review: stamp },
      { blockType: "faq", heading: "Questions", items: [{ question: "How many games?", answer: "Over 500 games" }], review: stamp },
      { blockType: "hero", heading: "Play", media: "m-1", ctas: [], studio_only_line: "Open since 2009", review: stamp },
    ]);
    const messages = truth.items.map((item) => item.message).join("\n");
    expect(messages).toContain("'best'");
    expect(messages).toContain("'500 games'");
    expect(messages).toContain("'2009'");
    expect(messages).not.toMatch(/'(?:11|13\.266|2026-11-18|22)'/);
  });

  it("skips stored ids in list rows the catalogue does not name (Young and Stamped's Places grid)", () => {
    const truth = truthOf([
      { blockType: "destination_grid", heading: "Where we go", destinations: [
        { id: "6740a1b2c3d4e5f600000021", destination: "36353b6d-f0d6-4ba6-945b-f07816f3a2cf" },
        { id: "6740a1b2c3d4e5f600000022", destination: "ccdf3420-f7f9-4109-9756-23e94da1a552" },
      ], review: stamp },
    ]);
    expect(truth.items).toEqual([]);
    expect(truth.status).toBe("pass");
  });
});
