/**
 * Issue #3697 — client guard for Meta's platform-rendered preview URL.
 *
 * Meta's generatepreviews answer is an iframe whose src is HTML-escaped
 * (`…preview_iframe.php?d=…&amp;t=…`). Opened raw, Meta answers "Not Found".
 * The server decodes it (admin-ad-preview); this guard decodes again for any
 * older response and refuses anything that is not an https Meta host, so the
 * page shows the clear fallback instead of a broken frame.
 */

const ENTITY = /&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt);/gi;
const NAMED = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };

export function decodeHtmlEntities(value) {
  return String(value ?? "").replace(ENTITY, (entity, body) => {
    if (body[0] === "#") {
      const code =
        body[1].toLowerCase() === "x"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : entity;
    }
    return NAMED[body.toLowerCase()] ?? entity;
  });
}

/** The decoded preview URL, or null when it is not a trusted Meta URL. */
export function safeMetaPreviewUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url;
  try {
    url = new URL(decodeHtmlEntities(raw.trim()));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const trusted =
    host === "facebook.com" ||
    host.endsWith(".facebook.com") ||
    host === "fbcdn.net" ||
    host.endsWith(".fbcdn.net");
  if (url.protocol !== "https:" || url.username || url.password || !trusted) {
    return null;
  }
  return url.toString();
}
