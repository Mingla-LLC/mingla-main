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
  buttons?: Array<{ id: string; text: string }>;  // Action buttons (max 3)
  collapseId?: string;            // Replaces previous notification with same collapse ID
  threadId?: string;              // iOS thread grouping / Android group key
  iosBadgeType?: string;          // "SetTo" | "Increase"
  iosBadgeCount?: number;         // Badge count value
}

interface OneSignalResponse {
  id?: string;
  errors?: string[] | Record<string, string[]>;
  external_id?: string;
}

/**
 * Sends a push notification to a specific user via OneSignal.
 *
 * The user must have been registered in OneSignal via `OneSignal.login(userId)`
 * on the mobile client. OneSignal resolves the external_id to the correct
 * device(s) and delivers via FCM (Android) or APNs (iOS) automatically.
 *
 * Returns true ONLY if OneSignal returned a valid notification ID with no errors.
 * Returns false for: missing credentials, network errors, HTTP errors,
 * unsubscribed targets, empty notification ID, or unparseable responses.
 *
 * Every call produces exactly one log line with the outcome.
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
    // small_icon: status bar icon (monochrome per Android guidelines)
    small_icon: "ic_stat_onesignal_default",
    // large_icon: big icon on notification — use app's launcher icon
    large_icon: "ic_launcher",
    ...(payload.androidChannelId && {
      android_channel_id: payload.androidChannelId,
    }),
    ...(payload.buttons && payload.buttons.length > 0 && {
      buttons: payload.buttons,
    }),
    ...(payload.collapseId && {
      collapse_id: payload.collapseId,
    }),
    ...(payload.threadId && {
      thread_id: payload.threadId,            // iOS grouping
      android_group: payload.threadId,        // Android grouping
      android_group_message: { en: "$[notif_count] new notifications" },
    }),
    ...(payload.iosBadgeType && {
      ios_badgeType: payload.iosBadgeType,
      ios_badgeCount: payload.iosBadgeCount ?? 0,
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
    const errMsg = networkErr instanceof Error ? networkErr.message : String(networkErr);
    console.error(
      "[push-utils] ✗ Push network error:",
      { user: payload.targetUserId, error: errMsg }
    );
    return false;
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "unknown");
    console.error(
      "[push-utils] ✗ Push HTTP error:",
      { status: response.status, user: payload.targetUserId, body: errorText.slice(0, 500) }
    );
    return false;
  }

  // Parse OneSignal response — must succeed for us to trust the result
  let body: OneSignalResponse;
  try {
    body = await response.json();
  } catch {
    // Body already consumed by .json() — cannot call .text() here
    console.error(
      "[push-utils] ✗ Push response not JSON:",
      { user: payload.targetUserId, note: "200 OK but body was not valid JSON" }
    );
    return false;
  }

  // Check for errors first — OneSignal returns 200 even when all targets are unsubscribed
  if (body.errors) {
    console.warn(
      "[push-utils] ✗ Push rejected:",
      { user: payload.targetUserId, errors: JSON.stringify(body.errors) }
    );
    return false;
  }

  // Empty id means notification was not created (per OneSignal docs)
  if (!body.id) {
    console.warn(
      "[push-utils] ✗ Push failed: empty notification ID",
      { user: payload.targetUserId, response: JSON.stringify(body) }
    );
    return false;
  }

  // Success — OneSignal accepted the notification with a valid ID
  console.log(
    "[push-utils] ✓ Push sent:",
    { id: body.id, user: payload.targetUserId }
  );
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
