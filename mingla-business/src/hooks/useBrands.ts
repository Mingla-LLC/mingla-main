/**
 * useBrands — React Query hooks for brand CRUD (Cycle 17e-A).
 *
 * Per SPEC §3.5 verbatim. Wires:
 *   - useBrands(accountId)        — list query (5min staleTime)
 *   - useBrand(brandId)           — single query (5min staleTime)
 *   - useCreateBrand              — OPTIMISTIC mutation per Decision 10
 *   - useUpdateBrand              — OPTIMISTIC mutation per Decision 10
 *   - useSoftDeleteBrand          — PESSIMISTIC mutation per Decision 10
 *   - useBrandCascadePreview      — single query for delete-sheet step 2
 *                                   (per IMPL dispatch §6 D-CYCLE17E-A-SPEC-4 Option a)
 *
 * Const #5 server state via React Query (NOT Zustand) — `setBrands` action
 * removed from currentBrandStore in Step 6. I-PROPOSED-C codifies this rule.
 *
 * Error contract per Const #3: every mutation has `onError`. Hook layer maps
 * SlugCollisionError to inline form error UX (caller pattern).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import { queryClient } from "../config/queryClient";
import {
  createBrand,
  getBrands,
  getBrand,
  updateBrand,
  softDeleteBrand,
  SlugCollisionError,
  type CreateBrandInput,
  type SoftDeleteResult,
} from "../services/brandsService";
import type { Brand } from "../store/currentBrandStore";
// ORCH-0740 Cycle 1: import the existing brandRoleKeys factory to replace
// the hardcoded `["brand-role", brandId]` literal in useSoftDeleteBrand.onSuccess
// (Constitutional #4 — one query key per entity).
import { brandRoleKeys } from "./useCurrentBrandRole";

const STALE_TIME_MS = 5 * 60 * 1000; // 5 min — brands change infrequently

// ----- Query key factory -------------------------------------------------

export const brandKeys = {
  all: ["brands"] as const,
  lists: (): readonly ["brands", "list"] => [...brandKeys.all, "list"] as const,
  list: (
    accountId: string,
  ): readonly ["brands", "list", string] =>
    [...brandKeys.lists(), accountId] as const,
  details: (): readonly ["brands", "detail"] =>
    [...brandKeys.all, "detail"] as const,
  detail: (
    brandId: string,
  ): readonly ["brands", "detail", string] =>
    [...brandKeys.details(), brandId] as const,
  cascadePreview: (
    brandId: string,
  ): readonly ["brands", "cascade-preview", string] =>
    [...brandKeys.all, "cascade-preview", brandId] as const,
};

const DISABLED_KEY = ["brands-disabled"] as const;

// ----- getBrandFromCache (synchronous, hook-free) ------------------------

/**
 * Synchronous, hook-free lookup for outside-component contexts (Zustand
 * actions, store converters, fire-and-forget submit handlers). Reads the
 * React Query cache by ID. Tries the detail cache first; falls back to
 * iterating the list caches. Returns null on miss.
 *
 * Replaces the Cycle-17e-A `useCurrentBrandStore.getState().currentBrand`
 * imperative pattern in 5 call sites (RefundSheet, CancelOrderDialog,
 * order detail resend, liveEventConverter, liveEventStore.recordEdit
 * notification).
 *
 * Cycle 2 / ORCH-0742.
 */
export const getBrandFromCache = (brandId: string | null): Brand | null => {
  if (brandId === null) return null;
  const detail = queryClient.getQueryData<Brand | null>(
    brandKeys.detail(brandId),
  );
  if (detail !== undefined && detail !== null) return detail;
  const lists = queryClient.getQueriesData<Brand[]>({
    queryKey: brandKeys.lists(),
  });
  for (const [, brands] of lists) {
    if (brands === undefined) continue;
    const found = brands.find((b) => b.id === brandId);
    if (found !== undefined) return found;
  }
  return null;
};

// ----- useBrands (list) --------------------------------------------------

export const useBrands = (
  accountId: string | null,
): UseQueryResult<Brand[]> => {
  const enabled = accountId !== null;
  return useQuery<Brand[]>({
    queryKey: enabled ? brandKeys.list(accountId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<Brand[]> => {
      if (!enabled || accountId === null) return [];
      return getBrands(accountId);
    },
  });
};

// ----- useBrand (single) -------------------------------------------------

export const useBrand = (
  brandId: string | null,
): UseQueryResult<Brand | null> => {
  const enabled = brandId !== null;
  return useQuery<Brand | null>({
    queryKey: enabled ? brandKeys.detail(brandId) : DISABLED_KEY,
    enabled,
    staleTime: STALE_TIME_MS,
    queryFn: async (): Promise<Brand | null> => {
      if (!enabled || brandId === null) return null;
      return getBrand(brandId);
    },
  });
};

// ----- useCreateBrand (OPTIMISTIC) --------------------------------------

export interface UseCreateBrandResult {
  mutateAsync: (input: CreateBrandInput) => Promise<Brand>;
  isPending: boolean;
}

interface CreateBrandContext {
  snapshot: Brand[] | undefined;
}

export const useCreateBrand = (): UseCreateBrandResult => {
  const queryClient = useQueryClient();
  const mutation = useMutation<Brand, Error, CreateBrandInput, CreateBrandContext>({
    mutationFn: async (input: CreateBrandInput): Promise<Brand> => {
      // Service-layer call; SlugCollisionError surfaces here for hook to map
      return createBrand(input, "owner");
    },
    onMutate: async (input): Promise<CreateBrandContext> => {
      // Cancel in-flight list query so optimistic patch isn't overwritten
      await queryClient.cancelQueries({
        queryKey: brandKeys.list(input.accountId),
      });
      const snapshot = queryClient.getQueryData<Brand[]>(
        brandKeys.list(input.accountId),
      );
      // Apply optimistic — temp ID prefix `_temp_` so onSuccess can identify
      const tempBrand: Brand = {
        id: `_temp_${Date.now().toString(36)}`,
        displayName: input.name,
        slug: input.slug,
        kind: input.kind,
        address: input.address,
        coverHue: input.coverHue,
        role: "owner",
        stats: { events: 0, followers: 0, rev: 0, attendees: 0 },
        currentLiveEvent: null,
        bio: input.bio,
        tagline: input.tagline,
        contact: input.contact,
        links: input.links,
      };
      queryClient.setQueryData<Brand[]>(
        brandKeys.list(input.accountId),
        (prev) => (prev !== undefined ? [tempBrand, ...prev] : [tempBrand]),
      );
      return { snapshot };
    },
    onError: (_error, input, context) => {
      // Rollback to snapshot — Const #3: don't swallow; UI surfaces error
      // via mutation.error subscription on the calling component.
      if (context !== undefined && context.snapshot !== undefined) {
        queryClient.setQueryData<Brand[]>(
          brandKeys.list(input.accountId),
          context.snapshot,
        );
      } else if (context !== undefined && context.snapshot === undefined) {
        // No snapshot existed (first brand) — clear optimistic-only state
        queryClient.setQueryData<Brand[]>(brandKeys.list(input.accountId), []);
      }
    },
    onSuccess: (serverBrand, input) => {
      // Replace temp with server-returned row (uses real UUID from DB)
      queryClient.setQueryData<Brand[]>(
        brandKeys.list(input.accountId),
        (prev) => {
          if (prev === undefined) return [serverBrand];
          return prev.map((b) => (b.id.startsWith("_temp_") ? serverBrand : b));
        },
      );
      // Cache the detail for fast subsequent reads
      queryClient.setQueryData<Brand>(
        brandKeys.detail(serverBrand.id),
        serverBrand,
      );
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};

// ----- useUpdateBrand (OPTIMISTIC) --------------------------------------

export interface UpdateBrandInput {
  brandId: string;
  patch: Partial<Brand>;
  existingDescription: string | null;
  accountId: string;
}

export interface UseUpdateBrandResult {
  mutateAsync: (input: UpdateBrandInput) => Promise<Brand>;
  isPending: boolean;
}

interface UpdateBrandContext {
  detailSnap?: Brand | null;
  listSnap?: Brand[];
}

export const useUpdateBrand = (): UseUpdateBrandResult => {
  const queryClient = useQueryClient();
  const mutation = useMutation<Brand, Error, UpdateBrandInput, UpdateBrandContext>({
    mutationFn: async ({ brandId, patch, existingDescription }) =>
      updateBrand(brandId, patch, existingDescription),
    onMutate: async ({ brandId, patch, accountId }): Promise<UpdateBrandContext> => {
      await queryClient.cancelQueries({ queryKey: brandKeys.detail(brandId) });
      await queryClient.cancelQueries({ queryKey: brandKeys.list(accountId) });
      const detailSnap =
        queryClient.getQueryData<Brand | null>(brandKeys.detail(brandId)) ?? null;
      const listSnap = queryClient.getQueryData<Brand[]>(
        brandKeys.list(accountId),
      );
      // Optimistic detail update
      if (detailSnap !== null) {
        const optimistic: Brand = { ...detailSnap, ...patch };
        queryClient.setQueryData<Brand>(brandKeys.detail(brandId), optimistic);
        // Mirror in list
        if (listSnap !== undefined) {
          queryClient.setQueryData<Brand[]>(
            brandKeys.list(accountId),
            listSnap.map((b) => (b.id === brandId ? optimistic : b)),
          );
        }
      }
      return { detailSnap, listSnap };
    },
    onError: (_error, { brandId, accountId }, context) => {
      // Rollback detail + list snapshots — Const #3: don't swallow; UI
      // surfaces error via mutation.error on the calling component.
      if (context?.detailSnap !== undefined) {
        queryClient.setQueryData(brandKeys.detail(brandId), context.detailSnap);
      }
      if (context?.listSnap !== undefined) {
        queryClient.setQueryData(brandKeys.list(accountId), context.listSnap);
      }
    },
    onSuccess: (serverBrand, { brandId, accountId }) => {
      queryClient.setQueryData<Brand>(brandKeys.detail(brandId), serverBrand);
      queryClient.setQueryData<Brand[]>(
        brandKeys.list(accountId),
        (prev) => {
          if (prev === undefined) return [serverBrand];
          return prev.map((b) => (b.id === brandId ? serverBrand : b));
        },
      );
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};

// ----- useSoftDeleteBrand (PESSIMISTIC) ---------------------------------

export interface SoftDeleteBrandInput {
  brandId: string;
  accountId: string;
}

export interface UseSoftDeleteBrandResult {
  mutateAsync: (input: SoftDeleteBrandInput) => Promise<SoftDeleteResult>;
  isPending: boolean;
}

export const useSoftDeleteBrand = (): UseSoftDeleteBrandResult => {
  const queryClient = useQueryClient();
  const mutation = useMutation<SoftDeleteResult, Error, SoftDeleteBrandInput>({
    mutationFn: async ({ brandId }) => {
      const result = await softDeleteBrand(brandId);
      return result;
    },
    onSuccess: (result, { brandId, accountId }) => {
      if (!result.rejected) {
        // Invalidate list — re-fetch shows brand absent (deleted_at IS NULL filter)
        queryClient.invalidateQueries({ queryKey: brandKeys.list(accountId) });
        // Clear detail cache
        queryClient.removeQueries({ queryKey: brandKeys.detail(brandId) });
        // Clear role cache for this brand (useCurrentBrandRole sees no brand row → null role).
        // ORCH-0740 Cycle 1: use brandRoleKeys.allForBrand factory instead of hardcoded literal.
        queryClient.removeQueries({ queryKey: brandRoleKeys.allForBrand(brandId) });
        // Clear cascade-preview cache (defensive)
        queryClient.removeQueries({
          queryKey: brandKeys.cascadePreview(brandId),
        });
      }
      // On rejection: caller (BrandDeleteSheet) handles via modal; no cache changes
    },
    onError: () => {
      // Caller's mutateAsync still receives the throw — pessimistic pattern.
      // Caller (BrandDeleteSheet) renders the error in the modal via setSubmitError.
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};

// ----- useBrandCascadePreview --------------------------------------------

/**
 * Cascade preview counts for the BrandDeleteSheet step 2 render.
 * Per IMPL dispatch §6 D-CYCLE17E-A-SPEC-4 Option (a) — parent passes counts
 * to sheet as props (sheet stays presentational + testable).
 *
 * 30s staleTime — counts change frequently in active operations; we want fresh
 * data when operator opens the sheet but caching is fine within a single open.
 */
export interface BrandCascadePreviewCounts {
  pastEventCount: number;
  upcomingEventCount: number;
  liveEventCount: number;
  teamMemberCount: number;
  hasStripeConnect: boolean;
}

const CASCADE_PREVIEW_STALE_TIME_MS = 30 * 1000; // 30s

export const useBrandCascadePreview = (
  brandId: string | null,
): UseQueryResult<BrandCascadePreviewCounts | null> => {
  const enabled = brandId !== null;
  return useQuery<BrandCascadePreviewCounts | null>({
    queryKey: enabled ? brandKeys.cascadePreview(brandId) : DISABLED_KEY,
    enabled,
    staleTime: CASCADE_PREVIEW_STALE_TIME_MS,
    queryFn: async (): Promise<BrandCascadePreviewCounts | null> => {
      if (!enabled || brandId === null) return null;

      // 5 parallel queries — Const #3: throws on any error.
      // B2a HF-8 fix: hasStripeConnect now reads derived status via
      // pg_derive_brand_stripe_status RPC instead of approximate
      // `stripe_connect_id !== null` check (which returned true even
      // for restricted-state brands per spike findings HF-8).
      const [pastResult, upcomingResult, liveResult, teamResult, stripeStatusResult] =
        await Promise.all([
          supabase
            .from("events")
            .select("id", { count: "exact", head: true })
            .eq("brand_id", brandId)
            .eq("status", "past")
            .is("deleted_at", null),
          supabase
            .from("events")
            .select("id", { count: "exact", head: true })
            .eq("brand_id", brandId)
            .eq("status", "upcoming")
            .is("deleted_at", null),
          supabase
            .from("events")
            .select("id", { count: "exact", head: true })
            .eq("brand_id", brandId)
            .eq("status", "live")
            .is("deleted_at", null),
          supabase
            .from("brand_team_members")
            .select("user_id", { count: "exact", head: true })
            .eq("brand_id", brandId)
            .is("removed_at", null),
          supabase.rpc("pg_derive_brand_stripe_status", {
            p_brand_id: brandId,
          }),
        ]);

      if (pastResult.error) throw pastResult.error;
      if (upcomingResult.error) throw upcomingResult.error;
      if (liveResult.error) throw liveResult.error;
      if (teamResult.error) throw teamResult.error;
      if (stripeStatusResult.error) throw stripeStatusResult.error;

      const derivedStatus = stripeStatusResult.data ?? "not_connected";

      return {
        pastEventCount: pastResult.count ?? 0,
        upcomingEventCount: upcomingResult.count ?? 0,
        liveEventCount: liveResult.count ?? 0,
        teamMemberCount: teamResult.count ?? 0,
        // B2a HF-8 fix: only true for active or onboarding states (excludes
        // not_connected, restricted, detached). Per spike findings.
        hasStripeConnect:
          derivedStatus === "active" || derivedStatus === "onboarding",
      };
    },
  });
};

// ----- Re-exports for convenience ---------------------------------------

export { SlugCollisionError } from "../services/brandsService";
export type {
  CreateBrandInput,
  SoftDeleteResult,
  SoftDeleteSuccess,
  SoftDeleteRejection,
} from "../services/brandsService";
