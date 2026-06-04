/**
 * Paystack provider client (META-ORCH-1076 — Paystack Africa / Nigeria).
 *
 * Mirrors the Stripe mode-resolver pattern (_shared/stripeMode.ts): one source
 * of truth for which Paystack mode the edge fns operate in, with per-mode
 * secret-key resolution + prefix validation to prevent a silent test/live
 * mismatch.
 *
 * Paystack docs:
 *   - Authentication (Bearer secret key; sk_test_/sk_live_ prefixes):
 *       https://paystack.com/docs/api/authentication/
 *   - Initialize Transaction: https://paystack.com/docs/api/transaction/#initialize
 *   - Verify Transaction:     https://paystack.com/docs/api/transaction/#verify
 *   - Webhook signature (x-paystack-signature = HMAC-SHA512 of RAW body, secret key):
 *       https://paystack.com/docs/payments/webhooks/
 *   - Base URL https://api.paystack.co (https://paystack.com/docs/api/)
 *
 * Full reference: Mingla_Artifacts/PAYSTACK_INTEGRATION_REFERENCE.md
 *
 * NOTE (proof slice): mode defaults to "test" when PAYSTACK_MODE is unset, to
 * ease sandbox bring-up. Phase 0-proper makes the mode strict (throw on unset),
 * matching resolveStripeKey.
 */

export type PaystackMode = "test" | "live";

export const PAYSTACK_BASE_URL = "https://api.paystack.co";

/** Webhook source IPs — same trio for test + live. https://paystack.com/docs/payments/webhooks/ */
export const PAYSTACK_WEBHOOK_IPS = ["52.31.139.75", "52.49.173.169", "52.214.14.220"];

const MODE_ENV_VAR = "PAYSTACK_MODE";

export function resolvePaystackMode(): PaystackMode {
  const raw = Deno.env.get(MODE_ENV_VAR);
  if (raw === undefined || raw === null || raw.trim().length === 0) {
    return "test"; // proof-slice default; Phase 0-proper throws on unset
  }
  if (raw !== "test" && raw !== "live") {
    throw new Error(`${MODE_ENV_VAR} must be "test" or "live"; got "${raw}".`);
  }
  return raw;
}

/** Resolve the Paystack SECRET key for the current mode, validating its prefix. */
export function resolvePaystackSecretKey(): string {
  const mode = resolvePaystackMode();
  const suffix = mode === "live" ? "LIVE" : "TEST";
  const envVarName = `PAYSTACK_SECRET_KEY_${suffix}`;
  const value = Deno.env.get(envVarName);
  if (!value || value.trim().length === 0) {
    throw new Error(`${envVarName} is not set in Supabase Edge Function secrets.`);
  }
  const expectedPrefix = mode === "live" ? "sk_live_" : "sk_test_";
  if (!value.startsWith(expectedPrefix)) {
    throw new Error(
      `${envVarName} prefix does not match PAYSTACK_MODE="${mode}" (expected "${expectedPrefix}...").`,
    );
  }
  return value;
}

export interface PaystackInitializeParams {
  email: string;
  amountSubunits: number; // kobo for NGN
  currency?: string; // default NGN
  reference?: string;
  callbackUrl?: string;
  channels?: string[];
  metadata?: Record<string, unknown>;
  subaccount?: string;
  transactionChargeSubunits?: number;
  bearer?: "account" | "subaccount";
}

export interface PaystackInitializeResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

/** POST /transaction/initialize — https://paystack.com/docs/api/transaction/#initialize */
export async function paystackInitializeTransaction(
  params: PaystackInitializeParams,
): Promise<PaystackInitializeResult> {
  const secret = resolvePaystackSecretKey();
  const body: Record<string, unknown> = {
    email: params.email,
    amount: params.amountSubunits, // subunits (kobo) — base × 100
    currency: params.currency ?? "NGN",
  };
  if (params.reference) body.reference = params.reference;
  if (params.callbackUrl) body.callback_url = params.callbackUrl;
  if (params.channels) body.channels = params.channels;
  if (params.metadata) body.metadata = JSON.stringify(params.metadata);
  if (params.subaccount) body.subaccount = params.subaccount;
  if (params.transactionChargeSubunits !== undefined) {
    body.transaction_charge = params.transactionChargeSubunits; // flat kobo to main (Mingla) account
  }
  if (params.bearer) body.bearer = params.bearer;

  const res = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status !== true) {
    throw new Error(
      `Paystack initialize failed (${res.status}): ${json?.message ?? "unknown error"}`,
    );
  }
  return json.data as PaystackInitializeResult;
}

/** GET /transaction/verify/:reference — https://paystack.com/docs/api/transaction/#verify */
export async function paystackVerifyTransaction(
  reference: string,
): Promise<Record<string, unknown>> {
  const secret = resolvePaystackSecretKey();
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secret}` } },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status !== true) {
    throw new Error(
      `Paystack verify failed (${res.status}): ${json?.message ?? "unknown error"}`,
    );
  }
  return json.data as Record<string, unknown>;
}

/**
 * Verify the x-paystack-signature header.
 * HMAC-SHA512 of the RAW request body using the SECRET key, hex-encoded.
 * https://paystack.com/docs/payments/webhooks/
 */
export async function verifyPaystackSignature(
  rawBody: string,
  signatureHeader: string | null,
  secretKey: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secretKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return constantTimeEqual(computed, signatureHeader);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
