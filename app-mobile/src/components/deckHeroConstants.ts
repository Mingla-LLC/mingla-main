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

/**
 * #1609 — the collapsed card's scrim ramp.
 *
 * Lives in this leaf module (not SwipeableCards) for the same reason as the two
 * constants above: SwipeableCards and CuratedExperienceSwipeCard import each other,
 * and a shared value defined in either one re-opens that require cycle. Both faces of
 * both card types MUST composite the IDENTICAL ramp — a per-tree literal is exactly
 * how the place card and the curated card drifted apart before.
 *
 * Four stops, derived from contrast math rather than taste. The previous 3-stop / 45%
 * gradient topped out at rgba(0,0,0,0.55) and FAILED WCAG AA at the title on a bright
 * photo. Worst case is a pure-white (255) hero: for white text at contrast ratio R the
 * maximum permitted composited background luminance is L <= 1.05/R - 0.05, and
 * back-solving the sRGB transfer function gives the minimum scrim alpha:
 *
 *   4.5:1 (normal text — the 15/600 description) -> L <= 0.1833 -> alpha >= 0.535
 *   3.0:1 (large text  — the 24/700 title, which qualifies at >=18.66pt bold)
 *                                                -> L <= 0.30   -> alpha >= 0.4165
 *
 * Measured alphas where those elements actually land are 0.491 at the title band and
 * 0.661 at the description band, giving 3.85:1 and 7.29:1 against white. The existing
 * textShadow is kept as perceptual reinforcement only — it does NOT count toward WCAG
 * and none of the math above relies on it.
 */
export const DECK_SCRIM_COLORS = [
  'rgba(0,0,0,0)',
  'rgba(0,0,0,0.35)',
  'rgba(0,0,0,0.68)',
  'rgba(0,0,0,0.82)',
] as const;

export const DECK_SCRIM_LOCATIONS = [0, 0.32, 0.62, 1] as const;
