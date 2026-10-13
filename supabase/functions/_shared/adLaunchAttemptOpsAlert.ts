/**
 * toward #3697 Wave 8 — every Ads launch attempt emails admins (Phase 3).
 * Reuses the Stripe dispute ops-alert inbox — never invent a new recipient secret.
 * Fail-open: launch success/failure is never blocked on email delivery.
 */

import { resolveAlertRecipientValue } from "./secretBundle.ts";
import { sendOpsAlertEmail } from "./stripeOpsAlertEmail.ts";

export type AdLaunchAttemptAlertInput = {
  source: "host" | "admin";
  outcome: "accepted" | "rejected" | "failed";
  campaignId: string;
  brandId: string | null;
  platform: string | null;
  name: string | null;
  actorId: string | null;
  detail?: string | null;
  reason?: string | null;
  /** Stable key so Resend retries collapse (include outcome + attempt id). */
  idempotencyKey: string;
};

function launchAttemptRecipients(): string[] {
  const value = resolveAlertRecipientValue(
    "stripe_disputes",
    "STRIPE_DISPUTE_ALERT_EMAILS",
  );
  if (Array.isArray(value)) {
    const emails = value.map((s) => String(s).trim()).filter(Boolean);
    if (emails.length > 0) return emails;
  }
  const raw = value ?? "seth@usemingla.com";
  return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Fire-and-forget admin email for a launch attempt. Never throws to callers.
 */
export async function notifyAdLaunchAttempt(
  input: AdLaunchAttemptAlertInput,
): Promise<void> {
  try {
    const recipients = launchAttemptRecipients();
    if (recipients.length === 0) {
      console.warn("[ad-launch-attempt] recipients missing; alert not sent", {
        campaignId: input.campaignId,
        source: input.source,
      });
      return;
    }
    const outcomeLabel = input.outcome.toUpperCase();
    const paragraphs = [
      `Source: ${input.source} Ads launch`,
      `Outcome: ${outcomeLabel}`,
      `Campaign ID: ${input.campaignId}`,
      `Brand ID: ${input.brandId ?? "(unknown)"}`,
      `Platform: ${input.platform ?? "(unknown)"}`,
      `Name: ${input.name ?? "(unnamed)"}`,
      `Actor: ${input.actorId ?? "(unknown)"}`,
    ];
    if (input.reason && input.reason.trim().length > 0) {
      paragraphs.push(`Reason: ${input.reason.trim().slice(0, 500)}`);
    }
    if (input.detail && input.detail.trim().length > 0) {
      paragraphs.push(`Detail: ${input.detail.trim().slice(0, 500)}`);
    }
    await sendOpsAlertEmail({
      subject:
        `[Ads launch ${outcomeLabel}] ${input.source} · ${
          input.platform ?? "?"
        } · ${input.campaignId.slice(0, 8)}`,
      paragraphs,
      recipients,
      idempotencyKey: input.idempotencyKey.slice(0, 200),
    });
  } catch (err) {
    console.error("[ad-launch-attempt] ops alert failed (non-fatal)", {
      campaignId: input.campaignId,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
