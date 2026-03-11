import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface PushPayload {
  to: string;                // Expo push token
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushResponse {
  data: ExpoTicket[];
}

/**
 * Sends a push notification via Expo and purges the token if it is stale.
 *
 * Call this instead of calling fetch("https://exp.host/...") directly.
 * Returns true if the push was accepted, false if the token was stale or delivery failed.
 */
export async function sendPush(
  supabaseUrl: string,
  supabaseServiceKey: string,
  payload: PushPayload
): Promise<boolean> {
  let response: Response;

  try {
    response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    console.warn("[push-utils] Network error sending push:", networkErr);
    return false;
  }

  if (!response.ok) {
    console.warn("[push-utils] Expo returned HTTP", response.status);
    return false;
  }

  let body: ExpoPushResponse;
  try {
    body = await response.json();
  } catch {
    // Cannot parse response — treat as delivered (non-critical)
    return true;
  }

  const ticket = body?.data?.[0];
  if (!ticket) return true;

  if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
    console.warn("[push-utils] DeviceNotRegistered for token, purging:", payload.to);
    // Purge the stale token from the database
    try {
      const admin = createClient(supabaseUrl, supabaseServiceKey);
      await admin
        .from("user_push_tokens")
        .delete()
        .eq("push_token", payload.to);
    } catch (purgeErr) {
      console.warn("[push-utils] Failed to purge stale token:", purgeErr);
    }
    return false;
  }

  return ticket.status === "ok";
}
