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

import { useEffect } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { supabase } from "../services/supabase";
import { queryClient } from "../config/queryClient";
import { eventOrdersKeys } from "./useEventOrders";
import {
  createBrand,
  createVenueBrandPendingReview,
  getBrands,
  getBrand,
  updateBrand,
  softDeleteBrand,
  type CreateBrandInput,
  type CreateVenueBrandPendingInput,
  type SoftDeleteResult,
} from "../services/brandsService";
import type { Brand } from "../store/currentBrandStore";
// ORCH-0740 Cycle 1: import the existing brandRoleKeys factory to replace
// the hardcoded `["brand-role", brandId]` literal in useSoftDeleteBrand.onSuccess
// (Constitutional #4 — one query key per entity).
import { brandRoleKeys } from "./useCurrentBrandRole";

// ORCH-0816 — brand stats (rev, rev7d, attendees) follow ticket sales, which
// change frequently. Combined with the Realtime subscription on `orders`
// below, 30s gives a fast-enough fallback when Realtime drops the connection
// or the publication migration has not landed.
const STALE_TIME_MS = 30 * 1000;

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
  offeringCounts: (
    brandId: string,
  ): readonly ["brand", string, "offeringCounts"] =>
    ["brand", brandId, "offeringCounts"] as const,
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
  const rqClient = useQueryClient();

  // ORCH-0816 — Realtime subscription on `public.orders` for brand-stats
  // freshness. RLS gates per-brand visibility, so the owner only receives
  // events for orders on their own brand's events. Pattern mirrors
  // `useBrandStripeBankVerification` verbatim. Requires migration
  // `20260602000004_orch_0816_orders_realtime_publication.sql`.
  useEffect(() => {
    if (!enabled || accountId === null) return;
    const channelName = `brand-stats-orders-${accountId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
        },
        // ORCH-0862 / F-5: scope the invalidates so a single order change
        // doesn't fan out into a 5000-line cache-cascade storm. Previously
        // `brandKeys.all` invalidated EVERY brand-related query (list +
        // detail + cascade-preview for every brand the user has access to),
        // and `eventOrdersKeys.all` invalidated orders for every event.
        // Combined with the screen's own subscribers, that caused the
        // 82-concurrent-HTTP-request storm observed in the Symptom A freeze
        // (sim syslog evidence 2026-05-17 14:46:22–26). Surgical fix:
        //   - brandKeys.list(accountId) — only this account's brand list
        //     (refreshes revenue/attendees on the home brand cards)
        //   - eventOrdersKeys.detail(eventId) IF the payload exposes the
        //     event_id; fall back to no-op if missing (the broad invalidate
        //     was already overreach — a missing payload doesn't justify
        //     re-firing the whole-app invalidate).
        (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
          rqClient.invalidateQueries({ queryKey: brandKeys.list(accountId) });
          const eventId =
            (payload?.new?.event_id as string | undefined) ??
            (payload?.old?.event_id as string | undefined) ??
            null;
          if (eventId !== null) {
            rqClient.invalidateQueries({
              queryKey: eventOrdersKeys.detail(eventId),
            });
          }
        },
      )
      .subscribe();

    return (): void => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, accountId, rqClient]);

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
  const rqClient = useQueryClient();

  // ORCH-0816 — same Realtime pattern as useBrands, scoped per brand. RLS
  // still constrains delivery to the brand team. Used by BrandProfileView.
  useEffect(() => {
    if (!enabled || brandId === null) return;
    const channelName = `brand-stats-orders-detail-${brandId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
        },
        // ORCH-0862 / F-5: scope the secondary invalidate the same way as
        // the useBrands handler. `eventOrdersKeys.all` was over-broad;
        // extract event_id from the payload and invalidate only that
        // event's orders. brandKeys.detail(brandId) is already scoped.
        (payload: { new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
          rqClient.invalidateQueries({ queryKey: brandKeys.detail(brandId) });
          const eventId =
            (payload?.new?.event_id as string | undefined) ??
            (payload?.old?.event_id as string | undefined) ??
            null;
          if (eventId !== null) {
            rqClient.invalidateQueries({
              queryKey: eventOrdersKeys.detail(eventId),
            });
          }
        },
      )
      .subscribe();

    return (): void => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, brandId, rqClient]);

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
        kind: "popup",
        address: input.address,
        coverHue: input.coverHue,
        role: "owner",
        stats: { events: 0, followers: 0, rev: 0, rev7d: 0, attendees: 0 },
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
      //
      // ORCH-0862 / DISCOVERY-7 — upcomingResult + liveResult are now
      // date-aware (event_dates!inner + .gt("event_dates.end_at", now)).
      // Past-dated rows that still carry status='scheduled' or 'live' no
      // longer count as blockers — matches the home screen's lifecycle
      // helper semantics (ORCH-0850 end-not-start parity). pastResult
      // stays status-only because cancelled/ended lifecycle is already
      // authoritative regardless of date.
      const nowIso = new Date().toISOString();
      const [pastResult, upcomingResult, liveResult, teamResult, stripeStatusResult] =
        await Promise.all([
          // ORCH-0859 REWORK 3 (events-type-filter audit): brand-stats
          // counters must exclude trips so the "X scheduled events" badge
          // doesn't include trip rows. Trip counts have their own surface.
          supabase
            .from("events")
            .select("id", { count: "exact", head: true })
            .eq("brand_id", brandId)
            .eq("event_type", "event")
            .in("status", ["ended", "cancelled"])
            .is("deleted_at", null),
          supabase
            .from("events")
            .select("id, event_dates!inner(end_at)", { count: "exact", head: true })
            .eq("brand_id", brandId)
            .eq("event_type", "event")
            .eq("status", "scheduled")
            .is("deleted_at", null)
            .gt("event_dates.end_at", nowIso),
          supabase
            .from("events")
            .select("id, event_dates!inner(end_at)", { count: "exact", head: true })
            .eq("brand_id", brandId)
            .eq("event_type", "event")
            .eq("status", "live")
            .is("deleted_at", null)
            .gt("event_dates.end_at", nowIso),
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

// ----- Ve1: physical venue brand (pending review) ------------------------

export interface CreateVenueBrandMutationInput extends CreateVenueBrandPendingInput {
  accountId: string;
}

export interface UseCreateVenueBrandResult {
  mutateAsync: (input: CreateVenueBrandMutationInput) => Promise<Brand>;
  isPending: boolean;
}

export const useCreateVenueBrand = (): UseCreateVenueBrandResult => {
  const queryClient = useQueryClient();
  const mutation = useMutation<Brand, Error, CreateVenueBrandMutationInput>({
    mutationFn: async ({
      accountId: _accountId,
      ...rest
    }): Promise<Brand> => createVenueBrandPendingReview(rest, "owner"),
    onSuccess: (_brand, { accountId }) => {
      void queryClient.invalidateQueries({ queryKey: brandKeys.list(accountId) });
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};

// ----- Re-exports for convenience ---------------------------------------

export { SlugCollisionError } from "../services/brandsService";
export type {
  CreateBrandInput,
  CreateVenueBrandPendingInput,
  SoftDeleteResult,
  SoftDeleteSuccess,
  SoftDeleteRejection,
} from "../services/brandsService";
