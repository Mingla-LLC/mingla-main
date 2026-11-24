/*
 * #4572 item 1 (D5) — a preview GET that is refused answers the FRAME, not a
 * JSON reader.
 *
 * The Host shows the draft preview in an iframe pointed at this route. When
 * the draft moved since the grant was minted (REVISION_CONFLICT), or anything
 * else refused, the frame used to show the raw `{"ok":false,...}` envelope.
 * Now it gets a small page with one plain sentence that tells its parent what
 * happened, so the Host can refresh the grant silently ("Updating preview…")
 * or show its own "We couldn't load the preview" card with Try again.
 *
 * The message goes only to origins Mingla owns (the Host origin, Studio's own
 * origin and a pattern-checked Business Vercel preview ancestor), never "*".
 * Status codes are unchanged (403 / 404 / 409 / 503).
 */
export const PREVIEW_STALE = "mingla:preview-stale";
export const PREVIEW_FAILED = "mingla:preview-failed";

export type PreviewRefusal = { status: number; message: string; type: typeof PREVIEW_STALE | typeof PREVIEW_FAILED };

export function previewRefusal(code: string): PreviewRefusal {
  if (code === "REVISION_CONFLICT") {
    return { status: 409, message: "Your draft just changed. Updating preview…", type: PREVIEW_STALE };
  }
  const status = code === "FORBIDDEN" || code === "SESSION_EXPIRED"
    ? 403
    : code === "NOT_FOUND"
      ? 404
      : code === "SERVICE_TEMPORARILY_UNAVAILABLE"
        ? 503
        : 409;
  return { status, message: "We couldn't load the preview.", type: PREVIEW_FAILED };
}

const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;

/** Only well-formed origins, each once. */
export function previewMessageTargets(origins: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const origin of origins) {
    if (typeof origin === "string" && ORIGIN_RE.test(origin) && !out.includes(origin)) out.push(origin);
  }
  return out;
}

function nonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function previewRefusalResponse(code: string, origins: readonly (string | null | undefined)[]): Response {
  const refusal = previewRefusal(code);
  const targets = previewMessageTargets(origins);
  const n = nonce();
  const payload = JSON.stringify({ type: refusal.type, code: refusal.type === PREVIEW_STALE ? "REVISION_CONFLICT" : "PREVIEW_FAILED" });
  const script = `(function(){var m=${payload};var t=${JSON.stringify(targets)};` +
    "if(window.parent&&window.parent!==window){for(var i=0;i<t.length;i++){try{window.parent.postMessage(m,t[i]);}catch(e){}}}})();";
  const html = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Preview</title>" +
    `<style nonce="${n}">html,body{margin:0;height:100%;background:#121214;color:#a8a8ad;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}` +
    "body{display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;box-sizing:border-box}</style>" +
    `</head><body><p role="status">${refusal.message}</p><script nonce="${n}">${script}</script></body></html>`;
  return new Response(html, {
    status: refusal.status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, private",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${n}'; style-src 'nonce-${n}'; base-uri 'none'; form-action 'none'; frame-ancestors ${targets.length ? targets.join(" ") : "'none'"}`,
    },
  });
}
