// #1669 [expanded-card-one-producer]
// The Explorer deck's producer, lifted out of SwipeableCards.tsx.
//
// It used to be TWO hand-written object literals inside that component —
// `handleCardExpand` (tap / swipe-up) and `recommendationToExpanded` (the
// dismissed-card review sheet) — which is how the deck ended up disagreeing
// with Likes about the same place:
//   * neither spread `canonicalDiscoveryPriceFields`, so `CardInfoSection`
//     returned null for the price pill and the deck showed no price at all;
//   * neither passed `utcOffsetMinutes`, so `isPlaceOpenAt` fell back to the
//     VIEWER's clock — a London user was told the wrong thing about a Lagos
//     venue, and those are two of three live markets;
//   * both substituted `userLocation` when a card had no coordinates, so the
//     modal then fetched weather and busyness for wherever the user was
//     standing and rendered it under the venue's name.
//
// It is a module rather than a closure for two reasons: the deck's two open
// paths now provably share ONE producer, and that producer is importable, so
// the regression test can open the same place from the deck and from Likes and
// compare the facts instead of asserting an import exists.
//
// It carries no field-survival opinion of its own — it delegates to the
// canonical mapper like every other surface.

import type { Recommendation } from "../../types/recommendation";
import type { ExpandedCardData } from "../../types/expandedCardTypes";
import {
  savedCardToExpandedCardData,
  type PoolCardMapOptions,
} from "./savedCardToExpandedCardData";

export function recommendationToExpandedCardData(
  card: Recommendation,
  options?: PoolCardMapOptions,
): ExpandedCardData {
  // Curated pass-through — the deck has always handed the curated shape to the
  // modal verbatim, and the canonical mapper does the same.
  if ((card as unknown as { cardType?: string }).cardType === "curated") {
    return card as unknown as ExpandedCardData;
  }

  const mapped = savedCardToExpandedCardData(
    card as unknown as Record<string, unknown>,
    options,
  );
  // A Recommendation is never null/empty at a call site, so the mapper always
  // returns a card here; the guard is for the compiler, not a reachable state.
  if (!mapped) {
    throw new Error(
      "recommendationToExpandedCardData: received an empty recommendation",
    );
  }
  return mapped;
}
