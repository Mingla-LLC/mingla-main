// ORCH-0869 [Tr3 Installment Payments] Stage 1b: paid-in-full confirmation
// email helper.
//
// Fires from ticket-confirmation-dispatch when an installment PI succeeds AND
// it was the last unpaid installment for the order (handleInstallmentPayment
// Succeeded in _shared/installmentWebhookHandlers.ts dispatches with
// kind: "installment_plan_paid_in_full"). One-shot per order: celebrates the
// completed payment plan and confirms the buyer's spot.
//
// Shape mirrors installmentDunningEmail.ts so the dispatcher can route both
// kinds through identical Resend send paths.

import type { SenderIdentity } from "./senders.ts";

export interface InstallmentPlanPaidInFullInput {
  recipient: {
    name: string | null;
    email: string;
  };
  trip: {
    title: string;
  };
  brand: {
    name: string;
    contactEmail: string | null;
  };
  order: {
    shortId: string;
    totalCents: number;
    currency: string;
  };
}

interface InstallmentPlanPaidInFullResult {
  subject: string;
  html: string;
  text: string;
  from: SenderIdentity;
}

const DEFAULT_SUPPORT_EMAIL = "support@usemingla.com";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMoney(amountCents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function renderInstallmentPlanPaidInFullEmail(
  input: InstallmentPlanPaidInFullInput,
): InstallmentPlanPaidInFullResult {
  const safeBrandName = escapeHtml(input.brand.name);
  const safeTripTitle = escapeHtml(input.trip.title);
  const safeRecipientName = input.recipient.name !== null
    ? escapeHtml(input.recipient.name)
    : "there";
  const totalPaid = formatMoney(input.order.totalCents, input.order.currency);
  const contactEmail = input.brand.contactEmail ?? DEFAULT_SUPPORT_EMAIL;

  const subject = `You're all paid up: ${input.trip.title}`;

  const html = `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f7f7;margin:0;padding:24px;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <h1 style="font-size:22px;margin:0 0 16px;font-weight:600;">Payment plan complete</h1>
    <p style="font-size:16px;line-height:1.55;margin:0 0 24px;">Hi ${safeRecipientName},</p>
    <p style="font-size:16px;line-height:1.55;margin:0 0 24px;">Your final installment for <strong>${safeTripTitle}</strong> has been collected. Your spot is fully confirmed and your payment plan is now complete.</p>
    <div style="background:#fafafa;border:1px solid #eee;border-radius:8px;padding:16px;margin:0 0 24px;">
      <p style="font-size:14px;color:#666;margin:0 0 6px;">Order ${escapeHtml(input.order.shortId)} · ${safeBrandName}</p>
      <p style="font-size:18px;font-weight:600;margin:0;">Total paid in full</p>
    </div>
    <p style="font-size:16px;line-height:1.55;margin:0 0 24px;">Questions about ${safeTripTitle}? Reach out to ${safeBrandName} directly at <a href="mailto:${escapeHtml(contactEmail)}" style="color:#1a1a1a;">${escapeHtml(contactEmail)}</a>.</p>
    <p style="font-size:13px;color:#888;line-height:1.5;margin:32px 0 0;">You received this because you booked ${safeTripTitle} on Mingla. Questions about Mingla? Email <a href="mailto:${DEFAULT_SUPPORT_EMAIL}" style="color:#888;">${DEFAULT_SUPPORT_EMAIL}</a>.</p>
  </div>
</body>
</html>`;

  const text = [
    "Payment plan complete",
    "",
    `Hi ${input.recipient.name ?? "there"},`,
    "",
    `Your final installment for ${input.trip.title} has been collected. Your spot is fully confirmed and your payment plan is now complete.`,
    "",
    `Order ${input.order.shortId} · ${input.brand.name}`,
    `Total paid: ${totalPaid}`,
    "",
    `Questions about ${input.trip.title}? Contact ${input.brand.name}: ${contactEmail}`,
    "",
    `Mingla support: ${DEFAULT_SUPPORT_EMAIL}`,
  ].join("\n");

  return {
    subject,
    html,
    text,
    from: { address: "tickets@usemingla.com", name: "Mingla" },
  };
}
