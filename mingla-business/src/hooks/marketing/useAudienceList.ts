/**
 * useAudienceList — Audiences tab data source (ORCH-0863).
 *
 * Returns the merged real+virtual entry list (from
 * `listAudiencesForAccount`) PLUS a batched per-row reach lookup
 * (`Map<client_key, AudienceReachSummary | null>`). Per-row reach
 * failures degrade silently: the entry gets `reach=null` and the row
 * remains tappable. No global error overlay (SPEC SC-8).
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../../context/AuthContext";
import {
  listAudiencesForAccount,
  resolveBrandBuyers,
  resolveEventBuyers,
} from "../../services/marketing/marketingAudienceService";
import type {
  AudienceListEntry,
  AudienceReachSummary,
} from "../../types/marketing";
import { marketingKeys } from "./marketingKeys";

const STALE_TIME_MS = 60 * 1000;

export type ReachMap = Map<string, AudienceReachSummary | null>;

export interface UseAudienceListState {
  entries: AudienceListEntry[];
  reach: ReachMap;
  /** True until the initial reach batch resolves; per-row "Loading reach…" placeholder gate. */
  reachLoading: boolean;
  isLoading: boolean;
  isError: boolean;
  /**
   * True once the underlying audiences query has resolved at least one
   * fetch. `false` while `enabled: false` (auth bootstrap). Per
   * I-DISABLED-QUERY-IS-LOADING (ORCH-0889).
   */
  hasResolved: boolean;
  refetch: UseQueryResult<AudienceListEntry[]>["refetch"];
}

export function useAudienceList(
  accountId: string | null | undefined,
): UseAudienceListState {
  // ORCH-1004 — audiences read auth.uid()-scoped buyer rollups; gate on auth.
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady && typeof accountId === "string" && accountId.length > 0;
  const query = useQuery<AudienceListEntry[]>({
    queryKey: enabled
      ? marketingKeys.audiences.list(accountId as string)
      : marketingKeys.audiences.all,
    queryFn: async () =>
      listAudiencesForAccount({ account_id: accountId as string }),
    enabled,
    staleTime: STALE_TIME_MS,
  });

  const [reach, setReach] = useState<ReachMap>(new Map());
  const [reachLoading, setReachLoading] = useState<boolean>(false);

  // Fire the batched reach lookup whenever the entries list changes shape.
  // Stable key: concatenation of client_keys (order-sensitive — service
  // already sorts deterministically per SPEC §6.2.3 step 8).
  const entriesSig = useMemo(
    () => (query.data ?? []).map((e) => e.client_key).join("|"),
    [query.data],
  );

  useEffect(() => {
    const entries = query.data ?? [];
    if (entries.length === 0) {
      setReach(new Map());
      setReachLoading(false);
      return;
    }
    let cancelled = false;
    setReachLoading(true);
    (async () => {
      const results = await Promise.allSettled(
        entries.map((e) => {
          if (e.kind === "brand_buyers") {
            return resolveBrandBuyers(e.brand_id).then((r) => ({
              key: e.client_key,
              summary: r.reach,
            }));
          }
          if (e.event_id === null) {
            throw new Error(`event_buyers entry missing event_id: ${e.client_key}`);
          }
          return resolveEventBuyers(e.event_id).then((r) => ({
            key: e.client_key,
            summary: r.reach,
          }));
        }),
      );
      if (cancelled) return;
      const next: ReachMap = new Map();
      for (const r of results) {
        if (r.status === "fulfilled") {
          next.set(r.value.key, r.value.summary);
        }
        // Per-row failure: silently drop (entry will show "—" via null lookup).
      }
      // Backfill nulls for entries whose resolution failed so the UI knows
      // resolution was attempted (vs not yet attempted).
      for (const e of entries) {
        if (!next.has(e.client_key)) next.set(e.client_key, null);
      }
      setReach(next);
      setReachLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [entriesSig, query.data]);

  return useMemo(
    () => ({
      entries: query.data ?? [],
      reach,
      reachLoading,
      isLoading: query.isLoading,
      isError: query.isError,
      hasResolved: query.isFetched,
      refetch: query.refetch,
    }),
    [
      query.data,
      query.isLoading,
      query.isError,
      query.isFetched,
      query.refetch,
      reach,
      reachLoading,
    ],
  );
}
