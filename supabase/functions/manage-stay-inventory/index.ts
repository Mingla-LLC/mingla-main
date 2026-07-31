import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actions = new Set([
  "get",
  "save_settings",
  "publish_stay",
  "create_offering",
  "update_offering",
  "replace_units",
  "change_status",
  "set_policy",
  "set_price",
  "replace_fees",
  "attach_media",
  "reorder_media",
  "remove_media",
  "bulk_create",
  "upsert_room_nights",
  "upsert_place_schedule",
  "materialize_place_windows",
  "upsert_place_windows",
  "resolve_currency_reconciliation",
]);
const MAX_REQUEST_BYTES = 1_048_576;

type RequestBody = {
  action?: string;
  venueId?: string;
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

export type ManageStayInventoryDependencies = {
  createRpcClient?: (
    url: string,
    anonKey: string,
    authHeader: string,
  ) => RpcClient;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(
  error: RpcError,
  requestId: string,
): Response {
  const raw = error.message ?? "internal_error";
  const known = [
    "unauthorized",
    "forbidden",
    "stay_venue_not_found",
    "stay_offering_not_found",
    "stay_room_not_found",
    "stay_place_not_found",
    "stay_media_not_found",
    "stay_schedule_rule_not_found",
    "reconciliation_not_found",
    "stay_version_conflict",
    "stay_media_set_changed",
    "stay_money_set_changed",
    "currency_reconciliation_required",
    "stay_currency_reconciliation_required",
    "paid_currency_not_ready",
    "stay_publish_incomplete",
    "stay_live_cover_required",
    "stay_currency_required",
    "currency_mismatch",
    "stay_invalid_offering_kind",
    "stay_invalid_inventory_mode",
    "stay_invalid_inventory_basis",
    "stay_media_object_invalid",
    "stay_named_unit_not_allowed",
    "stay_unit_quantity_exceeded",
    "stay_units_require_archive",
    "stay_settings_required",
    "stay_authoring_disabled",
    "stay_venue_not_approved",
    "stay_date_outside_horizon",
    "stay_place_window_not_found",
    "stay_idempotency_conflict",
    "stay_invalid_bulk_request",
    "stay_invalid_action",
    "stay_date_range_too_large",
    "stay_dst_gap",
    "stay_dst_fold",
    "fx_snapshot_stale",
    "fx_unavailable",
  ].find((code) => raw.includes(code));
  const code = known ?? "internal_error";
  const status = code === "unauthorized"
    ? 401
    : code === "forbidden"
    ? 403
    : code.endsWith("_not_found")
    ? 404
    : [
        "stay_version_conflict",
        "stay_media_set_changed",
        "stay_money_set_changed",
        "stay_idempotency_conflict",
        "currency_reconciliation_required",
        "stay_currency_reconciliation_required",
        "paid_currency_not_ready",
        "stay_publish_incomplete",
        "stay_live_cover_required",
        "stay_authoring_disabled",
        "stay_venue_not_approved",
      ].includes(code)
    ? 409
    : code === "fx_unavailable"
    ? 503
    : code === "internal_error"
    ? 500
    : 422;

  if (status === 500) {
    console.error(JSON.stringify({
      event: "stay_inventory_failure",
      code,
      dbCode: error.code ?? null,
      requestId,
    }));
  }
  return json(status, {
    kind: "error",
    code,
    message: status === 500
      ? "We couldn’t update this Stay. Try again."
      : code.replaceAll("_", " "),
    requestId,
  });
}

export async function handleManageStayInventory(
  req: Request,
  dependencies: ManageStayInventoryDependencies = {},
): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
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
      message: "Sign in to manage this Stay.",
      requestId,
    });
  }

  let body: RequestBody;
  try {
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return json(413, {
        kind: "error",
        code: "request_too_large",
        message: "This Stay update is too large.",
        requestId,
      });
    }
    body = JSON.parse(rawBody) as RequestBody;
  } catch {
    return json(400, {
      kind: "error",
      code: "invalid_json",
      message: "The request could not be read.",
      requestId,
    });
  }
  if (
    !body.action ||
    !actions.has(body.action) ||
    !body.venueId ||
    !UUID.test(body.venueId) ||
    (
      body.expectedVersion !== undefined &&
      body.expectedVersion !== null &&
      (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1)
    ) ||
    hasUnsafeNumber(body.payload)
  ) {
    return json(422, {
      kind: "error",
      code: "invalid_request",
      message: "Choose a valid Stay and action.",
      requestId,
    });
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anonKey) {
    return json(500, {
      kind: "error",
      code: "internal_error",
      message: "Stay management is unavailable.",
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

  const { data, error } = body.action === "publish_stay"
    ? await client.rpc("biz_publish_stay", {
      p_venue_id: body.venueId,
      p_expected_version: body.expectedVersion ?? null,
      p_request_id: requestId,
    })
    : body.action === "save_settings"
    ? await client.rpc("biz_save_stay_settings_v2", {
      p_venue_id: body.venueId,
      p_payload: body.payload ?? {},
      p_expected_version: body.expectedVersion ?? null,
      p_request_id: requestId,
    })
    : await client.rpc("biz_manage_stay_inventory", {
      p_action: body.action,
      p_venue_id: body.venueId,
      p_payload: body.payload ?? {},
      p_expected_version: body.expectedVersion ?? null,
      p_request_id: requestId,
    });
  if (error) return errorResponse(error, requestId);

  console.info(JSON.stringify({
    event: "stay_inventory_managed",
    action: body.action,
    venueId: body.venueId,
    requestId,
  }));
  return json(200, { kind: "success", data, requestId });
}

if (import.meta.main) {
  Deno.serve((req) => handleManageStayInventory(req));
}
