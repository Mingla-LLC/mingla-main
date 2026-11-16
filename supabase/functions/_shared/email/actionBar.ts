// #4452 §5.10 — the two-button action bar above every email footer (design LEADK, actionBar).
//
// Pure: no I/O. Outlook-safe: table layout, VML-free padded-link buttons with
// inline styles, Georgia / Helvetica fallbacks. Under 480 px the buttons stack
// full width (a media query; clients that strip it keep two readable cells).

import { escapeHtml } from "./escape.ts";

export type ActionBarKind = "host" | "creator" | "local" | "explorer";

export interface ActionBarInput {
  kind: ActionBarKind;
  /** Booked-call confirmations show the app button only (the design's noCall). */
  noCall?: boolean;
  /** Host bar: the ICP for /schedule?icp=<icp>. */
  icp?: string | null;
}

const SITE = "https://usemingla.com";
const ICPS = new Set(["events", "trips", "experiences", "restaurants", "hotels", "art", "play"]);

interface BarCopy {
  title: string;
  em: string;
  app: { text: string; href: string };
  call: { text: string; href: string } | null;
}

export function actionBarCopy(input: ActionBarInput): BarCopy {
  const icp = input.icp && ICPS.has(input.icp) ? input.icp : null;
  switch (input.kind) {
    case "host":
      return {
        title: "Run it",
        em: "on Mingla.",
        app: { text: "Get Mingla Host", href: `${SITE}/host/get` },
        call: { text: "Book a 20-minute call", href: icp ? `${SITE}/schedule?icp=${icp}` : `${SITE}/schedule` },
      };
    case "creator":
      return {
        title: "Start making",
        em: "with Mingla.",
        app: { text: "Get Mingla", href: `${SITE}/download` },
        call: { text: "Book a 20-minute call", href: `${SITE}/schedule/creators` },
      };
    case "local":
      return {
        title: "Start reviewing",
        em: "with Mingla.",
        app: { text: "Get Mingla", href: `${SITE}/download` },
        call: { text: "Book a 20-minute call", href: `${SITE}/schedule/locals` },
      };
    case "explorer":
      return {
        title: "More nights",
        em: "like this.",
        app: { text: "Get Mingla", href: `${SITE}/download` },
        call: null,
      };
  }
}

const INK = "#111110";
const ORANGE = "#EB7825";
const LINE = "#E7E3DA";

/** One pill button: ink, white text (18.9:1), a 3 px orange ring (box-shadow, border fallback for Outlook). */
export function renderButton(text: string, href: string, variant: "primary" | "secondary" = "primary"): string {
  const primary = variant === "primary";
  const bg = primary ? INK : "#FFFFFF";
  const fg = primary ? "#FFFFFF" : INK;
  const border = primary ? `3px solid ${ORANGE}` : `1.5px solid ${LINE}`;
  const shadow = primary ? `box-shadow:0 0 0 3px ${ORANGE};` : "";
  return `<a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:${bg};color:${fg};border:${border};${shadow}font-family:Geist,Helvetica,Arial,sans-serif;font-size:15px;line-height:20px;font-weight:600;text-decoration:none;mso-padding-alt:0;">${escapeHtml(text)}</a>`;
}

export function renderActionBar(input: ActionBarInput | null | undefined): string {
  if (!input) return "";
  const copy = actionBarCopy(input);
  const call = input.noCall ? null : copy.call;
  const cell = (html: string) =>
    `<td class="mingla-ab-cell" style="padding:6px;" valign="top">${html}</td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="mingla-ab" style="margin:8px 0 0 0;background:#F5F4F0;border:1px solid ${LINE};border-radius:16px;">
  <tr>
    <td style="padding:20px 20px 14px 20px;">
      <p style="margin:0 0 12px 0;font-family:'Instrument Serif',Georgia,'Times New Roman',serif;font-weight:400;font-size:24px;line-height:1.1;color:${INK};">${escapeHtml(copy.title)} <em>${escapeHtml(copy.em)}</em></p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${cell(renderButton(copy.app.text, copy.app.href, "primary"))}${call ? cell(renderButton(call.text, call.href, "secondary")) : ""}</tr></table>
    </td>
  </tr>
</table>`;
}
