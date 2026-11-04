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

export type HostLiveEditProblemAlertInput = {
  planId: string;
  brandId: string;
  actorId: string | null;
  kind: "undo_failed" | "not_reverted" | "lapsed_claim" | "unconfirmed";
  platforms: string[];
  detail: string;
  idempotencyKey: string;
};

/**
 * #4238 r8 P2-1: a Host live edit left an app on an amount Mingla did not
 * record (an undo failed, or another edit won after a push). Same inbox as
 * launch attempts. Fire-and-forget: never throws to callers.
 */
export async function notifyHostLiveEditProblem(
  input: HostLiveEditProblemAlertInput,
): Promise<void> {
  try {
    const recipients = launchAttemptRecipients();
    if (recipients.length === 0) {
      console.warn("[host-live-edit] recipients missing; alert not sent", {
        planId: input.planId,
      });
      return;
    }
    const what = input.kind === "undo_failed"
      ? "A live budget change failed and Mingla could NOT undo it."
      : input.kind === "unconfirmed"
      ? "A live budget change was pushed but Mingla could not confirm it was recorded; nothing was undone."
      : input.kind === "lapsed_claim"
      ? "An earlier live budget change stopped part-way (no record after 10 minutes); it may have changed an app's daily budget."
      : "A live budget change was pushed but another edit was recorded first.";
    await sendOpsAlertEmail({
      subject: `[Ads live edit CHECK] ${input.platforms.join(", ")} · plan ${
        input.planId.slice(0, 8)
      }`,
      paragraphs: [
        what,
        `Apps to check: ${input.platforms.join(", ")} (the daily budget there may not match Mingla's record).`,
        `Plan ID: ${input.planId}`,
        `Brand ID: ${input.brandId}`,
        `Actor: ${input.actorId ?? "(unknown)"}`,
        `Detail: ${input.detail.trim().slice(0, 500)}`,
      ],
      recipients,
      idempotencyKey: `host_live_problem_${input.kind}_${input.idempotencyKey}`
        .slice(0, 200),
    });
  } catch (err) {
    console.error("[host-live-edit] ops alert failed (non-fatal)", {
      planId: input.planId,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}
