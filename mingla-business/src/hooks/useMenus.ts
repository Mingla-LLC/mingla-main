/**
 * ORCH-1186-C — venue MENU builder + public-menu data hook.
 *
 * Mirrors useVenueReservationSettings: auth-gated query + RLS-gated direct
 * upsert/delete mutations + invalidate. Query keys come from the menuKeys
 * factory (never hardcoded). All mutations carry onError (Code Quality Contract)
 * and invalidate the brand-menus key on success.
 *
 * DISPLAY-ONLY (DEC-C): no ordering/cart/checkout. This hook NEVER touches
 * experience_stops / experiences / the snap-menu parser
 * (I-PROPOSED-1186C-MENU-NOT-EXPERIENCE-STOPS).
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
import { fetchBrandMenus, type Menu } from "../services/menusService";
import {
  fetchPublicMenus,
} from "../services/publicMenusService";
import type { PublicMenuGroup } from "@mingla/brand-rendering";

export const menuKeys = {
  brandMenus: (brandId: string) => ["menus", brandId] as const,
  publicMenus: (brandSlug: string) => ["publicMenus", brandSlug] as const,
};

// ---- builder read ----
export function useBrandMenus(
  brandId: string | null,
): UseQueryResult<Menu[]> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady && brandId !== null && brandId.length > 0;
  return useQuery<Menu[]>({
    queryKey: enabled
      ? menuKeys.brandMenus(brandId)
      : (["menus", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () => (enabled ? fetchBrandMenus(brandId) : Promise.resolve([])),
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
}

export function useUpsertMenu(
  brandId: string | null,
): UseMutationResult<void, Error, MenuUpsertInput> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, MenuUpsertInput>({
    mutationFn: async (input: MenuUpsertInput): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const row: Record<string, unknown> = {
        brand_id: brandId,
        name: input.name,
        description: input.description,
        sort_order: input.sortOrder,
        updated_at: new Date().toISOString(),
      };
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
          queryKey: menuKeys.brandMenus(brandId),
        });
      }
    },
  });
}

export function useDeleteMenu(
  brandId: string | null,
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
        .eq("brand_id", brandId);
      if (error !== null) throw error as unknown as Error;
    },
    onError: () => undefined,
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: menuKeys.brandMenus(brandId),
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
}

export function useUpsertMenuItem(
  brandId: string | null,
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
          queryKey: menuKeys.brandMenus(brandId),
        });
      }
    },
  });
}

export function useDeleteMenuItem(
  brandId: string | null,
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
          queryKey: menuKeys.brandMenus(brandId),
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

/**
 * Reorder menu ITEMS: write sort_order for the affected rows in one batched
 * upsert. brand_id + menu_id are set per row so the upsert satisfies RLS + the
 * brand-scoping integrity rule. menuId is the parent menu of all rows.
 */
export function useReorderMenuItems(
  brandId: string | null,
): UseMutationResult<void, Error, { menuId: string; patches: SortOrderPatch[] }> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { menuId: string; patches: SortOrderPatch[] }>({
    mutationFn: async ({
      menuId,
      patches,
    }: {
      menuId: string;
      patches: SortOrderPatch[];
    }): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      if (patches.length === 0) return;
      const now = new Date().toISOString();
      const rows = patches.map((p) => ({
        id: p.id,
        brand_id: brandId,
        menu_id: menuId,
        sort_order: p.sortOrder,
        updated_at: now,
      }));
      const { error } = await supabase
        .from("menu_items")
        .upsert(rows, { onConflict: "id" });
      if (error !== null) throw error as unknown as Error;
    },
    onError: () => undefined,
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: menuKeys.brandMenus(brandId),
        });
      }
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
          .eq("brand_id", brandId);
        if (error !== null) throw error as unknown as Error;
      }
    },
    onError: () => undefined,
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: menuKeys.brandMenus(brandId),
        });
      }
    },
  });
}

// ---- public read (used by the consumer app; web folds it into the batch) ----
export function usePublicMenus(
  brandSlug: string | null,
): UseQueryResult<PublicMenuGroup[]> {
  const enabled = brandSlug !== null && brandSlug.length > 0;
  return useQuery<PublicMenuGroup[]>({
    queryKey: enabled
      ? menuKeys.publicMenus(brandSlug)
      : (["publicMenus", "disabled"] as const),
    enabled,
    staleTime: 60_000,
    queryFn: () =>
      enabled ? fetchPublicMenus(brandSlug) : Promise.resolve([]),
  });
}
