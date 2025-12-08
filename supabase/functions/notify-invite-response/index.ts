import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InviteResponsePayload {
  inviteId: string;
  response: "accepted" | "declined";
  inviterId: string;
  invitedUserId: string;
  sessionId: string;
  sessionName: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: InviteResponsePayload = await req.json();
    const {
      inviteId,
      response,
      inviterId,
      invitedUserId,
      sessionId,
      sessionName,
    } = payload;

    // Validate required fields
    if (
      !inviteId ||
      !response ||
      !inviterId ||
      !invitedUserId ||
      !sessionId ||
      !sessionName
    ) {
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
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY is not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Supabase configuration missing" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Initialize Supabase client with service role key
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch inviter's profile
    const { data: inviterProfile, error: inviterError } = await supabase
      .from("profiles")
      .select("id, display_name, first_name, last_name, email, username")
      .eq("id", inviterId)
      .single();

    if (inviterError || !inviterProfile) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch inviter profile" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch invited user's profile
    const { data: invitedUserProfile, error: invitedUserError } = await supabase
      .from("profiles")
      .select("id, display_name, first_name, last_name, email, username")
      .eq("id", invitedUserId)
      .single();

    if (invitedUserError || !invitedUserProfile) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch invited user profile" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const inviterName =
      inviterProfile.display_name ||
      `${inviterProfile.first_name || ""} ${
        inviterProfile.last_name || ""
      }`.trim() ||
      inviterProfile.username ||
      "Someone";

    const invitedUserName =
      invitedUserProfile.display_name ||
      `${invitedUserProfile.first_name || ""} ${
        invitedUserProfile.last_name || ""
      }`.trim() ||
      invitedUserProfile.username ||
      "Someone";

    const inviterEmail = inviterProfile.email || inviterId;

    // Generate deep link for the app
    const deepLink = `mingla://collaboration/session/${sessionId}`;

    // Email content based on response
    const isAccepted = response === "accepted";
    const subject = isAccepted
      ? `${invitedUserName} accepted your collaboration invite`
      : `${invitedUserName} declined your collaboration invite`;

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #eb7825 0%, #ff9500 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 700;">Mingla</h1>
  </div>
  
  <div style="background: white; padding: 30px; border-radius: 0 0 12px 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <h2 style="color: #111827; margin-top: 0; font-size: 20px; font-weight: 600;">
      ${isAccepted ? "🎉 Invite Accepted!" : "Invite Declined"}
    </h2>
    
    <p style="color: #4B5563; font-size: 16px; margin: 20px 0;">
      ${
        isAccepted
          ? `${invitedUserName} has accepted your invitation to join the collaboration session "<strong>${sessionName}</strong>".`
          : `${invitedUserName} has declined your invitation to join the collaboration session "<strong>${sessionName}</strong>".`
      }
    </p>
    
    ${
      isAccepted
        ? `
    <div style="background: #F0FDF4; border-left: 4px solid #22C55E; padding: 16px; margin: 24px 0; border-radius: 4px;">
      <p style="margin: 0; color: #166534; font-size: 14px; font-weight: 500;">
        You can now collaborate together in the session!
      </p>
    </div>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${deepLink}" style="display: inline-block; background: #eb7825; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Open Session in Mingla
      </a>
    </div>
    `
        : `
    <div style="background: #FEF2F2; border-left: 4px solid #EF4444; padding: 16px; margin: 24px 0; border-radius: 4px;">
      <p style="margin: 0; color: #991B1B; font-size: 14px;">
        Don't worry! You can invite other friends to join your session.
      </p>
    </div>
    `
    }
    
    <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">
    
    <p style="color: #6B7280; font-size: 14px; margin: 0;">
      Session: <strong>${sessionName}</strong><br>
      ${isAccepted ? "Status: Accepted" : "Status: Declined"}
    </p>
  </div>
  
  <div style="text-align: center; margin-top: 20px; color: #9CA3AF; font-size: 12px;">
    <p>This email was sent by Mingla</p>
    <p>If you have any questions, please contact support.</p>
  </div>
</body>
</html>
    `;

    // Send email via Resend
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: "Mingla <noreply@planmydetty.com>",
        to: [inviterEmail],
        subject: subject,
        html: emailHtml,
      }),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: errorText }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const emailData = await emailResponse.json();

    // Send push notification to inviter if they have a token
    const { data: inviterProfileWithToken } = await supabase
      .from("profiles")
      .select("expo_push_token")
      .eq("id", inviterId)
      .single();

    if (inviterProfileWithToken?.expo_push_token) {
      const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";

      const pushMessage = {
        to: inviterProfileWithToken.expo_push_token,
        sound: "default",
        title: isAccepted ? "Invite Accepted! 🎉" : "Invite Declined",
        body: isAccepted
          ? `${invitedUserName} accepted your invite to "${sessionName}"`
          : `${invitedUserName} declined your invite to "${sessionName}"`,
        data: {
          type: "collaboration_invite_response",
          inviteId: inviteId,
          sessionId: sessionId,
          response: response,
          deepLink: deepLink,
        },
      };

      try {
        const pushResponse = await fetch(EXPO_PUSH_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(pushMessage),
        });

        // Push notification sent (don't log errors to avoid cluttering)
      } catch (pushError) {
        // Don't fail the whole request if push fails
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Notification sent successfully",
        emailId: emailData.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
