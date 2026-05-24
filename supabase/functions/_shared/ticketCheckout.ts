// @ts-ignore -- Deno ESM import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const ticketCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...ticketCorsHeaders, "Content-Type": "application/json" },
  });
}

export function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("supabase_service_env_missing");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * userClient — supabase-js bound to the caller's JWT.
 *
 * Use for RPC calls inside SECURITY DEFINER functions that read `auth.uid()`
 * to identify the caller (e.g., biz_refund_order, biz_cancel_order). The
 * service-role client sends an Authorization header with no `sub` claim, so
 * `auth.uid()` returns NULL inside the RPC and every permission gate that
 * depends on the caller identity fails closed with `permission_denied`.
 *
 * verify_jwt is enforced at the gateway, so the request has already presented
 * a valid user JWT by the time the function handler runs.
 */
export function userClient(req: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) {
    throw new Error("supabase_anon_env_missing");
  }
  const authHeader = req.headers.get("authorization") ?? "";
  return createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function qrTokenPepper(): string {
  const pepper = Deno.env.get("app.qr_token_pepper")?.trim() ?? "";
  if (
    pepper.length < 32 ||
    pepper === "local-ticket-pepper"
  ) {
    throw new Error("qr_token_pepper_missing");
  }
  return pepper;
}

export async function userIdFromAuthHeader(
  req: Request,
): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    return null;
  }
  const supabase = serviceClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

export function normalizePhoneE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (/^\+[1-9][0-9]{1,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

export function checkoutIdempotencyKey(input: {
  eventId: string;
  buyerEmail: string;
  buyerPhoneE164: string;
  lines: Array<{ ticketTypeId: string; quantity: number }>;
}): string {
  const lineKey = input.lines
    .map((line) => `${line.ticketTypeId}:${line.quantity}`)
    .sort()
    .join("|");
  return [
    "ticket_checkout",
    input.eventId,
    input.buyerEmail.trim().toLowerCase(),
    input.buyerPhoneE164,
    lineKey,
  ].join(":");
}

export function randomBuyerStatusToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function dispatchTicketConfirmation(
  orderId: string,
): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  try {
    await fetch(`${url}/functions/v1/ticket-confirmation-dispatch`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ orderId }),
    });
  } catch (err) {
    console.error("[ticket-checkout] confirmation dispatch failed", err);
  }
}

export async function dispatchTicketNotification(
  notificationId: string,
): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  try {
    await fetch(`${url}/functions/v1/ticket-confirmation-dispatch`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ notificationId }),
    });
  } catch (err) {
    console.error("[ticket-checkout] notification dispatch failed", err);
  }
}

export type ProviderFailure = {
  detail: string;
  retryable: boolean;
  status: number;
};

function providerErrorName(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  for (const key of ["name", "code", "type", "error_code"]) {
    const value = row[key];
    if (typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value)) {
      return value;
    }
  }
  const nested = row.error;
  if (nested && typeof nested === "object") {
    return providerErrorName(nested);
  }
  return null;
}

export function classifyNotificationProviderFailure(
  provider: "resend" | "twilio",
  status: number,
  body: unknown,
): ProviderFailure {
  const retryable = status === 429 || status >= 500;
  const authOrConfig = status === 400 || status === 401 || status === 403;
  const name = providerErrorName(body);
  const reason = authOrConfig ? "config" : retryable ? "retryable" : "provider";
  return {
    detail: [
      `${provider}_send_failed`,
      String(status),
      reason,
      name,
    ].filter(Boolean).join(":"),
    retryable,
    status,
  };
}

export function classifyStripePaymentIntentCreateFailure(error: unknown): {
  detail: string;
  httpStatus: number;
} {
  return classifyStripeCreateFailure(
    error,
    "stripe_payment_intent_create_failed",
  );
}

// ORCH-0790: Web buyer checkout via Stripe Checkout Sessions. Same classification
// shape as PaymentIntent creation; only the detail prefix differs so observability
// can split the two surfaces in logs.
export function classifyStripeCheckoutSessionCreateFailure(error: unknown): {
  detail: string;
  httpStatus: number;
} {
  return classifyStripeCreateFailure(
    error,
    "stripe_checkout_session_create_failed",
  );
}

function classifyStripeCreateFailure(
  error: unknown,
  prefix:
    | "stripe_payment_intent_create_failed"
    | "stripe_checkout_session_create_failed",
): { detail: string; httpStatus: number } {
  const row = error && typeof error === "object"
    ? error as Record<string, unknown>
    : {};
  const statusCode = typeof row.statusCode === "number" ? row.statusCode : null;
  const code =
    typeof row.code === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(row.code)
      ? row.code
      : null;
  const type =
    typeof row.type === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(row.type)
      ? row.type
      : null;
  const reason = statusCode === 401 || statusCode === 403
    ? "stripe_key_or_capability_config"
    : statusCode === 400
    ? "stripe_request_or_account_config"
    : statusCode === 429 ||
        (typeof statusCode === "number" && statusCode >= 500)
    ? "stripe_retryable"
    : prefix;

  return {
    detail: [
      prefix,
      statusCode === null ? null : String(statusCode),
      reason,
      code,
      type,
    ].filter(Boolean).join(":"),
    httpStatus: statusCode === 400
      ? 409
      : statusCode === 401 || statusCode === 403
      ? 502
      : 500,
  };
}

export type PaymentIntentCancelClient = {
  paymentIntents: {
    cancel: (
      paymentIntentId: string,
      options: { idempotencyKey: string },
    ) => Promise<unknown>;
  };
};

export async function cancelPaymentIntentIfClientAvailable(
  stripe: PaymentIntentCancelClient | null,
  paymentIntentId: string,
): Promise<boolean> {
  if (stripe === null) return false;
  await stripe.paymentIntents.cancel(paymentIntentId, {
    idempotencyKey: `ticket_checkout_cancel:${paymentIntentId}`,
  });
  return true;
}
