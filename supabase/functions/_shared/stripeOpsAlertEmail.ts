// ORCH-0956 — Shared helper for Stripe operator alerts via Resend email.
// Replaces the prior OneSignal push path for dispute + webhook-signature-failure
// alerts. See SPEC_ORCH-0956_STRIPE_OPS_ALERTS_EMAIL.md.

import {
  assertNotResendSandbox,
  EMAIL_SENDERS,
  formatSenderHeader,
  renderTransactionalEmail,
} from "./email/index.ts";

export interface OpsAlertEmailInput {
  subject: string;
  paragraphs: string[];
  recipients: string[];
  cta?: { label: string; url: string } | null;
}

export interface OpsAlertEmailResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

const RESEND_API_URL = "https://api.resend.com/emails";

function normalizeRecipients(raw: string[]): string[] {
  return Array.from(
    new Set(
      raw
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0 && s.includes("@")),
    ),
  );
}

export async function sendOpsAlertEmail(
  input: OpsAlertEmailInput,
): Promise<OpsAlertEmailResult> {
  const recipients = normalizeRecipients(input.recipients);
  if (recipients.length === 0) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[stripe-ops-alert] RESEND_API_KEY missing; alert not sent", {
      subject: input.subject,
      recipientCount: recipients.length,
    });
    return { attempted: recipients.length, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;
  for (const to of recipients) {
    const rendered = renderTransactionalEmail({
      variant: "generic_notification",
      sender: EMAIL_SENDERS.system,
      recipient: { name: null, email: to },
      body: {
        variant: "generic_notification",
        title: input.subject,
        paragraphs: input.paragraphs,
        cta: input.cta ?? null,
      },
    });
    assertNotResendSandbox(rendered.from);

    try {
      const res = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: formatSenderHeader(rendered.from),
          to: [to],
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        }),
      });
      if (res.ok) {
        succeeded += 1;
      } else {
        const detail = await res.text();
        console.error("[stripe-ops-alert] Resend non-2xx", {
          to,
          status: res.status,
          detail,
        });
        failed += 1;
      }
    } catch (err) {
      console.error("[stripe-ops-alert] send failed", {
        to,
        error: err instanceof Error ? err.message : String(err),
      });
      failed += 1;
    }
  }
  return { attempted: recipients.length, succeeded, failed };
}
