/**
 * tripChangeNotifier — multi-channel notification stack for published-trip
 * edits (ORCH-0876).
 *
 * Mirror of `mingla-business/src/services/eventChangeNotifier.ts`. Routes
 * through 4 channels per `NotificationChannelFlags`:
 *   - banner: in-app banner data lives in the DB `trip_edit_log` table
 *     (RPC writes; owner reads via `useTripEditLog`); future consumer-side
 *     buyer surface reads from the same table once Mingla consumer-app
 *     trip surface ships.
 *   - email: TRANSITIONAL console.log stub. B-cycle replaces with Resend.
 *   - sms: TRANSITIONAL console.log stub. B-cycle replaces with Twilio.
 *   - push: DEFERRED — consumer app doesn't have trip surface yet. Always
 *     false in the channel flags.
 *
 * Severity-driven channel rules (Q11 lock):
 *   - additive  → banner + email (no SMS, no push)
 *   - material  → banner + email + (SMS if hasWebPurchaseOrders)
 *
 * Audit note: tripChangeNotifier is FIRE-AND-FORGET. It MUST NOT block
 * the save flow. The banner data is already in `trip_edit_log` by the
 * time this fires; email/sms are best-effort stubs.
 */

import type { TripEditSeverity } from "../utils/tripAdapter";

export interface TripNotificationPayload {
  eventId: string;
  tripTitle: string;
  brandName: string;
  brandSlug: string;
  tripSlug: string;
  reason: string;
  severity: TripEditSeverity;
  changedKeys: string[];
  affectedOrderIds: string[];
  occurredAt: string;
}

export interface NotificationChannelFlags {
  banner: boolean;
  email: boolean;
  sms: boolean;
  push: boolean;
}

/**
 * Decide which channels fire for a given severity + web-purchase context.
 *
 * Locked by ORCH-0876 SPEC §0 Q11 + §11 SC-4.17:
 *   - "additive": banner + email (avoid SMS notification fatigue for
 *     cosmetic/forward-only edits)
 *   - "material": banner + email + SMS (only when the trip has confirmed
 *     web purchases — those buyers paid by card/apple_pay/google_pay and
 *     get the SMS escalation)
 *   - push: DEFERRED until consumer-app trip surface ships
 */
export const deriveTripChannelFlags = (
  severity: TripEditSeverity,
  hasWebPurchaseOrders: boolean,
): NotificationChannelFlags => ({
  banner: true,
  email: true,
  sms: severity === "material" && hasWebPurchaseOrders,
  push: false,
});

/**
 * Compose email subject + body from notification payload.
 * TRANSITIONAL: B-cycle replaces with Resend templates.
 */
export const composeTripEmailPayload = (
  p: TripNotificationPayload,
): { subject: string; body: string } => {
  const subject =
    p.severity === "material"
      ? `Update to your trip: ${p.tripTitle}`
      : `Trip update: ${p.tripTitle}`;
  const body = [
    `Hi,`,
    ``,
    `${p.brandName} has updated the trip "${p.tripTitle}":`,
    ``,
    `Reason: ${p.reason}`,
    ``,
    p.severity === "material"
      ? `This is a material change. Please review the updated trip details at:`
      : `Updated details available at:`,
    `https://business.usemingla.com/t/${p.brandSlug}/${p.tripSlug}`,
    ``,
    `Your reservation is unchanged — same tier, same price.`,
    ``,
    `— Mingla`,
  ].join("\n");
  return { subject, body };
};

/**
 * Compose SMS body from notification payload.
 * TRANSITIONAL: B-cycle replaces with Twilio template.
 */
export const composeTripSmsPayload = (p: TripNotificationPayload): string =>
  `Update to your trip "${p.tripTitle}" by ${p.brandName}. Reason: ${p.reason}. Details: https://business.usemingla.com/t/${p.brandSlug}/${p.tripSlug}`;

/**
 * Fire-and-forget multi-channel dispatch. Never throws. Failures inside
 * a single channel do not block others (each is wrapped). banner is a
 * no-op here because the trip_edit_log row was inserted server-side by
 * the RPC — banner data IS the log row.
 */
export const notifyTripChanged = async (
  payload: TripNotificationPayload,
  flags: NotificationChannelFlags,
): Promise<void> => {
  // banner: no-op — server-side trip_edit_log row IS the banner data source
  // for the future consumer-app surface.

  if (flags.email) {
    try {
      // [TRANSITIONAL] — B-cycle replaces with Resend send.
      // Exit condition: real email pipe wired for trips (same B-cycle as
      // events' eventChangeNotifier email).
      const email = composeTripEmailPayload(payload);
      // eslint-disable-next-line no-console
      console.info("[tripChangeNotifier] email stub", {
        to: `<affected_order_ids[${payload.affectedOrderIds.length}]>`,
        subject: email.subject,
        bodyPreview: email.body.slice(0, 200),
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[tripChangeNotifier] email stub failed (ignored)", e);
    }
  }

  if (flags.sms) {
    try {
      // [TRANSITIONAL] — B-cycle replaces with Twilio send.
      const body = composeTripSmsPayload(payload);
      // eslint-disable-next-line no-console
      console.info("[tripChangeNotifier] sms stub", {
        to: `<affected_order_ids[${payload.affectedOrderIds.length}]>`,
        body,
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[tripChangeNotifier] sms stub failed (ignored)", e);
    }
  }

  // push: DEFERRED — no consumer-app trip surface yet.
};
