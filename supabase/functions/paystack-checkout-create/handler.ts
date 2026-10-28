import { corsHeaders } from "../_shared/cors.ts";
import {
  classifyPaystackChargeResponse,
  paystackChargeAuthorization,
  type PaystackChargeAuthorizationParams,
  type PaystackChargeAuthorizationResponse,
  type PaystackInitializeParams,
  type PaystackInitializeResult,
  paystackInitializeTransaction,
  paystackVerifyTransaction,
} from "../_shared/paystack.ts";

const TEST_EMAIL = "test-buyer@usemingla.com";
const TEST_CALLBACK = "https://host.usemingla.com";
const MIN_AMOUNT_MAJOR = 100;
const MAX_AMOUNT_MAJOR = 10_000;
const TEST_REFERENCE = /^mingla_test_[A-Za-z0-9_.=-]{1,180}$/;

export interface PaystackTestHarnessDeps {
  initialize: (
    params: PaystackInitializeParams,
  ) => Promise<PaystackInitializeResult>;
  verify: (reference: string) => Promise<Record<string, unknown>>;
  chargeAuthorization: (
    params: PaystackChargeAuthorizationParams,
  ) => Promise<PaystackChargeAuthorizationResponse>;
}

const defaultDeps: PaystackTestHarnessDeps = {
  initialize: (params) =>
    paystackInitializeTransaction(params, { mode: "test" }),
  verify: (reference) => paystackVerifyTransaction(reference, { mode: "test" }),
  chargeAuthorization: (params) =>
    paystackChargeAuthorization(params, fetch, "test"),
};

function genReference(kind = "checkout"): string {
  const rand = crypto.randomUUID().replace(/-/g, "");
  return `mingla_test_${kind}_${Date.now()}_${rand}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validReference(value: unknown): value is string {
  return typeof value === "string" && TEST_REFERENCE.test(value);
}

function amountSubunits(value: unknown, fallbackMajor: number): number | null {
  const major = value === undefined ? fallbackMajor : Number(value);
  if (
    !Number.isFinite(major) || major < MIN_AMOUNT_MAJOR ||
    major > MAX_AMOUNT_MAJOR
  ) {
    return null;
  }
  return Math.round(major * 100);
}

function safeVerifyResult(reference: string, txn: Record<string, unknown>) {
  const authorization = record(txn.authorization);
  return {
    mode: "test",
    reference,
    status: typeof txn.status === "string" ? txn.status : "unknown",
    amount_subunits: Number.isFinite(Number(txn.amount))
      ? Number(txn.amount)
      : null,
    currency: typeof txn.currency === "string" ? txn.currency : null,
    reusable_authorization: authorization?.reusable === true,
  };
}

export async function handlePaystackTestRequest(
  req: Request,
  deps: PaystackTestHarnessDeps = defaultDeps,
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const payload = record(await req.json().catch(() => ({}))) ?? {};
  const action = typeof payload.action === "string"
    ? payload.action
    : "initialize";

  try {
    if (action === "initialize") {
      const amount = amountSubunits(payload.amount, 1_000);
      if (amount === null) {
        return jsonResponse({ error: "invalid_amount" }, 400);
      }
      const reference = genReference();
      const result = await deps.initialize({
        email: TEST_EMAIL,
        amountSubunits: amount,
        currency: "NGN",
        reference,
        callbackUrl: TEST_CALLBACK,
        channels: ["card"],
        metadata: { source: "issue-3645-test-proof" },
      });
      return jsonResponse({
        mode: "test",
        authorization_url: result.authorization_url,
        reference: result.reference,
      });
    }

    if (action === "verify") {
      if (!validReference(payload.reference)) {
        return jsonResponse({ error: "invalid_test_reference" }, 400);
      }
      return jsonResponse(
        safeVerifyResult(
          payload.reference,
          await deps.verify(payload.reference),
        ),
      );
    }

    if (action === "charge_authorization") {
      if (!validReference(payload.source_reference)) {
        return jsonResponse({ error: "invalid_test_reference" }, 400);
      }
      const amount = amountSubunits(payload.amount, 500);
      if (amount === null) {
        return jsonResponse({ error: "invalid_amount" }, 400);
      }

      const source = await deps.verify(payload.source_reference);
      const authorization = record(source.authorization);
      const customer = record(source.customer);
      if (
        source.status !== "success" || authorization?.reusable !== true ||
        typeof authorization.authorization_code !== "string" ||
        typeof customer?.email !== "string"
      ) {
        return jsonResponse(
          { error: "reusable_test_authorization_required" },
          409,
        );
      }

      const reference = genReference("installment");
      const classified = classifyPaystackChargeResponse(
        await deps.chargeAuthorization({
          authorizationCode: authorization.authorization_code,
          email: customer.email,
          amountSubunits: amount,
          currency: "NGN",
          reference,
          metadata: {
            source: "issue-3645-test-proof",
            source_reference: payload.source_reference,
          },
        }),
      );

      if (classified.outcome === "succeeded") {
        return jsonResponse({
          mode: "test",
          outcome: "succeeded",
          reference,
          amount_subunits: classified.amountSubunits,
          fees_subunits: classified.feesSubunits,
        });
      }
      if (classified.outcome === "paused") {
        return jsonResponse({
          mode: "test",
          outcome: "approval_required",
          reference,
          authorization_url: classified.approvalUrl,
        });
      }
      return jsonResponse({
        mode: "test",
        outcome: classified.outcome,
        reference,
      }, 409);
    }

    return jsonResponse({ error: "unknown_action" }, 400);
  } catch {
    return jsonResponse({ error: "paystack_test_request_failed" }, 502);
  }
}
