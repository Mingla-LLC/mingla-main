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

import { useCallback, useEffect, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
// META-ORCH-1232 (C2) — await-until-ready guard for the imperative brand
// mutations (mirrors how useBrands gates the read on isAuthReady).
// META-ORCH-1232 follow-up (fresh-signup gap) — awaitSessionAttached additionally
// awaits a REAL attached access token before the insert, because on a fresh signup
// the isAuthReady flag flips true a beat before the Supabase client attaches the
// JWT to outgoing PostgREST requests (insert would still go out as anon).
import { awaitAuthReady, awaitSessionAttached } from "../utils/authReadyGate";
import { withTimeout } from "../utils/withTimeout";
import { eventOrdersKeys } from "./useEventOrders";
import { publicEventKeys } from "./usePublicEvents";
// ORCH-1251 — brandKeys now lives in a standalone keyless module so AuthContext
// can import it without a require-cycle. Imported here for internal use +
// re-exported below for backward compat.
import { brandKeys } from "./brandKeys";
import {
  BrandsAuthSessionNotAttachedError,
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
// ORCH-1062 — soft-delete must synchronously evict the deleted brand from the
// list cache + clear a stale default_brand_id pointer so useCurrentBrandRecovery
// cannot re-resolve the just-deleted brand (the render-loop root cause).
import { creatorAccountKeys, type CreatorAccountRow } from "./useCreatorAccount";

// ORCH-0816 — brand stats (rev, rev7d, attendees) follow ticket sales, which
// change frequently. Combined with the Realtime subscription on `orders`
// below, 30s gives a fast-enough fallback when Realtime drops the connection
// or the publication migration has not landed.
const STALE_TIME_MS = 30 * 1000;

// ORCH-1249 (biz cold-start brand-hydration): on a COLD start (fresh install,
// no cached session) the brand switcher / dashboard could hang on
// "Loading your brands…" forever until a force-quit + reopen. Root cause: the
// list read fires during the auth-bootstrap race with NO hook-level settle
// guarantee, so a stalled first attempt left React Query pinned in `isLoading`.
// Bound the read at 9s (mirrors ORCH-1248's useCreatorAccount) so a hung request
// REJECTS → React Query surfaces isError → the caller's error/retry state shows
// instead of an eternal spinner. 9s sits UNDER getBrands' internal 15s
// DATA_FETCH ceiling yet gives a slow-but-real read room to succeed.
const BRANDS_FETCH_TIMEOUT_MS = 9000;

// ORCH-1254 [reviewer setSession brands-load race] — RESILIENT defense-in-depth
// (complements the deterministic AuthContext wait). getBrands does a getSession()
// precheck and THROWS BrandsAuthSessionNotAttachedError while the session token is
// not-yet-attached. On the reviewer setSession() path (and any other auth path
// where the read can momentarily beat the token-attach), that error would settle
// in the cache and never recover on its own (ORCH-1251's onAuthStateChange
// reconcile can race). Retry ONLY that transient attach error a few times with a
// short backoff so a momentary not-attached self-heals — genuine non-auth errors
// (network / 500 / RLS) are NOT retried here and surface normally.
export const NOT_ATTACHED_RETRY_MAX = 4;
export const NOT_ATTACHED_RETRY_DELAY_MS = 400;
// ORCH-0964's global default retry count — preserved for genuine (non-auth)
// errors on this query so ORCH-1254's scoped retry does NOT weaken flaky-network
// recovery. Only the not-attached transient gets the higher NOT_ATTACHED_RETRY_MAX.
export const GENUINE_ERROR_RETRY_MAX = 2;

// ORCH-1254 — the not-attached transient predicate. Name-check as well as
// instanceof so a copy of the error crossing a module/realm boundary still matches.
const isBrandsAuthSessionNotAttachedError = (error: unknown): boolean =>
  error instanceof BrandsAuthSessionNotAttachedError ||
  (error instanceof Error &&
    error.name === "BrandsAuthSessionNotAttachedError");

/**
 * ORCH-1254 — React Query `retry` predicate. Gives the transient
 * BrandsAuthSessionNotAttachedError a HIGHER bounded retry budget
 * (NOT_ATTACHED_RETRY_MAX) so a momentary token-not-attached window self-heals,
 * while ANY OTHER error keeps the normal ORCH-0964 policy (GENUINE_ERROR_RETRY_MAX)
 * and then surfaces to the caller's error UI — genuine network/500/RLS failures
 * are NOT masked behind an endless retry loop, and there is no infinite hang.
 */
export const retryOnAuthNotAttached = (
  failureCount: number,
  error: unknown,
): boolean =>
  isBrandsAuthSessionNotAttachedError(error)
    ? failureCount < NOT_ATTACHED_RETRY_MAX
    : failureCount < GENUINE_ERROR_RETRY_MAX;

/**
 * ORCH-1254 — retry backoff. The not-attached transient uses a SHORT fixed delay
 * (it self-heals in a few hundred ms once supabase-js propagates the token);
 * genuine errors keep ORCH-0964's capped exponential backoff so this scoped fix
 * does not change flaky-network recovery timing.
 */
export const retryDelayForAuthNotAttached = (
  failureCount: number,
  error: unknown,
): number =>
  isBrandsAuthSessionNotAttachedError(error)
    ? NOT_ATTACHED_RETRY_DELAY_MS
    : Math.min(1000 * 2 ** failureCount, 4000);

// ----- Query key factory -------------------------------------------------
// ORCH-1251 — the brandKeys factory lives in a standalone keyless module
// (./brandKeys) so AuthContext.tsx can import it for the token-attach cache
// reconcile without a require-cycle (AuthContext → useBrands → AuthContext).
// Re-exported here for backward compat so existing `import { brandKeys } from
// "./useBrands"` call sites keep working (Constitutional #4 — one key per entity).
export { brandKeys } from "./brandKeys";
export { getBrandFromCache } from "./brandCache";

const DISABLED_KEY = ["brands-disabled"] as const;

// ----- useBrands (list) --------------------------------------------------

/**
 * ORCH-1249 (biz cold-start brand-hydration): the brands-list read, hardened to
 * ALWAYS settle. An AbortController lets us cancel the in-flight request when the
 * timeout fires, and `withTimeout` rejects the consumer after
 * BRANDS_FETCH_TIMEOUT_MS, so a stalled read on a cold-bootstrap auth race can
 * NEVER leave "Loading your brands…" spinning forever — React Query surfaces
 * isError → the caller's error/retry UI shows. Exported for the ORCH-1249
 * timeout regression test.
 *
 * getBrands already accepts no signal, so we abort on timeout to release the
 * orphaned socket (settle-guarantee is provided by withTimeout regardless).
 */
export const fetchBrandsList = async (
  accountId: string,
): Promise<Brand[]> => {
  const controller = new AbortController();
  try {
    return await withTimeout(
      getBrands(accountId, controller.signal),
      BRANDS_FETCH_TIMEOUT_MS,
      "useBrands",
    );
  } catch (err) {
    // On timeout, abort the in-flight request so it doesn't linger.
    controller.abort();
    throw err;
  }
};

export const useBrands = (
  accountId: string | null,
): UseQueryResult<Brand[]> => {
  // ORCH-1004 — lists the signed-in user's brands via the authenticated
  // "Account owner can select own brands" RLS policy; anon returns 200 + []
  // which caches as success. Gate on auth readiness. (useBrand single-by-id
  // stays UNGATED — `brands` has an anon "Public can read non-deleted brands"
  // policy and the public buyer pages depend on it.)
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && accountId !== null;
  const rqClient = useQueryClient();

  // ORCH-1249 (biz cold-start brand-hydration): guarantee a refetch when auth
  // transitions to ready (enabled flips false→true). React Query normally
  // auto-fires when `enabled` flips true, but on a cold bootstrap the FIRST
  // attempt can settle to an error (timed-out/anon read) BEFORE auth is warm; a
  // failed query is no longer refetched merely because `enabled` stays true.
  // Explicitly refetch on the false→true edge so the (now-authed) read runs, and
  // the eternal spinner cannot survive the auth-ready flip.
  const prevEnabledRef = useRef(enabled);
  useEffect(() => {
    if (enabled && !prevEnabledRef.current && accountId !== null) {
      void rqClient.refetchQueries({ queryKey: brandKeys.list(accountId) });
    }
    prevEnabledRef.current = enabled;
  }, [enabled, accountId, rqClient]);

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
    // ORCH-1249 (biz cold-start brand-hydration): force the query to run
    // regardless of a misreported navigator.onLine, and let stale cache serve
    // during a refetch window (matches useCreatorAccount). A cold-bootstrap
    // captive/offline-flap can't pause the read into a permanent spinner.
    networkMode: "always",
    // ORCH-1254 [reviewer setSession brands-load race] — bounded self-heal for
    // the transient token-not-attached window. Retry ONLY
    // BrandsAuthSessionNotAttachedError (scoped predicate) so a momentary
    // not-attached recovers; genuine failures still surface after the first
    // attempt. Keeps ORCH-1249's timeout + networkMode and ORCH-1251's reconcile.
    retry: retryOnAuthNotAttached,
    retryDelay: retryDelayForAuthNotAttached,
    queryFn: async (): Promise<Brand[]> => {
      if (!enabled || accountId === null) return [];
      // ORCH-1249 — bounded, always-settling read (9s timeout + abort). A hung
      // cold-start request now REJECTS → React Query surfaces isError → the
      // caller's error/retry UI shows instead of "Loading your brands…" forever.
      return fetchBrandsList(accountId);
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

// ----- META-ORCH-1232 (C2) auth-ready getter for imperative mutations -----

/**
 * Returns a stable getter that reports the CURRENT `isAuthReady` value. A
 * mutation's `mutationFn` is imperative and captures `isAuthReady` by closure at
 * call time; this ref-backed getter lets the await-until-ready loop observe auth
 * flipping true mid-flight (the session JWT attaching late on web) without
 * re-creating the mutation. Used by all three brand mutation hooks so the gate is
 * applied uniformly (SPEC §2 C2).
 */
const useIsAuthReadyGetter = (): (() => boolean) => {
  const { isAuthReady } = useAuth();
  const ref = useRef(isAuthReady);
  useEffect(() => {
    ref.current = isAuthReady;
  }, [isAuthReady]);
  return useCallback(() => ref.current, []);
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
  // META-ORCH-1232 (C2) — auth-aware gate. The brand INSERT must not run while
  // auth is warming (anon → RLS WITH CHECK rejection presented as a no-op).
  const isAuthReadyGetter = useIsAuthReadyGetter();
  const mutation = useMutation<Brand, Error, CreateBrandInput, CreateBrandContext>({
    mutationFn: async (input: CreateBrandInput): Promise<Brand> => {
      // META-ORCH-1232 (C2) — await-until-ready (≤5s cap). If auth settles in the
      // window we proceed (now correctly authed); if the cap elapses still
      // not-ready, awaitAuthReady throws AuthNotReadyError → H1 surfaces it as a
      // visible, retryable error. NEVER silently drops the create.
      await awaitAuthReady({ isReady: isAuthReadyGetter });
      // META-ORCH-1232 follow-up (fresh-signup gap) — the flag above is NOT
      // sufficient on a brand-new signup: it flips true a beat BEFORE the
      // Supabase client attaches the access token to outgoing PostgREST
      // requests, so the insert would still go out as anon (DB throws
      // `permission denied for table brands`). Await a REAL attached session
      // token on the SAME client singleton the service write uses; cap-elapse
      // throws AuthNotReadyError (visible, retryable) — never a silent anon drop.
      await awaitSessionAttached(() => supabase.auth.getSession());
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
  // META-ORCH-1232 (C2) — same auth-ready gate as useCreateBrand; a profile edit
  // fired during the auth-warm window would otherwise hit the anon RLS rejection.
  const isAuthReadyGetter = useIsAuthReadyGetter();
  const mutation = useMutation<Brand, Error, UpdateBrandInput, UpdateBrandContext>({
    mutationFn: async ({ brandId, patch, existingDescription }) => {
      await awaitAuthReady({ isReady: isAuthReadyGetter });
      // META-ORCH-1232 follow-up (fresh-signup gap) — await a REAL attached
      // session token (not merely the isAuthReady flag) before the UPDATE, so a
      // mutation issued during the auth-warm window can never go out as anon.
      await awaitSessionAttached(() => supabase.auth.getSession());
      return updateBrand(brandId, patch, existingDescription);
    },
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
      queryClient.invalidateQueries({
        queryKey: publicEventKeys.brandBySlug(serverBrand.slug),
      });
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
        // ORCH-1062 — ROOT-CAUSE fix for the "Maximum update depth exceeded"
        // crash when deleting the CURRENTLY-SELECTED brand. The old code only
        // INVALIDATED the list, so React Query kept serving the STALE list (still
        // containing the just-deleted brand) during the background refetch. In
        // that window `useCurrentBrandRecovery` re-resolved the deleted brand
        // (from the stale list / stale default_brand_id) while `useCurrentBrand`
        // cleared currentBrandId to null (its detail fetch correctly returns
        // null) — the two hooks ping-ponged currentBrandId synchronously until
        // React's nested-update cap tripped the render-loop crash. Fix:
        // SYNCHRONOUSLY drop the deleted brand from the list cache so the
        // resolver immediately sees fresh data and lands on a valid brand.
        queryClient.setQueryData<Brand[]>(brandKeys.list(accountId), (prev) =>
          prev !== undefined ? prev.filter((b) => b.id !== brandId) : prev,
        );
        // Clear default_brand_id in the creator-account cache if it pointed at
        // the deleted brand (softDeleteBrand Step 3 already cleared it server-
        // side; this stops the cache from briefly re-resolving the dead pointer).
        queryClient.setQueryData<CreatorAccountRow | null>(
          creatorAccountKeys.byId(accountId),
          (prev) =>
            prev != null && prev.default_brand_id === brandId
              ? { ...prev, default_brand_id: null }
              : prev,
        );
        // Invalidate list — server-truth backstop (also reconciles any cascade).
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
  // META-ORCH-1232 (C2) — same auth-ready gate as the other brand mutations.
  const isAuthReadyGetter = useIsAuthReadyGetter();
  const mutation = useMutation<Brand, Error, CreateVenueBrandMutationInput>({
    mutationFn: async ({
      accountId: _accountId,
      ...rest
    }): Promise<Brand> => {
      await awaitAuthReady({ isReady: isAuthReadyGetter });
      // META-ORCH-1232 follow-up (fresh-signup gap) — await a REAL attached
      // session token before the venue-brand authoring RPC, so the insert can
      // never be issued as anon during the fresh-signup auth-warm window.
      await awaitSessionAttached(() => supabase.auth.getSession());
      return createVenueBrandPendingReview(rest, "owner");
    },
    onSuccess: (_brand, { accountId }) => {
      void queryClient.invalidateQueries({ queryKey: brandKeys.list(accountId) });
    },
  });
  return { mutateAsync: mutation.mutateAsync, isPending: mutation.isPending };
};

// ----- Re-exports for convenience ---------------------------------------

export { SlugCollisionError, resolveAvailableVenueSlug } from "../services/brandsService";
export type {
  CreateBrandInput,
  CreateVenueBrandPendingInput,
  SoftDeleteResult,
  SoftDeleteSuccess,
  SoftDeleteRejection,
} from "../services/brandsService";
