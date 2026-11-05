/**
 * Issue #4261 — "Where" search in the plan form (spec 6): Mingla's own places
 * first (`search_plan_places`), then Mapbox through the existing
 * `mapbox-geocode` suggest / retrieve actions (filter-free; no new action).
 * Every function throws on failure so the form can say "Some results couldn't
 * load." instead of silently showing fewer rows.
 */
import { supabase } from './supabase';
import type { PlanPlaceSearchRow } from '../types/chatPlans';

export interface MapboxPlaceSuggestion {
  mapboxId: string;
  name: string;
  area: string | null;
}

export interface MapboxPlaceDetails {
  mapboxId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
}

export async function searchPool(
  query: string,
  lat: number | null,
  lng: number | null,
  limit = 5,
): Promise<PlanPlaceSearchRow[]> {
  const { data, error } = await supabase.rpc('search_plan_places', {
    p_query: query,
    p_lat: lat,
    p_lng: lng,
    p_limit: limit,
  });
  if (error) throw new Error(error.message || 'search_plan_places failed');
  return ((data ?? []) as PlanPlaceSearchRow[]).filter((row) => typeof row?.id === 'string' && typeof row?.name === 'string');
}

interface RawSuggestion {
  placeId?: unknown;
  displayName?: unknown;
  fullAddress?: unknown;
}

export async function suggestMapbox(
  query: string,
  sessionToken: string,
  proximity: { lat: number; lng: number } | null,
  limit: number,
): Promise<MapboxPlaceSuggestion[]> {
  const { data, error } = await supabase.functions.invoke('mapbox-geocode', {
    body: {
      action: 'suggest',
      query,
      session_token: sessionToken,
      ...(proximity ? { proximity: `${proximity.lng},${proximity.lat}` } : {}),
      limit: Math.max(1, Math.min(5, limit)),
    },
  });
  if (error) throw new Error(error.message || 'mapbox suggest failed');
  const rows: RawSuggestion[] = Array.isArray(data?.suggestions) ? data.suggestions : [];
  return rows
    .filter((row) => typeof row.placeId === 'string' && typeof row.displayName === 'string')
    .map((row) => ({
      mapboxId: row.placeId as string,
      name: row.displayName as string,
      area: typeof row.fullAddress === 'string' && row.fullAddress.trim() ? row.fullAddress.trim() : null,
    }));
}

export async function retrieveMapbox(
  mapboxId: string,
  sessionToken: string,
  fallbackName: string,
): Promise<MapboxPlaceDetails> {
  const { data, error } = await supabase.functions.invoke('mapbox-geocode', {
    body: { action: 'retrieve', mapbox_id: mapboxId, session_token: sessionToken },
  });
  if (error) throw new Error(error.message || 'mapbox retrieve failed');
  const details = data?.details as
    | { formattedAddress?: unknown; location?: { lat?: unknown; lng?: unknown } }
    | undefined;
  const lat = details?.location?.lat;
  const lng = details?.location?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') throw new Error('mapbox retrieve returned no coordinates');
  const address = typeof details?.formattedAddress === 'string' && details.formattedAddress.trim()
    ? details.formattedAddress.trim().slice(0, 240)
    : null;
  return { mapboxId, name: fallbackName.slice(0, 120), address, lat, lng };
}
