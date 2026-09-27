/**
 * ORCH-1186-C — venue MENU builder + public-menu data hook.
 *
 * Mirrors useVenueReservationSettings: auth-gated query + RLS-gated direct
 * upsert/delete mutations + invalidate. Query keys come from the menuKeys
 * factory (never hardcoded). All mutations carry onError (Code Quality Contract)
 * and invalidate the brand-menus key on success.
 *
 * AMENDED at #1767 Phase 1 (issue #1789): the DEC-C display-only clause is
 * retired — the venue menu becomes an ordering surface. What survives is that
 * the menu surface never does money itself (SPEC #1788 P-20). The upsert
 * inputs gain the #1789 depth fields (P-12); every one of them is a menu FACT,
 * never a price computation.
 *
 * This hook NEVER touches experience_stops / experiences / the snap-menu parser
 * (I-PROPOSED-1186C-MENU-NOT-EXPERIENCE-STOPS).
 */

import { useEffect, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import { fetchBrandMenus, type Menu } from "../services/menusService";
import { fetchPublicMenus } from "../services/publicMenusService";
import type { PublicMenuGroup } from "@mingla/brand-rendering";
import {
  applyOptimisticMenuItemOrder,
  canRetryMenuItemReorder,
  classifyMenuItemReorderError,
  installCanonicalMenuItemOrder,
  menuItemRelationshipIsApplied,
  MenuItemReorderError,
  parseCanonicalMenuItemOrder,
  type CanonicalMenuItemOrder,
  type MenuItemReorderIntent,
} from "./menuItemReorder";
import { orderPadKeys } from "./orderPadQueryKeys";
import { publicMenuBundleKeys } from "./publicMenuBundleQueryKeys";

export const menuKeys = {
  brandMenus: (brandId: string, venueId?: string | null) =>
    ["menus", brandId, venueId ?? "all"] as const,
  publicMenus: (brandSlug: string, venueSlug: string) =>
    ["publicMenus", brandSlug, venueSlug] as const,
  publicMenusRoot: ["publicMenus"] as const,
};

// ---- builder read ----
export function useBrandMenus(
  brandId: string | null,
  venueId?: string | null,
): UseQueryResult<Menu[]> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<Menu[]>({
    queryKey: enabled
      ? menuKeys.brandMenus(brandId, venueId)
      : (["menus", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () =>
      enabled ? fetchBrandMenus(brandId, venueId) : Promise.resolve([]),
  });
}

// ---- menu (category) mutations ----
export interface MenuUpsertInput {
  /** Present → edit; absent → insert. */
  id?: string;
  name: string;
  description: string | null;
  /** Required on insert; preserved on edit. */
  sortOrder: number;
  // ---- Issue #1789 (SPEC #1788 P-12) — service windows. Optional so every
  // existing caller is byte-compatible; both null = always available, which is
  // today's behaviour. `end < start` WRAPS MIDNIGHT (a late-night menu), and
  // the window is evaluated in VENUE-LOCAL time SERVER-SIDE via the #1403
  // ladder — never the device's clock.
  serviceWindowStart?: string | null;
  serviceWindowEnd?: string | null;
  /** ISO day-of-week 1..7; null = every day. */
  serviceDays?: number[] | null;
}

export function useUpsertMenu(
  brandId: string | null,
  venueId: string | null,
): UseMutationResult<void, Error, MenuUpsertInput> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, MenuUpsertInput>({
    mutationFn: async (input: MenuUpsertInput): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      if (venueId === null) throw new Error("venue_required");
      const row: Record<string, unknown> = {
        brand_id: brandId,
        venue_id: venueId,
        name: input.name,
        description: input.description,
        sort_order: input.sortOrder,
        updated_at: new Date().toISOString(),
      };
      if (input.serviceWindowStart !== undefined) {
        row.service_window_start = input.serviceWindowStart;
      }
      if (input.serviceWindowEnd !== undefined) {
        row.service_window_end = input.serviceWindowEnd;
      }
      if (input.serviceDays !== undefined) row.service_days = input.serviceDays;
      if (input.id !== undefined) row.id = input.id;
      const { error } = await supabase
        .from("menus")
        .upsert(row, { onConflict: "id" });
      if (error !== null) throw error as unknown as Error;
    },
    onError: () => undefined,
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: menuKeys.brandMenus(brandId, venueId),
        });
      }
    },
  });
}

export function useDeleteMenu(
  brandId: string | null,
  venueId?: string | null,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (menuId: string): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      // ON DELETE CASCADE removes the menu's items server-side.
      const { error } = await supabase
        .from("menus")
        .delete()
        .eq("id", menuId)
        .eq("brand_id", brandId)
        .eq("venue_id", venueId ?? "");
      if (error !== null) throw error as unknown as Error;
    },
    onError: () => undefined,
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: menuKeys.brandMenus(brandId, venueId),
        });
      }
    },
  });
}

// ---- item mutations ----
export interface MenuItemUpsertInput {
  /** Present → edit; absent → insert. */
  id?: string;
  menuId: string;
  name: string;
  description: string | null;
  /** Minor units (cents/kobo). null = "price on request". */
  priceCents: number | null;
  currency: string;
  isAvailable: boolean;
  /** Required on insert; preserved on edit. */
  sortOrder: number;
  // ---- Issue #1789 (SPEC #1788 P-12) — menu depth. All optional so the
  // one-tap 86 path and every existing caller stay byte-compatible.
  /** Whether a guest may attach a kitchen note to this line. */
  allowsNotes?: boolean;
  /** Phase-5 kiosk routing seam. */
  prepStation?: "kitchen" | "bar" | "other" | null;
  /** Opt-in food cost, minor units. NEVER exposed publicly. */
  costCents?: number | null;
}

export function useUpsertMenuItem(
  brandId: string | null,
  venueId?: string | null,
): UseMutationResult<void, Error, MenuItemUpsertInput> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, MenuItemUpsertInput>({
    mutationFn: async (input: MenuItemUpsertInput): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const row: Record<string, unknown> = {
        // brand_id MUST match the parent menu's brand_id (a CHECK cannot
        // cross-reference; the service enforces it).
        brand_id: brandId,
        menu_id: input.menuId,
        name: input.name,
        description: input.description,
        price_cents: input.priceCents,
        currency: input.currency,
        is_available: input.isAvailable,
        sort_order: input.sortOrder,
        updated_at: new Date().toISOString(),
      };
      // #1789 — only send the depth fields a caller actually set, so the
      // one-tap 86 toggle can flip ONE bit without restating the whole row.
      if (input.allowsNotes !== undefined) row.allows_notes = input.allowsNotes;
      if (input.prepStation !== undefined) row.prep_station = input.prepStation;
      if (input.costCents !== undefined) row.cost_cents = input.costCents;
      if (input.id !== undefined) row.id = input.id;
      const { error } = await supabase
        .from("menu_items")
        .upsert(row, { onConflict: "id" });
      if (error !== null) throw error as unknown as Error;
    },
    onError: () => undefined,
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: menuKeys.brandMenus(brandId, venueId),
        });
      }
    },
  });
}

export function useDeleteMenuItem(
  brandId: string | null,
  venueId?: string | null,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (itemId: string): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const { error } = await supabase
        .from("menu_items")
        .delete()
        .eq("id", itemId)
        .eq("brand_id", brandId);
      if (error !== null) throw error as unknown as Error;
    },
    onError: () => undefined,
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: menuKeys.brandMenus(brandId, venueId),
        });
      }
    },
  });
}

/** A single {id, sortOrder} pair for a reorder batch. */
export interface SortOrderPatch {
  id: string;
  sortOrder: number;
}

interface MenuItemReorderMutationContext {
  operationId: string;
  scopeKey: string;
  authoringKey: ReturnType<typeof menuKeys.brandMenus>;
  snapshot: Menu[] | undefined;
}

/** Reorder one adjacent menu item through the complete-order atomic RPC. */
export function useReorderMenuItems(
  brandId: string | null,
  venueId?: string | null,
): UseMutationResult<
  CanonicalMenuItemOrder,
  MenuItemReorderError,
  MenuItemReorderIntent,
  MenuItemReorderMutationContext
> {
  const queryClient = useQueryClient();
  const activeOperationRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const scopeKey = `${brandId ?? "disabled"}:${venueId ?? "disabled"}`;
  const scopeRef = useRef(scopeKey);

  useEffect(() => {
    mountedRef.current = true;
    scopeRef.current = scopeKey;
    activeOperationRef.current = null;
    return () => {
      mountedRef.current = false;
      activeOperationRef.current = null;
    };
  }, [scopeKey]);

  const isCurrent = (intent: MenuItemReorderIntent): boolean =>
    mountedRef.current &&
    scopeRef.current === scopeKey &&
    activeOperationRef.current === intent.operationId &&
    intent.brandId === brandId &&
    intent.venueId === venueId;

  const invalidateReaders = (intent: MenuItemReorderIntent): void => {
    void queryClient.invalidateQueries({
      queryKey: orderPadKeys.forBrand(intent.brandId),
    });
    void queryClient.invalidateQueries({ queryKey: menuKeys.publicMenusRoot });
    void queryClient.invalidateQueries({ queryKey: publicMenuBundleKeys.all });
  };

  return useMutation<
    CanonicalMenuItemOrder,
    MenuItemReorderError,
    MenuItemReorderIntent,
    MenuItemReorderMutationContext
  >({
    mutationFn: async (intent): Promise<CanonicalMenuItemOrder> => {
      if (
        brandId === null ||
        venueId === null ||
        venueId === undefined ||
        intent.brandId !== brandId ||
        intent.venueId !== venueId
      ) {
        throw new MenuItemReorderError("generic", "scope_mismatch");
      }
      try {
        const { data, error } = await supabase.rpc(
          "biz_reorder_menu_items_v1",
          {
            p_brand_id: intent.brandId,
            p_venue_id: intent.venueId,
            p_menu_id: intent.menuId,
            p_expected_items: intent.expectedItems.map((item) => ({
              id: item.id,
              sort_order: item.sortOrder,
            })),
            p_ordered_item_ids: intent.orderedItemIds,
          },
        );
        if (error !== null) throw classifyMenuItemReorderError(error);
        const canonical = parseCanonicalMenuItemOrder(data, intent);
        if (canonical === null) {
          throw new MenuItemReorderError("uncertain", "invalid_response");
        }
        return canonical;
      } catch (error) {
        throw classifyMenuItemReorderError(error);
      }
    },
    retry: false,
    onMutate: async (intent) => {
      const authoringKey = menuKeys.brandMenus(intent.brandId, intent.venueId);
      activeOperationRef.current = intent.operationId;
      await queryClient.cancelQueries({ queryKey: authoringKey, exact: true });
      const snapshot = queryClient.getQueryData<Menu[]>(authoringKey);
      if (isCurrent(intent)) {
        queryClient.setQueryData<Menu[]>(authoringKey, (current) =>
          applyOptimisticMenuItemOrder(current, intent),
        );
      }
      return { operationId: intent.operationId, scopeKey, authoringKey, snapshot };
    },
    onSuccess: (canonical, intent, context) => {
      if (
        context === undefined ||
        context.scopeKey !== scopeKey ||
        !isCurrent(intent)
      ) {
        return;
      }
      queryClient.setQueryData<Menu[]>(context.authoringKey, (current) =>
        installCanonicalMenuItemOrder(current, canonical),
      );
      void queryClient.invalidateQueries({
        queryKey: context.authoringKey,
        exact: true,
      });
      invalidateReaders(intent);
    },
    onError: async (rawError, intent, context) => {
      const error = classifyMenuItemReorderError(rawError);
      if (
        context === undefined ||
        context.operationId !== intent.operationId ||
        context.scopeKey !== scopeKey ||
        !isCurrent(intent)
      ) {
        return;
      }

      queryClient.setQueryData<Menu[] | undefined>(
        context.authoringKey,
        context.snapshot,
      );
      console.error("[reorder_menu_items] failed", {
        brandId: intent.brandId,
        venueId: intent.venueId,
        menuId: intent.menuId,
        code: error.code,
        category: error.category,
      });

      if (error.category === "conflict" || error.category === "uncertain") {
        try {
          await queryClient.refetchQueries(
            {
              queryKey: context.authoringKey,
              exact: true,
            },
            { throwOnError: true },
          );
        } catch {
          if (!isCurrent(intent)) return;
          // A failed refetch leaves TanStack Query in an error state even when
          // its prior data remains cached. Reinstall the exact rollback snapshot
          // so the menu stays usable, then return an honest uncertain result;
          // never interpret that snapshot as newly confirmed server truth.
          queryClient.setQueryData<Menu[] | undefined>(
            context.authoringKey,
            context.snapshot,
          );
          error.markConfirmationFailed(
            canRetryMenuItemReorder(context.snapshot, intent),
          );
          console.error("[reorder_menu_items] confirmation failed", {
            brandId: intent.brandId,
            venueId: intent.venueId,
            menuId: intent.menuId,
            code: error.code,
            category: error.category,
          });
          return;
        }
        if (!isCurrent(intent)) return;
        const latest = queryClient.getQueryData<Menu[]>(context.authoringKey);
        if (menuItemRelationshipIsApplied(latest, intent)) {
          error.resolvedAsSuccess = true;
          error.authoritativeMenus = latest;
          invalidateReaders(intent);
          return;
        }
        error.retryable = canRetryMenuItemReorder(latest, intent);
        return;
      }

      error.retryable =
        error.category === "generic" &&
        canRetryMenuItemReorder(context.snapshot, intent);
    },
  });
}

/**
 * Reorder menu CATEGORIES (menus rows): write sort_order in one batched upsert.
 * name is preserved by upserting only id + sort_order would violate NOT NULL on
 * name, so we read it back is unnecessary — Postgres upsert on conflict updates
 * only the supplied columns; supply name to satisfy any insert path is not
 * needed because these ids already exist. We supply id + sort_order; on conflict
 * Supabase updates the matched columns only.
 */
export function useReorderMenus(
  brandId: string | null,
  venueId?: string | null,
): UseMutationResult<void, Error, SortOrderPatch[]> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, SortOrderPatch[]>({
    mutationFn: async (patches: SortOrderPatch[]): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      if (patches.length === 0) return;
      const now = new Date().toISOString();
      // Per-row UPDATE (not upsert) so we never need to supply the NOT NULL
      // `name` for an existing row; each row is scoped by brand_id for RLS.
      for (const p of patches) {
        const { error } = await supabase
          .from("menus")
          .update({ sort_order: p.sortOrder, updated_at: now })
          .eq("id", p.id)
          .eq("brand_id", brandId)
          .eq("venue_id", venueId ?? "");
        if (error !== null) throw error as unknown as Error;
      }
    },
    onError: () => undefined,
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: menuKeys.brandMenus(brandId, venueId),
        });
      }
    },
  });
}

// ---- public read (used by the consumer app; web folds it into the batch) ----
export function usePublicMenus(
  brandSlug: string | null,
  venueSlug: string | null,
): UseQueryResult<PublicMenuGroup[]> {
  const enabled =
    brandSlug !== null &&
    brandSlug.length > 0 &&
    venueSlug !== null &&
    venueSlug.length > 0;
  return useQuery<PublicMenuGroup[]>({
    queryKey: enabled
      ? menuKeys.publicMenus(brandSlug, venueSlug)
      : (["publicMenus", "disabled"] as const),
    enabled,
    staleTime: 60_000,
    queryFn: () =>
      enabled ? fetchPublicMenus(brandSlug, venueSlug) : Promise.resolve([]),
  });
}
