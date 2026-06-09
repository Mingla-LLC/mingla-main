/**
 * META-ORCH-1104 Phase 0 — support-claim.
 *
 * A staffer (or admin) claims a queued ticket. Gated on
 * is_support_staff() OR is_admin_user() → else 403. Calls the SECURITY DEFINER
 * RPC claim_support_ticket(ticketId, user.id) (sets assigned_staff_id, flips
 * new→open, seeds the staffer participant idempotently — Lane A F2.2). The RPC
 * is service-role-only; this fn re-asserts staff identity before invoking it
 * (Lane D D5 #5/#6 — the claimer can only claim AS THEMSELVES; user.id is taken
 * from the verified JWT, never from the request body).
 *
 * Auth template = admin-review-venue-claim. verify_jwt = true (config.toml).
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

    const body = await req.json().catch(() => null) as { ticketId?: unknown } | null;
    const ticketId = body?.ticketId;
    if (!isUuid(ticketId)) return json({ error: "ticketId_required" }, 400);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const [{ data: isStaff }, { data: isAdmin }] = await Promise.all([
      userClient.rpc("is_support_staff", { p_user_id: user.id }),
      userClient.rpc("is_admin_user"),
    ]);
    if (isStaff !== true && isAdmin !== true) return json({ error: "Forbidden" }, 403);

    // Service-role: the privileged seed-participant + status write. p_staff_id is
    // ALWAYS the verified caller (user.id) — never a body-supplied id.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: rpcErr } = await admin.rpc("claim_support_ticket", {
      p_ticket_id: ticketId,
      p_staff_id: user.id,
    });
    if (rpcErr) return json({ error: rpcErr.message }, 400);

    await admin.from("support_audit_log").insert({
      actor_user_id: user.id,
      action: "ticket_claimed",
      ticket_id: ticketId,
      metadata: null,
    });

    return json({ ok: true, ticket_id: ticketId, assigned_staff_id: user.id });
  } catch (e) {
    console.error("[support-claim]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
