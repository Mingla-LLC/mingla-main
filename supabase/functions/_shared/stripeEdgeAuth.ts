/**
 * JWT auth + payment permission gate for Mingla Business Stripe edge functions.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export interface AuthContext {
  userId: string;
  userClient: SupabaseClient;
}

export async function requireUser(req: Request): Promise<AuthContext | Response> {
  const authHeader = req.headers.get("Authorization");
  if (authHeader === null || authHeader === "") {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error } = await userClient.auth.getUser();
  if (error !== null || user === null) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  return { userId: user.id, userClient };
}

export async function requirePaymentsManager(
  userClient: SupabaseClient,
  brandId: string,
): Promise<Response | null> {
  const { data, error } = await userClient.rpc("biz_can_manage_payments_for_brand_for_caller", {
    p_brand_id: brandId,
  });

  if (error !== null) {
    console.error("[stripeEdgeAuth] rpc error:", error.message);
    return new Response(JSON.stringify({ error: "Permission check failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (data !== true) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}

export function serviceRoleClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
}

export const corsJson = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
