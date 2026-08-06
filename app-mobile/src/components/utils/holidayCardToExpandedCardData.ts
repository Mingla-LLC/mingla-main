// ORCH-0997 [friend-page cards → deck parity]
// Single producer of ExpandedCardData for the friend-profile holiday/birthday card
// rows. Replaces the pre-0997 ad-hoc inline object whose field names (`imageUrl`,
// flat `lat`/`lng`) did NOT match what ExpandedCardModal reads (`image`/`images`,
// `location.{lat,lng}`) — so the modal fell through to its grey "No images available"
// box and its location-derived UI no-opped (RC#2, proven 2026-05-29).
//
// ── #1669 [expanded-card-one-producer] ──
// This is now a NORMALISER, not a second producer. `HolidayCard` is the one pool
// card source whose field NAMES genuinely differ (`imageUrl`, `googlePlaceId`,
// `stopsData`, flat `lat`/`lng`), so that rename still lives here — but the
// field-SURVIVAL decision does not. Once renamed, the record goes to the ONE
// canonical producer, `savedCardToExpandedCardData`, exactly like every other
// surface. A field added to the mapper therefore reaches the friend page for
// free instead of silently stopping at this file.
//
// Returning the value TYPED as ExpandedCardData makes the field-name drift a compile
// error if anyone reverts the mapping (regression-prevention, SPEC §10 / SC-7).
import type { ExpandedCardData } from '../../types/expandedCardTypes';
import type { CuratedStop } from '../../types/curatedExperience';
import type { HolidayCard } from '../../services/holidayCardsService';
import { getCategoryIcon } from '../../utils/categoryUtils';
import { canonicalDiscoveryPriceFields } from '../../utils/priceTiers';
import { savedCardToExpandedCardData } from './savedCardToExpandedCardData';

export interface HolidayCardMapOpts {
  travelMode?: string;
}

/**
 * Map a paired-profile HolidayCard onto a complete ExpandedCardData so the friend
 * page opens ExpandedCardModal with the same fidelity as the swipeable deck.
 *
 * Honesty (Constitution #9): missing image → `image:''` + `images:[]` (the modal
 * renders its own honest empty state, never a fabricated photo); missing rating →
 * `0` (modal hides the chip); missing coords → `location:undefined` (no fake
 * distance). reviewCount/highlights/tags/matchFactors/socialStats are neutral
 * zero/empty — the source carries no such data and we never invent it.
 */
export function holidayCardToExpandedCardData(
  c: HolidayCard,
  opts: HolidayCardMapOpts,
): ExpandedCardData {
  const isCurated = c.cardType === 'curated';
  // stopsData is the same generate-curated-experiences output the deck renders;
  // guarded to an array before the CuratedStop assertion (never a blind cast).
  const stops: CuratedStop[] | undefined =
    isCurated && Array.isArray(c.stopsData) ? (c.stopsData as CuratedStop[]) : undefined;

  const image = c.imageUrl ?? '';

  // HolidayCard → pool-card record. Pure renaming; no field is decided here.
  // Both `location` and the individual fields are set because a curated record
  // is returned VERBATIM by the canonical mapper (it never rebuilds a curated
  // plan field-by-field — that was the ORCH-1054 bug).
  const record: Record<string, unknown> = {
    id: c.id,
    placeId: c.googlePlaceId ?? undefined,
    title: c.title,
    category: c.category,
    categoryIcon: getCategoryIcon(c.category),
    description: c.description ?? '',
    fullDescription: c.description ?? '',
    image,
    images: image ? [image] : [],
    rating: c.rating ?? 0,
    reviewCount: 0,
    priceRange: c.priceRange ?? undefined,
    ...canonicalDiscoveryPriceFields(c),
    // The sender-independent fields the friend page genuinely does not know.
    distance: null,
    travelTime: null,
    travelMode: opts.travelMode,
    address: c.address ?? '',
    website: c.website ?? undefined,
    tagline: c.tagline ?? undefined,
    highlights: [],
    tags: [],
    matchScore: 0,
    matchFactors: { location: 0, budget: 0, category: 0, time: 0, popularity: 0 },
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
    location: c.lat != null && c.lng != null ? { lat: c.lat, lng: c.lng } : undefined,
    priceTier: c.priceTier ?? undefined,
    ...(isCurated
      ? {
          cardType: 'curated' as const,
          stops,
          experienceType: c.experienceType ?? undefined,
          totalPriceMin: c.totalPriceMin ?? undefined,
          totalPriceMax: c.totalPriceMax ?? undefined,
          estimatedDurationMinutes: c.estimatedDurationMinutes ?? undefined,
          shoppingList: Array.isArray(c.shoppingList) ? (c.shoppingList as string[]) : undefined,
        }
      : {}),
  };

  // A HolidayCard always has an id + title, so the mapper never returns null.
  return savedCardToExpandedCardData(record) as ExpandedCardData;
}

/**
 * The friend page's SECOND row type: the category-fallback cards shown when a
 * holiday section has no paired cards yet (`PersonHolidayView.FallbackCard`).
 *
 * #1669: this row used to open the modal from its own inline literal, sitting
 * a few lines below the adapter above — an eighth producer of the same shape.
 * The shape is declared structurally (rather than imported from
 * PersonHolidayView) purely to avoid a module cycle; it is the same contract.
 */
export interface FallbackCardLike {
  id: string;
  title: string;
  category: string;
  image: string;
  rating: number;
  address: string;
  priceRange: string;
}

export function fallbackCardToExpandedCardData(
  c: FallbackCardLike,
  opts: HolidayCardMapOpts,
): ExpandedCardData | null {
  const image = c.image ?? '';
  return savedCardToExpandedCardData({
    id: c.id,
    title: c.title,
    category: c.category,
    categoryIcon: getCategoryIcon(c.category),
    description: '',
    fullDescription: '',
    image,
    images: image ? [image] : [],
    rating: c.rating ?? 0,
    reviewCount: 0,
    priceRange: c.priceRange ?? undefined,
    distance: null,
    travelTime: null,
    travelMode: opts.travelMode,
    address: c.address ?? '',
    highlights: [],
    tags: [],
    matchScore: 0,
    matchFactors: { location: 0, budget: 0, category: 0, time: 0, popularity: 0 },
    socialStats: { views: 0, likes: 0, saves: 0, shares: 0 },
  });
}
