// ORCH-1271 [Admin authorization & audit FOUNDATION] — service_role edge-fn
// skeleton / audited-write PRIMITIVE prover.
//
// This is the deployed, HARMLESS prover for the wave-2 seam: admin actions that
// must call an external API (Stripe refund, onboarding-link, dispute) will run
// as service_role edge fns following THIS exact contract. It writes an
// admin.edge_probe audit row via the shared admin_write_audit helper and touches
// NO Stripe / business data.
//
// Auth contract (mirrors careers-cv-signed-url):
//   verify_jwt = true (config.toml) — the platform rejects callers with no JWT
//   before this code runs. We additionally:
//     * getUser(token)                          → 401 if the JWT is not a real user
//     * admin_users { status:'active' } lookup  → 403 if the user is not an admin
//   Only then do we call admin_write_audit. Because service_role has no JWT uid,
//   we pass p_actor_email / p_actor_uid explicitly (the helper's guard only
//   fires for JWT callers, so it is a no-op here — the 403 above is the real gate).
//   A blank/whitespace reason is surfaced as HTTP 400 (the helper also raises
//   reason_required — this is the client-facing status).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  // ── Verify the caller JWT belongs to a real user. ──────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return json({ error: "unauthorized" }, 401);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return json({ error: "unauthorized" }, 401);
  }

  // ── ADMIN CHECK — only active admins may write. ────────────────────────────
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("id")
    .eq("email", user.email)
    .eq("status", "active")
    .maybeSingle();
  if (!adminRow) {
    return json({ error: "forbidden" }, 403);
  }

  // ── Reason is required for a high-risk write. ──────────────────────────────
  // Normalize ASCII + Unicode invisible whitespace (NBSP, ZWSP/ZWNJ/ZWJ, LSEP/PSEP,
  // BOM) before the emptiness check so an invisible-char reason cannot bypass the gate.
  // Mirrors the server-side admin_write_audit reason gate (the DB is the real gate;
  // this 400 is the client-facing status). ORCH-1271 P0 (c).
  const INVISIBLE_WS = /[\s\u00A0\u200B\u200C\u200D\u2028\u2029\uFEFF]/g;
  const body = await req.json().catch(() => ({})) as { reason?: string };
  const rawReason = typeof body.reason === "string" ? body.reason : "";
  if (rawReason.replace(INVISIBLE_WS, "") === "") {
    return json({ error: "reason_required", field: "reason" }, 400);
  }
  const reason = rawReason.trim();

  // ── Audited no-op write via the shared helper (service-role → pass actor). ──
  const { data: auditId, error: rpcError } = await supabase.rpc("admin_write_audit", {
    p_action: "admin.edge_probe",
    p_entity_type: "self_test",
    p_entity_id: null,
    p_reason: reason,
    p_metadata: { via: "edge" },
    p_actor_email: user.email,
    p_actor_uid: user.id,
  });
  if (rpcError) {
    // The helper raises reason_required for a blank reason — surface as 400.
    if (/reason_required/.test(rpcError.message)) {
      return json({ error: "reason_required", field: "reason" }, 400);
    }
    console.error("[admin-write-primitive] admin_write_audit failed", rpcError.message);
    return json({ error: "server", detail: rpcError.message }, 500);
  }

  return json({ ok: true, audit_id: auditId });
});
