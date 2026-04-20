// ORCH-0570 Phase 1: `getHolidayCards()` and `getHolidayCardsWithMeta()` were
// removed — both had zero call sites across the repo. The `get-holiday-cards`
// edge function they wrapped was deleted in the same commit.
//
// This file is retained for the `HolidayCardsResponse` and `HolidayCard` type
// definitions, which ARE imported externally (usePairedCards.ts,
// usePersonHeroCards.ts, personHeroCardsService.ts).
//
// Kept imports: `supabase` and `supabaseUrl` are unused after the function
// deletions but are safe-harmless re-exports if any future code path needs them
// for holiday-related reads. If a future cleanup pass confirms they have zero
// type-level use either, move `HolidayCard` + `HolidayCardsResponse` into
// `types/holidayTypes.ts` and delete this file entirely (ORCH-0573 backlog).

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
}

export interface HolidayCardsResponse {
  cards: HolidayCard[];
  hasMore: boolean;
}
