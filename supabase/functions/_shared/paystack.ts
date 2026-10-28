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

// ORCH-1201 — Layer-C passive health observation (fire-and-forget, best-effort).
import { recordApiCall } from "./apiHealthLog.ts";
import { resolvePaymentModeValue } from "./secretBundle.ts";

export type PaystackMode = "test" | "live";

export const PAYSTACK_BASE_URL = "https://api.paystack.co";

/** Webhook source IPs — same trio for test + live. https://paystack.com/docs/payments/webhooks/ */
export const PAYSTACK_WEBHOOK_IPS = ["52.31.139.75", "52.49.173.169", "52.214.14.220"];

const MODE_ENV_VAR = "PAYSTACK_MODE";

export function resolvePaystackMode(): PaystackMode {
  const raw = resolvePaymentModeValue("paystack_mode", MODE_ENV_VAR);
  if (raw === undefined || raw === null || raw.trim().length === 0) {
    return "test"; // proof-slice default; Phase 0-proper throws on unset
  }
  if (raw !== "test" && raw !== "live") {
    throw new Error(`${MODE_ENV_VAR} must be "test" or "live"; got "${raw}".`);
  }
  return raw;
}

/** Resolve the Paystack SECRET key for an explicit mode, validating its prefix. */
export function resolvePaystackSecretKeyForMode(mode: PaystackMode): string {
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

/** Resolve the Paystack SECRET key for the configured runtime mode. */
export function resolvePaystackSecretKey(): string {
  return resolvePaystackSecretKeyForMode(resolvePaystackMode());
}

export interface PaystackRequestOptions {
  /** An explicit mode is reserved for isolated provider-test harnesses. */
  mode?: PaystackMode;
  fetchImpl?: typeof fetch;
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
  options: PaystackRequestOptions = {},
): Promise<PaystackInitializeResult> {
  const mode = options.mode ?? resolvePaystackMode();
  const secret = resolvePaystackSecretKeyForMode(mode);
  const fetchImpl = options.fetchImpl ?? fetch;
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

  const _t0 = Date.now();
  const res = await fetchImpl(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  void recordApiCall("paystack", res.ok, Date.now() - _t0, res.status); // ORCH-1201 Layer-C
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
  options: PaystackRequestOptions = {},
): Promise<Record<string, unknown>> {
  const mode = options.mode ?? resolvePaystackMode();
  const secret = resolvePaystackSecretKeyForMode(mode);
  const fetchImpl = options.fetchImpl ?? fetch;
  const _t0 = Date.now();
  const res = await fetchImpl(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secret}` } },
  );
  void recordApiCall("paystack", res.ok, Date.now() - _t0, res.status); // ORCH-1201 Layer-C
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status !== true) {
    throw new Error(
      `Paystack verify failed (${res.status}): ${json?.message ?? "unknown error"}`,
    );
  }
  return json.data as Record<string, unknown>;
}

// ───────────────────────────────────────────────────────────────────────────
// META-ORCH-1076 Phase 2 — Marketplace: subaccounts + bank resolution.
// The brand's settlement identity is a Paystack Subaccount (≈ Stripe connected
// account). Onboarding = List Banks → Resolve Account (verify name) → Create
// Subaccount. Mingla's per-txn cut rides as the flat `transaction_charge` on
// initialize (set at checkout), which OVERRIDES the subaccount percentage_charge.
//   - Subaccount API:   https://paystack.com/docs/api/subaccount/
//   - Verification API: https://paystack.com/docs/api/verification/#resolve-account
//   - Miscellaneous API (List Banks): https://paystack.com/docs/api/miscellaneous/#bank
// ───────────────────────────────────────────────────────────────────────────

export interface PaystackBank {
  name: string;
  code: string;
  currency: string;
  type: string;
}

/**
 * GET /bank — list settlement banks for a country.
 * https://paystack.com/docs/api/miscellaneous/#bank
 * For Nigeria NUBAN accounts: country="nigeria", currency="NGN", type="nuban".
 */
export async function paystackListBanks(params: {
  country?: string; // "nigeria" (lowercase slug per Paystack)
  currency?: string; // "NGN"
  type?: string; // "nuban"
}): Promise<PaystackBank[]> {
  const secret = resolvePaystackSecretKey();
  const qs = new URLSearchParams();
  qs.set("country", params.country ?? "nigeria");
  qs.set("currency", params.currency ?? "NGN");
  if (params.type) qs.set("type", params.type);
  qs.set("perPage", "100");
  const res = await fetch(`${PAYSTACK_BASE_URL}/bank?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status !== true) {
    throw new Error(
      `Paystack list-banks failed (${res.status}): ${json?.message ?? "unknown error"}`,
    );
  }
  return (json.data as PaystackBank[]) ?? [];
}

export interface PaystackResolvedAccount {
  account_number: string;
  account_name: string;
}

/**
 * GET /bank/resolve — verify an account number against a bank code; returns the
 * verified account holder name. MUST be shown to the brand for confirmation
 * before creating the subaccount (Paystack disclaims wrong-account liability).
 * https://paystack.com/docs/api/verification/#resolve-account
 */
export async function paystackResolveAccount(params: {
  accountNumber: string;
  bankCode: string;
}): Promise<PaystackResolvedAccount> {
  const secret = resolvePaystackSecretKey();
  const qs = new URLSearchParams({
    account_number: params.accountNumber,
    bank_code: params.bankCode,
  });
  const res = await fetch(`${PAYSTACK_BASE_URL}/bank/resolve?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status !== true) {
    throw new Error(
      `Paystack resolve-account failed (${res.status}): ${json?.message ?? "unknown error"}`,
    );
  }
  return json.data as PaystackResolvedAccount;
}

export interface PaystackSubaccount {
  subaccount_code: string;
  account_number: string;
  settlement_bank: string;
  percentage_charge: number;
  is_verified?: boolean;
  active?: boolean;
}

/**
 * POST /subaccount — create the brand's settlement subaccount.
 * https://paystack.com/docs/api/subaccount/
 * `percentage_charge` is the % of each split txn that goes to the MAIN (Mingla)
 * account; it is a REQUIRED field but is overridden per-transaction by the flat
 * `transaction_charge` we pass on initialize, so it acts only as a fallback.
 */
export async function paystackCreateSubaccount(params: {
  businessName: string;
  settlementBank: string; // bank code from paystackListBanks
  accountNumber: string;
  percentageCharge: number; // Mingla take-rate %, fallback only
}): Promise<PaystackSubaccount> {
  const secret = resolvePaystackSecretKey();
  const res = await fetch(`${PAYSTACK_BASE_URL}/subaccount`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      business_name: params.businessName,
      settlement_bank: params.settlementBank,
      account_number: params.accountNumber,
      percentage_charge: params.percentageCharge,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status !== true) {
    throw new Error(
      `Paystack create-subaccount failed (${res.status}): ${json?.message ?? "unknown error"}`,
    );
  }
  return json.data as PaystackSubaccount;
}

/**
 * PUT /subaccount/{id_or_code} — update a subaccount (change settlement bank /
 * account number, or toggle active). Used for "change bank" + "disconnect".
 * https://paystack.com/docs/api/subaccount/#update
 */
export async function paystackUpdateSubaccount(
  codeOrId: string,
  params: {
    settlementBank?: string;
    accountNumber?: string;
    active?: boolean;
  },
): Promise<PaystackSubaccount> {
  const secret = resolvePaystackSecretKey();
  const body: Record<string, unknown> = {};
  if (params.settlementBank !== undefined) body.settlement_bank = params.settlementBank;
  if (params.accountNumber !== undefined) body.account_number = params.accountNumber;
  if (params.active !== undefined) body.active = params.active;
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/subaccount/${encodeURIComponent(codeOrId)}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status !== true) {
    throw new Error(
      `Paystack update-subaccount failed (${res.status}): ${json?.message ?? "unknown error"}`,
    );
  }
  return json.data as PaystackSubaccount;
}

/**
 * GET /subaccount/{id_or_code} — re-poll a subaccount's verification/active state.
 * https://paystack.com/docs/api/subaccount/#fetch
 */
export async function paystackFetchSubaccount(
  codeOrId: string,
): Promise<PaystackSubaccount> {
  const secret = resolvePaystackSecretKey();
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/subaccount/${encodeURIComponent(codeOrId)}`,
    { headers: { Authorization: `Bearer ${secret}` } },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status !== true) {
    throw new Error(
      `Paystack fetch-subaccount failed (${res.status}): ${json?.message ?? "unknown error"}`,
    );
  }
  return json.data as PaystackSubaccount;
}

// ───────────────────────────────────────────────────────────────────────────
// ORCH-1331 — Partner payout rail: Transfer Recipients + Transfers.
// The PARTNER's payout identity is a Paystack Transfer Recipient (≈ the
// partner's bank on file); the partner share is paid post-hoc via a Transfer
// from Mingla's Paystack Balance (SPEC §4.1 Option B — the LIVE checkout
// initialize call is untouched).
//   - Transfer Recipient API: https://paystack.com/docs/api/transfer-recipient/
//   - Transfer API:           https://paystack.com/docs/api/transfer/
//   - Single transfers (OTP + reference idempotency):
//       https://paystack.com/docs/transfers/single-transfers/
// ───────────────────────────────────────────────────────────────────────────

/**
 * ORCH-1331 — error carrying the HTTP status so the split engine can classify
 * retryable (5xx/429/network) vs definitive (other 4xx) transfer failures.
 * Additive: pre-existing helpers keep throwing plain Errors.
 */
export class PaystackApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "PaystackApiError";
    this.status = status;
  }
}

export interface PaystackTransferRecipient {
  recipient_code: string;
  details?: Record<string, unknown>;
}

/**
 * POST /transferrecipient — create a NUBAN transfer recipient for a partner.
 * Body per https://paystack.com/docs/api/transfer-recipient/:
 *   { type: "nuban", name, account_number, bank_code, currency: "NGN" }
 * `name` MUST be the resolved account holder name (bank/resolve confirms it).
 */
export async function paystackCreateTransferRecipient(params: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<PaystackTransferRecipient> {
  const secret = resolvePaystackSecretKey();
  const _t0 = Date.now();
  const res = await fetch(`${PAYSTACK_BASE_URL}/transferrecipient`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "nuban",
      name: params.name,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: "NGN",
    }),
  });
  void recordApiCall("paystack", res.ok, Date.now() - _t0, res.status); // ORCH-1201 Layer-C
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status !== true) {
    throw new PaystackApiError(
      `Paystack create-transfer-recipient failed (${res.status}): ${json?.message ?? "unknown error"}`,
      res.status,
    );
  }
  return json.data as PaystackTransferRecipient;
}

/**
 * DELETE /transferrecipient/{code} — best-effort delete on disconnect.
 * https://paystack.com/docs/api/transfer-recipient/#delete
 * Callers treat failure as non-fatal (the local row is the source of truth).
 */
export async function paystackDeleteTransferRecipient(
  recipientCode: string,
): Promise<void> {
  const secret = resolvePaystackSecretKey();
  const _t0 = Date.now();
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/transferrecipient/${encodeURIComponent(recipientCode)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${secret}` } },
  );
  void recordApiCall("paystack", res.ok, Date.now() - _t0, res.status); // ORCH-1201 Layer-C
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status !== true) {
    throw new PaystackApiError(
      `Paystack delete-transfer-recipient failed (${res.status}): ${json?.message ?? "unknown error"}`,
      res.status,
    );
  }
}

export interface PaystackTransferResult {
  transfer_code: string;
  status: string; // "pending" | "success" | "otp" | …
  reference: string;
}

/**
 * POST /transfer — initiate a balance-sourced transfer to a recipient.
 * Body per https://paystack.com/docs/api/transfer/:
 *   { source: "balance", amount (subunits/kobo), recipient (RCP_…),
 *     reference, reason, currency: "NGN" }
 * The `reference` IS the idempotency key ("If you are retrying a transfer,
 * use the same reference" — single-transfers doc). ORCH-1331 contract:
 * reference = psplit_<partner_splits.id>_a<attempt_count>.
 */
export async function paystackInitiateTransfer(params: {
  amountSubunits: number;
  recipientCode: string;
  reference: string;
  reason: string;
}): Promise<PaystackTransferResult> {
  const secret = resolvePaystackSecretKey();
  const _t0 = Date.now();
  const res = await fetch(`${PAYSTACK_BASE_URL}/transfer`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "balance",
      amount: params.amountSubunits,
      recipient: params.recipientCode,
      reference: params.reference,
      reason: params.reason,
      currency: "NGN",
    }),
  });
  void recordApiCall("paystack", res.ok, Date.now() - _t0, res.status); // ORCH-1201 Layer-C
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status !== true) {
    throw new PaystackApiError(
      `Paystack transfer failed (${res.status}): ${json?.message ?? "unknown error"}`,
      res.status,
    );
  }
  return json.data as PaystackTransferResult;
}

/**
 * GET /transfer/{code} — fetch a transfer for sweep reconciliation.
 * https://paystack.com/docs/api/transfer/#fetch
 */
export async function paystackFetchTransfer(
  codeOrId: string,
): Promise<Record<string, unknown>> {
  const secret = resolvePaystackSecretKey();
  const _t0 = Date.now();
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/transfer/${encodeURIComponent(codeOrId)}`,
    { headers: { Authorization: `Bearer ${secret}` } },
  );
  void recordApiCall("paystack", res.ok, Date.now() - _t0, res.status); // ORCH-1201 Layer-C
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status !== true) {
    throw new PaystackApiError(
      `Paystack fetch-transfer failed (${res.status}): ${json?.message ?? "unknown error"}`,
      res.status,
    );
  }
  return json.data as Record<string, unknown>;
}

/**
 * GET /transfer/verify/{reference} — resolve a transfer when only the reference
 * is known (the initiate response was lost). Issue #1177 / #1030 fix: the
 * organiser payout sweep reconciles by transfer-code first, then by reference,
 * BEFORE any re-initiate, so a dropped initiate response can never double-pay or
 * loop. Paystack returns the transfer object incl. `status`, `transfer_code`,
 * and fee fields. https://paystack.com/docs/api/transfer/#verify
 */
export async function paystackVerifyTransferByReference(
  reference: string,
): Promise<Record<string, unknown>> {
  const secret = resolvePaystackSecretKey();
  const _t0 = Date.now();
  const res = await fetch(
    `${PAYSTACK_BASE_URL}/transfer/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secret}` } },
  );
  void recordApiCall("paystack", res.ok, Date.now() - _t0, res.status); // ORCH-1201 Layer-C
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status !== true) {
    throw new PaystackApiError(
      `Paystack verify-transfer-by-reference failed (${res.status}): ${json?.message ?? "unknown error"}`,
      res.status,
    );
  }
  return json.data as Record<string, unknown>;
}

export interface PaystackBalanceRow {
  currency: string;
  balance: number; // subunits (kobo for NGN)
}

/**
 * GET /balance — the integration's per-currency available balance. Issue #1177:
 * used ONLY as a ceiling before organiser Transfers (never to compute a release
 * amount — I-1013-LEDGER-ONLY-RELEASE). `data` is a per-currency ARRAY; callers
 * select the NGN row. https://paystack.com/docs/api/transfer/#balance
 */
export async function paystackGetBalance(): Promise<PaystackBalanceRow[]> {
  const secret = resolvePaystackSecretKey();
  const _t0 = Date.now();
  const res = await fetch(`${PAYSTACK_BASE_URL}/balance`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  void recordApiCall("paystack", res.ok, Date.now() - _t0, res.status); // ORCH-1201 Layer-C
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.status !== true) {
    throw new PaystackApiError(
      `Paystack balance failed (${res.status}): ${json?.message ?? "unknown error"}`,
      res.status,
    );
  }
  const rows = Array.isArray(json.data) ? json.data : [];
  return rows.map((row: Record<string, unknown>) => ({
    currency: String(row.currency ?? "").toUpperCase(),
    balance: Number(row.balance ?? 0),
  }));
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

// ───────────────────────────────────────────────────────────────────────────
// Issue #3645 — later trip-instalment charges on a saved card.
// POST /transaction/charge_authorization (docs-v2 api/transaction). Called
// synchronously (no `queue`): Paystack has no charge.failed webhook and a
// bank-approval request (`paused` + authorization_url) only arrives in this
// response. The ONLY caller is _shared/installments/chargePaystackInstallment.ts.
// The saved-card values are sent to Paystack and never logged or returned.
// ───────────────────────────────────────────────────────────────────────────

export interface PaystackChargeAuthorizationParams {
  authorizationCode: string;
  email: string;
  amountSubunits: number; // kobo
  currency?: string; // default NGN
  reference: string;
  metadata?: Record<string, unknown>;
  subaccount?: string;
  transactionChargeSubunits?: number;
  timeoutMs?: number; // default 20s
}

export type PaystackChargeAuthorizationResponse =
  | { kind: "response"; httpStatus: number; body: unknown }
  | { kind: "network_error"; message: string };

export async function paystackChargeAuthorization(
  params: PaystackChargeAuthorizationParams,
  fetchImpl: typeof fetch = fetch,
  mode: PaystackMode = resolvePaystackMode(),
): Promise<PaystackChargeAuthorizationResponse> {
  const secret = resolvePaystackSecretKeyForMode(mode);
  const body: Record<string, unknown> = {
    authorization_code: params.authorizationCode,
    email: params.email,
    amount: params.amountSubunits,
    currency: params.currency ?? "NGN",
    reference: params.reference,
  };
  if (params.metadata) body.metadata = JSON.stringify(params.metadata);
  if (params.subaccount) body.subaccount = params.subaccount;
  if (params.transactionChargeSubunits !== undefined) {
    body.transaction_charge = params.transactionChargeSubunits;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 20_000);
  const t0 = Date.now();
  try {
    const res = await fetchImpl(`${PAYSTACK_BASE_URL}/transaction/charge_authorization`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    void recordApiCall("paystack", res.ok, Date.now() - t0, res.status);
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { kind: "response", httpStatus: res.status, body: parsed };
  } catch (err) {
    const aborted = (err as { name?: string })?.name === "AbortError";
    return { kind: "network_error", message: aborted ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

export type PaystackChargeClass =
  | {
    outcome: "succeeded";
    transactionId: string | null;
    amountSubunits: number;
    feesSubunits: number;
    gatewayResponse: string | null;
  }
  | { outcome: "paused"; approvalUrl: string | null; gatewayResponse: string | null; transactionId: string | null }
  | { outcome: "failed"; gatewayResponse: string; authorizationUnusable: boolean; transactionId: string | null }
  | { outcome: "unknown"; gatewayResponse: string };

const PAUSE_STATUSES = new Set(["send_otp", "send_pin", "send_birthday", "send_phone", "open_url"]);
const STILL_RUNNING_STATUSES = new Set(["pending", "processing", "queued", "ongoing"]);
const UNUSABLE_AUTHORIZATION = /authorization|not reusable|invalid/i;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Pure classification of a charge_authorization answer (see SPEC §4.4.3 step 5). */
export function classifyPaystackChargeResponse(
  response: PaystackChargeAuthorizationResponse,
): PaystackChargeClass {
  if (response.kind === "network_error") {
    return { outcome: "unknown", gatewayResponse: response.message };
  }
  const { httpStatus } = response;
  const body = response.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { outcome: "unknown", gatewayResponse: `unparsable_${httpStatus}` };
  }
  const envelope = body as Record<string, unknown>;
  const data = envelope.data !== null && typeof envelope.data === "object" && !Array.isArray(envelope.data)
    ? envelope.data as Record<string, unknown>
    : {};
  const message = str(envelope.message);
  const status = str(data.status);
  const gateway = str(data.gateway_response) ?? message;
  const transactionId = data.id === undefined || data.id === null ? null : String(data.id);
  const approvalUrl = str(data.authorization_url);

  if (httpStatus >= 500) {
    return { outcome: "unknown", gatewayResponse: `http_${httpStatus}` };
  }
  if (httpStatus === 200 && envelope.status === true && status === "success") {
    return {
      outcome: "succeeded",
      transactionId,
      amountSubunits: Number(data.amount ?? 0),
      feesSubunits: Number(data.fees ?? 0),
      gatewayResponse: gateway,
    };
  }
  if (data.paused === true || (status !== null && PAUSE_STATUSES.has(status)) ||
    (status === "pending" && approvalUrl !== null)) {
    return { outcome: "paused", approvalUrl, gatewayResponse: gateway, transactionId };
  }
  if (status === "failed" || (httpStatus === 400 && envelope.status === false)) {
    const reason = gateway ?? "declined";
    return {
      outcome: "failed",
      gatewayResponse: reason,
      authorizationUnusable: UNUSABLE_AUTHORIZATION.test(reason),
      transactionId,
    };
  }
  if (status !== null && STILL_RUNNING_STATUSES.has(status)) {
    return { outcome: "unknown", gatewayResponse: status };
  }
  return { outcome: "unknown", gatewayResponse: gateway ?? `http_${httpStatus}` };
}

/** Verify-by-reference outcome for reconciling an unresolved instalment attempt. */
export type PaystackVerifyOutcome =
  | { state: "success"; txn: Record<string, unknown> }
  | { state: "failed"; txn: Record<string, unknown> }
  | { state: "pending"; txn: Record<string, unknown> | null }
  | { state: "not_found" };

/**
 * GET /transaction/verify/:reference without throwing on "not found", so a
 * never-created charge can be told apart from a pending one. Any other error
 * throws (the caller leaves the attempt unresolved and retries later).
 */
export async function paystackVerifyTransactionOutcome(
  reference: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PaystackVerifyOutcome> {
  const secret = resolvePaystackSecretKey();
  const t0 = Date.now();
  const res = await fetchImpl(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${secret}` } },
  );
  void recordApiCall("paystack", res.ok, Date.now() - t0, res.status);
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (res.status === 404 || (res.status === 400 && /not found/i.test(String(json?.message ?? "")))) {
    return { state: "not_found" };
  }
  if (!res.ok || json?.status !== true) {
    throw new Error(`Paystack verify failed (${res.status}): ${String(json?.message ?? "unknown error")}`);
  }
  const txn = (json.data ?? {}) as Record<string, unknown>;
  const s = String(txn.status ?? "");
  if (s === "success") return { state: "success", txn };
  if (s === "failed" || s === "abandoned" || s === "reversed") return { state: "failed", txn };
  return { state: "pending", txn };
}
