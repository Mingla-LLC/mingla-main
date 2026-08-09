/**
 * Issue #1648 — resolve the s0 address against our own directory.
 *
 * Unlike `usePoolMatchSearch` (which debounces because it runs per KEYSTROKE),
 * this fires on a discrete, deliberate act: the brand picked a building. So
 * there is no debounce — there is a KEY. `addressMatchQueryKey` changes if and
 * only if the picked place changes, which means re-renders are free, a re-pick
 * of the same address never spends a second Google call, and a slow response
 * for a superseded pick can never land on the current one.
 *
 * A failure here NEVER blocks the wizard. The address is valid either way; the
 * only thing lost is the chance to recognise them, and that is worth a quiet
 * line, not a dead end.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  addressMatchQueryKey,
  shouldShowAddressMatch,
} from "../components/venue/venueAddressMatchPolicy";
import { matchPoolByAddress } from "../services/poolSearchService";
import { useDraftVenueStore } from "../store/draftVenueStore";
import type { PoolMatch } from "../types/poolMatch";

export interface UseVenueAddressPoolMatchResult {
  /** The place we recognised, or null (no match, dismissed, or not looked up). */
  match: PoolMatch | null;
  loading: boolean;
  /** Non-null ONLY when the lookup itself failed — never a silent "no match". */
  error: string | null;
  /** Remember this place as answered, for this draft, for good. */
  dismiss: () => void;
}

/** One honest line per failure mode. Never phrased as "we don't know you". */
function messageForFailure(e: unknown): string {
  const code = e instanceof Error ? e.message : "";
  if (code === "rate_limited") {
    return "Too many checks just now — carry on, or come back to this step in a minute.";
  }
  return "Couldn't check our directory for a match — you can carry on.";
}

export function useVenueAddressPoolMatch(): UseVenueAddressPoolMatchResult {
  const formattedAddress = useDraftVenueStore((s) => s.formattedAddress);
  const lat = useDraftVenueStore((s) => s.lat);
  const lng = useDraftVenueStore((s) => s.lng);
  const coordinatePrecision = useDraftVenueStore((s) => s.coordinatePrecision);
  const placePoolId = useDraftVenueStore((s) => s.placePoolId);
  const claim = useDraftVenueStore((s) => s.claim);
  const dismissedIds = useDraftVenueStore((s) => s.dismissedPoolMatchIds);
  const patch = useDraftVenueStore((s) => s.patch);

  const queryKey = addressMatchQueryKey({
    formattedAddress,
    lat,
    lng,
    coordinatePrecision,
    placePoolId,
    claim,
  });

  const [match, setMatch] = useState<PoolMatch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Latest-wins guard, same posture as VenueStep1Address's own generation ref.
  const activeKeyRef = useRef<string | null>(null);

  useEffect(() => {
    activeKeyRef.current = queryKey;
    setMatch(null);
    setError(null);

    if (queryKey === null) {
      setLoading(false);
      return undefined;
    }
    // Narrowed by addressMatchQueryKey returning non-null.
    const pickedLat = lat as number;
    const pickedLng = lng as number;

    let cancelled = false;
    setLoading(true);
    void (async (): Promise<void> => {
      try {
        const found = await matchPoolByAddress({
          formattedAddress: formattedAddress.trim(),
          lat: pickedLat,
          lng: pickedLng,
        });
        if (cancelled || activeKeyRef.current !== queryKey) return;
        setMatch(found);
      } catch (e) {
        if (cancelled || activeKeyRef.current !== queryKey) return;
        setMatch(null);
        setError(messageForFailure(e));
      } finally {
        if (!cancelled && activeKeyRef.current === queryKey) setLoading(false);
      }
    })();

    return (): void => {
      cancelled = true;
    };
    // `queryKey` encodes address+lat+lng; the rest are listed for the linter and
    // cannot change without changing the key.
  }, [queryKey, formattedAddress, lat, lng]);

  const dismiss = useCallback((): void => {
    const id = match?.id;
    if (id === undefined) return;
    const current =
      useDraftVenueStore.getState().dismissedPoolMatchIds ?? [];
    if (!current.includes(id)) {
      patch({ dismissedPoolMatchIds: [...current, id] });
    }
    setMatch(null);
  }, [match, patch]);

  return {
    match: shouldShowAddressMatch(match, dismissedIds) ? match : null,
    loading,
    error,
    dismiss,
  };
}
