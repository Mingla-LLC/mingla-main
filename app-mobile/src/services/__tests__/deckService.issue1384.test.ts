// @ts-nocheck — executable source-contract tests avoid RN network imports.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient } from "@tanstack/react-query";

jest.mock("../supabase", () => ({
  supabase: {},
  trackedInvoke: jest.fn(),
}));
jest.mock("../curatedExperiencesService", () => ({
  curatedExperiencesService: {
    generateCuratedExperiences: jest.fn(async () => ({ cards: [] })),
  },
}));
jest.mock("../../config/featureFlags", () => ({
  FEATURE_FLAG_PROGRESSIVE_DELIVERY: false,
}));

import { DeckService } from "../deckService";
import {
  buildDeckQueryKey,
  buildSoloDeckQueryPlan,
  DECK_LAST_KEY,
  DECK_LAST_LOCATION_KEY,
  persistFirstDeckPageController,
  prefetchDeckPageController,
  resolveDeckQueryKey,
} from "../../hooks/useDeckCards";

(global as { __DEV__?: boolean }).__DEV__ = false;

const deck = readFileSync(resolve(process.cwd(), "src/services/deckService.ts"), "utf8");
const hook = readFileSync(resolve(process.cwd(), "src/hooks/useDeckCards.ts"), "utf8");
const context = readFileSync(
  resolve(process.cwd(), "src/contexts/RecommendationsContext.tsx"),
  "utf8",
);

describe("issue #1384 deck snapshot and cache identity", () => {
  it("returns the server-selected snapshot and sends it on continuation", () => {
    expect(deck).toContain("data.metadata?.fxSnapshotId");
    expect(deck).toContain("fxSnapshotId: selectedFxSnapshotId");
    expect(deck).toContain("fxSnapshotId: params.fxSnapshotId");
  });

  it("keys queries by display/filter/snapshot dimensions", () => {
    for (const token of [
      "params.displayCurrency ?? null",
      "params.fxSnapshotId ?? null",
      "params.priceFilterMinMinor ?? null",
      "params.priceFilterMaxMinor ?? null",
      "params.priceFilterCurrency ?? null",
    ]) {
      expect(hook).toContain(token);
    }
  });

  it("uses the shared key builder for prefetch and persisted cold start", () => {
    expect(context).toContain("prefetchDeckPageController({");
    expect(context).toContain("persistFirstDeckPageController({");
    expect(context).not.toContain("queryClient.prefetchQuery({");
    expect(context).not.toContain("queryClient.setQueryData(");
    expect(
      context.match(
        /fxSnapshotId: activeDeck\.fxSnapshotId \?\? pinnedFxSnapshotId/g,
      ),
    ).toHaveLength(2);
  });

  it("does not default a missing viewer preference to USD in the deck request", () => {
    expect(context).toContain("const explicitViewerCurrency");
    expect(context).toContain("displayCurrency: explicitViewerCurrency");
    expect(context).not.toContain("displayCurrency: localePreferences.currency");
  });
});

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const PRICE = {
  priceRangeStatus: "active",
  sourceMinMinor: 20_000,
  sourceMaxMinor: 50_000,
  sourceCurrencyCode: "NGN",
  sourceMinorUnitExponent: 2,
  displayMinMinor: 13_00,
  displayMaxMinor: 33_00,
  displayCurrencyCode: "USD",
  displayMinorUnitExponent: 2,
  priceIsApproximate: true,
  fxSnapshotId: S1,
  fxProvider: "exchange_rate_api_open_v6",
  fxProviderUpdatedAt: "2026-07-30T00:00:00.000Z",
  fxFreshness: "fresh",
};

function planInput(overrides = {}) {
  return {
    mode: "solo",
    location: { lat: 35.77961, lng: -78.63821 },
    categories: ["upscale_fine_dining"],
    intents: [],
    travelMode: "walking",
    travelConstraintType: "time",
    travelConstraintValue: 30,
    dateOption: "today",
    batchSeed: 0,
    excludeCardIds: [],
    displayCurrency: "USD",
    fxSnapshotId: S1,
    priceFilterMinMinor: 10_000,
    priceFilterMaxMinor: 60_000,
    priceFilterCurrency: "NGN",
    limit: 100,
    ...overrides,
  };
}

function response(snapshotId = S1) {
  return {
    cards: [{ id: "place-1", name: "Canonical venue", ...PRICE }],
    deckMode: "upscale_fine_dining",
    activePills: ["upscale_fine_dining"],
    total: 1,
    hasMore: true,
    fxSnapshotId: snapshotId,
    serverPath: "pipeline",
  };
}

describe("issue #1384 executable deck service and query cache", () => {
  it("executes DeckService.fetchDeck and echoes the pinned snapshot on continuation", async () => {
    const bodies = [];
    const invoke = jest.fn(async (_name, options) => {
      bodies.push(options.body);
      return {
        data: {
          cards: [{
            id: "place-1",
            placeId: "place-1",
            name: "Canonical venue",
            lat: 35.78,
            lng: -78.64,
            image: "https://cdn.example/venue.jpg",
            ...PRICE,
          }],
          metadata: { hasMore: true, fxSnapshotId: S1 },
          sourceBreakdown: { path: "pipeline" },
        },
        error: null,
      };
    });
    const service = new DeckService({
      invoke,
      curatedService: {
        generateCuratedExperiences: jest.fn(async () => ({ cards: [] })),
      },
    });

    const first = await service.fetchDeck(planInput());
    expect(first.fxSnapshotId).toBe(S1);
    expect(first.cards[0].sourceCurrencyCode).toBe("NGN");
    expect(bodies[0]).toMatchObject({
      displayCurrency: "USD",
      fxSnapshotId: S1,
      priceFilterMinMinor: 10_000,
      priceFilterMaxMinor: 60_000,
      priceFilterCurrency: "NGN",
    });

    await service.fetchDeck(planInput({ batchSeed: 1 }));
    expect(bodies[1].fxSnapshotId).toBe(S1);
  });

  it("isolates every viewer dimension in the production query key", () => {
    const baseline = buildDeckQueryKey({
      ...planInput(),
      lat: 35.77961,
      lng: -78.63821,
    });
    for (const variant of [
      { displayCurrency: "NGN" },
      { fxSnapshotId: S2 },
      { priceFilterMinMinor: 20_000 },
      { priceFilterMaxMinor: 70_000 },
      { priceFilterCurrency: "USD" },
    ]) {
      expect(buildDeckQueryKey({
        ...planInput(variant),
        lat: 35.77961,
        lng: -78.63821,
      })).not.toEqual(baseline);
    }
  });

  it("prefetches, persists, and cold-starts through one pinned production key", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const fetchDeck = jest.fn(async (request) => {
      expect(request.batchSeed).toBe(1);
      expect(request.fxSnapshotId).toBe(S1);
      expect(request.displayCurrency).toBe("USD");
      expect(request.priceFilterCurrency).toBe("NGN");
      return response();
    });
    const prefetchInput = planInput({ batchSeed: 1 });
    const prefetched = await prefetchDeckPageController(prefetchInput, {
      queryClient,
      fetchDeck,
    });
    expect(prefetched.request.batchSeed).toBe(1);
    expect(queryClient.getQueryData(prefetched.queryKey)).toEqual(response());
    expect(queryClient.getQueryData(
      buildSoloDeckQueryPlan(planInput({
        batchSeed: 1,
        fxSnapshotId: S2,
      })).queryKey,
    )).toBeUndefined();

    const writes = new Map();
    const storage = {
      setItem: jest.fn(async (key, value) => {
        writes.set(key, value);
      }),
    };
    const firstPageInput = planInput({ response: response() });
    const persistedKey = await persistFirstDeckPageController(firstPageInput, {
      queryClient,
      storage,
    });
    expect(JSON.parse(writes.get(DECK_LAST_KEY))).toEqual(persistedKey);
    expect(JSON.parse(writes.get(DECK_LAST_LOCATION_KEY))).toEqual({
      lat: 35.78,
      lng: -78.638,
    });
    expect(queryClient.getQueryData(persistedKey)).toEqual(response());

    const coldKey = resolveDeckQueryKey({
      ...planInput(),
      location: null,
      enabled: false,
      lastKnownQueryKey: persistedKey,
    });
    expect(coldKey).toBe(persistedKey);
    const coldFetch = jest.fn(async () => response(S2));
    const cold = await queryClient.fetchQuery({
      queryKey: coldKey,
      queryFn: coldFetch,
      staleTime: Infinity,
    });
    expect(cold).toEqual(response());
    expect(coldFetch).toHaveBeenCalledTimes(0);

    expect(queryClient.getQueryData(
      buildSoloDeckQueryPlan(planInput({
        fxSnapshotId: S2,
        displayCurrency: "NGN",
        priceFilterCurrency: "USD",
      })).queryKey,
    )).toBeUndefined();
  });
});
