import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CollaborationInvitePayload {
  inviterId: string;
  invitedUserId: string;
  invitedUserEmail: string;
  sessionId: string;
  sessionName: string;
  inviteId?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: CollaborationInvitePayload = await req.json();
    const {
      inviterId,
      invitedUserId,
      invitedUserEmail,
      sessionId,
      sessionName,
      inviteId,
    } = payload;

    // Validate required fields
    if (!inviterId || !invitedUserEmail || !sessionId || !sessionName) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not set");
      return new Response(
        JSON.stringify({ error: "Email service not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY"
    )!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get inviter's profile
    const { data: inviterProfile } = await supabase
      .from("profiles")
      .select("display_name, first_name, last_name, username")
      .eq("id", inviterId)
      .single();

    const inviterName =
      inviterProfile?.display_name ||
      (inviterProfile?.first_name && inviterProfile?.last_name
        ? `${inviterProfile.first_name} ${inviterProfile.last_name}`
        : inviterProfile?.username || "Someone");

    const inviterUsername = inviterProfile?.username || "user";

    // Get invited user's profile to check if they exist
    const { data: invitedUserProfile } = await supabase
      .from("profiles")
      .select("id, username, email")
      .eq("id", invitedUserId)
      .maybeSingle();

    const userExists = !!invitedUserProfile;
    const invitedUsername = invitedUserProfile?.username;

    // Generate invite link
    let inviteLink = "";
    if (userExists && inviteId) {
      inviteLink = `https://mingla.app/collaboration/invite/${inviteId}`;
    }

    // Email content
    const emailSubject = `${inviterName} invited you to join "${sessionName}" on Mingla`;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Collaboration Invite on Mingla</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #eb7825 0%, #d6691f 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">Collaboration Invite</h1>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="font-size: 16px; margin-bottom: 20px;">
            Hi ${invitedUsername || invitedUserEmail.split("@")[0]},
          </p>
          <p style="font-size: 16px; margin-bottom: 20px;">
            <strong>${inviterName}</strong> (@${inviterUsername}) invited you to join a collaboration session:
          </p>
          <div style="background: #F9FAFB; border-left: 4px solid #eb7825; padding: 20px; margin: 20px 0; border-radius: 8px;">
            <h2 style="font-size: 20px; margin: 0 0 10px 0; color: #111827;">${sessionName}</h2>
            <p style="font-size: 14px; color: #6B7280; margin: 0;">
              Plan experiences and discover activities together with your friends!
            </p>
          </div>
          ${
            userExists
              ? `
            <div style="text-align: center; margin: 30px 0;">
              <a href="${inviteLink || "https://mingla.app"}" 
                 style="display: inline-block; background: #eb7825; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                View Invite in App
              </a>
            </div>
            <p style="font-size: 14px; color: #6B7280; margin-top: 30px; text-align: center;">
              Open the Mingla app, log in, and go to <strong>Collaboration → Invites</strong> to accept this invitation.
            </p>
          `
              : `
            <div style="text-align: center; margin: 30px 0;">
              <a href="https://mingla.app/download" 
                 style="display: inline-block; background: #eb7825; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; margin-bottom: 10px;">
                Download Mingla
              </a>
            </div>
            <div style="background: #FEF3E7; border: 1px solid #eb7825; border-radius: 8px; padding: 15px; margin: 20px 0;">
              <p style="font-size: 14px; color: #111827; margin: 0;">
                <strong>What is Mingla?</strong><br>
                Mingla is a social discovery app that helps you find and plan experiences with friends. Download the app to join ${inviterName}'s collaboration session and start exploring together!
              </p>
            </div>
          `
          }
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">
          <p style="font-size: 12px; color: #9CA3AF; text-align: center;">
            This email was sent because ${inviterName} invited you to a collaboration session. If you didn't expect this, you can safely ignore it.
          </p>
        </div>
      </body>
      </html>
    `;

    // Send email via Resend
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Mingla <noreply@planmydetty.com>",
        to: invitedUserEmail,
        subject: emailSubject,
        html: emailHtml,
      }),
    });

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text();
      console.error("Resend API error:", errorText);
      throw new Error(
        `Failed to send email: ${resendResponse.status} ${errorText}`
      );
    }

    const resendData = await resendResponse.json();
    console.log("Email sent successfully:", resendData);

    // Send push notifications to both inviter and invitee
    // 1. Send notification to the INVITED USER (receiver)
    if (userExists && invitedUserId) {
      try {
        // Get invitee's push token - check both possible table names
        let pushToken = null;

        // Try user_push_tokens table first
        const { data: tokenData } = await supabase
          .from("user_push_tokens")
          .select("push_token")
          .eq("user_id", invitedUserId)
          .single();

        if (tokenData?.push_token) {
          pushToken = tokenData.push_token;
        } else {
          // Try profiles table for expo_push_token
          const { data: profileData } = await supabase
            .from("profiles")
            .select("expo_push_token")
            .eq("id", invitedUserId)
            .single();

          if (profileData?.expo_push_token) {
            pushToken = profileData.expo_push_token;
          }
        }

        if (pushToken) {
          // Send push notification via Expo to INVITEE
          const pushResponse = await fetch(
            "https://exp.host/--/api/v2/push/send",
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Accept-encoding": "gzip, deflate",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                to: pushToken,
                sound: "default",
                title: "New Collaboration Invite",
                body: `${inviterUsername} invited you to join "${sessionName}"`,
                data: {
                  type: "collaboration_invite_received",
                  sessionId: sessionId,
                  sessionName: sessionName,
                  inviteId: inviteId,
                  inviterId: inviterId,
                  inviterUsername: inviterUsername,
                },
                channelId: "collaboration-invites",
              }),
            }
          );

          const pushResult = await pushResponse.json();
          if (
            pushResult.data &&
            pushResult.data[0] &&
            pushResult.data[0].status === "ok"
          ) {
            console.log("Push notification sent to invitee successfully");
          } else {
            console.error("Failed to send push notification to invitee:", pushResult);
          }
        } else {
          console.log("No push token found for invitee:", invitedUserId);
        }
      } catch (pushError) {
        console.error("Error sending push notification to invitee:", pushError);
        // Don't fail the whole request if push notification fails
      }
    }

    // 2. Send notification to the INVITER (sender)
    if (inviterId) {
      try {
        // Get inviter's push token
        let inviterPushToken = null;

        // Try user_push_tokens table first
        const { data: inviterTokenData } = await supabase
          .from("user_push_tokens")
          .select("push_token")
          .eq("user_id", inviterId)
          .single();

        if (inviterTokenData?.push_token) {
          inviterPushToken = inviterTokenData.push_token;
        } else {
          // Try profiles table for expo_push_token
          const { data: inviterProfileData } = await supabase
            .from("profiles")
            .select("expo_push_token")
            .eq("id", inviterId)
            .single();

          if (inviterProfileData?.expo_push_token) {
            inviterPushToken = inviterProfileData.expo_push_token;
          }
        }

        if (inviterPushToken && invitedUsername) {
          // Send push notification via Expo to INVITER
          const inviterPushResponse = await fetch(
            "https://exp.host/--/api/v2/push/send",
            {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Accept-encoding": "gzip, deflate",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                to: inviterPushToken,
                sound: "default",
                title: "Collaboration Invite Sent",
                body: `You invited ${invitedUsername} to join "${sessionName}"`,
                data: {
                  type: "collaboration_invite_sent",
                  sessionId: sessionId,
                  sessionName: sessionName,
                  inviteId: inviteId,
                  invitedUserId: invitedUserId,
                  invitedUsername: invitedUsername,
                },
                channelId: "collaboration-invites",
              }),
            }
          );

          const inviterPushResult = await inviterPushResponse.json();
          if (
            inviterPushResult.data &&
            inviterPushResult.data[0] &&
            inviterPushResult.data[0].status === "ok"
          ) {
            console.log("Push notification sent to inviter successfully");
          } else {
            console.error("Failed to send push notification to inviter:", inviterPushResult);
          }
        } else {
          console.log("No push token or username found for inviter:", inviterId);
        }
      } catch (inviterPushError) {
        console.error("Error sending push notification to inviter:", inviterPushError);
        // Don't fail the whole request if push notification fails
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        messageId: resendData.id,
        userExists,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error sending collaboration invite:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Failed to send invite",
        details: error.toString(),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
