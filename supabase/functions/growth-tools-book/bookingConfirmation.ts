// #4452 §5.10 (rework 1, P1-8 / SC-86): the booker's "You're booked in" email.
// Pure (no env, no I/O) so its golden is pinned in _shared/email/__tests__.
// A booked-call confirmation carries the audience's action bar with the app
// button only (the design's noCall): they have already booked the call.
import { renderShell, SHELL_TOKENS } from "../_shared/email/shell.ts";
import { escapeHtml } from "../_shared/email/escape.ts";

const { BRAND_ORANGE_BUTTON, BRAND_INK, BRAND_MUTED } = SHELL_TOKENS;

export function emailButton(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${BRAND_ORANGE_BUTTON};color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:9999px;font-size:15px;">${escapeHtml(label)}</a>`;
}

export interface BookingConfirmationInput {
  when: string;
  meetUrl: string | null;
  audience: "host" | "creator" | "local";
  supportEmail: string;
  logoUrl: string;
  footerAddress: string;
}

export function renderBookingConfirmation(input: BookingConfirmationInput): { html: string; text: string; preheader: string } {
  const meetBtn = input.meetUrl
    ? `<p style="margin:20px 0 0;">${emailButton(input.meetUrl, "Join the Google Meet")}</p>`
    : "";
  const bodyHtml = `
    <h1 style="margin:0 0 8px;color:${BRAND_INK};font-size:22px;">You’re booked in ✅</h1>
    <p style="margin:0 0 4px;color:${BRAND_INK};font-size:16px;">Your call with Mingla is confirmed for:</p>
    <p style="margin:0 0 8px;color:${BRAND_INK};font-size:18px;font-weight:700;">${escapeHtml(input.when)}</p>
    <p style="margin:0;color:${BRAND_MUTED};font-size:14px;">A Google Calendar invite with the Meet link is also on its way. Reply to this email if you need to move it.</p>
    ${meetBtn}`;
  const text =
    `You're booked in.\n\nYour call with Mingla is confirmed for ${input.when}.\n` +
    `A Google Calendar invite with the Meet link is on its way.` +
    (input.meetUrl ? `\n\nMeet: ${input.meetUrl}` : "");
  const preheader = `Confirmed: ${input.when}`;
  const html = renderShell({
    preheader,
    bodyHtml,
    supportEmail: input.supportEmail,
    logoUrl: input.logoUrl,
    footerAddress: input.footerAddress,
    actionBar: { kind: input.audience, noCall: true },
  });
  return { html, text, preheader };
}
