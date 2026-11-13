// Shared rich-text helpers for the Admin email composer (moved out of
// EmailComposer.jsx by #4419 so the editable block can use them).

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

export function sanitizeLocalRichText(value) {
  const allowed = new Set(["p", "h2", "h3", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "br"]);
  return String(value)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?([a-z0-9]+)(?:\s[^>]*)?>/gi, (raw, rawTag) => {
      const tag = rawTag.toLowerCase();
      if (!allowed.has(tag)) return "";
      if (raw.startsWith("</")) return `</${tag}>`;
      if (tag === "br") return "<br>";
      if (tag !== "a") return `<${tag}>`;
      const href = raw.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
      try {
        const parsed = new URL(href || "");
        return parsed.protocol === "https:" || (parsed.protocol === "mailto:" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.pathname))
          ? `<a href="${escapeHtml(parsed.toString())}" target="_blank" rel="noopener noreferrer">`
          : "<a>";
      } catch {
        return "<a>";
      }
    });
}
