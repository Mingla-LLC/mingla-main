// #4490 spec 08 O1 — venue-till: the Till. One server-priced check per sale,
// paid through one payment sheet. O1 takes cash and the venue's own card
// machine; tap and scan to pay are O2 (their actions are not here yet).
//
// POST { action, venueId, ... } → { kind: "success", data } | { code }
//   catalog   {}                                            → menu, spots, settings
//   open      { label?, spotId?, serverUserId?, idempotencyKey }
//   add_menu  { saleId, lines:[{menuItemId, quantity, modifierIds, notes}],
//               send, idempotencyKey, expectedVersion? }
//   add_offer { saleId, offeringId, windowId?, lines:[{priceOptionId, guests}],
//               guestListEntryId?, idempotencyKey, expectedVersion? }
//   add_balance { saleId, groupId, amountMinor, idempotencyKey, expectedVersion? }
//   void      { saleId, lineId? | orderItemId?, reason, restock, expectedVersion }
//   send      { saleId }
//   relabel   { saleId, spotId?, label?, expectedVersion }
//   set_server { saleId, serverUserId, expectedVersion }
//   quote     { saleId }                                    → sale (+ cardTotalMinor: null in O1)
//   pay_cash  { saleId, amountMinor, tipMinor, cashGivenMinor, clientRequestId, expectedVersion }
//   pay_own_machine { saleId, amountMinor, tipMinor, clientRequestId, expectedVersion }
//   refund    { paymentId, amountMinor, tipMinor, reason, restock, clientRequestId }
//   checks    {}                                            → { open, paid }
//   sale      { saleId }                                    → sale
//   receipt   { paymentId, phone?, phoneCountryIso?, email? } → { queued, sendsLeft }
//   receipt_view { paymentId, token }   (ANONYMOUS)         → { receipt }
//
// verify_jwt = false (the gateway does not check it) with the bearer REQUIRED
// and verified here for every staff action. `receipt_view` is the one
// anonymous action: the buyer web receipt page (/receipt/till/<id>#t=) reads
// one payment's receipt with its private token, nothing else. Each service-role RPC checks the member's
// rights at that venue (sell, money). Amounts are never taken from the body except cash
// given, tip and refund amounts; the server prices everything else.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { wrapEdgeHandler } from "../_shared/structuredLog.ts";
import { ticketCorsHeaders } from "../_shared/ticketCheckout.ts";
import {
  priceCart,
  type RequestedLine,
} from "../_shared/venueOrderPricing.ts";
import { loadMenuSnapshot } from "../_shared/venueOrderCore.ts";
import { fireVenueOrderPlacedForOrder } from "../_shared/venueOrderNotify.ts";
import { resolveBuyerPhone } from "../_shared/buyerPhone.ts";
import {
  issueTillReceiptTokenHash,
  TILL_RECEIPT_TOKEN_RE,
  tillReceiptTokenHashHex,
} from "../_shared/venueTillReceiptToken.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const MAX_MINOR = 2147483647;

// Machine codes the client maps to copy (tillCopy.ts). Anything else is
// `till_failed` (never a raw database message).
export const TILL_SAFE_CODES = [
  "till_not_enabled",
  "till_sale_not_found",
  "till_check_changed",
  "till_check_closed",
  "till_spot_has_check",
  "till_spot_not_found",
  "till_server_invalid",
  "till_invalid_payload",
  "till_idempotency_conflict",
  "till_round_invalid",
  "till_line_not_found",
  "till_line_paid",
  "till_void_needs_money_rights",
  "till_payment_in_progress",
  "till_nothing_to_pay",
  "till_amount_over_due",
  "till_payment_too_large",
  "till_tip_invalid",
  "till_hold_lapsed",
  "till_payment_not_found",
  "till_refund_method_unavailable",
  "till_payment_not_refundable",
  "till_refund_over_paid",
  "till_refund_tip_last",
  "till_settings_invalid",
  "till_receipt_not_paid",
  "till_card_refunded_once",
  "till_receipt_limit",
  "till_settings_changed",
  "offer_not_found",
  "offers_not_enabled",
  "offer_window_unavailable",
  "offer_sold_out",
  "offer_day_closed",
  "offer_changed",
  "offer_quote_expired",
  "offer_booking_not_found",
  "offer_invalid_transition",
  "offer_amount_over_balance",
  "offer_idempotency_conflict",
  "guest_list_entry_not_found",
  "guest_list_reduced_window_closed",
  "guest_list_reduced_price_invalid",
  "admit_count_invalid",
  "not_authorized",
  "venue_not_found",
] as const;

// deno-lint-ignore no-explicit-any
export type TillClient = any;

export type VenueTillDeps = {
  client?: () => TillClient;
  env?: (name: string) => string | undefined;
  notifyPlaced?: (client: TillClient, orderId: string) => Promise<void>;
  /** The receipt token hash for a payment's first receipt (tests inject). */
  receiptTokenHash?: (paymentId: string) => Promise<string>;
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type RpcError = { message?: string; code?: string; details?: string | null };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...ticketCorsHeaders, "Content-Type": "application/json" },
  });
}

function ok(data: unknown): Response {
  return json(200, { kind: "success", data });
}

export function tillSafeCode(error: RpcError | null | undefined): string {
  const message = error?.message ?? "";
  return (TILL_SAFE_CODES as readonly string[]).find((c) => message === c) ??
    (TILL_SAFE_CODES as readonly string[]).find((c) =>
      message.startsWith(c + " ") || message.startsWith(c + ":")
    ) ?? "till_failed";
}

function statusFor(code: string, error: RpcError): number {
  if (code === "till_failed") return 500;
  switch (error.code) {
    case "22023":
      return 400;
    case "42501":
      return 403;
    case "P0002":
      return 404;
    case "PT409":
    case "23505":
      return 409;
    case "P0001":
      return 422;
    default:
      return 400;
  }
}

export function tillFailure(error: RpcError): Response {
  const code = tillSafeCode(error);
  const body: Record<string, unknown> = { code };
  if (error.details) {
    try {
      const detail = JSON.parse(error.details);
      for (
        const key of ["remaining", "remainingMinor", "balanceMinor"] as const
      ) {
        if (typeof detail?.[key] === "number") body[key] = detail[key];
      }
    } catch {
      // optional detail
    }
  }
  if (code === "till_failed") {
    console.error("[venue-till] rpc failed", error.code, error.message);
  }
  return json(statusFor(code, error), body);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function minor(value: unknown, allowZero = true): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value > MAX_MINOR) return null;
  if (!allowZero && value === 0) return null;
  return value;
}

function parseMenuLines(raw: unknown): RequestedLine[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) return null;
  const out: RequestedLine[] = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    const menuItemId = str(entry?.menuItemId);
    if (!UUID.test(menuItemId)) return null;
    const modifierIds = Array.isArray(entry?.modifierIds)
      ? (entry.modifierIds as unknown[]).filter((m): m is string =>
        typeof m === "string" && UUID.test(m)
      )
      : [];
    const notes = str(entry?.notes).trim();
    out.push({
      menuItemId,
      quantity: Number.isInteger(entry?.quantity) ? Number(entry.quantity) : NaN,
      modifierIds,
      notes: notes ? notes.slice(0, 140) : null,
    });
  }
  return out;
}

export function createVenueTillHandler(deps: VenueTillDeps = {}) {
  const env = deps.env ?? ((name: string) => Deno.env.get(name));
  const notifyPlaced = deps.notifyPlaced ?? fireVenueOrderPlacedForOrder;
  const receiptTokenHash = deps.receiptTokenHash ??
    (async (paymentId: string) =>
      (await issueTillReceiptTokenHash({ paymentId })).hashHex);

  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: ticketCorsHeaders });
    }
    if (req.method !== "POST") return json(405, { code: "method_not_allowed" });

    let client: TillClient;
    if (deps.client) {
      client = deps.client();
    } else {
      const url = env("SUPABASE_URL") ?? "";
      const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (!url || !serviceKey) return json(500, { code: "unavailable" });
      client = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    }

    const body = await req.json().catch(() => null) as
      | Record<string, unknown>
      | null;
    if (!body) return json(400, { code: "invalid_request" });
    const action = str(body.action);

    // The buyer's receipt page: anonymous, one payment, only with its token.
    // A wrong token and an unknown payment answer the same 404.
    if (action === "receipt_view") {
      const paymentId = str(body.paymentId).toLowerCase();
      const token = str(body.token);
      if (!UUID.test(paymentId) || !TILL_RECEIPT_TOKEN_RE.test(token)) {
        return json(404, { code: "receipt_not_found" });
      }
      const { data, error } = await client.rpc("issue_4490_till_receipt_view", {
        p_payment_id: paymentId,
        p_token_hash: `\\x${await tillReceiptTokenHashHex(token)}`,
      });
      if (error) {
        if (error.message !== "receipt_not_found") {
          console.error("[venue-till] receipt view failed", error.code);
          return json(500, { code: "till_failed" });
        }
        return json(404, { code: "receipt_not_found" });
      }
      return ok({ receipt: data });
    }

    const jwt = (req.headers.get("authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    ).trim();
    if (!jwt || jwt === env("SUPABASE_SERVICE_ROLE_KEY")) {
      return json(401, { code: "auth_required" });
    }
    const { data: userData, error: userError } = await client.auth.getUser(jwt);
    const userId: string | null = userData?.user?.id ?? null;
    if (userError || !userId) return json(401, { code: "auth_required" });

    const venueId = str(body.venueId);
    if (!UUID.test(venueId)) return json(400, { code: "invalid_request" });

    // Every sale-scoped action checks the sale belongs to this venue.
    const saleId = str(body.saleId);
    const loadSale = async () => {
      const { data, error } = await client.from("venue_till_sales")
        .select("id, venue_id, brand_id, session_id, qr_spot_id, currency, state, version, check_label")
        .eq("id", saleId).maybeSingle();
      if (error) throw new Error(`sale_lookup_failed: ${error.message}`);
      if (!data || data.venue_id !== venueId) return null;
      return data as Record<string, unknown>;
    };
    const expectedVersion = intOrNull(body.expectedVersion);
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await client.rpc(name, args);
      if (error) return { error: error as RpcError, data: null };
      return { error: null, data };
    };
    const firePlaced = async (orderIds: unknown) => {
      if (!Array.isArray(orderIds)) return;
      for (const id of orderIds) {
        if (typeof id !== "string") continue;
        try {
          await notifyPlaced(client, id);
        } catch (err) {
          console.warn("[venue-till] placed push failed", String(err));
        }
      }
    };

    switch (action) {
      case "catalog": {
        const gate = await rpc("issue_4490_till_catalog", {
          p_venue_id: venueId,
          p_actor: userId,
        });
        if (gate.error) return tillFailure(gate.error);
        const catalog = gate.data as Record<string, unknown>;
        const menus = Array.isArray(catalog.menus)
          ? catalog.menus as Array<{ items?: Array<Record<string, unknown>> }>
          : [];
        const itemIds = menus.flatMap((m) => (m.items ?? []).map((i) => String(i.id)));
        // Orderable right now = the guest-order rule (menu active, in its
        // service window in venue time, item available, priced).
        const snapshot = await loadMenuSnapshot(client, {
          brandId: String(catalog.brandId),
          servingVenueId: venueId,
          servingMenuId: null,
          menuItemIds: itemIds,
        });
        for (const menu of menus) {
          for (const item of menu.items ?? []) {
            item.orderable = snapshot.orderableItemIds.has(String(item.id)) &&
              item.available === true;
          }
        }
        // Tap to pay arrives with O2; the sheet shows it only when true.
        return ok({ ...catalog, menus, tapAvailable: false });
      }

      case "checks": {
        const r = await rpc("issue_4490_till_checks", {
          p_venue_id: venueId,
          p_actor: userId,
        });
        return r.error ? tillFailure(r.error) : ok(r.data);
      }

      case "open": {
        const key = str(body.idempotencyKey);
        const spotId = body.spotId == null ? null : str(body.spotId);
        const server = body.serverUserId == null ? null : str(body.serverUserId);
        const label = body.label == null ? null : str(body.label).trim();
        if (
          !KEY.test(key) || (spotId !== null && !UUID.test(spotId)) ||
          (server !== null && !UUID.test(server)) ||
          (label !== null && label.length > 40)
        ) {
          return json(400, { code: "till_invalid_payload" });
        }
        const r = await rpc("issue_4490_till_open", {
          p_venue_id: venueId,
          p_actor: userId,
          p_server: server,
          p_label: label || null,
          p_spot_id: spotId,
          p_idempotency_key: key,
        });
        return r.error ? tillFailure(r.error) : ok({ sale: r.data });
      }

      case "sale":
      case "quote": {
        if (!UUID.test(saleId)) return json(400, { code: "till_invalid_payload" });
        const sale = await loadSale();
        if (!sale) return json(404, { code: "till_sale_not_found" });
        const allowed = await rpc("issue_4490_can_sell", {
          p_venue_id: venueId,
          p_user_id: userId,
        });
        if (allowed.error || allowed.data !== true) {
          return json(403, { code: "not_authorized" });
        }
        const r = await rpc("issue_4490_till_sale_projection", {
          p_sale_id: saleId,
        });
        if (r.error) return tillFailure(r.error);
        // Card totals (fees passed to guests) arrive with tap / scan (O2).
        return ok({ sale: r.data, cardTotalMinor: null });
      }

      case "add_menu": {
        const key = str(body.idempotencyKey);
        const requested = parseMenuLines(body.lines);
        if (!UUID.test(saleId) || !KEY.test(key) || requested === null) {
          return json(400, { code: "till_invalid_payload" });
        }
        const sale = await loadSale();
        if (!sale) return json(404, { code: "till_sale_not_found" });
        const allowed = await rpc("issue_4490_can_sell", {
          p_venue_id: venueId,
          p_user_id: userId,
        });
        if (allowed.error || allowed.data !== true) {
          return json(403, { code: "not_authorized" });
        }
        if (sale.state !== "open") return json(409, { code: "till_check_closed" });
        const idempotencyKey = `till:${saleId}:${key}`;
        // A double tap returns the round that already exists.
        const { data: existing } = await client.from("venue_orders")
          .select("id").eq("idempotency_key", idempotencyKey)
          .eq("venue_id", venueId).maybeSingle();
        let orderId: string | null = existing ? String(existing.id) : null;
        if (orderId === null) {
          const menu = await loadMenuSnapshot(client, {
            brandId: String(sale.brand_id),
            servingVenueId: venueId,
            servingMenuId: null,
            menuItemIds: [...new Set(requested.map((l) => l.menuItemId))],
          });
          const cart = priceCart({
            requested,
            itemsById: menu.itemsById,
            groupsByItemId: menu.groupsByItemId,
            modifiersById: menu.modifiersById,
            orderableItemIds: menu.orderableItemIds,
          });
          if (!cart.ok) {
            const f = cart.failure as { code: string; item?: string };
            return json(f.code === "item_not_orderable" ? 409 : 400, {
              code: f.code === "item_not_orderable"
                ? "till_item_not_orderable"
                : "till_invalid_payload",
              item: f.item ?? null,
            });
          }
          if (cart.currency.toUpperCase() !== String(sale.currency)) {
            return json(400, { code: "till_invalid_payload" });
          }
          const { data: settings } = await client.from("venue_ordering_settings")
            .select("service_charge_bps").eq("venue_id", venueId).maybeSingle();
          const bps = Number(settings?.service_charge_bps ?? 0);
          const subtotal = cart.subtotalCents;
          const serviceCharge = Math.round((subtotal * bps) / 10000);
          if (subtotal + serviceCharge > MAX_MINOR) {
            return json(400, { code: "till_payment_too_large" });
          }
          let pickupCode: string | null = null;
          let spotLabel: string | null = null;
          if (sale.qr_spot_id === null) {
            const code = await rpc("pg_venue_order_next_pickup_code", {
              p_venue_id: venueId,
            });
            if (code.error || typeof code.data !== "string") {
              return json(500, { code: "till_failed" });
            }
            pickupCode = code.data;
          } else {
            const { data: spot } = await client.from("qr_spots").select("label")
              .eq("id", sale.qr_spot_id).maybeSingle();
            spotLabel = spot?.label ?? null;
          }
          const newId = crypto.randomUUID();
          const { error: insertError } = await client.from("venue_orders").insert({
            id: newId,
            session_id: sale.session_id,
            brand_id: sale.brand_id,
            venue_id: venueId,
            qr_spot_id: sale.qr_spot_id,
            spot_label_at_order: spotLabel,
            source: "staff",
            taken_by_user_id: userId,
            pickup_code: pickupCode,
            buyer_name: sale.check_label ?? null,
            money_path: "venue_collected",
            currency: sale.currency,
            subtotal_cents: subtotal,
            list_subtotal_cents: subtotal,
            discount_cents: 0,
            service_charge_bps: bps,
            service_charge_cents: serviceCharge,
            tip_cents: 0,
            effective_take_rate_bps: 0,
            service_fee_bps: 0,
            mingla_fee_cents: 0,
            platform_service_fee_cents: 0,
            pass_mingla_fee: false,
            pass_service_fee: false,
            pass_tax: false,
            buyer_subtotal_cents: subtotal + serviceCharge,
            tax_amount_cents: 0,
            total_cents: subtotal + serviceCharge,
            payment_status: "pending",
            fulfillment_status: "held",
            idempotency_key: idempotencyKey,
            metadata: { unsettled_staff_order: true, till_sale_id: saleId },
          });
          if (insertError) {
            // A concurrent double tap won the insert: use its round.
            const { data: raced } = await client.from("venue_orders")
              .select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
            if (!raced) {
              console.error("[venue-till] round insert failed", insertError.message);
              return json(500, { code: "till_failed" });
            }
            orderId = String(raced.id);
          } else {
            const { error: itemsError } = await client.from("venue_order_items")
              .insert(cart.lines.map((line) => ({
                venue_order_id: newId,
                menu_item_id: line.menuItemId,
                line_no: line.lineNo,
                item_name_at_order: line.itemNameAtOrder,
                unit_price_cents: line.unitPriceCents,
                currency: line.currency,
                quantity: line.quantity,
                modifiers_total_cents: line.modifiersTotalCents,
                line_total_cents: line.lineTotalCents,
                notes: line.notes,
              }))).select("id, line_no");
            if (itemsError) {
              await client.from("venue_orders").update({
                fulfillment_status: "cancelled",
                payment_status: "cancelled",
                cancelled_at: new Date().toISOString(),
              }).eq("id", newId);
              console.error("[venue-till] items insert failed", itemsError.message);
              return json(500, { code: "till_failed" });
            }
            const modifierRows: Record<string, unknown>[] = [];
            const { data: itemRows } = await client.from("venue_order_items")
              .select("id, line_no").eq("venue_order_id", newId);
            const byLine = new Map<number, string>();
            for (const row of (itemRows ?? []) as Array<Record<string, unknown>>) {
              byLine.set(Number(row.line_no), String(row.id));
            }
            for (const line of cart.lines) {
              for (const m of line.modifiers) {
                modifierRows.push({
                  venue_order_item_id: byLine.get(line.lineNo),
                  menu_modifier_id: m.menuModifierId,
                  group_name_at_order: m.groupNameAtOrder,
                  modifier_name_at_order: m.modifierNameAtOrder,
                  price_delta_cents: m.priceDeltaCents,
                  currency: m.currency,
                });
              }
            }
            if (modifierRows.length > 0) {
              const { error: modError } = await client.from(
                "venue_order_item_modifiers",
              ).insert(modifierRows);
              if (modError) {
                await client.from("venue_orders").update({
                  fulfillment_status: "cancelled",
                  payment_status: "cancelled",
                  cancelled_at: new Date().toISOString(),
                }).eq("id", newId);
                return json(500, { code: "till_failed" });
              }
            }
            orderId = newId;
          }
        }
        const attached = await rpc("issue_4490_till_attach_round", {
          p_sale_id: saleId,
          p_order_id: orderId,
          p_actor: userId,
          p_expected_version: existing ? null : expectedVersion,
        });
        if (attached.error) {
          if (!existing) {
            // The round never joined the check: it must not linger as held.
            await client.from("venue_orders").update({
              fulfillment_status: "cancelled",
              payment_status: "cancelled",
              cancelled_at: new Date().toISOString(),
            }).eq("id", orderId).eq("fulfillment_status", "held");
          }
          return tillFailure(attached.error);
        }
        if (body.send === true) {
          const sent = await rpc("issue_4490_till_send", {
            p_sale_id: saleId,
            p_actor: userId,
          });
          if (sent.error) return tillFailure(sent.error);
          await firePlaced((sent.data as Record<string, unknown>)?.sentOrderIds);
          return ok({ sale: sent.data, replayed: Boolean(existing) });
        }
        return ok({ sale: attached.data, replayed: Boolean(existing) });
      }

      case "add_offer": {
        const key = str(body.idempotencyKey);
        const offeringId = str(body.offeringId);
        const windowId = body.windowId == null ? null : str(body.windowId);
        const entryId = body.guestListEntryId == null ? null : str(body.guestListEntryId);
        const lines = Array.isArray(body.lines) ? body.lines : null;
        if (
          !UUID.test(saleId) || !KEY.test(key) || !UUID.test(offeringId) ||
          (windowId !== null && !UUID.test(windowId)) ||
          (entryId !== null && !UUID.test(entryId)) || lines === null ||
          lines.length === 0 || lines.length > 20 ||
          !lines.every((l: Record<string, unknown>) =>
            UUID.test(str(l?.priceOptionId)) && Number.isInteger(l?.guests) &&
            Number(l.guests) >= 1 && Number(l.guests) <= 500
          )
        ) {
          return json(400, { code: "till_invalid_payload" });
        }
        if (!(await loadSale())) return json(404, { code: "till_sale_not_found" });
        const r = await rpc("issue_4490_till_add_offer_line", {
          p_sale_id: saleId,
          p_offering_id: offeringId,
          p_window_id: windowId,
          p_lines: lines.map((l: Record<string, unknown>) => ({
            priceOptionId: str(l.priceOptionId),
            guests: Number(l.guests),
          })),
          p_actor: userId,
          p_idempotency_key: key,
          p_guest_list_entry_id: entryId,
          p_expected_version: expectedVersion,
        });
        return r.error ? tillFailure(r.error) : ok({ sale: r.data });
      }

      case "add_balance": {
        const key = str(body.idempotencyKey);
        const groupId = str(body.groupId);
        const amount = minor(body.amountMinor, false);
        if (!UUID.test(saleId) || !KEY.test(key) || !UUID.test(groupId) || amount === null) {
          return json(400, { code: "till_invalid_payload" });
        }
        if (!(await loadSale())) return json(404, { code: "till_sale_not_found" });
        const r = await rpc("issue_4490_till_add_balance_line", {
          p_sale_id: saleId,
          p_group_id: groupId,
          p_amount_minor: amount,
          p_actor: userId,
          p_idempotency_key: key,
          p_expected_version: expectedVersion,
        });
        return r.error ? tillFailure(r.error) : ok({ sale: r.data });
      }

      case "void": {
        const lineId = body.lineId == null ? null : str(body.lineId);
        const itemId = body.orderItemId == null ? null : str(body.orderItemId);
        const reason = str(body.reason).trim();
        if (
          !UUID.test(saleId) || (lineId === null) === (itemId === null) ||
          (lineId !== null && !UUID.test(lineId)) ||
          (itemId !== null && !UUID.test(itemId)) ||
          reason.length < 1 || reason.length > 60 || expectedVersion === null
        ) {
          return json(400, { code: "till_invalid_payload" });
        }
        if (!(await loadSale())) return json(404, { code: "till_sale_not_found" });
        const r = await rpc("issue_4490_till_void", {
          p_sale_id: saleId,
          p_line_id: lineId,
          p_order_item_id: itemId,
          p_actor: userId,
          p_reason: reason,
          p_restock: body.restock === true,
          p_expected_version: expectedVersion,
        });
        return r.error ? tillFailure(r.error) : ok({ sale: r.data });
      }

      case "send": {
        if (!UUID.test(saleId)) return json(400, { code: "till_invalid_payload" });
        if (!(await loadSale())) return json(404, { code: "till_sale_not_found" });
        const r = await rpc("issue_4490_till_send", { p_sale_id: saleId, p_actor: userId });
        if (r.error) return tillFailure(r.error);
        await firePlaced((r.data as Record<string, unknown>)?.sentOrderIds);
        return ok({ sale: r.data });
      }

      case "relabel": {
        const spotId = body.spotId == null ? null : str(body.spotId);
        const label = body.label == null ? null : str(body.label).trim();
        if (
          !UUID.test(saleId) || (spotId !== null && !UUID.test(spotId)) ||
          (label !== null && label.length > 40) || expectedVersion === null
        ) {
          return json(400, { code: "till_invalid_payload" });
        }
        if (!(await loadSale())) return json(404, { code: "till_sale_not_found" });
        const r = await rpc("issue_4490_till_relabel", {
          p_sale_id: saleId,
          p_spot_id: spotId,
          p_label: label || null,
          p_actor: userId,
          p_expected_version: expectedVersion,
        });
        return r.error ? tillFailure(r.error) : ok({ sale: r.data });
      }

      case "set_server": {
        const server = str(body.serverUserId);
        if (!UUID.test(saleId) || !UUID.test(server) || expectedVersion === null) {
          return json(400, { code: "till_invalid_payload" });
        }
        if (!(await loadSale())) return json(404, { code: "till_sale_not_found" });
        const r = await rpc("issue_4490_till_set_server", {
          p_sale_id: saleId,
          p_server: server,
          p_actor: userId,
          p_expected_version: expectedVersion,
        });
        return r.error ? tillFailure(r.error) : ok({ sale: r.data });
      }

      case "pay_cash":
      case "pay_own_machine": {
        const amount = minor(body.amountMinor, false);
        const tip = minor(body.tipMinor ?? 0);
        const cashGiven = action === "pay_cash" ? minor(body.cashGivenMinor, false) : null;
        const requestId = str(body.clientRequestId);
        if (
          !UUID.test(saleId) || amount === null || tip === null ||
          !UUID.test(requestId) || expectedVersion === null ||
          (action === "pay_cash" && cashGiven === null)
        ) {
          return json(400, { code: "till_invalid_payload" });
        }
        if (amount + tip > MAX_MINOR) {
          return json(400, { code: "till_payment_too_large" });
        }
        if (!(await loadSale())) return json(404, { code: "till_sale_not_found" });
        const r = await rpc("issue_4490_till_take_payment", {
          p_sale_id: saleId,
          p_method: action === "pay_cash" ? "cash" : "own_machine",
          p_amount_minor: amount,
          p_tip_minor: tip,
          p_cash_given_minor: cashGiven,
          p_actor: userId,
          p_device_user: userId,
          p_client_request_id: requestId,
          p_expected_version: expectedVersion,
        });
        if (r.error) return tillFailure(r.error);
        const data = r.data as Record<string, unknown>;
        // Paying sends any unsent round first (T8): tell the kitchen.
        const sale = data.sale as Record<string, unknown> | undefined;
        const lines = Array.isArray(sale?.lines) ? sale.lines as Array<Record<string, unknown>> : [];
        const justSent = lines.filter((l) =>
          l.kind === "menu_round" && l.fulfillmentStatus === "placed"
        ).map((l) => l.orderId);
        if (data.replayed !== true) await firePlaced(justSent);
        return ok({
          sale: data.sale,
          paymentId: data.paymentId,
          changeMinor: data.changeMinor ?? null,
          replayed: data.replayed === true,
        });
      }

      case "refund": {
        const paymentId = str(body.paymentId);
        const amount = minor(body.amountMinor ?? 0);
        const tip = minor(body.tipMinor ?? 0);
        const reason = str(body.reason).trim();
        const requestId = str(body.clientRequestId);
        if (
          !UUID.test(paymentId) || amount === null || tip === null ||
          amount + tip === 0 || !UUID.test(requestId) || reason.length < 1 ||
          reason.length > 60
        ) {
          return json(400, { code: "till_invalid_payload" });
        }
        const owns = await client.from("venue_till_payments")
          .select("id, sale_id, method, venue_till_sales!inner(venue_id)")
          .eq("id", paymentId).maybeSingle();
        if (
          owns.error || !owns.data ||
          (owns.data as Record<string, { venue_id?: string }>).venue_till_sales
              ?.venue_id !== venueId
        ) {
          return json(404, { code: "till_payment_not_found" });
        }
        // A card payment (tap or scan, O2) is refunded on its carrier: one
        // card refund per payment, fee reversed pro rata (spec 08 §3 O1
        // Refunds). Cash and the venue's own machine are recorded only.
        const method = (owns.data as Record<string, unknown>).method;
        const r = method === "tap" || method === "scan"
          ? await rpc("issue_4490_till_mint_carrier_refund", {
            p_payment_id: paymentId,
            p_amount_minor: amount,
            p_tip_minor: tip,
            p_actor: userId,
            p_device_user: userId,
            p_reason: reason,
            p_client_request_id: requestId,
          })
          : await rpc("issue_4490_till_refund", {
            p_payment_id: paymentId,
            p_amount_minor: amount,
            p_tip_minor: tip,
            p_reason: reason,
            p_restock: body.restock === true,
            p_actor: userId,
            p_device_user: userId,
            p_client_request_id: requestId,
          });
        return r.error ? tillFailure(r.error) : ok(r.data);
      }

      case "receipt": {
        const paymentId = str(body.paymentId).toLowerCase();
        const emailRaw = str(body.email).trim().toLowerCase();
        const phoneRaw = str(body.phone).trim();
        if (!UUID.test(paymentId)) return json(400, { code: "till_invalid_payload" });
        let phone: string | null = null;
        if (phoneRaw) {
          const resolved = resolveBuyerPhone(phoneRaw, body.phoneCountryIso ?? null);
          if (resolved.e164 === null || resolved.legacyNanpGuess) {
            return json(400, { code: "till_receipt_phone_invalid" });
          }
          phone = resolved.e164;
        }
        if (emailRaw && (emailRaw.length > 254 || !EMAIL.test(emailRaw))) {
          return json(400, { code: "till_receipt_email_invalid" });
        }
        if (phone === null && !emailRaw) {
          return json(400, { code: "till_invalid_payload" });
        }
        const hashHex = await receiptTokenHash(paymentId);
        const r = await rpc("issue_4490_till_receipt_send", {
          p_payment_id: paymentId,
          p_venue_id: venueId,
          p_actor: userId,
          p_phone_e164: phone,
          p_email: emailRaw || null,
          p_token_hash: `\\x${hashHex}`,
        });
        return r.error ? tillFailure(r.error) : ok(r.data);
      }

      default:
        return json(400, { code: "unknown_action" });
    }
  };
}

if (import.meta.main) {
  serve(wrapEdgeHandler("venue-till", createVenueTillHandler(), {
    onError: (_err, requestId) => json(500, { code: "till_failed", requestId }),
  }));
}
