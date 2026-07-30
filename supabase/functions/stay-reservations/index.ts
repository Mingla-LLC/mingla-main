import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  createStayPaymentSession,
  type PreparedStayPayment,
  type StayPaymentSession,
} from "../_shared/stayPaymentProvider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const actions = new Set([
  "quote",
  "create_group",
  "approve_request",
  "decline_request",
  "get_group",
  "create_payment",
  "cancel_preview",
  "cancel",
]);
const MAX_REQUEST_BYTES = 262_144;

type RequestBody = {
  action?: string;
  payload?: Record<string, unknown>;
  expectedVersion?: number | null;
};

type RpcError = { message?: string; code?: string };
type RpcClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: RpcError | null }>;
};

export type StayReservationsDependencies = {
  createRpcClient?: (
    url: string,
    anonKey: string,
    authHeader: string,
  ) => RpcClient;
  createServiceRpcClient?: (
    url: string,
    serviceKey: string,
  ) => RpcClient;
  createPaymentSession?: (
    prepared: PreparedStayPayment,
    idempotencyKey: string,
  ) => Promise<StayPaymentSession>;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function hasUnsafeNumber(value: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (typeof value === "number") return !Number.isSafeInteger(value);
  if (Array.isArray(value)) {
    return value.some((item) => hasUnsafeNumber(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((item) =>
      hasUnsafeNumber(item, depth + 1)
    );
  }
  return false;
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_KEY.test(value);
}

function validPayload(value: unknown): value is RequestBody {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const body = value as RequestBody;
  if (
    !body.action ||
    !actions.has(body.action) ||
    !body.payload ||
    typeof body.payload !== "object" ||
    Array.isArray(body.payload) ||
    hasUnsafeNumber(body.payload) ||
    (
      body.expectedVersion !== undefined &&
      body.expectedVersion !== null &&
      (
        !Number.isSafeInteger(body.expectedVersion) ||
        body.expectedVersion < 1
      )
    )
  ) {
    return false;
  }
  const payload = body.payload;
  if (body.action === "quote") {
    return typeof payload.venueId === "string" &&
      UUID.test(payload.venueId) &&
      validKey(payload.idempotencyKey) &&
      Array.isArray(payload.lines) &&
      payload.lines.length >= 1 &&
      payload.lines.length <= 50;
  }
  if (body.action === "create_group") {
    return typeof payload.quoteId === "string" &&
      UUID.test(payload.quoteId) &&
      validKey(payload.idempotencyKey) &&
      body.expectedVersion !== undefined &&
      body.expectedVersion !== null &&
      !!payload.guest &&
      typeof payload.guest === "object" &&
      !Array.isArray(payload.guest);
  }
  if (
    body.action === "approve_request" ||
    body.action === "decline_request"
  ) {
    return typeof payload.groupId === "string" &&
      UUID.test(payload.groupId) &&
      validKey(payload.idempotencyKey) &&
      body.expectedVersion !== undefined &&
      body.expectedVersion !== null;
  }
  if (body.action === "create_payment") {
    return typeof payload.groupId === "string" &&
      UUID.test(payload.groupId) &&
      validKey(payload.idempotencyKey) &&
      body.expectedVersion !== undefined &&
      body.expectedVersion !== null;
  }
  if (body.action === "cancel_preview") {
    return typeof payload.groupId === "string" &&
      UUID.test(payload.groupId) &&
      Array.isArray(payload.selectedLineIds) &&
      payload.selectedLineIds.length >= 1 &&
      payload.selectedLineIds.length <= 50 &&
      payload.selectedLineIds.every((id) =>
        typeof id === "string" && UUID.test(id)
      ) &&
      body.expectedVersion !== undefined &&
      body.expectedVersion !== null;
  }
  if (body.action === "cancel") {
    return typeof payload.previewId === "string" &&
      UUID.test(payload.previewId) &&
      typeof payload.previewHash === "string" &&
      /^[a-f0-9]{64}$/.test(payload.previewHash) &&
      validKey(payload.idempotencyKey) &&
      typeof payload.reason === "string" &&
      payload.reason.trim().length >= 3 &&
      payload.reason.trim().length <= 500;
  }
  return typeof payload.groupId === "string" &&
    UUID.test(payload.groupId);
}

function errorResponse(error: RpcError, requestId: string): Response {
  const raw = error.message ?? "internal_error";
  const known = [
    "unauthorized",
    "forbidden",
    "stay_venue_not_found",
    "stay_offering_not_found",
    "stay_quote_not_found",
    "stay_group_not_found",
    "stay_invalid_payload",
    "stay_invalid_action",
    "stay_invalid_room_allocation",
    "stay_invalid_place_allocation",
    "stay_duplicate_cart_line",
    "stay_room_dates_must_match",
    "stay_date_outside_horizon",
    "stay_dependent_place_requires_room",
    "stay_reservations_unavailable",
    "stay_bank_not_ready",
    "stay_currency_mismatch",
    "stay_money_out_of_range",
    "stay_quote_expired",
    "stay_version_conflict",
    "stay_inventory_changed",
    "stay_invalid_transition",
    "stay_idempotency_conflict",
    "stay_rail_not_enabled",
    "stay_payment_not_found",
    "stay_payment_ambiguous",
    "stay_cancel_preview_invalid",
    "stay_cancel_preview_expired",
  ].find((code) => raw.includes(code));
  const code = known ?? "internal_error";
  const status = code === "unauthorized"
    ? 401
    : code === "forbidden"
    ? 403
    : code.endsWith("_not_found")
    ? 404
    : [
        "stay_quote_expired",
        "stay_version_conflict",
        "stay_inventory_changed",
        "stay_invalid_transition",
        "stay_idempotency_conflict",
        "stay_reservations_unavailable",
        "stay_bank_not_ready",
        "stay_currency_mismatch",
        "stay_rail_not_enabled",
        "stay_payment_ambiguous",
      ].includes(code)
    ? 409
    : code === "internal_error"
    ? 500
    : 422;
  if (status === 500) {
    console.error(JSON.stringify({
      event: "stay_reservation_failure",
      code,
      dbCode: error.code ?? null,
      requestId,
    }));
  }
  return json(status, {
    kind: "error",
    code,
    message: status === 500
      ? "We couldn’t complete this Stay reservation. Try again."
      : code.replaceAll("_", " "),
    requestId,
  });
}

export async function handleStayReservations(
  req: Request,
  dependencies: StayReservationsDependencies = {},
): Promise<Response> {
  const suppliedRequestId = req.headers.get("x-request-id");
  const requestId = suppliedRequestId && UUID.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, {
      kind: "error",
      code: "method_not_allowed",
      requestId,
    });
  }
  const authHeader = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+.+$/i.test(authHeader)) {
    return json(401, {
      kind: "error",
      code: "unauthorized",
      message: "Sign in to reserve this Stay.",
      requestId,
    });
  }

  let body: unknown;
  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return json(413, {
        kind: "error",
        code: "request_too_large",
        message: "This Stay cart is too large.",
        requestId,
      });
    }
    body = JSON.parse(rawBody);
  } catch {
    return json(400, {
      kind: "error",
      code: "invalid_json",
      message: "The request could not be read.",
      requestId,
    });
  }
  if (!validPayload(body)) {
    return json(422, {
      kind: "error",
      code: "invalid_request",
      message: "Check the Stay reservation details.",
      requestId,
    });
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anonKey) {
    return json(500, {
      kind: "error",
      code: "internal_error",
      message: "Stay reservations are unavailable.",
      requestId,
    });
  }
  const client = dependencies.createRpcClient?.(
    url,
    anonKey,
    authHeader,
  ) ?? createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  }) as unknown as RpcClient;
  const payload = body.payload as Record<string, unknown>;

  if (body.action === "create_payment") {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!serviceKey) {
      return json(500, {
        kind: "error",
        code: "internal_error",
        message: "Stay payments are unavailable.",
        requestId,
      });
    }
    const service = dependencies.createServiceRpcClient?.(
      url,
      serviceKey,
    ) ?? createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as unknown as RpcClient;
    const { data: prepared, error: prepareError } = await client.rpc(
      "issue_1389_prepare_payment",
      {
        p_group_id: payload.groupId,
        p_idempotency_key: payload.idempotencyKey,
        p_expected_group_version: body.expectedVersion,
        p_request_id: requestId,
      },
    );
    if (prepareError) return errorResponse(prepareError, requestId);

    let session: StayPaymentSession;
    try {
      session = await (
        dependencies.createPaymentSession ?? createStayPaymentSession
      )(
        prepared as PreparedStayPayment,
        String(payload.idempotencyKey),
      );
    } catch (providerError) {
      const attemptId = String(
        (prepared as PreparedStayPayment)?.attemptId ?? "",
      );
      if (UUID.test(attemptId)) {
        await service.rpc("issue_1389_record_payment_create_failure", {
          p_attempt_id: attemptId,
          p_failure_code: "provider_create_ambiguous",
          p_ambiguous: true,
        });
      }
      console.error(JSON.stringify({
        event: "stay_payment_provider_create_failed",
        requestId,
        message: providerError instanceof Error
          ? providerError.message
          : String(providerError),
      }));
      return json(502, {
        kind: "error",
        code: "stay_payment_ambiguous",
        message:
          "We couldn’t confirm the payment session. No retry will be made automatically.",
        requestId,
      });
    }
    const { error: bindError } = await service.rpc(
      "issue_1389_bind_payment_attempt",
      {
        p_attempt_id: session.attemptId,
        p_provider_payment_ref: session.providerPaymentRef,
        p_provider_charge_ref: null,
        p_request_id: requestId,
      },
    );
    if (bindError) {
      await service.rpc("issue_1389_record_payment_create_failure", {
        p_attempt_id: session.attemptId,
        p_failure_code: "provider_binding_ambiguous",
        p_ambiguous: true,
      });
      return errorResponse(bindError, requestId);
    }
    return json(200, { kind: "success", data: session, requestId });
  }

  if (body.action === "cancel_preview") {
    const { data, error } = await client.rpc("issue_1389_cancel_preview", {
      p_group_id: payload.groupId,
      p_selected_line_ids: payload.selectedLineIds,
      p_expected_group_version: body.expectedVersion,
      p_request_id: requestId,
    });
    if (error) return errorResponse(error, requestId);
    return json(200, { kind: "success", data, requestId });
  }

  if (body.action === "cancel") {
    const { data, error } = await client.rpc("issue_1389_cancel", {
      p_preview_id: payload.previewId,
      p_preview_hash: payload.previewHash,
      p_idempotency_key: payload.idempotencyKey,
      p_reason: payload.reason,
      p_request_id: requestId,
    });
    if (error) return errorResponse(error, requestId);
    return json(200, { kind: "success", data, requestId });
  }

  const { data, error } = await client.rpc("biz_manage_stay_reservation", {
    p_action: body.action,
    p_payload: body.payload,
    p_expected_version: body.expectedVersion ?? null,
    p_request_id: requestId,
  });
  if (error) return errorResponse(error, requestId);

  console.info(JSON.stringify({
    event: "stay_reservation_action",
    action: body.action,
    requestId,
  }));
  return json(200, { kind: "success", data, requestId });
}

if (import.meta.main) {
  Deno.serve((req) => handleStayReservations(req));
}
