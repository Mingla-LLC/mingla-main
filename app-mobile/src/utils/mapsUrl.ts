// ORCH-1237 — universal Google Maps link. Coordinates are the reliable anchor;
// the label remains in the signature for caller compatibility but never changes
// the destination URL.
export function buildMapsUrl(
  lat: number,
  lng: number,
  _label: string | null,
): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export type MapPoint = { lat: number; lng: number };

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse the bounded PostgreSQL point shapes emitted by Supabase clients. */
export function parseMapPoint(value: unknown): MapPoint | null {
  let lat: number | null = null;
  let lng: number | null = null;
  if (typeof value === "string") {
    const match = value.trim().match(/^\(([^,]+),([^,]+)\)$/);
    if (match) {
      lng = finite(match[1]);
      lat = finite(match[2]);
    }
  } else if (Array.isArray(value) && value.length >= 2) {
    lng = finite(value[0]);
    lat = finite(value[1]);
  } else if (typeof value === "object" && value !== null) {
    const point = value as Record<string, unknown>;
    lat = finite(point.lat ?? point.y);
    lng = finite(point.lng ?? point.x);
  }
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
