/**
 * META-ORCH-1104 Phase 0 — support-grant-staff.
 *
 * Admin roster write: upsert support_staff(user_id, enabled, …). This is the
 * GRANT side of D3 — the "support tag" Seth controls. Gated on is_admin_user()
 * ONLY (Lane D D5 #1 — a normal user cannot self-promote).
 *
 * #3720 Slice C:
 *   - Accept `userId` UUID **or** `email` (resolve via profiles).
 *   - Only write `role` / `display_name` when the body explicitly sends them,
 *     so revoke / re-grant does not wipe an existing name or demote a lead.
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

function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const email = v.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  return email;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const body = await req.json().catch(() => null) as
      | {
        userId?: unknown;
        email?: unknown;
        enabled?: unknown;
        role?: unknown;
        displayName?: unknown;
      }
      | null;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: isAdmin, error: adminErr } = await userClient.rpc("is_admin_user");
    if (adminErr) return json({ error: adminErr.message }, 500);
    if (isAdmin !== true) return json({ error: "Forbidden" }, 403);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let targetUserId: string | null = isUuid(body?.userId) ? body.userId : null;
    let resolvedProfileName: string | null = null;
    const email = normalizeEmail(body?.email);
    if (!targetUserId && email) {
      // Exact normalized equality — mirror public-follow-request (never ilike).
      const { data: profile, error: profileErr } = await admin
        .from("profiles")
        .select("id, display_name")
        .eq("email", email)
        .maybeSingle();
      if (profileErr) return json({ error: profileErr.message }, 500);
      if (!profile?.id || !isUuid(profile.id)) {
        return json({ error: "user_not_found" }, 404);
      }
      targetUserId = profile.id;
      if (
        typeof profile.display_name === "string" &&
        profile.display_name.trim().length > 0
      ) {
        resolvedProfileName = profile.display_name.trim();
      }
    }
    if (!targetUserId) {
      return json({ error: "userId_or_email_required" }, 400);
    }

    const enabled = body?.enabled === true;

    // #3720 bug 9 — only include role / display_name when the caller set them.
    // Revoke sends { userId, enabled: false } and must not demote lead → staff
    // or null out display_name.
    const patch: Record<string, unknown> = {
      user_id: targetUserId,
      enabled,
      updated_at: new Date().toISOString(),
    };

    let roleForAudit: string | null = null;
    if (typeof body?.role === "string") {
      const role = body.role === "lead" ? "lead" : "staff";
      patch.role = role;
      roleForAudit = role;
    }

    if (typeof body?.displayName === "string") {
      const trimmed = body.displayName.trim();
      patch.display_name = trimmed.length > 0 ? trimmed : null;
    } else if (enabled === true && resolvedProfileName) {
      // First-time grant by email with no explicit name: seed from profile once.
      // Re-grant without displayName still omits the column (preserve existing).
      const { data: existing } = await admin
        .from("support_staff")
        .select("user_id")
        .eq("user_id", targetUserId)
        .maybeSingle();
      if (!existing) {
        patch.display_name = resolvedProfileName;
      }
    }

    const { error: upsertErr } = await admin
      .from("support_staff")
      .upsert(patch, { onConflict: "user_id" });
    if (upsertErr) return json({ error: upsertErr.message }, 500);

    await admin.from("support_audit_log").insert({
      actor_user_id: user.id,
      action: enabled ? "staff_granted" : "staff_revoked",
      ticket_id: null,
      metadata: {
        target_user_id: targetUserId,
        enabled,
        ...(roleForAudit ? { role: roleForAudit } : {}),
        ...(email ? { email } : {}),
      },
    });

    return json({
      ok: true,
      user_id: targetUserId,
      enabled,
      ...(roleForAudit ? { role: roleForAudit } : {}),
    });
  } catch (e) {
    console.error("[support-grant-staff]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
