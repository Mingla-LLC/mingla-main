/**
 * Issue #1791 (#1767 Phase 3) — `venue_ordering_settings` read + the two
 * switches that belong to the VENUE (SPEC #1788 P-16; rulings OQ-7; D-7b).
 *
 * TWO SWITCHES, TWO DIFFERENT PROMISES:
 *
 *  * `paused` — the venue's own "we're slammed" control. Mingla NEVER writes it
 *    for them. No sweep, cron, webhook, admin action or failure path can: the
 *    only writer of `paused_at` in the entire system is
 *    `biz_venue_ordering_pause`, which requires a verified staff user id. A
 *    slow venue is a service problem for that venue to answer, not a reason for
 *    the platform to switch off their takings — and the guest's safety valve
 *    (walk away with your money any time before it's served) is already
 *    sufficient. (D-7b, I-PROPOSED-1767-NEVER-PAUSE-A-VENUE-FOR-THEM)
 *
 *  * `orderingEnabled` — the master switch, default OFF. `biz_venue_ordering_set_enabled`
 *    is the ONLY route to `true` anywhere in the product and it ships in the
 *    same change as this queue (ruling OQ-7). Phase 4 physically cannot turn
 *    ordering on before somebody can watch what it lets in.
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

export interface VenueOrderingSettings {
  venueId: string;
  brandId: string;
  orderingEnabled: boolean;
  paused: boolean;
  pausedAt: string | null;
  serviceChargeBps: number;
  serviceChargeLabel: string;
  counterPickupEnabled: boolean;
  staffTabsEnabled: boolean;
  prepTimeMinutes: number | null;
}

interface SettingsRow {
  venue_id: string;
  brand_id: string;
  ordering_enabled: boolean;
  paused_at: string | null;
  service_charge_bps: number;
  service_charge_label: string;
  counter_pickup_enabled: boolean;
  staff_tabs_enabled: boolean;
  prep_time_minutes: number | null;
}

const SETTINGS_COLUMNS =
  "venue_id, brand_id, ordering_enabled, paused_at, service_charge_bps, service_charge_label, counter_pickup_enabled, staff_tabs_enabled, prep_time_minutes";

export const venueOrderingSettingsKeys = {
  detail: (venueId: string): readonly ["venueOrderingSettings", string] =>
    ["venueOrderingSettings", venueId] as const,
};

/**
 * `null` means NO ROW YET, which is the table default and therefore
 * `ordering_enabled = false`. The module renders that as "not switched on"
 * rather than inventing a settings object that claims otherwise.
 */
export function useVenueOrderingSettings(
  venueId: string | null,
): UseQueryResult<VenueOrderingSettings | null> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && venueId !== null && venueId.length > 0;
  return useQuery<VenueOrderingSettings | null>({
    queryKey: enabled
      ? venueOrderingSettingsKeys.detail(venueId)
      : (["venueOrderingSettings", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      if (!enabled) return null;
      const { data, error } = await supabase
        .from("venue_ordering_settings")
        .select(SETTINGS_COLUMNS)
        .eq("venue_id", venueId)
        .maybeSingle<SettingsRow>();
      if (error !== null) throw error;
      if (data === null) return null;
      return {
        venueId: data.venue_id,
        brandId: data.brand_id,
        orderingEnabled: data.ordering_enabled,
        paused: data.paused_at !== null,
        pausedAt: data.paused_at,
        serviceChargeBps: data.service_charge_bps,
        serviceChargeLabel: data.service_charge_label,
        counterPickupEnabled: data.counter_pickup_enabled,
        staffTabsEnabled: data.staff_tabs_enabled,
        prepTimeMinutes: data.prep_time_minutes,
      };
    },
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

/** D-7b — the venue's own pause. The ONLY client path to `paused_at`. */
export function useSetVenueOrderingPaused(
  venueId: string | null,
): UseMutationResult<void, Error, boolean> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, boolean>({
    mutationFn: async (paused: boolean): Promise<void> => {
      if (venueId === null) throw new Error("venue_required");
      await invokeStaff({ action: "pause", venueId, paused });
    },
    onSuccess: () => {
      if (venueId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueOrderingSettingsKeys.detail(venueId),
        });
      }
    },
  });
}

/** Ruling OQ-7 — the ONLY client path to `ordering_enabled = true`. */
export function useSetVenueOrderingEnabled(
  venueId: string | null,
): UseMutationResult<void, Error, boolean> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, boolean>({
    mutationFn: async (enabled: boolean): Promise<void> => {
      if (venueId === null) throw new Error("venue_required");
      await invokeStaff({ action: "set_ordering_enabled", venueId, enabled });
    },
    onSuccess: () => {
      if (venueId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueOrderingSettingsKeys.detail(venueId),
        });
      }
    },
  });
}
