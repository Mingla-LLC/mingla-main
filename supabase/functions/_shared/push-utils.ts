// supabase/functions/_shared/push-utils.ts
//
// Sends push notifications via OneSignal REST API.
// Targets users by external_id (= Supabase auth.users.id).
// OneSignal manages FCM/APNs tokens internally — no token storage needed.

const ONESIGNAL_APP_ID = Deno.env.get("ONESIGNAL_APP_ID") ?? "";
const ONESIGNAL_REST_API_KEY = Deno.env.get("ONESIGNAL_REST_API_KEY") ?? "";

interface PushPayload {
  targetUserId: string;           // Supabase UUID — maps to OneSignal external_id
  title: string;
  body: string;
  data?: Record<string, unknown>;
  androidChannelId?: string;      // Android notification channel
}

interface OneSignalResponse {
  id?: string;
  errors?: string[] | Record<string, string[]>;
}

/**
 * Sends a push notification to a specific user via OneSignal.
 *
 * The user must have been registered in OneSignal via `OneSignal.login(userId)`
 * on the mobile client. OneSignal resolves the external_id to the correct
 * device(s) and delivers via FCM (Android) or APNs (iOS) automatically.
 *
 * Returns true if the push was accepted by OneSignal, false otherwise.
 */
export async function sendPush(payload: PushPayload): Promise<boolean> {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    console.warn("[push-utils] OneSignal credentials not configured. Skipping push.");
    return false;
  }

  const oneSignalPayload = {
    app_id: ONESIGNAL_APP_ID,
    target_channel: "push",
    include_aliases: {
      external_id: [payload.targetUserId],
    },
    headings: { en: payload.title },
    contents: { en: payload.body },
    data: payload.data ?? {},
    small_icon: "ic_stat_onesignal_default",
    large_icon: "ic_onesignal_large_icon_default",
    ...(payload.androidChannelId && {
      android_channel_id: payload.androidChannelId,
    }),
  };

  let response: Response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      response = await fetch("https://api.onesignal.com/notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Key ${ONESIGNAL_REST_API_KEY}`,
        },
        body: JSON.stringify(oneSignalPayload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (networkErr) {
    console.warn("[push-utils] Network error sending push:", networkErr);
    return false;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown");
    console.warn("[push-utils] OneSignal returned HTTP", response.status, errorText);
    return false;
  }

  let body: OneSignalResponse;
  try {
    body = await response.json();
  } catch {
    return true;
  }

  if (body.errors) {
    console.warn("[push-utils] OneSignal errors:", JSON.stringify(body.errors));
    // "All included players are not subscribed" means the user hasn't registered
    // a device yet. This is not a bug — they just haven't opened the app.
    return false;
  }

  return true;
}

/**
 * Sends a push to multiple users. Fires in parallel, never throws.
 * Returns an array of booleans (one per user) indicating success/failure.
 */
export async function sendPushToMany(
  userIds: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
  androidChannelId?: string
): Promise<boolean[]> {
  return Promise.all(
    userIds.map((userId) =>
      sendPush({ targetUserId: userId, title, body, data, androidChannelId }).catch((err) => { console.warn('[push-utils] sendPushToMany: push failed for user:', userId, err); return false; })
    )
  );
}
