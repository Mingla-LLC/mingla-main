import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  createStayPaymentSession,
  type PreparedStayPayment,
} from "../_shared/stayPaymentProvider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS_PER_TOKEN = 30;
const tokenWindows = new Map<string, { count: number; resetAt: number }>();

type RpcError = { message?: string };
type RpcClient = {
  rpc: (
    name: string,
    params: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: RpcError | null }>;
};

export type StayStaffPaymentLinkDependencies = {
  createServiceRpcClient?: (url: string, serviceKey: string) => RpcClient;
  createPaymentSession?: typeof createStayPaymentSession;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function tokenHash(token: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  return `\\x${
    [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  }`;
}

function safeCode(error: { message?: string } | null): string {
  const message = error?.message ?? "";
  return [
    "stay_payment_link_not_found",
    "stay_payment_link_expired",
    "stay_payment_link_not_actionable",
    "stay_version_conflict",
    "stay_inventory_changed",
    "stay_bank_not_ready",
    "stay_rail_not_enabled",
    "stay_payment_ambiguous",
  ].find((code) => message.includes(code)) ?? "stay_payment_link_failed";
}

function isRateLimited(hash: string): boolean {
  const now = Date.now();
  const current = tokenWindows.get(hash);
  if (!current || current.resetAt <= now) {
    tokenWindows.set(hash, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_TOKEN;
}

export async function handleStayStaffPaymentLink(
  req: Request,
  dependencies: StayStaffPaymentLinkDependencies = {},
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json(405, { code: "method_not_allowed" });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = body.action;
  const token = typeof body.token === "string" ? body.token : "";
  if (!TOKEN.test(token) || !["view", "pay"].includes(String(action))) {
    return json(400, { code: "invalid_request" });
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return json(500, { code: "unavailable" });
  const service = dependencies.createServiceRpcClient?.(url, serviceKey) ??
    createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as unknown as RpcClient;
  const hash = await tokenHash(token);
  if (isRateLimited(hash)) return json(429, { code: "rate_limited" });
  if (action === "view") {
    const { data, error } = await service.rpc(
      "issue_4188_staff_payment_link_details",
      { p_token_hash: hash },
    );
    if (error) {
      const code = safeCode(error);
      return json(code.endsWith("not_found") ? 404 : 409, { code });
    }
    return json(200, { kind: "success", data });
  }

  const idempotencyKey = typeof body.idempotencyKey === "string"
    ? body.idempotencyKey
    : "";
  const expectedVersion = body.expectedVersion;
  if (
    !KEY.test(idempotencyKey) || !Number.isSafeInteger(expectedVersion) ||
    Number(expectedVersion) < 1
  ) {
    return json(400, { code: "invalid_request" });
  }
  const requestId = crypto.randomUUID();
  const { data: prepared, error: prepareError } = await service.rpc(
    "issue_4188_prepare_staff_link_payment",
    {
      p_token_hash: hash,
      p_idempotency_key: idempotencyKey,
      p_expected_group_version: expectedVersion,
      p_request_id: requestId,
    },
  );
  if (prepareError) return json(409, { code: safeCode(prepareError) });
  try {
    const session = await (dependencies.createPaymentSession ??
      createStayPaymentSession)(
        prepared as PreparedStayPayment,
        idempotencyKey,
      );
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
      return json(502, { code: "stay_payment_ambiguous" });
    }
    return json(200, { kind: "success", data: session });
  } catch (providerError) {
    const providerCode = providerError instanceof Error
      ? providerError.message
      : String(providerError);
    if (
      providerCode === "stay_payment_already_pending" ||
      providerCode === "stay_payment_resume_unavailable"
    ) {
      return json(
        providerCode === "stay_payment_already_pending" ? 409 : 503,
        { code: providerCode },
      );
    }
    const attemptId = prepared && typeof prepared === "object"
      ? String((prepared as Record<string, unknown>).attemptId ?? "")
      : "";
    if (attemptId) {
      await service.rpc("issue_1389_record_payment_create_failure", {
        p_attempt_id: attemptId,
        p_failure_code: "provider_create_ambiguous",
        p_ambiguous: true,
      });
    }
    return json(502, { code: "stay_payment_ambiguous" });
  }
}

export function resetStayStaffPaymentLinkRateLimitForTests(): void {
  tokenWindows.clear();
}

if (import.meta.main) {
  serve((req) => handleStayStaffPaymentLink(req));
}
