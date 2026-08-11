// ===========================================================================
// Issue #1790 (SPEC #1788 Phase 2) — the DB-facing half of the venue-order rail,
// shared by `venue-order-create` (guest) and `venue-order-staff` (waiter pad).
// Kept out of both entry points so neither forks the gate order, the pricing
// call, or the row shape.
//
// Everything here reads through the SERVICE client. The guest never reads the
// order family directly: RLS carries no anon policy at all, by design.
// ===========================================================================

// deno-lint-ignore-file no-explicit-any
import {
  type MenuItemRow,
  type MenuModifierGroupRow,
  type MenuModifierRow,
  menuServiceWindowContains,
  type PricedLine,
  type VenueOrderErrorCode,
} from "./venueOrderPricing.ts";

type ServiceClient = any;

export interface OrderContext {
  spotId: string | null;
  spotLabel: string | null;
  venueTableId: string | null;
  stayUnitId: string | null;
  zone: string | null;
  /** The venue whose KITCHEN serves this order (D-3b: Room 204 -> the Brasserie). */
  servingVenueId: string;
  servingMenuId: string | null;
  brandId: string;
  venueName: string;
  settings: OrderingSettings;
}

export interface OrderingSettings {
  ordering_enabled: boolean;
  paused_at: string | null;
  service_charge_bps: number;
  service_charge_label: string;
  tips_enabled: boolean;
  counter_pickup_enabled: boolean;
  staff_tabs_enabled: boolean;
}

export type ContextFailure = { code: VenueOrderErrorCode; venue?: string };

/**
 * P-22 gates 1-3, fail-closed and in order.
 *
 * NOTE (deviation, stated): P-22 gate 1 names `pg_public_qr_spot_resolve`. That
 * RPC is the GUEST-FACING resolver (P-9) and deliberately returns slugs and no
 * ids — it cannot give order-create the brand_id / serving_venue_id it must
 * write onto the row. This is the same resolution performed by the service
 * client, applying the identical gates plus the ids, and it fails closed on
 * every one of them.
 *
 * ORCHESTRATOR RULING (P-9 vs P-22 gate 3), binding: `venue_ordering_settings`
 * is read DIRECTLY here, never via the Phase-1 resolver. That resolver is
 * implemented literally and fail-closed — it returns NULL for a venue whose
 * ordering is disabled — so `ordering_enabled: false` can never come back
 * through it, and sourcing the flag from it would make P-22's `ordering_paused`
 * error UNREACHABLE. Reading the table itself is what lets this function tell
 * "no such spot" (`spot_unknown`) apart from "the spot is real, the venue has
 * paused" (`ordering_paused`) and return the right copy for each. Reads stay
 * honest; the fail-closed boundary sits HERE, at the money.
 */
export async function resolveOrderContext(
  supabase: ServiceClient,
  input: { spotCode: string | null; venueId: string | null },
): Promise<{ ok: true; context: OrderContext } | { ok: false; failure: ContextFailure }> {
  let spotId: string | null = null;
  let spotLabel: string | null = null;
  let venueTableId: string | null = null;
  let stayUnitId: string | null = null;
  let zone: string | null = null;
  let servingVenueId: string;
  let servingMenuId: string | null = null;

  if (input.spotCode !== null) {
    const { data: spot, error } = await supabase
      .from("qr_spots")
      .select(
        "id, brand_id, venue_id, label, zone, venue_table_id, stay_unit_id, serving_venue_id, serving_menu_id, is_active",
      )
      .eq("code", input.spotCode)
      .maybeSingle();
    if (error) throw new Error(`qr_spot_lookup_failed: ${error.message}`);
    // Unknown OR inactive are the SAME answer to a guest: a code that is not
    // active. Distinguishing them would leak which printed codes exist.
    if (!spot || spot.is_active !== true) {
      return { ok: false, failure: { code: "spot_unknown" } };
    }
    spotId = String(spot.id);
    spotLabel = spot.label === null ? null : String(spot.label);
    venueTableId = spot.venue_table_id === null ? null : String(spot.venue_table_id);
    stayUnitId = spot.stay_unit_id === null ? null : String(spot.stay_unit_id);
    zone = spot.zone === null ? null : String(spot.zone);
    servingVenueId = String(spot.serving_venue_id);
    servingMenuId = spot.serving_menu_id === null ? null : String(spot.serving_menu_id);
  } else if (input.venueId !== null) {
    servingVenueId = input.venueId;
  } else {
    return { ok: false, failure: { code: "spot_unknown" } };
  }

  // Gate 2 — the SERVING venue must be claim_status='verified'.
  const { data: venue, error: venueError } = await supabase
    .from("venue_listings")
    .select("id, brand_id, name, claim_status")
    .eq("id", servingVenueId)
    .maybeSingle();
  if (venueError) throw new Error(`venue_lookup_failed: ${venueError.message}`);
  const venueName = typeof venue?.name === "string" && venue.name.trim()
    ? venue.name.trim()
    : "This venue";
  if (!venue || venue.claim_status !== "verified") {
    return { ok: false, failure: { code: "venue_not_orderable", venue: venueName } };
  }

  // Gate 3 — ordering_enabled AND not paused. Default is OFF: no settings row
  // means no ordering, which is the correct answer while this phase is dark.
  //
  // Issue #1848 — this gate answers `ordering_disabled`, NOT the gate-2 code.
  // The two failures are one line apart and used to share `venue_not_orderable`,
  // so a venue that had passed gate 2 a microsecond earlier — verified, claim
  // approved, badge and all — was handed the sentence for an unverified venue.
  // Gate 2 is the ONLY owner of that code from here on.
  const { data: settingsRow, error: settingsError } = await supabase
    .from("venue_ordering_settings")
    .select(
      "ordering_enabled, paused_at, service_charge_bps, service_charge_label, tips_enabled, counter_pickup_enabled, staff_tabs_enabled",
    )
    .eq("venue_id", servingVenueId)
    .maybeSingle();
  if (settingsError) {
    throw new Error(`ordering_settings_lookup_failed: ${settingsError.message}`);
  }
  if (!settingsRow || settingsRow.ordering_enabled !== true) {
    return { ok: false, failure: { code: "ordering_disabled", venue: venueName } };
  }
  if (settingsRow.paused_at !== null) {
    return { ok: false, failure: { code: "ordering_paused", venue: venueName } };
  }

  return {
    ok: true,
    context: {
      spotId,
      spotLabel,
      venueTableId,
      stayUnitId,
      zone,
      servingVenueId,
      servingMenuId,
      brandId: String(venue.brand_id),
      venueName,
      settings: settingsRow as OrderingSettings,
    },
  };
}

export interface MenuSnapshot {
  itemsById: Map<string, MenuItemRow>;
  groupsByItemId: Map<string, MenuModifierGroupRow[]>;
  modifiersById: Map<string, MenuModifierRow>;
  orderableItemIds: Set<string>;
}

/**
 * P-13 — orderability is DERIVED at read time from seven inputs. There is no
 * `is_orderable` column, because a stored copy of a seven-input derivation is a
 * staleness bug with a schema. Four of the seven (venue verified, ordering
 * enabled, not paused, price present) are checked by the caller and by
 * `priceCart`; the menu-level three are resolved here, in VENUE-LOCAL time.
 */
export async function loadMenuSnapshot(
  supabase: ServiceClient,
  input: {
    brandId: string;
    servingVenueId: string;
    servingMenuId: string | null;
    menuItemIds: string[];
  },
): Promise<MenuSnapshot> {
  const itemsById = new Map<string, MenuItemRow>();
  const groupsByItemId = new Map<string, MenuModifierGroupRow[]>();
  const modifiersById = new Map<string, MenuModifierRow>();
  const orderableItemIds = new Set<string>();
  if (input.menuItemIds.length === 0) {
    return { itemsById, groupsByItemId, modifiersById, orderableItemIds };
  }

  const { data: items, error: itemsError } = await supabase
    .from("menu_items")
    .select("id, menu_id, brand_id, name, price_cents, currency, is_available")
    .in("id", input.menuItemIds);
  if (itemsError) throw new Error(`menu_items_lookup_failed: ${itemsError.message}`);

  const menuIds = new Set<string>();
  for (const row of (items ?? []) as MenuItemRow[]) {
    // A cart may never reach across brands, and a spot pinned to ONE menu may
    // never order off another.
    if (String(row.brand_id) !== input.brandId) continue;
    if (input.servingMenuId !== null && String(row.menu_id) !== input.servingMenuId) {
      continue;
    }
    itemsById.set(String(row.id), row);
    menuIds.add(String(row.menu_id));
  }

  const { data: menus, error: menusError } = await supabase
    .from("menus")
    .select(
      "id, venue_id, is_active, service_window_start, service_window_end, service_days",
    )
    .in("id", [...menuIds]);
  if (menusError) throw new Error(`menus_lookup_failed: ${menusError.message}`);

  const localNow = await venueLocalNow(supabase, input.brandId, input.servingVenueId);
  const openMenuIds = new Set<string>();
  for (const menu of (menus ?? []) as Array<Record<string, unknown>>) {
    if (menu.is_active !== true) continue;
    // The menu must belong to the SERVING venue. A NULL venue_id is a
    // pre-#1365 transitional row; it is not orderable.
    if (String(menu.venue_id ?? "") !== input.servingVenueId) continue;
    const inWindow = menuServiceWindowContains({
      start: menu.service_window_start === null
        ? null
        : String(menu.service_window_start),
      end: menu.service_window_end === null ? null : String(menu.service_window_end),
      days: Array.isArray(menu.service_days)
        ? (menu.service_days as number[]).map(Number)
        : null,
    }, localNow);
    if (inWindow) openMenuIds.add(String(menu.id));
  }
  for (const [id, item] of itemsById) {
    if (openMenuIds.has(String(item.menu_id)) && item.is_available === true) {
      orderableItemIds.add(id);
    }
  }

  const { data: groups, error: groupsError } = await supabase
    .from("menu_modifier_groups")
    .select("id, menu_item_id, name, selection_mode, min_select, max_select, is_active")
    .in("menu_item_id", [...itemsById.keys()]);
  if (groupsError) {
    throw new Error(`menu_modifier_groups_lookup_failed: ${groupsError.message}`);
  }
  const groupIds: string[] = [];
  for (const group of (groups ?? []) as MenuModifierGroupRow[]) {
    const key = String(group.menu_item_id);
    const bucket = groupsByItemId.get(key) ?? [];
    bucket.push(group);
    groupsByItemId.set(key, bucket);
    groupIds.push(String(group.id));
  }

  if (groupIds.length > 0) {
    const { data: modifiers, error: modifiersError } = await supabase
      .from("menu_modifiers")
      .select("id, group_id, name, price_delta_cents, currency, is_available")
      .in("group_id", groupIds);
    if (modifiersError) {
      throw new Error(`menu_modifiers_lookup_failed: ${modifiersError.message}`);
    }
    for (const modifier of (modifiers ?? []) as MenuModifierRow[]) {
      modifiersById.set(String(modifier.id), modifier);
    }
  }

  return { itemsById, groupsByItemId, modifiersById, orderableItemIds };
}

/** The venue's OWN clock, via the shipped 3-step ladder. Never the server's. */
export async function venueLocalNow(
  supabase: ServiceClient,
  brandId: string,
  venueId: string,
): Promise<{ isoDayOfWeek: number; minutesSinceMidnight: number }> {
  const { data, error } = await supabase.rpc("pg_venue_local_now", {
    p_brand_id: brandId,
    p_venue_id: venueId,
  });
  if (error || !data) {
    // Fail OPEN on the clock only: a venue whose timezone cannot be resolved
    // still takes orders, and the 'utc' rung of the ladder is the documented
    // last resort. A closed menu is a lost sale, not a money risk.
    const now = new Date();
    return {
      isoDayOfWeek: now.getUTCDay() === 0 ? 7 : now.getUTCDay(),
      minutesSinceMidnight: now.getUTCHours() * 60 + now.getUTCMinutes(),
    };
  }
  const row = data as Record<string, unknown>;
  return {
    isoDayOfWeek: Number(row.iso_dow),
    minutesSinceMidnight: Number(row.minutes),
  };
}

/**
 * OQ-5 — 10 orders per spot per minute.
 *
 * Exceeding the limit returns a SOFT, RETRYABLE message. A failure of the
 * LIMITER ITSELF fails OPEN with a structured log: a blocked legitimate order at
 * a busy table is worse than an extra one.
 */
export async function checkOrderRateLimit(
  supabase: ServiceClient,
  scopeKey: string,
  limit = 10,
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("pg_venue_order_rate_limit_hit", {
      p_scope_key: scopeKey,
      p_limit: limit,
    });
    if (error) throw new Error(error.message);
    return (data as { allowed?: boolean } | null)?.allowed !== false;
  } catch (err) {
    console.warn(JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      message: "venue_order_rate_limiter_failed_open",
      fn: "venue-order-create",
      scopeKey,
      limit,
      err: err instanceof Error ? err.message : String(err),
    }));
    return true;
  }
}

/**
 * #1819 H-2 — the ONLY way to look up a replayable order.
 *
 * `idempotency_key` is CLIENT-SUPPLIED and therefore not a global namespace.
 * Matching on it alone let one brand's key collide with another's and handed
 * the caller back the OTHER brand's order id, total and payment status. The
 * unique index is (brand_id, venue_id, idempotency_key) and every read must
 * carry the same three, which is why this is a shared helper rather than an
 * inline query each caller writes for itself.
 */
export async function findReplayableVenueOrder(
  supabase: ServiceClient,
  input: { brandId: string; venueId: string; idempotencyKey: string },
): Promise<
  | {
    id: string;
    total_cents: number;
    currency: string;
    payment_status: string;
    /** Issue #1792 — a replayed staff round must resume the SAME sitting. */
    session_id: string;
  }
  | null
> {
  const { data, error } = await supabase
    .from("venue_orders")
    .select("id, total_cents, currency, payment_status, session_id")
    .eq("brand_id", input.brandId)
    .eq("venue_id", input.venueId)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (error) {
    throw new Error(`venue_order_replay_lookup_failed: ${error.message}`);
  }
  if (!data || typeof (data as Record<string, unknown>).id !== "string") {
    return null;
  }
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    total_cents: Number(row.total_cents),
    currency: String(row.currency),
    payment_status: String(row.payment_status),
    session_id: String(row.session_id),
  };
}

/** Write the order + its lines + their modifier snapshots. */
export async function insertVenueOrderRow(
  supabase: ServiceClient,
  row: Record<string, unknown>,
  lines: PricedLine[],
): Promise<string> {
  const { data, error } = await supabase
    .from("venue_orders")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`venue_order_insert_failed: ${error?.message ?? "no row"}`);
  }
  const orderId = String((data as Record<string, unknown>).id);

  if (lines.length > 0) {
    const { data: itemRows, error: itemsError } = await supabase
      .from("venue_order_items")
      .insert(lines.map((line) => ({
        venue_order_id: orderId,
        menu_item_id: line.menuItemId,
        line_no: line.lineNo,
        item_name_at_order: line.itemNameAtOrder,
        unit_price_cents: line.unitPriceCents,
        currency: line.currency,
        quantity: line.quantity,
        modifiers_total_cents: line.modifiersTotalCents,
        line_total_cents: line.lineTotalCents,
        notes: line.notes,
        // OQ-3: tax_code is a SEAM. Deliberately left NULL — no F&B Stripe Tax
        // code is chosen by this phase, and none may be copied from memory.
      })))
      .select("id, line_no");
    if (itemsError) {
      throw new Error(`venue_order_items_insert_failed: ${itemsError.message}`);
    }
    const lineNoToId = new Map<number, string>();
    for (const row of (itemRows ?? []) as Array<Record<string, unknown>>) {
      lineNoToId.set(Number(row.line_no), String(row.id));
    }
    const modifierRows = lines.flatMap((line) =>
      line.modifiers.map((modifier) => ({
        venue_order_item_id: lineNoToId.get(line.lineNo),
        menu_modifier_id: modifier.menuModifierId,
        group_name_at_order: modifier.groupNameAtOrder,
        modifier_name_at_order: modifier.modifierNameAtOrder,
        price_delta_cents: modifier.priceDeltaCents,
        currency: modifier.currency,
      }))
    ).filter((row) => row.venue_order_item_id !== undefined);
    if (modifierRows.length > 0) {
      const { error: modifiersError } = await supabase
        .from("venue_order_item_modifiers")
        .insert(modifierRows);
      if (modifiersError) {
        throw new Error(
          `venue_order_item_modifiers_insert_failed: ${modifiersError.message}`,
        );
      }
    }
  }

  await supabase
    .from("venue_order_sessions")
    .update({ last_order_at: new Date().toISOString() })
    .eq("id", row.session_id as string);

  return orderId;
}

export async function markVenueOrderFailed(
  supabase: ServiceClient,
  orderId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from("venue_orders")
    .update({
      payment_status: "failed",
      failed_at: new Date().toISOString(),
      metadata: await mergedVenueOrderMetadata(supabase, orderId, {
        failure_reason: reason.slice(0, 500),
      }),
    })
    .eq("id", orderId)
    .eq("payment_status", "pending");
}

/**
 * Issue #1792 — `metadata` is a WHOLE-COLUMN write through PostgREST.
 *
 * `update({ metadata: { … } })` REPLACES the jsonb object; it does not merge.
 * That is not a style point on this table: `metadata.tab_settlement` is read by
 * `pg_venue_order_finalize_payment` (it is what closes a tab and settles its
 * children), by `biz_venue_tab_close`'s own mingla-order guard, and by Phase 6's
 * revenue exclusion. A single forgetful whole-column write therefore strands a
 * tab at `settling` forever AND makes the tab count twice.
 *
 * So no caller in this codebase composes a metadata object by hand any more:
 * they compose a PATCH and this reads the current value to merge it. The
 * database carries the same promise independently
 * (`trg_venue_orders_settlement_marker_permanent`, 20270318001792) — two owners,
 * because one of them is a convention and conventions are what erode.
 *
 * Fails toward keeping the patch: an unreadable row yields the patch alone,
 * which is exactly today's behaviour, never worse.
 */
export async function mergedVenueOrderMetadata(
  supabase: ServiceClient,
  orderId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("venue_orders")
    .select("metadata")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return { ...patch };
  const current = (data as Record<string, unknown>).metadata;
  const base = current !== null && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
  return { ...base, ...patch };
}

/**
 * Issue #1792 (D-11 / D-2 AMENDED) — may this sitting take another round?
 *
 * A staff `create` accepts a `sessionId` so a waiter's second round joins the
 * first, and until now it was trusted verbatim. Two things follow from that,
 * both real:
 *
 *  1. TENANCY. A session id from another brand would have been stamped onto the
 *     order. The brand<->venue trigger only checks that the ORDER's own brand
 *     owns its venue, so nothing downstream would have noticed — the round would
 *     simply have joined a stranger's sitting, and their tab total with it.
 *  2. A CLOSED TAB IS CLOSED. Adding a round to a settled tab produces an
 *     unbilled `venue_collected` order on a session nobody will ever close
 *     again: food goes out, no one pays for it.
 *
 * `settling` is refused too — the bill is already out on the guest's phone, and
 * a round added after it was totalled is a round the guest was never shown.
 */
export async function assertSessionAcceptsRound(
  supabase: ServiceClient,
  input: { sessionId: string; brandId: string; venueId: string },
): Promise<{ ok: true } | { ok: false; code: VenueOrderErrorCode }> {
  const { data, error } = await supabase
    .from("venue_order_sessions")
    .select("id, brand_id, venue_id, tab_state")
    .eq("id", input.sessionId)
    .maybeSingle();
  if (error) {
    throw new Error(`venue_order_session_lookup_failed: ${error.message}`);
  }
  // Unknown and foreign are the SAME answer, for the same reason an unknown
  // spot code is: distinguishing them tells a caller which ids exist.
  if (
    !data ||
    String((data as Record<string, unknown>).brand_id) !== input.brandId ||
    String((data as Record<string, unknown>).venue_id) !== input.venueId
  ) {
    return { ok: false, code: "session_not_addable" };
  }
  const tabState = String((data as Record<string, unknown>).tab_state ?? "none");
  if (tabState !== "none" && tabState !== "open") {
    return { ok: false, code: "session_not_addable" };
  }
  return { ok: true };
}
