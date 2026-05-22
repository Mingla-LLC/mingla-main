import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  jsonResponse,
  serviceClient,
  ticketCorsHeaders,
  userClient,
} from "../_shared/ticketCheckout.ts";

interface ClaimRequest {
  claim_token?: string;
  preview?: boolean;
}

interface PendingClaimRow {
  id: string;
  order_id: string;
  event_id: string;
  buyer_email: string;
  claim_token: string;
  events?: {
    title?: string | null;
    cover_media_url?: string | null;
  } | null;
}

interface ClaimedConversation {
  conversation_id: string;
  event_id: string;
  event_name: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: ticketCorsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  let body: ClaimRequest = {};
  try {
    const raw = await req.text();
    if (raw.length > 0) body = JSON.parse(raw) as ClaimRequest;
  } catch (_err) {
    return jsonResponse({ error: "invalid_json_body" }, 400);
  }

  const caller = userClient(req);
  const { data: authData, error: authError } = await caller.auth.getUser();
  const user = authData.user;
  if (authError || user === null) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const email = user.email?.trim().toLowerCase() ?? "";
  if (!body.claim_token && email.length === 0) {
    return jsonResponse({ error: "email_required" }, 400);
  }

  const admin = serviceClient();
  const claimToken =
    typeof body.claim_token === "string" && body.claim_token.trim().length > 0
      ? body.claim_token.trim()
      : null;

  let query = admin
    .from("pending_trip_chat_claims")
    .select("id, order_id, event_id, buyer_email, claim_token, events!inner(title, cover_media_url)")
    .is("claimed_at", null);

  if (claimToken !== null) {
    query = query.eq("claim_token", claimToken).limit(1);
  } else {
    query = query.eq("buyer_email", email);
  }

  const { data: rows, error: rowsError } = await query;
  if (rowsError) {
    console.error("[claim-pending-trip-chat-participation] lookup failed", rowsError);
    return jsonResponse({ error: "claim_lookup_failed" }, 500);
  }

  const claims = ((rows ?? []) as PendingClaimRow[]);

  if (body.preview === true) {
    return jsonResponse({
      claims: claims.map((claim) => ({
        event_id: claim.event_id,
        event_name: claim.events?.title ?? "Trip chat",
        cover_url: claim.events?.cover_media_url ?? null,
      })),
      count: claims.length,
    });
  }

  const claimed: ClaimedConversation[] = [];

  for (const claim of claims) {
    const { data: conv, error: convError } = await admin
      .from("conversations")
      .select("id, event_id, name")
      .eq("event_id", claim.event_id)
      .in("linked_entity_type", ["trip", "event"])
      .maybeSingle();

    if (convError) {
      console.error(
        `[claim-pending-trip-chat-participation] conversation lookup failed claim=${claim.id}`,
        convError,
      );
      continue;
    }
    if (conv === null) continue;

    const { error: participantError } = await admin
      .from("conversation_participants")
      .insert({ conversation_id: conv.id, user_id: user.id });

    if (
      participantError &&
      !participantError.message.includes("duplicate key") &&
      participantError.code !== "23505"
    ) {
      console.error(
        `[claim-pending-trip-chat-participation] participant insert failed claim=${claim.id}`,
        participantError,
      );
      continue;
    }

    const { error: updateError } = await admin
      .from("pending_trip_chat_claims")
      .update({
        claimed_at: new Date().toISOString(),
        claimed_by_user_id: user.id,
      })
      .eq("id", claim.id)
      .is("claimed_at", null);

    if (updateError) {
      console.error(
        `[claim-pending-trip-chat-participation] claim update failed claim=${claim.id}`,
        updateError,
      );
      continue;
    }

    claimed.push({
      conversation_id: conv.id,
      event_id: claim.event_id,
      event_name: conv.name ?? claim.events?.title ?? "Trip chat",
    });
  }

  return jsonResponse({ claimed, count: claimed.length });
});
