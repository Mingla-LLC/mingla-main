// ORCH-0785 — Generic notification + admin-compose body renderer.

import { escapeHtml } from "./escape.ts";
import { SHELL_TOKENS } from "./shell.ts";
import type { EmailContentBlock, GenericBodyInput } from "./types.ts";
import { renderBlogPostBlockText } from "./blogPostBlock.ts";

// ORCH-1329 — genericBody's only orange is the CTA button fill (white label),
// so it uses the AA-safe BRAND_ORANGE_BUTTON (#C4471A), not decorative
// BRAND_ORANGE (#FF6B2C).
const { BRAND_ORANGE_BUTTON, BRAND_INK, BRAND_MUTED } = SHELL_TOKENS;

const ALLOWED_RICH_TAGS = new Set([
  "p",
  "h2",
  "h3",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "a",
  "br",
]);

function safeHttpsUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeRichTextHref(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:") return parsed.toString();
    if (
      parsed.protocol === "mailto:" &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.pathname)
    ) {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * #3720 — the composer stores a small structured document, never arbitrary
 * email HTML. Rich-text blocks get an explicit tag/attribute allow-list here,
 * on the server, before they reach the shared shell.
 */
export function sanitizeAdminRichText(value: string): string {
  const withoutExecutableContent = value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "");

  return withoutExecutableContent.replace(
    /<\/?([a-z0-9]+)(?:\s[^>]*)?>/gi,
    (raw, rawTag: string) => {
      const tag = rawTag.toLowerCase();
      if (!ALLOWED_RICH_TAGS.has(tag)) return "";
      if (raw.startsWith("</")) return `</${tag}>`;
      if (tag === "br") return "<br>";
      if (tag !== "a") return `<${tag}>`;

      const hrefMatch = raw.match(/href\s*=\s*["']([^"']+)["']/i);
      const href = hrefMatch ? safeRichTextHref(hrefMatch[1]) : null;
      if (!href) return "<a>";
      return `<a href="${
        escapeHtml(href)
      }" target="_blank" rel="noopener noreferrer">`;
    },
  );
}

function richTextToText(html: string): string {
  return html
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>|<\/h2>|<\/h3>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderDocumentBlock(
  block: EmailContentBlock,
): { html: string; text: string } {
  if (block.type === "divider") {
    return {
      html:
        `<hr role="separator" style="border:0;border-top:1px solid #E6E0D9;margin:24px 0;">`,
      text: "────────",
    };
  }
  if (block.type === "image") {
    const url = safeHttpsUrl(block.url);
    const link = block.link ? safeHttpsUrl(block.link) : null;
    const alt = block.alt.trim();
    if (!url || !alt) return { html: "", text: "" };
    const image = `<img src="${escapeHtml(url)}" alt="${
      escapeHtml(alt)
    }" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:12px;">`;
    return {
      html: `<div style="margin:20px 0;">${
        link
          ? `<a href="${
            escapeHtml(link)
          }" target="_blank" rel="noopener noreferrer">${image}</a>`
          : image
      }</div>`,
      text: `${alt}${link ? `: ${link}` : ""}`,
    };
  }
  if (block.type === "blog_post_resolved") {
    const url = safeHttpsUrl(block.url);
    const cover = block.coverUrl ? safeHttpsUrl(block.coverUrl) : null;
    if (!url) return { html: "", text: "" };
    const title = escapeHtml(block.title);
    const summary = escapeHtml(block.summary);
    const button = escapeHtml(block.buttonText);
    const eyebrow = `${
      escapeHtml(block.categoryLabel.toUpperCase())
    } · ${block.readMinutes} MIN READ`;
    const titleLink = `<a href="${
      escapeHtml(url)
    }" style="color:${BRAND_INK};text-decoration:none;font-weight:800;">${title}</a>`;
    if (block.style === "link") {
      return {
        html:
          `<p style="margin:16px 0;font-size:15px;line-height:1.6;color:${BRAND_INK};">${titleLink} · <a href="${
            escapeHtml(url)
          }" style="color:${BRAND_ORANGE_BUTTON};font-weight:700;">${button}</a></p>`,
        text: renderBlogPostBlockText(block),
      };
    }
    if (block.style === "row") {
      const image = cover
        ? `<td width="112" valign="top" style="padding-right:16px;"><img src="${
          escapeHtml(cover)
        }" width="96" height="72" alt="${
          escapeHtml(block.coverAlt)
        }" style="display:block;width:96px;height:72px;object-fit:cover;border-radius:10px;"></td>`
        : "";
      return {
        html:
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0;border:1px solid #E6E0D9;border-radius:12px;"><tr><td style="padding:14px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${image}<td valign="top"><div style="font-size:11px;font-weight:700;color:#A8450E;text-transform:uppercase;">${eyebrow}</div><div style="margin-top:5px;font-size:17px;line-height:1.3;">${titleLink}</div><a href="${
            escapeHtml(url)
          }" style="display:inline-block;margin-top:8px;color:${BRAND_ORANGE_BUTTON};font-size:13px;font-weight:700;text-decoration:none;">${button} →</a></td></tr></table></td></tr></table>`,
        text: renderBlogPostBlockText(block),
      };
    }
    const image = cover
      ? `<img src="${escapeHtml(cover)}" width="560" alt="${
        escapeHtml(block.coverAlt)
      }" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:12px 12px 0 0;">`
      : "";
    return {
      html:
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;border:1px solid #E6E0D9;border-radius:16px;overflow:hidden;"><tr><td>${image}<div style="padding:20px;"><div style="font-size:12px;font-weight:700;color:#A8450E;text-transform:uppercase;">${eyebrow}</div><div style="margin-top:8px;font-size:20px;line-height:1.3;">${titleLink}</div>${
          summary
            ? `<p style="margin:9px 0 0;font-size:15px;line-height:1.55;color:${BRAND_MUTED};">${summary}</p>`
            : ""
        }<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr><td style="background:${BRAND_ORANGE_BUTTON};border-radius:999px;"><a href="${
          escapeHtml(url)
        }" style="display:inline-block;padding:11px 18px;color:#FFFFFF;font-size:14px;font-weight:700;text-decoration:none;">${button}</a></td></tr></table></div></td></tr></table>`,
      text: renderBlogPostBlockText(block),
    };
  }
  if (block.type === "blog_post") {
    return {
      html:
        `<div style="margin:16px 0;padding:14px;border:1px solid #E6E0D9;border-radius:12px;color:${BRAND_MUTED};">This blog post isn't published, so it won't be sent.</div>`,
      text: "This blog post isn't published, so it won't be sent.",
    };
  }
  const sanitized = sanitizeAdminRichText(block.html);
  return {
    html:
      `<div style="font-size:15px;line-height:1.6;color:${BRAND_INK};">${sanitized}</div>`,
    text: richTextToText(sanitized),
  };
}

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
        <td style="background:${BRAND_ORANGE_BUTTON};border-radius:999px;">
          <a href="${
      escapeHtml(input.cta.url)
    }" style="display:inline-block;padding:12px 22px;color:#FFFFFF;font-size:14px;font-weight:600;text-decoration:none;">${
      escapeHtml(input.cta.label)
    }</a>
        </td>
      </tr>
    </table>`
    : "";

  const document = input.document?.map(renderDocumentBlock).filter((block) =>
    block.html
  );
  const contentHtml = document?.length
    ? document.map((block) => block.html).join("")
    : paragraphsHtml;
  const contentText = document?.length
    ? document.map((block) => block.text).filter(Boolean)
    : paragraphs;

  const html =
    `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;color:${BRAND_INK};font-weight:700;">${
      escapeHtml(input.title)
    }</h1>
    ${
      contentHtml.length > 0
        ? contentHtml
        : `<p style="margin:0;font-size:15px;color:${BRAND_MUTED};">—</p>`
    }
    ${cta}`;

  const textLines = [input.title, "", ...contentText];
  if (input.cta) textLines.push("", `${input.cta.label}: ${input.cta.url}`);

  return {
    html,
    text: textLines.join("\n"),
    subject: input.title,
    preheader: contentText[0]?.slice(0, 120) ?? input.title,
  };
}
