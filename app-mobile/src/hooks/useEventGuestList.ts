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
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { PeerGuestListPage } from "@mingla/offering-rendering";

import { guestListKeys } from "./queryKeys";
import { fetchPeerGuestList } from "../services/socialProofService";
import {
  GuestListAttendanceRequiredError,
  GuestListGatedError,
  GuestListUnavailableError,
} from "../services/socialProofService";
import {
  rosterDenialPolicy,
  type RosterAuthorizationFailure,
} from "../utils/attendanceClaimDeepLink";

export interface UseEventGuestListResult {
  /** The privacy-final page payload; null until the fetch resolves. */
  page: PeerGuestListPage | null;
  pages: PeerGuestListPage[];
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
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError: boolean;
  authorizationRevoked: boolean;
}

export const useEventGuestList = (
  eventId: string | null,
  visible: boolean,
): UseEventGuestListResult => {
  const queryClient = useQueryClient();
  const [terminalState, setTerminalState] = useState<{ error: Error; hadRows: boolean } | null>(null);
  useEffect(() => {
    setTerminalState(null);
    if (!visible && eventId !== null) {
      queryClient.removeQueries({ queryKey: guestListKeys.list(eventId), exact: true });
    }
  }, [eventId, queryClient, visible]);
  const query = useInfiniteQuery<PeerGuestListPage, Error>({
    queryKey: guestListKeys.list(eventId ?? "none"),
    queryFn: ({ pageParam }) => fetchPeerGuestList(eventId as string, Number(pageParam)),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: visible && eventId !== null && terminalState === null,
    staleTime: 0,
    gcTime: 0,
    retry: 1,
  });
  const denialCode: RosterAuthorizationFailure | null =
    query.error instanceof GuestListAttendanceRequiredError ? "attendance_required"
      : query.error instanceof GuestListGatedError ? "guest_list_private"
      : query.error instanceof GuestListUnavailableError ? "event_not_available"
      : null;
  const denial = rosterDenialPolicy(
    denialCode,
    query.data?.pages.some((page) => page.guests.length > 0) === true,
  );
  useEffect(() => {
    if (!denial.purge || query.error === null || eventId === null) return;
    setTerminalState({
      error: query.error,
      hadRows: denial.revoked,
    });
    queryClient.removeQueries({ queryKey: guestListKeys.list(eventId), exact: true });
  }, [denial.purge, denial.revoked, eventId, query.error, queryClient]);

  return {
    page: terminalState ? null : query.data?.pages[0] ?? null,
    pages: terminalState ? [] : query.data?.pages ?? [],
    isLoading: query.data === undefined && query.isFetching,
    isError: terminalState !== null || query.isError,
    error: terminalState?.error ?? query.error ?? null,
    refetch: () => {
      void query.refetch();
    },
    fetchNextPage: () => { void query.fetchNextPage(); },
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetchNextPageError: query.isFetchNextPageError,
    authorizationRevoked: terminalState?.hadRows === true,
  };
};
