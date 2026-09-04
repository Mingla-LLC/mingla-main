import { MINGLA_BUSINESS_ORIGIN } from "./origins";

/*
 * ONE builder for the whole runtime's Content-Security-Policy, so the public
 * policy and the preview policy can never drift in any dimension EXCEPT
 * frame-ancestors.
 *
 * script-src carries a per-request nonce because Next.js emits inline bootstrap
 * scripts to hand the server-rendered tree to React. Under a bare
 * `script-src 'self'` the browser blocks every one of them, React never
 * hydrates, and each published site is inert HTML: the cookie banner will not
 * dismiss, the menu will not add to cart, nothing clicks. That is what shipped,
 * and it is what this file exists to prevent recurring.
 */
export const PREVIEW_PATHNAME = "/preview";

export function frameAncestorsFor(pathname: string): string {
  /*
   * The private preview is the ONE route that may be framed, and only by
   * Business web, so the Website workspace can show the draft beside the
   * controls. The route is noindex and needs an unguessable artifact key, so
   * framing grants no reach that visiting the URL did not already grant.
   */
  return pathname === PREVIEW_PATHNAME
    ? `'self' ${MINGLA_BUSINESS_ORIGIN}`
    : "'none'";
}

export function buildCsp(
  { nonce, pathname, dev = false }: { nonce: string; pathname: string; dev?: boolean },
): string {
  return [
    "default-src 'self'",
    "img-src 'self' https: data:",
    /*
     * Deliberately 'unsafe-inline' and deliberately NOT nonced: a nonce in
     * style-src makes browsers ignore 'unsafe-inline', and the per-brand theme
     * is injected as an inline style element that the framework does not nonce
     * for us. Adding a nonce here would black out every brand's colours.
     */
    "style-src 'self' 'unsafe-inline'",
    // 'strict-dynamic' lets the nonced bootstrap load the chunks it needs; it
    // also makes conformant browsers ignore the 'self' host allowlist, which is
    // a tightening. 'self' stays for CSP2 browsers that do not honour it.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "connect-src 'self'",
    `frame-ancestors ${frameAncestorsFor(pathname)}`,
    "base-uri 'none'",
    "form-action 'self' https://usemingla.com https://www.usemingla.com",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

// API routes serve JSON and need no scripts, styles, or framing at all. They
// are excluded from the proxy matcher, so they carry this instead.
export const API_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
