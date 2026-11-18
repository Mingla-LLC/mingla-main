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
    brand_id?: string | null;
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
    .select("id, order_id, event_id, buyer_email, claim_token, events!inner(title, cover_media_url, brand_id)")
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

  // #4459: a claimed booking lands in the brand's one Guest chat (every listing
  // type). The claim row is marked first — it is what makes an unbound guest
  // checkout eligible — then the same server helper every booking rail uses
  // (issue_4459_sync_brand_guest, behind add_buyer_to_event_chat) adds the
  // member. Nothing here writes a participant row directly.
  for (const claim of claims) {
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

    const brandId = claim.events?.brand_id ?? null;
    if (brandId === null) continue;
    const { error: joinError } = await admin.rpc("issue_4459_sync_brand_guest", {
      p_brand_id: brandId,
      p_user_id: user.id,
    });
    if (joinError) {
      console.error(
        `[claim-pending-trip-chat-participation] guest chat join failed claim=${claim.id}`,
        joinError,
      );
      continue;
    }

    const { data: conv, error: convError } = await admin
      .from("conversations")
      .select("id, name")
      .eq("brand_id", brandId)
      .eq("linked_entity_type", "brand_guests")
      .maybeSingle();
    if (convError) {
      console.error(
        `[claim-pending-trip-chat-participation] guest chat lookup failed claim=${claim.id}`,
        convError,
      );
      continue;
    }
    if (conv === null) continue;
    const { data: membership } = await admin
      .from("conversation_participants")
      .select("conversation_id")
      .eq("conversation_id", conv.id)
      .eq("user_id", user.id)
      .maybeSingle();
    // Left or removed earlier: the claim is recorded, but no chat is reported.
    if (membership === null) continue;

    claimed.push({
      conversation_id: conv.id,
      event_id: claim.event_id,
      event_name: claim.events?.title ?? conv.name ?? "Guest chat",
    });
  }

  return jsonResponse({ claimed, count: claimed.length });
});
