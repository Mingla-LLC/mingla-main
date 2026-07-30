import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  constantTimeEqual,
  FX_PROVIDER_URL,
  sha256Hex,
  type SupportedCurrency,
  validateFxProviderPayload,
} from "../_shared/fxRates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requestId(req: Request): string {
  return req.headers.get("x-request-id") ?? crypto.randomUUID();
}

type FxRpcClient = {
  rpc: (
    name: string,
    params?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export type RefreshFxDependencies = {
  createRpcClient?: (
    url: string,
    serviceRoleKey: string,
  ) => FxRpcClient;
};

export async function handleRefreshFxRates(
  req: Request,
  fetchImpl: typeof fetch = fetch,
  dependencies: RefreshFxDependencies = {},
): Promise<Response> {
  const id = requestId(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return response(405, { kind: "error", code: "method_not_allowed", requestId: id });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !(await constantTimeEqual(token, serviceRoleKey))
  ) {
    console.warn(JSON.stringify({
      event: "fx_refresh_failure",
      code: "unauthorized",
      requestId: id,
    }));
    return response(401, {
      kind: "error",
      code: "unauthorized",
      message: "Service authorization required.",
      requestId: id,
    });
  }

  const admin = dependencies.createRpcClient?.(supabaseUrl, serviceRoleKey) ??
    createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as unknown as FxRpcClient;
  const { data: supported, error: supportedError } = await admin.rpc(
    "issue_1384_supported_currencies",
  );
  if (supportedError || !Array.isArray(supported)) {
    console.error(JSON.stringify({
      event: "fx_refresh_failure",
      code: "supported_currency_read_failed",
      requestId: id,
    }));
    return response(500, {
      kind: "error",
      code: "supported_currency_read_failed",
      message: "Currency metadata is unavailable.",
      requestId: id,
    });
  }
  const currencies: SupportedCurrency[] = supported.map((row) => ({
    code: String(row.code),
    minorUnitExponent: Number(row.minor_unit_exponent),
  }));

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 8_000);
  try {
    const providerResponse = await fetchImpl(FX_PROVIDER_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: abortController.signal,
    });
    if (!providerResponse.ok) {
      const code = providerResponse.status === 429
        ? "provider_rate_limited"
        : "provider_http_error";
      console.warn(JSON.stringify({
        event: "fx_refresh_failure",
        code,
        providerStatus: providerResponse.status,
        requestId: id,
      }));
      return response(503, {
        kind: "error",
        code,
        message: "Exchange rates could not be refreshed.",
        requestId: id,
      });
    }

    const raw: unknown = await providerResponse.json();
    const validated = validateFxProviderPayload(raw, currencies, new Date());
    const payloadSha256 = await sha256Hex(validated.canonicalPayload);
    const { data: snapshotId, error: activateError } = await admin.rpc(
      "issue_1384_activate_fx_snapshot",
      {
        p_provider_updated_at: validated.providerUpdatedAt,
        p_provider_next_update_at: validated.providerNextUpdateAt,
        p_provider_eol_at: validated.providerEolAt,
        p_payload_sha256: payloadSha256,
        p_rates: validated.rates,
        p_response_metadata: { requestId: id },
      },
    );
    if (activateError) {
      console.error(JSON.stringify({
        event: "fx_refresh_failure",
        code: "snapshot_activation_failed",
        requestId: id,
      }));
      return response(500, {
        kind: "error",
        code: "snapshot_activation_failed",
        message: "Validated rates could not be activated.",
        requestId: id,
      });
    }

    console.info(JSON.stringify({
      event: "fx_refresh_success",
      snapshotId,
      providerUpdatedAt: validated.providerUpdatedAt,
      requestId: id,
    }));
    return response(200, {
      kind: "ok",
      snapshotId,
      providerUpdatedAt: validated.providerUpdatedAt,
      requestId: id,
    });
  } catch (error) {
    const code = error instanceof DOMException && error.name === "AbortError"
      ? "provider_timeout"
      : "provider_payload_invalid";
    console.warn(JSON.stringify({
      event: "fx_refresh_failure",
      code,
      requestId: id,
    }));
    return response(503, {
      kind: "error",
      code,
      message: "Exchange rates could not be refreshed.",
      requestId: id,
    });
  } finally {
    clearTimeout(timeout);
  }
}

if (import.meta.main) {
  Deno.serve((req) => handleRefreshFxRates(req));
}
