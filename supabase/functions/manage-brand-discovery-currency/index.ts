import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Action =
  | "get_state"
  | "set_provisional_currency"
  | "preview_reconciliation"
  | "resolve_reconciliation"
  | "save_discovery_price_range";

type RequestBody = {
  action?: Action;
  brandId?: string;
  currencyCode?: string;
  expectedStateVersion?: number;
  reconciliationId?: string;
  decision?: "convert" | "reenter" | "accept_no_ranges";
  fxSnapshotId?: string | null;
  ranges?: unknown[];
  venueId?: string;
  placePoolId?: string;
  sourceMinMinor?: number;
  sourceMaxMinor?: number | null;
  expectedVersion?: number | null;
  reason?: string;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mapRpcError(
  error: { message?: string; code?: string },
  requestId: string,
): Response {
  const raw = error.message ?? "internal_error";
  const known = [
    "unauthorized",
    "forbidden",
    "brand_not_found",
    "reconciliation_not_found",
    "currency_already_set",
    "currency_reconciliation_required",
    "range_version_conflict",
    "range_set_changed",
    "paid_currency_not_ready",
    "unsupported_currency",
    "invalid_range",
    "currency_mismatch",
    "fx_snapshot_stale",
    "incomplete_reentry",
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
        "currency_already_set",
        "currency_reconciliation_required",
        "range_version_conflict",
        "range_set_changed",
        "paid_currency_not_ready",
      ].includes(code)
    ? 409
    : [
        "unsupported_currency",
        "invalid_range",
        "currency_mismatch",
        "fx_snapshot_stale",
        "incomplete_reentry",
      ].includes(code)
    ? 422
    : code === "fx_unavailable"
    ? 503
    : 500;
  if (status === 500) {
    console.error(JSON.stringify({
      event: "brand_discovery_currency_failure",
      code,
      dbCode: error.code ?? null,
      requestId,
    }));
  }
  return json(status, {
    kind: "error",
    code,
    message: status === 500
      ? "We couldn’t update the brand currency. Try again."
      : code.replaceAll("_", " "),
    requestId,
  });
}

export async function handleManageBrandCurrency(req: Request): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json(405, { kind: "error", code: "method_not_allowed", requestId });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.match(/^Bearer\s+.+$/i)) {
    return json(401, {
      kind: "error",
      code: "unauthorized",
      message: "Sign in to continue.",
      requestId,
    });
  }

  let body: RequestBody;
  try {
    body = await req.json() as RequestBody;
  } catch {
    return json(400, {
      kind: "error",
      code: "invalid_json",
      message: "The request could not be read.",
      requestId,
    });
  }
  if (!body.action || !body.brandId || !UUID.test(body.brandId)) {
    return json(422, {
      kind: "error",
      code: "invalid_request",
      message: "Choose a valid brand.",
      requestId,
    });
  }

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!url || !anonKey) {
    return json(500, {
      kind: "error",
      code: "internal_error",
      message: "Currency service is unavailable.",
      requestId,
    });
  }
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let rpcName = "";
  let params: Record<string, unknown> = {};
  switch (body.action) {
    case "get_state":
      rpcName = "issue_1384_brand_currency_state";
      params = { p_brand_id: body.brandId };
      break;
    case "set_provisional_currency":
      rpcName = "issue_1384_set_provisional_currency";
      params = {
        p_brand_id: body.brandId,
        p_currency_code: body.currencyCode,
        p_expected_state_version: body.expectedStateVersion,
      };
      break;
    case "preview_reconciliation":
      rpcName = "issue_1384_preview_reconciliation";
      params = {
        p_brand_id: body.brandId,
        p_reconciliation_id: body.reconciliationId,
      };
      break;
    case "resolve_reconciliation":
      rpcName = "issue_1384_resolve_reconciliation";
      params = {
        p_brand_id: body.brandId,
        p_reconciliation_id: body.reconciliationId,
        p_decision: body.decision,
        p_fx_snapshot_id: body.fxSnapshotId ?? null,
        p_ranges: body.ranges ?? [],
        p_request_id: requestId,
      };
      break;
    case "save_discovery_price_range":
      rpcName = "issue_1384_save_discovery_price_range";
      params = {
        p_brand_id: body.brandId,
        p_venue_id: body.venueId,
        p_place_pool_id: body.placePoolId,
        p_source_min_minor: body.sourceMinMinor,
        p_source_max_minor: body.sourceMaxMinor ?? null,
        p_source_currency_code: body.currencyCode,
        p_expected_version: body.expectedVersion ?? null,
        p_actor_reason: body.reason ?? "business_authored",
        p_request_id: requestId,
      };
      break;
    default: {
      const exhaustive: never = body.action;
      return json(422, {
        kind: "error",
        code: "invalid_action",
        message: `Unsupported action: ${String(exhaustive)}`,
        requestId,
      });
    }
  }

  const { data, error } = await client.rpc(rpcName, params);
  if (error) return mapRpcError(error, requestId);
  console.info(JSON.stringify({
    event: body.action === "set_provisional_currency"
      ? "brand_currency_provisional_set"
      : body.action === "resolve_reconciliation"
      ? "brand_currency_reconciliation_resolved"
      : body.action === "save_discovery_price_range"
      ? "discovery_price_range_updated"
      : "brand_discovery_currency_read",
    brandId: body.brandId,
    requestId,
  }));
  return json(200, { kind: "ok", data, requestId });
}

if (import.meta.main) {
  Deno.serve((req) => handleManageBrandCurrency(req));
}
