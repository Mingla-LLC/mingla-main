/**
 * #4490 spec 08 O5 part B — Close the day, the cash drawer and Settings ›
 * Selling in person (venue-till). One key factory (`venueDayCloseKeys`, rule
 * 4). Money state is never persisted (rule 14): the day is read fresh, and
 * polled every 30 s while the screen is open so a payment that lands late
 * shows up without a reload.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  carryCheckOver,
  closeDay,
  fetchCashDrawer,
  fetchDaySummary,
  fetchTillSettings,
  recordCashMovement,
  reopenDay,
  saveTillSettings,
  type CashDrawer,
  type DaySummary,
  type TillSettings,
  type TillSettingsPatch,
} from "../services/venueDayCloseService";

export const venueDayCloseKeys = {
  all: (venueId: string) => ["venueDayClose", venueId] as const,
  day: (venueId: string, date: string | null) => ["venueDayClose", venueId, "day", date ?? "today"] as const,
  drawer: (venueId: string, date: string) => ["venueDayClose", venueId, "drawer", date] as const,
  settings: (venueId: string) => ["venueDayClose", venueId, "settings"] as const,
};

export const DAY_CLOSE_POLL_MS = 30_000;

export function useDaySummary(venueId: string | null, date: string | null): UseQueryResult<DaySummary> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && venueId !== null && venueId.length > 0;
  return useQuery<DaySummary>({
    queryKey: enabled ? venueDayCloseKeys.day(venueId as string, date) : ["venueDayClose", "disabled", "day"],
    enabled,
    staleTime: 5_000,
    refetchInterval: enabled ? DAY_CLOSE_POLL_MS : false,
    queryFn: () => fetchDaySummary(venueId as string, date),
  });
}

export function useCashDrawer(venueId: string | null, date: string | null, active: boolean): UseQueryResult<CashDrawer> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && active && venueId !== null && date !== null;
  return useQuery<CashDrawer>({
    queryKey: enabled ? venueDayCloseKeys.drawer(venueId as string, date as string) : ["venueDayClose", "disabled", "drawer"],
    enabled,
    staleTime: 5_000,
    queryFn: () => fetchCashDrawer(venueId as string, date as string),
  });
}

/**
 * The day's writes. Each one refreshes the day (and the drawer) after it
 * settles, success or refusal, so a screen never shows a day another device
 * already changed. Errors go to the caller (it shows them in words).
 */
export function useDayCloseActions(venueId: string) {
  const queryClient = useQueryClient();
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: venueDayCloseKeys.all(venueId) });
  };
  const close = useMutation({
    mutationFn: (input: { date: string; countedMinor: number; clientRequestId: string }) => closeDay({ venueId, ...input }),
    onSettled: refresh,
  });
  const reopen = useMutation({
    mutationFn: (input: { date: string; reason: string }) => reopenDay({ venueId, ...input }),
    onSettled: refresh,
  });
  const carryOver = useMutation({
    mutationFn: (input: { saleId: string; date: string }) => carryCheckOver({ venueId, ...input }),
    onSettled: refresh,
  });
  const cashMovement = useMutation({
    mutationFn: (input: { date: string; kind: "float" | "paid_out"; amountMinor: number; note: string | null; clientRequestId: string }) =>
      recordCashMovement({ venueId, ...input }),
    onSettled: refresh,
  });
  return { close, reopen, carryOver, cashMovement };
}

export function useTillSettings(venueId: string | null): UseQueryResult<TillSettings> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && venueId !== null && venueId.length > 0;
  return useQuery<TillSettings>({
    queryKey: enabled ? venueDayCloseKeys.settings(venueId as string) : ["venueDayClose", "disabled", "settings"],
    enabled,
    staleTime: 30_000,
    queryFn: () => fetchTillSettings(venueId as string),
  });
}

export function useSaveTillSettings(venueId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { patch: TillSettingsPatch; expectedVersion: number }) => saveTillSettings({ venueId, ...input }),
    onSuccess: (saved) => {
      queryClient.setQueryData(venueDayCloseKeys.settings(venueId), saved);
    },
    onError: () => {
      // A refusal (another device changed them) reloads the latest.
      void queryClient.invalidateQueries({ queryKey: venueDayCloseKeys.settings(venueId) });
    },
  });
}
