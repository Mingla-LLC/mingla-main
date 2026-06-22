// ORCH-1195 FIX 4 — experience-shaped confirmation email helper.
//
// ticket-confirmation-dispatch branches by event_type: 'trip' →
// renderTripConfirmationEmail, 'experience' → THIS helper, else (event) →
// renderTransactionalEmail. Before this, experiences fell into the event branch
// and emailed with NO itinerary/stops. Returns the same { subject, html, text,
// from } shape as the other two so the dispatch hands it to Resend identically,
// and reuses the SAME env resolution (MINGLA_LOGO_URL / MINGLA_FOOTER_ADDRESS /
// MINGLA_FROM_EMAIL via requireEnv) so it inherits the now-set from-address.
//
// Sections:
//   1. Header: brand logo + "You're reserved"
//   2. Experience title + brand + date (occurrence) + venue
//   3. Itinerary (the experience_stops, labelled Start Here / Then / End With)
//      — omitted gracefully when the experience has no stops (Ari/no-stops)
//   4. Order receipt (price + order ID)
//   5. Open-in-app CTA + brand contact + Mingla footer
//
// The QR ticket PDF is still attached by the dispatch (reused, unchanged).

import type { SenderIdentity } from "./senders.ts";

interface ExperienceStop {
  stopOrder: number;
  placeName: string | null;
  address: string | null;
  startTime: string | null; // HH:MM[:SS] wall-clock (presentation only)
  priceCents: number | null;
}

interface ExperienceConfirmationInput {
  recipient: {
    name: string | null;
    email: string;
  };
  experience: {
    title: string;
    dateIso: string | null; // the booked occurrence start (masterDate)
    timezone: string;
    venueText: string | null;
    stops: ExperienceStop[];
  };
  brand: {
    name: string;
    profilePhotoUrl: string | null;
  };
  order: {
    id: string;
    shortId: string;
    totalCents: number;
    currency: string;
  };
  supportEmail?: string;
}

interface ExperienceConfirmationResult {
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

function formatDate(dateIso: string | null, timezone: string): string {
  if (dateIso === null) return "Date to be confirmed";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(dateIso));
  } catch {
    return "Date to be confirmed";
  }
}

// Presentation-only clock time from an authored HH:MM[:SS] (no tz shift —
// matches the app's per-stop time treatment).
function formatStopTime(raw: string | null): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const m = raw.match(/^(\d{1,2}):(\d{2})/);
  if (m === null) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  const am = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${am ? "AM" : "PM"}`;
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

function stopLabel(index: number, total: number): string {
  if (index === 0) return "Start Here";
  if (index === total - 1 && total > 1) return "End With";
  return "Then";
}

export function renderExperienceConfirmationEmail(
  input: ExperienceConfirmationInput,
): ExperienceConfirmationResult {
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

  const recipientName = input.recipient.name?.trim() || "there";
  const dateLabel = formatDate(input.experience.dateIso, input.experience.timezone);
  const priceLabel = formatCurrency(input.order.totalCents, input.order.currency);
  const stops = [...input.experience.stops].sort(
    (a, b) => a.stopOrder - b.stopOrder,
  );

  const subject = `You're reserved: ${input.experience.title}`;
  const preheader =
    `Your reservation for ${input.experience.title} is confirmed. Order ${input.order.shortId}.`;

  const stopsHtml =
    stops.length === 0
      ? ""
      : `<h3 style="font-size:14px;color:#475569;margin:24px 0 8px 0;">Your itinerary</h3>
         <ol style="padding-left:0;margin:0 0 16px 0;list-style:none;">
           ${stops
             .map((s, i) => {
               const t = formatStopTime(s.startTime);
               const place = escapeHtml(s.placeName || `Stop ${i + 1}`);
               const addr = s.address ? escapeHtml(s.address) : "";
               return `<li style="margin-bottom:12px;color:#0F172A;font-size:15px;line-height:1.5;">
                 <span style="display:inline-block;font-size:11px;font-weight:700;color:#F97316;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(stopLabel(i, stops.length))}</span><br>
                 <strong>${place}</strong>${t ? ` <span style="color:#475569;">· ${escapeHtml(t)}</span>` : ""}
                 ${addr ? `<br><span style="font-size:13px;color:#475569;">${addr}</span>` : ""}
               </li>`;
             })
             .join("")}
         </ol>`;

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
              <h1 style="font-size:24px;color:#0F172A;margin:0 0 8px 0;">You're reserved.</h1>
              <p style="font-size:15px;line-height:1.5;color:#475569;margin:0 0 24px 0;">Hi ${escapeHtml(recipientName)} — your reservation is confirmed for the experience below. Save this email for your records.</p>

              <div style="padding:20px;background:#F8FAFC;border:1px solid #E5E7EB;border-radius:8px;margin-bottom:16px;">
                <h2 style="font-size:18px;color:#0F172A;margin:0 0 4px 0;">${escapeHtml(input.experience.title)}</h2>
                <p style="font-size:14px;color:#475569;margin:0;">by ${escapeHtml(input.brand.name)}</p>
                <p style="font-size:15px;color:#0F172A;margin:12px 0 0 0;"><strong>📅</strong> ${escapeHtml(dateLabel)}</p>
                ${
                  input.experience.venueText
                    ? `<p style="font-size:15px;color:#0F172A;margin:6px 0 0 0;"><strong>📍</strong> ${escapeHtml(input.experience.venueText)}</p>`
                    : ""
                }
              </div>

              ${stopsHtml}

              <h3 style="font-size:14px;color:#475569;margin:24px 0 8px 0;">Receipt</h3>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #E5E7EB;">
                <tr><td style="padding:8px 0;font-size:14px;color:#475569;">Order</td><td style="padding:8px 0;font-size:14px;color:#0F172A;text-align:right;">${escapeHtml(input.order.shortId)}</td></tr>
                <tr><td style="padding:8px 0;font-size:14px;color:#475569;border-top:1px solid #E5E7EB;">Total paid</td><td style="padding:8px 0;font-size:16px;font-weight:700;color:#0F172A;text-align:right;border-top:1px solid #E5E7EB;">${escapeHtml(priceLabel)}</td></tr>
              </table>

              <div style="margin-top:32px;padding:24px;background:#FFF5EC;border-radius:12px;border:1px solid #FFD9B8;text-align:center;">
                <p style="margin:0;font-size:15px;color:#6B5A47;">Your ticket + details are in the Mingla app</p>
                <a href="https://usemingla.com/orders/${escapeHtml(input.order.id)}/chat" style="display:inline-block;margin-top:12px;padding:12px 24px;background:#F97316;color:white;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Open in Mingla</a>
              </div>

              <p style="font-size:13px;color:#475569;margin:24px 0 0 0;line-height:1.5;">Questions? Reply directly to ${escapeHtml(input.brand.name)} — they'll receive your message at the email they set up for the brand.</p>
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
    `You're reserved: ${input.experience.title}`,
    `by ${input.brand.name}`,
    ``,
    `Date: ${dateLabel}`,
    input.experience.venueText ? `Where: ${input.experience.venueText}` : null,
    ``,
    stops.length > 0 ? "Itinerary:" : null,
    ...stops.map((s, i) => {
      const t = formatStopTime(s.startTime);
      return `  ${stopLabel(i, stops.length)}: ${s.placeName || `Stop ${i + 1}`}${
        t ? ` (${t})` : ""
      }${s.address ? ` — ${s.address}` : ""}`;
    }),
    ``,
    `Order: ${input.order.shortId}`,
    `Total paid: ${priceLabel}`,
    ``,
    `Your ticket + details are in the Mingla app: https://usemingla.com/orders/${input.order.id}/chat`,
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
    from: { address: fromAddress, name: DEFAULT_FROM_NAME },
  };
}
