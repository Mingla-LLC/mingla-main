import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Sends an Expo push notification to a target user.
 * Looks up push token from user_push_tokens (fallback: profiles.expo_push_token).
 * Returns true if the push was sent successfully, false otherwise.
 */
export async function sendPush(payload: {
  targetUserId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<boolean> {
  const { targetUserId, title, body, data } = payload;

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Try user_push_tokens first
    const { data: tokenData } = await supabaseAdmin
      .from("user_push_tokens")
      .select("push_token")
      .eq("user_id", targetUserId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let pushToken = tokenData?.push_token;

    // Fallback to profiles.expo_push_token
    if (!pushToken) {
      const { data: profileData } = await supabaseAdmin
        .from("profiles")
        .select("expo_push_token")
        .eq("id", targetUserId)
        .single();
      pushToken = profileData?.expo_push_token;
    }

    if (!pushToken) {
      console.log(`[push-utils] No push token found for user: ${targetUserId}`);
      return false;
    }

    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: pushToken,
        sound: "default",
        title,
        body,
        data: data || {},
        channelId: "pairing",
      }),
    });

    if (!response.ok) {
      console.error(`[push-utils] Expo push failed: ${response.status}`);
      return false;
    }

    console.log(`[push-utils] Push sent to user ${targetUserId}`);
    return true;
  } catch (err) {
    console.error(`[push-utils] Error sending push:`, err);
    return false;
  }
}
