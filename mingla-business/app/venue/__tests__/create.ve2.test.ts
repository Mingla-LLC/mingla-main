import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const ROUTE = join(__dirname, "..", "create.tsx");
const DECK_READINESS_ROUTE = join(__dirname, "..", "deck-readiness.tsx");

describe("venue/create Ve2 routing", () => {
  test("skips reset when pool match param or placePoolId present", () => {
    const src = readFileSync(ROUTE, "utf8");
    expect(src).toContain('params.pool === "1"');
    expect(src).toContain("placePoolId");
    expect(src).toContain("PoolMatchCard");
    expect(src).toContain("poolMatches.map");
    expect(src).not.toContain("isn't available yet");
  });

  test("deck-readiness route resumes existing place context and pending AI outputs", () => {
    const src = readFileSync(DECK_READINESS_ROUTE, "utf8");
    expect(src).toContain("useBrandPlaceAuthoringContext");
    expect(src).toContain("brand_id");
    expect(src).toContain("place_pool_id");
    expect(src).toContain("initialPendingBio");
    expect(src).toContain("pending_ai_outputs?.generated_bio");
    expect(src).toContain("initialFacets");
    expect(src).toContain("pending_ai_outputs?.facets");
    expect(src).toContain("focus={focus}");
  });
});
