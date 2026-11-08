/**
 * Issue #4261 — the plan form's place search (spec 6).
 *
 * 1. Fewer than 2 characters: no network.
 * 2. Mingla's places first (`search_plan_places`, near the phone when location
 *    permission is ALREADY granted; this form never asks for it).
 * 3. Google only when the pool returned fewer than 5 rows and the query has at
 *    least 3 characters, for the remaining slots.
 * 4. The typed `Use "{q}"` row always last.
 * 5. A source that fails keeps what loaded and sets `partialFailure` (the form
 *    says "Some results couldn't load."), never fake rows.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { planKeys } from './queryKeys';
import { searchPool, suggestPlaces } from '../services/planPlaceSearchService';
import { mergePlaceResults, type PlaceResultRow } from '../components/chat/planModel';

const DEBOUNCE_MS = 250;
const POOL_LIMIT = 5;

interface SearchResult {
  rows: PlaceResultRow[];
  partialFailure: boolean;
}

function useDebounced(value: string, ms: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [ms, value]);
  return debounced;
}

/** The phone's last known position, only when permission was already granted. */
function useGrantedLocation(active: boolean): { lat: number; lng: number } | null {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const position = await Location.getLastKnownPositionAsync();
        if (live && position) setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
      } catch (error) {
        console.warn('[usePlanPlaceSearch] location unavailable; searching without it', error);
      }
    })();
    return () => {
      live = false;
    };
  }, [active]);
  return coords;
}

export function usePlanPlaceSearch(query: string, sessionToken: string, active: boolean) {
  const debounced = useDebounced(query.trim(), DEBOUNCE_MS);
  const coords = useGrantedLocation(active);
  const lat = coords ? Number(coords.lat.toFixed(3)) : null;
  const lng = coords ? Number(coords.lng.toFixed(3)) : null;
  const searchable = active && debounced.length >= 2;

  const result = useQuery<SearchResult>({
    queryKey: planKeys.placeSearch(debounced, lat, lng),
    enabled: searchable,
    staleTime: 60_000,
    queryFn: async () => {
      let partialFailure = false;
      let pool: Awaited<ReturnType<typeof searchPool>> = [];
      try {
        pool = await searchPool(debounced, lat, lng, POOL_LIMIT);
      } catch (error) {
        console.warn('[usePlanPlaceSearch] Mingla places failed', error);
        partialFailure = true;
      }
      let searched: Awaited<ReturnType<typeof suggestPlaces>> = [];
      if (pool.length < POOL_LIMIT && debounced.length >= 3) {
        try {
          searched = await suggestPlaces(
            debounced,
            sessionToken,
            lat !== null && lng !== null ? { lat, lng } : null,
            POOL_LIMIT - pool.length,
          );
        } catch (error) {
          console.warn('[usePlanPlaceSearch] Google suggest failed', error);
          partialFailure = true;
        }
      }
      return {
        rows: mergePlaceResults(
          pool.map((row) => ({ id: row.id, name: row.name, area: row.area, lat: row.lat, lng: row.lng })),
          searched,
          '',
        ),
        partialFailure,
      };
    },
  });

  // The typed row follows what you type now, not the debounced query.
  const rows = useMemo(() => {
    const typed = query.trim();
    const loaded = searchable ? result.data?.rows ?? [] : [];
    return typed ? [...loaded, ...mergePlaceResults([], [], typed)] : loaded;
  }, [query, result.data?.rows, searchable]);

  return {
    rows,
    isSearching: searchable && result.isFetching,
    partialFailure: searchable && (result.data?.partialFailure ?? false),
    hasQuery: query.trim().length > 0,
  };
}
