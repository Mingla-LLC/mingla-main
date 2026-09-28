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
import { venueOrderingQueryKeys } from "@mingla/brand-rendering/venueOrdering/venueOrderingQueryKeys";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../services/supabase";
import {
  isLikelyOfflineError,
  isPermissionDeniedError,
  normalizeSupabaseError,
} from "../utils/supabaseErrorMessage";
import { orderPadKeys } from "./orderPadQueryKeys";

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
    .in(
      "group_id",
      groups.map((g) => g.id),
    )
    .eq("is_available", true)
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
      enabled
        ? fetchMenuModifierGroups(brandId, menuItemId)
        : Promise.resolve([]),
  });
}

export interface ModifierGroupSaveInput {
  /** Stable UUID minted by the draft before its first request. */
  id: string;
  menuItemId: string;
  name: string;
  selectionMode: ModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
  sortOrder: number;
  /** The full replacement option list for this group. */
  modifiers: {
    id: string;
    name: string;
    priceDeltaCents: number;
    sortOrder: number;
  }[];
}

interface CanonicalModifierGroupRow {
  id: string;
  menu_item_id: string;
  name: string;
  selection_mode: ModifierSelectionMode;
  min_select: number;
  max_select: number | null;
  is_active: boolean;
  sort_order: number;
  modifiers: ModifierRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalModifierRow(value: unknown): value is ModifierRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.group_id === "string" &&
    typeof value.name === "string" &&
    typeof value.price_delta_cents === "number" &&
    Number.isInteger(value.price_delta_cents) &&
    typeof value.currency === "string" &&
    value.currency.length === 3 &&
    value.currency === value.currency.toUpperCase() &&
    value.is_available === true &&
    typeof value.sort_order === "number" &&
    Number.isInteger(value.sort_order)
  );
}

function isCanonicalModifierGroupRow(
  value: unknown,
  input: ModifierGroupSaveInput,
): value is CanonicalModifierGroupRow {
  if (!isRecord(value) || !Array.isArray(value.modifiers)) return false;
  const expectedIds = new Set(input.modifiers.map((modifier) => modifier.id));
  const returnedIds = new Set(
    value.modifiers
      .filter(isCanonicalModifierRow)
      .map((modifier) => modifier.id),
  );
  return (
    value.id === input.id &&
    value.menu_item_id === input.menuItemId &&
    typeof value.name === "string" &&
    (value.selection_mode === "single" || value.selection_mode === "multi") &&
    typeof value.min_select === "number" &&
    Number.isInteger(value.min_select) &&
    (value.max_select === null ||
      (typeof value.max_select === "number" &&
        Number.isInteger(value.max_select))) &&
    value.is_active === true &&
    typeof value.sort_order === "number" &&
    Number.isInteger(value.sort_order) &&
    value.modifiers.every(
      (modifier) =>
        isCanonicalModifierRow(modifier) && modifier.group_id === input.id,
    ) &&
    value.modifiers.length === input.modifiers.length &&
    returnedIds.size === expectedIds.size &&
    [...expectedIds].every((id) => returnedIds.has(id))
  );
}

function mapCanonicalModifierGroup(
  row: CanonicalModifierGroupRow,
): MenuModifierGroup {
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    name: row.name,
    selectionMode: row.selection_mode,
    minSelect: row.min_select,
    maxSelect: row.max_select,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    modifiers: row.modifiers.map((modifier) => ({
      id: modifier.id,
      groupId: modifier.group_id,
      name: modifier.name,
      priceDeltaCents: modifier.price_delta_cents,
      currency: modifier.currency,
      isAvailable: modifier.is_available,
      sortOrder: modifier.sort_order,
    })),
  };
}

function normalizedModifierErrorCode(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9]{1,10}$/i.test(code)) return code;
  }
  return "unknown";
}

export type ModifierGroupSaveFailureCategory =
  | "offline"
  | "permission"
  | "generic";

export function classifyModifierGroupSaveFailure(
  error: unknown,
): ModifierGroupSaveFailureCategory {
  if (isPermissionDeniedError(error)) return "permission";
  if (isLikelyOfflineError(error)) return "offline";
  return "generic";
}

interface SafeModifierGroupSaveError extends Error {
  code: string;
  category: ModifierGroupSaveFailureCategory;
}

/** Save one complete active group/options snapshot through its atomic RPC. */
export function useSaveModifierGroup(
  brandId: string | null,
): UseMutationResult<MenuModifierGroup, Error, ModifierGroupSaveInput> {
  const queryClient = useQueryClient();
  return useMutation<MenuModifierGroup, Error, ModifierGroupSaveInput>({
    mutationFn: async (
      input: ModifierGroupSaveInput,
    ): Promise<MenuModifierGroup> => {
      if (brandId === null) throw new Error("brand_required");
      const { data, error } = await supabase.rpc(
        "biz_save_menu_modifier_group_v1",
        {
          p_brand_id: brandId,
          p_menu_item_id: input.menuItemId,
          p_group_id: input.id,
          p_name: input.name,
          p_selection_mode: input.selectionMode,
          p_min_select: input.minSelect,
          p_max_select: input.maxSelect,
          p_sort_order: input.sortOrder,
          p_options: input.modifiers.map((modifier) => ({
            id: modifier.id,
            name: modifier.name,
            price_delta_cents: modifier.priceDeltaCents,
            sort_order: modifier.sortOrder,
          })),
        },
      );
      if (error !== null) {
        const category = classifyModifierGroupSaveFailure(error);
        const safeError = new Error(
          `modifier_group_save_${category}`,
        ) as SafeModifierGroupSaveError;
        safeError.code = normalizedModifierErrorCode(error);
        safeError.category = category;
        throw safeError;
      }
      if (!isCanonicalModifierGroupRow(data, input)) {
        throw new Error("modifier_group_response_invalid");
      }
      return mapCanonicalModifierGroup(data);
    },
    onError: (error, variables) => {
      console.error("[save_menu_modifier_group] failed", {
        brandId,
        menuItemId: variables.menuItemId,
        groupId: variables.id,
        code: normalizedModifierErrorCode(error),
      });
    },
    onSuccess: (savedGroup, variables) => {
      if (brandId !== null) {
        const authoringKey = menuModifierKeys.forItem(
          brandId,
          variables.menuItemId,
        );
        queryClient.setQueryData<MenuModifierGroup[]>(
          authoringKey,
          (current) => {
            const withoutSaved = (current ?? []).filter(
              (group) => group.id !== savedGroup.id,
            );
            return [...withoutSaved, savedGroup].sort(
              (left, right) =>
                left.sortOrder - right.sortOrder ||
                left.name.localeCompare(right.name),
            );
          },
        );
        void queryClient.invalidateQueries({
          queryKey: authoringKey,
        });
        void queryClient.invalidateQueries({
          queryKey: orderPadKeys.forBrand(brandId),
        });
        void queryClient.invalidateQueries({
          queryKey: venueOrderingQueryKeys.all,
        });
      }
    },
  });
}

export type ModifierGroupDeleteFailureCategory =
  | "in-use"
  | "permission"
  | "offline"
  | "generic";

/**
 * Issue #3571 — a delete that can NEVER succeed must not be narrated as one
 * that might.
 *
 * Deleting a group CASCADEs into `menu_modifiers`
 * (`20270305001789_issue_1789_qr_spots_menu_depth_and_ordering_settings.sql:566`),
 * but `venue_order_item_modifiers.menu_modifier_id` is ON DELETE RESTRICT
 * (`20270310001790_issue_1790_venue_order_family.sql:327`). So any group whose
 * options have ever been ordered raises SQLSTATE 23503 and can never be
 * removed — a permanent answer, not a transient one.
 */
export function isModifierGroupInUseError(raw: unknown): boolean {
  const error = normalizeSupabaseError(raw, "");
  if (error.code === "23503") return true;
  const probe = `${error.message} ${error.details ?? ""}`.toLowerCase();
  return probe.includes("violates foreign key constraint");
}

export function classifyModifierGroupDeleteFailure(
  error: unknown,
): ModifierGroupDeleteFailureCategory {
  if (isModifierGroupInUseError(error)) return "in-use";
  if (isPermissionDeniedError(error)) return "permission";
  if (isLikelyOfflineError(error)) return "offline";
  return "generic";
}

export interface SafeModifierGroupDeleteError extends Error {
  code: string;
  category: ModifierGroupDeleteFailureCategory;
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
      /*
       * Issue #3571 — this used to rethrow the raw PostgREST object and then
       * DISCARD it in `onError`, so every consumer collapsed "guests already
       * ordered this" and "you are offline" into one boolean and told the
       * operator to "try again" on a constraint that can never relax. Classify
       * once here and carry a safe, typed category — never the raw database
       * text.
       */
      if (error !== null) {
        const category = classifyModifierGroupDeleteFailure(error);
        const safeError = new Error(
          `modifier_group_delete_${category}`,
        ) as SafeModifierGroupDeleteError;
        safeError.code = normalizedModifierErrorCode(error);
        safeError.category = category;
        throw safeError;
      }
    },
    onError: (deleteRejection, variables) => {
      console.error("[delete_menu_modifier_group] failed", {
        brandId,
        menuItemId: variables.menuItemId,
        groupId: variables.groupId,
        code: normalizedModifierErrorCode(deleteRejection),
        category: (deleteRejection as SafeModifierGroupDeleteError).category,
      });
    },
    onSuccess: (_data, variables) => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: menuModifierKeys.forItem(brandId, variables.menuItemId),
        });
      }
    },
  });
}
