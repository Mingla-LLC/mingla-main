// supabase/functions/_shared/push-utils.ts
//
// Sends push notifications via OneSignal REST API.
// Targets users by external_id (= Supabase auth.users.id).
// OneSignal manages FCM/APNs tokens internally — no token storage needed.
//
// META-ORCH-1074 Sub-A [dual-app routing]: Mingla runs TWO separate OneSignal
// applications — one for the consumer app, one for the Mingla Business app.
// Each application has its own (app_id, REST API Key) pair; there is NO
// cross-app send — to reach business devices you MUST send with the business
// app's app_id + business key.
//   - https://documentation.onesignal.com/docs/keys-and-ids
//   - https://documentation.onesignal.com/reference/create-message
// A push's target application is a pure function of the notification `type`
// prefix (see resolveOneSignalApp): `business.*`/`stripe.*` → business app;
// everything else → consumer app. Business-credential absence MUST NOT fall
// back to the consumer app (a business push delivered to the consumer app
// reaches nobody — SC-A2).

export type OneSignalAppType = "consumer" | "business";

// META-ORCH-1074 Sub-A: credentials are read at CALL time (not module-top) so a
// secret change between invocations is picked up, and so each app's pair is
// resolved independently. Consumer: ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY.
// Business: ONESIGNAL_BUSINESS_APP_ID / ONESIGNAL_BUSINESS_REST_API_KEY — the
// business app_id MUST equal the OneSignal application the business client
// registers against via EXPO_PUBLIC_ONESIGNAL_APP_ID.
// — https://documentation.onesignal.com/docs/keys-and-ids
function resolveAppCredentials(
  appType: OneSignalAppType,
): { appId: string; restKey: string } {
  if (appType === "business") {
    return {
      appId: Deno.env.get("ONESIGNAL_BUSINESS_APP_ID") ?? "",
      restKey: Deno.env.get("ONESIGNAL_BUSINESS_REST_API_KEY") ?? "",
    };
  }
  return {
    appId: Deno.env.get("ONESIGNAL_APP_ID") ?? "",
    restKey: Deno.env.get("ONESIGNAL_REST_API_KEY") ?? "",
  };
}

/**
 * META-ORCH-1074 Sub-A — routing decision: the OneSignal *application* a push
 * targets is a pure function of the notification `type` prefix. `business.*`
 * and `stripe.*` types are Mingla-Business-only (per I-PROPOSED-W) and MUST be
 * delivered through the business OneSignal application; every other type goes
 * to the consumer application. There is no cross-app send in OneSignal.
 * — https://documentation.onesignal.com/docs/keys-and-ids
 */
export function resolveOneSignalApp(type: string | undefined | null): OneSignalAppType {
  if (typeof type === "string" && (type.startsWith("business.") || type.startsWith("stripe."))) {
    return "business";
  }
  return "consumer";
}

interface PushPayload {
  targetUserId: string;           // Supabase UUID — maps to OneSignal external_id
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // META-ORCH-1074 Sub-A: which OneSignal application to deliver through.
  // Defaults to "consumer" when omitted so every existing consumer call-site
  // is byte-stable. notify-dispatch sets this from resolveOneSignalApp(type).
  app?: OneSignalAppType;
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
  // META-ORCH-1074 Sub-A: select the target OneSignal application by
  // payload.app (default "consumer"). Each app has its own (app_id, REST key).
  // — https://documentation.onesignal.com/docs/keys-and-ids
  const appType: OneSignalAppType = payload.app ?? "consumer";
  const { appId, restKey } = resolveAppCredentials(appType);

  // SC-A2 (LOCKED): if the SELECTED app's credentials are missing, skip+warn
  // and return false — per-app, never a silent cross-app fallback. A business
  // push delivered to the consumer app reaches nobody.
  if (!appId || !restKey) {
    console.warn(
      `[push-utils] OneSignal credentials not configured for app "${appType}". Skipping push.`,
    );
    return false;
  }

  const oneSignalPayload = {
    app_id: appId,
    target_channel: "push",
    include_aliases: {
      external_id: [payload.targetUserId],
    },
    headings: { en: payload.title },
    contents: { en: payload.body },
    data: payload.data ?? {},
    // small_icon: status bar icon (monochrome per Android guidelines)
    small_icon: "ic_stat_onesignal_default",
    // large_icon: Mingla logo from Supabase Storage (OneSignal auto-resizes)
    large_icon: "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/App%20Stuff/Untitled%20design.png",
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
          // META-ORCH-1074 Sub-A: per-app REST API Key (canonical "Key" scheme).
          // — https://documentation.onesignal.com/docs/rest-api-overview
          Authorization: `Key ${restKey}`,
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
    { id: body.id, user: payload.targetUserId, app: appType, appId },
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
  androidChannelId?: string,
  // META-ORCH-1074 Sub-A: optional target app (default "consumer"); passes
  // through to sendPush so a business fan-out reaches the business app.
  app?: OneSignalAppType,
): Promise<boolean[]> {
  return Promise.all(
    userIds.map((userId) =>
      sendPush({ targetUserId: userId, title, body, data, androidChannelId, app }).catch((err) => { console.warn('[push-utils] sendPushToMany: push failed for user:', userId, err); return false; })
    )
  );
}
