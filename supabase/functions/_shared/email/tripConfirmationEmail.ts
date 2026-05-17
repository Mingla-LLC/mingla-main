// ORCH-0859 (Tr2): trip-shaped confirmation email helper.
//
// Per SPEC §4.4: when ticket-confirmation-dispatch detects event_type='trip',
// it branches to this helper for the email template instead of the
// event-shaped renderTransactionalEmail. Returns the same { subject, html,
// text, from } shape as renderTransactionalEmail so the dispatch can hand
// it off to Resend identically.
//
// Sections (per SPEC §4.4):
//   1. Header: brand logo + "You're booked"
//   2. Trip title + destination + date range
//   3. Day-by-day summary (titles only — keeps email scannable)
//   4. What's included / What's NOT included (bulleted)
//   5. Order receipt (price + currency + order ID)
//   6. Brand contact
//   7. Footer with Mingla shell + unsubscribe link
//
// Does NOT include a QR code in the body (per investigation DISCOVERY-2 — for
// trips, QR semantics are less obvious than for events with a scan-at-door
// moment, and the dispatch still attaches the trip PDF as a Resend attachment
// per ORCH-0842 ticket-pdf-fetch reuse, which carries the QR for
// traveler-identification at trip start).

interface SenderIdentity {
  email: string;
  name: string;
}

interface TripConfirmationInput {
  recipient: {
    name: string | null;
    email: string;
  };
  trip: {
    title: string;
    startAtIso: string | null;
    endAtIso: string | null;
    destinationText: string | null;
    timezone: string;
    days: Array<{ ordinal: number; title: string }>;
    inclusions: Array<{ kind: "included" | "excluded"; item: string }>;
  };
  brand: {
    name: string;
    profilePhotoUrl: string | null;
  };
  order: {
    shortId: string;
    totalCents: number;
    currency: string;
  };
  supportEmail?: string;
}

interface TripConfirmationResult {
  subject: string;
  html: string;
  text: string;
  from: SenderIdentity;
}

const DEFAULT_SUPPORT_EMAIL = "support@usemingla.com";
const DEFAULT_FROM_NAME = "Mingla";

function requireEnv(key: string, fallback?: string): string {
  const raw = Deno.env.get(key);
  if (raw && raw.trim().length > 0) return raw.trim();
  if (fallback !== undefined) return fallback;
  throw new Error(`email_env_missing:${key}`);
}

function formatDateRange(
  startIso: string | null,
  endIso: string | null,
  timezone: string,
): string {
  if (startIso === null || endIso === null) return "Dates to be confirmed";
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return `${fmt.format(new Date(startIso))} – ${fmt.format(new Date(endIso))}`;
  } catch {
    return "Dates to be confirmed";
  }
}

function formatCurrency(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderTripConfirmationEmail(
  input: TripConfirmationInput,
): TripConfirmationResult {
  const supportEmail =
    input.supportEmail ?? Deno.env.get("SUPPORT_EMAIL") ?? DEFAULT_SUPPORT_EMAIL;
  const logoUrl = requireEnv(
    "MINGLA_LOGO_URL",
    Deno.env.get("DENO_TESTING") === "1"
      ? "https://usemingla.com/email-assets/mingla-logo.png"
      : undefined,
  );
  const footerAddress = requireEnv(
    "MINGLA_FOOTER_ADDRESS",
    Deno.env.get("DENO_TESTING") === "1" ? "Mingla, hello@usemingla.com" : undefined,
  );
  const fromAddress = requireEnv(
    "MINGLA_FROM_EMAIL",
    Deno.env.get("DENO_TESTING") === "1" ? "hello@send.usemingla.com" : undefined,
  );

  const recipientName = input.recipient.name?.trim() || "Traveler";
  const dateRange = formatDateRange(
    input.trip.startAtIso,
    input.trip.endAtIso,
    input.trip.timezone,
  );
  const priceLabel = formatCurrency(input.order.totalCents, input.order.currency);
  const included = input.trip.inclusions.filter((i) => i.kind === "included");
  const excluded = input.trip.inclusions.filter((i) => i.kind === "excluded");

  const subject = `You're booked: ${input.trip.title}`;
  const preheader =
    `Your booking for ${input.trip.title} is confirmed. Order ${input.order.shortId}.`;

  const daysHtml =
    input.trip.days.length === 0
      ? ""
      : `<h3 style="font-size:14px;color:#475569;margin:24px 0 8px 0;">Itinerary at a glance</h3>
         <ol style="padding-left:20px;margin:0 0 16px 0;">
           ${input.trip.days
             .map(
               (d) =>
                 `<li style="margin-bottom:6px;color:#0F172A;font-size:15px;line-height:1.5;"><strong>Day ${d.ordinal}:</strong> ${escapeHtml(d.title)}</li>`,
             )
             .join("")}
         </ol>`;

  const inclusionsHtml = (() => {
    if (included.length === 0 && excluded.length === 0) return "";
    let html = "";
    if (included.length > 0) {
      html += `<h3 style="font-size:14px;color:#475569;margin:24px 0 8px 0;">What's included</h3>
        <ul style="padding-left:20px;margin:0 0 16px 0;">
          ${included
            .map(
              (i) =>
                `<li style="margin-bottom:4px;color:#0F172A;font-size:15px;">${escapeHtml(i.item)}</li>`,
            )
            .join("")}
        </ul>`;
    }
    if (excluded.length > 0) {
      html += `<h3 style="font-size:14px;color:#475569;margin:16px 0 8px 0;">What's NOT included</h3>
        <ul style="padding-left:20px;margin:0 0 16px 0;">
          ${excluded
            .map(
              (i) =>
                `<li style="margin-bottom:4px;color:#475569;font-size:15px;">${escapeHtml(i.item)}</li>`,
            )
            .join("")}
        </ul>`;
    }
    return html;
  })();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#FAFAFA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0F172A;">
  <span style="display:none !important;visibility:hidden;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</span>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FAFAFA;">
    <tr>
      <td align="center" style="padding:24px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#FFFFFF;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:24px 32px;text-align:center;border-bottom:1px solid #E5E7EB;">
              <img src="${logoUrl}" alt="Mingla" height="28" style="height:28px;display:inline-block;">
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h1 style="font-size:24px;color:#0F172A;margin:0 0 8px 0;">You're booked.</h1>
              <p style="font-size:15px;line-height:1.5;color:#475569;margin:0 0 24px 0;">Hi ${escapeHtml(recipientName)} — your spot is confirmed on the trip below. Save this email for your records.</p>

              <div style="padding:20px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:16px;">
                <h2 style="font-size:18px;color:#0F172A;margin:0 0 4px 0;">${escapeHtml(input.trip.title)}</h2>
                <p style="font-size:14px;color:#475569;margin:0;">by ${escapeHtml(input.brand.name)}</p>
                <p style="font-size:15px;color:#0F172A;margin:12px 0 0 0;"><strong>📅</strong> ${escapeHtml(dateRange)}</p>
                ${
                  input.trip.destinationText
                    ? `<p style="font-size:15px;color:#0F172A;margin:6px 0 0 0;"><strong>📍</strong> ${escapeHtml(input.trip.destinationText)}</p>`
                    : ""
                }
              </div>

              ${daysHtml}
              ${inclusionsHtml}

              <h3 style="font-size:14px;color:#475569;margin:24px 0 8px 0;">Receipt</h3>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #E5E7EB;">
                <tr><td style="padding:8px 0;font-size:14px;color:#475569;">Order</td><td style="padding:8px 0;font-size:14px;color:#0F172A;text-align:right;">${escapeHtml(input.order.shortId)}</td></tr>
                <tr><td style="padding:8px 0;font-size:14px;color:#475569;border-top:1px solid #E5E7EB;">Total paid</td><td style="padding:8px 0;font-size:16px;font-weight:700;color:#0F172A;text-align:right;border-top:1px solid #E5E7EB;">${escapeHtml(priceLabel)}</td></tr>
              </table>

              <p style="font-size:13px;color:#475569;margin:24px 0 0 0;line-height:1.5;">Questions about your trip? Reply directly to ${escapeHtml(input.brand.name)} — they'll receive your message at the email they set up for the brand.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background:#F8FAFC;border-top:1px solid #E5E7EB;text-align:center;">
              <p style="font-size:12px;color:#94A3B8;margin:0;">${escapeHtml(footerAddress)}</p>
              <p style="font-size:12px;color:#94A3B8;margin:4px 0 0 0;">Support: <a href="mailto:${supportEmail}" style="color:#94A3B8;">${supportEmail}</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `You're booked: ${input.trip.title}`,
    `by ${input.brand.name}`,
    ``,
    `Dates: ${dateRange}`,
    input.trip.destinationText ? `Destination: ${input.trip.destinationText}` : null,
    ``,
    input.trip.days.length > 0 ? "Itinerary:" : null,
    ...input.trip.days.map((d) => `  Day ${d.ordinal}: ${d.title}`),
    ``,
    included.length > 0 ? "What's included:" : null,
    ...included.map((i) => `  - ${i.item}`),
    excluded.length > 0 ? "What's NOT included:" : null,
    ...excluded.map((i) => `  - ${i.item}`),
    ``,
    `Order: ${input.order.shortId}`,
    `Total paid: ${priceLabel}`,
    ``,
    `Reply to ${input.brand.name} with questions.`,
    `Support: ${supportEmail}`,
    footerAddress,
  ]
    .filter((line) => line !== null)
    .join("\n");

  return {
    subject,
    html,
    text,
    from: { email: fromAddress, name: DEFAULT_FROM_NAME },
  };
}
