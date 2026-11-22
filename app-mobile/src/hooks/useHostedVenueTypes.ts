/**
 * #4490 Explorer W6b — the venue types the deck may offer as chips here
 * ("Places on Mingla"): `discover-cards { action: "venue_types" }`, which uses
 * the deck's own radius for the travel limit. Server state: never persisted
 * (queryPersistence), 10-minute stale time, one key factory.
 *
 * The row is hidden while this loads, when it fails and when it is empty, so
 * the rest of the preferences sheet always works (no dead chip).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../services/supabase";
import { isVenueTypeChipKey, type VenueTypeChipKey } from "@mingla/brand-rendering/venueTypeLabels";

export interface HostedVenueType {
  key: VenueTypeChipKey;
  count: number;
}

export const HOSTED_VENUE_TYPES_STALE_MS = 10 * 60 * 1000;

export const hostedVenueTypeKeys = {
  all: ["hostedVenueTypes"] as const,
  near: (lat: number, lng: number, travelMode: string, travelLimit: number) =>
    [...hostedVenueTypeKeys.all, Number(lat.toFixed(3)), Number(lng.toFixed(3)), travelMode, travelLimit] as const,
};

/** Only known chip types with supply, in the server's (chip) order. Pure, for tests. */
export function parseHostedVenueTypes(raw: unknown): HostedVenueType[] {
  const types = (raw as { types?: unknown } | null)?.types;
  if (!Array.isArray(types)) return [];
  const out: HostedVenueType[] = [];
  for (const item of types) {
    const key = (item as { key?: unknown })?.key;
    const count = Number((item as { count?: unknown })?.count);
    if (isVenueTypeChipKey(key) && Number.isFinite(count) && count > 0 && !out.some((t) => t.key === key)) {
      out.push({ key, count });
    }
  }
  return out;
}

export async function fetchHostedVenueTypes(
  location: { lat: number; lng: number },
  travelMode: string,
  travelLimit: number,
): Promise<HostedVenueType[]> {
  const { data, error } = await supabase.functions.invoke("discover-cards", {
    body: { action: "venue_types", location, travelMode, travelConstraintValue: travelLimit },
  });
  if (error) throw error;
  return parseHostedVenueTypes(data);
}

export function useHostedVenueTypes(
  location: { lat: number; lng: number } | null,
  travelMode: string,
  travelLimit: number | "",
  enabled = true,
) {
  const limit = typeof travelLimit === "number" && travelLimit >= 5 ? travelLimit : null;
  return useQuery({
    queryKey: location && limit !== null
      ? hostedVenueTypeKeys.near(location.lat, location.lng, travelMode, limit)
      : [...hostedVenueTypeKeys.all, "idle"],
    queryFn: () => fetchHostedVenueTypes(location!, travelMode, limit!),
    enabled: enabled && location !== null && limit !== null,
    staleTime: HOSTED_VENUE_TYPES_STALE_MS,
    retry: 1,
  });
}
