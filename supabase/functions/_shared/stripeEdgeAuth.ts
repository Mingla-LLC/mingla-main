// @ts-ignore — Deno ESM import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore — Deno ESM import
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

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

export async function getBrandPaymentManagerUserIds(
  supabase: SupabaseClient,
  brandId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("brand_team_members")
    .select("user_id, role")
    .eq("brand_id", brandId)
    .is("removed_at", null)
    .not("accepted_at", "is", null)
    .in("role", ["account_owner", "brand_admin", "finance_manager"]);
  if (error) {
    console.error("[stripeEdgeAuth] brand manager lookup failed:", error);
    return [];
  }
  return Array.from(new Set((data ?? []).map((row) => String(row.user_id))));
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
