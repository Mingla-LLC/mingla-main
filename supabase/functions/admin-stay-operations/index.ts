import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { paystackVerifyTransaction } from "../_shared/paystack.ts";
import { stripeTicketCheckout } from "../_shared/stripe.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVISIBLE_WS = /[\s\u00A0\u200B\u200C\u200D\u2028\u2029\uFEFF]/g;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RpcResult = { data: unknown; error: { message?: string } | null };
type QueryResult = {
  data: Record<string, unknown> | null;
  error: { message?: string } | null;
};
type ServiceClient = {
  from: (table: string) => unknown;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
};

type AdminContext = {
  userId: string;
  userEmail: string;
  service: ServiceClient;
};

type Dependencies = {
  resolveAdmin?: (authorization: string) => Promise<AdminContext | null>;
  retrieveStripeIntent?: (
    paymentRef: string,
    connectedAccountRef: string,
  ) => Promise<Record<string, unknown>>;
  verifyPaystack?: (reference: string) => Promise<Record<string, unknown>>;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store, private",
    },
  });
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validReason(value: unknown): value is string {
  return typeof value === "string" &&
    value.replace(INVISIBLE_WS, "").length >= 3 && value.length <= 500;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function objectId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (value && typeof value === "object") {
    const id = (value as Record<string, unknown>).id;
    return typeof id === "string" && id.length > 0 ? id : null;
  }
  return null;
}

function safeRpcCode(
  error: { message?: string } | null,
  fallback: string,
): string {
  const message = error?.message ?? "";
  return [
    "stay_inventory_changed",
    "stay_version_conflict",
    "stay_invalid_transition",
    "stay_payment_not_found",
    "stay_alert_evidence_incomplete",
    "stay_alert_not_found",
    "stay_currency_reconciliation_required",
    "stay_bank_not_ready",
  ].find((code) => message.includes(code)) ?? fallback;
}

async function defaultResolveAdmin(
  authorization: string,
): Promise<AdminContext | null> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey || !/^Bearer\s+.+$/i.test(authorization)) return null;
  const token = authorization.replace(/^Bearer\s+/i, "");
  const service = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error } = await service.auth.getUser(token);
  if (error || !user?.id || !user.email) return null;
  const { data: admin } = await service.from("admin_users")
    .select("id,user_id,status").eq("user_id", user.id).eq("status", "active")
    .maybeSingle();
  if (!admin) return null;
  return {
    userId: user.id,
    userEmail: user.email,
    service: service as unknown as ServiceClient,
  };
}

async function defaultRetrieveStripeIntent(
  paymentRef: string,
  connectedAccountRef: string,
): Promise<Record<string, unknown>> {
  const stripe = stripeTicketCheckout();
  // Read-only provider evidence. The PaymentIntent lives on the connected account.
  // orch-strict-grep-allow stripe-no-idempotency-key — retrieval is read-only and cannot duplicate provider state.
  return await stripe.paymentIntents.retrieve(
    paymentRef,
    {},
    { stripeAccount: connectedAccountRef },
  ) as Record<string, unknown>;
}

async function one(
  service: ServiceClient,
  table: string,
  select: string,
  column: string,
  value: string,
): Promise<QueryResult> {
  const query = service.from(table) as {
    select: (columns: string) => {
      eq: (
        key: string,
        val: string,
      ) => { maybeSingle: () => Promise<QueryResult> };
    };
  };
  return await query.select(select).eq(column, value).maybeSingle();
}

async function audit(
  context: AdminContext,
  action: string,
  entityType: string,
  entityId: string,
  reason: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await context.service.rpc("admin_write_audit", {
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_reason: reason,
    p_metadata: metadata,
    p_actor_email: context.userEmail,
    p_actor_uid: context.userId,
  });
  if (error) throw new Error(`audit_failed:${error.message ?? "unknown"}`);
}

async function reconcilePayment(
  context: AdminContext,
  paymentAttemptId: string,
  reason: string,
  requestId: string,
  dependencies: Dependencies,
): Promise<Response> {
  const attemptResult = await one(
    context.service,
    "stay_payment_attempts",
    "id,group_id,provider,connected_account_ref,amount_minor,currency_code,state,provider_payment_ref,provider_charge_ref",
    "id",
    paymentAttemptId,
  );
  if (attemptResult.error) {
    return json(500, { error: "internal_error", requestId });
  }
  const attempt = attemptResult.data;
  if (!attempt) {
    return json(404, { error: "stay_payment_not_found", requestId });
  }
  const provider = String(attempt.provider ?? "");
  const paymentRef = String(attempt.provider_payment_ref ?? "");
  const groupId = String(attempt.group_id ?? "");
  const expectedAmount = Number(attempt.amount_minor);
  const expectedCurrency = String(attempt.currency_code ?? "").toUpperCase();
  if (
    !paymentRef || !UUID.test(groupId) || !Number.isSafeInteger(expectedAmount)
  ) {
    return json(409, { error: "stay_provider_reference_missing", requestId });
  }

  let providerState = "unknown";
  let finalize: Record<string, unknown> | null = null;
  let failureCode: string | null = null;
  let chargeRef: string | null = null;
  if (provider === "stripe") {
    const connectedAccount = String(attempt.connected_account_ref ?? "");
    if (!connectedAccount.startsWith("acct_")) {
      return json(409, { error: "stay_stripe_account_required", requestId });
    }
    let intent: Record<string, unknown>;
    try {
      intent = await (dependencies.retrieveStripeIntent ??
        defaultRetrieveStripeIntent)(
          paymentRef,
          connectedAccount,
        );
    } catch {
      return json(502, { error: "provider_unavailable", requestId });
    }
    const metadata = objectRecord(intent.metadata);
    providerState = String(intent.status ?? "unknown");
    const authorizedAmount = Number(intent.amount ?? intent.amount_received);
    const receivedAmount = Number(intent.amount_received ?? 0);
    const currency = String(intent.currency ?? "").toUpperCase();
    chargeRef = objectId(intent.latest_charge);
    if (
      String(intent.id ?? "") !== paymentRef ||
      metadata.mingla_purpose !== "stay_reservation" ||
      metadata.stay_group_id !== groupId ||
      metadata.stay_payment_attempt_id !== paymentAttemptId ||
      authorizedAmount !== expectedAmount || currency !== expectedCurrency ||
      (providerState === "succeeded" && receivedAmount !== expectedAmount)
    ) {
      return json(409, { error: "provider_evidence_mismatch", requestId });
    }
    if (providerState === "succeeded") {
      finalize = {
        p_provider: "stripe",
        p_provider_event_id:
          `admin_reconcile:${paymentAttemptId}:${paymentRef}:succeeded`,
        p_provider_event_type: "admin.provider_read.succeeded",
        p_provider_payment_ref: paymentRef,
        p_provider_charge_ref: chargeRef,
        p_amount_minor: receivedAmount,
        p_currency_code: currency,
        p_provider_fee_minor: null,
        p_event_fingerprint: null,
      };
    } else if (
      ["canceled", "requires_payment_method"].includes(providerState)
    ) {
      failureCode = providerState === "canceled"
        ? "provider_payment_cancelled"
        : "provider_payment_failed";
    }
  } else if (provider === "paystack") {
    let verified: Record<string, unknown>;
    try {
      verified =
        await (dependencies.verifyPaystack ?? paystackVerifyTransaction)(
          paymentRef,
        );
    } catch {
      return json(502, { error: "provider_unavailable", requestId });
    }
    const metadata = objectRecord(verified.metadata);
    providerState = String(verified.status ?? "unknown").toLowerCase();
    const amount = Number(verified.amount);
    const currency = String(verified.currency ?? "").toUpperCase();
    const fee = verified.fees == null ? null : Number(verified.fees);
    const providerSubaccount = verified.subaccount;
    const hasProviderSubaccount = typeof providerSubaccount === "string"
      ? providerSubaccount.length > 0
      : Boolean(
        providerSubaccount && typeof providerSubaccount === "object" &&
          Object.keys(providerSubaccount as Record<string, unknown>).length > 0,
      );
    chargeRef = objectId(verified.id);
    if (
      String(verified.reference ?? "") !== paymentRef ||
      metadata.mingla_purpose !== "stay_reservation" ||
      metadata.stay_group_id !== groupId ||
      metadata.stay_payment_attempt_id !== paymentAttemptId ||
      amount !== expectedAmount || currency !== expectedCurrency ||
      hasProviderSubaccount ||
      (fee !== null && (!Number.isSafeInteger(fee) || fee < 0))
    ) {
      return json(409, { error: "provider_evidence_mismatch", requestId });
    }
    if (providerState === "success") {
      finalize = {
        p_provider: "paystack",
        p_provider_event_id:
          `admin_reconcile:${paymentAttemptId}:${paymentRef}:success`,
        p_provider_event_type: "admin.provider_read.success",
        p_provider_payment_ref: paymentRef,
        p_provider_charge_ref: chargeRef,
        p_amount_minor: amount,
        p_currency_code: currency,
        p_provider_fee_minor: fee,
        p_event_fingerprint: null,
      };
    } else if (["failed", "abandoned", "reversed"].includes(providerState)) {
      failureCode = "provider_payment_failed";
    }
  } else {
    return json(409, { error: "stay_provider_unsupported", requestId });
  }

  // The audit is the fail-closed gate: no payment state may change unless the
  // support action itself is durably attributable first.
  try {
    await audit(
      context,
      "stay.payment_provider_reconcile",
      "stay_payment_attempt",
      paymentAttemptId,
      reason,
      {
        before: { state: attempt.state },
        providerEvidence: { provider, state: providerState },
        requestedConvergence: finalize
          ? "provider_success"
          : failureCode
          ? "provider_failure"
          : "no_state_change",
      },
    );
  } catch {
    return json(500, { error: "audit_failed", requestId });
  }

  let result: unknown = { state: attempt.state };
  if (finalize) {
    const finalized = await context.service.rpc(
      "issue_1389_finalize_payment",
      finalize,
    );
    if (finalized.error) {
      return json(409, {
        error: safeRpcCode(finalized.error, "payment_convergence_failed"),
        requestId,
      });
    }
    result = finalized.data;
  } else if (failureCode) {
    const failure = await context.service.rpc(
      "issue_1389_record_payment_create_failure",
      {
        p_attempt_id: paymentAttemptId,
        p_failure_code: failureCode,
        p_ambiguous: false,
      },
    );
    if (failure.error) {
      return json(409, {
        error: safeRpcCode(failure.error, "payment_convergence_failed"),
        requestId,
      });
    }
    result = failure.data;
  }
  return json(200, { kind: "success", providerState, data: result, requestId });
}

export function createAdminStayOperationsHandler(
  dependencies: Dependencies = {},
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const requestId = crypto.randomUUID();
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return json(405, { error: "method_not_allowed", requestId });
    }
    const authorization = req.headers.get("authorization") ?? "";
    const context = await (dependencies.resolveAdmin ?? defaultResolveAdmin)(
      authorization,
    );
    if (!context) return json(401, { error: "not_authorized", requestId });

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "invalid_json", requestId });
    }
    if (!validReason(body.reason)) {
      return json(400, { error: "reason_required", requestId });
    }
    if (
      body.mode === "reconcile_payment" &&
      exactKeys(body, ["mode", "paymentAttemptId", "reason"]) &&
      typeof body.paymentAttemptId === "string" &&
      UUID.test(body.paymentAttemptId)
    ) {
      return await reconcilePayment(
        context,
        body.paymentAttemptId,
        body.reason,
        requestId,
        dependencies,
      );
    }
    return json(400, { error: "invalid_request", requestId });
  };
}

if (import.meta.main) {
  serve(createAdminStayOperationsHandler());
}
