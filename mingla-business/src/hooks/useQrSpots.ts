/**
 * Issue #1789 (#1767 Phase 1) — qr_spots data hook + the print call.
 *
 * The list is BRAND-scoped (D-3b): one Spots list per brand, grouped by venue,
 * rooms and tables side by side. RLS enforces manager-plus writes server-side;
 * the UI gates the controls on rank. Mirrors useVenueTables exactly (auth-gated
 * query + upsert mutation + invalidate).
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
import type { QrSpot, QrSpotKind, VenueRef } from "../components/venue/qrSpots";

interface QrSpotRow {
  id: string;
  brand_id: string;
  venue_id: string;
  kind: QrSpotKind;
  venue_table_id: string | null;
  stay_unit_id: string | null;
  zone: string | null;
  label: string;
  serving_venue_id: string;
  serving_menu_id: string | null;
  code: string;
  is_active: boolean;
  auto_provisioned: boolean;
  sort_order: number;
  last_printed_at: string | null;
}

// A single string literal — supabase-js infers the row shape from the LITERAL
// type of the select string, and a `+` concatenation erases it.
const SPOT_COLUMNS =
  "id, brand_id, venue_id, kind, venue_table_id, stay_unit_id, zone, label, serving_venue_id, serving_menu_id, code, is_active, auto_provisioned, sort_order, last_printed_at";

const mapRow = (row: QrSpotRow): QrSpot => ({
  id: row.id,
  brandId: row.brand_id,
  venueId: row.venue_id,
  kind: row.kind,
  venueTableId: row.venue_table_id,
  stayUnitId: row.stay_unit_id,
  zone: row.zone,
  label: row.label,
  servingVenueId: row.serving_venue_id,
  servingMenuId: row.serving_menu_id,
  code: row.code,
  isActive: row.is_active,
  autoProvisioned: row.auto_provisioned,
  sortOrder: row.sort_order,
  lastPrintedAt: row.last_printed_at,
});

export const qrSpotKeys = {
  list: (brandId: string): readonly ["qrSpots", string] =>
    ["qrSpots", brandId] as const,
  venues: (brandId: string): readonly ["qrSpotVenues", string] =>
    ["qrSpotVenues", brandId] as const,
  served: (
    brandId: string,
    venueId: string,
  ): readonly ["qrSpots", string, "served", string] =>
    ["qrSpots", brandId, "served", venueId] as const,
};

export const fetchQrSpots = async (
  brandId: string,
  servingVenueId: string | null = null,
): Promise<QrSpot[]> => {
  let query = supabase
    .from("qr_spots")
    .select(SPOT_COLUMNS)
    .eq("brand_id", brandId);
  if (servingVenueId !== null) {
    query = query
      .eq("serving_venue_id", servingVenueId)
      .eq("is_active", true);
  }
  const { data, error } = await query
    .order("venue_id", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true })
    .returns<QrSpotRow[]>();
  if (error !== null) throw error;
  return (data ?? []).map(mapRow);
};

export function useQrSpots(
  brandId: string | null,
  servingVenueId: string | null = null,
): UseQueryResult<QrSpot[]> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<QrSpot[]>({
    queryKey: enabled
      ? servingVenueId === null
        ? qrSpotKeys.list(brandId)
        : qrSpotKeys.served(brandId, servingVenueId)
      : (["qrSpots", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () =>
      enabled ? fetchQrSpots(brandId, servingVenueId) : Promise.resolve([]),
  });
}

/** The brand's venues — the grouping headers and the serving-venue picker. */
export function useQrSpotVenues(
  brandId: string | null,
): UseQueryResult<VenueRef[]> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<VenueRef[]>({
    queryKey: enabled
      ? qrSpotKeys.venues(brandId)
      : (["qrSpotVenues", "disabled"] as const),
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      if (!enabled) return [];
      const { data, error } = await supabase
        .from("venue_listings")
        .select("id, name, slug")
        .eq("brand_id", brandId)
        .order("name", { ascending: true })
        .returns<VenueRef[]>();
      if (error !== null) throw error;
      return data ?? [];
    },
  });
}

export interface QrSpotUpdateInput {
  id: string;
  label?: string;
  isActive?: boolean;
  servingVenueId?: string;
  servingMenuId?: string | null;
  sortOrder?: number;
}

/**
 * Edit a spot. `code` is deliberately absent from the input type AND from the
 * row we send: it is immutable server-side (a BEFORE UPDATE trigger raises
 * `qr_spot_code_immutable`), and no client path should even imply otherwise
 * (I-PROPOSED-1767-PRINTED-CODE-SURVIVES-A-RENAME).
 */
export function useUpdateQrSpot(
  brandId: string | null,
): UseMutationResult<void, Error, QrSpotUpdateInput> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, QrSpotUpdateInput>({
    mutationFn: async (input: QrSpotUpdateInput): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (input.label !== undefined) patch.label = input.label;
      if (input.isActive !== undefined) patch.is_active = input.isActive;
      if (input.servingVenueId !== undefined) {
        patch.serving_venue_id = input.servingVenueId;
      }
      if (input.servingMenuId !== undefined) {
        patch.serving_menu_id = input.servingMenuId;
      }
      if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;
      const { error } = await supabase
        .from("qr_spots")
        .update(patch)
        .eq("id", input.id)
        .eq("brand_id", brandId);
      if (error !== null) throw error as unknown as Error;
    },
    onError: () => undefined,
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: qrSpotKeys.list(brandId),
        });
      }
    },
  });
}

export interface QrSheetResult {
  signedUrl: string;
  expiresAt: string;
  filename: string;
  spotCount: number;
}

export interface QrSheetRequest {
  brandId: string;
  venueId?: string;
  spotIds?: string[];
  layout: "bulk" | "single";
}

/**
 * Ask the server for a print sheet. The PDF is rendered server-side on the
 * shipped ticket-PDF rail and returned as a 60-second signed URL — there is no
 * client renderer, deliberately (SPEC P-27; no expo-print dependency exists and
 * one was avoided before).
 */
export function useQrSheet(
  brandId: string | null,
): UseMutationResult<QrSheetResult, Error, QrSheetRequest> {
  const queryClient = useQueryClient();
  return useMutation<QrSheetResult, Error, QrSheetRequest>({
    mutationFn: async (input: QrSheetRequest): Promise<QrSheetResult> => {
      const { data, error } = await supabase.functions.invoke<QrSheetResult>(
        "venue-qr-sheet",
        { body: input },
      );
      if (error !== null) throw error as unknown as Error;
      if (data === null || typeof data.signedUrl !== "string") {
        throw new Error("pdf_render_failed");
      }
      return data;
    },
    onError: () => undefined,
    onSuccess: () => {
      // last_printed_at moved server-side; refresh so the row says so.
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: qrSpotKeys.list(brandId),
        });
      }
    },
  });
}
