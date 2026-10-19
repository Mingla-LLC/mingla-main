/**
 * Ve2 — debounced place_pool search for brand creation name field.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { searchPoolMatches } from "../services/poolSearchService";
import type { PoolMatch } from "../types/poolMatch";
import { POOL_SEARCH_DEBOUNCE_MS, POOL_SEARCH_MIN_QUERY_LENGTH } from "../types/poolMatch";

export interface UsePoolMatchSearchResult {
  match: PoolMatch | null;
  matches: PoolMatch[];
  loading: boolean;
  error: string | null;
  clearError: () => void;
  /** #3040 B-C17 — run the same search again (the "Retry" button). */
  retry: () => void;
  /** #3040 B-C17 — true while a rate-limited Retry is held back (6 s). */
  retryWaiting: boolean;
}

/** #3040 B-C17 [A-17] — honest search copy: rate limit is not "offline". */
export const POOL_SEARCH_RATE_LIMITED_COPY = "Searching too fast — try again in a moment";
export const POOL_SEARCH_UNAVAILABLE_COPY = "Couldn't search right now";
export const POOL_SEARCH_RATE_LIMIT_RETRY_MS = 6_000;

export function usePoolMatchSearch(query: string): UsePoolMatchSearchResult {
  const [match, setMatch] = useState<PoolMatch | null>(null);
  const [matches, setMatches] = useState<PoolMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retryWaiting, setRetryWaiting] = useState(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      setMatches([]);
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
          setMatches(matches);
          setMatch(matches[0] ?? null);
        } catch (e) {
          if (controller.signal.aborted) return;
          const msg = e instanceof Error ? e.message : "search_failed";
          if (msg === "rate_limited") {
            setError(POOL_SEARCH_RATE_LIMITED_COPY);
            // Retry is held back so it cannot hit the same limit again.
            setRetryWaiting(true);
            if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              setRetryWaiting(false);
            }, POOL_SEARCH_RATE_LIMIT_RETRY_MS);
          } else {
            setError(POOL_SEARCH_UNAVAILABLE_COPY);
          }
          setMatch(null);
          setMatches([]);
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
  }, [attempt, query]);

  useEffect(() => () => {
    if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
  }, []);

  const retry = useCallback((): void => {
    if (retryWaiting) return;
    setAttempt((value) => value + 1);
  }, [retryWaiting]);

  return { match, matches, loading, error, clearError, retry, retryWaiting };
}
