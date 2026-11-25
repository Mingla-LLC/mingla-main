// @ts-nocheck — executable contract tests; RN network imports are mocked.
/**
 * #4490 Explorer W6b fix 3 (#2774 lane): a venue-type chip change refetches the
 * solo deck exactly as a category change does, and a venue-type-only deck with
 * nothing open ends in the empty state (never an endless loader).
 *
 *   K-*  the solo deck key carries `venue_type:*` as given: adding, removing or
 *        swapping a chip gives a new key (React Query fetches on a new key);
 *        the same set in another order is the same key;
 *   C-*  the chain from the saved row to that key keeps the chip:
 *        normalizeCategoryArray (stableDeckParams + the save), the deck-history
 *        hash, and the context passing those categories to the solo hook;
 *   E-*  fetchDeck sends the chip unchanged and turns the server's zero-card
 *        answer for it into hasMore:false (the input of the EMPTY branch,
 *        `isDeckBatchLoaded && !deckHasMore`), like an ordinary category.
 *
 * FAILS-ON-REVERT: filter categories to the known slugs before the key -> K-1/K-2;
 * drop the venue_type branch in normalizeCategoryArray -> C-1; send chips through
 * the display-name map / curated filters -> E-1.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

jest.mock("../../services/supabase", () => ({
  supabase: {},
  trackedInvoke: jest.fn(),
}));
jest.mock("../../services/curatedExperiencesService", () => ({
  curatedExperiencesService: {
    generateCuratedExperiences: jest.fn(async () => ({ cards: [] })),
  },
}));
jest.mock("../../config/featureFlags", () => ({
  FEATURE_FLAG_PROGRESSIVE_DELIVERY: false,
}));

import { DeckService } from "../../services/deckService";
import { buildSoloDeckQueryPlan } from "../useDeckCards";
import { normalizeCategoryArray } from "../../utils/categoryUtils";
import { computePrefsHash } from "../../utils/cardConverters";

(global as { __DEV__?: boolean }).__DEV__ = false;

const plan = (categories: string[]) =>
  buildSoloDeckQueryPlan({
    mode: "solo",
    location: { lat: 6.5, lng: 3.4 },
    categories,
    intents: [],
    travelMode: "driving",
    travelConstraintType: "time",
    travelConstraintValue: 60,
    dateOption: "today",
    batchSeed: 0,
    displayCurrency: "USD",
  });
const keyOf = (categories: string[]) => JSON.stringify(plan(categories).queryKey);

describe("#4490 W6b fix 3: a venue-type chip change refetches the deck", () => {
  it("K-1 adding or removing a venue-type chip changes the solo deck key", () => {
    const base = keyOf(["play", "icebreakers"]);
    const withClub = keyOf(["play", "icebreakers", "venue_type:club"]);
    expect(withClub).not.toBe(base);
    expect(withClub).toContain("venue_type:club");
    expect(keyOf(["play", "icebreakers"])).toBe(base);
  });

  it("K-2 swapping one chip for another, or a chip-only deck, is a new key; order does not matter", () => {
    const club = keyOf(["play", "venue_type:club"]);
    expect(keyOf(["play", "venue_type:restaurant"])).not.toBe(club);
    expect(keyOf(["venue_type:club"])).not.toBe(keyOf(["venue_type:restaurant"]));
    expect(keyOf(["venue_type:club", "play"])).toBe(club);
  });

  it("C-1 the saved categories keep the chip, so the key and the deck-history hash both move", () => {
    const saved = normalizeCategoryArray(["play", "icebreakers", "venue_type:club"]);
    expect(saved).toEqual(["play", "icebreakers", "venue_type:club"]);
    const before = computePrefsHash({ categories: ["play", "icebreakers"], intents: [] });
    const after = computePrefsHash({ categories: saved, intents: [] });
    expect(after).not.toBe(before);
  });

  it("C-2 the context builds the solo deck key from the normalised saved categories (no other filter)", () => {
    const context = readFileSync(resolve(process.cwd(), "src/contexts/RecommendationsContext.tsx"), "utf8");
    expect(context).toContain("const cats = rawCats.length > 0 ? normalizeCategoryArray(rawCats) : [];");
    expect(context).toMatch(/const flagSoloDeck = useDeckCards\(\{[\s\S]{0,600}categories: isSoloMode \? \(stableDeckParams\?\.categories \?\? \[\]\) : \[\],/);
    const save = readFileSync(resolve(process.cwd(), "src/components/AppHandlers.tsx"), "utf8");
    expect(save).toContain("const soloCats = normalizeCategoryArray(preferences.selectedCategories || []);");
  });

  it("E-1 a venue-type-only deck with nothing open ends with hasMore:false (empty state), chip sent unchanged", async () => {
    const bodies: unknown[] = [];
    const invoke = jest.fn(async (_name: string, options: { body: unknown }) => {
      bodies.push(options.body);
      return {
        data: {
          success: true,
          cards: [],
          metadata: { hasMore: false, poolSize: 0, batchSeed: 0, fxSnapshotId: null, perChipBreakdown: { "venue_type:club": 1 } },
          sourceBreakdown: { path: "pipeline", reason: "Signal-served v2 multi-chip: 0 chips, 0 RPCs (0 failed)" },
        },
        error: null,
      };
    });
    const curated = jest.fn(async () => ({ cards: [] }));
    const service = new DeckService({ invoke, curatedService: { generateCuratedExperiences: curated } });
    const result = await service.fetchDeck({ ...plan(["venue_type:club"]).request, limit: 10000 });
    expect(bodies).toHaveLength(1);
    expect((bodies[0] as { categories: string[] }).categories).toEqual(["venue_type:club"]);
    expect(curated).not.toHaveBeenCalled();
    expect(result.cards).toEqual([]);
    expect(result.hasMore).toBe(false);
    expect(result.serverPath).toBe("pipeline");
    expect(result.activePills).toEqual(["venue_type:club"]);
  });
});
