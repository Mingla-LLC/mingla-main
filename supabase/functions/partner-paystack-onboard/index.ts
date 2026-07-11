/**
 * partner-paystack-onboard — ORCH-1331 [partner Paystack payout rail].
 *
 * The Paystack analog of partner-stripe-onboard: connects a NIGERIAN partner's
 * payout identity as a Paystack Transfer Recipient (account-level, NOT
 * brand-level — the recipient belongs to creator_accounts.id). Paystack has no
 * embedded KYC component — onboarding is a Mingla-owned bank-details form.
 * Multiplexed by `action` (mirrors brand-paystack-onboard):
 *
 *   action = list_banks
 *     → NG NUBAN banks for the picker (partner-gated).
 *   action = resolve_account  (account_number, bank_code)
 *     → verified holder name (shown for confirmation before create).
 *   action = create_recipient (account_number, bank_code, bank_name?)
 *     → exclusivity guard (409 when an ACTIVE partner Stripe account exists),
 *       resolve name, POST /transferrecipient, UPSERT partner_paystack_accounts
 *       (LAST4 ONLY — I-PROPOSED-1331-NUBAN-NEVER-PERSISTED), stamp
 *       creator_accounts.partner_country='NG' (non-fatal), audit.
 *   action = status
 *     → the caller's own recipient row (connected:false shape when absent or
 *       detached).
 *   action = disconnect
 *     → soft-detach (detached_at=now()) + best-effort DELETE /transferrecipient
 *       (log-only on failure — mirrors partner-stripe-detach semantics), audit.
 *
 * Auth: Bearer JWT (verify_jwt=true, config.toml). Caller must satisfy
 * creator_accounts.partner_enabled = true (403 'not_a_partner' — exact parity
 * with partner-stripe-onboard).
 *
 * Exclusivity (I-PROPOSED-1331-PARTNER-PAYOUT-RAIL-EXCLUSIVE): a partner has
 * at most ONE active payout rail. create_recipient 409s on an active Stripe
 * row; partner-stripe-onboard 409s on an active Paystack row.
 *
 * Paystack docs:
 *   - Transfer Recipient API: https://paystack.com/docs/api/transfer-recipient/
 *   - Verification API:       https://paystack.com/docs/api/verification/#resolve-account
 *   - Miscellaneous (Banks):  https://paystack.com/docs/api/miscellaneous/#bank
 * Reference: Mingla_Artifacts/PAYSTACK_INTEGRATION_REFERENCE.md
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — Deno ESM import
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { writeAudit } from "../_shared/audit.ts";
import {
  paystackCreateTransferRecipient,
  paystackDeleteTransferRecipient,
  paystackListBanks,
  paystackResolveAccount,
} from "../_shared/paystack.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Nigerian NUBAN account numbers are exactly 10 digits (same validator as
// brand-paystack-onboard).
function isValidNuban(v: unknown): v is string {
  return typeof v === "string" && /^\d{10}$/.test(v);
}

function envServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key, { auth: { persistSession: false } });
}

async function envResolveUserId(token: string): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const userClient = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

/** Dependency injection so tests stub the network + DB deterministically
 * (NO live Paystack calls — LIVE mode, real money). serve() passes only the
 * request; production always uses the defaults. */
export interface PartnerPaystackOnboardDeps {
  serviceClient: () => SupabaseClient;
  resolveUserId: (token: string) => Promise<string | null>;
  listBanks: typeof paystackListBanks;
  resolveAccount: typeof paystackResolveAccount;
  createRecipient: typeof paystackCreateTransferRecipient;
  deleteRecipient: typeof paystackDeleteTransferRecipient;
}

function defaultDeps(): PartnerPaystackOnboardDeps {
  return {
    serviceClient: envServiceClient,
    resolveUserId: envResolveUserId,
    listBanks: paystackListBanks,
    resolveAccount: paystackResolveAccount,
    createRecipient: paystackCreateTransferRecipient,
    deleteRecipient: paystackDeleteTransferRecipient,
  };
}

interface OnboardBody {
  action?: string;
  account_number?: string;
  bank_code?: string;
  bank_name?: string;
}

interface PartnerAccountRow {
  id: string;
  partner_enabled: boolean;
}

interface PaystackAccountRow {
  id: string;
  recipient_code: string | null;
  bank_code: string | null;
  bank_name: string | null;
  account_number_last4: string | null;
  account_name: string | null;
  detached_at: string | null;
}

export async function handler(
  req: Request,
  deps: PartnerPaystackOnboardDeps = defaultDeps(),
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  try {
    let body: OnboardBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "validation_error", detail: "invalid_json" }, 400);
    }

    const action = body?.action;
    if (
      action !== "list_banks" && action !== "resolve_account" &&
      action !== "create_recipient" && action !== "status" &&
      action !== "disconnect"
    ) {
      return jsonResponse({ error: "validation_error", detail: "unknown_action" }, 400);
    }

    // Auth — every action requires a valid JWT.
    const authHeader = req.headers.get("authorization") ?? "";
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!tokenMatch) return jsonResponse({ error: "unauthenticated" }, 401);
    const userId = await deps.resolveUserId(tokenMatch[1]);
    if (!userId) return jsonResponse({ error: "unauthenticated" }, 401);

    const supabase = deps.serviceClient();

    // Gate: caller must be a flagged partner (exact parity with
    // partner-stripe-onboard). creator_accounts.id IS auth.users.id.
    const { data: account, error: accountErr } = await supabase
      .from("creator_accounts")
      .select("id, partner_enabled")
      .eq("id", userId)
      .maybeSingle<PartnerAccountRow>();
    if (accountErr) {
      console.error("[partner-paystack-onboard] account lookup failed:", accountErr);
      return jsonResponse({ error: "internal_error" }, 500);
    }
    if (!account) {
      return jsonResponse(
        { error: "forbidden", detail: "creator_account_missing" },
        403,
      );
    }
    if (account.partner_enabled !== true) {
      return jsonResponse({ error: "forbidden", detail: "not_a_partner" }, 403);
    }

    // ── action: list_banks ───────────────────────────────────────────────────
    if (action === "list_banks") {
      try {
        const banks = await deps.listBanks({
          country: "nigeria",
          currency: "NGN",
          type: "nuban",
        });
        const slim = banks.map((b) => ({ name: b.name, code: b.code }));
        return jsonResponse({ banks: slim });
      } catch (err) {
        return jsonResponse(
          { error: "banks_unavailable", detail: String((err as Error)?.message ?? err) },
          502,
        );
      }
    }

    // ── action: status ───────────────────────────────────────────────────────
    if (action === "status") {
      const { data: row, error: rowErr } = await supabase
        .from("partner_paystack_accounts")
        .select(
          "id, recipient_code, bank_code, bank_name, account_number_last4, account_name, detached_at",
        )
        .eq("account_id", userId)
        .maybeSingle<PaystackAccountRow>();
      if (rowErr) {
        console.error("[partner-paystack-onboard] status read failed:", rowErr);
        return jsonResponse({ error: "internal_error" }, 500);
      }
      if (!row || !row.recipient_code || row.detached_at !== null) {
        return jsonResponse({
          connected: false,
          bank_name: null,
          bank_code: null,
          account_number_masked: null,
          account_name: null,
          detached_at: row?.detached_at ?? null,
        });
      }
      return jsonResponse({
        connected: true,
        bank_name: row.bank_name,
        bank_code: row.bank_code,
        account_number_masked: row.account_number_last4
          ? `••••${row.account_number_last4}`
          : null,
        account_name: row.account_name,
        detached_at: null,
      });
    }

    // ── action: disconnect ───────────────────────────────────────────────────
    if (action === "disconnect") {
      const { data: row, error: rowErr } = await supabase
        .from("partner_paystack_accounts")
        .select("id, recipient_code, detached_at")
        .eq("account_id", userId)
        .maybeSingle<PaystackAccountRow>();
      if (rowErr) {
        console.error("[partner-paystack-onboard] disconnect read failed:", rowErr);
        return jsonResponse({ error: "internal_error" }, 500);
      }
      if (!row) {
        // Idempotent no-op success.
        return jsonResponse({ disconnected: true });
      }
      const { error: updErr } = await supabase
        .from("partner_paystack_accounts")
        .update({
          detached_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (updErr) {
        console.error("[partner-paystack-onboard] detach update failed:", updErr);
        return jsonResponse({ error: "internal_error" }, 500);
      }
      if (row.recipient_code) {
        try {
          await deps.deleteRecipient(row.recipient_code);
        } catch (err) {
          // Non-fatal — mirrors partner-stripe-detach semantics.
          console.error(
            "[partner-paystack-onboard] recipient delete failed (non-fatal):",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      try {
        await writeAudit(supabase, {
          user_id: userId,
          brand_id: null,
          action: "partner_paystack.recipient_detached",
          target_type: "partner_paystack_account",
          target_id: row.id,
          before: { recipient_code: row.recipient_code },
        });
      } catch (auditErr) {
        console.error("[partner-paystack-onboard] audit write failed:", auditErr);
      }
      return jsonResponse({ disconnected: true });
    }

    // resolve_account + create_recipient both require bank details.
    if (!isValidNuban(body?.account_number)) {
      return jsonResponse(
        { error: "validation_error", detail: "account_number_must_be_10_digits" },
        400,
      );
    }
    if (typeof body?.bank_code !== "string" || body.bank_code.length === 0) {
      return jsonResponse(
        { error: "validation_error", detail: "bank_code_required" },
        400,
      );
    }
    const accountNumber = body.account_number as string;
    const bankCode = body.bank_code;

    // ── action: resolve_account ──────────────────────────────────────────────
    if (action === "resolve_account") {
      try {
        const resolved = await deps.resolveAccount({
          accountNumber,
          bankCode,
        });
        return jsonResponse({
          account_name: resolved.account_name,
          account_number: resolved.account_number,
        });
      } catch (err) {
        return jsonResponse(
          { error: "account_unresolved", detail: String((err as Error)?.message ?? err) },
          422,
        );
      }
    }

    // ── action: create_recipient ─────────────────────────────────────────────
    // (1) Exclusivity guard — I-PROPOSED-1331-PARTNER-PAYOUT-RAIL-EXCLUSIVE:
    //     an ACTIVE partner Stripe account blocks the Paystack rail.
    const { data: stripeRow, error: stripeErr } = await supabase
      .from("partner_stripe_connect_accounts")
      .select("stripe_account_id, detached_at")
      .eq("account_id", userId)
      .maybeSingle<{ stripe_account_id: string | null; detached_at: string | null }>();
    if (stripeErr) {
      console.error("[partner-paystack-onboard] stripe exclusivity read failed:", stripeErr);
      return jsonResponse({ error: "internal_error" }, 500);
    }
    if (stripeRow?.stripe_account_id && stripeRow.detached_at === null) {
      return jsonResponse(
        { error: "conflict", detail: "stripe_already_connected" },
        409,
      );
    }

    // (2) Resolve the holder name (Paystack disclaims wrong-account liability).
    let accountName: string;
    try {
      const resolved = await deps.resolveAccount({ accountNumber, bankCode });
      accountName = resolved.account_name;
    } catch (err) {
      return jsonResponse(
        { error: "account_unresolved", detail: String((err as Error)?.message ?? err) },
        422,
      );
    }

    // Re-run replaces the row: best-effort delete of the previous recipient
    // first so orphaned recipients don't pile up in Paystack.
    const { data: priorRow } = await supabase
      .from("partner_paystack_accounts")
      .select("recipient_code")
      .eq("account_id", userId)
      .maybeSingle<{ recipient_code: string | null }>();
    if (priorRow?.recipient_code) {
      try {
        await deps.deleteRecipient(priorRow.recipient_code);
      } catch (err) {
        console.error(
          "[partner-paystack-onboard] prior recipient delete failed (non-fatal):",
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // (3) Create the Transfer Recipient (name = the RESOLVED holder name).
    let recipientCode: string;
    try {
      const recipient = await deps.createRecipient({
        name: accountName,
        accountNumber,
        bankCode,
      });
      recipientCode = recipient.recipient_code;
    } catch (err) {
      return jsonResponse(
        { error: "recipient_create_failed", detail: String((err as Error)?.message ?? err) },
        502,
      );
    }

    // (4) UPSERT the mirror row — LAST4 ONLY, never the full NUBAN
    //     (I-PROPOSED-1331-NUBAN-NEVER-PERSISTED).
    const last4 = accountNumber.slice(-4);
    const bankName = typeof body?.bank_name === "string" && body.bank_name.length > 0
      ? body.bank_name
      : null;
    const { error: upsertErr } = await supabase
      .from("partner_paystack_accounts")
      .upsert(
        {
          account_id: userId,
          recipient_code: recipientCode,
          bank_code: bankCode,
          bank_name: bankName,
          account_number_last4: last4,
          account_name: accountName,
          detached_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "account_id" },
      );
    if (upsertErr) {
      console.error("[partner-paystack-onboard] upsert failed:", upsertErr);
      return jsonResponse({ error: "internal_error" }, 500);
    }

    // (5) Stamp partner_country (non-fatal — parity with partner-stripe-onboard).
    const { error: caUpdateErr } = await supabase
      .from("creator_accounts")
      .update({ partner_country: "NG" })
      .eq("id", userId);
    if (caUpdateErr) {
      console.error(
        "[partner-paystack-onboard] partner_country update failed:",
        caUpdateErr,
      );
    }

    // (6) Audit — last4 only in the payload (NEVER the full account number).
    try {
      await writeAudit(supabase, {
        user_id: userId,
        brand_id: null,
        action: "partner_paystack.recipient_created",
        target_type: "partner_paystack_account",
        target_id: userId,
        after: {
          recipient_code: recipientCode,
          bank_code: bankCode,
          bank_name: bankName,
          account_number_last4: last4,
          currency: "NGN",
        },
      });
    } catch (auditErr) {
      console.error("[partner-paystack-onboard] audit write failed:", auditErr);
    }

    return jsonResponse({
      recipient_code: recipientCode,
      account_name: accountName,
      account_number_masked: `••••${last4}`,
      currency: "NGN",
    });
  } catch (err) {
    console.error("[partner-paystack-onboard] unhandled error:", err);
    return jsonResponse({ error: "internal_error" }, 500);
  }
}

if (import.meta.main) {
  serve((req) => handler(req));
}
