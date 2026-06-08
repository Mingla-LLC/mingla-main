/**
 * META-ORCH-1104 Phase 0 — support-set-status.
 *
 * Staff/admin sets a legal status transition on a ticket (SPEC §2.1) and/or
 * priority. Gated on is_support_staff() OR is_admin_user(). Sets resolved_at
 * when transitioning to resolved/closed; clears it on reopen. Illegal
 * transitions are rejected (T-2.4).
 *
 * Auth template = admin-review-venue-claim. verify_jwt = true (config.toml).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isLegalTransition,
  isSupportStatus,
  resolvedAtForTransition,
  type SupportStatus,
} from "./statusLogic.ts";

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

const VALID_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const body = await req.json().catch(() => null) as
      | { ticketId?: unknown; status?: unknown; priority?: unknown }
      | null;
    const ticketId = body?.ticketId;
    if (!isUuid(ticketId)) return json({ error: "ticketId_required" }, 400);

    const wantStatus = body?.status;
    const wantPriority = body?.priority;
    if (wantStatus !== undefined && !isSupportStatus(wantStatus)) {
      return json({ error: "invalid_status" }, 400);
    }
    if (
      wantPriority !== undefined &&
      !(VALID_PRIORITIES as readonly string[]).includes(String(wantPriority))
    ) {
      return json({ error: "invalid_priority" }, 400);
    }
    if (wantStatus === undefined && wantPriority === undefined) {
      return json({ error: "nothing_to_update" }, 400);
    }

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

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: ticket, error: readErr } = await admin
      .from("support_tickets")
      .select("status, resolved_at")
      .eq("id", ticketId)
      .maybeSingle();
    if (readErr) return json({ error: readErr.message }, 500);
    if (!ticket) return json({ error: "ticket_not_found" }, 404);

    const patch: Record<string, unknown> = {};

    if (wantStatus !== undefined) {
      const from = ticket.status as SupportStatus;
      const to = wantStatus as SupportStatus;
      if (!isLegalTransition(from, to)) {
        return json({ error: "illegal_transition", from, to }, 422);
      }
      patch.status = to;
      patch.resolved_at = resolvedAtForTransition(
        to,
        (ticket.resolved_at as string | null) ?? null,
      );
    }
    if (wantPriority !== undefined) {
      patch.priority = String(wantPriority);
    }

    const { error: updErr } = await admin
      .from("support_tickets")
      .update(patch)
      .eq("id", ticketId);
    if (updErr) return json({ error: updErr.message }, 500);

    await admin.from("support_audit_log").insert({
      actor_user_id: user.id,
      action: "status_changed",
      ticket_id: ticketId,
      metadata: patch,
    });

    return json({ ok: true, ticket_id: ticketId, ...patch });
  } catch (e) {
    console.error("[support-set-status]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
