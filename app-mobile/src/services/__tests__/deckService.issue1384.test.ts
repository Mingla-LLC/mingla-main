// @ts-nocheck — executable source-contract tests avoid RN network imports.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
    expect(context).toContain("const prefetchKey = buildDeckQueryKey");
    expect(context).toContain("queryKey: prefetchKey");
    expect(context).toContain("queryClient.setQueryData(key, activeDeck.response)");
    expect(context).toContain("fxSnapshotId: activeDeck.fxSnapshotId ?? pinnedFxSnapshotId");
  });

  it("does not default a missing viewer preference to USD in the deck request", () => {
    expect(context).toContain("const explicitViewerCurrency");
    expect(context).toContain("displayCurrency: explicitViewerCurrency");
    expect(context).not.toContain("displayCurrency: localePreferences.currency");
  });
});
