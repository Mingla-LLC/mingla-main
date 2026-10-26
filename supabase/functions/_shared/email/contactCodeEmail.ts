// Issue #4063 — email verification code rendered through the shared brand
// shell. Runtime configuration is passed in so this module never reads env.

import { escapeHtml } from "./escape.ts";
import type { SenderIdentity } from "./senders.ts";
import { renderShell, SHELL_TOKENS } from "./shell.ts";

const { BRAND_INK, BRAND_MUTED } = SHELL_TOKENS;

export interface ContactCodeEmailInput {
  code: string;
  supportEmail: string;
  logoUrl: string;
  footerAddress: string;
  sender: SenderIdentity;
}

export interface ContactCodeEmailResult {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  from: SenderIdentity;
}

export function renderContactCodeEmail(
  input: ContactCodeEmailInput,
): ContactCodeEmailResult {
  if (!/^\d{6}$/.test(input.code)) {
    throw new Error("contact_code_email_invalid_code");
  }

  const subject = `Your Mingla code: ${input.code}`;
  const preheader = "Use it in the Mingla app. It works for 10 minutes.";
  const heading = "Your code";
  const body = "Enter it in the Mingla app. It works for 10 minutes.";
  const footer = "Didn't ask for this? You can ignore this email.";
  const safeCode = escapeHtml(input.code);
  const bodyHtml =
    `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:${BRAND_INK};font-weight:700;">${heading}</h1>
<p style="margin:0 0 18px 0;font-size:34px;line-height:1.2;letter-spacing:8px;color:${BRAND_INK};font-weight:800;">${safeCode}</p>
<p style="margin:0 0 18px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">${body}</p>
<p style="margin:0;font-size:13px;line-height:1.55;color:${BRAND_MUTED};">${footer}</p>`;

  return {
    subject,
    preheader,
    html: renderShell({
      preheader,
      bodyHtml,
      supportEmail: input.supportEmail,
      logoUrl: input.logoUrl,
      footerAddress: input.footerAddress,
    }),
    text: [heading, "", input.code, "", body, "", footer].join("\n"),
    from: input.sender,
  };
}
