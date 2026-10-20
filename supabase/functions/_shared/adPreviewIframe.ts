/**
 * Issue #3697 — decode the `src` Meta puts in its generatepreviews iframe.
 *
 * Meta returns the preview as HTML, e.g.
 *   <iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=AQ…&amp;t=AQ…">
 * The attribute value is HTML-escaped, so it must be decoded before it is a
 * URL. Parsed raw, `&amp;t=` becomes a parameter named `amp;t`, Meta never
 * receives `t`, and "Open preview in new tab" shows "Not Found".
 */

const NAMED: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
};

/** Decode HTML character references in one attribute value. */
export function decodeHtmlAttribute(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,
    (entity, body: string) => {
      if (body[0] === "#") {
        const code = body[1].toLowerCase() === "x"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : entity;
      }
      return NAMED[body.toLowerCase()] ?? entity;
    },
  );
}
