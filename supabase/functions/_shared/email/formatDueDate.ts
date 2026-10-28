/**
 * Issue #3645 — one formatter for instalment due dates and amounts in emails
 * (moved out of send-installment-reminder so every instalment email agrees).
 * The date is shown in the event's timezone; an unknown zone falls back to UTC.
 */
export function formatDueDate(iso: string, timezone: string | null): string {
  const render = (timeZone: string): string =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  try {
    return render(timezone?.trim() || "UTC");
  } catch {
    try {
      return render("UTC");
    } catch {
      return iso;
    }
  }
}

/** Minor units → "₦2,706.25" / "£75.00" in the order's currency. */
export function formatInstallmentAmount(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.trim().toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.trim().toUpperCase()}`;
  }
}

export function escapeEmailHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Shared single-card layout used by the #3645 instalment emails. */
export function installmentEmailLayout(input: {
  heading: string;
  paragraphs: string[]; // already escaped HTML
  action?: { url: string; label: string } | null;
  footer: string; // already escaped HTML
}): string {
  const action = input.action
    ? `<p style="margin:0 0 24px;"><a href="${escapeEmailHtml(input.action.url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:600;font-size:16px;padding:14px 22px;border-radius:10px;">${escapeEmailHtml(input.action.label)}</a></p>`
    : "";
  return `<!doctype html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7f7f7;margin:0;padding:24px;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
    <h1 style="font-size:22px;margin:0 0 16px;font-weight:600;">${escapeEmailHtml(input.heading)}</h1>
    ${input.paragraphs.map((p) => `<p style="font-size:16px;line-height:1.55;margin:0 0 18px;">${p}</p>`).join("\n    ")}
    ${action}
    <p style="font-size:13px;color:#888;line-height:1.5;margin:32px 0 0;">${input.footer}</p>
  </div>
</body>
</html>`;
}
