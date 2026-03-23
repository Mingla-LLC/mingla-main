const SPEED_KMH: Record<string, number> = {
  walking: 4.5,
  driving: 40,
  transit: 25,
  bicycling: 15,
  biking: 15,
};

function haversineKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function computeTravelInfo(
  userLat: number, userLng: number,
  placeLat: number, placeLng: number,
  travelMode: string
): { travelTime: string; distance: string } {
  const distKm = haversineKm(userLat, userLng, placeLat, placeLng);
  const speed = SPEED_KMH[travelMode] || SPEED_KMH.walking;
  const minutes = Math.max(1, Math.round((distKm / speed) * 60));
  return {
    travelTime: `${minutes} min`,
    distance: `${Math.round(distKm * 10) / 10} km`,
  };
}
