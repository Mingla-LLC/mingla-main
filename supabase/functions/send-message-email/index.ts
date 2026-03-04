import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY"
    )!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Look up recipient's push token
    const { data: pushTokenData } = await supabase
      .from("user_push_tokens")
      .select("push_token")
      .eq("user_id", recipientId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let pushToken = pushTokenData?.push_token;
    if (!pushToken) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("expo_push_token")
        .eq("id", recipientId)
        .single();
      pushToken = profileData?.expo_push_token;
    }

    if (!pushToken) {
      console.log("No push token found for user:", recipientId);
      return new Response(
        JSON.stringify({ success: true, method: "none", reason: "no_push_token" }),
        {
          status: 200,
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

    // Send push notification via Expo
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: pushToken,
        title: title,
        body: body,
        sound: "default",
        data: {
          type: isMention ? "mention" : "message",
          conversationId: conversationId,
        },
        channelId: "messages",
      }),
    });

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
