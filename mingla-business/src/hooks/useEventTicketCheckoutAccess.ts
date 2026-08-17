/**
 * useEventTicketCheckoutAccess — issue #2101 [named-buyer checkout].
 *
 * The ONE query-key and cache owner for the named-buyer checkout policy. Both
 * the owner-only Business card and the public buyer eligibility read key off
 * this factory (Constitution #4 — no inline key arrays anywhere else).
 *
 * AUTH SCOPING. Eligibility is a per-identity fact, so the public key carries an
 * `authScope` of the signed-in UUID or the literal `'anon'`. A sign-in,
 * sign-out or user change cancels and REMOVES the previous `eligibility(eventId)`
 * subtree before the new scoped key fetches, so one viewer can never read a
 * decision computed for another (Constitution #6). No token ever enters a key.
 *
 * `loading` BINDING (recorded gap in the Amendment 7 review, non-blocking
 * finding 2). `loading` means "no eligibility data yet FOR THE CURRENT AUTH
 * SCOPE" — never a background refetch over data already resolved for that
 * scope. Amendment 1 §A7 pins `staleTime: 0` + `refetchOnMount: 'always'`, so
 * reading `isFetching` here would re-disable the primary CTA on EVERY mount
 * even with resolved data — precisely the bug class registered at
 * `docs/INVARIANT_REGISTRY.md:6537` (a fetched list must not be downgraded to
 * loading because a background fetch is in flight). The binding below is
 * therefore `data === undefined` for the scoped key, which is still fail-closed
 * (no eligibility is ever fabricated before the first resolution) while a
 * refetch keeps serving the last resolved decision.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  addSelfToEventTicketCheckoutAccess,
  addUsernameToEventTicketCheckoutAccess,
  fetchEventTicketCheckoutAccess,
  fetchPublicTicketCheckoutAccess,
  removeEventTicketCheckoutAccessMember,
  setEventTicketCheckoutAccessMode,
  type EventTicketCheckoutAccess,
  type EventTicketCheckoutAccessMutationResult,
  type PublicTicketCheckoutAccess,
} from "../services/eventTicketCheckoutAccessService";

export const eventTicketCheckoutAccessKeys = {
  all: ["eventTicketCheckoutAccess"] as const,
  event: (eventId: string) =>
    [...eventTicketCheckoutAccessKeys.all, eventId] as const,
  business: (eventId: string) =>
    [...eventTicketCheckoutAccessKeys.event(eventId), "business"] as const,
  eligibility: (eventId: string) =>
    [...eventTicketCheckoutAccessKeys.event(eventId), "eligibility"] as const,
  eligibilityFor: (eventId: string, authScope: string) =>
    [...eventTicketCheckoutAccessKeys.eligibility(eventId), authScope] as const,
};

export interface PublicTicketCheckoutEligibility {
  /** True ONLY until the first resolution for the current auth scope. */
  loading: boolean;
  error: boolean;
  data: PublicTicketCheckoutAccess | undefined;
  refetch: () => void;
}

/**
 * The anon-tolerant public eligibility read. Never calls `useAuth` for
 * gating — it reads the identity purely to scope the cache key.
 */
export const usePublicTicketCheckoutEligibility = (
  eventId: string,
): PublicTicketCheckoutEligibility => {
  const { user, isAuthReady } = useAuth();
  const queryClient = useQueryClient();
  const authScope = user?.id ?? "anon";
  const previousScopeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthReady) return;
    const previous = previousScopeRef.current;
    previousScopeRef.current = authScope;
    if (previous === null || previous === authScope) return;
    // Identity changed: drop every decision computed for the old scope before
    // the new scoped key fetches.
    const key = eventTicketCheckoutAccessKeys.eligibility(eventId);
    void queryClient.cancelQueries({ queryKey: key });
    queryClient.removeQueries({ queryKey: key });
  }, [authScope, eventId, isAuthReady, queryClient]);

  const query = useQuery({
    queryKey: eventTicketCheckoutAccessKeys.eligibilityFor(eventId, authScope),
    // Anon-tolerant, but only once auth resolution has SETTLED — querying
    // before that would key a decision under 'anon' for a user who is in fact
    // signed in, and then serve it from cache.
    enabled: eventId.length > 0 && isAuthReady,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () => fetchPublicTicketCheckoutAccess(eventId),
  });

  const refetch = useCallback((): void => {
    void query.refetch();
  }, [query]);

  return {
    // Initial resolution ONLY. `isFetching` is deliberately NOT read here.
    loading: !isAuthReady || (query.data === undefined && !query.isError),
    error: query.isError,
    data: query.data,
    refetch,
  };
};

export interface EventTicketCheckoutAccessAdmin {
  loading: boolean;
  error: unknown;
  data: EventTicketCheckoutAccess | undefined;
  refetch: () => void;
  addSelf: UseMutationResult<
    EventTicketCheckoutAccessMutationResult,
    unknown,
    { expectedConfigRevision: number; requestId: string }
  >;
  addUsername: UseMutationResult<
    EventTicketCheckoutAccessMutationResult,
    unknown,
    { username: string; expectedConfigRevision: number; requestId: string }
  >;
  removeMember: UseMutationResult<
    EventTicketCheckoutAccessMutationResult,
    unknown,
    { membershipId: string; expectedConfigRevision: number; requestId: string }
  >;
  setMode: UseMutationResult<
    EventTicketCheckoutAccessMutationResult,
    unknown,
    {
      mode: "unrestricted" | "named_buyers";
      expectedConfigRevision: number;
      requestId: string;
    }
  >;
}

/** Owner-only Business read + the four mutations. */
export const useEventTicketCheckoutAccess = (
  eventId: string,
): EventTicketCheckoutAccessAdmin => {
  const { isAuthReady } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: eventTicketCheckoutAccessKeys.business(eventId),
    enabled: eventId.length > 0 && isAuthReady,
    staleTime: 0,
    queryFn: () => fetchEventTicketCheckoutAccess(eventId),
  });

  // Every successful mutation invalidates the owner view AND the FULL public
  // eligibility subtree for this event, so a buyer preview can never keep a
  // decision the policy just superseded.
  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({
      queryKey: eventTicketCheckoutAccessKeys.business(eventId),
    });
    void queryClient.invalidateQueries({
      queryKey: eventTicketCheckoutAccessKeys.eligibility(eventId),
    });
    void queryClient.refetchQueries({
      queryKey: eventTicketCheckoutAccessKeys.eligibility(eventId),
    });
  }, [eventId, queryClient]);

  const addSelf = useMutation({
    mutationFn: (input: {
      expectedConfigRevision: number;
      requestId: string;
    }) => addSelfToEventTicketCheckoutAccess({ eventId, ...input }),
    onSuccess: invalidate,
  });

  const addUsername = useMutation({
    mutationFn: (input: {
      username: string;
      expectedConfigRevision: number;
      requestId: string;
    }) => addUsernameToEventTicketCheckoutAccess({ eventId, ...input }),
    onSuccess: invalidate,
  });

  const removeMember = useMutation({
    mutationFn: (input: {
      membershipId: string;
      expectedConfigRevision: number;
      requestId: string;
    }) => removeEventTicketCheckoutAccessMember({ eventId, ...input }),
    onSuccess: invalidate,
  });

  const setMode = useMutation({
    mutationFn: (input: {
      mode: "unrestricted" | "named_buyers";
      expectedConfigRevision: number;
      requestId: string;
    }) => setEventTicketCheckoutAccessMode({ eventId, ...input }),
    onSuccess: invalidate,
  });

  const refetch = useCallback((): void => {
    void query.refetch();
  }, [query]);

  return useMemo(
    () => ({
      loading: !isAuthReady || (query.data === undefined && !query.isError),
      error: query.isError ? query.error : null,
      data: query.data,
      refetch,
      addSelf,
      addUsername,
      removeMember,
      setMode,
    }),
    [
      isAuthReady,
      query.data,
      query.isError,
      query.error,
      refetch,
      addSelf,
      addUsername,
      removeMember,
      setMode,
    ],
  );
};
