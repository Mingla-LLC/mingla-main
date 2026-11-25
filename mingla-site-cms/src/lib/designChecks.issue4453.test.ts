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

describe("#4453 a check never says \"block\" to the owner", () => {
  it("names the place as a section (the workspace's result card and Publish panel show these lines)", () => {
    const checks = runDesignChecks({
      pages: [{
        id: "p1", slug: "", title: "Home", enabled: true,
        blocks: [
          { blockType: "hero", heading: "", media: "m-1", ctas: [{ label: "Reserve your table for the whole family tonight", href: "/book" }], review: stamp },
          { blockType: "feature_cards", heading: "Why us", cards: [{ title: "The best arcade in town", body: "Lorem ipsum dolor sit amet" }], review: stamp },
          { blockType: "media_feature", heading: "Our room", media: "m-1", review: stamp },
        ],
      }],
      settings: { design: "pop" },
      navigation: { items: [] },
      media: [{ id: "m-1", width: 640, height: 480, alt: "" }],
      content: {},
      evidence: { offerings: [], brand_texts: ["Gameland Lagos"] },
      owner_texts: [],
    });
    const messages = checks.flatMap((check) => check.items.map((item) => item.message));
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join("\n")).toMatch(/section \d/);
    for (const message of messages) expect(message).not.toMatch(/\bblocks?\b/i);
  });
});

describe("#4572 link checks", () => {
  it("flags a button that links back to the page it is already on", () => {
    const checks = runDesignChecks({
      pages: [
        { id: "home", slug: "", title: "Home", enabled: true, blocks: [{ blockType: "cta", heading: "Welcome", label: "Home", href: "/" }] },
        { id: "about", slug: "about", title: "About", enabled: true, blocks: [{ blockType: "media_feature", heading: "Our story", cta_label: "Read this page", cta_href: "/about#top" }] },
      ],
      settings: { design: "atelier" }, navigation: { items: [] }, media: [], content: {},
      evidence: { offerings: [], brand_texts: [] }, owner_texts: [],
    });
    const links = checks.find((check) => check.key === "links")!;
    expect(links.status).toBe("warn");
    expect(links.items.map((item) => item.message).join("\n")).toContain("links back to the same page");
  });
});
