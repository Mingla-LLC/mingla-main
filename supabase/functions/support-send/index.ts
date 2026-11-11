/**
 * support-send — the one way a person or Support staff adds to a ticket.
 *
 * Body: { ticketId, content?, attachmentIds?: uuid[], isInternal?: boolean,
 *         setWaiting?: { nextUpdateAt, note }, actorMode?: "staff"|"requester" }
 *
 * Allowed senders: the requester or an active member of a brand-visible
 * ticket's brand, or Support staff/admin. Internal notes and "Send and wait"
 * are staff only. The database function issue_4382_post_support_message then
 * checks everything again and writes the message, attaches the files, applies
 * the status rules (#4382: a customer reply reopens a Waiting or Resolved
 * ticket; a closed ticket refuses replies; staff may reply with no promise)
 * and enqueues the Explorer reply push. This function then asks
 * notify-support for the Host and staff fan-out. Internal notes notify nobody.
 *
 * verify_jwt = true (config.toml).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  mapPostError,
  parseSendRequest,
  staffOnlyViolation,
  TICKET_CLOSED_MESSAGE,
} from "./sendLogic.ts";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const parsed = parseSendRequest(await req.json().catch(() => null));
    if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
    const send = parsed.value;
    const { ticketId, actorMode } = send;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: ticket, error: tErr } = await admin
      .from("support_tickets")
      .select("id, requester_user_id, visibility, brand_id, status")
      .eq("id", ticketId)
      .maybeSingle();
    if (tErr) return json({ error: tErr.message }, 500);
    if (!ticket) return json({ error: "ticket_not_found" }, 404);

    // Authorize: requester (own ticket), active brand member of a brand
    // ticket, or staff/admin. Nobody but staff touches an internal ticket.
    const isDirectRequester = ticket.visibility !== "internal" &&
      ticket.requester_user_id === user.id;
    let isBrandRequester = false;
    if (ticket.visibility === "brand" && ticket.brand_id) {
      const { data: membership } = await admin
        .from("brand_team_members")
        .select("id")
        .eq("brand_id", ticket.brand_id)
        .eq("user_id", user.id)
        .not("accepted_at", "is", null)
        .is("removed_at", null)
        .maybeSingle();
      isBrandRequester = membership !== null;
    }
    const isRequester = isDirectRequester || isBrandRequester;
    const [{ data: staff }, { data: adm }] = await Promise.all([
      userClient.rpc("is_support_staff", { p_user_id: user.id }),
      userClient.rpc("is_admin_user"),
    ]);
    const isStaff = staff === true || adm === true;
    if (actorMode === "staff" && !isStaff) return json({ error: "Forbidden" }, 403);
    if (actorMode === "requester" && !isRequester) return json({ error: "Forbidden" }, 403);
    if (actorMode === null && !isRequester && !isStaff) return json({ error: "Forbidden" }, 403);
    // A dual-role account can use the customer composer as the requester and
    // the Support desk as staff. The calling surface makes that intent explicit;
    // older clients are inferred without changing their existing behavior.
    const senderIsStaff = actorMode === "staff" || (actorMode === null && !isRequester && isStaff);
    const staffOnly = staffOnlyViolation(send, senderIsStaff);
    if (staffOnly) return json({ error: staffOnly }, 403);
    if (ticket.status === "closed") {
      return json({ error: "ticket_closed", message: TICKET_CLOSED_MESSAGE }, 409);
    }

    let senderDisplayName: string | null = null;
    if (senderIsStaff) {
      const [{ data: staffIdentity }, { data: profileIdentity }] = await Promise.all([
        admin.from("support_staff").select("display_name").eq("user_id", user.id).maybeSingle(),
        admin.from("profiles").select("display_name, first_name, last_name, username").eq("id", user.id).maybeSingle(),
      ]);
      const profileFullName = [profileIdentity?.first_name, profileIdentity?.last_name]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" ")
        .trim();
      // Hosts must never see a raw staff email as the reply name. Prefer a
      // human label; if every candidate looks like an email, fall back.
      senderDisplayName = [
        staffIdentity?.display_name,
        profileIdentity?.display_name,
        profileFullName,
        profileIdentity?.username,
        user.user_metadata?.full_name,
        user.user_metadata?.name,
        user.user_metadata?.display_name,
      ].find((value) =>
        typeof value === "string" &&
        value.trim().length > 0 &&
        !value.includes("@")
      )?.trim() ?? "Mingla teammate";
    }

    // One atomic write: message + attachments + status + audit + Explorer push.
    const { data: posted, error: postErr } = await admin.rpc(
      "issue_4382_post_support_message",
      {
        p_ticket_id: ticketId,
        p_sender_id: user.id,
        p_as_staff: senderIsStaff,
        p_content: send.content,
        p_attachment_ids: send.attachmentIds,
        p_is_internal: send.isInternal,
        p_wait_until: send.setWaiting?.nextUpdateAt ?? null,
        p_wait_note: send.setWaiting?.note ?? null,
        p_sender_display_name: senderDisplayName,
      },
    );
    if (postErr) {
      const mapped = mapPostError(postErr);
      if (mapped.error === "ticket_closed") {
        return json({ error: "ticket_closed", message: TICKET_CLOSED_MESSAGE }, 409);
      }
      if (mapped.status === 500) console.error("[support-send] post failed", postErr);
      return json({ error: mapped.error }, mapped.status);
    }
    const result = (posted ?? {}) as {
      message_id?: string;
      is_internal?: boolean;
      status?: string;
      previous_status?: string;
      reopened?: boolean;
    };
    const messageId = result.message_id ?? null;

    // Internal notes notify nobody. Everything else: Host requester or brand
    // team push, or the staff reply alerts (D6 / #3988).
    if (result.is_internal !== true) {
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/notify-support`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            event: "message",
            ticketId,
            senderUserId: user.id,
            senderIsStaff,
            senderDisplayName,
            messageId,
          }),
        });
      } catch (pushErr) {
        console.warn(
          "[support-send] notify-support dispatch threw (non-fatal):",
          pushErr instanceof Error ? pushErr.message : String(pushErr),
        );
      }
    }

    return json({
      ok: true,
      ticket_id: ticketId,
      message_id: messageId,
      is_internal: result.is_internal === true,
      status: result.status ?? null,
      previous_status: result.previous_status ?? null,
      reopened: result.reopened === true,
    });
  } catch (e) {
    console.error("[support-send]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
