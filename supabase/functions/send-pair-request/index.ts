import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendPush } from "../_shared/push-utils.ts";

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

      // Verify friendship
      const { data: friendship } = await adminClient
        .from("friends")
        .select("id")
        .or(
          `and(user_id.eq.${senderId},friend_user_id.eq.${friendUserId}),and(user_id.eq.${friendUserId},friend_user_id.eq.${senderId})`
        )
        .eq("status", "accepted")
        .maybeSingle();

      if (!friendship) {
        return jsonResponse({ error: "User is not your friend" }, 403);
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

      // Send push notification
      await sendPush({
        targetUserId: friendUserId,
        title: `${senderName} wants to pair with you`,
        body: "Accept to start discovering experiences for each other.",
        data: { type: "pair_request", requestId: pairRequest.id, senderId },
      });

      return jsonResponse({
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

        // Check if already friends
        const { data: friendship } = await adminClient
          .from("friends")
          .select("id")
          .or(
            `and(user_id.eq.${senderId},friend_user_id.eq.${targetUserId}),and(user_id.eq.${targetUserId},friend_user_id.eq.${senderId})`
          )
          .eq("status", "accepted")
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

          await sendPush({
            targetUserId,
            title: `${senderName} wants to pair with you`,
            body: "Accept to start discovering experiences for each other.",
            data: { type: "pair_request", requestId: pairRequest.id, senderId },
          });

          return jsonResponse({
            tier: 1,
            requestId: pairRequest.id,
            pillState: "pending_active",
          });
        }

        // Not friends — create friend request + hidden pair request
        // Check/create friend_request
        let friendRequestId: string | null = null;

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

        // Send push for FRIEND request only (pair request is hidden)
        await sendPush({
          targetUserId,
          title: `${senderName} sent you a friend request`,
          body: "Accept to connect on Mingla.",
          data: { type: "friend_request", senderId },
        });

        return jsonResponse({
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
