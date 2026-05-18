// ORCH-0869 [Tr3 Installment Payments]: dunning email helper.
//
// Per SPEC §3.2.4. Fires when an installment PaymentIntent fails — either
// from the cron's synchronous confirm or from the webhook's async failure
// event. Returns { subject, html, text, from } shape so ticket-confirmation-
// dispatch can hand it to Resend identically to other email kinds.
//
// Cadence per SPEC §3.2.1 + Open Polish §9:
//   - First failure: dunning email fires immediately
//   - Retry 1 (Day 3 later): dunning email fires again on next-attempt failure
//   - Retry 2 (Day 7 later): dunning email fires again
//   - Retry 3 → at_risk=true; final "your booking is at risk" dunning fires
//
// Copy intentionally direct, friendly-but-clear, no blame on the buyer. The
// CTA is "Contact organizer" via mailto:<brand.contact_email> per v1 scope —
// buyer self-update-PM page is a future ORCH (ORCH-0871 follow-up).
//
// ORCH-0869 Stage 1b: SenderIdentity unified with the canonical shape from
// _shared/email/senders.ts ({name, address}). Stage 1 shipped {name, email}
// which only failed TS check once the dispatcher started importing this
// module (Stage 1b first import). No behavioural change — the Stage 1
// webhook handler only passes the result through and never inspected `from`.

import type { SenderIdentity } from "./senders.ts";

export interface InstallmentDunningInput {
  recipient: {
    name: string | null;
    email: string;
  };
  trip: {
    title: string;
  };
  installment: {
    ordinal: number;
    amountCents: number;
    currency: string;
    failureReason: string;
    retryCount: number;       // 0 = first failure; 3 = at-risk
    nextRetryAt: string | null; // ISO timestamp; null = no more retries (at_risk)
  };
  brand: {
    name: string;
    contactEmail: string | null;
  };
  order: {
    shortId: string;
  };
  supportEmail?: string;
}

interface InstallmentDunningResult {
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

function formatRetryDate(iso: string | null): string {
  if (iso === null) return "soon";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return "soon";
  }
}

/**
 * Human-friendly translation of Stripe failure codes. Falls back to the
 * raw reason if no friendly mapping exists.
 */
function friendlyFailureMessage(rawReason: string): string {
  const lower = rawReason.toLowerCase();
  if (lower.includes("card_declined")) return "Your card was declined.";
  if (lower.includes("insufficient_funds")) return "Your card doesn't have enough funds.";
  if (lower.includes("expired_card")) return "Your card has expired.";
  if (lower.includes("incorrect_cvc")) return "The card's security code didn't match.";
  if (lower.includes("authentication_required")) return "Your card needs extra verification (3D Secure).";
  if (lower.includes("processing_error")) return "Your card couldn't be processed right now.";
  return "Your payment didn't go through.";
}

export function renderInstallmentDunningEmail(
  input: InstallmentDunningInput,
): InstallmentDunningResult {
  const isAtRisk = input.installment.retryCount >= 3 || input.installment.nextRetryAt === null;
  const friendlyError = friendlyFailureMessage(input.installment.failureReason);
  const amount = formatMoney(input.installment.amountCents, input.installment.currency);
  const safeBrandName = escapeHtml(input.brand.name);
  const safeTripTitle = escapeHtml(input.trip.title);
  const safeRecipientName = input.recipient.name !== null
    ? escapeHtml(input.recipient.name)
    : "there";
  const contactEmail = input.brand.contactEmail ?? input.supportEmail ?? DEFAULT_SUPPORT_EMAIL;
  const mailtoSubject = encodeURIComponent(
    `Question about my ${input.trip.title} installment payment`,
  );

  // Subject + body vary based on at_risk state.
  const subject = isAtRisk
    ? `Action needed: your ${input.trip.title} booking is at risk`
    : `Action needed: payment for ${input.trip.title}`;

  const headline = isAtRisk
    ? "Your booking is at risk"
    : `Payment ${input.installment.ordinal} needs attention`;

  const intro = isAtRisk
    ? `We tried to charge your card 3 times and weren't able to. Your spot on <strong>${safeTripTitle}</strong> is now flagged as at risk. ${escapeHtml(input.brand.name)} has been notified and may contact you. Please reach out to keep your booking.`
    : `${friendlyError} We weren't able to charge <strong>${amount}</strong> for installment ${input.installment.ordinal} of <strong>${safeTripTitle}</strong>. We'll automatically try again on ${formatRetryDate(input.installment.nextRetryAt)}, but you can contact ${safeBrandName} to update your payment method sooner.`;

  const html = `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f7f7;margin:0;padding:24px;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <h1 style="font-size:22px;margin:0 0 16px;font-weight:600;">${escapeHtml(headline)}</h1>
    <p style="font-size:16px;line-height:1.55;margin:0 0 24px;">Hi ${safeRecipientName},</p>
    <p style="font-size:16px;line-height:1.55;margin:0 0 24px;">${intro}</p>
    <div style="background:#fafafa;border:1px solid #eee;border-radius:8px;padding:16px;margin:0 0 24px;">
      <p style="font-size:14px;color:#666;margin:0 0 6px;">Installment ${input.installment.ordinal} · Order ${escapeHtml(input.order.shortId)}</p>
      <p style="font-size:18px;font-weight:600;margin:0;">${amount}</p>
    </div>
    <a href="mailto:${escapeHtml(contactEmail)}?subject=${mailtoSubject}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:500;">Contact ${safeBrandName}</a>
    <p style="font-size:13px;color:#888;line-height:1.5;margin:32px 0 0;">You received this because you booked ${safeTripTitle} on Mingla. Questions about Mingla? Email <a href="mailto:${DEFAULT_SUPPORT_EMAIL}" style="color:#888;">${DEFAULT_SUPPORT_EMAIL}</a>.</p>
  </div>
</body>
</html>`;

  const text = [
    headline,
    "",
    `Hi ${input.recipient.name ?? "there"},`,
    "",
    isAtRisk
      ? `We tried to charge your card 3 times and weren't able to. Your spot on ${input.trip.title} is now flagged as at risk. ${input.brand.name} has been notified.`
      : `${friendlyError} We weren't able to charge ${amount} for installment ${input.installment.ordinal} of ${input.trip.title}. We'll automatically try again on ${formatRetryDate(input.installment.nextRetryAt)}.`,
    "",
    `Installment ${input.installment.ordinal} · Order ${input.order.shortId}`,
    `Amount: ${amount}`,
    "",
    `Contact ${input.brand.name}: ${contactEmail}`,
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
