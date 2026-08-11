// META-ORCH-1161 Sub-A — push adapter.
//
// Thin wrapper over the existing _shared/push-utils.ts sendPush(). The dispatcher
// never touches OneSignal HTTP directly. Resolves consumer-vs-business app via
// resolveOneSignalApp(type) (a category maps to a `type` for routing).

import {
  hasOneSignalCredentials,
  type OfferingPushClaimReceipt,
  resolveOneSignalApp,
  sendPush,
} from "../push-utils.ts";
import type { AdapterResult } from "./smsAdapter.ts";

export interface PushSendInput {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // Routing key — `business.*`/`stripe.*` → business app, else consumer.
  routingType?: string;
  beforeProviderIo?: () => Promise<void>;
}

export interface OfferingPushSendInput
  extends Omit<PushSendInput, "beforeProviderIo"> {
  routingType: "offering_invitation";
  offeringAttemptId: string;
  internalProviderClaimKey: string;
  oneSignalIdempotencyKey: string;
  persistedPushPayload: OfferingPushClaimReceipt["pushPayload"];
  beforeProviderIo: () => Promise<OfferingPushClaimReceipt>;
}
export type PushAdapterResult =
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
    outcome: "definitive_unsent_retryable" | "definitive_unsent_terminal";
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

async function send(input: OfferingPushSendInput): Promise<PushAdapterResult>;
async function send(input: PushSendInput): Promise<AdapterResult>;
async function send(
  input: PushSendInput | OfferingPushSendInput,
): Promise<AdapterResult | PushAdapterResult> {
  if (!input.userId) {
    if ("offeringAttemptId" in input) {
      return {
        outcome: "definitive_unsent_terminal",
        ok: false,
        status: "failed",
        provider: "onesignal",
        providerAppId: null,
        providerMessageId: null,
        safeCode: "local_payload_invalid",
        retryable: false,
      };
    }
    return {
      ok: false,
      status: "skipped",
      providerMessageId: null,
      error: "no_user_id",
    };
  }
  const app = resolveOneSignalApp(input.routingType ?? null);
  if (!hasOneSignalCredentials(app)) {
    if ("offeringAttemptId" in input) {
      return {
        outcome: "definitive_unsent_retryable",
        ok: false,
        status: "failed",
        provider: "onesignal",
        providerAppId: null,
        providerMessageId: null,
        safeCode: "provider_config_missing",
        retryable: true,
      };
    }
    return {
      ok: false,
      status: "failed",
      providerMessageId: null,
      error: "provider_config_missing",
    };
  }
  if ("offeringAttemptId" in input) {
    return await sendPush({
      targetUserId: input.userId,
      title: input.title,
      body: input.body,
      data: input.data ?? {},
      app,
      iosBadgeType: "Increase",
      iosBadgeCount: 1,
      offeringAttemptId: input.offeringAttemptId,
      internalProviderClaimKey: input.internalProviderClaimKey,
      oneSignalIdempotencyKey: input.oneSignalIdempotencyKey,
      persistedPushPayload: input.persistedPushPayload,
      beforeProviderIo: input.beforeProviderIo,
    });
  }
  const ok = await sendPush({
    targetUserId: input.userId,
    title: input.title,
    body: input.body,
    data: input.data ?? {},
    app,
    iosBadgeType: "Increase",
    iosBadgeCount: 1,
    beforeProviderIo: input.beforeProviderIo,
  });
  // sendPush absorbs provider/network failures, but deliberately lets a
  // durable-marker failure escape so the worker can classify it as unsent.
  return {
    ok,
    status: ok ? "sent" : "failed",
    providerMessageId: null,
    error: ok ? undefined : "push_not_delivered",
  };
}

export const pushAdapter = { send };
