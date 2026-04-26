// ORCH-0570 Phase 1: `getHolidayCards()` and `getHolidayCardsWithMeta()` were
// removed — both had zero call sites across the repo. The `get-holiday-cards`
// edge function they wrapped was deleted in the same commit.
//
// This file is retained for the `HolidayCardsResponse` and `HolidayCard` type
// definitions, which ARE imported externally (usePairedCards.ts,
// personHeroCardsService.ts).
//
// ORCH-0684 HF-2 cleanup: dropped unused `supabase, supabaseUrl` re-imports
// per Constitution #8. The original ORCH-0573 backlog comment is now resolved.

export interface HolidayCard {
  id: string;
  title: string;
  category: string;
  categorySlug: string;
  imageUrl: string | null;
  rating: number | null;
  priceLevel: string | null;
  address: string | null;
  googlePlaceId: string | null;
  lat: number | null;
  lng: number | null;
  priceTier: string | null;
  description: string | null;
  cardType: "single" | "curated";
  tagline: string | null;
  stops: number;
  stopsData: unknown[] | null;
  totalPriceMin: number | null;
  totalPriceMax: number | null;
  website: string | null;
  estimatedDurationMinutes: number | null;
  experienceType: string | null;
  categories: string[] | null;
  shoppingList: unknown[] | null;
  // ORCH-0684 telemetry passthrough — additive optional fields, not consumed by current UI
  isOpenNow?: boolean | null;
  distanceM?: number | null;
  signalId?: string | null;
  signalScore?: number | null;
}

export interface HolidayCardsResponse {
  cards: HolidayCard[];
  hasMore: boolean;
  // ORCH-0684 D-Q1: optional empty-state explainer mirroring ORCH-0677 contract.
  summary?: { emptyReason: string };
}
