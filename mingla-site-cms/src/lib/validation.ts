const FORBIDDEN_TEXT = /<(?:script|style|iframe|svg)|\son[a-z]+\s*=|javascript:|data:|blob:|file:/i;
const HEX = /^#[0-9a-f]{6}$/i;
export const PAGE_ROLES = ["home", "about", "menu", "gallery", "contact"] as const;
export const MEDIA_STATES = ["UPLOADING", "QUARANTINED", "PROCESSING", "READY", "REJECTED", "RETRYABLE_FAILED", "TOMBSTONED"] as const;
export function safeText(value: unknown, max: number): true | string { return typeof value === "string" && value.length <= max && !FORBIDDEN_TEXT.test(value) ? true : "Use plain text without code or embedded markup."; }
export function safeUrl(value: unknown): true | string {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u001F]/.test(value)) return "Enter a safe link.";
  if (value.startsWith("/")) return value.startsWith("//") ? "Enter a safe relative link." : true;
  try { const url = new URL(value); return !url.username && !url.password && ["https:", "mailto:", "tel:"].includes(url.protocol) ? true : "Only secure web, email, or telephone links are allowed."; } catch { return "Enter a valid link."; }
}
export function boundedColor(value: unknown): true | string { return value == null || value === "" || (typeof value === "string" && HEX.test(value)) ? true : "Use a six-digit color value."; }
