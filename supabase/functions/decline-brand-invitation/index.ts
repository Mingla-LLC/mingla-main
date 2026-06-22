// ORCH-1111 [Surface pending invites in-app] — decline-brand-invitation.
//
// AUTHENTICATED edge function (verify_jwt=true in config.toml). Lets the
// invitee DECLINE a pending brand invitation addressed to their login email.
// The invitee has no brand membership, so they cannot satisfy the brand_admin+
// UPDATE RLS on brand_invitations (that policy is intentionally NOT widened);
// this service-role function is the only invitee-side write path.
//
// Decline is TERMINAL: status='declined', declined_at=now(). A second decline,
// or declining an already-terminal invite, returns 410 invite_not_actionable
// which the caller treats as success-equivalent ("no longer pending").
//
// Identity proof = JWT email == stored invite email (lowercased both sides).
// No token, no brand membership required.
//
// HTTP contract:
//   POST { invitationId }
//   → 200 { declined: true }
//   → 400 { error:'validation' }
//   → 401 { error:'unauthenticated' }
//   → 403 { error:'invite_email_mismatch' }
//   → 404 { error:'invite_not_found' }
//   → 410 { error:'invite_not_actionable' }
//   → 500 { error:'server' }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ORCH-1111 loop-back fix — OAuth users can have auth.users.email = NULL; the
// verified email lives only on auth.identities. Resolve a TRUSTED caller email
// (users.email → verified OAuth identity) for the email-match check. NEVER
// trust user_metadata.
import {
  makeAuthIdentitiesFetcher,
  resolveTrustedCallerEmail,
} from "../_shared/trustedCallerEmail.ts";
// ORCH-1205 — use the shared CORS allow-list (it includes x-client-info, which
// supabase-js sends on EVERY request) so the browser preflight is not rejected.
// The shared object already uses "POST, OPTIONS", matching this function's
// methods, so behavior is unchanged except the widened allow-headers.
import { corsHeaders } from "../_shared/cors.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "unauthenticated" }, 401);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "validation" }, 400);
  }
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const invitationId = typeof body.invitationId === "string"
    ? body.invitationId.trim()
    : "";
  if (!UUID_RE.test(invitationId)) {
    return json({ error: "validation" }, 400);
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userResult, error: userErr } = await callerClient.auth
      .getUser();
    if (userErr || !userResult?.user) {
      return json({ error: "unauthenticated" }, 401);
    }
    const userId = userResult.user.id;

    const service = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ORCH-1111 loop-back fix — resolve the caller email from the TRUSTED chain
    // (auth.users.email → verified auth.identities OAuth email). Google OAuth
    // users have a NULL users.email; without this the email-match below 403'd.
    // user_metadata is user-writable → NEVER consulted.
    const email = await resolveTrustedCallerEmail(
      userResult.user,
      makeAuthIdentitiesFetcher(service),
    );

    // Resolve the invitation; prove identity by email; check actionability.
    const { data: inviteRow, error: lookupErr } = await service
      .from("brand_invitations")
      .select("id, email, status")
      .eq("id", invitationId)
      .maybeSingle();
    if (lookupErr) {
      console.error(
        "[decline-brand-invitation] lookup failed",
        lookupErr.message,
      );
      return json({ error: "server" }, 500);
    }
    if (!inviteRow) {
      return json({ error: "invite_not_found" }, 404);
    }
    const storedEmail = ((inviteRow as { email?: unknown }).email ?? "");
    if (
      email.length === 0 ||
      (typeof storedEmail === "string" &&
        storedEmail.trim().toLowerCase() !== email)
    ) {
      return json({ error: "invite_email_mismatch" }, 403);
    }
    if ((inviteRow as { status?: unknown }).status !== "pending") {
      // Already terminal (declined/accepted/revoked/expired). Idempotent.
      return json({ error: "invite_not_actionable" }, 410);
    }

    // Service-role UPDATE, rowcount-verified (I-PROPOSED-I): guard on
    // status='pending' so a concurrent flip yields 0 rows → not_actionable.
    const { data: updated, error: updateErr } = await service
      .from("brand_invitations")
      .update({ status: "declined", declined_at: new Date().toISOString() })
      .eq("id", invitationId)
      .eq("status", "pending")
      .select("id");
    if (updateErr) {
      console.error(
        "[decline-brand-invitation] update failed",
        updateErr.message,
      );
      return json({ error: "server" }, 500);
    }
    if (!updated || updated.length === 0) {
      // Race: someone flipped it between the lookup and the update.
      return json({ error: "invite_not_actionable" }, 410);
    }

    // OQ-2 (clean default) — best-effort mark the bell notification read so the
    // unread clears. Non-fatal: a failure here must NOT fail the decline (the
    // To-Do row vanishing is the primary signal).
    try {
      await service
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("type", "business.brand_invite_pending")
        .eq("related_id", invitationId)
        .is("read_at", null);
    } catch (markReadErr) {
      console.warn(
        "[decline-brand-invitation] mark-read threw (non-fatal):",
        markReadErr instanceof Error
          ? markReadErr.message
          : String(markReadErr),
      );
    }

    return json({ declined: true }, 200);
  } catch (err) {
    console.error(
      "[decline-brand-invitation] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "server" }, 500);
  }
}

if (import.meta.main) {
  serve(handler);
}
