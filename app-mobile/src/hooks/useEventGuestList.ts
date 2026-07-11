/**
 * useEventGuestList — ORCH-1341 [guest-list-sheet-consumer] (META-ORCH-1337).
 *
 * The ONE React-Query read for EventGuestListSheet, wrapping ORCH-1338's
 * `peer_list_event_guests` via socialProofService.fetchPeerGuestList.
 *
 * Key from the central `guestListKeys` factory ONLY (Constitution #4 — the
 * queryKeys.ts header's "one factory per domain entity" rule; never a literal
 * key string here).
 *
 * Fresh fetch on EVERY open (DESIGN §2.6): `staleTime: 0` + `gcTime: 0` mean
 * every open starts at `isLoading` ⇒ a deterministic skeleton→content
 * transition, no stale-roster flash, and closing mid-fetch disables the query
 * (rapid open/close safe — the closed sheet holds no cache entry).
 *
 * The hook performs NO block filtering, NO visibility filtering, NO name
 * synthesis — the payload is privacy-final server-side (D1/D2; SPEC §4.2/T-8).
 * Server data stays in React Query; no Zustand anywhere in this leg.
 */
import { useQuery } from "@tanstack/react-query";
import type { PeerGuestListPage } from "@mingla/offering-rendering";

import { guestListKeys } from "./queryKeys";
import { fetchPeerGuestList } from "../services/socialProofService";

export interface UseEventGuestListResult {
  /** The privacy-final page payload; null until the fetch resolves. */
  page: PeerGuestListPage | null;
  /**
   * True while a fetch is in flight with no settled content to show — the
   * sheet's skeleton condition. Covers BOTH the initial open-fetch and a
   * Retry refetch after an error (the §4.3 "Retry → skeleton" contract);
   * a background refetch of already-rendered content does not re-skeleton.
   */
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export const useEventGuestList = (
  eventId: string | null,
  visible: boolean,
): UseEventGuestListResult => {
  const query = useQuery<PeerGuestListPage, Error>({
    queryKey: guestListKeys.list(eventId ?? "none"),
    queryFn: () => fetchPeerGuestList(eventId as string),
    enabled: visible && eventId !== null,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });

  return {
    page: query.data ?? null,
    isLoading: query.data === undefined && query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
    refetch: () => {
      void query.refetch();
    },
  };
};
