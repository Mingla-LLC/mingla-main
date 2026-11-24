// #4490 venue-offer-staff — the venue answers hire requests and blocks spaces.
//
// POST { action, ... } with the staff member's user JWT. The handler verifies
// the user and calls service-only RPCs that check, in the database, that this
// user may manage the venue's bookings (venue.manage_bookings, or brand rank
// >= event_manager); editing the price also needs money rights. Every write
// takes an idempotency key; a repeat with the same key returns the first
// result (`replayed: true`).
//
//   approve       { groupId, expectedVersion, idempotencyKey,
//                   quoteEdit?: { baseMinor, note? }, note? }
//   decline       { groupId, expectedVersion, idempotencyKey, reason,
//                   alternatives?: ["YYYY-MM-DD", ...up to 3] }
//   queue         { groupId, expectedVersion, idempotencyKey }
//   extend_hold   { groupId, expectedVersion, idempotencyKey, hours: 12|24|48 }
//   release_hold  { groupId, expectedVersion, idempotencyKey, reason? }
//   block         { venueId, idempotencyKey, from, to, reason?,
//                   spaceIds?: [uuid] | combinationId?: uuid }
//   unblock       { venueId, idempotencyKey, claimId }
//
// Reads (requests list, calendar, next free dates, booking detail) are
// authenticated PostgREST RPCs; they need no function.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REQUEST_ACTIONS = new Set([
  "approve",
  "decline",
  "queue",
  "extend_hold",
  "release_hold",
]);

// Codes the Host may show (each maps to plain words in the Host app).
const SAFE_CODES = [
  "not_authorized",
  "offers_not_enabled",
  "offer_booking_not_found",
  "offer_invalid_transition",
  "offer_invalid_payload",
  "offer_hold_expired",
  "offer_hold_not_extendable",
  "offer_window_unavailable",
  "offer_space_taken",
  "offer_capacity_conflict",
  "offer_queue_not_needed",
  "offer_payment_already_pending",
  "offer_idempotency_conflict",
  "quote_edit_invalid",
  "decline_reason_required",
  "extend_hours_invalid",
  "block_spaces_invalid",
  "block_range_invalid",
  "block_not_found",
  "stale_write",
];

type RpcError = { message?: string; code?: string; details?: string };
export type StaffClient = {
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

export type VenueOfferStaffDeps = {
  client?: () => StaffClient;
  env?: (name: string) => string | undefined;
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
    "staff_action_failed";
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
    case "P0001":
      return 422;
    default:
      return 500;
  }
}

function failure(error: RpcError): Response {
  const code = safeCode(error);
  const body: Record<string, unknown> = { code };
  if (code === "offer_capacity_conflict" && error.details) {
    // { localDate, poolName, sold, limitAfterHire }: "60 have entry that day;
    // the hire would leave room for 50".
    try {
      const detail = JSON.parse(error.details);
      if (detail && typeof detail === "object") body.detail = detail;
    } catch {
      // optional
    }
  }
  return json(code === "staff_action_failed" ? 500 : statusFor(error), body);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const isJson = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The request action payload, or null when the body is malformed. */
export function requestPayload(
  action: string,
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  if (action === "approve") {
    const payload: Record<string, unknown> = {};
    if (body.quoteEdit !== undefined && body.quoteEdit !== null) {
      if (!isJson(body.quoteEdit)) return null;
      const base = body.quoteEdit.baseMinor;
      if (!Number.isSafeInteger(base) || Number(base) < 0) return null;
      const note = body.quoteEdit.note;
      if (
        note !== undefined && (typeof note !== "string" || note.length > 500)
      ) {
        return null;
      }
      payload.quoteEdit = { baseMinor: base, ...(note ? { note } : {}) };
    }
    if (body.note !== undefined) {
      if (typeof body.note !== "string" || body.note.length > 500) return null;
      payload.note = body.note;
    }
    return payload;
  }
  if (action === "decline") {
    const reason = str(body.reason).trim();
    const alternatives = body.alternatives ?? [];
    if (
      reason.length < 3 || reason.length > 500 ||
      !Array.isArray(alternatives) ||
      alternatives.length > 3 ||
      !alternatives.every((d) => typeof d === "string" && DATE.test(d))
    ) {
      return null;
    }
    return { reason, alternatives };
  }
  if (action === "extend_hold") {
    return [12, 24, 48].includes(Number(body.hours))
      ? { hours: Number(body.hours) }
      : null;
  }
  if (action === "release_hold") {
    const reason = str(body.reason).trim();
    if (reason.length > 500) return null;
    return reason ? { reason } : {};
  }
  return {}; // queue
}

/**
 * The only environment names this function reads, each read literally so the
 * function secret contract can attribute them (#2241). Tests inject `deps.env`.
 */
function runtimeEnv(name: string): string | undefined {
  switch (name) {
    case "SUPABASE_SERVICE_ROLE_KEY":
      return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    case "SUPABASE_URL":
      return Deno.env.get("SUPABASE_URL");
    default:
      return undefined;
  }
}

export function createVenueOfferStaffHandler(deps: VenueOfferStaffDeps = {}) {
  const env = deps.env ?? runtimeEnv;
  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") return json(405, { code: "method_not_allowed" });
    const jwt = (req.headers.get("authorization") ?? "").replace(
      /^Bearer\s+/i,
      "",
    ).trim();
    if (!jwt) return json(401, { code: "auth_required" });

    let client: StaffClient;
    if (deps.client) {
      client = deps.client();
    } else {
      const url = env("SUPABASE_URL") ?? "";
      const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      if (!url || !serviceKey) return json(500, { code: "unavailable" });
      client = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      }) as unknown as StaffClient;
    }
    const { data: userData, error: userError } = await client.auth.getUser(jwt);
    const userId = userData?.user?.id ?? null;
    if (userError || !userId) return json(401, { code: "auth_required" });

    const body = await req.json().catch(() => null) as
      | Record<string, unknown>
      | null;
    const action = str(body?.action);
    if (!body) return json(400, { code: "invalid_request" });
    const key = str(body.idempotencyKey);

    if (REQUEST_ACTIONS.has(action)) {
      const groupId = str(body.groupId);
      const expectedVersion = body.expectedVersion;
      const payload = requestPayload(action, body);
      if (
        !UUID.test(groupId) || !KEY.test(key) || payload === null ||
        !Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1
      ) {
        return json(400, { code: "invalid_request" });
      }
      const { data, error } = await client.rpc(
        "issue_4490_manage_request_for",
        {
          p_user_id: userId,
          p_group_id: groupId,
          p_action: action,
          p_payload: payload,
          p_expected_version: expectedVersion,
          p_idempotency_key: key,
        },
      );
      return error ? failure(error) : json(200, { kind: "success", data });
    }

    if (action === "block" || action === "unblock") {
      const venueId = str(body.venueId);
      if (!UUID.test(venueId) || !KEY.test(key)) {
        return json(400, { code: "invalid_request" });
      }
      let payload: Record<string, unknown>;
      if (action === "block") {
        const from = str(body.from);
        const to = str(body.to);
        const spaceIds = body.spaceIds;
        const combinationId = body.combinationId;
        const reason = body.reason;
        const spacesOk = Array.isArray(spaceIds) && spaceIds.length >= 1 &&
          spaceIds.length <= 20 && spaceIds.every((s) => UUID.test(str(s)));
        const comboOk = typeof combinationId === "string" &&
          UUID.test(combinationId);
        if (
          spacesOk === comboOk || Number.isNaN(Date.parse(from)) ||
          Number.isNaN(Date.parse(to)) ||
          (reason !== undefined &&
            (typeof reason !== "string" || reason.length > 200))
        ) {
          return json(400, { code: "invalid_request" });
        }
        payload = {
          from,
          to,
          ...(spacesOk ? { spaceIds } : { combinationId }),
          ...(typeof reason === "string" && reason.trim()
            ? { reason: reason.trim() }
            : {}),
        };
      } else {
        const claimId = str(body.claimId);
        if (!UUID.test(claimId)) return json(400, { code: "invalid_request" });
        payload = { claimId };
      }
      const { data, error } = await client.rpc("issue_4490_manage_block_for", {
        p_user_id: userId,
        p_venue_id: venueId,
        p_action: action,
        p_payload: payload,
        p_idempotency_key: key,
      });
      return error ? failure(error) : json(200, { kind: "success", data });
    }

    return json(400, { code: "invalid_request" });
  };
}

if (import.meta.main) {
  serve(createVenueOfferStaffHandler());
}
