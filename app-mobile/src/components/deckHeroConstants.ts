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
//
// ---------------------------------------------------------------------------
// #1609 DIRECTION C — THIS MODULE NO LONGER OWNS ANY SCRIM VALUE.
//
// Every scrim number below is now DERIVED FROM `@mingla/card-identity`, which is
// the system's single source (I-PROPOSED-C-CARD-IDENTITY-SINGLE-SOURCE). Seven
// surfaces render this card and three of them — the public web page, the OG
// image renderer and the share snippet — cannot import from `app-mobile/src` at
// all (I-MOR-0827-PACKAGE-ISOLATION), so the values had to leave the app. The
// ramp literals were triplicated across SwipeableCards.tsx:3079, :3292 and
// CuratedExperienceSwipeCard.tsx:444 before #1609, and the place card and the
// curated card drifted apart in exactly that way.
//
// This file survives as a RE-EXPORT SHIM rather than being deleted, for two
// reasons that are both load-bearing:
//
//   1. It keeps the leaf-module property that broke the require cycle. It still
//      imports nothing from either card tree, so both trees can read it.
//   2. Three shipped CI guards import these exact named bindings from this exact
//      path (issue_1609_collapsed_card_scrim_and_geometry, issue_1609_liquid_
//      glass_and_scrim_presence, issue_1609_top_scrim_chrome_contrast). Deleting
//      the module would take all 26 of their assertions down with it.
//
// WHY THE SPECIFIER IS RELATIVE AND NOT THE BARE `@mingla/card-identity`:
// those guards run under plain `node --test` with NO `npm install` step (see
// .github/workflows/issue-1593-deck-layer-geometry.yml), so a bare specifier
// would need a `node_modules/@mingla/card-identity` link that CI never creates,
// and every one of their assertions would die at module load. The relative path
// resolves identically under Node, under Metro (which watches `packages/`) and
// under tsc (which reads the sibling index.d.ts). One file, four resolvers.
import { RAMP, surfaceScrimHeight } from '../../../packages/card-identity/index.js';

// Hard-failure fallback hero image (one source of truth — do not duplicate the
// literal). Shown when a card / stop image hard-fails to load.
export const CARD_FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&q=80';

// Neutral dark blurhash shown during decode so a hero is NEVER a bare
// `#1a1a2e`/`#2C2C2E` panel — reads as an intentional "loading" wash.
// expo-image accepts a constant blurhash string natively (no new dependency).
export const DECK_HERO_PLACEHOLDER_BLURHASH = 'L23%jdof00WB~qj[ayfQayfQfQfQ';

/**
 * #1609 — the collapsed card's scrim ramp. Sourced from RAMP.bottom.
 *
 * Four stops, derived from contrast math rather than taste, against BOTH floors:
 *
 *   LEGIBILITY FLOOR: WCAG 2.1 contrast at each text band. Worst case is a
 *     pure-white (255) hero: for white text at ratio R the maximum permitted
 *     composited background luminance is L <= 1.05/R - 0.05, and back-solving the
 *     sRGB transfer function gives the minimum scrim alpha. Large text (>=18.66pt
 *     bold) needs 3:1 -> alpha >= 0.4165; normal text needs 4.5:1 -> alpha >= 0.535.
 *
 *   PRESENCE FLOOR: passing a contrast ratio at the text band is necessary and
 *     NOT sufficient. WCAG ratio answers "can the text be read"; it does not
 *     answer "can the layer be seen", and at low luminance it is actively
 *     misleading — the +0.05 flare term dominates, so two tones that are
 *     obviously different to the eye can score a near-1.0 ratio. The right
 *     perceptual measure is CIE L*, where ~2-3 units is the just-noticeable
 *     difference for large flat fields. On the worst-case white photo this ramp
 *     traverses >= 40 L*, and its deep end resolves toward a definite tone
 *     rather than a dimmed photo:
 *
 *       alpha 0.82 -> L* 18.9  (reads "dark grey photo")
 *       alpha 0.94 -> L*  4.4  (reads "black treatment")
 *
 *     Residual photo texture transmitted at the tail falls 18% -> 6%, a 3x
 *     reduction. That is what converts the band from "dim photograph" into
 *     "designed layer" — the texture stops competing with the tone.
 *
 * Raising alpha only ever RAISES contrast for white text, so every legibility
 * number above is preserved or improved by the presence re-derivation.
 */
export const DECK_SCRIM_COLORS = RAMP.bottom.colors;

export const DECK_SCRIM_LOCATIONS = RAMP.bottom.locations;

/**
 * #1609 DIRECTION C — the bottom scrim's height, in ABSOLUTE POINTS.
 *
 * This REPLACES `height: '52%'` (place card) and `height: '62%'` (curated card).
 * Three things follow from the change, and all three are the point of it:
 *
 *   1. A percentage makes the whole contrast table valid only on the device it
 *      was computed on. Absolute points make it device-invariant, which is what
 *      lets one number be asserted in CI.
 *   2. It deletes the `isCurated` branch. Curated is NOT a different
 *      composition — it is the same card with two 4pt slivers above the plate —
 *      so a per-type scrim height was the same class of drift that made the
 *      place and curated scrims disagree in the first place.
 *   3. No percentage and no flex-axis key means the layer depends neither on a
 *      sibling nor on the parent's resolved height: strictly stronger
 *      I-PROPOSED-1593-LAYER-GEOMETRY-SINGLE-SOURCE compliance than '52%' was.
 *
 * The value is PRODUCED by the package's `scrimHeight()`, never typed in:
 *
 *     H = ceil2(max(1.4286 x dPlateTop, 1.5464 x dTitleTop)), clamped to the card
 *
 * Clause 1 guarantees scrim alpha >= 0.42 at the plate's top edge — the plate's
 * material contract, below which the derived under-layer alpha would have to
 * exceed 0.95 and the glass would stop being glass. Clause 2 guarantees alpha
 * >= 0.48 at the title's top edge, back-solved from the 3:1 large-text floor
 * with a 15% margin. At S1 that resolves to 316pt, alpha 0.7908 under the plate
 * and 0.481 at the title's top edge (3.73:1 against a pure-white photograph).
 */
export const DECK_BOTTOM_SCRIM_HEIGHT_PT: number = surfaceScrimHeight('s1Single');

/**
 * #1609 amendment 4 — the TOP scrim. Sourced from RAMP.top.
 *
 * Deleting the white tray gained photo everywhere, including behind the deck
 * chrome (GlassTopBar's filter button and notification bell, and SwipeableCards'
 * own "Swipe History" pill). Those elements previously had a calmer backdrop;
 * they now sit on bare photo. Measured across all six delivered #1609 captures,
 * the photo inside the chrome band reaches a 90th-percentile relative luminance
 * of 0.783 to 0.984, and five of the six saturate to L = 1.000 somewhere in the
 * band. White chrome against that measures 1.02:1 to 1.26:1.
 *
 * THE BAR. The chrome is icons and a pill, not text, so the governing criterion
 * is WCAG 2.1 SC 1.4.11 Non-text Contrast: 3:1 for meaningful graphics and for
 * the visual boundary of a UI component. It is NOT 4.5:1 — that is the text
 * criterion the BOTTOM scrim's text bands are derived against.
 *
 * PLATEAU 0.60. White chrome vs the plateau measures 5.74:1 (floor 3:1), the
 * plateau tone on white is L* 43.2, and transmitted photo texture falls to 40%
 * — the band reads as tone with a photograph behind it rather than as a
 * photograph that is a bit dark.
 *
 * WHY 0.60 AND NOT MORE — THE BINDING CONSTRAINT IS THE NOTIFICATION BADGE RING.
 * The #eb7825 badge fill cannot reach 3:1 against the backdrop at any usable
 * alpha, so SC 1.4.11 is carried by its opaque 1.5pt rgba(18,20,26,1) ring,
 * Y = 0.007038. Darkening the scrim moves the backdrop TOWARD that ring and
 * therefore ERODES the very boundary the badge depends on. Solving
 *     (Yb + 0.05) / (0.007038 + 0.05) >= 3  =>  Yb >= 0.121114  =>  alpha <= 0.617
 * gives a hard ceiling. Shipped 0.60 lands the ring at 3.21:1 — a 7% margin —
 * where 0.62 would have measured 2.97:1 and quietly broken it. This constraint
 * is the reason the plateau is 0.60 and not a rounder, darker number, and the
 * guard asserts it.
 *
 * GEOMETRY. The chrome is laid out in ABSOLUTE POINTS (safe-area top + a 44pt
 * button row), so the scrim that covers it is sized in absolute points too. It
 * carries no flex-axis key and no percentage.
 *
 *     card top edge          = screen y 2       (SwipeableCards container paddingTop)
 *     chrome band bottom     = safeAreaTop + 46 (GlassTopBar topInset 2 + button 44)
 *     => in card-local y     = safeAreaTop + 44
 *
 * The plateau runs to 0.60 * 200 = 120pt of card-local y, which covers every
 * safe-area top inset up to 76pt — above the largest shipping iOS inset (62pt,
 * iPhone 17 Pro Max) and above any common Android status bar plus cutout. Below
 * the plateau the ramp decays to zero by 200pt so there is no visible edge.
 *
 * NON-OVERLAP. The top and bottom scrims must never overlap, or their alphas
 * would stack and every number in the bottom ramp's derivation would be fiction.
 * Under Direction C this stops being a device-dependent inequality and becomes
 * EXACT arithmetic: 200 + 316 = 516 <= 783. The guard asserts it.
 */
export const DECK_TOP_SCRIM_COLORS = RAMP.top.colors;

export const DECK_TOP_SCRIM_LOCATIONS = RAMP.top.locations;

/** Absolute height of the top scrim, in points. No percentage, no flex axis. */
export const DECK_TOP_SCRIM_HEIGHT_PT: number = RAMP.top.heightPt;

/**
 * Card-local y below which the scrim must still hold its full plateau alpha.
 * = DECK_MAX_SUPPORTED_TOP_INSET_PT + GlassTopBar row bottom (46) - card top offset (2).
 */
export const DECK_MAX_SUPPORTED_TOP_INSET_PT = 76;
export const DECK_CHROME_BAND_BOTTOM_PT = 46;
export const DECK_CARD_TOP_OFFSET_PT = 2;
