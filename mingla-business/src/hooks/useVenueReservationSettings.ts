/**
 * META-ORCH-1148 sub-ORCH 2.0 — venue reservation-settings data hook.
 *
 * Read/upsert the single `venue_reservation_settings` row (brand_id PK → exactly
 * one row per brand; toggle race → idempotent upsert, no dup rows). The ONLY
 * venue_* table 2.0's UI touches. RLS enforces manager-plus write server-side;
 * the paid-fee integrity gate is enforced client-side here + in the Settings UI
 * (no charge path exists in 2.0; the server-side fail-close RPC is 2.1/2.2).
 *
 * Mirrors the established React-Query brand-hook pattern (auth-gated query +
 * upsert mutation + invalidate).
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
import type {
  VenueReservationFeePatch,
  VenueReservationSettings,
} from "../types/venueReservation";

interface VenueReservationSettingsRow {
  brand_id: string;
  venue_id: string;
  place_pool_id: string | null;
  reservations_enabled: boolean;
  fee_enabled: boolean;
  fee_amount_cents: number | null;
  fee_currency: string | null;
  fee_refundable: boolean;
  cancel_cutoff_hours: number;
  no_show_fee_policy: "forfeit" | "none";
  pass_fee_override: boolean | null;
  pass_tax_override: boolean | null;
}

const mapRow = (
  row: VenueReservationSettingsRow,
): VenueReservationSettings => ({
  brandId: row.brand_id,
  venueId: row.venue_id,
  placePoolId: row.place_pool_id,
  reservationsEnabled: row.reservations_enabled,
  feeEnabled: row.fee_enabled,
  feeAmountCents: row.fee_amount_cents,
  feeCurrency: row.fee_currency,
  feeRefundable: row.fee_refundable,
  cancelCutoffHours: row.cancel_cutoff_hours,
  noShowFeePolicy: row.no_show_fee_policy,
  passFeeOverride: row.pass_fee_override,
  passTaxOverride: row.pass_tax_override,
});

export const venueReservationSettingsKeys = {
  // META-ORCH-1255 — venue-scoped key, brandId-FIRST so brand-prefix
  // invalidations keep matching every venue of the brand.
  detail: (
    brandId: string,
    venueId: string,
  ): readonly ["venueReservationSettings", string, string] =>
    ["venueReservationSettings", brandId, venueId] as const,
};

export const fetchVenueReservationSettings = async (
  brandId: string,
  // META-ORCH-1255 — the settings row is one-per-VENUE (PK moved brand→venue).
  venueId: string,
): Promise<VenueReservationSettings | null> => {
  const { data, error } = await supabase
    .from("venue_reservation_settings")
    .select(
      "brand_id, venue_id, place_pool_id, reservations_enabled, fee_enabled, fee_amount_cents, fee_currency, fee_refundable, cancel_cutoff_hours, no_show_fee_policy, pass_fee_override, pass_tax_override",
    )
    .eq("brand_id", brandId)
    .eq("venue_id", venueId)
    .maybeSingle<VenueReservationSettingsRow>();
  if (error !== null) throw error;
  // null = no row yet → toggle OFF default.
  return data === null ? null : mapRow(data);
};

export function useVenueReservationSettings(
  brandId: string | null,
  venueId: string | null,
): UseQueryResult<VenueReservationSettings | null> {
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady &&
    brandId !== null &&
    brandId.length > 0 &&
    venueId !== null &&
    venueId.length > 0;
  return useQuery<VenueReservationSettings | null>({
    queryKey: enabled
      ? venueReservationSettingsKeys.detail(brandId, venueId)
      : (["venueReservationSettings", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () =>
      enabled
        ? fetchVenueReservationSettings(brandId, venueId)
        : Promise.resolve(null),
  });
}

/**
 * Toggle `reservations_enabled` (default-creating the single row on first
 * toggle). Upsert on the brand_id PK → idempotent.
 */
export function useSetReservationsEnabled(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<void, Error, boolean> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, boolean>({
    mutationFn: async (enabledNext: boolean): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      // META-ORCH-1255 — venue_id is NOT NULL + the PK; a brand-only upsert
      // cannot exist anymore. Fail fast with an honest error.
      if (venueId === null) throw new Error("venue_required");
      const { error } = await supabase
        .from("venue_reservation_settings")
        .upsert(
          {
            brand_id: brandId,
            venue_id: venueId,
            reservations_enabled: enabledNext,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "venue_id" },
        );
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null && venueId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueReservationSettingsKeys.detail(brandId, venueId),
        });
      }
    },
  });
}

/**
 * Patch the fee / cancel / no-show columns. The caller (Settings) MUST gate
 * enabling a PAID fee on brand payout readiness BEFORE calling this (the
 * client-side fail-close mirror of the checkout `stripe_account_not_ready` 409);
 * this mutation does the write only.
 */
export function useUpdateReservationFee(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<void, Error, VenueReservationFeePatch> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, VenueReservationFeePatch>({
    mutationFn: async (patch: VenueReservationFeePatch): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      if (venueId === null) throw new Error("venue_required");
      const row: Record<string, unknown> = {
        brand_id: brandId,
        venue_id: venueId,
        updated_at: new Date().toISOString(),
      };
      if (patch.feeEnabled !== undefined) row.fee_enabled = patch.feeEnabled;
      if (patch.feeAmountCents !== undefined) {
        row.fee_amount_cents = patch.feeAmountCents;
      }
      if (patch.feeCurrency !== undefined) row.fee_currency = patch.feeCurrency;
      if (patch.feeRefundable !== undefined) {
        row.fee_refundable = patch.feeRefundable;
      }
      if (patch.cancelCutoffHours !== undefined) {
        row.cancel_cutoff_hours = patch.cancelCutoffHours;
      }
      if (patch.noShowFeePolicy !== undefined) {
        row.no_show_fee_policy = patch.noShowFeePolicy;
      }
      const { error } = await supabase
        .from("venue_reservation_settings")
        .upsert(row, { onConflict: "venue_id" });
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null && venueId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueReservationSettingsKeys.detail(brandId, venueId),
        });
      }
    },
  });
}

/**
 * META-ORCH-1255 — lightweight per-brand settings list for the venue CARD LIST
 * ("Reservations on" data slot): one read for ALL venues of the brand.
 */
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
