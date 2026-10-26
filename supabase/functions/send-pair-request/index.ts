// ORCH-0785: This function does NOT send email despite its name.
// The customer email path is `_shared/email/` + `ticket-confirmation-dispatch`
// (transactional) or `notify-dispatch` with `emailVariant: "generic_notification"`
// (system/relational). Rename deferred to a separate ORCH.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// #1541 — THE SOLE SANCTIONED SMS EGRESS. The Tier-3 branch below used to POST
// to Twilio itself from a RAW `From` number (a TWILIO_FROM_* env var) — not the
// approved Messaging Service — with NO "Reply STOP" line and NO StatusCallback,
// to people who are NOT YET MINGLA USERS. Unapproved sender, no opt-out
// affordance, and no way to capture an inbound STOP: a CTIA and
// carrier-filtering exposure on top of the missing kill switch.
// I-PROPOSED-1161-SMS-FROM-APPROVED-SENDER-ONLY +
// I-PROPOSED-1541-SMS-PROVIDER-EGRESS-ALLOWLIST.
import { smsAdapter } from "../_shared/adapters/smsAdapter.ts";
import { buildFriendInviteOneLink, buildFriendInviteSms } from "../_shared/friendInviteLink.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const E164_REGEX = /^\+[1-9]\d{1,14}$/;

/** Call notify-dispatch edge function instead of sendPush directly */
async function callNotifyDispatch(payload: Record<string, unknown>): Promise<void> {
  const notifyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/notify-dispatch`;
  try {
    const resp = await fetch(notifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "unknown");
      console.warn("[send-pair-request] notify-dispatch returned", resp.status, text);
    }
  } catch (err) {
    console.warn("[send-pair-request] notify-dispatch call failed:", err);
  }
}

// #1541 §4.7 — EXPORTED so the runtime companion test can drive a real Request
// through the real handler and assert on CAPTURED provider HTTP rather than on
// source text. `serve(handler)` below is the same call this module always made.
export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ───────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing or invalid Authorization header" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const senderId = user.id;

    // Admin client for cross-user operations
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    // --- TIER GATING: Pairing limit check ---
    // Issue #4114 (D16): the limit no longer refuses the whole request up
    // front. Adding a friend always works: at the free limit, a person who is
    // not yet a friend still gets the friend request (without the pair) and the
    // response says `pairingLimitReached` so the app can offer Mingla+. A pure
    // pair request to someone who is ALREADY a friend is still refused with
    // `pairing_limit_reached` — there is nothing else to send.
    const { data: pairingAllowed } = await adminClient
      .rpc('check_pairing_allowed', { p_user_id: senderId });

    const canPair = pairingAllowed?.[0]?.allowed === true;
    const pairingLimitResponse = () => jsonResponse({
      error: 'pairing_limit_reached',
      feature: 'pairing',
      message: 'You\'ve reached your free pairing limit. Upgrade to Mingla+ for unlimited pairings.',
      currentTier: pairingAllowed?.[0]?.tier ?? 'free',
      currentCount: pairingAllowed?.[0]?.current_count ?? 0,
      maxAllowed: pairingAllowed?.[0]?.max_allowed ?? 1,
    }, 403);

    // ── Get sender profile ────────────────────────────────────────────────
    const { data: senderProfile } = await adminClient
      .from("profiles")
      .select("first_name, last_name, display_name, phone, referral_code")
      .eq("id", senderId)
      .single();

    const senderName =
      senderProfile?.display_name ||
      [senderProfile?.first_name, senderProfile?.last_name].filter(Boolean).join(" ") ||
      "Someone";

    const senderPhone = senderProfile?.phone;

    // ── Parse request body ────────────────────────────────────────────────
    const body = await req.json();
    const { friendUserId, phoneE164 } = body as {
      friendUserId?: string;
      phoneE164?: string;
    };

    if (!friendUserId && !phoneE164) {
      return jsonResponse({ error: "Must provide either friendUserId or phoneE164" }, 400);
    }

    // ── Shared push payloads (unchanged copy) ─────────────────────────────
    const notifyFriendRequest = (targetUserId: string, friendRequestId: string) =>
      callNotifyDispatch({
        userId: targetUserId,
        type: "friend_request_received",
        title: `${senderName} wants to connect`,
        body: "Tap to accept or pass.",
        data: {
          deepLink: "mingla://connections?tab=requests",
          type: "friend_request",
          requestId: friendRequestId,
          senderId,
        },
        actorId: senderId,
        relatedId: friendRequestId,
        relatedType: "friend_request",
        idempotencyKey: `friend_request_received:${senderId}:${friendRequestId}`,
        pushOverrides: {
          androidChannelId: "social",
          buttons: [
            { id: "accept", text: "Accept" },
            { id: "decline", text: "Decline" },
          ],
        },
      });

    const notifyPairRequest = (targetUserId: string, pairRequestId: string) =>
      callNotifyDispatch({
        userId: targetUserId,
        type: "pair_request_received",
        title: `${senderName} wants to pair with you`,
        body: "Accept to discover experiences for each other.",
        data: {
          deepLink: `mingla://discover?pairRequest=${pairRequestId}`,
          type: "pair_request",
          requestId: pairRequestId,
          senderId,
        },
        actorId: senderId,
        relatedId: pairRequestId,
        relatedType: "pair_request",
        idempotencyKey: `pair_request_received:${senderId}:${pairRequestId}`,
        pushOverrides: {
          androidChannelId: "social",
          buttons: [
            { id: "accept", text: "Accept" },
            { id: "decline", text: "Decline" },
          ],
        },
      });

    const findPendingPairRequest = async (targetUserId: string) => {
      const { data } = await adminClient
        .from("pair_requests")
        .select("id, status")
        .or(
          `and(sender_id.eq.${senderId},receiver_id.eq.${targetUserId}),and(sender_id.eq.${targetUserId},receiver_id.eq.${senderId})`
        )
        .eq("status", "pending")
        .maybeSingle();
      return data;
    };

    const findPairing = async (targetUserId: string) => {
      const uA = senderId < targetUserId ? senderId : targetUserId;
      const uB = senderId < targetUserId ? targetUserId : senderId;
      const { data } = await adminClient
        .from("pairings")
        .select("id")
        .eq("user_a_id", uA)
        .eq("user_b_id", uB)
        .maybeSingle();
      return data;
    };

    const areFriends = async (targetUserId: string) => {
      // limit 1: accept_friend_request_atomic creates bidirectional rows
      const { data } = await adminClient
        .from("friends")
        .select("id")
        .or(
          `and(user_id.eq.${senderId},friend_user_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},friend_user_id.eq.${senderId})`
        )
        .eq("status", "accepted")
        .limit(1)
        .maybeSingle();
      return !!data;
    };

    /** Tier 1: a visible pair request to someone who is already a friend. */
    const pairWithFriend = async (targetUserId: string, pendingPhone: string | null) => {
      if (await findPairing(targetUserId)) {
        return jsonResponse({ error: "Already paired with this user" }, 400);
      }
      if (await findPendingPairRequest(targetUserId)) {
        return jsonResponse({ error: "Already have a pending pair request with this user" }, 400);
      }
      if (!canPair) return pairingLimitResponse();

      const insertRow: Record<string, unknown> = {
        sender_id: senderId,
        receiver_id: targetUserId,
        status: "pending",
        visibility: "visible",
      };
      if (pendingPhone) insertRow.pending_phone_e164 = pendingPhone;
      const { data: pairRequest, error: insertError } = await adminClient
        .from("pair_requests")
        .insert(insertRow)
        .select("id")
        .single();

      if (insertError) {
        console.error("[send-pair-request] Insert error:", insertError);
        return jsonResponse({ error: "Failed to create pair request" }, 500);
      }

      await notifyPairRequest(targetUserId, pairRequest.id);

      return jsonResponse({
        success: true,
        tier: 1,
        requestId: pairRequest.id,
        pillState: "pending_active",
      });
    };

    /**
     * Tier 2: someone on Mingla who is not a friend yet. A friend request plus
     * a pair request hidden until that friend request is accepted. At the free
     * pairing limit (D16) the friend request still goes, without the pair.
     */
    const addFriendAndPair = async (targetUserId: string, pendingPhone: string | null) => {
      if (await findPendingPairRequest(targetUserId)) {
        return jsonResponse({ error: "Already have a pending pair request with this user" }, 400);
      }
      if (await findPairing(targetUserId)) {
        return jsonResponse({ error: "Already paired with this user" }, 400);
      }

      // Find or create the friend_request that gates the pair_request.
      let friendRequestId: string | null = null;
      let createdNewFriendRequest = false;

      const { data: existingFR } = await adminClient
        .from("friend_requests")
        .select("id, status")
        .eq("sender_id", senderId)
        .eq("receiver_id", targetUserId)
        .maybeSingle();

      if (existingFR) {
        friendRequestId = existingFR.id;
        if (existingFR.status === "declined") {
          // Adding again re-asks: the old declined row goes back to pending
          // (one row per sender/receiver, so a fresh insert would collide).
          const { error: reopenError } = await adminClient
            .from("friend_requests")
            .update({ status: "pending", updated_at: new Date().toISOString() })
            .eq("id", existingFR.id);
          if (reopenError) {
            console.error("[send-pair-request] Friend request reopen error:", reopenError);
            return jsonResponse({ error: "Failed to create friend request" }, 500);
          }
          createdNewFriendRequest = true;
        }
      } else {
        const { data: reverseFR } = await adminClient
          .from("friend_requests")
          .select("id, status")
          .eq("sender_id", targetUserId)
          .eq("receiver_id", senderId)
          .eq("status", "pending")
          .maybeSingle();

        if (reverseFR) {
          friendRequestId = reverseFR.id;
        } else {
          const { data: newFR, error: frError } = await adminClient
            .from("friend_requests")
            .insert({
              sender_id: senderId,
              receiver_id: targetUserId,
              status: "pending",
            })
            .select("id")
            .single();

          if (frError) {
            console.error("[send-pair-request] Friend request error:", frError);
            return jsonResponse({ error: "Failed to create friend request" }, 500);
          }
          friendRequestId = newFR.id;
          createdNewFriendRequest = true;
        }
      }

      let pairRequestId: string | null = null;
      if (canPair) {
        const insertRow: Record<string, unknown> = {
          sender_id: senderId,
          receiver_id: targetUserId,
          status: "pending",
          visibility: "hidden_until_friend",
          gated_by_friend_request_id: friendRequestId,
        };
        if (pendingPhone) insertRow.pending_phone_e164 = pendingPhone;
        const { data: pairRequest, error: prError } = await adminClient
          .from("pair_requests")
          .insert(insertRow)
          .select("id")
          .single();

        if (prError) {
          console.error("[send-pair-request] Pair request error:", prError);
          return jsonResponse({ error: "Failed to create pair request" }, 500);
        }
        pairRequestId = pairRequest.id;
      }

      // Only send push if we created a NEW friend request (not reused an existing one)
      if (createdNewFriendRequest && friendRequestId) {
        await notifyFriendRequest(targetUserId, friendRequestId);
      }

      if (!canPair) {
        return jsonResponse({
          success: true,
          tier: 2,
          friendRequestId,
          friendOnly: true,
          pairingLimitReached: true,
          pillState: null,
          message: "Friend request sent without a pair: free pairing limit reached",
        });
      }

      return jsonResponse({
        success: true,
        tier: 2,
        requestId: pairRequestId,
        friendRequestId,
        pillState: "greyed_waiting_friend",
        message: "Pair request created (hidden until friend request accepted)",
      });
    };

    // ═══════════════════════════════════════════════════════════════════════
    // TIER 1 / 2: a known Mingla user, by id
    // ═══════════════════════════════════════════════════════════════════════
    if (friendUserId) {
      if (friendUserId === senderId) {
        return jsonResponse({ error: "Cannot pair with yourself" }, 400);
      }
      return (await areFriends(friendUserId))
        ? await pairWithFriend(friendUserId, null)
        : await addFriendAndPair(friendUserId, null);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // TIER 2 or TIER 3: Phone-based pair request
    // ═══════════════════════════════════════════════════════════════════════
    if (phoneE164) {
      // Validate E.164 format
      if (!E164_REGEX.test(phoneE164)) {
        return jsonResponse({ error: "Invalid phone number format" }, 400);
      }

      // Check not sender's own phone
      if (senderPhone && senderPhone === phoneE164) {
        return jsonResponse({ error: "Cannot pair with yourself" }, 400);
      }

      // Look up phone in profiles
      const { data: targetProfile } = await adminClient
        .from("profiles")
        .select("id, first_name, last_name, display_name")
        .eq("phone", phoneE164)
        .maybeSingle();

      if (targetProfile) {
        const targetUserId = targetProfile.id;
        if (targetUserId === senderId) {
          return jsonResponse({ error: "Cannot pair with yourself" }, 400);
        }
        return (await areFriends(targetUserId))
          ? await pairWithFriend(targetUserId, phoneE164)
          : await addFriendAndPair(targetUserId, phoneE164);
      }

      // ── TIER 3: Phone not found — invite non-Mingla user ──────────────
      // Rate limit: max 10 invites in the last 24 hours
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { count: recentInviteCount } = await adminClient
        .from("pending_pair_invites")
        .select("*", { count: "exact", head: true })
        .eq("inviter_id", senderId)
        .gte("created_at", twentyFourHoursAgo);

      if ((recentInviteCount || 0) >= 10) {
        return jsonResponse({ error: "Too many pair invites. Try again tomorrow." }, 429);
      }

      // UPSERT pending_pair_invite. Inviting the same number again updates the
      // existing invite (same row, same token) instead of creating a second one.
      // Issue #4114: the invite stays a friend + pair invite at the free limit
      // too; the pair is checked again when it is accepted (ORCH-1239), and the
      // response flags the limit so the app can say so.
      const { data: invite, error: inviteError } = await adminClient
        .from("pending_pair_invites")
        .upsert(
          {
            inviter_id: senderId,
            phone_e164: phoneE164,
            status: "pending",
          },
          { onConflict: "inviter_id,phone_e164" }
        )
        .select("id, token")
        .single();

      if (inviteError) {
        console.error("[send-pair-request] Invite error:", inviteError);
        return jsonResponse({ error: "Failed to create invite" }, 500);
      }

      // Issue #4114: the link is the go.usemingla.com OneLink carrying this
      // invite's token (it used to point at a domain with no DNS records).
      const inviteLink = buildFriendInviteOneLink({
        token: (invite as { token?: string | null }).token ?? null,
        referralCode: senderProfile?.referral_code ?? null,
      });

      // #1541 — the inline Twilio block that lived here is GONE, including
      // its TWILIO_FROM_* env read and the raw `From:` param. NO RAW `From` SURVIVES
      // ANYWHERE IN THIS FILE (F-3).
      //
      // §4.0 — the ONE call shape. The body comes from the one approved
      // template, WITHOUT a STOP footer: the adapter appends it. countryCode is
      // omitted (the destination handset is the routing authority, #1529);
      // messagingServiceSid is omitted, and that omission is exactly what
      // retires the raw sender — it selects the approved transactional
      // toll-free, and no code path to anything else remains.
      //
      // THE BEST-EFFORT CONTRACT IS PRESERVED. The `pending_pair_invites`
      // upsert above stays AHEAD of the send, and the request never fails
      // because the text did. Issue #4114: the outcome is now RETURNED
      // (`smsStatus`), so the app only says "Invite texted" when it was sent and
      // offers the share sheet otherwise (no silent failure).
      let smsStatus: "sent" | "failed" = "failed";
      let smsProviderStatus = "error";
      try {
        const smsBody = buildFriendInviteSms(senderName, inviteLink);
        const smsResult = await smsAdapter.send({
          to: phoneE164,
          brandName: "Mingla",
          message: smsBody,
        });
        smsProviderStatus = String(smsResult.status);
        smsStatus = smsResult.status === "sent" ? "sent" : "failed";
        console.info(
          JSON.stringify({
            event: "pair_invite_sms",
            status: smsResult.status,
            error: smsResult.error ?? null,
          }),
        );
      } catch (smsErr) {
        console.error("[send-pair-request] SMS send error:", smsErr);
        // Don't fail the request if SMS fails.
      }

      return jsonResponse({
        tier: 3,
        inviteId: invite.id,
        pillState: "greyed_waiting_signup",
        smsStatus,
        smsProviderStatus,
        inviteLink,
        pairingLimitReached: !canPair,
      });
    }

    return jsonResponse({ error: "Must provide either friendUserId or phoneE164" }, 400);
  } catch (err: unknown) {
    console.error("[send-pair-request] Unhandled error:", err);
    return jsonResponse(
      { error: (err as Error).message || "Internal server error" },
      500
    );
  }
};

serve(handler);
