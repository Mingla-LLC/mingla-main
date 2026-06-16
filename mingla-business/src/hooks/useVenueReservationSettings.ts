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
  detail: (brandId: string): readonly ["venueReservationSettings", string] =>
    ["venueReservationSettings", brandId] as const,
};

export const fetchVenueReservationSettings = async (
  brandId: string,
): Promise<VenueReservationSettings | null> => {
  const { data, error } = await supabase
    .from("venue_reservation_settings")
    .select(
      "brand_id, place_pool_id, reservations_enabled, fee_enabled, fee_amount_cents, fee_currency, fee_refundable, cancel_cutoff_hours, no_show_fee_policy, pass_fee_override, pass_tax_override",
    )
    .eq("brand_id", brandId)
    .maybeSingle<VenueReservationSettingsRow>();
  if (error !== null) throw error;
  // null = no row yet → toggle OFF default.
  return data === null ? null : mapRow(data);
};

export function useVenueReservationSettings(
  brandId: string | null,
): UseQueryResult<VenueReservationSettings | null> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<VenueReservationSettings | null>({
    queryKey: enabled
      ? venueReservationSettingsKeys.detail(brandId)
      : (["venueReservationSettings", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () =>
      enabled ? fetchVenueReservationSettings(brandId) : Promise.resolve(null),
  });
}

/**
 * Toggle `reservations_enabled` (default-creating the single row on first
 * toggle). Upsert on the brand_id PK → idempotent.
 */
export function useSetReservationsEnabled(
  brandId: string | null,
): UseMutationResult<void, Error, boolean> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, boolean>({
    mutationFn: async (enabledNext: boolean): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const { error } = await supabase
        .from("venue_reservation_settings")
        .upsert(
          {
            brand_id: brandId,
            reservations_enabled: enabledNext,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "brand_id" },
        );
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueReservationSettingsKeys.detail(brandId),
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
): UseMutationResult<void, Error, VenueReservationFeePatch> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, VenueReservationFeePatch>({
    mutationFn: async (patch: VenueReservationFeePatch): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const row: Record<string, unknown> = {
        brand_id: brandId,
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
        .upsert(row, { onConflict: "brand_id" });
      if (error !== null) throw error as unknown as Error;
    },
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueReservationSettingsKeys.detail(brandId),
        });
      }
    },
  });
}
