/**
 * META-ORCH-1009 Sub-E — business venue deck-readiness state.
 *
 * META-ORCH-1255 Leg B — the pipeline is venue-keyed (one row PER VENUE under
 * a brand; the F-2 one-row-per-brand lock is dead). New venue-keyed variants:
 *   - `useVenuePipelineState(venueId)` — the single row for ONE venue.
 *   - `useBrandPipelineStates(brandId)` — ALL of a brand's pipeline rows
 *     (per-venue statuses for the venue card list + the to-do rows).
 * The legacy `useBrandPlacePipelineState(brandId)` single-row read is kept as
 * a [TRANSITIONAL] multi-row-safe alias (latest row wins) because append-only
 * source-contract tests pin its call shape; live surfaces read the venue-keyed
 * variants. Exit condition: pinned tests superseded by a TEST-MOD-APPROVED
 * ORCH → delete the alias.
 */

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import {
  fetchBrandPipelineStates,
  fetchBrandPlaceAuthoringContext,
  fetchBrandPlacePipelineState,
  fetchVenuePipelineState,
  type BrandPlaceAuthoringContext,
  type BrandPlacePipelineState,
} from "../services/businessPlaceAuthoringService";

export const brandPlacePipelineKeys = {
  all: ["brandPlacePipelineState"] as const,
  byBrand: (brandId: string) =>
    [...brandPlacePipelineKeys.all, brandId] as const,
  listByBrand: (brandId: string) =>
    [...brandPlacePipelineKeys.all, brandId, "list"] as const,
  byVenue: (venueId: string) =>
    [...brandPlacePipelineKeys.all, "venue", venueId] as const,
  context: (brandId: string, placePoolId: string, venueId: string) =>
    [
      ...brandPlacePipelineKeys.all,
      brandId,
      "context",
      placePoolId,
      venueId,
    ] as const,
};

/** [TRANSITIONAL] legacy brand-keyed single-row read (latest row wins) — see header.
 * EXIT: remove when the 1255-carrying business native build ships and pre-1255 binaries retire (ORCH-1261). */
export function useBrandPlacePipelineState(brandId: string | null) {
  const { isAuthReady } = useAuth();
  return useQuery<BrandPlacePipelineState | null>({
    queryKey: brandPlacePipelineKeys.byBrand(brandId ?? ""),
    enabled: isAuthReady && brandId !== null && brandId.length > 0,
    staleTime: 15_000,
    queryFn: () => fetchBrandPlacePipelineState(brandId!),
  });
}

/** META-ORCH-1255 — the pipeline row for ONE venue. */
export function useVenuePipelineState(venueId: string | null) {
  const { isAuthReady } = useAuth();
  return useQuery<BrandPlacePipelineState | null>({
    queryKey: brandPlacePipelineKeys.byVenue(venueId ?? ""),
    enabled: isAuthReady && venueId !== null && venueId.length > 0,
    staleTime: 15_000,
    queryFn: () => fetchVenuePipelineState(venueId!),
  });
}

/** META-ORCH-1255 — ALL pipeline rows of a brand (per-venue statuses). */
export function useBrandPipelineStates(brandId: string | null) {
  const { isAuthReady } = useAuth();
  return useQuery<BrandPlacePipelineState[]>({
    queryKey: brandPlacePipelineKeys.listByBrand(brandId ?? ""),
    enabled: isAuthReady && brandId !== null && brandId.length > 0,
    staleTime: 15_000,
    queryFn: () => fetchBrandPipelineStates(brandId!),
  });
}

export function useBrandPlaceAuthoringContext(
  brandId: string | null,
  placePoolId: string | null,
  // META-ORCH-1255 — the pipeline edge fn requires venue_id on every action.
  venueId: string | null,
) {
  const { isAuthReady } = useAuth();
  return useQuery<BrandPlaceAuthoringContext>({
    queryKey: brandPlacePipelineKeys.context(
      brandId ?? "",
      placePoolId ?? "",
      venueId ?? "",
    ),
    enabled:
      isAuthReady &&
      brandId !== null &&
      brandId.length > 0 &&
      placePoolId !== null &&
      placePoolId.length > 0 &&
      venueId !== null &&
      venueId.length > 0,
    staleTime: 15_000,
    queryFn: () =>
      fetchBrandPlaceAuthoringContext({
        brandId: brandId!,
        placePoolId: placePoolId!,
        venueId: venueId!,
      }),
  });
}
