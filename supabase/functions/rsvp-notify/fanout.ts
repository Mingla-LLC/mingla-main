/**
 * ORCH-1150 — pure multi-channel fan-out for rsvp-notify (extracted so the unit
 * test can import it without booting the edge-fn server).
 *
 * do NOT merge back into the ticket-notification path — RSVP notify is
 * TRANSACTIONAL (the guest's own RSVP action), outside marketing-consent.
 * See SPEC §5.6 / §9.5.
 */

export interface ChannelSenders {
  push: (() => Promise<boolean>) | null; // null = no token (skip)
  email: (() => Promise<boolean>) | null; // null = no address (skip)
  sms: (() => Promise<boolean>) | null; // null = no address (skip)
}

export interface FanOutResult {
  outcome: { push: boolean; email: boolean; sms: boolean };
  anyAttempted: boolean;
  anySucceeded: boolean;
  status: "sent" | "failed_retryable" | "skipped";
}

/**
 * Attempt every channel whose sender is non-null. EACH runs in its OWN
 * try/catch so one channel throwing NEVER aborts the others (Constitution #3).
 * status = sent when ≥1 succeeded; failed_retryable when all attempted failed;
 * skipped when nothing was attempted.
 */
export async function fanOutChannels(senders: ChannelSenders): Promise<FanOutResult> {
  const outcome = { push: false, email: false, sms: false };
  let anyAttempted = false;

  if (senders.push !== null) {
    anyAttempted = true;
    try {
      outcome.push = await senders.push();
    } catch (err) {
      console.warn("[rsvp-notify] push failed (isolated)", String(err));
    }
  }
  if (senders.email !== null) {
    anyAttempted = true;
    try {
      outcome.email = await senders.email();
    } catch (err) {
      console.warn("[rsvp-notify] email failed (isolated)", String(err));
    }
  }
  if (senders.sms !== null) {
    anyAttempted = true;
    try {
      outcome.sms = await senders.sms();
    } catch (err) {
      console.warn("[rsvp-notify] sms failed (isolated)", String(err));
    }
  }

  const anySucceeded = outcome.push || outcome.email || outcome.sms;
  const status: FanOutResult["status"] = !anyAttempted
    ? "skipped"
    : anySucceeded
      ? "sent"
      : "failed_retryable";
  return { outcome, anyAttempted, anySucceeded, status };
}
