import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  jsonResponse,
  serviceClient,
  userClient,
} from "../_shared/ticketCheckout.ts";
import { chargeInstallment } from "../_shared/installments/chargeInstallment.ts";

interface ManualChargeBody {
  installmentId?: unknown;
  atRiskOverride?: unknown;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return jsonResponse({ ok: true });
  }
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: ManualChargeBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json_body" }, 400);
  }

  if (
    typeof body.installmentId !== "string" ||
    !UUID_REGEX.test(body.installmentId)
  ) {
    return jsonResponse({ ok: false, error: "invalid_installment_id" }, 400);
  }

  const atRiskOverride = body.atRiskOverride === true;
  const { data, error } = await userClient(req).rpc(
    "biz_manual_charge_installment",
    {
      p_installment_id: body.installmentId,
      p_atrisk_override: atRiskOverride,
    },
  );

  if (error !== null) {
    return jsonResponse(
      { ok: false, error: `manual_charge_rpc_failed:${error.message}` },
      500,
    );
  }

  const rpc = (data ?? {}) as Record<string, unknown>;
  if (rpc.ok !== true) {
    const reason = typeof rpc.reason === "string" ? rpc.reason : "unknown";
    return jsonResponse({ ok: false, error: reason }, 409);
  }

  const result = await chargeInstallment({
    supabase: serviceClient(),
    installmentId: body.installmentId,
    trigger: "manual",
    atRiskOverride,
  });
  return jsonResponse({
    ok: true,
    outcome: result.outcome,
    ...(result.chargeId ? { chargeId: result.chargeId } : {}),
  });
});
