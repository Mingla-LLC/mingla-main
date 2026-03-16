import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

serve(async (req) => {
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

    // --- TIER GATING: Pairing is Elite-only ---
    const { data: pairingAllowed } = await adminClient
      .rpc('check_pairing_allowed', { p_user_id: senderId });

    if (!pairingAllowed?.[0]?.allowed) {
      return jsonResponse({
        error: 'elite_required',
        feature: 'pairing',
        message: 'Pairing is an Elite feature. Upgrade to connect with people.',
        currentTier: pairingAllowed?.[0]?.tier ?? 'free',
      }, 403);
    }

    // ── Get sender profile ────────────────────────────────────────────────
    const { data: senderProfile } = await adminClient
      .from("profiles")
      .select("first_name, last_name, display_name, phone")
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

    // ═══════════════════════════════════════════════════════════════════════
    // TIER 1: Direct pair request to an existing friend
    // ═══════════════════════════════════════════════════════════════════════
    if (friendUserId) {
      if (friendUserId === senderId) {
        return jsonResponse({ error: "Cannot pair with yourself" }, 400);
      }

      // Verify friendship (limit 1: accept_friend_request_atomic creates bidirectional rows)
      const { data: friendship } = await adminClient
        .from("friends")
        .select("id")
        .or(
          `and(user_id.eq.${senderId},friend_user_id.eq.${friendUserId}),and(user_id.eq.${friendUserId},friend_user_id.eq.${senderId})`
        )
        .eq("status", "accepted")
        .limit(1)
        .maybeSingle();

      if (!friendship) {
        // ── TIER 2 FALLTHROUGH: Not friends yet — create hidden pair request ──
        // Reuse the Tier 2 logic but skip the phone lookup since we already
        // have the target user ID.

        // Check for existing pending pair request (either direction)
        const { data: existingRequest2 } = await adminClient
          .from("pair_requests")
          .select("id, status")
          .or(
            `and(sender_id.eq.${senderId},receiver_id.eq.${friendUserId}),and(sender_id.eq.${friendUserId},receiver_id.eq.${senderId})`
          )
          .eq("status", "pending")
          .maybeSingle();

        if (existingRequest2) {
          return jsonResponse({ error: "Already have a pending pair request with this user" }, 400);
        }

        // Check for existing pairing
        const uA2 = senderId < friendUserId ? senderId : friendUserId;
        const uB2 = senderId < friendUserId ? friendUserId : senderId;

        const { data: existingPairing2 } = await adminClient
          .from("pairings")
          .select("id")
          .eq("user_a_id", uA2)
          .eq("user_b_id", uB2)
          .maybeSingle();

        if (existingPairing2) {
          return jsonResponse({ error: "Already paired with this user" }, 400);
        }

        // Find or create the friend_request to gate the pair_request
        let friendRequestId: string | null = null;
        let createdNewFriendRequest = false;

        const { data: existingFR } = await adminClient
          .from("friend_requests")
          .select("id, status")
          .eq("sender_id", senderId)
          .eq("receiver_id", friendUserId)
          .eq("status", "pending")
          .maybeSingle();

        if (existingFR) {
          friendRequestId = existingFR.id;
        } else {
          // Check reverse direction
          const { data: reverseFR } = await adminClient
            .from("friend_requests")
            .select("id, status")
            .eq("sender_id", friendUserId)
            .eq("receiver_id", senderId)
            .eq("status", "pending")
            .maybeSingle();

          if (reverseFR) {
            friendRequestId = reverseFR.id;
          } else {
            // Create new friend request
            const { data: newFR, error: frError } = await adminClient
              .from("friend_requests")
              .insert({
                sender_id: senderId,
                receiver_id: friendUserId,
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

        // Create hidden pair request gated by the friend request
        const { data: pairRequest2, error: prError2 } = await adminClient
          .from("pair_requests")
          .insert({
            sender_id: senderId,
            receiver_id: friendUserId,
            status: "pending",
            visibility: "hidden_until_friend",
            gated_by_friend_request_id: friendRequestId,
          })
          .select("id")
          .single();

        if (prError2) {
          console.error("[send-pair-request] Pair request error:", prError2);
          return jsonResponse({ error: "Failed to create pair request" }, 500);
        }

        // Only send push if we created a NEW friend request (not reused an existing one)
        if (createdNewFriendRequest) {
          await callNotifyDispatch({
            userId: friendUserId,
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
        }

        return jsonResponse({
          success: true,
          tier: 2,
          requestId: pairRequest2.id,
          pillState: "greyed_waiting_friend",
          message: "Pair request created (hidden until friend request accepted)",
        });
      }

      // Check for existing pairing
      const uA = senderId < friendUserId ? senderId : friendUserId;
      const uB = senderId < friendUserId ? friendUserId : senderId;

      const { data: existingPairing } = await adminClient
        .from("pairings")
        .select("id")
        .eq("user_a_id", uA)
        .eq("user_b_id", uB)
        .maybeSingle();

      if (existingPairing) {
        return jsonResponse({ error: "Already paired with this user" }, 400);
      }

      // Check for existing pending pair request (either direction)
      const { data: existingRequest } = await adminClient
        .from("pair_requests")
        .select("id, status")
        .or(
          `and(sender_id.eq.${senderId},receiver_id.eq.${friendUserId}),and(sender_id.eq.${friendUserId},receiver_id.eq.${senderId})`
        )
        .eq("status", "pending")
        .maybeSingle();

      if (existingRequest) {
        return jsonResponse({ error: "Already have a pending pair request with this user" }, 400);
      }

      // Create pair request
      const { data: pairRequest, error: insertError } = await adminClient
        .from("pair_requests")
        .insert({
          sender_id: senderId,
          receiver_id: friendUserId,
          status: "pending",
          visibility: "visible",
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("[send-pair-request] Insert error:", insertError);
        return jsonResponse({ error: "Failed to create pair request" }, 500);
      }

      // Send push notification via notify-dispatch
      await callNotifyDispatch({
        userId: friendUserId,
        type: "pair_request_received",
        title: `${senderName} wants to pair with you`,
        body: "Accept to discover experiences for each other.",
        data: {
          deepLink: `mingla://discover?pairRequest=${pairRequest.id}`,
          type: "pair_request",
          requestId: pairRequest.id,
          senderId,
        },
        actorId: senderId,
        relatedId: pairRequest.id,
        relatedType: "pair_request",
        idempotencyKey: `pair_request_received:${senderId}:${pairRequest.id}`,
        pushOverrides: {
          androidChannelId: "social",
          buttons: [
            { id: "accept", text: "Accept" },
            { id: "decline", text: "Decline" },
          ],
        },
      });

      return jsonResponse({
        success: true,
        tier: 1,
        requestId: pairRequest.id,
        pillState: "pending_active",
      });
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
        // ── TIER 2: Mingla user found via phone ────────────────────────
        const targetUserId = targetProfile.id;

        if (targetUserId === senderId) {
          return jsonResponse({ error: "Cannot pair with yourself" }, 400);
        }

        // Check existing pairing
        const uA = senderId < targetUserId ? senderId : targetUserId;
        const uB = senderId < targetUserId ? targetUserId : senderId;

        const { data: existingPairing } = await adminClient
          .from("pairings")
          .select("id")
          .eq("user_a_id", uA)
          .eq("user_b_id", uB)
          .maybeSingle();

        if (existingPairing) {
          return jsonResponse({ error: "Already paired with this user" }, 400);
        }

        // Check existing pending pair request (either direction)
        const { data: existingRequest } = await adminClient
          .from("pair_requests")
          .select("id, status")
          .or(
            `and(sender_id.eq.${senderId},receiver_id.eq.${targetUserId}),and(sender_id.eq.${targetUserId},receiver_id.eq.${senderId})`
          )
          .eq("status", "pending")
          .maybeSingle();

        if (existingRequest) {
          return jsonResponse({ error: "Already have a pending pair request with this user" }, 400);
        }

        // Check if already friends (limit 1: bidirectional rows)
        const { data: friendship } = await adminClient
          .from("friends")
          .select("id")
          .or(
            `and(user_id.eq.${senderId},friend_user_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},friend_user_id.eq.${senderId})`
          )
          .eq("status", "accepted")
          .limit(1)
          .maybeSingle();

        if (friendship) {
          // Already friends — use Tier 1 logic (visible pair request)
          const { data: pairRequest, error: insertError } = await adminClient
            .from("pair_requests")
            .insert({
              sender_id: senderId,
              receiver_id: targetUserId,
              status: "pending",
              visibility: "visible",
              pending_phone_e164: phoneE164,
            })
            .select("id")
            .single();

          if (insertError) {
            console.error("[send-pair-request] Insert error:", insertError);
            return jsonResponse({ error: "Failed to create pair request" }, 500);
          }

          await callNotifyDispatch({
            userId: targetUserId,
            type: "pair_request_received",
            title: `${senderName} wants to pair with you`,
            body: "Accept to discover experiences for each other.",
            data: {
              deepLink: `mingla://discover?pairRequest=${pairRequest.id}`,
              type: "pair_request",
              requestId: pairRequest.id,
              senderId,
            },
            actorId: senderId,
            relatedId: pairRequest.id,
            relatedType: "pair_request",
            idempotencyKey: `pair_request_received:${senderId}:${pairRequest.id}`,
            pushOverrides: {
              androidChannelId: "social",
              buttons: [
                { id: "accept", text: "Accept" },
                { id: "decline", text: "Decline" },
              ],
            },
          });

          return jsonResponse({
            success: true,
            tier: 1,
            requestId: pairRequest.id,
            pillState: "pending_active",
          });
        }

        // Not friends — create friend request + hidden pair request
        // Check/create friend_request
        let friendRequestId: string | null = null;
        let createdNewFR = false;

        const { data: existingFR } = await adminClient
          .from("friend_requests")
          .select("id, status")
          .eq("sender_id", senderId)
          .eq("receiver_id", targetUserId)
          .maybeSingle();

        if (existingFR) {
          friendRequestId = existingFR.id;
        } else {
          // Also check reverse direction
          const { data: reverseFR } = await adminClient
            .from("friend_requests")
            .select("id, status")
            .eq("sender_id", targetUserId)
            .eq("receiver_id", senderId)
            .maybeSingle();

          if (reverseFR) {
            friendRequestId = reverseFR.id;
          } else {
            // Create new friend request
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
            createdNewFR = true;
          }
        }

        // Create hidden pair request
        const { data: pairRequest, error: prError } = await adminClient
          .from("pair_requests")
          .insert({
            sender_id: senderId,
            receiver_id: targetUserId,
            status: "pending",
            visibility: "hidden_until_friend",
            gated_by_friend_request_id: friendRequestId,
            pending_phone_e164: phoneE164,
          })
          .select("id")
          .single();

        if (prError) {
          console.error("[send-pair-request] Pair request error:", prError);
          return jsonResponse({ error: "Failed to create pair request" }, 500);
        }

        // Only send push if we created a NEW friend request (not reused an existing one)
        if (createdNewFR) {
          await callNotifyDispatch({
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
        }

        return jsonResponse({
          success: true,
          tier: 2,
          requestId: pairRequest.id,
          pillState: "greyed_waiting_friend",
        });
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

      // UPSERT pending_pair_invite
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
        .select("id")
        .single();

      if (inviteError) {
        console.error("[send-pair-request] Invite error:", inviteError);
        return jsonResponse({ error: "Failed to create invite" }, 500);
      }

      // Send SMS via Twilio
      const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
      const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
      const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER");

      if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER) {
        try {
          const smsBody = `${senderName} wants to pair with you on Mingla! Download the app to connect: https://mingla.app`;
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

          const twilioResponse = await fetch(twilioUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization:
                "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
            },
            body: new URLSearchParams({
              To: phoneE164,
              From: TWILIO_FROM_NUMBER,
              Body: smsBody,
            }).toString(),
          });

          if (!twilioResponse.ok) {
            const errText = await twilioResponse.text();
            console.error("[send-pair-request] Twilio error:", errText);
          } else {
            console.log(`[send-pair-request] SMS sent to ${phoneE164}`);
          }
        } catch (smsErr) {
          console.error("[send-pair-request] SMS send error:", smsErr);
          // Don't fail the request if SMS fails
        }
      } else {
        console.warn("[send-pair-request] Twilio credentials not configured, skipping SMS");
      }

      return jsonResponse({
        tier: 3,
        inviteId: invite.id,
        pillState: "greyed_waiting_signup",
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
});
