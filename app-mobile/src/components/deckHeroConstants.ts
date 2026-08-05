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
 *
 * ---------------------------------------------------------------------------
 * #1609 REJECTION (2026-08-05) — THE PRESENCE FLOOR.
 *
 * Seth rejected the first ramp: "The gradient at the top and bottom needs to show."
 * The contrast maths above was never the complaint — it passes, and it still does.
 * The defect is that neither ramp read as a DESIGNED ELEMENT: the bottom looked like
 * the photo happening to be dark rather than like deliberate treatment.
 *
 * Passing a contrast ratio at the text band is necessary and NOT sufficient. WCAG
 * ratio answers "can the text be read". It does not answer "can the layer be seen",
 * and at low luminance it is actively misleading — the +0.05 flare term dominates, so
 * two tones that are obviously different to the eye can score a near-1.0 ratio.
 *
 * The right perceptual measure is CIE L* (lightness), where a difference of ~2-3 units
 * is the just-noticeable difference for large flat fields. So this ramp is now derived
 * against BOTH floors, and both must hold:
 *
 *   LEGIBILITY FLOOR (unchanged, inherited above): WCAG 2.1 contrast at each text band.
 *   PRESENCE FLOOR   (new): on the worst-case white photo the ramp must traverse
 *                    >= 40 L* units, and its deep end must resolve toward a definite
 *                    tone rather than a dimmed photo.
 *
 * Raising alpha only ever RAISES contrast for white text, so every legibility number
 * in the derivation above is preserved or improved — verified band-by-band below.
 *
 * BOTTOM RAMP, re-derived. Deep end 0.82 -> 0.94, mid 0.68 -> 0.78, onset 0.35 -> 0.42,
 * and the first stop pulled in 0.32 -> 0.30 so the ramp starts working sooner.
 *
 *   deep end on a white photo:  alpha 0.82 -> L* 18.9   (reads "dark grey photo")
 *                               alpha 0.94 -> L*  4.4   (reads "black treatment")
 *   residual photo texture transmitted at the tail: 18% -> 6%, a 3x reduction. This is
 *   what converts the band from "dim photograph" into "designed layer" — the texture
 *   stops competing with the tone.
 *
 *   Legibility re-check on the 52% scrim over a 783pt card, all against white:
 *     title band  (y 541-601): alpha 0.491 -> 0.538   3.85:1 -> 4.55:1   (now clears
 *                              even the 4.5:1 NORMAL-text bar, not just its 3:1 one)
 *     description (y 609-651): alpha 0.661 -> 0.726   7.29:1 -> 9.46:1
 *     action rail (y 711-755): alpha 0.760 -> 0.865  10.80:1 -> 15.8:1
 *   Every band improves. Nothing regresses.
 */
export const DECK_SCRIM_COLORS = [
  'rgba(0,0,0,0)',
  'rgba(0,0,0,0.42)',
  'rgba(0,0,0,0.78)',
  'rgba(0,0,0,0.94)',
] as const;

export const DECK_SCRIM_LOCATIONS = [0, 0.3, 0.62, 1] as const;

/**
 * #1609 amendment 4 — the TOP scrim.
 *
 * Deleting the white tray gained photo everywhere, including behind the deck chrome
 * (GlassTopBar's filter button and notification bell, and SwipeableCards' own
 * "Swipe History" pill). Those elements previously had a calmer backdrop; they now sit
 * on bare photo. Measured across all six delivered #1609 captures, the photo inside the
 * chrome band reaches a 90th-percentile relative luminance of 0.783 to 0.984, and five
 * of the six saturate to L = 1.000 somewhere in the band. White chrome against that
 * measures 1.02:1 to 1.26:1.
 *
 * THE BAR. The chrome is icons and a pill, not text, so the governing criterion is
 * WCAG 2.1 SC 1.4.11 Non-text Contrast: 3:1 for meaningful graphics and for the visual
 * boundary of a UI component. It is NOT 4.5:1 — that is the text criterion the BOTTOM
 * scrim's description band is derived against.
 *
 * THE DERIVATION (same method as DECK_SCRIM_COLORS above; back-solved, not eyeballed).
 * Worst case is a pure-white (255) photo. For white chrome (L1 = 1.0) at ratio R:
 *
 *     (1.0 + 0.05) / (L2 + 0.05) >= R      =>   R = 3   =>   L2 <= 0.30
 *
 * A black scrim of alpha a over white composites to channel c = 255(1 - a), so
 * c' = 1 - a, and inverting the sRGB transfer function L = ((c' + 0.055)/1.055)^2.4:
 *
 *     c' = 1.055 * 0.30^(1/2.4) - 0.055 = 0.583836
 *     a >= 1 - 0.583836 = 0.416164
 *
 * SHIPPED ALPHA 0.45, which composites white to L = 0.263292 and yields 3.35:1 — a 12%
 * margin over the 3:1 floor, matching the margin discipline of the bottom ramp (whose
 * title band ships at 3.29:1 against the same 3:1 floor).
 *
 * WHAT ELSE WAS CHECKED AGAINST THIS ALPHA (all against the same white worst case):
 *
 *   - "Swipe History" pill, rgba(255,255,255,0.95) over the scrimmed backdrop:
 *     composites to L = 0.9496 against a backdrop of L = 0.263292 => 3.19:1. PASSES.
 *     Without the top scrim the same pill on a white photo is 1.00:1 — literally
 *     invisible. This is the single largest gain in the amendment.
 *
 *   - The #eb7825 notification badge on the bell (L = 0.312360). Honest result: the
 *     badge FILL cannot reach 3:1 against the backdrop at any usable alpha. Against an
 *     unscrimmed white photo it is 2.90:1 (already failing); against this scrim it is
 *     1.157:1, and it is exactly camouflaged (1.00:1) at a = 0.405. Driving the fill to
 *     3:1 would need L2 <= 0.070787, i.e. a >= 0.705 — a scrim so heavy it would bury
 *     the photograph. It does not need to: the badge carries its own opaque 1.5pt
 *     rgba(18,20,26,1) ring (L = 0.007038), and SC 1.4.11 is satisfied by that boundary:
 *         badge fill vs its ring          6.35:1
 *         ring vs the scrimmed backdrop   5.49:1
 *     Both clear 3:1, so the badge stays identifiable. The ring is load-bearing for
 *     accessibility and the guard asserts it still exists.
 *
 * GEOMETRY. The chrome is laid out in ABSOLUTE POINTS (safe-area top + a 44pt button
 * row), so the scrim that covers it is sized in absolute points too. It carries no
 * flex-axis key and no percentage — it does not depend on siblings OR on the parent's
 * resolved height, which is strictly stronger compliance with
 * I-PROPOSED-1593-LAYER-GEOMETRY-SINGLE-SOURCE than the bottom scrim's `height: '52%'`.
 *
 *     card top edge          = screen y 2      (SwipeableCards container paddingTop)
 *     chrome band bottom     = safeAreaTop + 46 (GlassTopBar topInset 2 + button 44)
 *     => in card-local y     = safeAreaTop + 44
 *
 * The plateau runs to 0.60 * 200 = 120pt of card-local y, which covers every safe-area
 * top inset up to 76pt — above the largest shipping iOS inset (62pt, iPhone 17 Pro Max)
 * and above any common Android status bar plus cutout. Below the plateau the ramp
 * decays to zero by 200pt so there is no visible edge.
 *
 * NON-OVERLAP. The top and bottom scrims must never overlap, or their alphas would
 * stack and every number in the bottom ramp's derivation would be fiction. The bottom
 * scrim is the taller of the two on a curated card at 62%, so non-overlap holds for any
 * card at least 200 / 0.38 = 526.4pt tall. The shortest supported device (iPhone SE 3rd
 * gen, 667pt screen) yields a 576pt card. The guard asserts this.
 *
 * ---------------------------------------------------------------------------
 * #1609 REJECTION (2026-08-05) — TOP RAMP RE-DERIVED FOR PRESENCE.
 *
 * Same story as the bottom ramp: 3.35:1 was a passing legibility number and Seth's
 * complaint was that the band did not READ. Measured on the delivered bright-hero
 * capture, the plateau sat at a median L* of ~47 while the clear photo below the ramp
 * measured L* ~76 — a real difference, but the photo's own content variation inside
 * the plateau swung +/- 8 L*, the same order as the ramp's onset. When the layer's
 * signal is no stronger than the photo's noise, the eye reads "darkish photo", not
 * "gradient". Fixing that means raising the tone AND suppressing the texture.
 *
 * PLATEAU 0.45 -> 0.60. Geometry is deliberately UNCHANGED (200pt, stops at
 * [0, 0.60, 0.82, 1]) so the non-overlap proof below and every geometry assertion in
 * the guard stand exactly as written. Only the alphas move.
 *
 *   white chrome vs plateau:  3.35:1 -> 5.74:1   (floor was 3:1; margin 12% -> 91%)
 *   plateau tone on white:    L* 58.3 -> L* 43.2 (delta L* from clear white: 42 -> 57)
 *   photo texture transmitted: 55% -> 40%, a 27% reduction — the band now reads as
 *   tone with a photograph behind it rather than as a photograph that is a bit dark.
 *   "Swipe History" pill vs plateau: 3.19:1 -> 5.37:1.
 *
 * WHY 0.60 AND NOT MORE — THE BINDING CONSTRAINT IS THE NOTIFICATION BADGE RING.
 * The #eb7825 badge cannot reach 3:1 against the backdrop at any usable alpha (that
 * was established above), so SC 1.4.11 is carried by its opaque 1.5pt rgba(18,20,26,1)
 * ring, Y = 0.007038. Darkening the scrim moves the backdrop TOWARD that ring and
 * therefore ERODES the very boundary the badge depends on. Solving
 *     (Yb + 0.05) / (0.007038 + 0.05) >= 3   =>   Yb >= 0.121114   =>   alpha <= 0.617
 * gives a hard ceiling. Shipped 0.60 lands the ring at 3.21:1 — a 7% margin — where
 * 0.62 would have measured 2.97:1 and quietly broken it. This constraint is the reason
 * the plateau is 0.60 and not a rounder, darker number, and the guard asserts it.
 *
 * The mid stop moves 0.12 -> 0.30 so the decay is a visible ramp rather than an abrupt
 * release into bare photo.
 */
export const DECK_TOP_SCRIM_COLORS = [
  'rgba(0,0,0,0.60)',
  'rgba(0,0,0,0.60)',
  'rgba(0,0,0,0.30)',
  'rgba(0,0,0,0)',
] as const;

export const DECK_TOP_SCRIM_LOCATIONS = [0, 0.6, 0.82, 1] as const;

/** Absolute height of the top scrim, in points. No percentage, no flex axis. */
export const DECK_TOP_SCRIM_HEIGHT_PT = 200;

/**
 * Card-local y below which the scrim must still hold its full plateau alpha.
 * = DECK_MAX_SUPPORTED_TOP_INSET_PT + GlassTopBar row bottom (46) - card top offset (2).
 */
export const DECK_MAX_SUPPORTED_TOP_INSET_PT = 76;
export const DECK_CHROME_BAND_BOTTOM_PT = 46;
export const DECK_CARD_TOP_OFFSET_PT = 2;
