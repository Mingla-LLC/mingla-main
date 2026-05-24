import { escapeHtml } from "../escape.ts";

export interface WaitlistSpotOpenEmailInput {
  brand: { name: string };
  event: { title: string };
  ticketType: { name: string };
  qtyRequested: number;
  expiresAt: string;
  claimUrl: string;
}

export interface WaitlistSpotOpenEmailResult {
  subject: string;
  html: string;
  text: string;
}

function formatExpiry(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "24 hours";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function renderWaitlistSpotOpenEmail(
  input: WaitlistSpotOpenEmailInput,
): WaitlistSpotOpenEmailResult {
  const eventTitle = input.event.title.trim().length > 0
    ? input.event.title.trim()
    : "your event";
  const brandName = input.brand.name.trim().length > 0
    ? input.brand.name.trim()
    : "the organiser";
  const ticketTypeName = input.ticketType.name.trim().length > 0
    ? input.ticketType.name.trim()
    : "ticket";
  const qty = Math.max(1, Math.trunc(input.qtyRequested));
  const safeEventTitle = escapeHtml(eventTitle);
  const safeBrandName = escapeHtml(brandName);
  const safeTicketTypeName = escapeHtml(ticketTypeName);
  const safeClaimUrl = escapeHtml(input.claimUrl);
  const expiry = formatExpiry(input.expiresAt);

  const subject = `A spot just opened: ${eventTitle}`;
  const html = `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f7f7;margin:0;padding:24px;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <h1 style="font-size:22px;margin:0 0 16px;font-weight:650;">A spot just opened</h1>
    <p style="font-size:16px;line-height:1.55;margin:0 0 18px;">Good news: ${safeBrandName} has a ${safeTicketTypeName} spot open for <strong>${safeEventTitle}</strong>.</p>
    <p style="font-size:16px;line-height:1.55;margin:0 0 24px;">You joined the waitlist for ${qty} ${
    qty === 1 ? "ticket" : "tickets"
  }. Claim your spot within 24 hours.</p>
    <a href="${safeClaimUrl}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:600;">Claim spot</a>
    <p style="font-size:13px;color:#666;line-height:1.5;margin:24px 0 0;">This invite expires at ${
    escapeHtml(expiry)
  }.</p>
    <p style="font-size:12px;color:#888;line-height:1.5;margin:28px 0 0;">You're getting this because you joined the waitlist for ${safeEventTitle} on Mingla.</p>
  </div>
</body>
</html>`;

  const text = [
    `A spot just opened: ${eventTitle}`,
    "",
    `${brandName} has a ${ticketTypeName} spot open for ${eventTitle}.`,
    `You joined the waitlist for ${qty} ${qty === 1 ? "ticket" : "tickets"}.`,
    "",
    `Claim within 24 hours: ${input.claimUrl}`,
    `This invite expires at ${expiry}.`,
    "",
    `You're getting this because you joined the waitlist for ${eventTitle} on Mingla.`,
  ].join("\n");

  return { subject, html, text };
}
