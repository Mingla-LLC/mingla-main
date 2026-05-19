/**
 * Ve2 — debounced place_pool search for brand creation name field.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { searchPoolMatches } from "../services/poolSearchService";
import type { PoolMatch } from "../types/poolMatch";
import { POOL_SEARCH_DEBOUNCE_MS, POOL_SEARCH_MIN_QUERY_LENGTH } from "../types/poolMatch";

export interface UsePoolMatchSearchResult {
  match: PoolMatch | null;
  loading: boolean;
  error: string | null;
  clearError: () => void;
}

export function usePoolMatchSearch(query: string): UsePoolMatchSearchResult {
  const [match, setMatch] = useState<PoolMatch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clearError = useCallback((): void => {
    setError(null);
  }, []);

  useEffect(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;

    const q = query.trim();
    if (q.length < POOL_SEARCH_MIN_QUERY_LENGTH) {
      setMatch(null);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      void (async (): Promise<void> => {
        try {
          const matches = await searchPoolMatches(q, {
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          setMatch(matches[0] ?? null);
        } catch (e) {
          if (controller.signal.aborted) return;
          const msg = e instanceof Error ? e.message : "search_failed";
          if (msg === "rate_limited") {
            setError("Too many searches — wait a moment and try again.");
          } else {
            setError("Could not search our directory. Check your connection.");
          }
          setMatch(null);
        } finally {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        }
      })();
    }, POOL_SEARCH_DEBOUNCE_MS);

    return (): void => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
      abortRef.current?.abort();
    };
  }, [query]);

  return { match, loading, error, clearError };
}
