// META-ORCH-1161 Sub-A — push adapter.
//
// Thin wrapper over the existing _shared/push-utils.ts sendPush(). The dispatcher
// never touches OneSignal HTTP directly. Resolves consumer-vs-business app via
// resolveOneSignalApp(type) (a category maps to a `type` for routing).

import {
  hasOneSignalCredentials,
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

export const pushAdapter = {
  async send(input: PushSendInput): Promise<AdapterResult> {
    if (!input.userId) {
      return { ok: false, status: "skipped", providerMessageId: null, error: "no_user_id" };
    }
    const app = resolveOneSignalApp(input.routingType ?? null);
    if (!hasOneSignalCredentials(app)) {
      return {
        ok: false,
        status: "failed",
        providerMessageId: null,
        error: "provider_config_missing",
      };
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
  },
};
