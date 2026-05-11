// ORCH-0785 — Generic notification + admin-compose body renderer.

import { escapeHtml } from "./escape.ts";
import { SHELL_TOKENS } from "./shell.ts";
import type { GenericBodyInput } from "./types.ts";

const { BRAND_ORANGE, BRAND_INK, BRAND_MUTED } = SHELL_TOKENS;

export function renderGenericBody(input: GenericBodyInput): {
  html: string;
  text: string;
  subject: string;
  preheader: string;
} {
  const paragraphs = input.paragraphs
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const paragraphsHtml = paragraphs
    .map((p) =>
      `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:${BRAND_INK};">${
        escapeHtml(p)
      }</p>`
    )
    .join("");
  const cta = input.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
      <tr>
        <td style="background:${BRAND_ORANGE};border-radius:999px;">
          <a href="${escapeHtml(input.cta.url)}" style="display:inline-block;padding:12px 22px;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;">${
      escapeHtml(input.cta.label)
    }</a>
        </td>
      </tr>
    </table>`
    : "";

  const html = `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:${BRAND_INK};font-weight:700;">${
    escapeHtml(input.title)
  }</h1>
    ${
    paragraphsHtml.length > 0
      ? paragraphsHtml
      : `<p style="margin:0;font-size:15px;color:${BRAND_MUTED};">—</p>`
  }
    ${cta}`;

  const textLines = [input.title, "", ...paragraphs];
  if (input.cta) textLines.push("", `${input.cta.label}: ${input.cta.url}`);

  return {
    html,
    text: textLines.join("\n"),
    subject: input.title,
    preheader: paragraphs[0]?.slice(0, 120) ?? input.title,
  };
}
