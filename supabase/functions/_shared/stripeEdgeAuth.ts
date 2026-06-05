// @ts-ignore — Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, accept-language",
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function isValidUuid(input: unknown): input is string {
  return typeof input === "string" && UUID_REGEX.test(input);
}

export function serviceRoleClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

export async function requireUserId(req: Request): Promise<string | Response> {
  const authHeader = req.headers.get("authorization") ?? "";
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) return jsonResponse({ error: "unauthenticated" }, 401);

  const token = tokenMatch[1];
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) return jsonResponse({ error: "unauthenticated" }, 401);
  return data.user.id;
}

export async function requirePaymentsManager(
  supabase: SupabaseClient,
  brandId: string,
  userId: string,
): Promise<Response | null> {
  const { data: canManage, error } = await supabase.rpc(
    "biz_can_manage_payments_for_brand",
    { p_brand_id: brandId, p_user_id: userId },
  );
  if (error) {
    console.error("[stripeEdgeAuth] permission RPC failed:", error);
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (canManage !== true) {
    return jsonResponse({ error: "forbidden", detail: "permission_denied" }, 403);
  }
  return null;
}

// META-ORCH-1074 Sub-A: the canonical brand-payments role-set (post ORCH-1047
// owner-role rename — these are the LIVE role strings the
// brand_team_members_role_check constraint allows). The parent + Sub-D specs
// use the legacy owner-role label; in the shipped schema that role is `brand_owner`.
export const BRAND_PAYMENTS_ROLES = [
  "brand_owner",
  "brand_admin",
  "finance_manager",
] as const;

/**
 * META-ORCH-1074 Sub-A — role-parameterized audience resolver. Returns the
 * deduped, accepted, not-removed brand_team_members user_ids whose role is in
 * `roles`. Generalizes getBrandPaymentManagerUserIds so a notification type can
 * target any role-set (per the §3.A.3 per-type recipient matrix). Returns [] on
 * empty roles or DB error (caller fans out to whoever resolves).
 */
export async function getBrandTeamUserIdsByRoles(
  supabase: SupabaseClient,
  brandId: string,
  roles: readonly string[],
): Promise<string[]> {
  if (!Array.isArray(roles) || roles.length === 0) return [];
  const { data, error } = await supabase
    .from("brand_team_members")
    .select("user_id, role")
    .eq("brand_id", brandId)
    .is("removed_at", null)
    .not("accepted_at", "is", null)
    .in("role", roles as string[]);
  if (error) {
    console.error("[stripeEdgeAuth] brand team-by-roles lookup failed:", error);
    return [];
  }
  return Array.from(new Set((data ?? []).map((row) => String(row.user_id))));
}

// Thin wrapper kept byte-stable for existing callers: the 3 payments-manager
// roles. Delegates to the role-parameterized resolver above.
export async function getBrandPaymentManagerUserIds(
  supabase: SupabaseClient,
  brandId: string,
): Promise<string[]> {
  return getBrandTeamUserIdsByRoles(supabase, brandId, BRAND_PAYMENTS_ROLES);
}

/**
 * META-ORCH-1074 Sub-A (Sub-D §2, F5) — currency-aware money formatter for the
 * `{amount}` copy slot. Charges are per-seller-currency; NEVER hardcode £/$/€
 * and NEVER fall back to GBP (ORCH-1034 rule). Formats minor units (cents) to a
 * localized currency string via Intl.NumberFormat. Zero-decimal currencies
 * (JPY/KRW/VND/…) keep their value un-divided. If `currency` is missing/blank
 * that is a caller data bug — we return the bare numeric string rather than
 * papering over it with a wrong symbol.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
  "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

export function formatMoneyCents(
  amountCents: number,
  currency: string | null | undefined,
): string {
  const code = typeof currency === "string" ? currency.trim().toUpperCase() : "";
  const cents = Number.isFinite(amountCents) ? amountCents : 0;
  if (code.length !== 3) {
    // Missing/invalid currency — surface the number without a wrong symbol.
    return String(Math.round(cents) / 100);
  }
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(code);
  const major = isZeroDecimal ? Math.round(cents) : cents / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
    }).format(major);
  } catch {
    // Unknown ISO code to Intl — fall back to "CODE 12.34", still no GBP.
    return `${code} ${major.toFixed(isZeroDecimal ? 0 : 2)}`;
  }
}

export async function dispatchNotification(
  input: {
    userId?: string | null;
    emailTo?: string | null;
    brandId?: string | null;
    type: string;
    title: string;
    body: string;
    data?: Record<string, unknown>;
    relatedId?: string | null;
    relatedType?: string | null;
    idempotencyKey?: string | null;
    deepLink?: string | null;
    skipPush?: boolean;
    // ORCH-0785: opt into Mingla brand shell for email path.
    emailVariant?: "generic_notification";
    emailCta?: { label: string; url: string };
  },
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) {
    throw new Error("dispatchNotification: Supabase env vars missing");
  }
  const response = await fetch(`${supabaseUrl}/functions/v1/notify-dispatch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`notify-dispatch failed ${response.status}: ${text}`);
  }
}
