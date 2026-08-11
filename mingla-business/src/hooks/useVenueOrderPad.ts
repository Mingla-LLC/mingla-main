/**
 * Issue #1792 (#1767 Phase 3b) — the order pad's data layer (DESIGN D-11; SPEC
 * #1788 P-20, P-26).
 *
 * THE SAME MENU, ONE SOURCE OF TRUTH. The pad reads the venue's own `menus` /
 * `menu_items` / `menu_modifier_groups` rows — the exact rows a guest's QR menu
 * renders and the exact rows `venue-order-staff` re-reads server-side before it
 * prices anything. There is no waiter menu. A price changed in the builder is
 * changed on the pad on the next fetch, and a line the pad sends is priced from
 * the server's own read of those rows, never from what the pad had cached.
 *
 * THE PAD NEVER ADDS ANYTHING UP. `preview` is a real server round-trip through
 * the same `priceCart` the real create uses (P-20). A per-line price is rendered
 * because it is a menu FACT sitting in a column; a TOTAL is asked for, because a
 * total is a computation and computations belong to the server. Until a preview
 * lands the pad shows no total at all rather than a number it made up.
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
import { venueOrdersKeys } from "./useVenueOrders";
import type {
  OrderPadMenuItem,
  OrderPadModifierGroup,
  OrderPadSubmitLine,
} from "../components/venue/orderPad/venueOrderPad";

export interface OrderPadMenu {
  items: OrderPadMenuItem[];
  /** Modifier groups keyed by menu item id — the pad asks per item, once. */
  groupsByItemId: Record<string, OrderPadModifierGroup[]>;
}

export const orderPadKeys = {
  menu: (
    brandId: string,
    servingVenueId: string,
  ): readonly ["orderPadMenu", string, string] =>
    ["orderPadMenu", brandId, servingVenueId] as const,
  preview: (
    brandId: string,
    fingerprint: string,
  ): readonly ["orderPadPreview", string, string] =>
    ["orderPadPreview", brandId, fingerprint] as const,
};

interface MenuRow {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

interface ItemRow {
  id: string;
  menu_id: string;
  name: string;
  price_cents: number | null;
  currency: string;
  is_available: boolean;
  allows_notes: boolean;
  sort_order: number;
}

interface GroupRow {
  id: string;
  menu_item_id: string;
  name: string;
  selection_mode: "single" | "multi";
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

// Single string literals, deliberately: supabase-js infers the row shape from
// the LITERAL type of the select string, and a `+` concatenation erases it.
const PAD_MENU_COLUMNS = "id, name, sort_order, is_active";
const PAD_ITEM_COLUMNS =
  "id, menu_id, name, price_cents, currency, is_available, allows_notes, sort_order";
const PAD_GROUP_COLUMNS =
  "id, menu_item_id, name, selection_mode, min_select, max_select, is_active, sort_order";
const PAD_MODIFIER_COLUMNS =
  "id, group_id, name, price_delta_cents, currency, is_available, sort_order";

/**
 * Read the SERVING venue's menu in four bounded queries rather than one per
 * item. The per-item `useMenuModifierGroups` hook the builder uses is right for
 * a form with one item open; at a pass with sixty items on screen it is sixty
 * round-trips, and the pad has to be faster than a notepad or nobody uses it.
 */
export const fetchOrderPadMenu = async (
  brandId: string,
  servingVenueId: string,
): Promise<OrderPadMenu> => {
  const { data: menuRows, error: menuError } = await supabase
    .from("menus")
    .select(PAD_MENU_COLUMNS)
    .eq("brand_id", brandId)
    .eq("venue_id", servingVenueId)
    .order("sort_order", { ascending: true })
    .returns<MenuRow[]>();
  if (menuError !== null) throw menuError;
  const menus = (menuRows ?? []).filter((m) => m.is_active);
  if (menus.length === 0) return { items: [], groupsByItemId: {} };
  const menuNameById = new Map(menus.map((m) => [m.id, m.name]));

  const { data: itemRows, error: itemError } = await supabase
    .from("menu_items")
    .select(PAD_ITEM_COLUMNS)
    .eq("brand_id", brandId)
    .in("menu_id", menus.map((m) => m.id))
    .order("sort_order", { ascending: true })
    .returns<ItemRow[]>();
  if (itemError !== null) throw itemError;
  const items: OrderPadMenuItem[] = (itemRows ?? []).map((row) => ({
    id: row.id,
    menuId: row.menu_id,
    menuName: menuNameById.get(row.menu_id) ?? "Menu",
    name: row.name,
    priceCents: row.price_cents,
    currency: row.currency,
    isAvailable: row.is_available,
    allowsNotes: row.allows_notes === true,
    sortOrder: row.sort_order,
  }));
  if (items.length === 0) return { items, groupsByItemId: {} };

  const { data: groupRows, error: groupError } = await supabase
    .from("menu_modifier_groups")
    .select(PAD_GROUP_COLUMNS)
    .eq("brand_id", brandId)
    .in("menu_item_id", items.map((i) => i.id))
    .order("sort_order", { ascending: true })
    .returns<GroupRow[]>();
  if (groupError !== null) throw groupError;
  const groups = groupRows ?? [];

  let modifiers: ModifierRow[] = [];
  if (groups.length > 0) {
    const { data: modifierRows, error: modifierError } = await supabase
      .from("menu_modifiers")
      .select(PAD_MODIFIER_COLUMNS)
      .eq("brand_id", brandId)
      .in("group_id", groups.map((g) => g.id))
      .order("sort_order", { ascending: true })
      .returns<ModifierRow[]>();
    if (modifierError !== null) throw modifierError;
    modifiers = modifierRows ?? [];
  }

  const modifiersByGroup = new Map<string, ModifierRow[]>();
  for (const row of modifiers) {
    const bucket = modifiersByGroup.get(row.group_id);
    if (bucket === undefined) modifiersByGroup.set(row.group_id, [row]);
    else bucket.push(row);
  }

  const groupsByItemId: Record<string, OrderPadModifierGroup[]> = {};
  for (const row of groups) {
    const group: OrderPadModifierGroup = {
      id: row.id,
      menuItemId: row.menu_item_id,
      name: row.name,
      selectionMode: row.selection_mode,
      minSelect: row.min_select,
      maxSelect: row.max_select,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      modifiers: (modifiersByGroup.get(row.id) ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        priceDeltaCents: m.price_delta_cents,
        currency: m.currency,
        isAvailable: m.is_available,
        sortOrder: m.sort_order,
      })),
    };
    const bucket = groupsByItemId[row.menu_item_id];
    if (bucket === undefined) groupsByItemId[row.menu_item_id] = [group];
    else bucket.push(group);
  }

  return { items, groupsByItemId };
};

export function useOrderPadMenu(
  brandId: string | null,
  servingVenueId: string | null,
): UseQueryResult<OrderPadMenu> {
  const { isAuthReady } = useAuth();
  const enabled = isAuthReady &&
    brandId !== null && brandId.length > 0 &&
    servingVenueId !== null && servingVenueId.length > 0;
  return useQuery<OrderPadMenu>({
    queryKey: enabled
      ? orderPadKeys.menu(brandId, servingVenueId)
      : (["orderPadMenu", "disabled"] as const),
    enabled,
    // Short, because a menu changes mid-service: the kitchen 86's a dish and
    // the pad must stop offering it. The server refuses it either way
    // (`item_not_orderable`), but a waiter should not have to be told twice.
    staleTime: 20_000,
    queryFn: () =>
      enabled
        ? fetchOrderPadMenu(brandId, servingVenueId)
        : Promise.resolve({ items: [], groupsByItemId: {} }),
  });
}

// ---------------------------------------------------------------------------
// The three staff actions the pad drives. All through `venue-order-staff`, which
// verifies the Bearer in-code and applies the brand-membership floor before it
// touches anything.
// ---------------------------------------------------------------------------

async function invokeStaff(
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("venue-order-staff", {
    body,
  });
  if (error !== null) throw error as unknown as Error;
  return (data ?? {}) as Record<string, unknown>;
}

export interface OrderPadPreviewVars {
  spotCode: string | null;
  venueId: string | null;
  lines: OrderPadSubmitLine[];
}

export interface OrderPadPreview {
  currency: string;
  subtotalCents: number;
  serviceChargeBps: number;
  serviceChargeCents: number;
  /** D-9 — the venue's OWN label. Never one this surface invents. */
  serviceChargeLabel: string;
  totalCents: number;
  spotLabel: string | null;
  venueName: string | null;
  staffTabsEnabled: boolean;
}

/**
 * THE RUNNING TOTAL, from the server.
 *
 * A mutation rather than a query on purpose: it is fired by a gesture (an item
 * added, a quantity changed), it must never run on a stale-time schedule behind
 * the waiter's back, and a failed one must leave the previous number visible
 * rather than replace it with a guess.
 */
export function usePreviewStaffOrder(): UseMutationResult<
  OrderPadPreview,
  Error,
  OrderPadPreviewVars
> {
  return useMutation<OrderPadPreview, Error, OrderPadPreviewVars>({
    mutationFn: async (vars: OrderPadPreviewVars): Promise<OrderPadPreview> => {
      const data = await invokeStaff({
        action: "create",
        mode: "preview",
        spotCode: vars.spotCode,
        venueId: vars.venueId,
        lines: vars.lines,
      });
      return {
        currency: String(data.currency ?? ""),
        subtotalCents: Number(data.subtotalCents ?? 0),
        serviceChargeBps: Number(data.serviceChargeBps ?? 0),
        serviceChargeCents: Number(data.serviceChargeCents ?? 0),
        serviceChargeLabel: String(data.serviceChargeLabel ?? "Service charge"),
        totalCents: Number(data.totalCents ?? 0),
        spotLabel: typeof data.spotLabel === "string" ? data.spotLabel : null,
        venueName: typeof data.venueName === "string" ? data.venueName : null,
        staffTabsEnabled: data.staffTabsEnabled === true,
      };
    },
    onError: () => undefined,
  });
}

export interface StaffOrderCreateVars {
  spotCode: string | null;
  venueId: string | null;
  /** Continue a sitting (a waiter's second round); null mints a new one. */
  sessionId: string | null;
  buyerName: string | null;
  lines: OrderPadSubmitLine[];
  /**
   * ONE key per gesture, minted by the pad. A double-tap at the pass or a retry
   * over a dropped response returns the ticket that already exists rather than
   * sending the kitchen a second one.
   */
  idempotencyKey: string;
}

export interface StaffOrderCreated {
  orderId: string;
  sessionId: string;
  pickupCode: string | null;
  currency: string;
  totalCents: number;
  /** True when the server handed back an order this gesture already created. */
  replayed: boolean;
}

/**
 * SEND TO KITCHEN.
 *
 * The ticket is written `source='staff'` with `taken_by_user_id` taken from the
 * verified JWT server-side. It lands in the SAME queue, on the SAME card, in the
 * SAME view as a scanned order — nothing about it tells the kitchen how it
 * arrived, which is D-11's requirement and the reason the queue's card component
 * has no `source` branch anywhere in it.
 */
export function useCreateStaffOrder(
  brandId: string | null,
): UseMutationResult<StaffOrderCreated, Error, StaffOrderCreateVars> {
  const queryClient = useQueryClient();
  return useMutation<StaffOrderCreated, Error, StaffOrderCreateVars>({
    mutationFn: async (vars: StaffOrderCreateVars): Promise<StaffOrderCreated> => {
      const data = await invokeStaff({
        action: "create",
        spotCode: vars.spotCode,
        venueId: vars.venueId,
        sessionId: vars.sessionId,
        buyer: vars.buyerName === null ? {} : { name: vars.buyerName },
        lines: vars.lines,
        idempotencyKey: vars.idempotencyKey,
      });
      const orderId = typeof data.orderId === "string" ? data.orderId : "";
      if (orderId.length === 0) throw new Error("order_total_invalid");
      return {
        orderId,
        sessionId: String(data.sessionId ?? ""),
        pickupCode: typeof data.pickupCode === "string" ? data.pickupCode : null,
        currency: String(data.currency ?? ""),
        totalCents: Number(data.totalCents ?? 0),
        replayed: data.replayed === true,
      };
    },
    onError: () => undefined,
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueOrdersKeys.list(brandId),
        });
      }
    },
  });
}

export interface StaffOrderSettleVars {
  orderId: string;
  /** Only the two SENDABLE methods exist here. `charge_to_room` is not built. */
  method: "bill_to_phone" | "venue_collected";
  buyer?: { name: string; email: string; phone: string };
}

export interface StaffOrderSettled {
  kind: string;
  orderId: string;
  /** Present on `bill_to_phone` — what the guest opens to pay. */
  authorizationUrl: string | null;
  buyerStatusToken: string | null;
  totalCents: number | null;
  currency: string | null;
}

/**
 * SETTLE ONE ORDER.
 *
 * `venue_collected` calls no provider, takes no fee, and produces no payout row
 * — the row was written in that shape at create and `settle` only records that
 * the guest has paid the venue. `venue_orders_money_path_shape` makes any other
 * shape literally unwritable, so this is a structural promise rather than a
 * careful function.
 *
 * `bill_to_phone` re-prices the SNAPSHOTTED lines onto the Mingla rail and
 * returns the payment the guest completes.
 */
export function useSettleStaffOrder(
  brandId: string | null,
): UseMutationResult<StaffOrderSettled, Error, StaffOrderSettleVars> {
  const queryClient = useQueryClient();
  return useMutation<StaffOrderSettled, Error, StaffOrderSettleVars>({
    mutationFn: async (vars: StaffOrderSettleVars): Promise<StaffOrderSettled> => {
      const data = await invokeStaff({
        action: "settle",
        orderId: vars.orderId,
        method: vars.method,
        buyer: vars.buyer ?? {},
      });
      return {
        kind: String(data.kind ?? ""),
        orderId: vars.orderId,
        authorizationUrl: typeof data.authorizationUrl === "string"
          ? data.authorizationUrl
          : null,
        buyerStatusToken: typeof data.buyerStatusToken === "string"
          ? data.buyerStatusToken
          : null,
        totalCents: data.totalCents === undefined ? null : Number(data.totalCents),
        currency: typeof data.currency === "string" ? data.currency : null,
      };
    },
    onError: () => undefined,
    onSuccess: () => {
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: venueOrdersKeys.list(brandId),
        });
      }
    },
  });
}
