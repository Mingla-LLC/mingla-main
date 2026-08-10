/**
 * Issue #1789 (#1767 Phase 1) — menu modifier groups + modifiers (SPEC #1788
 * P-11, P-11a).
 *
 * "How would you like it?" (single, required) and "Extras" (multi, capped) —
 * the depth a menu needs before a guest can order from it. Same shape as
 * useMenus: auth-gated query + RLS-gated direct upserts + invalidate.
 *
 * MONEY RULE: a modifier's `priceDeltaCents` is stored, never computed here.
 * The client sends a fact; every total a guest ever sees comes back from
 * `venue-order-create` (SPEC P-20). A modifier's currency is welded to its
 * item's by a database trigger, so a cross-currency modifier cannot persist
 * even if a client tried (I-PROPOSED-1767-NEVER-CROSS-SUM-CURRENCIES).
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

export type ModifierSelectionMode = "single" | "multi";

export interface MenuModifier {
  id: string;
  groupId: string;
  name: string;
  priceDeltaCents: number;
  currency: string;
  isAvailable: boolean;
  sortOrder: number;
}

export interface MenuModifierGroup {
  id: string;
  menuItemId: string;
  name: string;
  selectionMode: ModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
  isActive: boolean;
  sortOrder: number;
  modifiers: MenuModifier[];
}

interface GroupRow {
  id: string;
  menu_item_id: string;
  name: string;
  selection_mode: ModifierSelectionMode;
  min_select: number;
  max_select: number | null;
  is_active: boolean;
  sort_order: number;
}

interface ModifierRow {
  id: string;
  group_id: string;
  name: string;
  price_delta_cents: number;
  currency: string;
  is_available: boolean;
  sort_order: number;
}

export const menuModifierKeys = {
  forItem: (
    brandId: string,
    menuItemId: string,
  ): readonly ["menuModifiers", string, string] =>
    ["menuModifiers", brandId, menuItemId] as const,
};

export const fetchMenuModifierGroups = async (
  brandId: string,
  menuItemId: string,
): Promise<MenuModifierGroup[]> => {
  const { data: groupRows, error: groupError } = await supabase
    .from("menu_modifier_groups")
    .select(
      "id, menu_item_id, name, selection_mode, min_select, max_select, is_active, sort_order",
    )
    .eq("brand_id", brandId)
    .eq("menu_item_id", menuItemId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<GroupRow[]>();
  if (groupError !== null) throw groupError;
  const groups = groupRows ?? [];
  if (groups.length === 0) return [];

  const { data: modifierRows, error: modifierError } = await supabase
    .from("menu_modifiers")
    .select(
      "id, group_id, name, price_delta_cents, currency, is_available, sort_order",
    )
    .eq("brand_id", brandId)
    .in("group_id", groups.map((g) => g.id))
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<ModifierRow[]>();
  if (modifierError !== null) throw modifierError;

  const byGroup = new Map<string, MenuModifier[]>();
  for (const row of modifierRows ?? []) {
    const modifier: MenuModifier = {
      id: row.id,
      groupId: row.group_id,
      name: row.name,
      priceDeltaCents: row.price_delta_cents,
      currency: row.currency,
      isAvailable: row.is_available,
      sortOrder: row.sort_order,
    };
    const bucket = byGroup.get(modifier.groupId);
    if (bucket === undefined) byGroup.set(modifier.groupId, [modifier]);
    else bucket.push(modifier);
  }

  return groups.map((row) => ({
    id: row.id,
    menuItemId: row.menu_item_id,
    name: row.name,
    selectionMode: row.selection_mode,
    minSelect: row.min_select,
    maxSelect: row.max_select,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    modifiers: byGroup.get(row.id) ?? [],
  }));
};

export function useMenuModifierGroups(
  brandId: string | null,
  menuItemId: string | null,
): UseQueryResult<MenuModifierGroup[]> {
  const { isAuthReady } = useAuth();
  const enabled =
    isAuthReady &&
    brandId !== null &&
    brandId.length > 0 &&
    menuItemId !== null &&
    menuItemId.length > 0;
  return useQuery<MenuModifierGroup[]>({
    queryKey: enabled
      ? menuModifierKeys.forItem(brandId, menuItemId)
      : (["menuModifiers", "disabled"] as const),
    enabled,
    staleTime: 30_000,
    queryFn: () =>
      enabled ? fetchMenuModifierGroups(brandId, menuItemId) : Promise.resolve([]),
  });
}

export interface ModifierGroupSaveInput {
  /** Present → edit; absent → insert. */
  id?: string;
  menuItemId: string;
  name: string;
  selectionMode: ModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  /** The full replacement option list for this group. */
  modifiers: {
    id?: string;
    name: string;
    priceDeltaCents: number;
    sortOrder: number;
  }[];
  /** The parent item's currency. Welded server-side; sent so the row is valid. */
  currency: string;
}

/**
 * Save a group and its options in one operator gesture. The group upsert runs
 * first because a modifier cannot exist without it; options are then upserted
 * and any option the operator removed is deleted.
 */
export function useSaveModifierGroup(
  brandId: string | null,
): UseMutationResult<void, Error, ModifierGroupSaveInput> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ModifierGroupSaveInput>({
    mutationFn: async (input: ModifierGroupSaveInput): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const groupRow: Record<string, unknown> = {
        brand_id: brandId,
        menu_item_id: input.menuItemId,
        name: input.name,
        selection_mode: input.selectionMode,
        min_select: input.minSelect,
        max_select: input.maxSelect,
        sort_order: input.sortOrder,
        updated_at: new Date().toISOString(),
      };
      if (input.id !== undefined) groupRow.id = input.id;
      const { data: savedGroup, error: groupError } = await supabase
        .from("menu_modifier_groups")
        .upsert(groupRow, { onConflict: "id" })
        .select("id")
        .single();
      if (groupError !== null) throw groupError as unknown as Error;
      const groupId = (savedGroup as { id: string }).id;

      const keptIds: string[] = [];
      const optionRows = input.modifiers.map((modifier) => {
        const row: Record<string, unknown> = {
          brand_id: brandId,
          group_id: groupId,
          name: modifier.name,
          price_delta_cents: modifier.priceDeltaCents,
          currency: input.currency,
          sort_order: modifier.sortOrder,
          updated_at: new Date().toISOString(),
        };
        if (modifier.id !== undefined) {
          row.id = modifier.id;
          keptIds.push(modifier.id);
        }
        return row;
      });
      if (optionRows.length > 0) {
        const { error: optionError } = await supabase
          .from("menu_modifiers")
          .upsert(optionRows, { onConflict: "id" });
        if (optionError !== null) throw optionError as unknown as Error;
      }

      // Remove the options the operator deleted in this gesture.
      let deleteQuery = supabase
        .from("menu_modifiers")
        .delete()
        .eq("brand_id", brandId)
        .eq("group_id", groupId);
      if (keptIds.length > 0) {
        deleteQuery = deleteQuery.not("id", "in", `(${keptIds.join(",")})`);
      }
      const { error: deleteError } = await deleteQuery;
      if (deleteError !== null) throw deleteError as unknown as Error;
    },
    onError: () => undefined,
    onSuccess: (_data, variables) => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: menuModifierKeys.forItem(brandId, variables.menuItemId),
        });
      }
    },
  });
}

export function useDeleteModifierGroup(
  brandId: string | null,
): UseMutationResult<void, Error, { groupId: string; menuItemId: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { groupId: string; menuItemId: string }>({
    mutationFn: async ({ groupId }): Promise<void> => {
      if (brandId === null) throw new Error("brand_required");
      const { error } = await supabase
        .from("menu_modifier_groups")
        .delete()
        .eq("id", groupId)
        .eq("brand_id", brandId);
      if (error !== null) throw error as unknown as Error;
    },
    onError: () => undefined,
    onSuccess: (_data, variables) => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: menuModifierKeys.forItem(brandId, variables.menuItemId),
        });
      }
    },
  });
}
