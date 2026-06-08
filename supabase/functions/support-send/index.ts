/**
 * META-ORCH-1104 Phase 0 — support-send.
 *
 * Inserts a message into a support ticket's conversation. Allowed senders:
 * the requester (their own ticket) OR support staff/admin. Side effects:
 *   - sets first_response_at on the FIRST staff message;
 *   - bumps last_message_at (the queue sort key);
 *   - dispatches push via the internal notify-support fan-out (D6).
 *
 * Staff inserts go through the option-b RLS INSERT policy (the user client, so
 * the messages_support_staff_insert + restrictive broadcast-only policies both
 * apply); the requester inserts as a participant. Status side-effects + the
 * last_message_at/first_response_at bump use the service-role client.
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

const VALID_MESSAGE_TYPES = ["text", "image", "file"] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "No authorization header" }, 401);

    const body = await req.json().catch(() => null) as
      | { ticketId?: unknown; content?: unknown; messageType?: unknown }
      | null;
    const ticketId = body?.ticketId;
    if (!isUuid(ticketId)) return json({ error: "ticketId_required" }, 400);
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    if (content.length === 0) return json({ error: "content_required" }, 400);
    const messageTypeRaw = typeof body?.messageType === "string" ? body.messageType : "text";
    const messageType = (VALID_MESSAGE_TYPES as readonly string[]).includes(messageTypeRaw)
      ? messageTypeRaw
      : "text";

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Resolve the ticket + its conversation. service-role read so we have the
    // requester/assignee regardless of the caller's RLS view.
    const { data: ticket, error: tErr } = await admin
      .from("support_tickets")
      .select("id, requester_user_id, assigned_staff_id, conversation_id, first_response_at")
      .eq("id", ticketId)
      .maybeSingle();
    if (tErr) return json({ error: tErr.message }, 500);
    if (!ticket) return json({ error: "ticket_not_found" }, 404);

    // Authorize: requester (own ticket) OR staff/admin.
    const isRequester = ticket.requester_user_id === user.id;
    let isStaff = false;
    if (!isRequester) {
      const [{ data: staff }, { data: adm }] = await Promise.all([
        userClient.rpc("is_support_staff", { p_user_id: user.id }),
        userClient.rpc("is_admin_user"),
      ]);
      isStaff = staff === true || adm === true;
    }
    if (!isRequester && !isStaff) return json({ error: "Forbidden" }, 403);

    // Insert the message. Use the USER client so the RLS INSERT policies
    // (participant path for the requester, messages_support_staff_insert for
    // staff) AND the restrictive broadcast-only policy both apply (defense in
    // depth — the same auth.uid() that passed the gate above).
    const { data: inserted, error: insErr } = await userClient
      .from("messages")
      .insert({
        conversation_id: ticket.conversation_id,
        sender_id: user.id,
        content,
        message_type: messageType,
      })
      .select("id")
      .single();
    if (insErr) return json({ error: insErr.message }, 403);

    // Side-effects (service-role): bump last_message_at; set first_response_at
    // on the FIRST staff message.
    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = { last_message_at: nowIso };
    if (isStaff && !ticket.first_response_at) {
      patch.first_response_at = nowIso;
    }
    await admin.from("support_tickets").update(patch).eq("id", ticketId);

    await admin.from("support_audit_log").insert({
      actor_user_id: user.id,
      action: isStaff ? "staff_reply" : "requester_reply",
      ticket_id: ticketId,
      metadata: { message_id: inserted?.id ?? null },
    });

    // Push fan-out (D6) — internal notify-support producer, service-role bearer.
    // staff reply → push the requester; requester reply → push staff (assignee +
    // available roster). Non-fatal: a push failure never fails the send.
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
          senderIsStaff: isStaff,
        }),
      });
    } catch (pushErr) {
      console.warn(
        "[support-send] notify-support dispatch threw (non-fatal):",
        pushErr instanceof Error ? pushErr.message : String(pushErr),
      );
    }

    return json({ ok: true, ticket_id: ticketId, message_id: inserted?.id ?? null });
  } catch (e) {
    console.error("[support-send]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
