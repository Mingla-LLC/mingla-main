/**
 * META-ORCH-1104 Phase 0 — notify-support (INTERNAL push fan-out, D6).
 *
 * Service-role producer invoked by support-send. verify_jwt = false
 * (config.toml) — authenticated by the
 * service-role bearer the caller passes; rejects any request without it.
 *
 * Fan-out rules:
 *   event = 'message'    → staff reply  → push the requester (business.support_message);
 *                          requester reply → #3988: one outbox row per roster
 *                          member + assignee (minus the sender) through
 *                          issue_3988_enqueue_support_reply_alerts
 *                          (business.support_ticket_reply: in-app + email for
 *                          everyone, push for the available roster and the
 *                          assignee). If that enqueue cannot run (no message id
 *                          from an older caller, or a database error), the old
 *                          push to the assignee + available roster
 *                          (issue_3988_support_alert_recipients) still goes out.
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
import { availableStaffIds } from "./alertRecipients.ts";
import { enqueueReplyAlerts } from "./replyAlerts.ts";

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
        messageId?: string | null;
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
      .select("id, subject, requester_user_id, assigned_staff_id, brand_id, audience")
      .eq("id", ticketId)
      .maybeSingle();
    if (tErr) return json({ error: tErr.message }, 500);
    if (!ticket) return json({ error: "ticket_not_found" }, 404);

    const sender = body?.senderUserId ?? null;
    const recipients = new Set<string>();
    const type = "business.support_message";

    if (body?.senderIsStaff === true) {
      // A brand-visible case belongs to the active team, not the staff creator.
      if (ticket.audience === "brand" && ticket.brand_id) {
        const { data: members } = await admin
          .from("brand_team_members")
          .select("user_id")
          .eq("brand_id", ticket.brand_id)
          .not("accepted_at", "is", null)
          .is("removed_at", null);
        for (const member of members ?? []) if (member.user_id) recipients.add(member.user_id as string);
      } else if (ticket.requester_user_id) {
        recipients.add(ticket.requester_user_id as string);
      }
    } else {
      // #3988 — requester reply → the outbox owns the whole fan-out.
      const enqueued = await enqueueReplyAlerts(admin, {
        ticketId,
        messageId: body?.messageId ?? null,
        senderUserId: sender,
      });
      if (enqueued.ok) {
        return json({
          ok: true,
          event,
          ticket_id: ticketId,
          enqueued: enqueued.count,
        });
      }
      // Fallback, never silence: the old push to assignee + available roster.
      console.warn("[notify-support] reply alerts fell back to push", {
        ticket_id: ticketId,
        reason: enqueued.reason,
      });
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
          // Collapse retries of this message without suppressing later replies
          // on the same ticket. The ticket id supports older internal callers.
          idempotencyKey: `${type}:${body?.messageId ?? ticketId}:${userId}`,
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
