// #4490 venue-check-in — the venue's door: the day's list, scan a pass or an
// event ticket, admit from the list, undo an admit, sell at the gate.
//
// POST { action, venueId, ... } with the staff member's user JWT. Authority
// (venue.check_in, or brand rank >= scanner) is checked in the database for
// the user this function verified; every RPC here is service-role only.
//
//   list   { venueId, localDate? }
//   scan   { venueId, qrPayload, admitCount?, idChecked? }
//   admit  { venueId, passId, count?, idChecked? }
//   admit_member { venueId, subscriptionId, guests? (0..20, on the
//            member's guest passes) } — a member from the list (#4490 P6);
//            a member's pass code goes through `scan` (admitCount = the
//            member plus guests)
//   admit_code { venueId, memberCode, guests? (0..20) } — the six-character
//            fallback printed below a member pass (#4490 M)
//   admit_guest_list { venueId, entryId, count? } — free admit, reduced Entry
//            sale hand-off, or normal-price fallback (#4490 I)
//   sell_guest_list { venueId, entryId, count, method, buyer?,
//            idempotencyKey } — completes the reduced Entry gate sale
//   undo   { venueId, logId }
//   sell   { venueId, offeringId, lines:[{priceOptionId, guests}], method:
//            "cash" | "transfer" | "pay_link", buyer?: {name, email?, phone?},
//            idempotencyKey }
//   take_balance { venueId, groupId, amountMinor, method: "cash" | "transfer"
//            | "card_at_venue" | "other", idempotencyKey } — money taken at
//            the venue (needs money rights: venue.manage_money or rank >=
//            finance_manager)
//   balance_link { venueId, groupId } — the guest's own pay link for the
//            balance, shown as a QR on this device (check-in rights)
//
// Scan results: admitted, already_used, wrong_day, not_yet, void, not_found,
// wrong_venue, days_used, day_full, and id_required (ask "ID checked?" and
// scan again with idChecked: true).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../_shared/businessWebOrigin.ts";
import { resolveTillActor } from "../_shared/venueTillStaffSession.ts";
import {
  issueVenueOfferBookingToken,
  rederiveVenueOfferBookingToken,
  venueOfferTokenHashHex,
} from "../_shared/venueOfferBookingToken.ts";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MEMBER_CODE = /^[2-9A-HJ-NP-Z]{6}$/;

const SAFE_CODES = [
  "not_authorized",
  "venue_not_found",
  "admit_count_invalid",
  "check_in_not_found",
  "check_in_not_undoable",
  "check_in_undo_too_late",
  "check_in_already_undone",
  "event_scan_not_allowed",
  "qr_token_pepper_missing",
  "offer_not_found",
  "offer_window_unavailable",
  "offer_option_unavailable",
  "offer_wrong_weekday",
  "offer_wrong_time",
  "offer_guests_out_of_range",
  "offer_sold_out",
  "offer_day_closed",
  "offer_guest_invalid",
  "offer_guest_email_required",
  "offer_invalid_payload",
  "offer_idempotency_conflict",
  "offers_not_enabled",
  "offer_booking_not_found",
  "offer_amount_over_balance",
  "offer_nothing_to_pay",
  "offer_invalid_transition",
  "balance_link_unavailable",
  "member_guest_passes_used_up",
  "member_guests_day_full",
  "member_code_rate_limited",
  "guest_list_entry_not_found",
  "guest_list_wrong_day",
  "guest_list_reduced_price_invalid",
  "guest_list_reduced_window_closed",
  "guest_list_arrived_invalid",
  // #4490 08-O1 fix 2: an arrival on an open Till check is not sold at the gate too.
  "guest_list_entry_on_check",
];

type RpcError = { message?: string; code?: string; details?: string };
export type CheckInClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: RpcError | null }>;
  auth: {
    getUser: (
      jwt: string,
    ) => Promise<{ data: { user: { id: string } | null }; error: unknown }>;
  };
};

export type VenueCheckInDeps = {
  client?: () => CheckInClient;
  env?: (name: string) => string | undefined;
  newGroupId?: () => string;
  issueToken?: typeof issueVenueOfferBookingToken;
  rederiveToken?: typeof rederiveVenueOfferBookingToken;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function safeCode(error: RpcError | null | undefined): string {
  const message = error?.message ?? "";
  return SAFE_CODES.find((code) => message === code) ??
    SAFE_CODES.find((code) => message.startsWith(code)) ??
    "check_in_failed";
}

function statusFor(error: RpcError): number {
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
    case "PT429":
      return 429;
    case "P0001":
      return 422;
    default:
      return 500;
  }
}

function failure(error: RpcError): Response {
  const code = safeCode(error);
  const body: Record<string, unknown> = { code };
  if (error.details) {
    try {
      const detail = JSON.parse(error.details);
      if (typeof detail?.remaining === "number") {
        body.remaining = detail.remaining;
      }
      if (typeof detail?.left === "number") {
        body.left = detail.left;
      }
    } catch {
      // optional
    }
  }
  return json(code === "check_in_failed" ? 500 : statusFor(error), body);
}

function returnOrigin(env: (name: string) => string | undefined): string {
  const configured = (env("BUSINESS_WEB_ORIGIN") ?? "").trim().replace(
    /\/+$/,
    "",
  );
  const local = (() => {
    try {
      return ["kong", "localhost", "127.0.0.1", "host.docker.internal"]
        .includes(
          new URL(env("SUPABASE_URL") ?? "").hostname,
        );
    } catch {
      return false;
    }
  })();
  if (
    configured === PRODUCTION_BUSINESS_WEB_ORIGIN ||
    /^https:\/\/mingla-business-[a-z0-9-]+\.vercel\.app$/.test(configured) ||
    (local && /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(configured))
  ) {
    return configured;
  }
  return PRODUCTION_BUSINESS_WEB_ORIGIN;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The only environment names this function reads, each read literally so the
 * function secret contract can attribute them (#2241). Tests inject `deps.env`.
 */
function runtimeEnv(name: string): string | undefined {
  switch (name) {
    case "BUSINESS_WEB_ORIGIN":
      return Deno.env.get("BUSINESS_WEB_ORIGIN");
    case "LOCAL_QR_TOKEN_PEPPER":
      return Deno.env.get("LOCAL_QR_TOKEN_PEPPER");
    case "SUPABASE_SERVICE_ROLE_KEY":
      return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    case "SUPABASE_URL":
      return Deno.env.get("SUPABASE_URL");
    case "app.qr_token_pepper":
      return Deno.env.get("app.qr_token_pepper");
    default:
      return undefined;
  }
}

export function createVenueCheckInHandler(deps: VenueCheckInDeps = {}) {
  const env = deps.env ?? runtimeEnv;
  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") return json(405, { code: "method_not_allowed" });
    const jwt = (req.headers.get("authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    )
      .trim();
    if (!jwt) return json(401, { code: "auth_required" });

    let client: CheckInClient;
    if (deps.client) {
      client = deps.client();
    } else {
      const url = env("SUPABASE_URL") ?? "";
      const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (!url || !serviceKey) return json(500, { code: "unavailable" });
      client = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      }) as unknown as CheckInClient;
    }
    const { data: userData, error: userError } = await client.auth.getUser(jwt);
    const userId = userData?.user?.id ?? null;
    if (userError || !userId) return json(401, { code: "auth_required" });

    const body = await req.json().catch(() => null) as
      | Record<string, unknown>
      | null;
    const action = str(body?.action);
    const venueId = str(body?.venueId);
    if (!body || !UUID.test(venueId)) {
      return json(400, { code: "invalid_request" });
    }
    const local = (() => {
      try {
        return ["kong", "localhost", "127.0.0.1", "host.docker.internal"]
          .includes(new URL(env("SUPABASE_URL") ?? "").hostname);
      } catch {
        return false;
      }
    })();
    // #4490 O5: on a Till device login, money at the door goes through the
    // Till with a PIN session (the gate sale sheet only shows while the Till
    // is off, when no account is gated). Refused here so no door money is
    // taken without someone's PIN.
    if (["sell", "sell_guest_list", "take_balance", "balance_link"].includes(action)) {
      const who = await resolveTillActor(client, { venueId, userId, jwt, staffSession: null });
      if (!who.ok) return json(who.status === 500 ? 500 : 403, { code: who.status === 500 ? "unavailable" : "pin_session_required" });
    }
    const pepper = (env("app.qr_token_pepper") ??
      (local ? env("LOCAL_QR_TOKEN_PEPPER") : undefined) ?? "").trim();

    if (action === "list") {
      const localDate = body.localDate;
      if (
        localDate !== undefined && localDate !== null &&
        !DATE.test(str(localDate))
      ) {
        return json(400, { code: "invalid_request" });
      }
      const { data, error } = await client.rpc("issue_4490_check_in_list", {
        p_venue_id: venueId,
        p_local_date: localDate ?? null,
        p_scanner_user_id: userId,
      });
      return error ? failure(error) : json(200, { kind: "success", data });
    }

    if (action === "scan") {
      const qr = str(body.qrPayload).trim();
      const admitCount = body.admitCount;
      if (
        !qr || qr.length > 300 ||
        (admitCount !== undefined && admitCount !== null &&
          !Number.isInteger(admitCount))
      ) {
        return json(400, { code: "invalid_request" });
      }
      const { data, error } = await client.rpc("issue_4490_check_in_scan", {
        p_venue_id: venueId,
        p_qr_payload: qr,
        p_admit_count: admitCount ?? null,
        p_id_checked: body.idChecked === true,
        p_scanner_user_id: userId,
        p_qr_pepper: pepper,
      });
      return error ? failure(error) : json(200, { kind: "success", data });
    }

    if (action === "admit") {
      const passId = str(body.passId);
      const count = body.count;
      if (
        !UUID.test(passId) ||
        (count !== undefined && count !== null && !Number.isInteger(count))
      ) {
        return json(400, { code: "invalid_request" });
      }
      const { data, error } = await client.rpc("issue_4490_check_in_admit", {
        p_venue_id: venueId,
        p_pass_id: passId,
        p_count: count ?? null,
        p_id_checked: body.idChecked === true,
        p_scanner_user_id: userId,
      });
      return error ? failure(error) : json(200, { kind: "success", data });
    }

    if (action === "admit_member") {
      const subscriptionId = str(body.subscriptionId);
      const guests = body.guests ?? 0;
      if (
        !UUID.test(subscriptionId) || !Number.isInteger(guests) ||
        (guests as number) < 0 || (guests as number) > 20
      ) {
        return json(400, { code: "invalid_request" });
      }
      const { data, error } = await client.rpc("issue_4490_check_in_member", {
        p_venue_id: venueId,
        p_subscription_id: subscriptionId,
        p_guests: guests,
        p_scanner_user_id: userId,
      });
      return error ? failure(error) : json(200, { kind: "success", data });
    }

    if (action === "admit_code") {
      const memberCode = str(body.memberCode).toUpperCase().replace(
        /[\s-]+/g,
        "",
      );
      const guests = body.guests ?? 0;
      if (
        !MEMBER_CODE.test(memberCode) || !Number.isInteger(guests) ||
        (guests as number) < 0 || (guests as number) > 20
      ) {
        return json(400, { code: "invalid_request" });
      }
      const { data, error } = await client.rpc(
        "issue_4490_admit_member_by_code",
        {
          p_venue_id: venueId,
          p_code: memberCode,
          p_guests: guests,
          p_scanner_user_id: userId,
        },
      );
      return error ? failure(error) : json(200, { kind: "success", data });
    }

    if (action === "admit_guest_list") {
      const entryId = str(body.entryId);
      const count = body.count;
      if (
        !UUID.test(entryId) ||
        (count !== undefined && count !== null &&
          (!Number.isInteger(count) || Number(count) < 1 || Number(count) > 11))
      ) return json(400, { code: "invalid_request" });
      const { data, error } = await client.rpc(
        "issue_4490_admit_guest_list",
        {
          p_venue_id: venueId,
          p_entry_id: entryId,
          p_count: count ?? null,
          p_scanner_user_id: userId,
        },
      );
      return error ? failure(error) : json(200, { kind: "success", data });
    }

    if (action === "sell_guest_list") {
      const entryId = str(body.entryId);
      const count = body.count;
      const method = str(body.method);
      const key = str(body.idempotencyKey);
      if (
        !UUID.test(entryId) || !Number.isInteger(count) || Number(count) < 1 ||
        Number(count) > 11 || !["cash", "transfer", "pay_link"].includes(method) ||
        !KEY.test(key) ||
        (body.buyer !== undefined &&
          (typeof body.buyer !== "object" || Array.isArray(body.buyer)))
      ) return json(400, { code: "invalid_request" });
      let groupId: string | null = null;
      let token: string | null = null;
      if (method === "pay_link") {
        groupId = (deps.newGroupId ?? (() => crypto.randomUUID()))();
        token = (await (deps.issueToken ?? issueVenueOfferBookingToken)({ groupId })).token;
      }
      const { data, error } = await client.rpc(
        "issue_4490_guest_list_gate_sale",
        {
          p_venue_id: venueId,
          p_entry_id: entryId,
          p_count: count,
          p_method: method,
          p_buyer: body.buyer ?? {},
          p_idempotency_key: key,
          p_scanner_user_id: userId,
          p_group_id: groupId,
          p_buyer_token_hash: token
            ? `\\x${await venueOfferTokenHashHex(token)}`
            : null,
        },
      );
      if (error) return failure(error);
      const result = data as Record<string, unknown>;
      if (method === "pay_link" && token && !result.replayed) {
        const booking = result.booking as Record<string, unknown>;
        result.payUrl = `${returnOrigin(env)}/visit/${booking.groupId}#t=${token}`;
      }
      return json(200, { kind: "success", data: result });
    }

    if (action === "undo") {
      const logId = str(body.logId);
      if (!UUID.test(logId)) return json(400, { code: "invalid_request" });
      const { data, error } = await client.rpc("issue_4490_check_in_undo", {
        p_venue_id: venueId,
        p_log_id: logId,
        p_scanner_user_id: userId,
      });
      return error ? failure(error) : json(200, { kind: "success", data });
    }

    if (action === "sell") {
      const offeringId = str(body.offeringId);
      const method = str(body.method);
      const key = str(body.idempotencyKey);
      if (
        !UUID.test(offeringId) ||
        !["cash", "transfer", "pay_link"].includes(method) ||
        !KEY.test(key) || !Array.isArray(body.lines) ||
        (body.buyer !== undefined &&
          (typeof body.buyer !== "object" || Array.isArray(body.buyer)))
      ) {
        return json(400, { code: "invalid_request" });
      }
      let groupId: string | null = null;
      let token: string | null = null;
      if (method === "pay_link") {
        groupId = (deps.newGroupId ?? (() => crypto.randomUUID()))();
        token =
          (await (deps.issueToken ?? issueVenueOfferBookingToken)({ groupId }))
            .token;
      }
      const { data, error } = await client.rpc("issue_4490_gate_sale", {
        p_venue_id: venueId,
        p_offering_id: offeringId,
        p_lines: body.lines,
        p_method: method,
        p_buyer: body.buyer ?? {},
        p_idempotency_key: key,
        p_scanner_user_id: userId,
        p_group_id: groupId,
        p_buyer_token_hash: token
          ? `\\x${await venueOfferTokenHashHex(token)}`
          : null,
      });
      if (error) return failure(error);
      const result = data as Record<string, unknown>;
      if (method === "pay_link" && token && !result.replayed) {
        // The guest scans this on the staff device and pays on their phone.
        // The token rides in the fragment, which never reaches a server log.
        const booking = result.booking as Record<string, unknown>;
        result.payUrl = `${
          returnOrigin(env)
        }/visit/${booking.groupId}#t=${token}`;
      }
      return json(200, { kind: "success", data: result });
    }

    if (action === "take_balance") {
      const groupId = str(body.groupId);
      const method = str(body.method);
      const key = str(body.idempotencyKey);
      const amount = body.amountMinor;
      if (
        !UUID.test(groupId) || !KEY.test(key) ||
        !["cash", "transfer", "card_at_venue", "other"].includes(method) ||
        !Number.isSafeInteger(amount) || Number(amount) < 1
      ) {
        return json(400, { code: "invalid_request" });
      }
      const { data, error } = await client.rpc(
        "issue_4490_record_offline_payment_for",
        {
          p_user_id: userId,
          p_group_id: groupId,
          p_amount_minor: amount,
          p_method: method,
          p_idempotency_key: key,
        },
      );
      return error ? failure(error) : json(200, { kind: "success", data });
    }

    if (action === "balance_link") {
      const groupId = str(body.groupId);
      if (!UUID.test(groupId)) return json(400, { code: "invalid_request" });
      const { data, error } = await client.rpc("issue_4490_balance_link_info", {
        p_venue_id: venueId,
        p_group_id: groupId,
        p_user_id: userId,
      });
      if (error) return failure(error);
      const info = data as Record<string, unknown>;
      const token = await (deps.rederiveToken ??
        rederiveVenueOfferBookingToken)({
          groupId,
          storedHashHex: typeof info.tokenHashHex === "string"
            ? info.tokenHashHex
            : null,
        });
      // A random (not re-derivable) token cannot be shown again.
      if (!token) return json(409, { code: "balance_link_unavailable" });
      return json(200, {
        kind: "success",
        data: {
          groupId,
          balanceMinor: info.balanceMinor,
          currencyCode: info.currencyCode,
          payUrl: `${returnOrigin(env)}/visit/${groupId}#t=${token}`,
        },
      });
    }

    return json(400, { code: "invalid_request" });
  };
}

if (import.meta.main) {
  serve(createVenueCheckInHandler());
}
