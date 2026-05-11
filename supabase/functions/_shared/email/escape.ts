// ORCH-0785 — HTML escape helper for transactional email renderers.
// I-PROPOSED-AF BUYER_INPUT_HTML_ESCAPED: every dynamic string interpolated
// into email HTML must flow through this helper. Pure, no external deps.

export function escapeHtml(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
