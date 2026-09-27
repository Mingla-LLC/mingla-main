import type { Menu } from "../services/menusService";
import {
  isLikelyOfflineError,
  isPermissionDeniedError,
  normalizeSupabaseError,
} from "../utils/supabaseErrorMessage";

export type MenuItemReorderDirection = "up" | "down";

export interface MenuItemReorderExpectedItem {
  id: string;
  sortOrder: number;
}

export interface MenuItemReorderIntent {
  operationId: string;
  brandId: string;
  venueId: string;
  menuId: string;
  movedItemId: string;
  anchorItemId: string;
  direction: MenuItemReorderDirection;
  expectedItems: MenuItemReorderExpectedItem[];
  orderedItemIds: string[];
}

export interface CanonicalMenuItemOrder {
  brandId: string;
  venueId: string;
  menuId: string;
  items: MenuItemReorderExpectedItem[];
}

export type MenuItemReorderFailureCategory =
  | "permission"
  | "conflict"
  | "uncertain"
  | "generic";

export class MenuItemReorderError extends Error {
  category: MenuItemReorderFailureCategory;
  code: string;
  retryable: boolean;
  resolvedAsSuccess: boolean;
  authoritativeMenus: readonly Menu[] | undefined;

  constructor(
    category: MenuItemReorderFailureCategory,
    code: string,
    retryable = false,
  ) {
    super(`menu_item_reorder_${category}`);
    this.name = "MenuItemReorderError";
    this.category = category;
    this.code = code;
    this.retryable = retryable;
    this.resolvedAsSuccess = false;
    this.authoritativeMenus = undefined;
  }

  markConfirmationFailed(retryable: boolean): void {
    this.message = "menu_item_reorder_uncertain";
    this.category = "uncertain";
    this.code = "confirmation_failed";
    this.retryable = retryable;
    this.resolvedAsSuccess = false;
    this.authoritativeMenus = undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return rightIds.size === right.length && left.every((id) => rightIds.has(id));
}

function menuForIntent(
  menus: readonly Menu[] | undefined,
  intent: MenuItemReorderIntent,
): Menu | null {
  return menus?.find(
    (menu) =>
      menu.id === intent.menuId &&
      menu.brandId === intent.brandId &&
      menu.venueId === intent.venueId,
  ) ?? null;
}

export function createAdjacentMenuItemReorderIntent(input: {
  operationId: string;
  brandId: string;
  venueId: string;
  menu: Menu;
  movedIndex: number;
  direction: MenuItemReorderDirection;
}): MenuItemReorderIntent | null {
  const delta = input.direction === "up" ? -1 : 1;
  const anchorIndex = input.movedIndex + delta;
  const moved = input.menu.items[input.movedIndex];
  const anchor = input.menu.items[anchorIndex];
  if (
    moved === undefined ||
    anchor === undefined ||
    input.menu.brandId !== input.brandId ||
    input.menu.venueId !== input.venueId
  ) {
    return null;
  }

  const orderedItemIds = input.menu.items.map((item) => item.id);
  [orderedItemIds[input.movedIndex], orderedItemIds[anchorIndex]] = [
    orderedItemIds[anchorIndex] as string,
    orderedItemIds[input.movedIndex] as string,
  ];

  return {
    operationId: input.operationId,
    brandId: input.brandId,
    venueId: input.venueId,
    menuId: input.menu.id,
    movedItemId: moved.id,
    anchorItemId: anchor.id,
    direction: input.direction,
    expectedItems: input.menu.items.map((item) => ({
      id: item.id,
      sortOrder: item.sortOrder,
    })),
    orderedItemIds,
  };
}

export function applyOptimisticMenuItemOrder(
  menus: readonly Menu[] | undefined,
  intent: MenuItemReorderIntent,
): Menu[] | undefined {
  if (menus === undefined) return undefined;
  const target = menuForIntent(menus, intent);
  if (
    target === null ||
    !sameSet(
      target.items.map((item) => item.id),
      intent.orderedItemIds,
    )
  ) {
    return menus.slice();
  }
  const itemById = new Map(target.items.map((item) => [item.id, item]));
  return menus.map((menu) =>
    menu.id !== intent.menuId
      ? menu
      : {
          ...menu,
          items: intent.orderedItemIds.map((id, sortOrder) => ({
            ...(itemById.get(id) as (typeof target.items)[number]),
            sortOrder,
          })),
        },
  );
}

export function parseCanonicalMenuItemOrder(
  value: unknown,
  intent: MenuItemReorderIntent,
): CanonicalMenuItemOrder | null {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !==
      "brand_id,items,menu_id,venue_id" ||
    !Array.isArray(value.items)
  ) {
    return null;
  }
  if (
    value.brand_id !== intent.brandId ||
    value.venue_id !== intent.venueId ||
    value.menu_id !== intent.menuId
  ) {
    return null;
  }

  const items: MenuItemReorderExpectedItem[] = [];
  for (const [index, row] of value.items.entries()) {
    if (
      !isRecord(row) ||
      Object.keys(row).sort().join(",") !== "id,sort_order" ||
      typeof row.id !== "string" ||
      typeof row.sort_order !== "number" ||
      !Number.isInteger(row.sort_order) ||
      row.sort_order !== index
    ) {
      return null;
    }
    items.push({ id: row.id, sortOrder: row.sort_order });
  }
  const returnedIds = items.map((item) => item.id);
  if (
    new Set(returnedIds).size !== returnedIds.length ||
    !sameSet(returnedIds, intent.orderedItemIds)
  ) {
    return null;
  }
  return {
    brandId: intent.brandId,
    venueId: intent.venueId,
    menuId: intent.menuId,
    items,
  };
}

export function installCanonicalMenuItemOrder(
  menus: readonly Menu[] | undefined,
  canonical: CanonicalMenuItemOrder,
): Menu[] | undefined {
  if (menus === undefined) return undefined;
  const menu = menus.find(
    (candidate) =>
      candidate.id === canonical.menuId &&
      candidate.brandId === canonical.brandId &&
      candidate.venueId === canonical.venueId,
  );
  if (
    menu === undefined ||
    !sameSet(
      menu.items.map((item) => item.id),
      canonical.items.map((item) => item.id),
    )
  ) {
    return menus.slice();
  }
  const itemById = new Map(menu.items.map((item) => [item.id, item]));
  return menus.map((candidate) =>
    candidate.id !== canonical.menuId
      ? candidate
      : {
          ...candidate,
          items: canonical.items.map((item) => ({
            ...(itemById.get(item.id) as (typeof menu.items)[number]),
            sortOrder: item.sortOrder,
          })),
        },
  );
}

export function menuItemRelationshipIsApplied(
  menus: readonly Menu[] | undefined,
  intent: MenuItemReorderIntent,
): boolean {
  const menu = menuForIntent(menus, intent);
  if (menu === null) return false;
  const movedIndex = menu.items.findIndex((item) => item.id === intent.movedItemId);
  const anchorIndex = menu.items.findIndex((item) => item.id === intent.anchorItemId);
  if (movedIndex < 0 || anchorIndex < 0) return false;
  return intent.direction === "up"
    ? movedIndex + 1 === anchorIndex
    : anchorIndex + 1 === movedIndex;
}

export function canRetryMenuItemReorder(
  menus: readonly Menu[] | undefined,
  intent: MenuItemReorderIntent,
): boolean {
  const menu = menuForIntent(menus, intent);
  if (menu === null) return false;
  const ids = new Set(menu.items.map((item) => item.id));
  return ids.has(intent.movedItemId) && ids.has(intent.anchorItemId);
}

export function rebuildMenuItemReorderIntent(
  menus: readonly Menu[] | undefined,
  prior: MenuItemReorderIntent,
  operationId: string,
): MenuItemReorderIntent | null {
  const menu = menuForIntent(menus, prior);
  if (menu === null) return null;
  const moved = menu.items.find((item) => item.id === prior.movedItemId);
  const anchor = menu.items.find((item) => item.id === prior.anchorItemId);
  if (moved === undefined || anchor === undefined) return null;

  const ordered = menu.items.filter((item) => item.id !== moved.id);
  const anchorIndex = ordered.findIndex((item) => item.id === anchor.id);
  const insertAt = prior.direction === "up" ? anchorIndex : anchorIndex + 1;
  ordered.splice(insertAt, 0, moved);

  return {
    ...prior,
    operationId,
    expectedItems: menu.items.map((item) => ({
      id: item.id,
      sortOrder: item.sortOrder,
    })),
    orderedItemIds: ordered.map((item) => item.id),
  };
}

export function classifyMenuItemReorderError(
  error: unknown,
): MenuItemReorderError {
  if (error instanceof MenuItemReorderError) return error;
  const normalized = normalizeSupabaseError(error, "menu_item_reorder_failed");
  const code = normalized.code ?? "unknown";
  if (isPermissionDeniedError(normalized)) {
    return new MenuItemReorderError("permission", code);
  }
  if (code === "40001") {
    return new MenuItemReorderError("conflict", code);
  }
  if (isLikelyOfflineError(normalized)) {
    return new MenuItemReorderError("uncertain", code);
  }
  return new MenuItemReorderError("generic", code);
}
