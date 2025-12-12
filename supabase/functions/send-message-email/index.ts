import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface MessageEmailPayload {
  recipientEmail: string;
  recipientName?: string;
  senderName: string;
  senderEmail?: string;
  messagePreview: string;
  conversationId: string;
  isMention?: boolean;
  sessionName?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: MessageEmailPayload = await req.json();
    const {
      recipientEmail,
      recipientName,
      senderName,
      senderEmail,
      messagePreview,
      conversationId,
      isMention = false,
      sessionName,
    } = payload;

    // Validate required fields
    if (!recipientEmail || !senderName || !messagePreview || !conversationId) {
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

    // Function to highlight mentions in orange
    const highlightMentions = (text: string): string => {
      // Escape HTML first
      const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

      // Highlight @mentions and #hashtags
      return escaped
        .replace(
          /@(\w+)/g,
          '<span style="color: #eb7825; font-weight: 600;">@$1</span>'
        )
        .replace(
          /#(\w+)/g,
          '<span style="color: #007AFF; font-weight: 500;">#$1</span>'
        );
    };

    // Email content
    const emailSubject =
      isMention && sessionName
        ? `${senderName} mentioned you in ${sessionName}`
        : `New message from ${senderName} on Mingla`;
    const recipientDisplayName = recipientName || recipientEmail.split("@")[0];

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Message on Mingla</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #eb7825 0%, #d6691f 100%); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">New Message</h1>
        </div>
        <div style="background: white; padding: 30px; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="font-size: 16px; margin-bottom: 20px;">
            Hi ${recipientDisplayName},
          </p>
          <p style="font-size: 16px; margin-bottom: 20px;">
            ${
              isMention && sessionName
                ? `<strong>${senderName}</strong> mentioned you in <strong>${sessionName}</strong>:`
                : `<strong>${senderName}</strong> sent you a message:`
            }
          </p>
          <div style="background: #F9FAFB; border-left: 4px solid #eb7825; padding: 20px; margin: 20px 0; border-radius: 8px;">
            <p style="font-size: 16px; color: #111827; margin: 0; font-style: italic;">
              "${highlightMentions(messagePreview)}"
            </p>
          </div>
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://mingla.app/board/${conversationId}" 
               style="display: inline-block; background: #eb7825; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
              ${isMention ? "View in Board" : "Open in Mingla"}
            </a>
          </div>
          <p style="font-size: 14px; color: #6B7280; margin-top: 30px; text-align: center;">
            Open the Mingla app to view and reply to this message.
          </p>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">
          <p style="font-size: 12px; color: #9CA3AF; text-align: center;">
            This email was sent because ${senderName} sent you a message. If you didn't expect this, you can safely ignore it.
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
        to: recipientEmail,
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

    return new Response(
      JSON.stringify({
        success: true,
        messageId: resendData.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error sending message email:", error);
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
