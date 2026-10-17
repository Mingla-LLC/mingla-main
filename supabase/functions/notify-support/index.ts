/**
 * META-ORCH-1104 Phase 0 — notify-support (INTERNAL push fan-out, D6).
 *
 * Service-role producer invoked by support-send. verify_jwt = false
 * (config.toml) — authenticated by the
 * service-role bearer the caller passes; rejects any request without it.
 *
 * Fan-out rules:
 *   event = 'message'    → staff reply  → push the requester (business.support_message);
 *                          requester reply → push the assignee (if any) PLUS every
 *                          enabled+available staffer. EXCLUDE the sender. business.support_message.
 *
 * All pushes are app:"business" via the `business.` prefix → notify-dispatch's
 * resolveOneSignalApp routes to the business OneSignal app, and the business
 * inbox's type.like 'business.%' filter renders them. Deep-link →
 * mingla-business://support/{ticketId} (businessNotificationRouting case).
 *
 * Push carries IDs only, never message bodies (Lane D D5 #7 — minimize PII).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchNotification } from "../_shared/stripeEdgeAuth.ts";
import { SUPPORT_HOST_FACING_AGENT } from "../_shared/supportHostFacing.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
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

function deepLink(ticketId: string): string {
  return `mingla-business://support/${ticketId}`;
}

// deno-lint-ignore no-explicit-any
async function availableStaffIds(admin: any): Promise<string[]> {
  const { data, error } = await admin
    .from("support_staff")
    .select("user_id")
    .eq("enabled", true)
    .eq("available", true);
  if (error || !Array.isArray(data)) return [];
  return data.map((r: { user_id: string }) => r.user_id);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    // Internal-only: require the service-role bearer (verify_jwt=false at the
    // gateway, so we authenticate the producer here ourselves).
    const authHeader = req.headers.get("authorization") ?? "";
    if (authHeader !== `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => null) as
      | {
        event?: string;
        ticketId?: string;
        senderUserId?: string;
        senderIsStaff?: boolean;
        senderDisplayName?: string | null;
      }
      | null;
    const event = body?.event;
    const ticketId = body?.ticketId;
    // #3720 reliability cutover: create_support_ticket atomically owns every
    // new-ticket bell/push/email outbox event. Refuse the retired edge path so
    // an old internal caller cannot create a second event.
    if (event === "new_ticket") {
      return json({ error: "new_ticket_owned_by_create_support_ticket" }, 409);
    }
    if (!ticketId || event !== "message") {
      return json({ error: "bad_request" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: ticket, error: tErr } = await admin
      .from("support_tickets")
      .select("id, subject, requester_user_id, assigned_staff_id, brand_id")
      .eq("id", ticketId)
      .maybeSingle();
    if (tErr) return json({ error: tErr.message }, 500);
    if (!ticket) return json({ error: "ticket_not_found" }, 404);

    const sender = body?.senderUserId ?? null;
    const recipients = new Set<string>();
    const type = "business.support_message";

    if (body?.senderIsStaff === true) {
      // staff reply → notify the requester.
      if (ticket.requester_user_id) {
        recipients.add(ticket.requester_user_id as string);
      }
    } else {
      // requester reply → notify the assignee (if any) + available roster.
      if (ticket.assigned_staff_id) {
        recipients.add(ticket.assigned_staff_id as string);
      }
      for (const id of await availableStaffIds(admin)) recipients.add(id);
    }
    if (sender) recipients.delete(sender);

    const supportSender = typeof body?.senderDisplayName === "string" && body.senderDisplayName.trim()
      ? body.senderDisplayName.trim().slice(0, 120)
      : SUPPORT_HOST_FACING_AGENT;
    const title = body?.senderIsStaff === true
      ? `${supportSender} · ${SUPPORT_HOST_FACING_AGENT}`
      : "Support reply";
    const subj = typeof ticket.subject === "string"
      ? ticket.subject
      : "your request";
    const pushBody = body?.senderIsStaff === true
      ? `${supportSender} replied on: ${subj}`
      : `New message on: ${subj}`;

    let dispatched = 0;
    for (const userId of recipients) {
      try {
        await dispatchNotification({
          userId,
          brandId: (ticket.brand_id as string | null) ?? null,
          type,
          title,
          body: pushBody,
          // IDs only — no message content in the payload (PII boundary).
          data: { ticketId },
          relatedId: ticketId,
          relatedType: "support_ticket",
          // collapse re-deliveries per recipient per ticket-event.
          idempotencyKey: `${type}:${ticketId}:${userId}`,
          deepLink: deepLink(ticketId),
        });
        dispatched += 1;
      } catch (e) {
        console.warn(
          "[notify-support] dispatch failed for",
          userId,
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    return json({ ok: true, event, ticket_id: ticketId, dispatched });
  } catch (e) {
    console.error("[notify-support]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
