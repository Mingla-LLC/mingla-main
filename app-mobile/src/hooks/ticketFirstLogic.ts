/** #4063 — dependency-free ticket-first onboarding decision core. */

export type OnboardingMode = "full" | "ticket_first" | "finish_setup";

export interface TicketFirstDecisionInput {
  pendingClaim: { code: string } | null;
  lastClaim: { count: number } | null;
  hasUpcomingPurchase: boolean;
}

export type DeferredLocationSeed = {
  city: string;
  lat: number;
  lng: number;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * #4063 — turn the authenticated Purchases order projection into the optional
 * city seed used by Finish Setup. PostgreSQL point values can arrive as
 * `(lng,lat)`, `{x,y}`, or an already-normalized `{lat,lng}` depending on the
 * Supabase client/runtime, so the parser accepts only those bounded shapes.
 */
export function deferredLocationSeedFromOrder(
  value: unknown,
): DeferredLocationSeed | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const city = typeof row.city === "string" ? row.city.trim() : "";
  if (!city) return null;

  const geo = row.locationGeo;
  let lat: number | null = null;
  let lng: number | null = null;
  if (typeof geo === "string") {
    const match = geo.trim().match(/^\(([^,]+),([^,]+)\)$/);
    if (match) {
      lng = finiteNumber(match[1]);
      lat = finiteNumber(match[2]);
    }
  } else if (Array.isArray(geo) && geo.length >= 2) {
    lng = finiteNumber(geo[0]);
    lat = finiteNumber(geo[1]);
  } else if (typeof geo === "object" && geo !== null) {
    const point = geo as Record<string, unknown>;
    lat = finiteNumber(point.lat ?? point.y);
    lng = finiteNumber(point.lng ?? point.x);
  }
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { city, lat, lng };
}

export function decideOnboardingMode(
  input: TicketFirstDecisionInput,
): OnboardingMode {
  if (
    input.pendingClaim !== null ||
    (input.lastClaim?.count ?? 0) > 0 ||
    input.hasUpcomingPurchase
  ) return "ticket_first";
  return "full";
}
