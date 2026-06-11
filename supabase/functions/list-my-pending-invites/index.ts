// ORCH-1108 [Surface pending invites in-app] — list-my-pending-invites.
//
// AUTHENTICATED edge function (verify_jwt=true in config.toml). Returns the
// pending brand invitations addressed to the CALLER'S OWN login email, keyed
// server-side off the JWT email (login-email-trusted — no raw token needed in
// the app). The invitee has no brand membership yet, so the brand_admin+ RLS
// SELECT policy on brand_invitations cannot serve them; this service-role
// function is the only invitee-side read path.
//
// SECURITY: returns ONLY a curated projection
//   { id, brand_id, brand_name, role, expires_at }
// and NEVER token_hash / invited_by / email. The email match is server-side;
// there is NO email parameter — the caller cannot inject an arbitrary email.
//
// Side-effect: emits an idempotent `business.brand_invite_pending` notification
// per pending invite (so the bell surfaces it). Notification failure is
// non-fatal and never fails the list response.
//
// HTTP contract:
//   POST (no body required)
//   → 200 { invites: [{ id, brand_id, brand_name, role, expires_at }] }
//   → 401 { error:'unauthenticated' }
//   → 500 { error:'server' }
//   (an empty / missing email returns 200 { invites: [] }, never 500)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchNotification } from "../_shared/stripeEdgeAuth.ts";
// ORCH-1108 loop-back fix — OAuth users can have auth.users.email = NULL; the
// verified email lives only on auth.identities. Resolve a TRUSTED email
// (users.email → verified OAuth identity) and NEVER user_metadata.
import {
  makeAuthIdentitiesFetcher,
  resolveTrustedCallerEmail,
} from "../_shared/trustedCallerEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface PendingInviteRow {
  id: string;
  brand_id: string;
  brand_name: string;
  role: string;
  expires_at: string;
}

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

    // ORCH-1108 loop-back fix — resolve the caller email from a TRUSTED chain:
    // auth.users.email → verified auth.identities OAuth email (Google users
    // have a NULL users.email). user_metadata is user-writable → NEVER trusted.
    // No trusted email = nothing to match. Never 500 (no leak).
    const email = await resolveTrustedCallerEmail(
      userResult.user,
      makeAuthIdentitiesFetcher(service),
    );
    if (email.length === 0) {
      return json({ invites: [] }, 200);
    }

    const nowIso = new Date().toISOString();

    // Curated projection only — token_hash / invited_by / email are NEVER
    // selected. brands!inner enforces the brand join + lets us drop
    // soft-deleted brands.
    const { data, error } = await service
      .from("brand_invitations")
      .select("id, brand_id, role, expires_at, brands!inner(name, deleted_at)")
      .eq("email", email)
      .eq("status", "pending")
      .gt("expires_at", nowIso)
      .is("brands.deleted_at", null)
      .order("expires_at", { ascending: true });

    if (error) {
      console.error(
        "[list-my-pending-invites] query failed",
        error.message,
      );
      return json({ error: "server" }, 500);
    }

    const invites: PendingInviteRow[] = (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      const brand = (r.brands ?? {}) as { name?: unknown };
      return {
        id: typeof r.id === "string" ? r.id : "",
        brand_id: typeof r.brand_id === "string" ? r.brand_id : "",
        brand_name: typeof brand.name === "string" ? brand.name : "your brand",
        role: typeof r.role === "string" ? r.role : "",
        expires_at: typeof r.expires_at === "string" ? r.expires_at : "",
      };
    });

    // Side-effect: surface an idempotent in-app notification per pending invite
    // so the bell/inbox reflects it. notify-dispatch's idempotency means
    // re-detection on every login does NOT spam the bell. NON-FATAL — a
    // notification failure must never fail the list response.
    for (const invite of invites) {
      try {
        await dispatchNotification({
          userId,
          brandId: invite.brand_id,
          type: "business.brand_invite_pending",
          title: "You've been invited",
          body: `You've been invited to join ${invite.brand_name}.`,
          data: {
            invitationId: invite.id,
            brandName: invite.brand_name,
            role: invite.role,
          },
          relatedId: invite.id,
          relatedType: "brand_invitation",
          idempotencyKey:
            `business.brand_invite_pending:${invite.id}:${userId}`,
          deepLink: `mingla-business://home`,
        });
      } catch (notifyErr) {
        console.warn(
          "[list-my-pending-invites] notify threw (non-fatal):",
          notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
        );
      }
    }

    return json({ invites }, 200);
  } catch (err) {
    console.error(
      "[list-my-pending-invites] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return json({ error: "server" }, 500);
  }
}

if (import.meta.main) {
  serve(handler);
}
