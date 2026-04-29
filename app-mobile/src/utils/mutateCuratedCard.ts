import type { CuratedExperienceCard, CuratedStop } from '../types/curatedExperience';

// ── Geo Utilities (same formulas as edge function) ─────────────────────────

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function estimateTravelMinutes(distKm: number, travelMode: string): number {
  const config: Record<string, { speed: number; factor: number }> = {
    walking: { speed: 4.5, factor: 1.3 },
    driving: { speed: 35, factor: 1.4 },
    transit: { speed: 20, factor: 1.3 },
    biking: { speed: 14, factor: 1.3 },
    bicycling: { speed: 14, factor: 1.3 },
  };
  const { speed, factor } = config[travelMode] ?? config.walking;
  return Math.max(3, Math.round((distKm * factor / speed) * 60));
}

// ── Static Picnic Shopping List (fallback when stops are replaced) ─────────

const PICNIC_STATIC_SHOPPING_LIST: string[] = [
  '🥖 Fresh baguette or ciabatta',
  '🧀 Soft cheese (brie or camembert)',
  '🍇 Seasonal fruit (grapes, strawberries)',
  '🥗 Pre-made salad or hummus & crackers',
  '🍫 Dark chocolate or brownies',
  '💧 Sparkling water',
  '🍷 Bottle of wine or lemonade',
  '🧃 Juice boxes or iced tea',
  '💐 Small bouquet of wildflowers',
  '🧻 Napkins and a picnic blanket',
];

// ── Stop Alternative Interface ─────────────────────────────────────────────

export interface StopAlternative {
  placeId: string;
  placePoolId: string;
  // ORCH-0640 ch09: cardPoolId field removed — card_pool archived (DEC-037).
  // Curated stop identity is now purely placePoolId. Callers who referenced
  // cardPoolId need to switch to placePoolId.
  placeName: string;
  placeType: string;
  address: string;
  rating: number;
  reviewCount: number;
  imageUrl: string;
  imageUrls: string[];
  priceLevelLabel: string;
  priceTier: string;
  priceTiers: string[];
  priceMin: number;
  priceMax: number;
  openingHours: Record<string, unknown>;
  website: string | null;
  lat: number;
  lng: number;
  distanceFromRefKm: number;
  aiDescription: string;
  estimatedDurationMinutes: number;
  city: string | null;
  country: string | null;
}

// ── Build Replacement Stop ─────────────────────────────────────────────────

export function buildReplacementStop(
  original: CuratedStop,
  alternative: StopAlternative,
  travelMode: string,
  prevLat: number | null,
  prevLng: number | null,
  userLat: number,
  userLng: number,
): CuratedStop {
  const distFromUser = haversineKm(userLat, userLng, alternative.lat, alternative.lng);
  const travelFromUser = estimateTravelMinutes(distFromUser, travelMode);

  let travelFromPrev: number | null = null;
  if (prevLat !== null && prevLng !== null) {
    const distFromPrev = haversineKm(prevLat, prevLng, alternative.lat, alternative.lng);
    travelFromPrev = estimateTravelMinutes(distFromPrev, travelMode);
  }

  return {
    // Structural fields from original (preserved across replacement)
    stopNumber: original.stopNumber,
    stopLabel: original.stopLabel,
    role: original.role,
    optional: original.optional,
    dismissible: original.dismissible,
    comboCategory: original.comboCategory,
    // Place data from alternative
    placeId: alternative.placeId,
    placeName: alternative.placeName,
    placeType: alternative.placeType,
    address: alternative.address,
    rating: alternative.rating,
    reviewCount: alternative.reviewCount,
    imageUrl: alternative.imageUrl,
    imageUrls: alternative.imageUrls,
    priceLevelLabel: alternative.priceLevelLabel,
    priceTier: alternative.priceTier as CuratedStop['priceTier'],
    priceMin: alternative.priceMin,
    priceMax: alternative.priceMax,
    openingHours: alternative.openingHours as Record<string, string>,
    // ORCH-0677.QA-1: honest unknown (Constitution #9). StopAlternative
    // doesn't carry openingHours.openNow, so we cannot derive truthfully
    // here. Consumers compute live via useIsPlaceOpen(openingHours), not
    // stop.isOpenNow directly — verified at ExpandedCardModal:1191,
    // ActionButtons:121, ProposeDateTimeModal:128.
    isOpenNow: null,
    website: alternative.website,
    lat: alternative.lat,
    lng: alternative.lng,
    distanceFromUserKm: Math.round(distFromUser * 100) / 100,
    travelTimeFromUserMin: Math.round(travelFromUser),
    travelTimeFromPreviousStopMin: travelFromPrev !== null ? Math.round(travelFromPrev) : null,
    travelModeFromPreviousStop: original.stopNumber > 1 ? travelMode : null,
    aiDescription: alternative.aiDescription,
    estimatedDurationMinutes: alternative.estimatedDurationMinutes,
  };
}

// ── Replace Stop in Card ───────────────────────────────────────────────────

export function replaceStopInCard(
  card: CuratedExperienceCard,
  stopIndex: number,
  replacement: StopAlternative,
  travelMode: string,
  userLat: number,
  userLng: number,
): CuratedExperienceCard {
  const newStops = [...card.stops];

  // Previous stop coordinates for travel time calculation
  const prevStop = stopIndex > 0 ? newStops[stopIndex - 1] : null;
  const prevLat = prevStop ? prevStop.lat : null;
  const prevLng = prevStop ? prevStop.lng : null;

  // Build the replacement stop
  const newStop = buildReplacementStop(
    newStops[stopIndex],
    replacement,
    travelMode,
    prevLat,
    prevLng,
    userLat,
    userLng,
  );
  newStops[stopIndex] = newStop;

  // Recalculate travel time for the NEXT stop (now relative to the new stop)
  if (stopIndex + 1 < newStops.length) {
    const nextStop = newStops[stopIndex + 1];
    const distToNext = haversineKm(newStop.lat, newStop.lng, nextStop.lat, nextStop.lng);
    newStops[stopIndex + 1] = {
      ...nextStop,
      travelTimeFromPreviousStopMin: Math.round(estimateTravelMinutes(distToNext, travelMode)),
      travelModeFromPreviousStop: travelMode,
    };
  }

  // Recalculate aggregates
  const mainStops = newStops.filter(s => !s.optional);
  const title = mainStops.map(s => s.placeName).join(' → ');
  const totalPriceMin = mainStops.reduce((sum, s) => sum + s.priceMin, 0);
  const totalPriceMax = mainStops.reduce((sum, s) => sum + s.priceMax, 0);
  const totalDuration =
    mainStops.reduce((sum, s) => sum + (s.estimatedDurationMinutes || 45), 0) +
    mainStops.slice(1).reduce((sum, s) => sum + (s.travelTimeFromPreviousStopMin ?? 0), 0);

  // Clear shopping list for picnic cards (EC-3)
  const shoppingList = card.experienceType === 'picnic-dates'
    ? [...PICNIC_STATIC_SHOPPING_LIST]
    : card.shoppingList;

  return {
    ...card,
    stops: newStops,
    title,
    totalPriceMin,
    totalPriceMax,
    estimatedDurationMinutes: totalDuration,
    shoppingList,
    // Keep original card ID (EC-1: solo save upsert works correctly)
  };
}
