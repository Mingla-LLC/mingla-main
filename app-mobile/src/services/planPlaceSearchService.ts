/**
 * Issue #4261 — "Where" search in the plan form (spec 6): Mingla's own places
 * first (`search_plan_places`), then Google (#4334) through the address
 * proxy's filter-free `suggest` / `retrieve` actions (no new action). Every
 * function throws on failure so the form can say "Some results couldn't load."
 * instead of silently showing fewer rows.
 */
import { ADDRESS_PROXY_FN, errorCodeFromInvokeError } from '@mingla/location-input';
import { supabase } from './supabase';
import type { PlanPlaceSearchRow } from '../types/chatPlans';

export interface SearchedPlaceSuggestion {
  providerPlaceId: string;
  name: string;
  area: string | null;
}

export interface SearchedPlaceDetails {
  providerPlaceId: string;
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

export async function suggestPlaces(
  query: string,
  sessionToken: string,
  proximity: { lat: number; lng: number } | null,
  limit: number,
): Promise<SearchedPlaceSuggestion[]> {
  const { data, error } = await supabase.functions.invoke(ADDRESS_PROXY_FN, {
    body: {
      action: 'suggest',
      query,
      session_token: sessionToken,
      ...(proximity ? { proximity: `${proximity.lng},${proximity.lat}` } : {}),
    },
  });
  if (error) throw new Error(`place_suggest_failed:${await errorCodeFromInvokeError(error)}`);
  const rows: RawSuggestion[] = Array.isArray(data?.suggestions) ? data.suggestions : [];
  return rows
    .filter((row) => typeof row.placeId === 'string' && typeof row.displayName === 'string')
    .slice(0, Math.max(1, Math.min(5, limit)))
    .map((row) => ({
      providerPlaceId: row.placeId as string,
      name: row.displayName as string,
      area: typeof row.fullAddress === 'string' && row.fullAddress.trim() ? row.fullAddress.trim() : null,
    }));
}

export async function retrievePlaceForPlan(
  providerPlaceId: string,
  sessionToken: string,
  fallbackName: string,
): Promise<SearchedPlaceDetails> {
  const { data, error } = await supabase.functions.invoke(ADDRESS_PROXY_FN, {
    body: { action: 'retrieve', place_id: providerPlaceId, session_token: sessionToken },
  });
  if (error) throw new Error(`place_retrieve_failed:${await errorCodeFromInvokeError(error)}`);
  const details = data?.details as
    | { placeId?: unknown; formattedAddress?: unknown; location?: { lat?: unknown; lng?: unknown } }
    | undefined;
  const lat = details?.location?.lat;
  const lng = details?.location?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') throw new Error('place_retrieve_failed:no_location');
  const address = typeof details?.formattedAddress === 'string' && details.formattedAddress.trim()
    ? details.formattedAddress.trim().slice(0, 240)
    : null;
  const id = typeof details?.placeId === 'string' && details.placeId ? details.placeId : providerPlaceId;
  return { providerPlaceId: id, name: fallbackName.slice(0, 120), address, lat, lng };
}
