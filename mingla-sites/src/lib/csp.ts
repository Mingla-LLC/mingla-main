import {
  businessPreviewFrameAncestor,
  MINGLA_BUSINESS_ORIGIN,
  MINGLA_STUDIO_ORIGIN,
} from "./origins";

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

/*
 * #3149 — the ONE third-party host a published site may frame.
 *
 * `frame-src` has no entry of its own here, so it falls back to `child-src`
 * and then to `default-src 'self'` — which silently blocks every map embed. It
 * is named explicitly, and named narrowly:
 *
 *   - OpenStreetMap, not Google Maps: the embed is a plain iframe with no
 *     script of ours to load and no advertising identity behind the request.
 *   - `frame-src` only. Nothing is added to `script-src`, `connect-src` or
 *     `img-src`, so this host may be FRAMED and can do nothing else.
 *   - The renderer contacts it only after a visitor presses "Show the map";
 *     opening a page requests nothing from it. See `MapEmbed`.
 *
 * Widening this list is a decision about where every published customer site
 * sends its visitors, not a styling change.
 */
export const MAP_FRAME_ORIGIN = "https://www.openstreetmap.org";

export function frameAncestorsFor(
  pathname: string,
  { localMode = false, frameAncestor = null }: {
    localMode?: boolean;
    /** `?fa=` on /preview: honoured only for a Business Vercel preview origin. */
    frameAncestor?: string | null;
  } = {},
): string {
  /*
   * The private preview is the ONE route that may be framed: by Business web
   * (the Website workspace shows the draft beside the controls) and by Mingla
   * Studio (its preview page frames the draft). frame-ancestors checks EVERY
   * ancestor, so Business framing Studio's preview page needs both.
   *
   * #2829 W9f — Studio was missing, so every Studio preview was blank,
   * production included. Local mode adds the loopback origins (local Business
   * web and Studio on any port); production never carries a wildcard.
   *
   * The route is noindex and needs an unguessable artifact key, so framing
   * grants no reach that visiting the URL did not already grant.
   */
  if (pathname !== PREVIEW_PATHNAME) return "'none'";
  const extra = businessPreviewFrameAncestor(frameAncestor);
  return [
    "'self'",
    MINGLA_BUSINESS_ORIGIN,
    MINGLA_STUDIO_ORIGIN,
    ...(extra ? [extra] : []),
    ...(localMode ? ["http://localhost:*", "http://127.0.0.1:*"] : []),
  ].join(" ");
}

/*
 * #2829 W6 (AD-9) — video plays from the site's own media route, plus a
 * stream-video CDN host ONLY when this publication plays a stream video from
 * a host on the runtime's allowlist (`SITES_VIDEO_CDN_HOSTS`). The caller
 * passes those hosts; anything that is not a bare hostname is dropped.
 */
export function mediaSrcFor(streamHosts: readonly string[] = []): string {
  const hosts = streamHosts.filter((host) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host));
  return ["media-src 'self'", ...hosts.map((host) => `https://${host}`)].join(" ");
}

export function buildCsp(
  { nonce, pathname, dev = false, streamHosts = [], localMode = false, frameAncestor = null }: {
    nonce: string;
    pathname: string;
    /** #2829 W9f — `?fa=` from a /preview request (validated in frameAncestorsFor). */
    frameAncestor?: string | null;
    dev?: boolean;
    streamHosts?: readonly string[];
    /*
     * #2829 — local mode serves plain http on `*.sites.localhost`. WebKit
     * (Safari, the iOS Simulator) applies `upgrade-insecure-requests` to
     * those hosts and fetches every script, stylesheet and video over https,
     * which fails, leaving an unstyled, inert page. Only local mode drops the
     * directive; every production policy keeps it.
     */
    localMode?: boolean;
  },
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
    mediaSrcFor(streamHosts),
    `frame-src 'self' ${MAP_FRAME_ORIGIN}`,
    `frame-ancestors ${frameAncestorsFor(pathname, { localMode, frameAncestor })}`,
    "base-uri 'none'",
    "form-action 'self' https://usemingla.com https://www.usemingla.com",
    "object-src 'none'",
    ...(localMode ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

// API routes serve JSON and need no scripts, styles, or framing at all. They
// are excluded from the proxy matcher, so they carry this instead.
export const API_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";
