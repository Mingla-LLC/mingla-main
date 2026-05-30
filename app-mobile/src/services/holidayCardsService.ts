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
  // [META-ORCH-1009 Sub-B] Per-signal Gemini Q2 reasoning slice carried from the
  // paired-friend backend pipeline (get-person-hero-cards / get-paired-profile-
  // cards). D-8 verdict (2026-05-30): those backends are INDEPENDENT of
  // discover-cards and do NOT yet populate this field — Sub-B ships the type
  // surface so the mobile mapper is ready, and a follow-up Sub will extend the
  // paired-friend RPC to source reasoning from place_pool.ai_signal_scores.
  // Until then the field is undefined and the modal hides the section.
  aiReasoningBySignal?: Record<string, string>;
}

export interface HolidayCardsResponse {
  cards: HolidayCard[];
  hasMore: boolean;
  // ORCH-0684 D-Q1: optional empty-state explainer mirroring ORCH-0677 contract.
  summary?: { emptyReason: string };
}
