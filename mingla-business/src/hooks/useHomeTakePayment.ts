/**
 * #4389 (screen HT) — the reads behind Home's "Take a payment" and the Tap to
 * Pay card. Kept light for Home's boot path: no Terminal session, no door
 * screens. The Tap to Pay "set up on this phone" answer lives in
 * useTapToPayWarmHint.ts (native only).
 */
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { fetchEventDoorSales } from "../services/doorSalesService";
import type { DoorSaleRecord } from "../types/doorSales";
import { doorTodaySummary } from "../utils/homeTakePayment";
import { doorSaleKeys } from "./useEventDoorSales";

/** "At the door today" over today's events, from the existing door order read. */
export function useDoorTodaySummary(eventIds: readonly string[]): {
  count: number;
  totalMajor: number;
  currency: string | null;
  isLoading: boolean;
} {
  const { isAuthReady } = useAuth();
  const results = useQueries({
    queries: eventIds.map((eventId) => ({
      queryKey: doorSaleKeys.byEvent(eventId),
      queryFn: () => fetchEventDoorSales(eventId),
      enabled: isAuthReady,
      staleTime: 10_000,
    })),
  });
  const isLoading = results.some((r) => r.isLoading);
  // One stable dependency for a variable number of queries.
  const stamp = results.map((r) => `${r.dataUpdatedAt}`).join(",");
  return useMemo(() => {
    const all: DoorSaleRecord[] = [];
    for (const r of results) if (r.data !== undefined) all.push(...r.data);
    return { ...doorTodaySummary(all, new Date()), isLoading };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `stamp` stands for the rows.
  }, [isLoading, stamp]);
}
