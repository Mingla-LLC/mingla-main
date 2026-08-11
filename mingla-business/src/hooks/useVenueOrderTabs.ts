/**
 * Issue #1792 (#1767 Phase 3b) — waiter-opened TABS (DESIGN D-2 AMENDED, D-11;
 * SPEC #1788 P-2, P-2a, P-16, P-26).
 *
 * WHY TABS ARE NARROW. D-2 kept guests on pay-per-round because a guest opening
 * a tab on themselves is the walkout risk. A WAITER opening one is the venue
 * extending credit exactly as it does today with a paper docket — their read of
 * the table, their call. So: staff-taken orders only, `staff_tabs_enabled` per
 * venue, and `venue_order_sessions_tab_is_staff_opened` makes a tab with no
 * human behind it unwritable at all.
 *
 * WHY THE TOTALS COME FROM AN RPC. `biz_venue_tab_summaries` sums the tab
 * server-side using the SAME predicate `biz_venue_tab_close` bills with —
 * settlement rows excluded — so the number on the waiter's card and the number
 * on the guest's bill cannot disagree. Summing the queue's cached rows on the
 * client would be a second, drifting implementation of the venue's money, and
 * it would silently double-count a tab that already has a bill out (P-20).
 *
 * No server record is ever persisted into a Zustand store from here — these are
 * React-Query caches, which is the shipped rule (persist IDs, not records).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import { venueOrdersKeys } from "./useVenueOrders";
import type { OrderPadTab } from "../components/venue/orderPad/venueOrderPad";

/**
 * Tabs poll on the SAME 30-second floor the queue does, and for the same
 * reason: an open tab is live money on a table, and a surface that only updates
 * when somebody remembers to pull is how a round gets lost. There is no realtime
 * leg here — a tab changes when a waiter acts, and every one of those actions
 * invalidates this key directly.
 */
export const VENUE_TABS_POLL_MS = 30_000;
export const VENUE_TABS_STALE_MS = 10_000;

export const venueTabKeys = {
  list: (brandId: string): readonly ["venueTabs", string] =>
    ["venueTabs", brandId] as const,
};

export const fetchVenueTabs = async (
  brandId: string,
): Promise<OrderPadTab[]> => {
  const { data, error } = await supabase.rpc("biz_venue_tab_summaries", {
    p_brand_id: brandId,
  });
  if (error !== null) throw error as unknown as Error;
  const payload = (data ?? {}) as { tabs?: unknown };
  const rows = Array.isArray(payload.tabs) ? payload.tabs : [];
  return rows.map((raw): OrderPadTab => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const state = row.tabState === "settling" ? "settling" : "open";
    return {
      sessionId: String(row.sessionId ?? ""),
      venueId: String(row.venueId ?? ""),
      qrSpotId: typeof row.qrSpotId === "string" ? row.qrSpotId : null,
      spotLabel: typeof row.spotLabel === "string" ? row.spotLabel : null,
      tabState: state,
      currency: String(row.currency ?? ""),
      roundCount: Number(row.roundCount ?? 0),
      outstandingSubtotalCents: Number(row.outstandingSubtotalCents ?? 0),
      outstandingServiceChargeCents: Number(
        row.outstandingServiceChargeCents ?? 0,
      ),
      outstandingTipCents: Number(row.outstandingTipCents ?? 0),
      outstandingTotalCents: Number(row.outstandingTotalCents ?? 0),
      openedAt: String(row.openedAt ?? ""),
      lastOrderAt: typeof row.lastOrderAt === "string" ? row.lastOrderAt : null,
    };
  });
};

/** Exported as data so the poll floor is provable without a React tree. */
export function venueTabsQueryOptions(brandId: string): {
  queryKey: readonly unknown[];
  staleTime: number;
  refetchInterval: number;
  queryFn: () => Promise<OrderPadTab[]>;
} {
  return {
    queryKey: venueTabKeys.list(brandId),
    staleTime: VENUE_TABS_STALE_MS,
    refetchInterval: VENUE_TABS_POLL_MS,
    queryFn: () => fetchVenueTabs(brandId),
  };
}

export function useVenueTabs(
  brandId: string | null,
): UseQueryResult<OrderPadTab[]> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<OrderPadTab[]>({
    ...(enabled
      ? venueTabsQueryOptions(brandId)
      : {
        queryKey: ["venueTabs", "disabled"] as const,
        staleTime: VENUE_TABS_STALE_MS,
        refetchInterval: VENUE_TABS_POLL_MS,
        queryFn: () => Promise.resolve([] as OrderPadTab[]),
      }),
    enabled,
  });
}

async function invokeStaff(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("venue-order-staff", {
    body,
  });
  if (error !== null) throw error as unknown as Error;
  return (data ?? {}) as Record<string, unknown>;
}

/**
 * OPEN A TAB on a sitting that already has its first round on it.
 *
 * Deliberately a second call rather than a flag on `create`: `biz_venue_tab_open`
 * is SECURITY DEFINER and reads `auth.uid()` to enforce its own `event_manager`
 * floor, and folding it into the service-role create path would have let the
 * pad open a tab the database never agreed to. A tab is credit; credit is a
 * manager's call.
 */
export function useOpenVenueTab(
  brandId: string | null,
): UseMutationResult<void, Error, { sessionId: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { sessionId: string }>({
    mutationFn: async ({ sessionId }): Promise<void> => {
      await invokeStaff({ action: "tab_open", sessionId });
    },
    onError: () => undefined,
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({ queryKey: venueTabKeys.list(brandId) });
        void queryClient.invalidateQueries({ queryKey: venueOrdersKeys.list(brandId) });
      }
    },
  });
}

export interface CloseVenueTabVars {
  sessionId: string;
  method: "bill_to_phone" | "venue_collected";
  buyer?: { name: string; email: string; phone: string };
}

export interface VenueTabClosed {
  kind: string;
  tabState: string | null;
  /** Present on `bill_to_phone` — what the guest opens to pay. */
  authorizationUrl: string | null;
  buyerStatusToken: string | null;
  orderId: string | null;
  totalCents: number | null;
  currency: string | null;
}

/**
 * CLOSE A TAB.
 *
 * `venue_collected` closes immediately: every round on the tab is marked paid,
 * no provider is called, no fee is taken, no payout row is created.
 *
 * `bill_to_phone` mints ONE settlement order carrying the tab's outstanding
 * total and returns the payment the guest completes. That row is marked
 * `metadata.tab_settlement`, which is what closes the tab when it is paid and
 * what keeps a tab from being counted twice — once as its rounds and again as
 * its own bill.
 */
export function useCloseVenueTab(
  brandId: string | null,
): UseMutationResult<VenueTabClosed, Error, CloseVenueTabVars> {
  const queryClient = useQueryClient();
  return useMutation<VenueTabClosed, Error, CloseVenueTabVars>({
    mutationFn: async (vars: CloseVenueTabVars): Promise<VenueTabClosed> => {
      const data = await invokeStaff({
        action: "tab_close",
        sessionId: vars.sessionId,
        settlementMethod: vars.method,
        buyer: vars.buyer ?? {},
      });
      return {
        kind: String(data.kind ?? ""),
        tabState: typeof data.tabState === "string" ? data.tabState : null,
        authorizationUrl: typeof data.authorizationUrl === "string"
          ? data.authorizationUrl
          : null,
        buyerStatusToken: typeof data.buyerStatusToken === "string"
          ? data.buyerStatusToken
          : null,
        orderId: typeof data.orderId === "string" ? data.orderId : null,
        totalCents: data.totalCents === undefined ? null : Number(data.totalCents),
        currency: typeof data.currency === "string" ? data.currency : null,
      };
    },
    onError: () => undefined,
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({ queryKey: venueTabKeys.list(brandId) });
        void queryClient.invalidateQueries({ queryKey: venueOrdersKeys.list(brandId) });
      }
    },
  });
}
