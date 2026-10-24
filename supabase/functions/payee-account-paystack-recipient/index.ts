/**
 * #3872 R2 — referral-payee Paystack Transfer Recipient onboarding.
 *
 * Full NUBAN values exist only in the authenticated request and provider call;
 * Mingla persists last4. Stripe and Paystack recipient identities may coexist
 * because a payee can earn on both payment rails.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { writeAudit } from "../_shared/audit.ts";
import {
  type PaystackBank,
  paystackCreateTransferRecipient,
  paystackDeleteTransferRecipient,
  paystackListBanks,
  paystackResolveAccount,
  type PaystackResolvedAccount,
  type PaystackTransferRecipient,
} from "../_shared/paystack.ts";
import { isPaystackRecipientShared } from "../_shared/paystackRecipientSharing.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function isValidPayeeNuban(value: unknown): value is string {
  return typeof value === "string" && /^\d{10}$/.test(value);
}

export interface PayeePaystackRow {
  user_id: string;
  paystack_recipient_code: string | null;
  paystack_status: string;
  bank_name: string | null;
  bank_account_last4: string | null;
  paystack_country: string | null;
  paystack_currency: string | null;
}

export interface PayeePaystackDeps {
  resolveUserId: (token: string) => Promise<string | null>;
  loadAccount: (userId: string) => Promise<{
    data: PayeePaystackRow | null;
    error: unknown;
  }>;
  upsertAccount: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
  listBanks: (input: {
    country?: string;
    currency?: string;
    type?: string;
  }) => Promise<PaystackBank[]>;
  resolveAccount: (input: {
    accountNumber: string;
    bankCode: string;
  }) => Promise<PaystackResolvedAccount>;
  createRecipient: (input: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }) => Promise<PaystackTransferRecipient>;
  deleteRecipient: (recipientCode: string) => Promise<void>;
  isShared: (recipientCode: string, userId: string) => Promise<boolean>;
  audit: (input: {
    userId: string;
    action: string;
    after?: Record<string, unknown>;
  }) => Promise<void>;
}

function defaultDeps(): PayeePaystackDeps {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const client = createClient(url, key, { auth: { persistSession: false } });
  return {
    resolveUserId: async (token) => {
      const userClient = createClient(url, key, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data, error } = await userClient.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
    loadAccount: async (userId) => {
      const result = await client.from("payee_accounts")
        .select(
          "user_id,paystack_recipient_code,paystack_status,bank_name,bank_account_last4,paystack_country,paystack_currency",
        ).eq("user_id", userId).maybeSingle();
      return {
        data: result.data as PayeePaystackRow | null,
        error: result.error,
      };
    },
    upsertAccount: async (row) => {
      const result = await client.from("payee_accounts").upsert(row, {
        onConflict: "user_id",
      });
      return { error: result.error };
    },
    listBanks: paystackListBanks,
    resolveAccount: paystackResolveAccount,
    createRecipient: paystackCreateTransferRecipient,
    deleteRecipient: paystackDeleteTransferRecipient,
    isShared: (recipientCode, userId) =>
      isPaystackRecipientShared(client, recipientCode, {
        kind: "payee",
        userId,
      }),
    audit: async ({ userId, action, after }) => {
      await writeAudit(client, {
        user_id: userId,
        brand_id: null,
        action,
        target_type: "payee_account",
        target_id: userId,
        after,
      });
    },
  };
}

interface Body {
  action?:
    | "list_banks"
    | "resolve_account"
    | "create_recipient"
    | "status"
    | "disconnect";
  account_number?: string;
  bank_code?: string;
  bank_name?: string;
}

export async function handler(
  req: Request,
  deps: PayeePaystackDeps = defaultDeps(),
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "validation_error", detail: "invalid_json" }, 400);
  }
  const allowed = [
    "list_banks",
    "resolve_account",
    "create_recipient",
    "status",
    "disconnect",
  ];
  if (!body.action || !allowed.includes(body.action)) {
    return json({ error: "validation_error", detail: "unknown_action" }, 400);
  }

  const match = (req.headers.get("authorization") ?? "").match(
    /^Bearer\s+(.+)$/i,
  );
  if (!match) return json({ error: "unauthenticated" }, 401);
  const userId = await deps.resolveUserId(match[1]);
  if (!userId) return json({ error: "unauthenticated" }, 401);

  if (body.action === "list_banks") {
    try {
      const banks = await deps.listBanks({
        country: "nigeria",
        currency: "NGN",
        type: "nuban",
      });
      return json({ banks: banks.map(({ name, code }) => ({ name, code })) });
    } catch (error) {
      console.error(
        "[payee-account-paystack-recipient] bank list failed",
        error,
      );
      return json({ error: "banks_unavailable" }, 502);
    }
  }

  const accountResult = await deps.loadAccount(userId);
  if (accountResult.error) return json({ error: "internal_error" }, 500);
  if (body.action === "status") {
    const row = accountResult.data;
    return json({
      connected: Boolean(row?.paystack_recipient_code),
      status: row?.paystack_status ?? "none",
      bank_name: row?.bank_name ?? null,
      account_number_masked: row?.bank_account_last4
        ? `••••${row.bank_account_last4}`
        : null,
      currency: row?.paystack_currency ?? null,
    });
  }

  if (body.action === "disconnect") {
    const recipientCode = accountResult.data?.paystack_recipient_code ?? null;
    const update = await deps.upsertAccount({
      user_id: userId,
      paystack_recipient_code: null,
      paystack_status: "none",
      bank_name: null,
      bank_account_last4: null,
      paystack_country: null,
      paystack_currency: null,
      updated_at: new Date().toISOString(),
    });
    if (update.error) return json({ error: "internal_error" }, 500);
    if (recipientCode) {
      try {
        if (!(await deps.isShared(recipientCode, userId))) {
          try {
            await deps.deleteRecipient(recipientCode);
          } catch (error) {
            console.error(
              "[payee-account-paystack-recipient] provider cleanup failed",
              error,
            );
          }
        }
      } catch (error) {
        // Fail closed: an orphan provider object is safer than deleting a
        // recipient shared by another brand, partner or payee.
        console.error(
          "[payee-account-paystack-recipient] sharing check failed; delete skipped",
          error,
        );
      }
    }
    try {
      await deps.audit({ userId, action: "payee_paystack.disconnected" });
    } catch (error) {
      console.error("[payee-account-paystack-recipient] audit failed", error);
    }
    return json({ disconnected: true });
  }

  if (!isValidPayeeNuban(body.account_number)) {
    return json({
      error: "validation_error",
      detail: "account_number_must_be_10_digits",
    }, 400);
  }
  if (typeof body.bank_code !== "string" || body.bank_code.trim() === "") {
    return json(
      { error: "validation_error", detail: "bank_code_required" },
      400,
    );
  }
  const accountNumber = body.account_number;
  const bankCode = body.bank_code.trim();

  let resolved: PaystackResolvedAccount;
  try {
    resolved = await deps.resolveAccount({ accountNumber, bankCode });
  } catch (error) {
    console.error(
      "[payee-account-paystack-recipient] account resolve failed",
      error,
    );
    return json({ error: "account_unresolved" }, 422);
  }
  if (body.action === "resolve_account") {
    return json({
      account_name: resolved.account_name,
      account_number_masked: `••••${accountNumber.slice(-4)}`,
    });
  }

  let recipient: PaystackTransferRecipient;
  try {
    recipient = await deps.createRecipient({
      name: resolved.account_name,
      accountNumber,
      bankCode,
    });
  } catch (error) {
    console.error(
      "[payee-account-paystack-recipient] recipient create failed",
      error,
    );
    return json({ error: "paystack_api_error" }, 502);
  }
  const last4 = accountNumber.slice(-4);
  const bankName = typeof body.bank_name === "string" && body.bank_name.trim()
    ? body.bank_name.trim()
    : null;
  const update = await deps.upsertAccount({
    user_id: userId,
    paystack_recipient_code: recipient.recipient_code,
    paystack_status: "verified",
    bank_name: bankName,
    bank_account_last4: last4,
    paystack_country: "NG",
    paystack_currency: "NGN",
    updated_at: new Date().toISOString(),
  });
  if (update.error) return json({ error: "internal_error" }, 500);
  try {
    await deps.audit({
      userId,
      action: "payee_paystack.recipient_created",
      after: {
        recipient_code: recipient.recipient_code,
        bank_code: bankCode,
        bank_name: bankName,
        account_number_last4: last4,
        currency: "NGN",
      },
    });
  } catch (error) {
    console.error("[payee-account-paystack-recipient] audit failed", error);
  }
  return json({
    recipient_code: recipient.recipient_code,
    account_name: resolved.account_name,
    account_number_masked: `••••${last4}`,
    currency: "NGN",
  });
}

if (import.meta.main) serve((req) => handler(req));
