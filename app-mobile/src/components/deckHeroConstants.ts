// ORCH-1065 [consumer-experience-deck-card] BUG-3: shared deck-hero image
// constants. Previously these lived in SwipeableCards.tsx and were imported by
// CuratedExperienceSwipeCard.tsx — but SwipeableCards.tsx ALSO imports
// CuratedExperienceSwipeCard.tsx (it renders it), closing a require cycle
// (Metro: "Require cycle: SwipeableCards.tsx -> CuratedExperienceSwipeCard.tsx
// -> SwipeableCards.tsx"). Moving these leaf constants into their own
// dependency-free module breaks the cycle cleanly: both files now depend on
// THIS module, and neither depends on the other for these literals.
//
// SwipeableCards.tsx re-exports both for any historical importer
// (back-compat) while consuming them from here.

// Hard-failure fallback hero image (one source of truth — do not duplicate the
// literal). Shown when a card / stop image hard-fails to load.
export const CARD_FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80';

// Neutral dark blurhash shown during decode so a hero is NEVER a bare
// `#1a1a2e`/`#2C2C2E` panel — reads as an intentional "loading" wash.
// expo-image accepts a constant blurhash string natively (no new dependency).
export const DECK_HERO_PLACEHOLDER_BLURHASH = 'L23%jdof00WB~qj[ayfQayfQfQfQ';
