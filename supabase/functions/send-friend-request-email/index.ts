import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface FriendRequestEmailPayload {
  senderId: string;
  receiverId?: string;
  receiverEmail: string;
  receiverUsername?: string;
  senderUsername: string;
  senderDisplayName?: string;
  requestId?: string;
  userExists: boolean;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: FriendRequestEmailPayload = await req.json();
    const {
      senderId,
      receiverId,
      receiverEmail,
      receiverUsername,
      senderUsername,
      senderDisplayName,
      requestId,
      userExists,
    } = payload;

    // Validate required fields
    if (!senderId || !receiverEmail || !senderUsername) {
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

    // Get sender's profile for better email content
    const { data: senderProfile } = await supabase
      .from("profiles")
      .select("display_name, first_name, last_name, avatar_url")
      .eq("id", senderId)
      .single();

    const senderName =
      senderProfile?.display_name ||
      (senderProfile?.first_name && senderProfile?.last_name
        ? `${senderProfile.first_name} ${senderProfile.last_name}`
        : senderUsername);

    // Generate invite link if user exists
    let inviteLink = "";
    if (userExists && requestId) {
      // Generate a secure token for the friend request
      const { data: tokenData } = await supabase
        .from("friend_requests")
        .select("id, created_at")
        .eq("id", requestId)
        .single();

      if (tokenData) {
        // Create a simple token from request ID and timestamp
        const tokenString = `${requestId}:${tokenData.created_at}`;
        const token = btoa(tokenString).replace(/[+/=]/g, "");
        inviteLink = `https://mingla.app/friend-request/${requestId}?token=${token}`;
      }
    }

    // Email content based on whether user exists
    let emailSubject = "";
    let emailHtml = "";

    if (userExists) {
      // User exists - tell them to login to accept the invite
      emailSubject = `${senderName} sent you a friend request on Mingla`;
      emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Friend Request on Mingla</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #eb7825 0%, #d6691f 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Friend Request</h1>
          </div>
          <div style="background: white; padding: 30px; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="font-size: 16px; margin-bottom: 20px;">
              Hi ${receiverUsername || receiverEmail.split("@")[0]},
            </p>
            <p style="font-size: 16px; margin-bottom: 20px;">
              <strong>${senderName}</strong> (@${senderUsername}) sent you a friend request on Mingla!
            </p>
            <p style="font-size: 16px; margin-bottom: 30px; color: #374151;">
              Log in to your Mingla account to accept or decline this friend request.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${inviteLink || "https://mingla.app"}" 
                 style="display: inline-block; background: #eb7825; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                Log In to Accept
              </a>
            </div>
            <p style="font-size: 14px; color: #6B7280; margin-top: 30px; text-align: center;">
              Open the Mingla app, log in, and go to <strong>Connections → Friend Requests</strong> to view and respond to this request.
            </p>
            <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">
            <p style="font-size: 12px; color: #9CA3AF; text-align: center;">
              This email was sent because ${senderName} sent you a friend request. If you didn't expect this, you can safely ignore it.
            </p>
          </div>
        </body>
        </html>
      `;
    } else {
      // User doesn't exist - tell them to download the app
      emailSubject = `${senderName} wants to connect with you on Mingla`;
      emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Join Mingla</title>
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #eb7825 0%, #d6691f 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">Join Mingla</h1>
          </div>
          <div style="background: white; padding: 30px; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="font-size: 16px; margin-bottom: 20px;">
              Hi there,
            </p>
            <p style="font-size: 16px; margin-bottom: 20px;">
              <strong>${senderName}</strong> (@${senderUsername}) wants to connect with you on Mingla!
            </p>
            <p style="font-size: 16px; margin-bottom: 30px;">
              Mingla helps you discover amazing experiences and plan activities with friends. Download the app to connect with ${senderName} and start exploring together.
            </p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="https://mingla.app/download" 
                 style="display: inline-block; background: #eb7825; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; margin-bottom: 10px;">
                Download Mingla
              </a>
            </div>
            <div style="background: #FEF3E7; border: 1px solid #eb7825; border-radius: 8px; padding: 15px; margin: 20px 0;">
              <p style="font-size: 14px; color: #111827; margin: 0;">
                <strong>What is Mingla?</strong><br>
                Mingla is a social discovery app that helps you find and plan experiences with friends. Discover restaurants, events, activities, and more!
              </p>
            </div>
            <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">
            <p style="font-size: 12px; color: #9CA3AF; text-align: center;">
              This email was sent because ${senderName} tried to send you a friend request. If you didn't expect this, you can safely ignore it.
            </p>
          </div>
        </body>
        </html>
      `;
    }

    // Send email via Resend
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Mingla <noreply@planmydetty.com>",
        to: receiverEmail,
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

    // If user exists, also send push notification
    if (userExists && receiverId) {
      try {
        // Get user's push token
        const { data: tokenData } = await supabase
          .from("user_push_tokens")
          .select("push_token")
          .eq("user_id", receiverId)
          .single();

        if (tokenData?.push_token) {
          // Send push notification via Expo
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
                to: tokenData.push_token,
                sound: "default",
                title: "New Friend Request",
                body: `${senderUsername} sent you a friend request`,
                data: {
                  type: "friend_request",
                  requestId: requestId,
                  senderId: senderId,
                  senderUsername: senderUsername,
                },
                channelId: "friend-requests",
              }),
            }
          );

          const pushResult = await pushResponse.json();
          if (
            pushResult.data &&
            pushResult.data[0] &&
            pushResult.data[0].status === "ok"
          ) {
            console.log("Push notification sent successfully");
          } else {
            console.error("Failed to send push notification:", pushResult);
          }
        } else {
          console.log("No push token found for user:", receiverId);
        }
      } catch (pushError) {
        console.error("Error sending push notification:", pushError);
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
    console.error("Error sending friend request email:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Failed to send email",
        details: error.toString(),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
