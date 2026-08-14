// supabase/functions/_shared/push-utils.ts
//
// Sends push notifications via OneSignal REST API.
// Targets users by external_id (= Supabase auth.users.id).
// OneSignal manages FCM/APNs tokens internally — no token storage needed.
//
// META-ORCH-1074 Sub-A [dual-app routing]: Mingla runs TWO separate OneSignal
// applications — one for the consumer app, one for the Mingla Host app.
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
export function resolveAppCredentials(
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

export function hasOneSignalCredentials(appType: OneSignalAppType): boolean {
  const { appId, restKey } = resolveAppCredentials(appType);
  return appId.length > 0 && restKey.length > 0;
}

/**
 * META-ORCH-1074 Sub-A — routing decision: the OneSignal *application* a push
 * targets is a pure function of the notification `type` prefix. `business.*`
 * and `stripe.*` types are Mingla-Business-only (per I-PROPOSED-W) and MUST be
 * delivered through the business OneSignal application; every other type goes
 * to the consumer application. There is no cross-app send in OneSignal.
 * — https://documentation.onesignal.com/docs/keys-and-ids
 */
export function resolveOneSignalApp(
  type: string | undefined | null,
): OneSignalAppType {
  if (
    typeof type === "string" &&
    (type.startsWith("business.") || type.startsWith("stripe."))
  ) {
    return "business";
  }
  return "consumer";
}

export interface PushPayload {
  targetUserId: string; // Supabase UUID — maps to OneSignal external_id
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // META-ORCH-1074 Sub-A: which OneSignal application to deliver through.
  // Defaults to "consumer" when omitted so every existing consumer call-site
  // is byte-stable. notify-dispatch sets this from resolveOneSignalApp(type).
  app?: OneSignalAppType;
  androidChannelId?: string; // Android notification channel
  buttons?: Array<{ id: string; text: string }>; // Action buttons (max 3)
  collapseId?: string; // Replaces previous notification with same collapse ID
  threadId?: string; // iOS thread grouping / Android group key
  iosBadgeType?: string; // "SetTo" | "Increase"
  iosBadgeCount?: number; // Badge count value
  beforeProviderIo?: () => Promise<void>;
}

export interface OfferingPushClaimReceipt {
  attemptId: string;
  recipientUserId: string;
  internalProviderClaimKey: string;
  pushPayload: {
    payloadVersion: 1;
    payloadHash: string;
    title: string;
    body: string;
    eventId: string;
  };
}

export interface OfferingPushPayload
  extends Omit<PushPayload, "beforeProviderIo"> {
  offeringAttemptId: string;
  internalProviderClaimKey: string;
  oneSignalIdempotencyKey: string;
  persistedPushPayload: OfferingPushClaimReceipt["pushPayload"];
  beforeProviderIo: () => Promise<OfferingPushClaimReceipt>;
}

export type OfferingPushResult =
  | {
    outcome: "accepted";
    ok: true;
    status: "sent";
    provider: "onesignal";
    providerAppId: string;
    providerMessageId: string;
    safeCode: null;
    retryable: false;
  }
  | {
    outcome:
      | "definitive_unsent_retryable"
      | "definitive_unsent_terminal";
    ok: false;
    status: "failed";
    provider: "onesignal";
    providerAppId: null;
    providerMessageId: null;
    safeCode: string;
    retryable: boolean;
    retryAfterSeconds?: number;
  }
  | {
    outcome: "ambiguous";
    ok: false;
    status: "sending";
    provider: "onesignal";
    providerAppId: null;
    providerMessageId: null;
    safeCode: "provider_outcome_unknown";
    retryable: false;
  }
  | {
    outcome: "suppressed";
    ok: false;
    status: "suppressed";
    provider: "onesignal";
    providerAppId: null;
    providerMessageId: null;
    safeCode: string;
    retryable: false;
  };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function isOfferingPayload(
  value: PushPayload | OfferingPushPayload,
): value is OfferingPushPayload {
  return "offeringAttemptId" in value;
}
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function boundedRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.min(3600, Math.max(1, Math.ceil(seconds)));
  }
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(3600, Math.max(1, Math.ceil((date - Date.now()) / 1000)));
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
export function sendPush(
  payload: OfferingPushPayload,
): Promise<OfferingPushResult>;
export function sendPush(payload: PushPayload): Promise<boolean>;
export async function sendPush(
  payload: PushPayload | OfferingPushPayload,
): Promise<boolean | OfferingPushResult> {
  // META-ORCH-1074 Sub-A: select the target OneSignal application by
  // payload.app (default "consumer"). Each app has its own (app_id, REST key).
  // — https://documentation.onesignal.com/docs/keys-and-ids
  const appType: OneSignalAppType = payload.app ?? "consumer";
  const { appId, restKey } = resolveAppCredentials(appType);
  const offering = isOfferingPayload(payload);
  const failed = (
    safeCode: string,
    retryable: boolean,
    _providerAppId: string | null = null,
    retryAfterSeconds?: number,
  ): OfferingPushResult => ({
    outcome: retryable
      ? "definitive_unsent_retryable"
      : "definitive_unsent_terminal",
    ok: false,
    status: "failed",
    provider: "onesignal",
    providerAppId: null,
    providerMessageId: null,
    safeCode,
    retryable,
    ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
  });
  const ambiguous = (): OfferingPushResult => ({
    outcome: "ambiguous",
    ok: false,
    status: "sending",
    provider: "onesignal",
    providerAppId: null,
    providerMessageId: null,
    safeCode: "provider_outcome_unknown",
    retryable: false,
  });

  // SC-A2 (LOCKED): if the SELECTED app's credentials are missing, skip+warn
  // and return false — per-app, never a silent cross-app fallback. A business
  // push delivered to the consumer app reaches nobody.
  if (!appId || !restKey) {
    console.warn("[push-utils] OneSignal credentials unavailable", {
      app: appType,
    });
    return offering ? failed("provider_config_missing", true, null) : false;
  }

  if (
    offering && (!UUID.test(appId) || (
      !UUID.test(payload.offeringAttemptId) ||
      payload.oneSignalIdempotencyKey !== payload.offeringAttemptId ||
      payload.internalProviderClaimKey !==
        `offering:${payload.offeringAttemptId}:push:v1` ||
      payload.targetUserId.length === 0 || payload.title.length === 0 ||
      payload.body.length === 0
    ))
  ) return offering ? failed("local_payload_invalid", false) : false;

  const oneSignalPayload = {
    app_id: appId,
    target_channel: "push",
    include_aliases: {
      external_id: [payload.targetUserId],
    },
    headings: { en: payload.title },
    contents: { en: payload.body },
    data: payload.data ?? {},
    ...(offering && { idempotency_key: payload.oneSignalIdempotencyKey }),
    // small_icon: status bar icon (monochrome per Android guidelines)
    small_icon: "ic_stat_onesignal_default",
    // large_icon: Mingla logo from Supabase Storage (OneSignal auto-resizes)
    large_icon:
      "https://gqnoajqerqhnvulmnyvv.supabase.co/storage/v1/object/public/App%20Stuff/Untitled%20design.png",
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
      thread_id: payload.threadId, // iOS grouping
      android_group: payload.threadId, // Android grouping
      android_group_message: { en: "$[notif_count] new notifications" },
    }),
    ...(payload.iosBadgeType && {
      ios_badgeType: payload.iosBadgeType,
      ios_badgeCount: payload.iosBadgeCount ?? 0,
    }),
  };

  // The durable caller-owned acceptance marker belongs after all local
  // credential/payload preflight and immediately before external I/O.
  if (offering) {
    let claim: OfferingPushClaimReceipt;
    try {
      claim = await payload.beforeProviderIo();
    } catch (error) {
      // A rejected claim never crossed the point of no return; caller returns
      // a retryable 503 and the database remains queued.
      if (
        error instanceof Error &&
        error.message === "offering_push_claim_ineligible"
      ) throw error;
      throw new Error("offering_push_claim_unavailable");
    }
    if (
      claim.attemptId !== payload.offeringAttemptId ||
      claim.recipientUserId !== payload.targetUserId ||
      claim.internalProviderClaimKey !== payload.internalProviderClaimKey ||
      !sameJson(claim.pushPayload, payload.persistedPushPayload) ||
      claim.pushPayload.title !== payload.title ||
      claim.pushPayload.body !== payload.body ||
      !sameJson(payload.data ?? {}, {
        event_id: payload.persistedPushPayload.eventId,
        category_key: "offering_invitation",
        offering_attempt_id: payload.offeringAttemptId,
      })
    ) return failed("claim_tuple_mismatch", false);
  } else await payload.beforeProviderIo?.();

  let response: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  let providerPromise: Promise<Response>;
  try {
    providerPromise = fetch("https://api.onesignal.com/notifications", {
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
  } catch {
    clearTimeout(timeoutId);
    return offering ? failed("local_before_provider_io_failed", true) : false;
  }
  try {
    response = await providerPromise;
  } catch {
    console.error("[push-utils] push provider outcome unknown", {
      app: appType,
    });
    return offering ? ambiguous() : false;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (!offering) return false;
    if (response.status === 429) {
      return failed(
        "provider_rate_limited",
        true,
        appId,
        boundedRetryAfter(response.headers.get("retry-after")),
      );
    }
    if (response.status === 400) {
      return failed("provider_request_invalid", false);
    }
    if (response.status === 401 || response.status === 403) {
      return failed("provider_config_rejected", false);
    }
    if (
      response.status >= 400 && response.status < 500 && response.status !== 408
    ) return failed("provider_request_rejected", false);
    return ambiguous();
  }
  if (offering && response.status !== 200) return ambiguous();

  // Parse OneSignal response — must succeed for us to trust the result
  let body: OneSignalResponse;
  try {
    body = await response.json();
  } catch {
    return offering ? ambiguous() : false;
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return offering ? ambiguous() : false;
  }

  // A canonical id is authoritative even if OneSignal also supplies a warning.
  if (body.id && (!offering || UUID.test(body.id))) {
    console.log("[push-utils] push accepted", { app: appType });
    return offering
      ? {
        outcome: "accepted",
        ok: true,
        status: "sent",
        provider: "onesignal",
        providerAppId: appId,
        providerMessageId: body.id,
        safeCode: null,
        retryable: false,
      }
      : true;
  }

  // OneSignal can return 200 when every target is unsubscribed.
  if (body.errors) {
    return offering ? failed("provider_no_valid_subscription", false) : false;
  }

  // Empty id means notification was not created (per OneSignal docs)
  if (!body.id) {
    return offering ? failed("provider_no_valid_subscription", false) : false;
  }

  if (!UUID.test(body.id)) return offering ? ambiguous() : true;

  // Success — OneSignal accepted the notification with a valid ID
  return false;
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
      sendPush({
        targetUserId: userId,
        title,
        body,
        data,
        androidChannelId,
        app,
      }).catch((err) => {
        console.warn(
          "[push-utils] sendPushToMany: push failed for user:",
          userId,
          err,
        );
        return false;
      })
    ),
  );
}
