// META-ORCH-1161 Sub-A — push adapter.
//
// Thin wrapper over the existing _shared/push-utils.ts sendPush(). The dispatcher
// never touches OneSignal HTTP directly. Resolves consumer-vs-business app via
// resolveOneSignalApp(type) (a category maps to a `type` for routing).

import { resolveOneSignalApp, sendPush } from "../push-utils.ts";
import type { AdapterResult } from "./smsAdapter.ts";

export interface PushSendInput {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // Routing key — `business.*`/`stripe.*` → business app, else consumer.
  routingType?: string;
}

export const pushAdapter = {
  async send(input: PushSendInput): Promise<AdapterResult> {
    if (!input.userId) {
      return { ok: false, status: "skipped", providerMessageId: null, error: "no_user_id" };
    }
    try {
      const ok = await sendPush({
        targetUserId: input.userId,
        title: input.title,
        body: input.body,
        data: input.data ?? {},
        app: resolveOneSignalApp(input.routingType ?? null),
        iosBadgeType: "Increase",
        iosBadgeCount: 1,
      });
      // sendPush returns a boolean (no provider message id surfaced); record
      // sent/failed accordingly. No silent failure — failed is a real status.
      return {
        ok,
        status: ok ? "sent" : "failed",
        providerMessageId: null,
        error: ok ? undefined : "push_not_delivered",
      };
    } catch (err) {
      return {
        ok: false,
        status: "failed",
        providerMessageId: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
