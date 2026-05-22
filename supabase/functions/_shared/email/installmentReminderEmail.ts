// ORCH-0914 [Trip Money tab redesign] — manual installment reminder template.

export interface InstallmentReminderEmailInput {
  buyerName: string | null;
  buyerEmail: string;
  tripTitle: string;
  brandDisplayName: string;
  nextInstallmentAmount: string;
  nextInstallmentDueAt: string;
  bookingId: string;
  unsubscribeUrl: string;
}

export interface InstallmentReminderEmailResult {
  subject: string;
  htmlBody: string;
  textBody: string;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderInstallmentReminderEmail(
  input: InstallmentReminderEmailInput,
): InstallmentReminderEmailResult {
  const buyerName = input.buyerName?.trim()
    ? input.buyerName.trim()
    : "there";
  const subject =
    `Heads up — your next ${input.tripTitle} installment of ${input.nextInstallmentAmount} is due ${input.nextInstallmentDueAt}`;
  const safeBuyerName = escapeHtml(buyerName);
  const safeTripTitle = escapeHtml(input.tripTitle);
  const safeBrandName = escapeHtml(input.brandDisplayName);
  const safeAmount = escapeHtml(input.nextInstallmentAmount);
  const safeDueAt = escapeHtml(input.nextInstallmentDueAt);
  const safeBookingId = escapeHtml(input.bookingId);
  const safeUnsubscribeUrl = escapeHtml(input.unsubscribeUrl);

  const htmlBody = `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f7f7;margin:0;padding:24px;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <h1 style="font-size:22px;margin:0 0 16px;font-weight:600;">Upcoming installment reminder</h1>
    <p style="font-size:16px;line-height:1.55;margin:0 0 18px;">Hi ${safeBuyerName},</p>
    <p style="font-size:16px;line-height:1.55;margin:0 0 24px;">${safeBrandName} sent a reminder that your next installment for <strong>${safeTripTitle}</strong> is due soon.</p>
    <div style="background:#fafafa;border:1px solid #eee;border-radius:8px;padding:16px;margin:0 0 24px;">
      <p style="font-size:14px;color:#666;margin:0 0 6px;">Booking ${safeBookingId}</p>
      <p style="font-size:18px;font-weight:600;margin:0 0 4px;">${safeAmount}</p>
      <p style="font-size:15px;margin:0;color:#444;">Due ${safeDueAt}</p>
    </div>
    <p style="font-size:16px;line-height:1.55;margin:0 0 24px;">Update your card if needed so your place stays covered.</p>
    <p style="font-size:13px;color:#888;line-height:1.5;margin:32px 0 0;">You received this because you booked ${safeTripTitle} on Mingla. <a href="${safeUnsubscribeUrl}" style="color:#888;">Manage email preferences</a>.</p>
  </div>
</body>
</html>`;

  const textBody = [
    "Upcoming installment reminder",
    "",
    `Hi ${buyerName},`,
    "",
    `${input.brandDisplayName} sent a reminder that your next installment for ${input.tripTitle} is due soon.`,
    "",
    `Booking ${input.bookingId}`,
    `Amount: ${input.nextInstallmentAmount}`,
    `Due: ${input.nextInstallmentDueAt}`,
    "",
    "Update your card if needed so your place stays covered.",
    "",
    `Manage email preferences: ${input.unsubscribeUrl}`,
  ].join("\n");

  return { subject, htmlBody, textBody };
}
