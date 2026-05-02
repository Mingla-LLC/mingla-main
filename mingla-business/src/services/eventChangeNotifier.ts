/**
 * eventChangeNotifier — multi-channel notification stack for LiveEvent edits.
 *
 * Fires after `updateLiveEventFields` successfully commits a change.
 * Routes the notification through 4 channels per `NotificationChannelFlags`:
 *
 *   - banner: in-app banner data lives in `useEventEditLogStore`. Cycle 9c
 *     buyer order detail page reads + renders. This service only logs the
 *     event (the recordEdit call in updateLiveEventFields is what
 *     actually populates the log).
 *   - email: TRANSITIONAL console.log stub. B-cycle replaces with Resend.
 *   - sms: TRANSITIONAL console.log stub. B-cycle replaces with Twilio.
 *   - push: DEFERRED — consumer app doesn't exist yet. Always false in
 *     ORCH-0704; logs deferred-marker only.
 *
 * Severity-driven channel rules (see `deriveChannelFlags`):
 *   - additive  → banner + email (no SMS, no push)
 *   - material  → banner + email + (SMS if hasWebPurchaseOrders)
 *   - destructive → unreachable (rejected pre-apply); fallback = material rules
 *
 * Per ORCH-0704 v2 spec §3.3.1 + §3.3.2.
 */

import type { EditSeverity } from "../store/eventEditLogStore";

export interface NotificationPayload {
  eventId: string;
  eventName: string;
  brandName: string;
  brandSlug: string;
  eventSlug: string;
  reason: string;
  diffSummary: string[];
  severity: EditSeverity;
  affectedOrderIds: string[];
  /** ISO 8601. */
  occurredAt: string;
  /**
   * Order IDs whose paymentMethod was a web-purchase channel. Forward-
   * looking — Cycle 9c populates from useOrderStore. ORCH-0704: empty.
   */
  webPurchaseOrderIds?: string[];
}

export interface NotificationChannelFlags {
  banner: boolean;
  email: boolean;
  sms: boolean;
  push: boolean;
}

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;

/**
 * Compose email subject + body from notification payload.
 * Subject: brand + event name + truncated reason.
 * Body: greeting + reason + bulleted diff summary + CTA placeholder.
 */
export const composeEmailPayload = (
  p: NotificationPayload,
): { subject: string; body: string } => {
  // Cycle 9c §3.1.3 — destructive (refund/cancel) uses a different
  // subject + body template since the action is heavier than a content edit.
  if (p.severity === "destructive") {
    const action = p.diffSummary[0] ?? "Order updated";
    const subject = `${p.brandName}: ${action} — '${p.eventName}'`;
    const body = [
      `Hi,`,
      ``,
      `${p.brandName} ${action.toLowerCase()} for '${p.eventName}'.`,
      ``,
      `Reason: ${p.reason}`,
      ``,
      `Tap here to review your order: <web-link-resolved-by-9c>`,
      ``,
      `— Mingla Business`,
    ].join("\n");
    return { subject, body };
  }
  // Additive / material — original ORCH-0704 v2 template
  const subject = `${p.brandName} updated '${p.eventName}': ${truncate(p.reason, 80)}`;
  const body = [
    `Hi,`,
    ``,
    `${p.brandName} just updated their event '${p.eventName}'.`,
    ``,
    `Why: ${p.reason}`,
    ``,
    `What changed:`,
    ...p.diffSummary.map((line) => `  • ${line}`),
    ``,
    `Tap here to review your order: <web-link-resolved-by-9c>`,
    ``,
    `— Mingla Business`,
  ].join("\n");
  return { subject, body };
};

/**
 * Compose SMS payload (≤160 chars). Reason is truncated with ellipsis
 * if needed to keep the message under the cellular SMS hard cap.
 */
export const composeSmsPayload = (p: NotificationPayload): string => {
  // Cycle 9c §3.1.3 — destructive (refund/cancel) uses an action-prefixed
  // template since the buyer needs the action verb up front.
  if (p.severity === "destructive") {
    const action = p.diffSummary[0] ?? "Order updated";
    const baseTemplate = `${p.brandName}: ${action} for ${p.eventName}: . Details: <orderUrl>`;
    const baseLen = baseTemplate.length;
    const reasonBudget = 160 - baseLen;
    const reasonForSms =
      p.reason.length > reasonBudget
        ? `${p.reason.slice(0, Math.max(reasonBudget - 1, 0))}…`
        : p.reason;
    return `${p.brandName}: ${action} for ${p.eventName}: ${reasonForSms}. Details: <orderUrl>`;
  }
  // Additive / material — original ORCH-0704 v2 template
  const baseTemplate = `${p.brandName} updated ${p.eventName}: . Details: <orderUrl>`;
  const baseLen = baseTemplate.length;
  const reasonBudget = 160 - baseLen;
  const reasonForSms =
    p.reason.length > reasonBudget
      ? `${p.reason.slice(0, Math.max(reasonBudget - 1, 0))}…`
      : p.reason;
  return `${p.brandName} updated ${p.eventName}: ${reasonForSms}. Details: <orderUrl>`;
};

/**
 * Decide which notification channels fire for a given severity.
 *
 * Cycle 9c rule (Q-9c-2 default A):
 *   - "additive": banner + email (no SMS — avoid notification fatigue
 *     for cosmetic edits like description/cover changes)
 *   - "material": banner + email + SMS (only if hasWebPurchaseOrders —
 *     v2-A from ORCH-0704)
 *   - "destructive" (Cycle 9c — refund/cancel): banner + email + SMS
 *     ALWAYS (regardless of hasWebPurchaseOrders — money moved, the
 *     buyer needs every reach we have)
 *
 * Push is always false in ORCH-0704 + Cycle 9c (consumer app deferred).
 */
export const deriveChannelFlags = (
  severity: EditSeverity,
  hasWebPurchaseOrders: boolean,
): NotificationChannelFlags => ({
  banner: true,
  email: true,
  sms:
    severity === "destructive" ||
    (severity === "material" && hasWebPurchaseOrders),
  push: false, // [TRANSITIONAL] deferred — consumer app cycle wires OneSignal
});

/**
 * Fire-and-forget — caller does not await. Notifications are best-effort.
 *
 * [TRANSITIONAL] Each branch logs its payload to the console.
 *
 * EXIT CONDITIONS:
 *   - email: B-cycle replaces stub with Resend send via edge function
 *   - sms:   B-cycle replaces stub with Twilio send via edge function
 *   - push:  consumer app cycle wires OneSignal player IDs per buyer
 *   - banner: Cycle 9c reads useEventEditLogStore on buyer order detail page
 *
 * Per ORCH-0704 v2 spec §3.3.1.
 */
export const notifyEventChanged = async (
  payload: NotificationPayload,
  channels: NotificationChannelFlags,
): Promise<void> => {
  // Banner: no synchronous side effect — entry already in
  // useEventEditLogStore via updateLiveEventFields. This branch logs
  // for traceability only. Cycle 9c renders.
  if (channels.banner) {
    // eslint-disable-next-line no-console
    console.log("[banner-recorded]", {
      eventId: payload.eventId,
      severity: payload.severity,
      reason: payload.reason,
    });
  }

  if (channels.email) {
    const { subject, body } = composeEmailPayload(payload);
    // [TRANSITIONAL] EXIT: B-cycle replaces with Resend edge function call
    // eslint-disable-next-line no-console
    console.log("[email-stub]", {
      to: "<resolved-by-9c-from-affectedOrderIds>",
      subject,
      body,
      eventId: payload.eventId,
    });
  }

  if (channels.sms) {
    const text = composeSmsPayload(payload);
    // [TRANSITIONAL] EXIT: B-cycle replaces with Twilio edge function call
    // eslint-disable-next-line no-console
    console.log("[sms-stub]", {
      to: "<resolved-by-9c-from-webPurchaseOrderIds>",
      text,
      length: text.length,
      eventId: payload.eventId,
    });
  }

  if (channels.push) {
    // [TRANSITIONAL] EXIT: consumer app cycle wires OneSignal player IDs
    // (channels.push is always false in ORCH-0704 — block unreachable today)
    // eslint-disable-next-line no-console
    console.log("[push-deferred]", {
      reason: "consumer app not built yet",
      eventId: payload.eventId,
    });
  }
};
