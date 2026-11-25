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
//             → { sale, paymentId, method, amountMinor, tipMinor, state, changeMinor, replayed }
//               (08-O3 fix 5: the amount is the one the server RECORDED for this
//               payment; a replay answers the original payment's facts)
//   refund    { paymentId, amountMinor, tipMinor, reason, restock, clientRequestId }
//             | { lineId, reason, clientRequestId }   (a paid offer line, in full:
//               the money comes back and its booking is cancelled)
//   servers   {}                                            → { servers } (who may take a check over)
//   checks    {}                                            → { open, paid }
//   sale      { saleId }                                    → sale
//   receipt   { paymentId, phone?, phoneCountryIso?, email? } → { queued, sendsLeft }
//   receipt_view { paymentId, token }   (ANONYMOUS)         → { receipt }
//   day_summary | day_close | day_reopen | day_carry_over | cash_movements |
//   cash_movement | day_export | settings_get | settings_set  (O5 part B,
//               dayClose.ts: money rights; reopen and export step up on a Till
//               device; settings never in a PIN session)
//
// O2 (tap to pay, scan to pay; the amount is always what is left on the
// check, priced by the server; the body may only carry the tip):
//   pay_tap_start  { saleId, tipMinor, clientRequestId, expectedVersion, platform }
//                  → { paymentId, amountMinor, chargedMinor, sale }   (then door-tap-intent scope till)
//   pay_card_cancel { paymentId }      a tap payment that never reached the reader
//   pay_code_create { saleId, tipMinor, clientRequestId, expectedVersion }
//                  → { code, payUrl, expiresAt, amountMinor, paymentId, sale }
//   pay_code_status { code }   pay_code_cancel { code }   pay_code_text { code, phone, phoneCountryIso? } (≤ 3)
//   keep_late      { paymentId, expectedVersion }   ("Keep it as payment")
//
// O4 (split bill, tables, by the hour started by staff; the server computes
// every share, every price and every claim):
//   set_split      { saleId, mode: "by_item"|"even"|"none", shares?|count?, expectedVersion }
//                  by_item shares = [{ items:[{ orderItemId, units } | { lineId, units:1 }] }]
//   close_covered  { saleId, expectedVersion } — 08-O4 fix 1 (O4-T2): a check the table
//                  deposit fully pays is closed with no payment (no money moves)
//   pay_cash / pay_own_machine / pay_tap_start / pay_code_create take an
//                  optional shareId: the share pays exactly its amount (the
//                  body's amountMinor must equal it) through the same path.
//   pay_room       { saleId, shareId?, expectedVersion }  [TRANSITIONAL] always
//                  refused till_room_not_ready (D13: charge to room comes with
//                  stays; exit: the room folio ships).
//   seat           { spotId, partySize?, reservationId?, label?, serverUserId?, idempotencyKey }
//                  → { sale } (a walk-in gets a staff reservation when Table
//                  reservations is on; a booking's paid deposit comes off the bill)
//   start_session  { saleId, offeringId, spaceId?, minutes, guests?, idempotencyKey, expectedVersion }
//   extend_session { saleId, lineId, minutes, idempotencyKey, expectedVersion } ("Add 30 min")
//   code_view      { code }                         (ANONYMOUS) venue, lines, amount
//   code_pay       { code, buyer:{name,email,phone,phoneCountryIso} } (ANONYMOUS) → provider page
//   confirm_return { code }                         (ANONYMOUS) verifies with the provider
//   The three anonymous code actions are rate-limited per IP and per code,
//   and unknown or malformed codes share one global budget per minute (O2
//   fixes 1-2): past it they answer 429 instead of 404, while a real code
//   always answers as usual. A code is 8 characters of a 31-letter alphabet
//   (≈ 8.5 × 10^11); that space and the per-address limit are the protection.
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
  generateTillCode,
  makeTillPayUrl,
  priceTillCarrier,
  TILL_CODE_RE,
} from "../_shared/venueTillCard.ts";
import { resolveVenueVisitOrigin } from "../_shared/venueOfferVisitLink.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";
import {
  paystackInitializeTransaction,
  paystackVerifyTransaction,
} from "../_shared/paystack.ts";
import { paystackChannelsForCountry } from "../_shared/paymentProvider.ts";
import {
  confirmVenueOrderPaystackOnReturn,
  venueOrderPaystackReference,
} from "../_shared/venueOrderWebhook.ts";
import { venueOrderEmailUndeliverable } from "../_shared/venueOrderPricing.ts";
import { venueOrderSplitFields } from "../venue-order-create/ngPaystackSplit.ts";
import { sha256Hex } from "../_shared/ticketCheckout.ts";
import { requestClientIp } from "../_shared/ticketLinkToken.ts";
import { tapToPayReleased } from "../_shared/doorPayServer.ts";
import { readBrandPayoutHoldStamp } from "../_shared/payoutHoldStamp.ts";
import {
  hasTillDeviceGrant,
  isMissingPinFunction,
  jwtAuthSessionId,
  pinRefusal,
  requireStepUp,
  resolveTillActor,
  STAFF_PIN_RE,
  staffTokenHash,
} from "../_shared/venueTillStaffSession.ts";
import { DAY_CLOSE_ACTIONS, handleDayClose } from "./dayClose.ts";
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
  "till_close_not_covered",
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
  // #4490 O1 fix 1: one bill with the old pad; one arrival per open check;
  // refusals the payment path used to answer 500.
  "till_tab_settled_on_pad",
  "till_round_settled_elsewhere",
  "guest_list_entry_on_check",
  "guest_list_arrived_invalid",
  "offer_option_unavailable",
  "offer_guests_out_of_range",
  "till_refund_line_invalid",
  "till_line_not_paid",
  "not_authorized",
  "venue_not_found",
  // #4490 O2: tap to pay and scan to pay.
  "till_card_not_ready",
  "till_card_tax_at_checkout",
  "brand_setup_incomplete",
  "till_tap_not_available",
  "till_payment_already_paid",
  "till_payment_landing",
  "till_late_nothing_to_keep",
  "pay_code_not_found",
  "pay_code_closed",
  "pay_code_text_limit",
  "pay_code_buyer_invalid",
  "till_receipt_phone_invalid",
  // #4490 O2 fix 1 (O2-T3): the rolling-hour pay-link text windows.
  "pay_code_text_window",
  // #4490 08-O3 fix 5 (O3-S3): a request id already used on this check for a
  // different payment or refund (another method, amount, tip, payment or
  // line). Nothing moved.
  "till_request_reused",
  // #4490 08-O4: split bill, tables, by the hour, the room seam.
  "till_split_active",
  "till_split_invalid",
  "till_split_after_part_payment",
  "till_split_even_only",
  "till_share_paid",
  "till_share_paying",
  "till_room_not_ready",
  "offer_space_taken",
  "offer_staff_start_off",
  "offer_length_invalid",
  "offer_too_soon",
  "deposit_already_used",
  "till_booking_not_found",
  "till_booking_other_table",
  "till_booking_not_seatable",
  // #4490 08-O5 part A: PIN sessions on a Till device login.
  "pin_session_required",
  "pin_session_invalid",
  "pin_step_up_required",
  "pin_weak",
  "pin_invalid",
  "pin_hard_locked",
  // #4490 08-O5C: a send (or a payment that sends first) found too little
  // stock for an item; nothing was sent and no money moved.
  "item_sold_out",
] as const;

// deno-lint-ignore no-explicit-any
export type TillClient = any;

export type VenueTillDeps = {
  client?: () => TillClient;
  env?: (name: string) => string | undefined;
  notifyPlaced?: (client: TillClient, orderId: string) => Promise<void>;
  /** The receipt token hash for a payment's first receipt (tests inject). */
  receiptTokenHash?: (paymentId: string) => Promise<string>;
  /** O2 test seams: providers and the code generator. */
  // deno-lint-ignore no-explicit-any
  stripe?: () => any;
  paystackInit?: typeof paystackInitializeTransaction;
  paystackVerify?: (reference: string) => Promise<Record<string, unknown>>;
  generateCode?: () => string;
};

/** Anonymous pay-code reads: per IP per minute, and per code per minute. */
export const TILL_CODE_IP_LIMIT = 60;
export const TILL_CODE_PAY_LIMIT = 10;
/**
 * #4490 O2 fixes 1-2 (O2-T2): unknown or malformed pay-code answers per minute
 * across every caller (issue_4490_till_code_guess_budget; no header in the
 * key). Once 300 unknown answers were given in a minute, further unknown codes
 * answer 429 instead of 404 for the rest of that minute, and the spent budget
 * is logged. A REAL code is never refused because of it (guests paying come
 * first): the lookup runs first and a hit answers exactly as without the
 * budget. What it does: it slows blind enumeration answers (a guesser stops
 * learning "not found" at speed) and makes a guessing run visible in the logs.
 * What it does not: it cannot stop a correct guess. The code space (8.5e11)
 * and the per-address limit are the protection.
 */
export const TILL_UNKNOWN_CODE_LIMIT = 300;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** #4490 O5: PIN actions of a signed-in member (Team), never on a Till device. */
export const PIN_ACCOUNT_ACTIONS = new Set(["pin_status", "pin_set", "pin_reset", "pin_team"]);
/** #4490 O5: "Who's selling?" actions of a Till device login (no session needed). */
export const PIN_DEVICE_ACTIONS = new Set(["pin_staff", "pin_unlock", "pin_end", "pin_sign_out"]);
/** A device signed out with its own email code: the code must be this recent. */
export const PIN_SIGN_OUT_CODE_MAX_AGE_S = 600;

/** The latest one-time-code sign-in time of a verified bearer (amr claim), in seconds. */
export function jwtOtpSignInAt(jwt: string): number | null {
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(
      atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")),
    ) as Record<string, unknown>;
    const amr = Array.isArray(claims.amr) ? claims.amr as Array<Record<string, unknown>> : [];
    const times = amr.filter((a) => a?.method === "otp" && typeof a?.timestamp === "number")
      .map((a) => Number(a.timestamp));
    return times.length > 0 ? Math.max(...times) : null;
  } catch {
    return null;
  }
}

function pinAccountFailure(error: RpcError): Response {
  const message = error.message ?? "";
  if (message === "pin_weak" || message === "pin_invalid") return json(400, { code: message });
  if (message === "pin_hard_locked") return json(422, { code: message });
  if (message === "not_authorized" || error.code === "42501") return json(403, { code: "not_authorized" });
  console.error("[venue-till] pin account action failed", error.code);
  return json(500, { code: "till_failed" });
}

/** pin_status / pin_set / pin_reset / pin_team: account sign-in only. */
async function handlePinAccount(
  client: TillClient,
  action: string,
  body: Record<string, unknown>,
  userId: string,
): Promise<Response> {
  // Never in a PIN session (settings, team and PIN resets never are).
  if (body.staffSession != null) return json(403, { code: "not_authorized" });
  if (action === "pin_reset") {
    const memberId = str(body.memberId);
    if (!UUID.test(memberId)) return json(400, { code: "till_invalid_payload" });
    const { data, error } = await client.rpc("issue_4490_pin_reset", { p_actor: userId, p_member: memberId });
    return error ? pinAccountFailure(error) : ok(data);
  }
  const brandId = str(body.brandId);
  if (!UUID.test(brandId)) return json(400, { code: "till_invalid_payload" });
  if (action === "pin_team") {
    const { data, error } = await client.rpc("issue_4490_pin_team", { p_actor: userId, p_brand_id: brandId });
    return error ? pinAccountFailure(error) : ok({ members: data });
  }
  const status = await client.rpc("issue_4490_pin_status", { p_user: userId, p_brand_id: brandId });
  if (status.error) return pinAccountFailure(status.error);
  if (action === "pin_status") return ok(status.data);
  const pin = str(body.pin);
  if (!STAFF_PIN_RE.test(pin)) return json(400, { code: "pin_invalid" });
  const { data, error } = await client.rpc("issue_4490_pin_set", {
    p_member: String((status.data as Record<string, unknown>).memberId),
    p_user: userId,
    p_pin: pin,
  });
  return error ? pinAccountFailure(error) : ok(data);
}

/** pin_staff / pin_unlock / pin_end / pin_sign_out on a Till device login. */
async function handlePinDevice(
  client: TillClient,
  action: string,
  body: Record<string, unknown>,
  venueId: string,
  userId: string,
  jwt: string,
): Promise<Response> {
  if (action === "pin_staff") {
    const { data, error } = await client.rpc("issue_4490_pin_staff", {
      p_venue_id: venueId,
      p_device_user: userId,
    });
    if (error) {
      // [TRANSITIONAL] before migration 20281203684490 nobody is gated, but
      // a Till device login never acts as itself (#4490 08-O5 fix 3: fail
      // closed when its grant says Till device or cannot be read).
      if (isMissingPinFunction(error)) {
        const device = await hasTillDeviceGrant(client, venueId, userId);
        return device === false ? ok({ gated: false }) : json(503, { code: "till_failed" });
      }
      return tillFailure(error);
    }
    return ok(data);
  }
  if (action === "pin_end") {
    const tokenHash = await staffTokenHash(str(body.staffSession));
    if (tokenHash === null) return ok({ ended: 0 });
    const { data, error } = await client.rpc("issue_4490_pin_session_end", {
      p_token_hash: tokenHash,
      p_device_user: userId,
      p_venue_id: venueId,
      p_reason: body.reason === "auto_lock" ? "auto_lock" : "ended",
    });
    return error ? tillFailure(error) : ok({ ended: Number(data ?? 0) });
  }
  const memberId = body.memberId == null ? null : str(body.memberId);
  const pin = str(body.pin);
  if (action === "pin_unlock") {
    if (memberId === null || !UUID.test(memberId) || !STAFF_PIN_RE.test(pin)) {
      return json(400, { code: "till_invalid_payload" });
    }
    const { data, error } = await client.rpc("issue_4490_pin_unlock", {
      p_venue_id: venueId,
      p_device_user: userId,
      p_member: memberId,
      p_pin: pin,
      p_auth_session: jwtAuthSessionId(jwt),
    });
    if (error) return tillFailure(error);
    const result = data as Record<string, unknown>;
    if (result?.ok !== true) {
      const refusal = pinRefusal(result ?? {});
      return json(refusal.status, refusal.body);
    }
    return ok({
      staffSession: result.token,
      expiresAt: result.expiresAt,
      autoLockMinutes: result.autoLockMinutes,
      member: result.member,
    });
  }
  // pin_sign_out: a manager's PIN, or (when no manager at the venue has a
  // PIN, spec 08 §12 item 5) the device's own fresh email code. Then every
  // PIN session of this device ends; the app signs the device out.
  if (memberId !== null || pin) {
    if (memberId === null || !UUID.test(memberId) || !STAFF_PIN_RE.test(pin)) {
      return json(400, { code: "till_invalid_payload" });
    }
    const { data, error } = await client.rpc("issue_4490_pin_approve", {
      p_token_hash: null,
      p_device_user: userId,
      p_venue_id: venueId,
      p_auth_session: null,
      p_member: memberId,
      p_pin: pin,
      p_purpose: "sign_out",
      p_target: null,
    });
    if (error) return tillFailure(error);
    const result = data as Record<string, unknown>;
    if (result?.ok !== true) {
      const refusal = pinRefusal(result ?? {});
      return json(refusal.status, refusal.body);
    }
  } else {
    const staff = await client.rpc("issue_4490_pin_staff", { p_venue_id: venueId, p_device_user: userId });
    if (staff.error) return tillFailure(staff.error);
    const info = staff.data as Record<string, unknown>;
    if (info?.gated !== true) return json(403, { code: "not_authorized" });
    if (info.managerHasPin === true) return json(403, { code: "pin_step_up_required" });
    const at = jwtOtpSignInAt(jwt);
    if (at === null || Date.now() / 1000 - at > PIN_SIGN_OUT_CODE_MAX_AGE_S) {
      return json(403, { code: "pin_email_code_required" });
    }
  }
  const { data, error } = await client.rpc("issue_4490_pin_sessions_end_all", { p_device_user: userId });
  return error ? tillFailure(error) : ok({ ended: Number(data ?? 0) });
}

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

/**
 * #4490 O2 fix 1 (O2-T4): releasing a stale card payment moves the check's
 * version. A caller who sent the version from just before that release is
 * still current; any other version is checked as sent (T10).
 */
export function versionAfterRelease(
  expected: number | null,
  before: number,
  after: number,
): number | null {
  return expected !== null && expected === before ? after : expected;
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
  // #4490 08-O5 fix 3: the database asks for the fresh PIN (no approval for
  // this purpose and target): the same answer requireStepUp gives.
  if (code === "pin_step_up_required") return 403;
  switch (error.code) {
    case "22023":
      return 400;
    case "42501":
      return 403;
    // #4490 O5: no PIN session, or one that ended, expired, idled or belongs
    // to another device or venue.
    case "28000":
      return 401;
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
        const key of ["remaining", "remainingMinor", "balanceMinor", "stepMinutes"] as const
      ) {
        if (typeof detail?.[key] === "number") body[key] = detail[key];
      }
      // 08-O4 (T13): who has the unit next, and when.
      // 08-O4 fix 1 (O4-T4): when a unit in use frees up.
      // 08-O5C: which item sold out, and how many are left.
      if (typeof detail?.left === "number") body.left = detail.left;
      for (const key of ["unitName", "nextAt", "freeAt", "itemName"] as const) {
        if (typeof detail?.[key] === "string") body[key] = detail[key];
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

/**
 * The only environment names this function reads, each read literally so the
 * function secret contract can attribute them (#2241). Tests inject `deps.env`.
 */
function runtimeEnv(name: string): string | undefined {
  switch (name) {
    case "BUSINESS_WEB_ORIGIN":
      return Deno.env.get("BUSINESS_WEB_ORIGIN");
    case "SUPABASE_SERVICE_ROLE_KEY":
      return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    case "SUPABASE_URL":
      return Deno.env.get("SUPABASE_URL");
    default:
      return undefined;
  }
}

export function createVenueTillHandler(deps: VenueTillDeps = {}) {
  const env = deps.env ?? runtimeEnv;
  const notifyPlaced = deps.notifyPlaced ?? fireVenueOrderPlacedForOrder;
  const receiptTokenHash = deps.receiptTokenHash ??
    (async (paymentId: string) =>
      (await issueTillReceiptTokenHash({ paymentId })).hashHex);
  const stripeClient = deps.stripe ?? stripeTicketCheckout;
  const paystackInit = deps.paystackInit ?? paystackInitializeTransaction;
  const paystackVerify = deps.paystackVerify ??
    ((reference: string) => paystackVerifyTransaction(reference));
  const newCode = deps.generateCode ?? (() => generateTillCode());
  // Pay URL, return and callback origins: env (local loopback on the local
  // stack), never the hard-coded production origin.
  const origin = () => resolveVenueVisitOrigin(env);

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

    if (action === "code_view" || action === "code_pay" || action === "confirm_return") {
      return await handleAnonymousCode(client, req, action, body);
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

    // #4490 O5: the member's own PIN (Team) and a manager's reset. Account
    // sign-in only: never from a Till device and never in a PIN session.
    if (PIN_ACCOUNT_ACTIONS.has(action)) {
      return await handlePinAccount(client, action, body, userId);
    }

    const venueId = str(body.venueId);
    if (!UUID.test(venueId)) return json(400, { code: "invalid_request" });

    // #4490 O5: "Who's selling?" on a Till device login (the device signed in;
    // no PIN session needed to list, switch in, end a session or sign out).
    if (PIN_DEVICE_ACTIONS.has(action)) {
      return await handlePinDevice(client, action, body, venueId, userId, jwt);
    }
    // #4490 O5: on a Till device login every Till action needs a live PIN
    // session and runs as that member (their own rights, never more); the
    // device user is recorded. Anyone else acts as themselves, as before.
    const who = await resolveTillActor(client, {
      venueId,
      userId,
      jwt,
      staffSession: body.staffSession,
    });
    if (!who.ok) return json(who.status, { code: who.code });
    const tillActor = who.actor;
    const actor = tillActor.actorUserId;
    const deviceUser = tillActor.deviceUserId;

    // #4490 O5 part B: the daily close, the drawer and the Till settings
    // (dayClose.ts). Same verified person and PIN session as every Till action.
    if (DAY_CLOSE_ACTIONS.has(action)) {
      return await handleDayClose(action, body, { client, venueId, actor: tillActor, json, ok });
    }

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
          p_actor: actor,
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
          // #4490 08-O5C (T15): an item switched off is left out of the Till;
          // a sold-out one stays, shown "Sold out" (stock never flips it off).
          menu.items = (menu.items ?? []).filter((item) => item.available === true);
          for (const item of menu.items) {
            item.orderable = snapshot.orderableItemIds.has(String(item.id)) &&
              item.available === true;
            const row = snapshot.itemsById.get(String(item.id));
            // NULL = not tracked (or the column is not there yet).
            item.stockLeft = typeof row?.stock_count === "number" ? row.stock_count : null;
          }
        }
        // "Warn me at" levels, read only when something is tracked.
        const trackedIds = menus.flatMap((m) => (m.items ?? []))
          .filter((i) => typeof i.stockLeft === "number").map((i) => String(i.id));
        if (trackedIds.length > 0) {
          const { data: warnRows } = await client.from("menu_items")
            .select("id, stock_warn_at").in("id", trackedIds);
          const warnById = new Map<string, number | null>();
          for (const w of (warnRows ?? []) as Array<Record<string, unknown>>) {
            warnById.set(String(w.id), typeof w.stock_warn_at === "number" ? w.stock_warn_at : null);
          }
          for (const menu of menus) {
            for (const item of menu.items ?? []) {
              item.stockWarnAt = warnById.get(String(item.id)) ?? null;
            }
          }
        }
        // The server half of the tap matrix (spec 08 §3 O2): a Stripe brand
        // paid out in GB or the US, released for this platform. The device,
        // the build and the seller are checked by the app.
        return ok({
          ...catalog,
          menus,
          tapAvailable: await tapServerAllows(String(catalog.brandId), venueId, body.platform),
        });
      }

      case "checks": {
        const r = await rpc("issue_4490_till_checks", {
          p_venue_id: venueId,
          p_actor: actor,
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
          p_actor: actor,
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
          p_user_id: actor,
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
          p_user_id: actor,
        });
        if (allowed.error || allowed.data !== true) {
          return json(403, { code: "not_authorized" });
        }
        // The version this request is checked against (T10).
        let roundVersion = expectedVersion;
        if (sale.state === "paying") {
          // #4490 O2 fix 1 (O2-T4): a code past its time or a tap that never
          // reached the reader no longer holds the check. Letting it go moves
          // the check's version; a caller who had the version from before that
          // is still current (only our own release moved it).
          const released = await rpc("issue_4490_till_release_stale", { p_sale_id: saleId });
          if (released.error) return tillFailure(released.error);
          if (Number(released.data) > 0) {
            const fresh = await loadSale();
            if (!fresh) return json(404, { code: "till_sale_not_found" });
            roundVersion = versionAfterRelease(expectedVersion, Number(sale.version), Number(fresh.version));
            sale.state = fresh.state;
          }
        }
        if (sale.state === "paying") {
          return json(409, { code: "till_payment_in_progress" });
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
            taken_by_user_id: actor,
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
          p_actor: actor,
          p_expected_version: existing ? null : roundVersion,
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
            p_actor: actor,
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
          p_actor: actor,
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
          p_actor: actor,
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
        if (tillActor.isDevice) {
          // #4490 O5: on a Till device the void runs in the session (checked
          // again in its own transaction); a sent item also needs a fresh PIN
          // with money rights, from the seller or a manager on the spot.
          let voidActor = actor;
          let steppedUp = false;
          if (body.stepUp != null) {
            const step = await requireStepUp(client, {
              venueId,
              actor: tillActor,
              stepUp: body.stepUp,
              purpose: "void_sent",
              target: itemId ?? lineId,
            });
            if (!step.ok) return json(step.status, step.body);
            voidActor = step.approverUserId;
            steppedUp = true;
          }
          const r = await rpc("issue_4490_till_void_on_device", {
            p_sale_id: saleId,
            p_line_id: lineId,
            p_order_item_id: itemId,
            p_actor: voidActor,
            p_device_user: deviceUser,
            p_reason: reason,
            p_restock: body.restock === true,
            p_expected_version: expectedVersion,
            p_stepped_up: steppedUp,
          });
          return r.error ? tillFailure(r.error) : ok({ sale: r.data });
        }
        const r = await rpc("issue_4490_till_void", {
          p_sale_id: saleId,
          p_line_id: lineId,
          p_order_item_id: itemId,
          p_actor: actor,
          p_reason: reason,
          p_restock: body.restock === true,
          p_expected_version: expectedVersion,
        });
        return r.error ? tillFailure(r.error) : ok({ sale: r.data });
      }

      case "send": {
        if (!UUID.test(saleId)) return json(400, { code: "till_invalid_payload" });
        if (!(await loadSale())) return json(404, { code: "till_sale_not_found" });
        const r = await rpc("issue_4490_till_send", { p_sale_id: saleId, p_actor: actor });
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
          p_actor: actor,
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
          p_actor: actor,
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
        // 08-O4: a share of a split check pays through the same path.
        const shareId = body.shareId == null ? null : str(body.shareId);
        if (
          !UUID.test(saleId) || amount === null || tip === null ||
          !UUID.test(requestId) || expectedVersion === null ||
          (action === "pay_cash" && cashGiven === null) ||
          (shareId !== null && !UUID.test(shareId))
        ) {
          return json(400, { code: "till_invalid_payload" });
        }
        if (amount + tip > MAX_MINOR) {
          return json(400, { code: "till_payment_too_large" });
        }
        if (!(await loadSale())) return json(404, { code: "till_sale_not_found" });
        const payArgs = {
          p_sale_id: saleId,
          p_method: action === "pay_cash" ? "cash" : "own_machine",
          p_amount_minor: amount,
          p_tip_minor: tip,
          p_cash_given_minor: cashGiven,
          p_actor: actor,
          p_device_user: deviceUser,
          p_client_request_id: requestId,
          p_expected_version: expectedVersion,
        };
        const r = shareId === null
          ? await rpc("issue_4490_till_take_payment", payArgs)
          : await rpc("issue_4490_till_pay_share", { ...payArgs, p_share_id: shareId });
        if (r.error) return tillFailure(r.error);
        const data = r.data as Record<string, unknown>;
        // Paying sends any unsent round first (T8): tell the kitchen.
        const sale = data.sale as Record<string, unknown> | undefined;
        const lines = Array.isArray(sale?.lines) ? sale.lines as Array<Record<string, unknown>> : [];
        const justSent = lines.filter((l) =>
          l.kind === "menu_round" && l.fulfillmentStatus === "placed"
        ).map((l) => l.orderId);
        if (data.replayed !== true) await firePlaced(justSent);
        // 08-O3 fix 5 (O3-S3): the answer carries what the server RECORDED for
        // this payment (a replay: the original payment), never the caller's
        // numbers. Read from the row when the database answer predates the
        // fix (edge deployed before its migration).
        const facts = await recordedPayment(data);
        return ok({
          sale: data.sale,
          paymentId: data.paymentId,
          method: facts.method,
          amountMinor: facts.amountMinor,
          tipMinor: facts.tipMinor,
          state: facts.state,
          changeMinor: data.changeMinor ?? null,
          replayed: data.replayed === true,
        });
      }

      case "pay_room": {
        // [TRANSITIONAL] spec 08 D13 seam: Charge to room comes with stays.
        // Exit: the stay venue work ships a room folio (a payment row with
        // method 'room' and a checked-in stay at the same brand). Until then
        // the server refuses it (issue_4490_till_take_payment raises
        // till_room_not_ready for method 'room'); nothing is written.
        const shareId = body.shareId == null ? null : str(body.shareId);
        if (!UUID.test(saleId) || (shareId !== null && !UUID.test(shareId))) {
          return json(400, { code: "till_invalid_payload" });
        }
        if (!(await loadSale())) return json(404, { code: "till_sale_not_found" });
        const roomArgs = {
          p_sale_id: saleId,
          p_method: "room",
          p_amount_minor: 1,
          p_tip_minor: 0,
          p_cash_given_minor: null,
          p_actor: actor,
          p_device_user: deviceUser,
          p_client_request_id: crypto.randomUUID(),
          p_expected_version: expectedVersion,
        };
        const r = shareId === null
          ? await rpc("issue_4490_till_take_payment", roomArgs)
          : await rpc("issue_4490_till_pay_share", { ...roomArgs, p_share_id: shareId });
        return r.error ? tillFailure(r.error) : json(409, { code: "till_room_not_ready" });
      }

      case "set_split": {
        const mode = str(body.mode);
        if (
          !UUID.test(saleId) || expectedVersion === null ||
          !["by_item", "even", "none"].includes(mode)
        ) {
          return json(400, { code: "till_invalid_payload" });
        }
        let shares: unknown = {};
        if (mode === "even") {
          const count = intOrNull(body.count);
          if (count === null || count < 2 || count > 20) {
            return json(400, { code: "till_split_invalid" });
          }
          shares = { count };
        } else if (mode === "by_item") {
          const raw = Array.isArray(body.shares) ? body.shares : null;
          if (raw === null || raw.length < 2 || raw.length > 20) {
            return json(400, { code: "till_split_invalid" });
          }
          const parsed: Array<{ items: Array<Record<string, unknown>> }> = [];
          for (const share of raw as Array<Record<string, unknown>>) {
            const items = Array.isArray(share?.items) ? share.items as Array<Record<string, unknown>> : null;
            if (items === null || items.length === 0 || items.length > 100) {
              return json(400, { code: "till_split_invalid" });
            }
            const out: Array<Record<string, unknown>> = [];
            for (const item of items) {
              const units = intOrNull(item?.units);
              const orderItemId = item?.orderItemId == null ? null : str(item.orderItemId);
              const lineId = item?.lineId == null ? null : str(item.lineId);
              if (
                units === null || units < 1 || units > 99 ||
                (orderItemId === null) === (lineId === null) ||
                (orderItemId !== null && !UUID.test(orderItemId)) ||
                (lineId !== null && !UUID.test(lineId))
              ) {
                return json(400, { code: "till_split_invalid" });
              }
              out.push(orderItemId !== null ? { orderItemId, units } : { lineId, units });
            }
            parsed.push({ items: out });
          }
          shares = parsed;
        }
        if (!(await loadSale())) return json(404, { code: "till_sale_not_found" });
        const r = await rpc("issue_4490_till_set_split", {
          p_sale_id: saleId,
          p_mode: mode,
          p_shares: shares,
          p_actor: actor,
          p_expected_version: expectedVersion,
        });
        return r.error ? tillFailure(r.error) : ok({ sale: r.data });
      }

      case "close_covered": {
        if (!UUID.test(saleId) || expectedVersion === null) {
          return json(400, { code: "till_invalid_payload" });
        }
        if (!(await loadSale())) return json(404, { code: "till_sale_not_found" });
        const r = await rpc("issue_4490_till_close_covered", {
          p_sale_id: saleId,
          p_actor: actor,
          p_expected_version: expectedVersion,
        });
        return r.error ? tillFailure(r.error) : ok({ sale: r.data });
      }

      case "seat": {
        const key = str(body.idempotencyKey);
        const spotId = str(body.spotId);
        const reservationId = body.reservationId == null ? null : str(body.reservationId);
        const server = body.serverUserId == null ? null : str(body.serverUserId);
        const label = body.label == null ? null : str(body.label).trim();
        const party = body.partySize == null ? null : intOrNull(body.partySize);
        if (
          !KEY.test(key) || !UUID.test(spotId) ||
          (reservationId !== null && !UUID.test(reservationId)) ||
          (server !== null && !UUID.test(server)) ||
          (label !== null && label.length > 40) ||
          (body.partySize != null && (party === null || party < 1 || party > 100))
        ) {
          return json(400, { code: "till_invalid_payload" });
        }
        const r = await rpc("issue_4490_till_seat", {
          p_venue_id: venueId,
          p_actor: actor,
          p_spot_id: spotId,
          p_party_size: party,
          p_reservation_id: reservationId,
          p_label: label || null,
          p_server: server,
          p_idempotency_key: key,
        });
        return r.error ? tillFailure(r.error) : ok({ sale: r.data });
      }

      case "start_session": {
        const key = str(body.idempotencyKey);
        const offeringId = str(body.offeringId);
        const spaceId = body.spaceId == null ? null : str(body.spaceId);
        const minutes = intOrNull(body.minutes);
        const guests = body.guests == null ? null : intOrNull(body.guests);
        if (
          !UUID.test(saleId) || !KEY.test(key) || key.length > 150 || !UUID.test(offeringId) ||
          (spaceId !== null && !UUID.test(spaceId)) || minutes === null || minutes < 15 ||
          minutes > 1440 || (body.guests != null && (guests === null || guests < 1 || guests > 1000)) ||
          expectedVersion === null
        ) {
          return json(400, { code: "till_invalid_payload" });
        }
        if (!(await loadSale())) return json(404, { code: "till_sale_not_found" });
        const r = await rpc("issue_4490_till_start_session", {
          p_sale_id: saleId,
          p_offering_id: offeringId,
          p_space_id: spaceId,
          p_minutes: minutes,
          p_guests: guests,
          p_actor: actor,
          p_idempotency_key: key,
          p_expected_version: expectedVersion,
        });
        return r.error ? tillFailure(r.error) : ok({ sale: r.data });
      }

      case "extend_session": {
        const key = str(body.idempotencyKey);
        const lineId = str(body.lineId);
        const minutes = intOrNull(body.minutes);
        if (
          !UUID.test(saleId) || !KEY.test(key) || key.length > 150 || !UUID.test(lineId) ||
          minutes === null || minutes < 15 || minutes > 240 || expectedVersion === null
        ) {
          return json(400, { code: "till_invalid_payload" });
        }
        if (!(await loadSale())) return json(404, { code: "till_sale_not_found" });
        const r = await rpc("issue_4490_till_extend_session", {
          p_sale_id: saleId,
          p_line_id: lineId,
          p_minutes: minutes,
          p_actor: actor,
          p_idempotency_key: key,
          p_expected_version: expectedVersion,
        });
        return r.error ? tillFailure(r.error) : ok({ sale: r.data });
      }

      case "refund": {
        // #4490 O5: on a Till device a refund always needs a fresh PIN with
        // money rights (the seller's, or a manager's on the spot); it is then
        // recorded under whoever approved it, with the device.
        let refundActor = actor;
        if (tillActor.isDevice) {
          const target = body.lineId != null ? str(body.lineId) : str(body.paymentId);
          if (!UUID.test(target)) return json(400, { code: "till_invalid_payload" });
          const step = await requireStepUp(client, {
            venueId,
            actor: tillActor,
            stepUp: body.stepUp,
            purpose: "refund",
            target,
          });
          if (!step.ok) return json(step.status, step.body);
          refundActor = step.approverUserId;
        }
        // A paid offer line, refunded in full: the money comes back from the
        // check's cash and own-machine payments, then the booking is cancelled
        // through the venue offer cancel path (spec 08 §3 O1 Refunds).
        if (body.lineId != null) {
          const lineId = str(body.lineId);
          const reason = str(body.reason).trim();
          const requestId = str(body.clientRequestId);
          if (
            !UUID.test(lineId) || !UUID.test(requestId) || reason.length < 1 ||
            reason.length > 60 || body.paymentId != null || body.amountMinor != null
          ) {
            return json(400, { code: "till_invalid_payload" });
          }
          const ownsLine = await client.from("venue_till_lines")
            .select("id, venue_till_sales!inner(venue_id)")
            .eq("id", lineId).maybeSingle();
          if (
            ownsLine.error || !ownsLine.data ||
            (ownsLine.data as Record<string, { venue_id?: string }>).venue_till_sales
                ?.venue_id !== venueId
          ) {
            return json(404, { code: "till_line_not_found" });
          }
          const r = await rpc("issue_4490_till_refund_line", {
            p_line_id: lineId,
            p_actor: refundActor,
            p_device_user: deviceUser,
            p_reason: reason,
            p_client_request_id: requestId,
          });
          return r.error ? tillFailure(r.error) : ok(r.data);
        }
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
            p_actor: refundActor,
            p_device_user: deviceUser,
            p_reason: reason,
            p_client_request_id: requestId,
          })
          : await rpc("issue_4490_till_refund", {
            p_payment_id: paymentId,
            p_amount_minor: amount,
            p_tip_minor: tip,
            p_reason: reason,
            p_restock: body.restock === true,
            p_actor: refundActor,
            p_device_user: deviceUser,
            p_client_request_id: requestId,
          });
        return r.error ? tillFailure(r.error) : ok(r.data);
      }

      case "servers": {
        const r = await rpc("issue_4490_till_servers", {
          p_venue_id: venueId,
          p_actor: actor,
        });
        return r.error ? tillFailure(r.error) : ok({ servers: r.data });
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
          p_actor: actor,
          p_phone_e164: phone,
          p_email: emailRaw || null,
          p_token_hash: `\\x${hashHex}`,
        });
        return r.error ? tillFailure(r.error) : ok(r.data);
      }

      case "pay_tap_start":
      case "pay_code_create": {
        const method = action === "pay_tap_start" ? "tap" : "scan";
        const tip = minor(body.tipMinor ?? 0);
        const requestId = str(body.clientRequestId);
        // 08-O4: one card payment (its own carrier) per share of a split check.
        const shareId = body.shareId == null ? null : str(body.shareId);
        if (
          !UUID.test(saleId) || tip === null || !UUID.test(requestId) || expectedVersion === null ||
          (shareId !== null && !UUID.test(shareId))
        ) {
          return json(400, { code: "till_invalid_payload" });
        }
        const sale = await loadSale();
        if (!sale) return json(404, { code: "till_sale_not_found" });
        // A retried tap returns what it made (no second payment).
        const { data: replay } = await client.from("venue_till_payments")
          .select("id").eq("sale_id", saleId).eq("client_request_id", requestId).maybeSingle();
        let prepared: Record<string, unknown> | null = null;
        if (!replay) {
          const prep = shareId === null
            ? await rpc("issue_4490_till_card_prepare", {
              p_sale_id: saleId,
              p_actor: actor,
              p_expected_version: expectedVersion,
            })
            : await rpc("issue_4490_till_card_prepare_share", {
              p_sale_id: saleId,
              p_share_id: shareId,
              p_actor: actor,
              p_expected_version: expectedVersion,
            });
          if (prep.error) return tillFailure(prep.error);
          prepared = prep.data as Record<string, unknown>;
          await firePlaced(prepared.sentOrderIds);
        }
        let money: Record<string, unknown> = { provider: "stripe", totalCents: 1 };
        let codeForStart: string | null = null;
        if (prepared) {
          const priced = await priceTillCarrier(client, {
            brandId: String(sale.brand_id),
            venueId,
            currency: String(prepared.currency),
            amountMinor: Number(prepared.amountMinor),
            serviceChargeMinor: Number(prepared.serviceChargeMinor),
            tipMinor: tip,
          });
          if (!priced.ok) return json(priced.code === "till_payment_too_large" ? 400 : 409, { code: priced.code });
          if (method === "tap") {
            if (
              priced.provider !== "stripe" ||
              !(await tapServerAllows(String(sale.brand_id), venueId, body.platform))
            ) {
              return json(409, { code: "till_tap_not_available" });
            }
          }
          money = priced.money;
          if (method === "scan") codeForStart = newCode();
        }
        let started: { error: RpcError | null; data: unknown } = { error: null, data: null };
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const startArgs = {
            p_sale_id: saleId,
            p_method: method,
            p_tip_minor: tip,
            p_actor: actor,
            p_device_user: deviceUser,
            p_client_request_id: requestId,
            p_expected_version: prepared
              ? Number(prepared.version)
              : shareId === null
              ? null
              : expectedVersion,
            p_money: money,
            p_code: method === "scan" ? (codeForStart ?? newCode()) : null,
          };
          started = shareId === null
            ? await rpc("issue_4490_till_card_start", startArgs)
            : await rpc("issue_4490_till_card_start_share", { ...startArgs, p_share_id: shareId });
          // A code collision (unique code) draws again.
          if (started.error?.code === "23505" && method === "scan" && prepared) {
            codeForStart = newCode();
            continue;
          }
          break;
        }
        if (started.error) return tillFailure(started.error);
        const data = started.data as Record<string, unknown>;
        const projection = await rpc("issue_4490_till_sale_projection", { p_sale_id: saleId });
        const out: Record<string, unknown> = {
          paymentId: data.paymentId,
          amountMinor: data.amountMinor,
          tipMinor: data.tipMinor,
          chargedMinor: data.chargedMinor,
          state: data.state,
          replayed: data.replayed === true,
          sale: projection.data,
        };
        if (method === "scan" && typeof data.code === "string") {
          out.code = data.code;
          out.payUrl = makeTillPayUrl(origin(), data.code);
          out.expiresAt = data.expiresAt;
          out.codeStatus = data.codeStatus;
        }
        return ok(out);
      }

      case "pay_card_cancel": {
        // A tap payment whose card reader never started (no PaymentIntent).
        // A tap with a PaymentIntent is cancelled through door-tap-intent.
        const paymentId = str(body.paymentId);
        if (!UUID.test(paymentId)) return json(400, { code: "till_invalid_payload" });
        const owned = await paymentAtVenue(paymentId);
        if (!owned) return json(404, { code: "till_payment_not_found" });
        if (owned.method !== "tap") return json(400, { code: "till_invalid_payload" });
        const { data: intent } = await client.from("door_tap_intents")
          .select("id, stripe_payment_intent_id").eq("till_payment_id", paymentId).maybeSingle();
        if (intent?.stripe_payment_intent_id) {
          return json(409, { code: "till_payment_in_progress" });
        }
        const r = await rpc("issue_4490_till_card_cancel", { p_payment_id: paymentId, p_actor: actor });
        return r.error ? tillFailure(r.error) : ok(r.data);
      }

      case "pay_code_status": {
        const code = str(body.code).toUpperCase();
        if (!TILL_CODE_RE.test(code)) return json(404, { code: "pay_code_not_found" });
        const r = await rpc("issue_4490_till_pay_code_status", {
          p_code: code,
          p_venue_id: venueId,
          p_actor: actor,
        });
        if (r.error) return tillFailure(r.error);
        return ok({ ...(r.data as Record<string, unknown>), payUrl: makeTillPayUrl(origin(), code) });
      }

      case "pay_code_cancel": {
        const code = str(body.code).toUpperCase();
        if (!TILL_CODE_RE.test(code)) return json(404, { code: "pay_code_not_found" });
        // #4490 O2 fix 1 (O2-T1): read without the release switch, so a code that
        // is live when the Till is switched off can still be cancelled.
        const status = await rpc("issue_4490_till_pay_code_lookup", {
          p_code: code,
          p_venue_id: venueId,
          p_actor: actor,
        });
        if (status.error) return tillFailure(status.error);
        const st = status.data as Record<string, unknown>;
        if (st.paymentState !== "pending") {
          return json(409, {
            code: st.paymentState === "paid" ? "till_payment_already_paid" : "pay_code_closed",
          });
        }
        // Stripe first: expire the guest's page; a page that already completed
        // means the money is landing, so nothing is cancelled. Paystack cannot
        // cancel an initialised transaction: only our page closes, and money
        // that still lands is late money (recorded, refundable).
        const { data: carrier } = await client.from("venue_orders")
          .select("id, provider, stripe_account_id, stripe_checkout_session_id")
          .eq("till_payment_id", String(st.paymentId)).eq("fulfillment_status", "payment_only")
          .maybeSingle();
        if (carrier?.provider === "stripe" && carrier.stripe_checkout_session_id) {
          const answer = await expireStripePage(
            String(carrier.stripe_checkout_session_id),
            String(carrier.stripe_account_id),
            `till_code_cancel:${st.paymentId}`,
          );
          if (answer !== "expired") {
            return json(409, { code: "till_payment_landing" });
          }
        }
        const r = await rpc("issue_4490_till_card_cancel", {
          p_payment_id: String(st.paymentId),
          p_actor: actor,
        });
        return r.error ? tillFailure(r.error) : ok(r.data);
      }

      case "pay_code_text": {
        const code = str(body.code).toUpperCase();
        if (!TILL_CODE_RE.test(code)) return json(404, { code: "pay_code_not_found" });
        const phone = resolveBuyerPhone(str(body.phone), body.phoneCountryIso ?? null);
        if (phone.e164 === null || phone.legacyNanpGuess) {
          return json(400, { code: "till_receipt_phone_invalid" });
        }
        const r = await rpc("issue_4490_till_pay_code_text", {
          p_code: code,
          p_venue_id: venueId,
          p_actor: actor,
          p_phone_e164: phone.e164,
          p_pay_url: makeTillPayUrl(origin(), code),
        });
        return r.error ? tillFailure(r.error) : ok(r.data);
      }

      case "keep_late": {
        const paymentId = str(body.paymentId);
        if (!UUID.test(paymentId) || expectedVersion === null) {
          return json(400, { code: "till_invalid_payload" });
        }
        if (!(await paymentAtVenue(paymentId))) return json(404, { code: "till_payment_not_found" });
        const r = await rpc("issue_4490_till_keep_late_payment", {
          p_payment_id: paymentId,
          p_actor: actor,
          p_expected_version: expectedVersion,
        });
        return r.error ? tillFailure(r.error) : ok(r.data);
      }

      default:
        return json(400, { code: "unknown_action" });
    }

    /**
     * 08-O3 fix 5: the facts the server recorded for a payment it answered.
     * From the RPC answer; if the database predates the fix, from the row;
     * if that read fails too, nulls (the client then reads the check's own
     * payment row): never the caller's numbers, never a failure for money
     * that was taken.
     */
    async function recordedPayment(data: Record<string, unknown>): Promise<{
      method: string | null;
      amountMinor: number | null;
      tipMinor: number | null;
      state: string | null;
    }> {
      const fin = (v: unknown): number | null =>
        typeof v === "number" && Number.isFinite(v) ? v : null;
      const txt = (v: unknown): string | null => typeof v === "string" ? v : null;
      if (fin(data.amountMinor) !== null && fin(data.tipMinor) !== null) {
        return {
          method: txt(data.method),
          amountMinor: fin(data.amountMinor),
          tipMinor: fin(data.tipMinor),
          state: txt(data.state),
        };
      }
      const row = await client.from("venue_till_payments")
        .select("method, amount_minor, tip_minor, state").eq("id", str(data.paymentId)).maybeSingle();
      const r = (row?.data ?? null) as Record<string, unknown> | null;
      if (row?.error || r === null) {
        console.error("[venue-till] recorded payment read failed", row?.error?.message ?? "no row");
        return { method: null, amountMinor: null, tipMinor: null, state: null };
      }
      return {
        method: txt(r.method),
        amountMinor: fin(r.amount_minor),
        tipMinor: fin(r.tip_minor),
        state: txt(r.state),
      };
    }

    async function paymentAtVenue(paymentId: string): Promise<Record<string, unknown> | null> {
      const owns = await client.from("venue_till_payments")
        .select("id, method, venue_till_sales!inner(venue_id)")
        .eq("id", paymentId).maybeSingle();
      if (
        owns.error || !owns.data ||
        (owns.data as Record<string, { venue_id?: string }>).venue_till_sales?.venue_id !== venueId
      ) {
        return null;
      }
      return owns.data as Record<string, unknown>;
    }
  };

  /** The server half of the tap availability matrix. */
  async function tapServerAllows(
    brandId: string,
    venueId: string,
    platform: unknown,
  ): Promise<boolean> {
    const client = deps.client ? deps.client() : null;
    const c = client ?? createClient(env("SUPABASE_URL") ?? "", env("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: rows } = await c.rpc("resolve_brand_pricing_inputs", {
      p_brand_id: brandId,
      p_venue_id: venueId,
    });
    const row = Array.isArray(rows) ? rows[0] as Record<string, unknown> | undefined : undefined;
    if (!row || String(row.payment_provider ?? "").toLowerCase() === "paystack") return false;
    const country = String(row.payment_country ?? "").trim().toUpperCase();
    if (country !== "GB" && country !== "US") return false;
    return await tapToPayReleased(c, brandId, platform);
  }

  /** Stripe-first close of a scan page (door-pay-code's rule). */
  async function expireStripePage(
    sessionId: string,
    stripeAccount: string,
    idempotencyKey: string,
  ): Promise<"expired" | "complete" | "unconfirmed"> {
    // deno-lint-ignore no-explicit-any
    let stripe: any;
    try {
      stripe = stripeClient();
    } catch {
      return "unconfirmed";
    }
    try {
      // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
      const expired = await stripe.checkout.sessions.expire(sessionId, {}, {
        stripeAccount,
        idempotencyKey,
      });
      if (expired?.status === "expired") return "expired";
      if (expired?.status === "complete") return "complete";
    } catch (_err) {
      // Stripe refuses a page that is no longer open: read it instead.
    }
    try {
      // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
      // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
      const read = await stripe.checkout.sessions.retrieve(sessionId, {}, { stripeAccount });
      return read?.status === "expired" ? "expired" : read?.status === "complete" ? "complete" : "unconfirmed";
    } catch {
      return "unconfirmed";
    }
  }

  /** Fails open when the limiter itself errors (a guest paying beats a log line). */
  async function limited(client: TillClient, scope: string, limit: number): Promise<boolean> {
    try {
      const { data, error } = await client.rpc("pg_venue_order_rate_limit_hit", {
        p_scope_key: await sha256Hex(scope),
        p_limit: limit,
      });
      if (error) {
        console.warn("[venue-till] code limiter failed open", error.code);
        return false;
      }
      return (data as { allowed?: boolean } | null)?.allowed === false;
    } catch {
      return false;
    }
  }

  /**
   * #4490 O2 fix 1 (O2-T2): the global unknown pay-code budget. `record`
   * counts one unknown answer. Fails open like the per-address limiter (a
   * guest paying beats a log line), loudly.
   */
  async function guessBudgetSpent(client: TillClient, record: boolean): Promise<boolean> {
    try {
      const { data, error } = await client.rpc("issue_4490_till_code_guess_budget", {
        p_record: record,
        p_limit: TILL_UNKNOWN_CODE_LIMIT,
      });
      if (error) {
        console.warn("[venue-till] unknown-code budget failed open", error.code);
        return false;
      }
      return data === true;
    } catch {
      console.warn("[venue-till] unknown-code budget failed open");
      return false;
    }
  }

  async function handleAnonymousCode(
    client: TillClient,
    req: Request,
    action: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const code = str(body.code).trim().toUpperCase();
    // The shared client-address rule (cf-connecting-ip first, as the ticket
    // link pages): a per-address courtesy limit only, since a caller can send
    // its own forwarding headers (O2-T2).
    const ip = requestClientIp(req);
    if (await limited(client, `till_code_ip:${ip}`, TILL_CODE_IP_LIMIT)) {
      return json(429, { code: "rate_limited" });
    }
    // #4490 O2 fix 2 (O2-T2): the global budget applies only to codes the
    // lookup did not find (or that are malformed). A real code never meets it.
    const unknownCode = async (): Promise<Response> => {
      const spent = await guessBudgetSpent(client, false);
      await guessBudgetSpent(client, true);
      if (spent) {
        // Audible, without the code or the caller's address.
        console.error("[venue-till] unknown pay-code budget spent this minute: answering 429 to unknown codes");
        return json(429, { code: "rate_limited" });
      }
      return json(404, { code: "pay_code_not_found" });
    };
    if (!TILL_CODE_RE.test(code)) return await unknownCode();
    if (action !== "code_view" && await limited(client, `till_code_pay:${code}`, TILL_CODE_PAY_LIMIT)) {
      return json(429, { code: "rate_limited" });
    }

    if (action === "code_view") {
      const { data, error } = await client.rpc("issue_4490_till_pay_code_view", { p_code: code });
      if (error) {
        if (error.message === "pay_code_not_found") return await unknownCode();
        console.error("[venue-till] code view failed", error.code);
        return json(500, { code: "till_failed" });
      }
      return ok({ view: data });
    }

    if (action === "confirm_return") {
      const { data: view, error: viewError } = await client.rpc("issue_4490_till_pay_code_view", {
        p_code: code,
      });
      if (viewError) {
        return viewError.message === "pay_code_not_found"
          ? await unknownCode()
          : json(500, { code: "till_failed" });
      }
      const v = view as Record<string, unknown>;
      if (v.paid === true) return ok({ result: "confirmed", view: v });
      const { data: row } = await client.from("venue_till_pay_codes")
        .select("payment_id").eq("code", code).maybeSingle();
      const { data: carrier } = row
        ? await client.from("venue_orders")
          .select("id, provider, total_cents, currency, paystack_reference, stripe_account_id, stripe_checkout_session_id")
          .eq("till_payment_id", row.payment_id).eq("fulfillment_status", "payment_only").maybeSingle()
        : { data: null };
      if (!carrier) return ok({ result: "not_paid", view: v });
      let result = "in_progress";
      try {
        if (carrier.provider === "paystack" && typeof carrier.paystack_reference === "string") {
          // The reference is the carrier's own; the query string's is never trusted.
          result = await confirmVenueOrderPaystackOnReturn(
            client,
            carrier.paystack_reference,
            paystackVerify,
          );
        } else if (carrier.provider === "stripe" && carrier.stripe_checkout_session_id) {
          // orch-strict-grep-allow stripe-no-idempotency-key — read-only retrieve (GET; no mutation to dedupe)
          // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
          const page = await stripeClient().checkout.sessions.retrieve(
            String(carrier.stripe_checkout_session_id),
            {},
            { stripeAccount: String(carrier.stripe_account_id) },
          );
          if (page?.status === "complete" && page?.payment_status === "paid") {
            const fin = await client.rpc("pg_venue_order_finalize_payment", {
              p_order_id: carrier.id,
              p_provider: "stripe",
              p_paid_amount_cents: Number(page.amount_total),
              p_currency: String(page.currency ?? "").toUpperCase(),
              p_payment_intent_id: typeof page.payment_intent === "string" ? page.payment_intent : null,
              p_charge_id: null,
              p_provider_fee_cents: null,
              p_provider_balance_transaction_id: null,
            });
            const status = (fin.data as Record<string, unknown> | null)?.status;
            result = !fin.error && (status === "finalized" || status === "replayed") ? "confirmed" : "in_progress";
          } else if (page?.status === "expired") {
            result = "not_paid";
          }
        }
      } catch (err) {
        console.warn("[venue-till] return check failed", err instanceof Error ? err.message : "unknown");
        result = "in_progress";
      }
      const { data: after } = await client.rpc("issue_4490_till_pay_code_view", { p_code: code });
      return ok({ result, view: after ?? v });
    }

    // code_pay: the guest's contact, then the provider page for the server's amount.
    const buyer = (body.buyer ?? {}) as Record<string, unknown>;
    const name = str(buyer.name).trim();
    const email = str(buyer.email).trim().toLowerCase();
    const phone = resolveBuyerPhone(buyer.phone, buyer.phoneCountryIso ?? null);
    if (name.length < 2 || name.length > 120) return json(400, { code: "buyer_name_required" });
    if (!EMAIL.test(email) || email.length > 254) return json(400, { code: "buyer_email_invalid" });
    if (venueOrderEmailUndeliverable(email)) return json(400, { code: "buyer_email_undeliverable" });
    if (phone.e164 === null || phone.legacyNanpGuess) return json(400, { code: "buyer_phone_invalid" });
    const { data: info, error } = await client.rpc("issue_4490_till_pay_code_buyer", {
      p_code: code,
      p_name: name,
      p_email: email,
      p_phone_e164: phone.e164,
    });
    if (error) {
      if (error.message === "pay_code_not_found") return await unknownCode();
      if (error.message === "pay_code_closed") return json(409, { code: "pay_code_closed" });
      if (error.message === "pay_code_buyer_invalid") return json(400, { code: "pay_code_buyer_invalid" });
      console.error("[venue-till] code pay failed", error.code);
      return json(500, { code: "till_failed" });
    }
    const p = info as Record<string, unknown>;
    const carrierId = String(p.carrierOrderId);
    const returnUrl = `${makeTillPayUrl(origin(), code)}?paid=1`;
    const continuation = (p.continuation ?? null) as Record<string, unknown> | null;
    if (continuation && typeof continuation.url === "string") {
      return ok({ provider: p.provider, redirectUrl: continuation.url });
    }
    if (p.provider === "paystack") {
      const reference = venueOrderPaystackReference(carrierId);
      const stamp = await client.from("venue_orders").update({ paystack_reference: reference })
        .eq("id", carrierId).is("paystack_reference", null).select("id");
      if (stamp.error || !Array.isArray(stamp.data) || stamp.data.length !== 1) {
        return json(409, { code: "till_payment_in_progress" });
      }
      // #3645: a failed stamp read refuses (retryable); reading it as
      // "unstamped" would split a stamped brand's money at charge time.
      const holdStamp = await readBrandPayoutHoldStamp(client, String(p.brandId), "venue-till");
      if (!holdStamp.ok) {
        await client.from("venue_orders").update({ paystack_reference: null })
          .eq("id", carrierId).eq("paystack_reference", reference).eq("payment_status", "pending");
        return json(503, { code: "till_failed" });
      }
      const { data: pricing } = await client.rpc("resolve_brand_pricing_inputs", {
        p_brand_id: String(p.brandId),
        p_venue_id: null,
      });
      const subaccount = Array.isArray(pricing) && typeof pricing[0]?.paystack_subaccount_code === "string"
        ? pricing[0].paystack_subaccount_code
        : null;
      try {
        const init = await paystackInit({
          email,
          amountSubunits: Number(p.totalCents),
          currency: "NGN",
          reference,
          callbackUrl: returnUrl,
          channels: paystackChannelsForCountry("NG"),
          metadata: {
            mingla_venue_order_id: carrierId,
            mingla_till_payment_id: String(p.paymentId),
            mingla_brand_id: String(p.brandId),
          },
          ...venueOrderSplitFields(
            holdStamp.isCutover,
            subaccount,
            Number(p.applicationFeeCents),
          ),
        });
        await mergeContinuation(client, carrierId, { url: init.authorization_url, reference });
        return ok({ provider: "paystack", redirectUrl: init.authorization_url });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await client.from("venue_orders").update({ paystack_reference: null })
          .eq("id", carrierId).eq("paystack_reference", reference).eq("payment_status", "pending");
        console.error("[venue-till] paystack initialise failed", message.slice(0, 120));
        return json(502, { code: /email/i.test(message) ? "buyer_email_undeliverable" : "till_failed" });
      }
    }
    try {
      // @ts-ignore -- Stripe SDK namespace is runtime-provided in Deno.
      const page = await stripeClient().checkout.sessions.create({
        mode: "payment",
        currency: String(p.currency).toLowerCase(),
        line_items: [{
          price_data: {
            currency: String(p.currency).toLowerCase(),
            unit_amount: Number(p.totalCents),
            product_data: { name: `Bill at ${String(p.venueName) || "the venue"}` },
          },
          quantity: 1,
        }],
        payment_intent_data: {
          metadata: {
            mingla_venue_order_id: carrierId,
            mingla_till_payment_id: String(p.paymentId),
            mingla_brand_id: String(p.brandId),
          },
          ...(Number(p.applicationFeeCents) > 0
            ? { application_fee_amount: Number(p.applicationFeeCents) }
            : {}),
          statement_descriptor_suffix: "MINGLA",
        },
        customer_email: email,
        // Stripe's minimum page life is 30 minutes.
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        success_url: returnUrl,
        cancel_url: makeTillPayUrl(origin(), code),
        metadata: {
          mingla_venue_order_id: carrierId,
          mingla_till_payment_id: String(p.paymentId),
          mingla_brand_id: String(p.brandId),
        },
      }, {
        stripeAccount: String(p.stripeAccountId),
        idempotencyKey: `till_code_pay:${carrierId}`,
      });
      await client.from("venue_orders").update({ stripe_checkout_session_id: page.id })
        .eq("id", carrierId).is("stripe_checkout_session_id", null);
      await mergeContinuation(client, carrierId, { url: page.url, sessionId: page.id });
      return ok({ provider: "stripe", redirectUrl: page.url });
    } catch (err) {
      console.error("[venue-till] stripe page failed", err instanceof Error ? err.message.slice(0, 120) : "unknown");
      return json(502, { code: "till_failed" });
    }
  }

  async function mergeContinuation(
    client: TillClient,
    carrierId: string,
    continuation: Record<string, unknown>,
  ): Promise<void> {
    const { data } = await client.from("venue_orders").select("metadata").eq("id", carrierId).maybeSingle();
    const metadata = (data?.metadata ?? {}) as Record<string, unknown>;
    await client.from("venue_orders").update({
      metadata: { ...metadata, payment_continuation: continuation },
    }).eq("id", carrierId);
  }
}

if (import.meta.main) {
  serve(wrapEdgeHandler("venue-till", createVenueTillHandler(), {
    onError: (_err, requestId) => json(500, { code: "till_failed", requestId }),
  }));
}
