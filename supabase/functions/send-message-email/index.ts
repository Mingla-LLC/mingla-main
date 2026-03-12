import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { sendPush } from "../_shared/push-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface MessageNotificationPayload {
  recipientId: string;
  recipientEmail?: string;
  recipientName?: string;
  senderName: string;
  senderEmail?: string;
  messagePreview: string;
  conversationId: string;
  isMention?: boolean;
  sessionName?: string;
}

// Strip markdown formatting from message text
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")  // bold
    .replace(/\*(.*?)\*/g, "$1")       // italic
    .replace(/__(.*?)__/g, "$1")       // bold alt
    .replace(/_(.*?)_/g, "$1")         // italic alt
    .replace(/~~(.*?)~~/g, "$1")       // strikethrough
    .replace(/`(.*?)`/g, "$1")         // inline code
    .replace(/\[(.*?)\]\(.*?\)/g, "$1") // links
    .replace(/^#+\s/gm, "")            // headings
    .replace(/^[-*]\s/gm, "")          // list items
    .trim();
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: MessageNotificationPayload = await req.json();
    const {
      recipientId,
      senderName,
      messagePreview,
      conversationId,
      isMention = false,
    } = payload;

    // Validate required fields
    if (!recipientId || !senderName || !messagePreview || !conversationId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Strip markdown and truncate message preview
    const cleanPreview = stripMarkdown(messagePreview);
    const truncatedPreview =
      cleanPreview.length > 100
        ? cleanPreview.substring(0, 100) + "..."
        : cleanPreview;

    // Build push notification title and body
    const title = isMention
      ? `${senderName} mentioned you`
      : senderName;
    const body = truncatedPreview;

    // Send push notification via OneSignal
    await sendPush({
      targetUserId: recipientId,
      title: title,
      body: body,
      data: {
        type: isMention ? "mention" : "message",
        conversationId: conversationId,
      },
      androidChannelId: "messages",
    }).catch((err) => console.warn('[send-message-email] Push failed:', err));

    console.log("Push notification sent for message");

    return new Response(
      JSON.stringify({ success: true, method: "push" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error sending message notification:", error);
    return new Response(
      JSON.stringify({
        error: error.message || "Failed to send notification",
        details: error.toString(),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
