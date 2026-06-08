/**
 * META-ORCH-1104 Phase 0 — support-grant-staff.
 *
 * Admin roster write: upsert support_staff(user_id, enabled, role). This is the
 * GRANT side of D3 — the "support tag" Seth controls. Gated on is_admin_user()
 * ONLY (Lane D D5 #1 — a normal user cannot self-promote).
 *
 * Auth template = admin-review-venue-claim: a userClient (anon key + caller
 * Authorization) for identity + the role gate; a service-role client ONLY for
 * the privileged write. verify_jwt = true (config.toml).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const body = await req.json().catch(() => null) as
      | { userId?: unknown; enabled?: unknown; role?: unknown; displayName?: unknown }
      | null;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: isAdmin, error: adminErr } = await userClient.rpc("is_admin_user");
    if (adminErr) return json({ error: adminErr.message }, 500);
    if (isAdmin !== true) return json({ error: "Forbidden" }, 403);

    const targetUserId = body?.userId;
    if (!isUuid(targetUserId)) return json({ error: "userId_required" }, 400);
    const enabled = body?.enabled === true;
    const roleRaw = typeof body?.role === "string" ? body.role : "staff";
    const role = roleRaw === "lead" ? "lead" : "staff";
    const displayName = typeof body?.displayName === "string" ? body.displayName : null;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: upsertErr } = await admin
      .from("support_staff")
      .upsert(
        {
          user_id: targetUserId,
          enabled,
          role,
          display_name: displayName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (upsertErr) return json({ error: upsertErr.message }, 500);

    await admin.from("support_audit_log").insert({
      actor_user_id: user.id,
      action: enabled ? "staff_granted" : "staff_revoked",
      ticket_id: null,
      metadata: { target_user_id: targetUserId, enabled, role },
    });

    return json({ ok: true, user_id: targetUserId, enabled, role });
  } catch (e) {
    console.error("[support-grant-staff]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
