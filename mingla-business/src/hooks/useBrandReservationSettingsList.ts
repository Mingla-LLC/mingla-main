/**
 * META-ORCH-1255 — lightweight per-brand reservation-settings list for the
 * venue CARD LIST ("Reservations on" data slot): one read for ALL venues of
 * the brand.
 *
 * META-ORCH-1255(R2) [web bundle budget] — extracted VERBATIM from
 * useVenueReservationSettings.ts. This list hook is consumed ONLY by the Hub
 * venue card list (listing route chunk) while the per-venue detail/mutation
 * hooks are consumed ONLY by the venue suite (venue/[venueId] route chunk);
 * sharing one file made Metro hoist the WHOLE module into the EAGER `__common`
 * boot chunk (ORCH-1083 initial-bundle budget). Split, each hook lives in its
 * consumer's route chunk. Behavior is unchanged.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";

export interface VenueReservationsEnabledRow {
  venueId: string;
  reservationsEnabled: boolean;
}

export const venueReservationSettingsListKey = (
  brandId: string,
): readonly ["venueReservationSettingsList", string] =>
  ["venueReservationSettingsList", brandId] as const;

export function useBrandReservationSettingsList(
  brandId: string | null,
): UseQueryResult<VenueReservationsEnabledRow[]> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<VenueReservationsEnabledRow[]>({
    queryKey: enabled
      ? venueReservationSettingsListKey(brandId)
      : (["venueReservationSettingsList", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      if (!enabled) return [];
      const { data, error } = await supabase
        .from("venue_reservation_settings")
        .select("venue_id, reservations_enabled")
        .eq("brand_id", brandId);
      if (error !== null) throw error;
      return ((data ?? []) as { venue_id: string; reservations_enabled: boolean }[]).map(
        (r) => ({ venueId: r.venue_id, reservationsEnabled: r.reservations_enabled }),
      );
    },
  });
}
