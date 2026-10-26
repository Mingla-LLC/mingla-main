// #4111 — the one browser landing-page shell for links opened from Mingla
// emails and texts (e.g. the subscribe confirm link). Lives under
// _shared/email/ so the ORCH-0785-D shell-singleton rule holds: no function
// builds its own document outside this directory.
//
// `title` and `body` are plain text and are escaped here. `actionHtml` is
// trusted markup built by the caller from escaped values only.

import { escapeHtml } from "./escape.ts";

export const LANDING_PAGE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
};

export function renderLandingPage(input: {
  title: string;
  body: string;
  actionHtml?: string;
}): string {
  const title = escapeHtml(input.title);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title></head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#F5F5F7;color:#0F1115;">
  <main style="max-width:440px;margin:48px auto;padding:24px;background:#fff;border-radius:16px;">
    <h1 style="font-size:22px;line-height:28px;margin:0 0 8px 0;">${title}</h1>
    <p style="margin:0 0 20px 0;color:#5B6172;font-size:15px;line-height:22px;">${escapeHtml(input.body)}</p>
    ${input.actionHtml ?? ""}
  </main>
</body></html>`;
}

/** A single primary button that POSTs back to the same URL. */
export function landingPostButton(label: string): string {
  return `<form method="POST" action=""><button type="submit" style="min-height:48px;padding:0 24px;border:0;border-radius:999px;background:#C4471A;color:#fff;font-weight:700;font-size:16px;cursor:pointer;">${escapeHtml(label)}</button></form>`;
}

/** A single text link (href must be an absolute https URL). */
export function landingLink(label: string, href: string): string {
  return `<p><a href="${escapeHtml(href)}" style="color:#C4471A;font-weight:700;">${escapeHtml(label)}</a></p>`;
}
