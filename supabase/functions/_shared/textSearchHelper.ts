/**
 * Text Search Helper — fallback for non-Google Place API types.
 *
 * Some category types (e.g., sip_and_paint, cooking_classes, roller_coaster)
 * are not valid Google Places API (New) types. For these, we use
 * places:searchText with keyword queries instead of searchNearby with
 * includedTypes.
 */

export async function textSearchPlaces(
  apiKey: string,
  keywords: string[],
  lat: number,
  lng: number,
  radiusMeters: number,
  maxPerKeyword: number = 5
): Promise<Record<string, any[]>> {
  const results: Record<string, any[]> = {};

  await Promise.all(keywords.map(async (keyword) => {
    try {
      const query = keyword.replace(/_/g, ' ');
      const response = await fetch(
        'https://places.googleapis.com/v1/places:searchText',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.photos,places.regularOpeningHours,places.websiteUri,places.primaryType,places.types,places.businessStatus',
          },
          body: JSON.stringify({
            textQuery: query,
            locationBias: {
              circle: {
                center: { latitude: lat, longitude: lng },
                radius: radiusMeters,
              },
            },
            maxResultCount: maxPerKeyword,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        results[keyword] = data.places ?? [];
      } else {
        results[keyword] = [];
      }
    } catch {
      results[keyword] = [];
    }
  }));

  return results;
}
